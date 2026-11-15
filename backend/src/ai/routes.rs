//! AI routes: plan a few weeks (`/plans`, runs in the background), follow or cancel a run
//! (`/agent-runs/{id}`), and write one post for the composer (`/ai/generate`).
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Duration, FixedOffset, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

use super::{
    context,
    planner::{self, PlanGoal},
    validate::{self, Candidate},
    AiError, ModelRequest, GENERATE_PROMPT, GENERATE_PROMPT_VERSION,
};
use crate::{
    api::ApiError,
    auth::{Role, TenantContext},
    db::tenant_tx,
    AppState,
};

/// Owners and editors write content; reviewers only decide.
const WRITERS: &[Role] = &[Role::Owner, Role::Editor];

async fn create_plan(
    State(s): State<AppState>,
    ctx: TenantContext,
    Json(goal): Json<PlanGoal>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    ctx.require(WRITERS)?;
    goal.check()?;
    if !s.ai.enabled() {
        return Err(ApiError::AiUnavailable);
    }
    planner::check_budget(&s.pool, &s.ai, ctx.tenant_id).await?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let id = planner::queue(&mut tx, &ctx, &s.ai, &goal).await?;
    tx.commit().await?;
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({ "data": { "runId": id, "status": "queued" } })),
    ))
}

async fn run_json(pool: &sqlx::PgPool, tenant: Uuid, id: Uuid) -> Result<Value, ApiError> {
    // agent_runs has no row-level security (the worker reads across workspaces), so the
    // workspace filter here is what keeps runs private.
    let row = sqlx::query(
        "SELECT id,kind,status,goal,output,error,model,prompt_version,input_tokens,output_tokens,
           cost_usd::float8 AS cost,created_at,finished_at
         FROM agent_runs WHERE id=$1 AND tenant_id=$2",
    )
    .bind(id)
    .bind(tenant)
    .fetch_optional(pool)
    .await?
    .ok_or(ApiError::NotFound)?;
    let output: Option<Value> = row.try_get("output")?;
    let output = output.unwrap_or_else(|| json!({}));
    let mut out = json!({
        "id": row.try_get::<Uuid, _>("id")?,
        "kind": row.try_get::<String, _>("kind")?,
        "status": row.try_get::<String, _>("status")?,
        "goal": row.try_get::<Option<Value>, _>("goal")?,
        "draftIds": output.get("draftIds").cloned().unwrap_or_else(|| json!([])),
        "dropped": output.get("dropped").cloned().unwrap_or_else(|| json!([])),
        "warnings": output.get("warnings").cloned().unwrap_or_else(|| json!([])),
        "model": row.try_get::<Option<String>, _>("model")?,
        "promptVersion": row.try_get::<Option<String>, _>("prompt_version")?,
        "usage": {
            "inputTokens": row.try_get::<i32, _>("input_tokens")?,
            "outputTokens": row.try_get::<i32, _>("output_tokens")?,
            "costUsd": row.try_get::<f64, _>("cost")?,
        },
        "createdAt": row.try_get::<DateTime<Utc>, _>("created_at")?.to_rfc3339(),
    });
    if let Some(error) = row.try_get::<Option<String>, _>("error")? {
        out["error"] = json!(error);
    }
    if let Some(at) = row.try_get::<Option<DateTime<Utc>>, _>("finished_at")? {
        out["finishedAt"] = json!(at.to_rfc3339());
    }
    Ok(out)
}

fn parse_id(id: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(id).map_err(|_| ApiError::NotFound)
}

async fn get_run(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let out = run_json(&s.pool, ctx.tenant_id, parse_id(&id)?).await?;
    Ok(Json(json!({ "data": out })))
}

/// Stops a run that hasn't saved its drafts yet. Nothing it was working on is kept.
async fn cancel_run(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ctx.require(WRITERS)?;
    let id = parse_id(&id)?;
    let n = sqlx::query(
        "UPDATE agent_runs SET status='canceled',error='Canceled.',finished_at=now(),updated_at=now()
         WHERE id=$1 AND tenant_id=$2 AND status IN ('queued','context_loading','planning','generating','validating')",
    )
    .bind(id)
    .bind(ctx.tenant_id)
    .execute(&s.pool)
    .await?
    .rows_affected();
    if n == 0 {
        // Unknown, someone else's, or already finished.
        run_json(&s.pool, ctx.tenant_id, id).await?;
        return Err(ApiError::Conflict);
    }
    Ok(Json(
        json!({ "data": run_json(&s.pool, ctx.tenant_id, id).await? }),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GenerateInput {
    idea: String,
    tone: String,
    platforms: Vec<String>,
    tweak: Option<String>,
    caption: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GenerateAnswer {
    caption: String,
    hashtags: Vec<String>,
    best_time: DateTime<FixedOffset>,
    fact_ids: Vec<String>,
    warnings: Vec<String>,
}

fn generate_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["caption", "hashtags", "bestTime", "factIds", "warnings"],
        "properties": {
            "caption": { "type": "string" },
            "hashtags": { "type": "array", "items": { "type": "string" } },
            "bestTime": { "type": "string", "format": "date-time" },
            "factIds": { "type": "array", "items": { "type": "string" } },
            "warnings": { "type": "array", "items": { "type": "string" } }
        }
    })
}

/// One post for the composer, checked by the same rules as a plan.
async fn generate(
    State(s): State<AppState>,
    ctx: TenantContext,
    Json(input): Json<GenerateInput>,
) -> Result<Json<Value>, ApiError> {
    ctx.require(WRITERS)?;
    let tweaks = ["rewrite", "shorter", "playful", "cta"];
    let ok = (1..=1000).contains(&input.idea.trim().chars().count())
        && input.tone.chars().count() <= 40
        && !input.platforms.is_empty()
        && input
            .platforms
            .iter()
            .all(|p| ["ig", "fb", "li", "tt"].contains(&p.as_str()))
        && input.tweak.as_deref().is_none_or(|t| tweaks.contains(&t))
        && input
            .caption
            .as_ref()
            .is_none_or(|c| c.chars().count() <= 5000);
    if !ok {
        return Err(ApiError::InvalidInput);
    }
    if !s.ai.enabled() {
        return Err(ApiError::AiUnavailable);
    }
    planner::check_budget(&s.pool, &s.ai, ctx.tenant_id).await?;
    let today = Utc::now().date_naive();
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let snap = context::build(&mut tx, ctx.tenant_id, today, 8, &input.platforms).await?;
    tx.commit().await?;

    let request = ModelRequest {
        system: GENERATE_PROMPT.into(),
        user: format!(
            "Idea: {}\nTone: {}\nPlatforms: {}\nCurrent time: {}\n{}\n<<<WORKSPACE DATA>>>\n{}\n<<<END WORKSPACE DATA>>>",
            input.idea.trim(),
            input.tone,
            input.platforms.join(", "),
            Utc::now().to_rfc3339(),
            match (&input.tweak, &input.caption) {
                (Some(t), Some(c)) => format!("Tweak: {t}\nCurrent caption:\n{c}\n"),
                _ => String::new(),
            },
            serde_json::to_string_pretty(&snap).unwrap_or_default()
        ),
        schema: generate_schema(),
    };
    let result = s.ai.generate::<GenerateAnswer>(&request).await;
    let (answer, usage) = match result {
        Ok(ok) => ok,
        Err(AiError::NotConfigured) => return Err(ApiError::AiUnavailable),
        Err(e) => {
            tracing::warn!(error=%e, "generate failed");
            return Err(ApiError::AiUnavailable);
        }
    };
    sqlx::query(
        "INSERT INTO agent_runs(tenant_id,kind,status,input,created_by,model,prompt_version,input_tokens,output_tokens,cost_usd,usage_units,started_at,finished_at)
         VALUES($1,'generate','succeeded',$2,$3,$4,$5,$6,$7,$8,1,now(),now())",
    )
    .bind(ctx.tenant_id)
    .bind(json!({ "idea": input.idea, "platforms": input.platforms, "tweak": input.tweak }))
    .bind(ctx.actor_id)
    .bind(&s.ai.model)
    .bind(GENERATE_PROMPT_VERSION)
    .bind(usage.input_tokens.min(i64::from(i32::MAX)) as i32)
    .bind(usage.output_tokens.min(i64::from(i32::MAX)) as i32)
    .bind(s.ai.cost_usd(usage))
    .execute(&s.pool)
    .await?;

    // A best time outside the next week (or in the past) becomes tomorrow evening.
    let best = answer.best_time.with_timezone(&Utc);
    let best = if best > Utc::now() && best < Utc::now() + Duration::days(7) {
        best
    } else {
        (Utc::now() + Duration::days(1))
            .date_naive()
            .and_hms_opt(17, 0, 0)
            .unwrap()
            .and_utc()
    };
    for platform in &input.platforms {
        let candidate = Candidate {
            platform: platform.clone(),
            date: today,
            local_time: "12:00".into(),
            pillar: "single".into(),
            idea: input.idea.clone(),
            caption: answer.caption.clone(),
            hashtags: answer.hashtags.clone(),
            alt_text: None,
            media_id: None,
            image_brief: None,
            fact_ids: answer.fact_ids.clone(),
            reasoning: String::new(),
            warnings: vec![],
        };
        validate::check(&candidate, &snap).map_err(|reason| {
            ApiError::AiRejected(format!(
                "The AI's draft was held back because it {reason}. Try again or write it yourself."
            ))
        })?;
    }
    Ok(Json(json!({ "data": {
        "caption": answer.caption,
        "hashtags": answer.hashtags,
        "bestTime": best.to_rfc3339(),
        "factIds": answer.fact_ids,
        "warnings": answer.warnings,
    } })))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/plans", post(create_plan))
        .route("/agent-runs/:run_id", get(get_run))
        .route("/agent-runs/:run_id/cancel", post(cancel_run))
        .route("/ai/generate", post(generate))
}
