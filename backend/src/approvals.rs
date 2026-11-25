//! Approval rules and decisions (docs/api/openapi.yaml, tag `approvals`).
//!
//! The rule: a post may only be `approved`, `scheduled` or going out while its newest
//! `approvals` row for the **current** version says `approved` and carries that version's
//! content hash. Any edit makes a new version, so an old approval never covers new words.
//! When a workspace requires a second approver, nobody approves a post they wrote or sent.
use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{
    api::ApiError,
    audit,
    auth::{TenantContext, DECIDERS, OWNERS},
    content,
    db::tenant_tx,
    domain::{self, PostAction},
    outbox, AppState,
};

type Tx = Transaction<'static, Postgres>;

/// How long a decider has to undo a decision.
const UNDO_WINDOW_MINUTES: i64 = 15;

/// Whether the workspace requires a second person to approve.
pub async fn second_approver_required(tx: &mut Tx, tenant: Uuid) -> Result<bool, ApiError> {
    Ok(
        sqlx::query_scalar("SELECT require_second_approver FROM tenants WHERE id=$1")
            .bind(tenant)
            .fetch_one(&mut **tx)
            .await?,
    )
}

/// A post's lock-held facts that decisions depend on.
pub struct PostFacts {
    pub state: String,
    pub version_id: Uuid,
    pub content_hash: String,
    pub created_by: Option<Uuid>,
    pub review_requested_by: Option<Uuid>,
    pub scheduled_for: Option<DateTime<Utc>>,
    pub title: String,
}

/// Locks the post and reads its current version.
pub async fn lock(tx: &mut Tx, post: Uuid) -> Result<PostFacts, ApiError> {
    let row = sqlx::query(
        "SELECT p.state::text AS state,p.created_by,p.review_requested_by,p.scheduled_for,p.title,
                v.id AS version_id,v.content,v.content_hash
         FROM posts p
         JOIN post_versions v ON v.tenant_id=p.tenant_id AND v.post_id=p.id AND v.version=p.current_version
         WHERE p.id=$1 AND p.deleted_at IS NULL FOR UPDATE OF p",
    )
    .bind(post)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(ApiError::NotFound)?;
    let content: Value = row.try_get("content")?;
    let content_hash = row
        .try_get::<Option<String>, _>("content_hash")?
        .unwrap_or_else(|| domain::content_hash(&content));
    Ok(PostFacts {
        state: row.try_get("state")?,
        version_id: row.try_get("version_id")?,
        content_hash,
        created_by: row.try_get("created_by")?,
        review_requested_by: row.try_get("review_requested_by")?,
        scheduled_for: row.try_get("scheduled_for")?,
        title: row.try_get("title")?,
    })
}

/// True when `actor` may approve this post under the workspace's rules.
pub async fn may_approve(
    tx: &mut Tx,
    ctx: &TenantContext,
    facts: &PostFacts,
) -> Result<bool, ApiError> {
    if ctx.require(DECIDERS).is_err() {
        return Ok(false);
    }
    if !second_approver_required(tx, ctx.tenant_id).await? {
        return Ok(true);
    }
    let own =
        facts.created_by == Some(ctx.actor_id) || facts.review_requested_by == Some(ctx.actor_id);
    Ok(!own)
}

/// Writes one decision row against the post's current version.
pub async fn record(
    tx: &mut Tx,
    ctx: &TenantContext,
    post: Uuid,
    facts: &PostFacts,
    decision: &str,
    comment: Option<&str>,
) -> Result<Uuid, ApiError> {
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO approvals(tenant_id,post_id,post_version_id,reviewer_id,decision,comment,content_hash)
         VALUES($1,$2,$3,$4,$5::approval_decision,$6,$7) RETURNING id",
    )
    .bind(ctx.tenant_id)
    .bind(post)
    .bind(facts.version_id)
    .bind(ctx.actor_id)
    .bind(decision)
    .bind(comment)
    .bind(&facts.content_hash)
    .fetch_one(&mut **tx)
    .await?;
    audit::record(
        tx,
        ctx,
        &format!("post_{decision}"),
        "post",
        post,
        json!({ "post_version_id": facts.version_id, "content_hash": facts.content_hash }),
    )
    .await?;
    Ok(id)
}

/// Whether the current version stands approved: its newest decision is `approved`, for the
/// same content hash, and (with a second approver required) by someone other than the author.
pub async fn is_approved(
    tx: &mut Tx,
    tenant: Uuid,
    post: Uuid,
    facts: &PostFacts,
) -> Result<bool, ApiError> {
    let row = sqlx::query(
        "SELECT decision::text AS decision,content_hash,reviewer_id FROM approvals
         WHERE post_id=$1 AND post_version_id=$2 ORDER BY decided_at DESC, id DESC LIMIT 1",
    )
    .bind(post)
    .bind(facts.version_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(row) = row else { return Ok(false) };
    if row.try_get::<String, _>("decision")? != "approved"
        || row.try_get::<Option<String>, _>("content_hash")?.as_deref()
            != Some(facts.content_hash.as_str())
    {
        return Ok(false);
    }
    if second_approver_required(tx, tenant).await? {
        let reviewer: Option<Uuid> = row.try_get("reviewer_id")?;
        if reviewer.is_none()
            || reviewer == facts.created_by
            || reviewer == facts.review_requested_by
        {
            return Ok(false);
        }
    }
    Ok(true)
}

/// The time an approved post goes out: its planned time, or a minute from now if that passed.
fn due(when: Option<DateTime<Utc>>) -> DateTime<Utc> {
    let soon = Utc::now() + Duration::minutes(1);
    match when {
        Some(at) if at > soon => at,
        _ => soon,
    }
}

async fn set_state(
    tx: &mut Tx,
    post: Uuid,
    state: &str,
    when: Option<DateTime<Utc>>,
) -> Result<(), ApiError> {
    sqlx::query(
        "UPDATE posts SET state=$2::post_state,scheduled_for=COALESCE($3,scheduled_for),updated_at=now() WHERE id=$1",
    )
    .bind(post)
    .bind(state)
    .bind(when)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn actor_name(tx: &mut Tx, ctx: &TenantContext) -> Result<String, ApiError> {
    let name: Option<String> = sqlx::query_scalar("SELECT display_name FROM users WHERE id=$1")
        .bind(ctx.actor_id)
        .fetch_optional(&mut **tx)
        .await?
        .flatten();
    Ok(name.unwrap_or_else(|| "a reviewer".into()))
}

fn parse_id(id: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(id).map_err(|_| ApiError::NotFound)
}

fn step(state: &str, action: PostAction) -> Result<&'static str, ApiError> {
    domain::next_state(state, action).ok_or(ApiError::Conflict)
}

// ---------------------------------------------------------------- routes

/// Posts waiting for approval, soonest to go out first.
async fn list_approvals(
    State(s): State<AppState>,
    ctx: TenantContext,
) -> Result<Json<Value>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let data = content::posts_where(
        &mut tx,
        "p.state='in_review'",
        "p.scheduled_for NULLS LAST, p.review_requested_at, p.id",
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": data })))
}

async fn approve(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ctx.require(DECIDERS)?;
    let id = parse_id(&id)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let facts = lock(&mut tx, id).await?;
    step(&facts.state, PostAction::Approve)?;
    if !may_approve(&mut tx, &ctx, &facts).await? {
        return Err(ApiError::Forbidden);
    }
    record(&mut tx, &ctx, id, &facts, "approved", None).await?;
    set_state(&mut tx, id, "scheduled", Some(due(facts.scheduled_for))).await?;
    let name = actor_name(&mut tx, &ctx).await?;
    content::log(&mut tx, &ctx, id, &format!("Approved by {name}")).await?;
    let post = content::post_out(&mut tx, id).await?;
    tx.commit().await?;
    Ok(Json(
        json!({ "data": { "decision": "approve", "postId": id, "post": post } }),
    ))
}

#[derive(Deserialize)]
struct ChangesInput {
    note: String,
}

/// Sends the post back to Drafts with a note. The words stay as they were.
async fn request_changes(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
    Json(input): Json<ChangesInput>,
) -> Result<Json<Value>, ApiError> {
    ctx.require(DECIDERS)?;
    let note = input.note.trim();
    if note.is_empty() || note.len() > 2000 {
        return Err(ApiError::InvalidInput);
    }
    let id = parse_id(&id)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let facts = lock(&mut tx, id).await?;
    let next = step(&facts.state, PostAction::RequestChanges)?;
    record(&mut tx, &ctx, id, &facts, "changes_requested", Some(note)).await?;
    set_state(&mut tx, id, next, None).await?;
    content::log(&mut tx, &ctx, id, "Changes requested").await?;
    outbox::enqueue(
        &mut tx,
        ctx.tenant_id,
        "post.changes_requested",
        json!({ "post_id": id, "actor_id": ctx.actor_id }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({ "data": { "decision": "changes", "postId": id, "draftId": id } }),
    ))
}

/// Turns the post down without a note; it goes back to Drafts.
async fn reject(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ctx.require(DECIDERS)?;
    let id = parse_id(&id)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let facts = lock(&mut tx, id).await?;
    let next = step(&facts.state, PostAction::Reject)?;
    record(&mut tx, &ctx, id, &facts, "rejected", None).await?;
    set_state(&mut tx, id, next, None).await?;
    content::log(&mut tx, &ctx, id, "Rejected").await?;
    tx.commit().await?;
    Ok(Json(
        json!({ "data": { "decision": "reject", "postId": id, "draftId": id } }),
    ))
}

/// Puts the post back to waiting for approval, as it was before the last decision. Only
/// within a few minutes, only while the words are unchanged and nothing has gone out.
async fn undo_decision(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ctx.require(DECIDERS)?;
    let id = parse_id(&id)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let facts = lock(&mut tx, id).await?;
    let next = step(&facts.state, PostAction::Undo)?;
    let last = sqlx::query(
        "SELECT decision::text AS decision,post_version_id,decided_at FROM approvals
         WHERE post_id=$1 ORDER BY decided_at DESC, id DESC LIMIT 1",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::Conflict)?;
    let decision: String = last.try_get("decision")?;
    let version: Uuid = last.try_get("post_version_id")?;
    let at: DateTime<Utc> = last.try_get("decided_at")?;
    if !["approved", "changes_requested", "rejected"].contains(&decision.as_str())
        || version != facts.version_id
        || Utc::now() - at > Duration::minutes(UNDO_WINDOW_MINUTES)
    {
        return Err(ApiError::Conflict);
    }
    record(&mut tx, &ctx, id, &facts, "undone", None).await?;
    set_state(&mut tx, id, next, None).await?;
    content::log(&mut tx, &ctx, id, "Decision undone").await?;
    let post = content::post_out(&mut tx, id).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": post })))
}

/// The sender (or a decider) takes an approval request back to Drafts.
async fn withdraw(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = parse_id(&id)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let facts = lock(&mut tx, id).await?;
    let own =
        facts.created_by == Some(ctx.actor_id) || facts.review_requested_by == Some(ctx.actor_id);
    if !own && ctx.require(DECIDERS).is_err() {
        return Err(ApiError::Forbidden);
    }
    let next = step(&facts.state, PostAction::Withdraw)?;
    set_state(&mut tx, id, next, None).await?;
    content::log(&mut tx, &ctx, id, "Request withdrawn").await?;
    audit::record(&mut tx, &ctx, "post_withdrawn", "post", id, json!({})).await?;
    let draft = content::draft_out(&mut tx, id).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": draft })))
}

/// Tries a failed post again, only with the version that was approved.
async fn retry(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ctx.require(DECIDERS)?;
    let id = parse_id(&id)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let facts = lock(&mut tx, id).await?;
    let next = step(&facts.state, PostAction::Retry)?;
    if !is_approved(&mut tx, ctx.tenant_id, id, &facts).await? {
        return Err(ApiError::Conflict);
    }
    set_state(&mut tx, id, next, Some(due(None))).await?;
    content::log(&mut tx, &ctx, id, "Retry requested").await?;
    audit::record(
        &mut tx,
        &ctx,
        "post_retry",
        "post",
        id,
        json!({ "post_version_id": facts.version_id }),
    )
    .await?;
    let post = content::post_out(&mut tx, id).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": post })))
}

/// Pausing and resuming posts belongs to safe publishing (Phase 7).
async fn set_post_state() -> ApiError {
    ApiError::NotAvailable
}

/// Asks for the post to go out now. Rechecks the approval right before queuing.
async fn publish(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ctx.require(DECIDERS)?;
    let id = parse_id(&id)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let facts = lock(&mut tx, id).await?;
    if facts.state != "publishing" {
        step(&facts.state, PostAction::BeginPublish)?;
    }
    if !is_approved(&mut tx, ctx.tenant_id, id, &facts).await? {
        return Err(ApiError::Conflict);
    }
    let key = domain::publish_idempotency_key(ctx.tenant_id, id, facts.version_id);
    let inserted: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO publish_attempts(tenant_id,post_id,post_version_id,channel_id,idempotency_key,state)
         VALUES($1,$2,$3,(SELECT channel_id FROM posts WHERE id=$2),$4,'queued')
         ON CONFLICT(tenant_id,idempotency_key) DO NOTHING RETURNING id",
    )
    .bind(ctx.tenant_id)
    .bind(id)
    .bind(facts.version_id)
    .bind(&key)
    .fetch_optional(&mut *tx)
    .await?;
    let attempt = match inserted {
        Some(attempt) => {
            audit::record(
                &mut tx,
                &ctx,
                "publish_requested",
                "post",
                id,
                json!({ "post_version_id": facts.version_id, "attempt_id": attempt, "content_hash": facts.content_hash }),
            )
            .await?;
            set_state(&mut tx, id, "publishing", None).await?;
            outbox::enqueue(
                &mut tx,
                ctx.tenant_id,
                "post.publish",
                json!({"attempt_id": attempt, "post_id": id}),
            )
            .await?;
            attempt
        }
        None => {
            sqlx::query_scalar("SELECT id FROM publish_attempts WHERE idempotency_key=$1")
                .bind(&key)
                .fetch_one(&mut *tx)
                .await?
        }
    };
    let attempt_state: String =
        sqlx::query_scalar("SELECT state::text FROM publish_attempts WHERE id=$1")
            .bind(attempt)
            .fetch_one(&mut *tx)
            .await?;
    tx.commit().await?;
    Ok(Json(json!({
        "data": { "id": attempt, "postId": id, "postVersionId": facts.version_id, "state": attempt_state }
    })))
}

/// Cancels a post that hasn't gone out.
async fn cancel(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ctx.require(DECIDERS)?;
    let id = parse_id(&id)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let facts = lock(&mut tx, id).await?;
    let next = step(&facts.state, PostAction::Cancel)?;
    set_state(&mut tx, id, next, None).await?;
    content::log(&mut tx, &ctx, id, "Canceled").await?;
    audit::record(
        &mut tx,
        &ctx,
        "post_canceled",
        "post",
        id,
        json!({ "title": facts.title }),
    )
    .await?;
    outbox::enqueue(
        &mut tx,
        ctx.tenant_id,
        "post.canceled",
        json!({ "post_id": id, "actor_id": ctx.actor_id }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({ "data": { "postId": id, "state": "canceled" } }),
    ))
}

async fn workspace_json(tx: &mut Tx, tenant: Uuid) -> Result<Value, ApiError> {
    let row = sqlx::query("SELECT require_second_approver,timezone FROM tenants WHERE id=$1")
        .bind(tenant)
        .fetch_one(&mut **tx)
        .await?;
    Ok(json!({
        "requireSecondApprover": row.try_get::<bool, _>("require_second_approver")?,
        "timezone": row.try_get::<String, _>("timezone")?,
    }))
}

async fn get_workspace(
    State(s): State<AppState>,
    ctx: TenantContext,
) -> Result<Json<Value>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let out = workspace_json(&mut tx, ctx.tenant_id).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": out })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceInput {
    require_second_approver: Option<bool>,
    timezone: Option<String>,
}

/// Owners set the approval rule and the workspace's timezone.
async fn update_workspace(
    State(s): State<AppState>,
    ctx: TenantContext,
    Json(input): Json<WorkspaceInput>,
) -> Result<Json<Value>, ApiError> {
    ctx.require(OWNERS)?;
    if let Some(zone) = &input.timezone {
        zone.parse::<chrono_tz::Tz>()
            .map_err(|_| ApiError::InvalidInput)?;
    }
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    sqlx::query(
        "UPDATE tenants SET require_second_approver=COALESCE($2,require_second_approver),
           timezone=COALESCE($3,timezone),updated_at=now() WHERE id=$1",
    )
    .bind(ctx.tenant_id)
    .bind(input.require_second_approver)
    .bind(&input.timezone)
    .execute(&mut *tx)
    .await?;
    let out = workspace_json(&mut tx, ctx.tenant_id).await?;
    audit::record(
        &mut tx,
        &ctx,
        "workspace_settings_changed",
        "tenant",
        ctx.tenant_id,
        out.clone(),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": out })))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/settings/workspace",
            get(get_workspace).patch(update_workspace),
        )
        .route("/approvals", get(list_approvals))
        .route("/posts/:post_id/approve", post(approve))
        .route("/posts/:post_id/request-changes", post(request_changes))
        .route("/posts/:post_id/reject", post(reject))
        .route("/posts/:post_id/undo-decision", post(undo_decision))
        .route("/posts/:post_id/withdraw", post(withdraw))
        .route("/posts/:post_id/retry", post(retry))
        .route("/posts/:post_id/state", post(set_post_state))
        .route("/posts/:post_id/publish", post(publish))
        .route("/posts/:post_id/cancel", post(cancel))
}
