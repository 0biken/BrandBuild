//! Drafts and posts (docs/api/openapi.yaml, tag `content`), plus the small read-only
//! calls Home needs before connections and analytics are real.
//!
//! Drafts and posts share the `posts` table: a draft is a row in `draft` or
//! `changes_requested`. The words live in `post_versions.content`; every edit adds a version.
use std::collections::HashMap;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{
    api::ApiError,
    approvals, audit,
    auth::{TenantContext, DECIDERS},
    db::tenant_tx,
    domain::{self, PostAction},
    media, notifications, AppState,
};

type Tx = Transaction<'static, Postgres>;

const PLATFORMS: [&str; 4] = ["ig", "li", "tt", "fb"];
const IS_DRAFT: &str = "p.state IN ('draft','changes_requested')";
const IS_POST: &str = "p.state NOT IN ('draft','changes_requested','canceled')";
const DRAFT_ORDER: &str = "p.created_at DESC, p.id DESC";
const POST_ORDER: &str = "p.scheduled_for NULLS LAST, p.created_at DESC";
const SELECT: &str = "SELECT p.id,p.title,p.platforms,p.state::text AS state,p.draft_state,p.scheduled_for,p.updated_at,p.review_requested_at,p.current_version,p.created_by,v.content,u.display_name AS requester,
  (SELECT a.comment FROM approvals a WHERE a.tenant_id=p.tenant_id AND a.post_id=p.id AND a.decision='changes_requested' ORDER BY a.decided_at DESC LIMIT 1) AS feedback
  FROM posts p
  JOIN post_versions v ON v.tenant_id=p.tenant_id AND v.post_id=p.id AND v.version=p.current_version
  LEFT JOIN users u ON u.id=p.review_requested_by
  WHERE p.deleted_at IS NULL AND ";

#[derive(sqlx::FromRow)]
struct PostRow {
    id: Uuid,
    title: String,
    platforms: Vec<String>,
    state: String,
    draft_state: String,
    scheduled_for: Option<DateTime<Utc>>,
    updated_at: DateTime<Utc>,
    review_requested_at: Option<DateTime<Utc>>,
    current_version: i32,
    created_by: Option<Uuid>,
    content: Value,
    requester: Option<String>,
    feedback: Option<String>,
}

impl PostRow {
    fn caption(&self) -> &str {
        self.content["caption"].as_str().unwrap_or("")
    }
    fn media_ids(&self) -> Vec<Uuid> {
        media_ids(&self.content)
    }
}

fn media_ids(content: &Value) -> Vec<Uuid> {
    content["media"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().and_then(|s| Uuid::parse_str(s).ok()))
                .collect()
        })
        .unwrap_or_default()
}

/// The contract's public state for a database state.
fn public_state(state: &str) -> &'static str {
    match state {
        "in_review" => "approval",
        "approved" | "scheduled" => "scheduled",
        "publishing" | "reconciling" => "checking",
        "published" => "published",
        _ => "failed",
    }
}

fn parse_id(id: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(id).map_err(|_| ApiError::NotFound)
}

fn check_platforms(platforms: &[String]) -> Result<(), ApiError> {
    if platforms.iter().all(|p| PLATFORMS.contains(&p.as_str())) {
        Ok(())
    } else {
        Err(ApiError::InvalidInput)
    }
}

async fn many(tx: &mut Tx, filter: &str, order: &str) -> Result<Vec<PostRow>, ApiError> {
    Ok(
        sqlx::query_as::<_, PostRow>(&format!("{SELECT}{filter} ORDER BY {order}"))
            .fetch_all(&mut **tx)
            .await?,
    )
}

/// One row, locked for the rest of the transaction.
async fn one(tx: &mut Tx, filter: &str, id: Uuid) -> Result<PostRow, ApiError> {
    sqlx::query_as::<_, PostRow>(&format!("{SELECT}{filter} AND p.id=$1 FOR UPDATE OF p"))
        .bind(id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(ApiError::NotFound)
}

async fn media_for(tx: &mut Tx, rows: &[PostRow]) -> Result<HashMap<Uuid, Value>, ApiError> {
    let ids: Vec<Uuid> = rows.iter().flat_map(PostRow::media_ids).collect();
    media::load_refs(tx, &ids).await
}

fn media_list(row: &PostRow, refs: &HashMap<Uuid, Value>) -> Vec<Value> {
    row.media_ids()
        .iter()
        .filter_map(|id| refs.get(id).cloned())
        .collect()
}

fn draft_json(row: &PostRow, refs: &HashMap<Uuid, Value>) -> Value {
    let mut out = json!({
        "id": row.id,
        "title": row.title,
        "body": row.caption(),
        "state": row.draft_state,
        "platforms": row.platforms,
        "updatedAt": row.updated_at.to_rfc3339(),
        "media": media_list(row, refs),
    });
    if row.state == "changes_requested" {
        if let Some(feedback) = &row.feedback {
            out["feedback"] = json!(feedback);
        }
    }
    if let Some(when) = row.scheduled_for {
        out["scheduledAt"] = json!(when.to_rfc3339());
    }
    if let Some(source) = row.content.get("source").filter(|v| !v.is_null()) {
        out["source"] = source.clone();
    }
    out
}

fn post_json(row: &PostRow, refs: &HashMap<Uuid, Value>, activity: Vec<Value>) -> Value {
    let mut out = json!({
        "id": row.id,
        "title": row.title,
        "caption": row.caption(),
        "hashtags": row.content.get("hashtags").cloned().unwrap_or_else(|| json!([])),
        "aspectRatio": row.content["aspectRatio"].as_str().unwrap_or("1 / 1"),
        "state": public_state(&row.state),
        "platforms": row.platforms,
        "activity": activity,
        "media": media_list(row, refs),
    });
    if let Some(when) = row.scheduled_for {
        out["scheduledAt"] = json!(when.to_rfc3339());
    }
    if row.state == "in_review" {
        if let Some(name) = &row.requester {
            out["requestedBy"] = json!({ "name": name });
        }
        if let Some(at) = row.review_requested_at {
            out["requestedAt"] = json!(at.to_rfc3339());
        }
    }
    out
}

async fn activity_for(tx: &mut Tx, ids: &[Uuid]) -> Result<HashMap<Uuid, Vec<Value>>, ApiError> {
    let rows = sqlx::query(
        "SELECT post_id,text,at FROM post_activity WHERE post_id=ANY($1) ORDER BY at DESC, id",
    )
    .bind(ids)
    .fetch_all(&mut **tx)
    .await?;
    let mut out: HashMap<Uuid, Vec<Value>> = HashMap::new();
    for row in rows {
        out.entry(row.try_get("post_id")?).or_default().push(json!({
            "text": row.try_get::<String, _>("text")?,
            "at": row.try_get::<DateTime<Utc>, _>("at")?.to_rfc3339(),
        }));
    }
    Ok(out)
}

pub(crate) async fn log(
    tx: &mut Tx,
    ctx: &TenantContext,
    post: Uuid,
    text: &str,
) -> Result<(), ApiError> {
    sqlx::query("INSERT INTO post_activity(tenant_id,post_id,actor_id,text,at) VALUES($1,$2,$3,$4,clock_timestamp())")
        .bind(ctx.tenant_id)
        .bind(post)
        .bind(ctx.actor_id)
        .bind(text)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Version tag of the stored content format.
pub const CONTENT_SCHEMA: &str = "social_content.v1";

/// The stored shape of a post's words (`post_versions.content`). Unknown fields are
/// refused, so nothing unreviewed can ride along inside an approved version.
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SocialContent {
    pub schema: String,
    pub caption: String,
    pub hashtags: Vec<String>,
    pub aspect_ratio: String,
    /// Media ids, in order.
    pub media: Vec<Uuid>,
    /// sha256 of each media file, in the same order, so the approved file is the one sent.
    #[serde(default)]
    pub media_sha256: Vec<Option<String>>,
    /// Where an AI draft came from: model, prompt version, cited facts, warnings.
    #[serde(default)]
    pub source: Option<Value>,
    /// Alt text for the media, when known.
    #[serde(default)]
    pub alt_text: Option<String>,
}

/// Checks content against `social_content.v1`.
pub fn check_content(content: &Value) -> Result<(), ApiError> {
    let parsed: SocialContent =
        serde_json::from_value(content.clone()).map_err(|_| ApiError::InvalidInput)?;
    let ok = parsed.schema == CONTENT_SCHEMA
        && parsed.caption.chars().count() <= 63_206
        && parsed.hashtags.len() <= 30
        && parsed.hashtags.iter().all(|h| h.chars().count() <= 100)
        && parsed.media.len() <= 10
        && parsed.aspect_ratio.len() <= 16
        && parsed
            .alt_text
            .as_ref()
            .is_none_or(|t| t.chars().count() <= 1000);
    if ok {
        Ok(())
    } else {
        Err(ApiError::InvalidInput)
    }
}

/// Builds `social_content.v1` content, recording each media file's hash.
pub(crate) async fn build_content(
    tx: &mut Tx,
    caption: &str,
    hashtags: &[String],
    aspect_ratio: &str,
    media: &[Uuid],
) -> Result<Value, ApiError> {
    let hashes = media::hashes(tx, media).await?;
    let content = json!({
        "schema": CONTENT_SCHEMA,
        "caption": caption,
        "hashtags": hashtags,
        "aspectRatio": aspect_ratio,
        "media": media,
        "mediaSha256": hashes,
    });
    check_content(&content)?;
    Ok(content)
}

/// Adds an immutable version and returns its id.
pub(crate) async fn add_version(
    tx: &mut Tx,
    ctx: &TenantContext,
    post: Uuid,
    version: i32,
    content: &Value,
) -> Result<Uuid, ApiError> {
    Ok(sqlx::query_scalar(
        "INSERT INTO post_versions(tenant_id,post_id,version,content,created_by,content_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
    )
    .bind(ctx.tenant_id)
    .bind(post)
    .bind(version)
    .bind(content)
    .bind(ctx.actor_id)
    .bind(domain::content_hash(content))
    .fetch_one(&mut **tx)
    .await?)
}

#[derive(Deserialize)]
struct MediaIn {
    id: String,
}

/// Turns the media list a client sent into ids, refusing files this workspace doesn't have.
async fn resolve_media(tx: &mut Tx, media: &[MediaIn]) -> Result<Vec<Uuid>, ApiError> {
    let ids = media
        .iter()
        .map(|m| Uuid::parse_str(&m.id).map_err(|_| ApiError::InvalidInput))
        .collect::<Result<Vec<_>, _>>()?;
    media::check_ids(tx, &ids).await?;
    Ok(ids)
}

pub(crate) async fn draft_out(tx: &mut Tx, id: Uuid) -> Result<Value, ApiError> {
    let row = one(tx, IS_DRAFT, id).await?;
    let refs = media_for(tx, std::slice::from_ref(&row)).await?;
    Ok(draft_json(&row, &refs))
}

pub(crate) async fn post_out(tx: &mut Tx, id: Uuid) -> Result<Value, ApiError> {
    let row = one(tx, IS_POST, id).await?;
    let refs = media_for(tx, std::slice::from_ref(&row)).await?;
    let mut activity = activity_for(tx, &[row.id]).await?;
    Ok(post_json(
        &row,
        &refs,
        activity.remove(&row.id).unwrap_or_default(),
    ))
}

/// Posts matching `filter` (SQL over `p`), as the contract's Post objects.
pub(crate) async fn posts_where(
    tx: &mut Tx,
    filter: &str,
    order: &str,
) -> Result<Vec<Value>, ApiError> {
    let rows = many(tx, &format!("{IS_POST} AND {filter}"), order).await?;
    let refs = media_for(tx, &rows).await?;
    let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
    let mut activity = activity_for(tx, &ids).await?;
    Ok(rows
        .iter()
        .map(|row| post_json(row, &refs, activity.remove(&row.id).unwrap_or_default()))
        .collect())
}

// ---------------------------------------------------------------- drafts

async fn list_drafts(
    State(s): State<AppState>,
    ctx: TenantContext,
) -> Result<Json<Value>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let rows = many(&mut tx, IS_DRAFT, DRAFT_ORDER).await?;
    let refs = media_for(&mut tx, &rows).await?;
    tx.commit().await?;
    let data: Vec<Value> = rows.iter().map(|row| draft_json(row, &refs)).collect();
    Ok(Json(json!({ "data": data })))
}

#[derive(Deserialize)]
struct DraftInput {
    title: Option<String>,
    body: Option<String>,
    state: Option<String>,
    platforms: Option<Vec<String>>,
    media: Option<Vec<MediaIn>>,
}

fn check_draft_state(state: &str) -> Result<(), ApiError> {
    if ["ready", "needs_photo", "idea"].contains(&state) {
        Ok(())
    } else {
        Err(ApiError::InvalidInput)
    }
}

async fn create_draft(
    State(s): State<AppState>,
    ctx: TenantContext,
    Json(input): Json<DraftInput>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let platforms = input.platforms.unwrap_or_default();
    check_platforms(&platforms)?;
    let state = input.state.unwrap_or_else(|| "idea".into());
    check_draft_state(&state)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let media = resolve_media(&mut tx, &input.media.unwrap_or_default()).await?;
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO posts(tenant_id,title,platforms,draft_state,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id",
    )
    .bind(ctx.tenant_id)
    .bind(input.title.unwrap_or_default())
    .bind(&platforms)
    .bind(&state)
    .bind(ctx.actor_id)
    .fetch_one(&mut *tx)
    .await?;
    let content = build_content(
        &mut tx,
        &input.body.unwrap_or_default(),
        &[],
        "1 / 1",
        &media,
    )
    .await?;
    add_version(&mut tx, &ctx, id, 1, &content).await?;
    let out = draft_out(&mut tx, id).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({ "data": out }))))
}

async fn get_draft(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let out = draft_out(&mut tx, parse_id(&id)?).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": out })))
}

async fn update_draft(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
    Json(input): Json<DraftInput>,
) -> Result<Json<Value>, ApiError> {
    let id = parse_id(&id)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let row = one(&mut tx, IS_DRAFT, id).await?;
    let platforms = input.platforms.unwrap_or_else(|| row.platforms.clone());
    check_platforms(&platforms)?;
    let state = input.state.unwrap_or_else(|| row.draft_state.clone());
    check_draft_state(&state)?;
    let media = match &input.media {
        Some(media) => resolve_media(&mut tx, media).await?,
        None => row.media_ids(),
    };
    let hashtags: Vec<String> =
        serde_json::from_value(row.content["hashtags"].clone()).unwrap_or_default();
    let mut content = build_content(
        &mut tx,
        input.body.as_deref().unwrap_or(row.caption()),
        &hashtags,
        row.content["aspectRatio"].as_str().unwrap_or("1 / 1"),
        &media,
    )
    .await?;
    if let Some(source) = row.content.get("source").filter(|v| !v.is_null()) {
        content["source"] = source.clone();
    }
    let mut version = row.current_version;
    if content != row.content {
        version += 1;
        add_version(&mut tx, &ctx, id, version, &content).await?;
    }
    sqlx::query(
        "UPDATE posts SET title=$2,platforms=$3,draft_state=$4,current_version=$5,updated_at=now() WHERE id=$1",
    )
    .bind(id)
    .bind(input.title.unwrap_or_else(|| row.title.clone()))
    .bind(&platforms)
    .bind(&state)
    .bind(version)
    .execute(&mut *tx)
    .await?;
    let out = draft_out(&mut tx, id).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": out })))
}

/// A draft saved under an idempotency key (batch saves, AI plans).
pub(crate) struct NewDraft {
    pub key: String,
    pub title: String,
    pub platforms: Vec<String>,
    pub draft_state: String,
    pub scheduled_for: Option<DateTime<Utc>>,
    /// Already-built `social_content.v1` content.
    pub content: Value,
}

/// Saves a draft once per key. The same key with the same request returns the draft
/// saved the first time; the same key with a different request is a conflict.
pub(crate) async fn save_keyed_draft(
    tx: &mut Tx,
    ctx: &TenantContext,
    d: &NewDraft,
) -> Result<Uuid, ApiError> {
    check_platforms(&d.platforms)?;
    check_draft_state(&d.draft_state)?;
    check_content(&d.content)?;
    if d.key.is_empty() || d.key.len() > 200 || d.title.chars().count() > 200 {
        return Err(ApiError::InvalidInput);
    }
    let request_hash = domain::content_hash(&json!({
        "title": d.title, "platforms": d.platforms, "draftState": d.draft_state,
        "scheduledFor": d.scheduled_for, "content": d.content,
    }));
    let seen: Option<(Uuid, String)> =
        sqlx::query_as("SELECT post_id,request_hash FROM draft_keys WHERE key=$1 FOR UPDATE")
            .bind(&d.key)
            .fetch_optional(&mut **tx)
            .await?;
    if let Some((post, hash)) = seen {
        return if hash == request_hash {
            Ok(post)
        } else {
            Err(ApiError::Conflict)
        };
    }
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO posts(tenant_id,title,platforms,draft_state,scheduled_for,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
    )
    .bind(ctx.tenant_id)
    .bind(&d.title)
    .bind(&d.platforms)
    .bind(&d.draft_state)
    .bind(d.scheduled_for)
    .bind(ctx.actor_id)
    .fetch_one(&mut **tx)
    .await?;
    add_version(tx, ctx, id, 1, &d.content).await?;
    sqlx::query("INSERT INTO draft_keys(tenant_id,key,post_id,request_hash) VALUES($1,$2,$3,$4)")
        .bind(ctx.tenant_id)
        .bind(&d.key)
        .bind(id)
        .bind(&request_hash)
        .execute(&mut **tx)
        .await?;
    Ok(id)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchItem {
    key: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    hashtags: Vec<String>,
    #[serde(default)]
    platforms: Vec<String>,
    state: Option<String>,
    scheduled_at: Option<DateTime<Utc>>,
    #[serde(default)]
    media: Vec<MediaIn>,
}

#[derive(Deserialize)]
struct BatchInput {
    items: Vec<BatchItem>,
}

/// Saves 1 to 100 drafts in one transaction, each under its own key, so a retried
/// request never makes duplicates. All or nothing.
async fn batch_drafts(
    State(s): State<AppState>,
    ctx: TenantContext,
    Json(input): Json<BatchInput>,
) -> Result<Json<Value>, ApiError> {
    if input.items.is_empty() || input.items.len() > 100 {
        return Err(ApiError::InvalidInput);
    }
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let mut ids = Vec::new();
    for item in &input.items {
        let media = resolve_media(&mut tx, &item.media).await?;
        let content = build_content(&mut tx, &item.body, &item.hashtags, "1 / 1", &media).await?;
        let draft = NewDraft {
            key: item.key.clone(),
            title: item.title.clone(),
            platforms: item.platforms.clone(),
            draft_state: item.state.clone().unwrap_or_else(|| "ready".into()),
            scheduled_for: item.scheduled_at,
            content,
        };
        ids.push(save_keyed_draft(&mut tx, &ctx, &draft).await?);
    }
    let mut data = Vec::new();
    for id in ids {
        data.push(draft_out(&mut tx, id).await?);
    }
    tx.commit().await?;
    Ok(Json(json!({ "data": data })))
}

/// Hides the draft and reports where it sat in the list, so Undo can put it back.
async fn delete_draft(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = parse_id(&id)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    one(&mut tx, IS_DRAFT, id).await?;
    let index: i64 = sqlx::query_scalar(&format!(
        "SELECT count(*) FROM posts p, (SELECT created_at,id FROM posts WHERE id=$1) t
         WHERE p.deleted_at IS NULL AND {IS_DRAFT} AND (p.created_at,p.id) > (t.created_at,t.id)"
    ))
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("UPDATE posts SET deleted_at=now() WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": { "index": index } })))
}

async fn restore_draft(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = parse_id(&id)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let restored = sqlx::query(
        "UPDATE posts SET deleted_at=NULL WHERE id=$1 AND deleted_at IS NOT NULL AND state IN ('draft','changes_requested')",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if restored == 0 {
        return Err(ApiError::NotFound);
    }
    let out = draft_out(&mut tx, id).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": out })))
}

// ----------------------------------------------------------------- posts

async fn list_posts(
    State(s): State<AppState>,
    ctx: TenantContext,
) -> Result<Json<Value>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let rows = many(&mut tx, IS_POST, POST_ORDER).await?;
    let refs = media_for(&mut tx, &rows).await?;
    let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
    let mut activity = activity_for(&mut tx, &ids).await?;
    tx.commit().await?;
    let data: Vec<Value> = rows
        .iter()
        .map(|row| post_json(row, &refs, activity.remove(&row.id).unwrap_or_default()))
        .collect();
    Ok(Json(json!({ "data": data })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PostInput {
    title: String,
    caption: String,
    #[serde(default)]
    hashtags: Vec<String>,
    platforms: Vec<String>,
    scheduled_at: Option<DateTime<Utc>>,
    intent: String,
    aspect_ratio: Option<String>,
    media: Option<Vec<MediaIn>>,
}

/// What a composer submission asks for.
struct Want {
    /// Go straight to the schedule (the sender approves it themself, when allowed).
    schedule: bool,
    when: Option<DateTime<Utc>>,
    activity: &'static str,
}

/// Sending for approval is open to every member; scheduling and publishing are an owner's
/// or reviewer's call, and even then only through an approval recorded for this version.
fn wants(input: &PostInput, ctx: &TenantContext) -> Result<Want, ApiError> {
    match input.intent.as_str() {
        "approval" => Ok(Want {
            schedule: false,
            when: input.scheduled_at,
            activity: "Sent for approval",
        }),
        "schedule" => {
            ctx.require(DECIDERS)?;
            Ok(Want {
                schedule: true,
                when: Some(input.scheduled_at.ok_or(ApiError::InvalidInput)?),
                activity: "Scheduled",
            })
        }
        // Publishing itself arrives in Phase 7; until then "now" is a schedule for this moment.
        "publish" => {
            ctx.require(DECIDERS)?;
            Ok(Want {
                schedule: true,
                when: Some(Utc::now()),
                activity: "Queued to publish",
            })
        }
        _ => Err(ApiError::InvalidInput),
    }
}

fn check_post(input: &PostInput) -> Result<(), ApiError> {
    check_platforms(&input.platforms)?;
    if input.platforms.is_empty()
        || (input.title.trim().is_empty() && input.caption.trim().is_empty())
    {
        return Err(ApiError::InvalidInput);
    }
    Ok(())
}

/// Tells owners and reviewers (other than the sender) that a post is waiting for them.
async fn notify_approval(
    tx: &mut Tx,
    ctx: &TenantContext,
    post: Uuid,
    title: &str,
) -> Result<(), ApiError> {
    let sender: Option<String> = sqlx::query_scalar("SELECT display_name FROM users WHERE id=$1")
        .bind(ctx.actor_id)
        .fetch_optional(&mut **tx)
        .await?
        .flatten();
    let to = notifications::deciders(tx, ctx, true).await?;
    notifications::notify(
        tx,
        ctx.tenant_id,
        &to,
        "approval",
        &format!("{title} needs your approval"),
        &format!("Sent by {}.", sender.as_deref().unwrap_or("a teammate")),
        &format!("/app/approvals?post={post}"),
    )
    .await
}

/// Puts a post that is waiting for review (state `in_review`) where the sender asked:
/// scheduled under the sender's own recorded approval when the workspace allows it,
/// otherwise waiting for someone else.
async fn settle(
    tx: &mut Tx,
    ctx: &TenantContext,
    post: Uuid,
    want: &Want,
    already_waiting: bool,
) -> Result<(), ApiError> {
    let facts = approvals::lock(tx, post).await?;
    if want.schedule && approvals::may_approve(tx, ctx, &facts).await? {
        approvals::record(tx, ctx, post, &facts, "approved", None).await?;
        sqlx::query("UPDATE posts SET state='scheduled',updated_at=now() WHERE id=$1")
            .bind(post)
            .execute(&mut **tx)
            .await?;
        return log(tx, ctx, post, want.activity).await;
    }
    if !already_waiting {
        sqlx::query(
            "UPDATE posts SET review_requested_by=$2,review_requested_at=now(),updated_at=now() WHERE id=$1",
        )
        .bind(post)
        .bind(ctx.actor_id)
        .execute(&mut **tx)
        .await?;
        log(tx, ctx, post, "Sent for approval").await?;
        notify_approval(tx, ctx, post, &facts.title).await?;
    }
    Ok(())
}

async fn create_post(
    State(s): State<AppState>,
    ctx: TenantContext,
    Json(input): Json<PostInput>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    check_post(&input)?;
    let want = wants(&input, &ctx)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let media = resolve_media(&mut tx, input.media.as_deref().unwrap_or_default()).await?;
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO posts(tenant_id,title,platforms,draft_state,state,scheduled_for,created_by)
         VALUES($1,$2,$3,'ready','in_review',$4,$5) RETURNING id",
    )
    .bind(ctx.tenant_id)
    .bind(&input.title)
    .bind(&input.platforms)
    .bind(want.when)
    .bind(ctx.actor_id)
    .fetch_one(&mut *tx)
    .await?;
    let content = build_content(
        &mut tx,
        &input.caption,
        &input.hashtags,
        input.aspect_ratio.as_deref().unwrap_or("1 / 1"),
        &media,
    )
    .await?;
    add_version(&mut tx, &ctx, id, 1, &content).await?;
    audit::record(
        &mut tx,
        &ctx,
        "post_created",
        "post",
        id,
        json!({ "intent": input.intent }),
    )
    .await?;
    settle(&mut tx, &ctx, id, &want, false).await?;
    let out = post_out(&mut tx, id).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({ "data": out }))))
}

async fn get_post(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let out = post_out(&mut tx, parse_id(&id)?).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": out })))
}

/// Saves edits as a new version. Any edit to a post that was approved, scheduled or failed
/// sends it back for review; a decider may re-approve it in the same call when allowed.
/// Posts that already went out, or are going out, can't change.
async fn update_post(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
    Json(input): Json<PostInput>,
) -> Result<Json<Value>, ApiError> {
    let id = parse_id(&id)?;
    check_post(&input)?;
    let want = wants(&input, &ctx)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let row = one(&mut tx, IS_POST, id).await?;
    may_manage(&ctx, &row)?;
    domain::next_state(&row.state, PostAction::Edit).ok_or(ApiError::Conflict)?;
    let media = match &input.media {
        Some(media) => resolve_media(&mut tx, media).await?,
        None => row.media_ids(),
    };
    let mut content = build_content(
        &mut tx,
        &input.caption,
        &input.hashtags,
        input
            .aspect_ratio
            .as_deref()
            .unwrap_or_else(|| row.content["aspectRatio"].as_str().unwrap_or("1 / 1")),
        &media,
    )
    .await?;
    if let Some(source) = row.content.get("source").filter(|v| !v.is_null()) {
        content["source"] = source.clone();
    }
    let mut version = row.current_version;
    if content != row.content {
        version += 1;
        add_version(&mut tx, &ctx, id, version, &content).await?;
    }
    sqlx::query(
        "UPDATE posts SET title=$2,platforms=$3,state='in_review',scheduled_for=$4,current_version=$5,updated_at=now() WHERE id=$1",
    )
    .bind(id)
    .bind(&input.title)
    .bind(&input.platforms)
    .bind(want.when)
    .bind(version)
    .execute(&mut *tx)
    .await?;
    log(&mut tx, &ctx, id, "Edited").await?;
    audit::record(
        &mut tx,
        &ctx,
        "post_edited",
        "post",
        id,
        json!({ "version": version, "from": row.state }),
    )
    .await?;
    settle(&mut tx, &ctx, id, &want, row.state == "in_review").await?;
    let out = post_out(&mut tx, id).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": out })))
}

/// Owners and reviewers may act on any post; other members only on their own.
fn may_manage(ctx: &TenantContext, row: &PostRow) -> Result<(), ApiError> {
    if ctx.require(DECIDERS).is_ok() || row.created_by == Some(ctx.actor_id) {
        Ok(())
    } else {
        Err(ApiError::Forbidden)
    }
}

async fn delete_post(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let id = parse_id(&id)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let row = one(&mut tx, IS_POST, id).await?;
    may_manage(&ctx, &row)?;
    if !["in_review", "approved", "scheduled", "failed", "expired"].contains(&row.state.as_str()) {
        return Err(ApiError::Conflict);
    }
    sqlx::query("UPDATE posts SET state='canceled',updated_at=now() WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    log(&mut tx, &ctx, id, "Deleted").await?;
    audit::record(&mut tx, &ctx, "post_deleted", "post", id, json!({})).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleInput {
    scheduled_at: DateTime<Utc>,
}

/// Moves a post to a new time. Only posts that haven't started going out can move.
async fn reschedule_post(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
    Json(input): Json<ScheduleInput>,
) -> Result<Json<Value>, ApiError> {
    let id = parse_id(&id)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let row = one(&mut tx, IS_POST, id).await?;
    if !["in_review", "approved", "scheduled"].contains(&row.state.as_str()) {
        return Err(ApiError::Conflict);
    }
    if row.state == "in_review" {
        may_manage(&ctx, &row)?;
    } else {
        ctx.require(DECIDERS)?;
    }
    sqlx::query("UPDATE posts SET scheduled_for=$2,updated_at=now() WHERE id=$1")
        .bind(id)
        .bind(input.scheduled_at)
        .execute(&mut *tx)
        .await?;
    log(&mut tx, &ctx, id, "Rescheduled").await?;
    audit::record(
        &mut tx,
        &ctx,
        "post_rescheduled",
        "post",
        id,
        json!({ "scheduled_for": input.scheduled_at }),
    )
    .await?;
    // With a second approver required, a new time needs a new approval too.
    if row.state != "in_review"
        && approvals::second_approver_required(&mut tx, ctx.tenant_id).await?
    {
        sqlx::query("UPDATE posts SET state='in_review',updated_at=now() WHERE id=$1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        let review = Want {
            schedule: false,
            when: Some(input.scheduled_at),
            activity: "Sent for approval",
        };
        settle(&mut tx, &ctx, id, &review, false).await?;
    }
    let out = post_out(&mut tx, id).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": out })))
}

/// Copies a post into Drafts.
async fn duplicate_post(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = parse_id(&id)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let row = one(&mut tx, IS_POST, id).await?;
    let copy: Uuid = sqlx::query_scalar(
        "INSERT INTO posts(tenant_id,title,platforms,draft_state,created_by) VALUES($1,$2,$3,'ready',$4) RETURNING id",
    )
    .bind(ctx.tenant_id)
    .bind(format!("{} (copy)", row.title))
    .bind(&row.platforms)
    .bind(ctx.actor_id)
    .fetch_one(&mut *tx)
    .await?;
    let hashtags: Vec<String> =
        serde_json::from_value(row.content["hashtags"].clone()).unwrap_or_default();
    let content = build_content(
        &mut tx,
        row.caption(),
        &hashtags,
        row.content["aspectRatio"].as_str().unwrap_or("1 / 1"),
        &row.media_ids(),
    )
    .await?;
    add_version(&mut tx, &ctx, copy, 1, &content).await?;
    let out = draft_out(&mut tx, copy).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": out })))
}

/// Every saved version of a draft or post, newest first, with the decision made on it.
async fn list_versions(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = parse_id(&id)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let rows = sqlx::query(
        "SELECT v.version,v.content,v.content_hash,v.created_at,u.display_name AS author,
           (SELECT a.decision::text FROM approvals a WHERE a.post_version_id=v.id ORDER BY a.decided_at DESC, a.id DESC LIMIT 1) AS decision
         FROM post_versions v
         JOIN posts p ON p.id=v.post_id
         LEFT JOIN users u ON u.id=v.created_by
         WHERE v.post_id=$1 AND p.deleted_at IS NULL AND p.state<>'canceled'
         ORDER BY v.version DESC",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    if rows.is_empty() {
        return Err(ApiError::NotFound);
    }
    let mut data = Vec::new();
    for row in rows {
        let content: Value = row.try_get("content")?;
        let mut item = json!({
            "version": row.try_get::<i32, _>("version")?,
            "caption": content["caption"].as_str().unwrap_or(""),
            "hashtags": content.get("hashtags").cloned().unwrap_or_else(|| json!([])),
            "media": content.get("media").cloned().unwrap_or_else(|| json!([])),
            "createdAt": row.try_get::<DateTime<Utc>, _>("created_at")?.to_rfc3339(),
        });
        if let Some(hash) = row.try_get::<Option<String>, _>("content_hash")? {
            item["contentHash"] = json!(hash);
        }
        if let Some(author) = row.try_get::<Option<String>, _>("author")? {
            item["author"] = json!(author);
        }
        if let Some(decision) = row.try_get::<Option<String>, _>("decision")? {
            item["decision"] = json!(decision);
        }
        data.push(item);
    }
    Ok(Json(json!({ "data": data })))
}

// ------------------------------------------------------- what Home needs

/// The networks the app knows. Only Instagram and Facebook can be connected (Phase 6).
async fn list_platforms() -> Json<Value> {
    Json(json!({ "data": [
        { "id": "ig", "name": "Instagram", "limit": 2200, "enabled": true },
        { "id": "fb", "name": "Facebook", "limit": 63206, "enabled": true },
        { "id": "li", "name": "LinkedIn", "limit": 3000, "enabled": false },
        { "id": "tt", "name": "TikTok", "limit": 2200, "enabled": false },
    ] }))
}

/// Connected accounts. Empty until Phase 6 writes `channels` rows.
async fn list_accounts(
    State(s): State<AppState>,
    ctx: TenantContext,
) -> Result<Json<Value>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let rows = sqlx::query(
        "SELECT id,provider,display_name,external_account_id,is_active FROM channels ORDER BY created_at",
    )
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    let mut data = Vec::new();
    for row in rows {
        let platform = match row.try_get::<String, _>("provider")?.as_str() {
            "instagram" | "ig" => "ig",
            "facebook" | "fb" => "fb",
            _ => continue,
        };
        let handle = row
            .try_get::<Option<String>, _>("display_name")?
            .or(row.try_get::<Option<String>, _>("external_account_id")?)
            .unwrap_or_default();
        data.push(json!({
            "id": row.try_get::<Uuid, _>("id")?,
            "platform": platform,
            "handle": handle,
            "status": if row.try_get::<bool, _>("is_active")? { "connected" } else { "needs_attention" },
        }));
    }
    Ok(Json(json!({ "data": data })))
}

/// Home's four numbers. No metrics are collected until Phase 7, and a number we don't
/// have is reported as missing (`null`), never as zero.
async fn home_stats() -> Json<Value> {
    let stat = |key: &str| json!({ "key": key, "value": null, "previous": null, "spark": [] });
    Json(
        json!({ "data": [stat("engagements"), stat("followers"), stat("link_clicks"), stat("comments")] }),
    )
}

/// Mounted inside the authenticated `/v1` router.
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/drafts", get(list_drafts).post(create_draft))
        .route(
            "/drafts/:draft_id",
            get(get_draft).patch(update_draft).delete(delete_draft),
        )
        .route("/drafts/:draft_id/restore", post(restore_draft))
        .route("/drafts/batch", post(batch_drafts))
        .route("/posts", get(list_posts).post(create_post))
        .route(
            "/posts/:post_id",
            get(get_post).put(update_post).delete(delete_post),
        )
        .route("/posts/:post_id/schedule", post(reschedule_post))
        .route("/posts/:post_id/duplicate", post(duplicate_post))
        .route("/posts/:post_id/versions", get(list_versions))
        .route("/platforms", get(list_platforms))
        .route("/accounts", get(list_accounts))
        .route("/analytics/home", get(home_stats))
}
