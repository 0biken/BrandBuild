//! The planning agent: turns a goal into 2 or 4 weeks of drafts.
//!
//! queued → context_loading → planning → generating → validating → awaiting_review,
//! or failed / canceled. The model is called once, with no tools. Its proposals pass the
//! deterministic checks in `validate`, the ranker picks the plan, and the chosen drafts are
//! saved in one transaction under per-slot keys, so a retried run never duplicates and a
//! failed or canceled run saves nothing. Drafts only: nothing is approved or scheduled.
use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::{
    context::{self, Snapshot},
    validate::{self, Candidate, Dropped, PlanAnswer, PER_WEEK},
    AiError, Gateway, ModelRequest, Usage, PLAN_PROMPT, PLAN_PROMPT_VERSION,
};
use crate::{
    api::ApiError,
    audit,
    auth::{Role, TenantContext},
    content::{self, NewDraft},
    db::tenant_tx,
    outbox, AppState,
};

/// What the user asks for.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanGoal {
    pub goal: String,
    pub weeks: u8,
    pub platforms: Vec<String>,
    pub start_date: NaiveDate,
}

impl PlanGoal {
    pub fn check(&self) -> Result<(), ApiError> {
        let today = Utc::now().date_naive();
        let mut platforms = self.platforms.clone();
        platforms.sort();
        platforms.dedup();
        let ok = (1..=500).contains(&self.goal.trim().chars().count())
            && matches!(self.weeks, 2 | 4)
            && !self.platforms.is_empty()
            && platforms.len() == self.platforms.len()
            && self
                .platforms
                .iter()
                .all(|p| ["ig", "fb", "li", "tt"].contains(&p.as_str()))
            && self.start_date >= today - Duration::days(1)
            && self.start_date <= today + Duration::days(90);
        if ok {
            Ok(())
        } else {
            Err(ApiError::InvalidInput)
        }
    }

    fn days(&self) -> i64 {
        i64::from(self.weeks) * 7
    }
}

/// Refuses a new run when the workspace is out of runs or spend for the month.
pub async fn check_budget(pool: &PgPool, ai: &Gateway, tenant: Uuid) -> Result<(), ApiError> {
    let row = sqlx::query(
        "SELECT count(*) AS runs, COALESCE(sum(cost_usd),0)::float8 AS spent,
           COALESCE((SELECT agent_runs_limit FROM usage_caps WHERE tenant_id=$1),100)::bigint AS run_limit
         FROM agent_runs WHERE tenant_id=$1 AND created_at >= date_trunc('month', now())",
    )
    .bind(tenant)
    .fetch_one(pool)
    .await?;
    let runs: i64 = row.try_get("runs")?;
    let spent: f64 = row.try_get("spent")?;
    let limit: i64 = row.try_get("run_limit")?;
    if runs >= limit || spent >= ai.monthly_usd_cap {
        return Err(ApiError::AiBudget);
    }
    Ok(())
}

/// Records a run and queues it for the worker, in the caller's transaction.
pub async fn queue(
    tx: &mut sqlx::Transaction<'static, sqlx::Postgres>,
    ctx: &TenantContext,
    ai: &Gateway,
    goal: &PlanGoal,
) -> Result<Uuid, ApiError> {
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO agent_runs(tenant_id,kind,status,input,goal,created_by,model,prompt_version)
         VALUES($1,'plan','queued',$2,$2,$3,$4,$5) RETURNING id",
    )
    .bind(ctx.tenant_id)
    .bind(json!(goal))
    .bind(ctx.actor_id)
    .bind(&ai.model)
    .bind(PLAN_PROMPT_VERSION)
    .fetch_one(&mut **tx)
    .await?;
    outbox::enqueue(tx, ctx.tenant_id, "agent.run", json!({ "run_id": id })).await?;
    audit::record(
        tx,
        ctx,
        "ai_plan_requested",
        "agent_run",
        id,
        json!({ "weeks": goal.weeks, "platforms": goal.platforms }),
    )
    .await?;
    Ok(id)
}

/// The JSON Schema Gemini must follow for a plan.
pub fn plan_schema() -> Value {
    let nullable = |t: &str| json!({ "type": [t, "null"] });
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["items"],
        "properties": { "items": { "type": "array", "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["platform","date","localTime","pillar","idea","caption","hashtags","altText","mediaId","imageBrief","factIds","reasoning","warnings"],
            "properties": {
                "platform": { "type": "string", "enum": ["ig","fb","li","tt"] },
                "date": { "type": "string", "format": "date" },
                "localTime": { "type": "string", "pattern": "^[0-2][0-9]:[0-5][0-9]$" },
                "pillar": { "type": "string" },
                "idea": { "type": "string" },
                "caption": { "type": "string" },
                "hashtags": { "type": "array", "items": { "type": "string" } },
                "altText": nullable("string"),
                "mediaId": nullable("string"),
                "imageBrief": nullable("string"),
                "factIds": { "type": "array", "items": { "type": "string" } },
                "reasoning": { "type": "string" },
                "warnings": { "type": "array", "items": { "type": "string" } }
            }
        } } }
    })
}

/// The user turn: the goal, how many posts, and the workspace data fenced off as data.
pub fn plan_request(goal: &PlanGoal, snap: &Snapshot) -> String {
    let per_platform = usize::from(goal.weeks) * PER_WEEK;
    let total = per_platform * goal.platforms.len();
    format!(
        "Goal: {}\nThe plan needs {per_platform} posts per platform ({PER_WEEK} a week for {} weeks), {total} in total. Propose about {} posts.\n\n<<<WORKSPACE DATA>>>\n{}\n<<<END WORKSPACE DATA>>>",
        goal.goal.trim(),
        goal.weeks,
        total + total.div_ceil(2),
        serde_json::to_string_pretty(snap).unwrap_or_default()
    )
}

/// A local wall-clock time in the workspace's zone, as UTC. Times that don't exist or
/// happen twice around a clock change are refused rather than guessed.
pub fn to_utc(zone: &str, date: NaiveDate, time: &str) -> Option<DateTime<Utc>> {
    let tz: chrono_tz::Tz = zone.parse().ok()?;
    let time = NaiveTime::parse_from_str(time, "%H:%M").ok()?;
    tz.from_local_datetime(&NaiveDateTime::new(date, time))
        .single()
        .map(|t| t.with_timezone(&Utc))
}

async fn set_status(pool: &PgPool, run: Uuid, status: &str) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query(
        "UPDATE agent_runs SET status=$2,updated_at=now(),started_at=COALESCE(started_at,now())
         WHERE id=$1 AND status NOT IN ('canceled','failed','awaiting_review')",
    )
    .bind(run)
    .bind(status)
    .execute(pool)
    .await?
    .rows_affected()
        == 1)
}

async fn fail(pool: &PgPool, run: Uuid, reason: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE agent_runs SET status='failed',error=$2,finished_at=now(),updated_at=now()
         WHERE id=$1 AND status NOT IN ('canceled','awaiting_review')",
    )
    .bind(run)
    .bind(reason)
    .execute(pool)
    .await?;
    Ok(())
}

async fn record_usage(
    pool: &PgPool,
    ai: &Gateway,
    run: Uuid,
    usage: Usage,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE agent_runs SET input_tokens=input_tokens+$2,output_tokens=output_tokens+$3,
           cost_usd=cost_usd+$4,usage_units=usage_units+1 WHERE id=$1",
    )
    .bind(run)
    .bind(usage.input_tokens.min(i64::from(i32::MAX)) as i32)
    .bind(usage.output_tokens.min(i64::from(i32::MAX)) as i32)
    .bind(ai.cost_usd(usage))
    .execute(pool)
    .await?;
    Ok(())
}

fn user_message(e: &AiError) -> String {
    match e {
        AiError::NotConfigured => "AI planning isn't set up on this server.".into(),
        AiError::Timeout => "The AI took too long. Try again in a minute.".into(),
        AiError::Blocked(_) => "The AI declined this request. Try rewording the goal.".into(),
        AiError::BadOutput(_) => "The AI's answer was unusable. Try again.".into(),
        AiError::OverBudget => "This workspace has used its AI allowance for the month.".into(),
        AiError::Canceled => "Canceled.".into(),
        AiError::Provider(_) => "The AI service had a problem. Try again later.".into(),
    }
}

/// Runs one queued plan. AI and validation problems end the run as `failed` with a reason
/// the user can read; only database errors return `Err` (so the outbox retries).
pub async fn run(state: &AppState, tenant: Uuid, run: Uuid) -> Result<(), String> {
    let pool = &state.pool;
    let row =
        sqlx::query("SELECT status,goal,created_by FROM agent_runs WHERE id=$1 AND tenant_id=$2")
            .bind(run)
            .bind(tenant)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
    let Some(row) = row else { return Ok(()) };
    let status: String = row.try_get("status").map_err(|e| e.to_string())?;
    if status != "queued" {
        return Ok(()); // canceled, or a repeated delivery of a run already handled
    }
    let goal: PlanGoal =
        match serde_json::from_value(row.try_get::<Value, _>("goal").map_err(|e| e.to_string())?) {
            Ok(goal) => goal,
            Err(_) => {
                return fail(pool, run, "The plan request was invalid.")
                    .await
                    .map_err(|e| e.to_string())
            }
        };
    let Some(author) = row
        .try_get::<Option<Uuid>, _>("created_by")
        .map_err(|e| e.to_string())?
    else {
        return fail(
            pool,
            run,
            "The person who asked for this plan left the workspace.",
        )
        .await
        .map_err(|e| e.to_string());
    };
    let ctx = TenantContext {
        tenant_id: tenant,
        actor_id: author,
        role: Role::Editor,
    };

    let outcome = plan(state, &ctx, run, &goal).await;
    match outcome {
        Ok(()) => Ok(()),
        Err(Step::Ai(e)) => {
            tracing::warn!(%run, error=%e, "plan run failed");
            fail(pool, run, &user_message(&e))
                .await
                .map_err(|e| e.to_string())
        }
        Err(Step::Reason(reason)) => fail(pool, run, &reason).await.map_err(|e| e.to_string()),
        Err(Step::Stopped) => Ok(()),
        Err(Step::Db(e)) => Err(e),
    }
}

enum Step {
    Ai(AiError),
    Reason(String),
    /// The run was canceled while it worked.
    Stopped,
    Db(String),
}

impl From<sqlx::Error> for Step {
    fn from(e: sqlx::Error) -> Self {
        Self::Db(e.to_string())
    }
}
impl From<ApiError> for Step {
    fn from(e: ApiError) -> Self {
        match e {
            ApiError::Internal => Self::Db("database error".into()),
            other => Self::Reason(format!("Couldn't save the drafts: {other}.")),
        }
    }
}

async fn plan(
    state: &AppState,
    ctx: &TenantContext,
    run: Uuid,
    goal: &PlanGoal,
) -> Result<(), Step> {
    let pool = &state.pool;
    if !set_status(pool, run, "context_loading").await? {
        return Err(Step::Stopped);
    }
    let mut tx = tenant_tx(pool, ctx.tenant_id).await?;
    let snap = context::build(
        &mut tx,
        ctx.tenant_id,
        goal.start_date,
        goal.days(),
        &goal.platforms,
    )
    .await?;
    tx.commit().await?;
    sqlx::query("UPDATE agent_runs SET context_snapshot=$2,context_version=$3 WHERE id=$1")
        .bind(run)
        .bind(json!(snap))
        .bind(context::CONTEXT_VERSION)
        .execute(pool)
        .await?;

    if !set_status(pool, run, "planning").await? {
        return Err(Step::Stopped);
    }
    let request = ModelRequest {
        system: PLAN_PROMPT.into(),
        user: plan_request(goal, &snap),
        schema: plan_schema(),
    };
    if !set_status(pool, run, "generating").await? {
        return Err(Step::Stopped);
    }
    let result = state.ai.generate::<PlanAnswer>(&request).await;
    let answer = match result {
        Ok((answer, usage)) => {
            record_usage(pool, &state.ai, run, usage).await?;
            answer
        }
        Err(e) => {
            // A bad answer still used tokens; count a nominal call so spend isn't hidden.
            if matches!(e, AiError::BadOutput(_) | AiError::Blocked(_)) {
                record_usage(
                    pool,
                    &state.ai,
                    run,
                    Usage {
                        input_tokens: 0,
                        output_tokens: 0,
                    },
                )
                .await?;
            }
            return Err(Step::Ai(e));
        }
    };

    if !set_status(pool, run, "validating").await? {
        return Err(Step::Stopped);
    }
    let (chosen, mut dropped) = validate::select(answer.items, &snap, usize::from(goal.weeks));
    save(state, ctx, run, goal, &snap, chosen, &mut dropped).await
}

/// Saves the chosen drafts and finishes the run, all in one transaction. If the run was
/// canceled meanwhile, nothing is saved.
async fn save(
    state: &AppState,
    ctx: &TenantContext,
    run: Uuid,
    goal: &PlanGoal,
    snap: &Snapshot,
    chosen: Vec<Candidate>,
    dropped: &mut Vec<Dropped>,
) -> Result<(), Step> {
    let mut tx = tenant_tx(&state.pool, ctx.tenant_id).await?;
    let status: String = sqlx::query_scalar("SELECT status FROM agent_runs WHERE id=$1 FOR UPDATE")
        .bind(run)
        .fetch_one(&mut *tx)
        .await?;
    if status != "validating" {
        return Err(Step::Stopped);
    }
    let mut ids = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    for c in chosen {
        let Some(when) = to_utc(&snap.timezone, c.date, &c.local_time) else {
            dropped.push(Dropped {
                platform: c.platform.clone(),
                date: c.date,
                idea: c.idea.clone(),
                reason: "that time doesn't exist or happens twice on that day (clock change)"
                    .into(),
            });
            continue;
        };
        let media: Vec<Uuid> = c
            .media_id
            .iter()
            .filter_map(|m| Uuid::parse_str(m).ok())
            .collect();
        let mut body =
            content::build_content(&mut tx, &c.caption, &c.hashtags, "1 / 1", &media).await?;
        body["altText"] = json!(c.alt_text);
        body["source"] = json!({
            "kind": "ai_plan",
            "runId": run,
            "model": state.ai.model,
            "promptVersion": PLAN_PROMPT_VERSION,
            "contextVersion": snap.version,
            "factIds": c.fact_ids,
            "pillar": c.pillar,
            "reasoning": c.reasoning,
            "imageBrief": c.image_brief,
            "warnings": c.warnings,
            "localTime": c.local_time,
            "timezone": snap.timezone,
        });
        content::check_content(&body)?;
        warnings.extend(c.warnings.iter().cloned());
        let draft = NewDraft {
            key: format!("plan:{run}:{}:{}:{}", c.platform, c.date, c.local_time),
            title: c.idea.chars().take(120).collect(),
            platforms: vec![c.platform.clone()],
            draft_state: if media.is_empty() {
                "needs_photo".into()
            } else {
                "ready".into()
            },
            scheduled_for: Some(when),
            content: body,
        };
        ids.push(content::save_keyed_draft(&mut tx, ctx, &draft).await?);
    }
    if ids.is_empty() {
        return Err(Step::Reason(format!(
            "None of the AI's {} ideas passed the checks. Add verified facts and photos to your brand kit, then try again.",
            dropped.len()
        )));
    }
    sqlx::query(
        "UPDATE agent_runs SET status='awaiting_review',output=$2,finished_at=now(),updated_at=now() WHERE id=$1",
    )
    .bind(run)
    .bind(json!({ "draftIds": ids, "dropped": dropped, "warnings": warnings, "weeks": goal.weeks }))
    .execute(&mut *tx)
    .await?;
    audit::record(
        &mut tx,
        ctx,
        "ai_drafts_saved",
        "agent_run",
        run,
        json!({ "drafts": ids.len(), "dropped": dropped.len() }),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_times_become_utc_and_clock_changes_are_refused() {
        let d = |y, m, day| NaiveDate::from_ymd_opt(y, m, day).unwrap();
        assert_eq!(
            to_utc("Africa/Lagos", d(2030, 1, 7), "18:00")
                .unwrap()
                .to_rfc3339(),
            "2030-01-07T17:00:00+00:00"
        );
        // London springs forward at 01:00 on 31 March 2030: 01:30 doesn't exist.
        assert!(to_utc("Europe/London", d(2030, 3, 31), "01:30").is_none());
        // ...and falls back on 27 October 2030: 01:30 happens twice.
        assert!(to_utc("Europe/London", d(2030, 10, 27), "01:30").is_none());
        assert!(to_utc("Nowhere/Land", d(2030, 1, 7), "18:00").is_none());
        assert!(to_utc("UTC", d(2030, 1, 7), "25:00").is_none());
    }

    #[test]
    fn goals_are_checked() {
        let today = Utc::now().date_naive();
        let ok = PlanGoal {
            goal: "Sell out the new shades".into(),
            weeks: 2,
            platforms: vec!["ig".into()],
            start_date: today,
        };
        assert!(ok.check().is_ok());
        for bad in [
            PlanGoal {
                weeks: 3,
                ..ok.clone()
            },
            PlanGoal {
                goal: " ".into(),
                ..ok.clone()
            },
            PlanGoal {
                platforms: vec![],
                ..ok.clone()
            },
            PlanGoal {
                platforms: vec!["ig".into(), "ig".into()],
                ..ok.clone()
            },
            PlanGoal {
                platforms: vec!["myspace".into()],
                ..ok.clone()
            },
            PlanGoal {
                start_date: today - Duration::days(10),
                ..ok.clone()
            },
        ] {
            assert!(bad.check().is_err(), "{bad:?}");
        }
    }

    #[test]
    fn workspace_text_is_fenced_off_as_data() {
        let snap = super::super::validate::tests::snapshot();
        let goal = PlanGoal {
            goal: "Launch".into(),
            weeks: 2,
            platforms: vec!["ig".into(), "fb".into()],
            start_date: snap.start,
        };
        let msg = plan_request(&goal, &snap);
        assert!(msg.contains("6 posts per platform"));
        assert!(msg.contains("12 in total. Propose about 18 posts"));
        let data = msg.split("<<<WORKSPACE DATA>>>").nth(1).unwrap();
        assert!(data.contains("\"wordsAvoid\""));
        assert!(data.trim_end().ends_with("<<<END WORKSPACE DATA>>>"));
    }
}
