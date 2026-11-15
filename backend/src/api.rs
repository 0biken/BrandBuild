use axum::{
    extract::{Path, Query, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::{
    auth::{self, AuthError, TenantContext, OWNERS},
    db::tenant_tx,
    AppState,
};

async fn health() -> Json<Value> {
    Json(json!({"status":"ok"}))
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceKind {
    Brand,
    Channel,
    Calendar,
    Post,
}
impl ResourceKind {
    fn table(self) -> &'static str {
        match self {
            Self::Brand => "brand_profiles",
            Self::Channel => "channels",
            Self::Calendar => "calendar_plans",
            Self::Post => "posts",
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub id: Uuid,
    pub kind: ResourceKind,
    pub data: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all(deserialize = "camelCase"))]
pub struct BrandInput {
    pub name: String,
    pub website_url: Option<String>,
    #[serde(default)]
    pub voice: Value,
    #[serde(default)]
    pub audience: Value,
    pub guidelines: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all(deserialize = "camelCase"))]
pub struct ChannelInput {
    pub provider: String,
    pub display_name: Option<String>,
    pub external_account_id: Option<String>,
    #[serde(default)]
    pub metadata: Value,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all(deserialize = "camelCase"))]
pub struct CalendarInput {
    pub name: String,
    pub starts_on: chrono::NaiveDate,
    pub ends_on: chrono::NaiveDate,
    #[serde(default)]
    pub settings: Value,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all(deserialize = "camelCase"))]
pub struct PostInput {
    pub content: Value,
    pub channel_id: Option<Uuid>,
    pub scheduled_for: Option<DateTime<Utc>>,
}
#[derive(Clone, Debug, Serialize)]
pub struct ResourceResponse {
    pub data: Resource,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ListQuery {
    pub limit: Option<usize>,
}
#[derive(Clone, Debug, Serialize)]
pub struct ListResponse {
    pub data: Vec<Resource>,
}
#[derive(Clone, Debug, Serialize)]
pub struct AnalyticsResponse {
    pub data: AnalyticsSummary,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsSummary {
    pub brands: i64,
    pub channels: i64,
    pub calendars: i64,
    pub posts: i64,
    pub published: i64,
    pub scheduled: i64,
    pub in_review: i64,
    pub failed: i64,
    pub publish_attempts: i64,
    pub publish_success_rate: f64,
    pub metric_snapshots: i64,
    pub engagement_total: i64,
}
#[derive(Clone, Debug, Serialize)]
pub struct AuditResponse {
    pub data: Vec<AuditEntry>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: Uuid,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}
#[derive(Clone, Debug, Serialize)]
pub struct ErrorResponse {
    pub error: ApiErrorBody,
}
#[derive(Clone, Debug, Serialize)]
pub struct ApiErrorBody {
    pub code: &'static str,
    pub message: String,
}
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("resource not found")]
    NotFound,
    #[error("request data is invalid")]
    InvalidInput,
    #[error("you don't have permission to do that")]
    Forbidden,
    #[error("that conflicts with the current state")]
    Conflict,
    #[error("verification code is invalid")]
    InvalidCode,
    #[error("verification code has expired")]
    CodeExpired,
    #[error("that isn't available yet")]
    NotAvailable,
    #[error("we couldn't send the email; try again in a moment")]
    EmailUnavailable,
    #[error("internal server error")]
    Internal,
    #[error("AI planning isn't available right now; you can still plan posts yourself")]
    AiUnavailable,
    #[error("this workspace has used its AI allowance for the month")]
    AiBudget,
    /// The model's draft failed a check; the message says which.
    #[error("{0}")]
    AiRejected(String),
}
impl From<AuthError> for ApiError {
    fn from(err: AuthError) -> Self {
        match err {
            AuthError::Forbidden => Self::Forbidden,
            _ => Self::Internal,
        }
    }
}
impl From<crate::storage::StorageError> for ApiError {
    fn from(err: crate::storage::StorageError) -> Self {
        tracing::error!(error=?err, "file storage request failed");
        Self::Internal
    }
}
impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        tracing::error!(error=?err,"database request failed");
        Self::Internal
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let message = self.to_string();
        let (status, code) = match self {
            Self::NotFound => (StatusCode::NOT_FOUND, "not_found"),
            Self::InvalidInput => (StatusCode::UNPROCESSABLE_ENTITY, "invalid_input"),
            Self::Forbidden => (StatusCode::FORBIDDEN, "forbidden"),
            Self::Conflict => (StatusCode::CONFLICT, "conflict"),
            Self::InvalidCode => (StatusCode::UNAUTHORIZED, "invalid_code"),
            Self::CodeExpired => (StatusCode::GONE, "code_expired"),
            Self::NotAvailable => (StatusCode::NOT_IMPLEMENTED, "not_available"),
            Self::EmailUnavailable => (StatusCode::SERVICE_UNAVAILABLE, "email_unavailable"),
            Self::Internal => (StatusCode::INTERNAL_SERVER_ERROR, "internal_error"),
            Self::AiUnavailable => (StatusCode::SERVICE_UNAVAILABLE, "ai_unavailable"),
            Self::AiBudget => (StatusCode::TOO_MANY_REQUESTS, "ai_budget"),
            Self::AiRejected(_) => (StatusCode::UNPROCESSABLE_ENTITY, "ai_rejected"),
        };
        (
            status,
            Json(ErrorResponse {
                error: ApiErrorBody { code, message },
            }),
        )
            .into_response()
    }
}

async fn auth_middleware(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    let (mut parts, body) = request.into_parts();
    match auth::resolve_bearer(&parts, &state.pool).await {
        Ok(ctx) => {
            parts.extensions.insert(ctx);
            request = Request::from_parts(parts, body);
            next.run(request).await
        }
        Err(e) => e.into_response(),
    }
}

/// Gives failures that didn't come from our own error types (bad JSON, missing auth, no such route) the contract's error shape.
async fn json_errors(request: Request, next: Next) -> Response {
    let response = next.run(request).await;
    let status = response.status();
    let is_json = response
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("json"));
    if !status.is_client_error() || is_json {
        return response;
    }
    let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024)
        .await
        .unwrap_or_default();
    let text = String::from_utf8_lossy(&bytes).trim().to_owned();
    let message = if text.is_empty() {
        status
            .canonical_reason()
            .unwrap_or("request failed")
            .to_owned()
    } else {
        text
    };
    let code = match status.as_u16() {
        401 => "unauthorized",
        403 => "forbidden",
        404 => "not_found",
        409 => "conflict",
        429 => "rate_limited",
        _ => "invalid_request",
    };
    (
        status,
        Json(ErrorResponse {
            error: ApiErrorBody { code, message },
        }),
    )
        .into_response()
}

fn from_row(row: &sqlx::postgres::PgRow, kind: ResourceKind) -> Result<Resource, ApiError> {
    let id: Uuid = row.try_get("id").map_err(|_| ApiError::Internal)?;
    let created_at: DateTime<Utc> = row.try_get("created_at").map_err(|_| ApiError::Internal)?;
    let updated_at: DateTime<Utc> = row.try_get("updated_at").unwrap_or(created_at);
    let data = match kind {
        ResourceKind::Brand => {
            json!({"name":row.try_get::<String,_>("name").map_err(|_|ApiError::Internal)?,"websiteUrl":row.try_get::<Option<String>,_>("website_url").map_err(|_|ApiError::Internal)?,"voice":row.try_get::<Value,_>("voice").map_err(|_|ApiError::Internal)?,"audience":row.try_get::<Value,_>("audience").map_err(|_|ApiError::Internal)?,"guidelines":row.try_get::<Option<String>,_>("guidelines").map_err(|_|ApiError::Internal)?})
        }
        ResourceKind::Channel => {
            json!({"provider":row.try_get::<String,_>("provider").map_err(|_|ApiError::Internal)?,"displayName":row.try_get::<Option<String>,_>("display_name").map_err(|_|ApiError::Internal)?,"externalAccountId":row.try_get::<Option<String>,_>("external_account_id").map_err(|_|ApiError::Internal)?,"metadata":row.try_get::<Value,_>("metadata").map_err(|_|ApiError::Internal)?})
        }
        ResourceKind::Calendar => {
            json!({"name":row.try_get::<String,_>("name").map_err(|_|ApiError::Internal)?,"startsOn":row.try_get::<chrono::NaiveDate,_>("starts_on").map_err(|_|ApiError::Internal)?,"endsOn":row.try_get::<chrono::NaiveDate,_>("ends_on").map_err(|_|ApiError::Internal)?,"settings":row.try_get::<Value,_>("settings").map_err(|_|ApiError::Internal)?})
        }
        ResourceKind::Post => {
            json!({"content":row.try_get::<Value,_>("content").map_err(|_|ApiError::Internal)?,"channelId":row.try_get::<Option<Uuid>,_>("channel_id").map_err(|_|ApiError::Internal)?,"scheduledFor":row.try_get::<Option<DateTime<Utc>>,_>("scheduled_for").map_err(|_|ApiError::Internal)?,"state":row.try_get::<String,_>("state").map_err(|_|ApiError::Internal)?,"versionId":row.try_get::<Uuid,_>("version_id").map_err(|_|ApiError::Internal)?})
        }
    };
    Ok(Resource {
        id,
        kind,
        data,
        created_at,
        updated_at,
    })
}
fn select_sql(kind: ResourceKind, by_id: bool) -> String {
    let filter = if by_id {
        if matches!(kind, ResourceKind::Post) {
            " AND p.id=$2"
        } else {
            " AND r.id=$2"
        }
    } else {
        ""
    };
    match kind {
      ResourceKind::Brand=>format!("SELECT r.id,r.created_at,r.updated_at,r.name,r.website_url,r.voice,r.audience,r.guidelines FROM brand_profiles r WHERE r.tenant_id=$1{filter}"),
      ResourceKind::Channel=>format!("SELECT r.id,r.created_at,r.updated_at,r.provider,r.display_name,r.external_account_id,r.metadata FROM channels r WHERE r.tenant_id=$1{filter}"),
      ResourceKind::Calendar=>format!("SELECT r.id,r.created_at,r.updated_at,r.name,r.starts_on,r.ends_on,r.settings FROM calendar_plans r WHERE r.tenant_id=$1{filter}"),
      ResourceKind::Post=>format!("SELECT p.id,p.created_at,p.updated_at,p.channel_id,p.scheduled_for,p.state::text AS state,v.id AS version_id,v.content FROM posts p JOIN post_versions v ON v.tenant_id=p.tenant_id AND v.post_id=p.id AND v.version=p.current_version WHERE p.tenant_id=$1{filter}"),
    }
}
async fn query_resource(
    pool: &PgPool,
    ctx: &TenantContext,
    kind: ResourceKind,
    id: Option<Uuid>,
    limit: Option<usize>,
) -> Result<Vec<Resource>, ApiError> {
    let mut tx = tenant_tx(pool, ctx.tenant_id).await?;
    let rows = match (id, limit) {
        (Some(id), Some(n)) => {
            sqlx::query(&format!("{} LIMIT $3", select_sql(kind, true)))
                .bind(ctx.tenant_id)
                .bind(id)
                .bind(n.clamp(1, 500) as i64)
                .fetch_all(&mut *tx)
                .await?
        }
        (Some(id), None) => {
            sqlx::query(&select_sql(kind, true))
                .bind(ctx.tenant_id)
                .bind(id)
                .fetch_all(&mut *tx)
                .await?
        }
        (None, Some(n)) => {
            sqlx::query(&format!("{} LIMIT $2", select_sql(kind, false)))
                .bind(ctx.tenant_id)
                .bind(n.clamp(1, 500) as i64)
                .fetch_all(&mut *tx)
                .await?
        }
        (None, None) => {
            sqlx::query(&select_sql(kind, false))
                .bind(ctx.tenant_id)
                .fetch_all(&mut *tx)
                .await?
        }
    };
    let result = rows
        .iter()
        .map(|r| from_row(r, kind))
        .collect::<Result<Vec<_>, _>>()?;
    tx.commit().await?;
    Ok(result)
}
async fn create_resource(
    pool: &PgPool,
    ctx: &TenantContext,
    kind: ResourceKind,
    data: Value,
) -> Result<Resource, ApiError> {
    if !data.is_object() {
        return Err(ApiError::InvalidInput);
    }
    let mut tx = tenant_tx(pool, ctx.tenant_id).await?;
    let id = Uuid::new_v4();
    match kind {
        ResourceKind::Brand => {
            sqlx::query("INSERT INTO brand_profiles(id,tenant_id,name,website_url,voice,audience,guidelines) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(id).bind(ctx.tenant_id).bind(data["name"].as_str().ok_or(ApiError::InvalidInput)?).bind(data["website_url"].as_str()).bind(data.get("voice").cloned().unwrap_or(json!({}))).bind(data.get("audience").cloned().unwrap_or(json!({}))).bind(data["guidelines"].as_str()).execute(&mut *tx).await?;
        }
        ResourceKind::Channel => {
            sqlx::query("INSERT INTO channels(id,tenant_id,provider,display_name,external_account_id,metadata) VALUES($1,$2,$3,$4,$5,$6)").bind(id).bind(ctx.tenant_id).bind(data["provider"].as_str().ok_or(ApiError::InvalidInput)?).bind(data["display_name"].as_str()).bind(data["external_account_id"].as_str()).bind(data.get("metadata").cloned().unwrap_or(json!({}))).execute(&mut *tx).await?;
        }
        ResourceKind::Calendar => {
            sqlx::query("INSERT INTO calendar_plans(id,tenant_id,name,starts_on,ends_on,settings) VALUES($1,$2,$3,$4,$5,$6)").bind(id).bind(ctx.tenant_id).bind(data["name"].as_str().ok_or(ApiError::InvalidInput)?).bind(data["starts_on"].as_str().ok_or(ApiError::InvalidInput)?).bind(data["ends_on"].as_str().ok_or(ApiError::InvalidInput)?).bind(data.get("settings").cloned().unwrap_or(json!({}))).execute(&mut *tx).await?;
        }
        ResourceKind::Post => {
            let channel = data["channel_id"]
                .as_str()
                .and_then(|s| Uuid::parse_str(s).ok());
            let sched = data["scheduled_for"]
                .as_str()
                .map(|s| {
                    s.parse::<DateTime<Utc>>()
                        .map_err(|_| ApiError::InvalidInput)
                })
                .transpose()?;
            sqlx::query("INSERT INTO posts(id,tenant_id,channel_id,scheduled_for,current_version) VALUES($1,$2,$3,$4,1)").bind(id).bind(ctx.tenant_id).bind(channel).bind(sched).execute(&mut *tx).await?;
            let version_id = Uuid::new_v4();
            sqlx::query("INSERT INTO post_versions(id,tenant_id,post_id,version,content,created_by) VALUES($1,$2,$3,1,$4,$5)").bind(version_id).bind(ctx.tenant_id).bind(id).bind(data.get("content").cloned().unwrap_or(json!({}))).bind(ctx.actor_id).execute(&mut *tx).await?;
        }
    }
    tx.commit().await?;
    query_resource(pool, ctx, kind, Some(id), None)
        .await?
        .into_iter()
        .next()
        .ok_or(ApiError::NotFound)
}
async fn create_kind(
    State(state): State<AppState>,
    ctx: TenantContext,
    Json(data): Json<Value>,
    kind: ResourceKind,
) -> Result<(StatusCode, Json<ResourceResponse>), ApiError> {
    if matches!(kind, ResourceKind::Channel) {
        ctx.require(OWNERS)?;
    }
    let r = create_resource(&state.pool, &ctx, kind, data).await?;
    Ok((StatusCode::CREATED, Json(ResourceResponse { data: r })))
}
async fn list_kind(
    State(state): State<AppState>,
    ctx: TenantContext,
    Query(q): Query<ListQuery>,
    kind: ResourceKind,
) -> Result<Json<ListResponse>, ApiError> {
    Ok(Json(ListResponse {
        data: query_resource(&state.pool, &ctx, kind, None, q.limit).await?,
    }))
}
async fn get_kind(
    State(state): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<Uuid>,
    kind: ResourceKind,
) -> Result<Json<ResourceResponse>, ApiError> {
    let r = query_resource(&state.pool, &ctx, kind, Some(id), None)
        .await?
        .into_iter()
        .next()
        .ok_or(ApiError::NotFound)?;
    Ok(Json(ResourceResponse { data: r }))
}
async fn update_kind(
    State(state): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<Uuid>,
    Json(data): Json<Value>,
    kind: ResourceKind,
) -> Result<Json<ResourceResponse>, ApiError> {
    if matches!(kind, ResourceKind::Channel) {
        ctx.require(OWNERS)?;
    }
    if !data.is_object() {
        return Err(ApiError::InvalidInput);
    }
    let mut tx = tenant_tx(&state.pool, ctx.tenant_id).await?;
    let changed=match kind {
 ResourceKind::Brand=>sqlx::query("UPDATE brand_profiles SET name=$3,website_url=$4,voice=$5,audience=$6,guidelines=$7,updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(ctx.tenant_id).bind(id).bind(data["name"].as_str().ok_or(ApiError::InvalidInput)?).bind(data["website_url"].as_str()).bind(data.get("voice").cloned().unwrap_or(json!({}))).bind(data.get("audience").cloned().unwrap_or(json!({}))).bind(data["guidelines"].as_str()).execute(&mut *tx).await?.rows_affected(),
 ResourceKind::Channel=>sqlx::query("UPDATE channels SET provider=$3,display_name=$4,external_account_id=$5,metadata=$6,updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(ctx.tenant_id).bind(id).bind(data["provider"].as_str().ok_or(ApiError::InvalidInput)?).bind(data["display_name"].as_str()).bind(data["external_account_id"].as_str()).bind(data.get("metadata").cloned().unwrap_or(json!({}))).execute(&mut *tx).await?.rows_affected(),
 ResourceKind::Calendar=>sqlx::query("UPDATE calendar_plans SET name=$3,starts_on=$4,ends_on=$5,settings=$6,updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(ctx.tenant_id).bind(id).bind(data["name"].as_str().ok_or(ApiError::InvalidInput)?).bind(data["starts_on"].as_str().ok_or(ApiError::InvalidInput)?).bind(data["ends_on"].as_str().ok_or(ApiError::InvalidInput)?).bind(data.get("settings").cloned().unwrap_or(json!({}))).execute(&mut *tx).await?.rows_affected(),
 ResourceKind::Post=>{let current=sqlx::query("SELECT current_version FROM posts WHERE tenant_id=$1 AND id=$2 FOR UPDATE").bind(ctx.tenant_id).bind(id).fetch_optional(&mut *tx).await?.ok_or(ApiError::NotFound)?.try_get::<i32,_>("current_version")?;let version=current+1;let vid=Uuid::new_v4();let sched=data["scheduled_for"].as_str().map(|s| s.parse::<DateTime<Utc>>().map_err(|_| ApiError::InvalidInput)).transpose()?;sqlx::query("INSERT INTO post_versions(id,tenant_id,post_id,version,content,created_by) VALUES($1,$2,$3,$4,$5,$6)").bind(vid).bind(ctx.tenant_id).bind(id).bind(version).bind(data.get("content").cloned().unwrap_or(json!({}))).bind(ctx.actor_id).execute(&mut *tx).await?;sqlx::query("UPDATE posts SET current_version=$3,channel_id=$4,scheduled_for=$5,updated_at=now() WHERE tenant_id=$1 AND id=$2").bind(ctx.tenant_id).bind(id).bind(version).bind(data["channel_id"].as_str().and_then(|s|Uuid::parse_str(s).ok())).bind(sched).execute(&mut *tx).await?.rows_affected()}
 };
    tx.commit().await?;
    if changed == 0 {
        return Err(ApiError::NotFound);
    }
    let r = query_resource(&state.pool, &ctx, kind, Some(id), None)
        .await?
        .into_iter()
        .next()
        .ok_or(ApiError::NotFound)?;
    Ok(Json(ResourceResponse { data: r }))
}
async fn delete_kind(
    State(state): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<Uuid>,
    kind: ResourceKind,
) -> Result<StatusCode, ApiError> {
    if matches!(kind, ResourceKind::Channel) {
        ctx.require(OWNERS)?;
    }
    let sql = format!("DELETE FROM {} WHERE tenant_id=$1 AND id=$2", kind.table());
    let mut tx = tenant_tx(&state.pool, ctx.tenant_id).await?;
    let n = sqlx::query(&sql)
        .bind(ctx.tenant_id)
        .bind(id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(ApiError::NotFound);
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn analytics(
    State(s): State<AppState>,
    ctx: TenantContext,
) -> Result<Json<AnalyticsResponse>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let row=sqlx::query("SELECT (SELECT count(*) FROM brand_profiles WHERE tenant_id=$1) brands,(SELECT count(*) FROM channels WHERE tenant_id=$1) channels,(SELECT count(*) FROM calendar_plans WHERE tenant_id=$1) calendars,(SELECT count(*) FROM posts WHERE tenant_id=$1) posts,(SELECT count(*) FROM posts WHERE tenant_id=$1 AND state='published') published,(SELECT count(*) FROM posts WHERE tenant_id=$1 AND state='scheduled') scheduled,(SELECT count(*) FROM posts WHERE tenant_id=$1 AND state='in_review') in_review,(SELECT count(*) FROM posts WHERE tenant_id=$1 AND state='failed') failed,(SELECT count(*) FROM publish_attempts WHERE tenant_id=$1) attempts,(SELECT count(*) FROM publish_attempts WHERE tenant_id=$1 AND state='succeeded') succeeded,(SELECT count(*) FROM metric_snapshots WHERE tenant_id=$1) snapshots,(SELECT COALESCE(sum(COALESCE((metrics->>'likes')::bigint,0)+COALESCE((metrics->>'comments')::bigint,0)+COALESCE((metrics->>'shares')::bigint,0)+COALESCE((metrics->>'clicks')::bigint,0)),0) FROM metric_snapshots WHERE tenant_id=$1) engagement").bind(ctx.tenant_id).fetch_one(&mut *tx).await?;
    let attempts: i64 = row.try_get("attempts")?;
    let succeeded: i64 = row.try_get("succeeded")?;
    let out = AnalyticsSummary {
        brands: row.try_get("brands")?,
        channels: row.try_get("channels")?,
        calendars: row.try_get("calendars")?,
        posts: row.try_get("posts")?,
        published: row.try_get("published")?,
        scheduled: row.try_get("scheduled")?,
        in_review: row.try_get("in_review")?,
        failed: row.try_get("failed")?,
        publish_attempts: attempts,
        publish_success_rate: if attempts == 0 {
            0.0
        } else {
            succeeded as f64 / attempts as f64
        },
        metric_snapshots: row.try_get("snapshots")?,
        engagement_total: row.try_get("engagement")?,
    };
    tx.commit().await?;
    Ok(Json(AnalyticsResponse { data: out }))
}
async fn audit(
    State(s): State<AppState>,
    ctx: TenantContext,
    Query(q): Query<ListQuery>,
) -> Result<Json<AuditResponse>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let rows=sqlx::query("SELECT id,action,resource_type,resource_id,created_at FROM audit_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2").bind(ctx.tenant_id).bind(q.limit.unwrap_or(100).clamp(1,500) as i64).fetch_all(&mut *tx).await?;
    let data = rows
        .iter()
        .map(|r| {
            Ok(AuditEntry {
                id: r.try_get("id")?,
                action: r.try_get("action")?,
                resource_type: r.try_get("resource_type")?,
                resource_id: r.try_get("resource_id")?,
                created_at: r.try_get("created_at")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?;
    tx.commit().await?;
    Ok(Json(AuditResponse { data }))
}
async fn tenant_config_get(
    State(s): State<AppState>,
    ctx: TenantContext,
) -> Result<Json<Value>, ApiError> {
    let row = sqlx::query("SELECT config FROM tenants WHERE id=$1")
        .bind(ctx.tenant_id)
        .fetch_one(&s.pool)
        .await?;
    Ok(Json(json!({"data":row.try_get::<Value,_>("config")?})))
}
async fn tenant_config_put(
    State(s): State<AppState>,
    ctx: TenantContext,
    Json(mut config): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    ctx.require(OWNERS)?;
    if !config.is_object() {
        return Err(ApiError::InvalidInput);
    }
    let current: Value = sqlx::query("SELECT config FROM tenants WHERE id=$1")
        .bind(ctx.tenant_id)
        .fetch_one(&s.pool)
        .await?
        .try_get("config")?;
    let version = current.get("version").and_then(Value::as_i64).unwrap_or(0) + 1;
    config["version"] = json!(version);
    sqlx::query("UPDATE tenants SET config=$2,updated_at=now() WHERE id=$1")
        .bind(ctx.tenant_id)
        .bind(&config)
        .execute(&s.pool)
        .await?;
    Ok(Json(json!({"data":config})))
}
async fn pillars_list(
    State(s): State<AppState>,
    ctx: TenantContext,
) -> Result<Json<Value>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let rows=sqlx::query("SELECT id,brand_profile_id,name,description,weight,created_at,updated_at FROM content_pillars WHERE tenant_id=$1 ORDER BY created_at").bind(ctx.tenant_id).fetch_all(&mut *tx).await?;
    let data=rows.iter().map(|r|Ok(json!({"id":r.try_get::<Uuid,_>("id")?,"brandProfileId":r.try_get::<Uuid,_>("brand_profile_id")?,"name":r.try_get::<String,_>("name")?,"description":r.try_get::<Option<String>,_>("description")?,"weight":r.try_get::<i16,_>("weight")?}))).collect::<Result<Vec<_>,sqlx::Error>>()?;
    tx.commit().await?;
    Ok(Json(json!({"data":data})))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PillarInput {
    brand_profile_id: Uuid,
    name: String,
    description: Option<String>,
    weight: Option<i16>,
}
async fn pillar_create(
    State(s): State<AppState>,
    ctx: TenantContext,
    Json(i): Json<PillarInput>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let id = Uuid::new_v4();
    let weight = i.weight.unwrap_or(1);
    if weight < 1 {
        return Err(ApiError::InvalidInput);
    }
    sqlx::query("INSERT INTO content_pillars(id,tenant_id,brand_profile_id,name,description,weight) VALUES($1,$2,$3,$4,$5,$6)").bind(id).bind(ctx.tenant_id).bind(i.brand_profile_id).bind(i.name).bind(i.description).bind(weight).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({"data":{"id":id}}))))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SlotInput {
    plan_id: Uuid,
    channel_id: Option<Uuid>,
    pillar_id: Option<Uuid>,
    scheduled_for: DateTime<Utc>,
    notes: Option<String>,
}
async fn slots_list(
    State(s): State<AppState>,
    ctx: TenantContext,
) -> Result<Json<Value>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let rows=sqlx::query("SELECT id,plan_id,channel_id,pillar_id,scheduled_for,status,notes FROM calendar_slots WHERE tenant_id=$1 ORDER BY scheduled_for").bind(ctx.tenant_id).fetch_all(&mut *tx).await?;
    let data=rows.iter().map(|r|Ok(json!({"id":r.try_get::<Uuid,_>("id")?,"planId":r.try_get::<Uuid,_>("plan_id")?,"channelId":r.try_get::<Option<Uuid>,_>("channel_id")?,"pillarId":r.try_get::<Option<Uuid>,_>("pillar_id")?,"scheduledFor":r.try_get::<DateTime<Utc>,_>("scheduled_for")?,"status":r.try_get::<String,_>("status")?,"notes":r.try_get::<Option<String>,_>("notes")?}))).collect::<Result<Vec<_>,sqlx::Error>>()?;
    tx.commit().await?;
    Ok(Json(json!({"data":data})))
}
async fn slot_create(
    State(s): State<AppState>,
    ctx: TenantContext,
    Json(i): Json<SlotInput>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO calendar_slots(id,tenant_id,plan_id,channel_id,pillar_id,scheduled_for,notes) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(id).bind(ctx.tenant_id).bind(i.plan_id).bind(i.channel_id).bind(i.pillar_id).bind(i.scheduled_for).bind(i.notes).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"data":{"id":id,"status":"open"}})),
    ))
}
async fn oauth_start(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let provider = sqlx::query("SELECT provider FROM channels WHERE tenant_id=$1 AND id=$2")
        .bind(ctx.tenant_id)
        .bind(channel_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(ApiError::NotFound)?
        .try_get::<String, _>("provider")?;
    let state = Uuid::new_v4().to_string();
    let hash = format!("oauth-state:{}", state);
    sqlx::query("INSERT INTO oauth_states(tenant_id,provider,state_hash,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')").bind(ctx.tenant_id).bind(&provider).bind(hash).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"data":{"provider":provider,"state":state,"status":"authorizing","adapter":"no_op_scaffold","authorizationUrl":null,"note":"OAuth provider credentials and callback exchange are not configured"}}),
    ))
}

async fn customer_notices(
    State(s): State<AppState>,
    ctx: TenantContext,
) -> Result<Json<Value>, ApiError> {
    let incidents = sqlx::query(
        "SELECT id, title, platforms, customer_message, created_at FROM admin.active_customer_incidents()",
    )
    .fetch_all(&s.admin_pool)
    .await?;
    let holds = sqlx::query(
        "SELECT id, scope, channel_id, customer_message, created_at FROM admin.active_holds_for_target($1, NULL)",
    )
    .bind(ctx.tenant_id)
    .fetch_all(&s.admin_pool)
    .await?;

    let incident_items: Vec<Value> = incidents
        .into_iter()
        .map(|r| {
            json!({
                "id": r.get::<Uuid, _>("id"),
                "title": r.get::<String, _>("title"),
                "platforms": r.get::<Vec<String>, _>("platforms"),
                "customerMessage": r.get::<String, _>("customer_message"),
                "createdAt": r.get::<DateTime<Utc>, _>("created_at"),
            })
        })
        .collect();

    let hold_items: Vec<Value> = holds
        .into_iter()
        .map(|r| {
            json!({
                "id": r.get::<Uuid, _>("id"),
                "scope": r.get::<String, _>("scope"),
                "channelId": r.get::<Option<Uuid>, _>("channel_id"),
                "customerMessage": r.get::<String, _>("customer_message"),
                "createdAt": r.get::<DateTime<Utc>, _>("created_at"),
            })
        })
        .collect();

    Ok(Json(
        json!({"data": {"incidents": incident_items, "holds": hold_items}}),
    ))
}

pub fn router(state: AppState) -> Router {
    let v1 = Router::new()
        .route("/channels", get(list_channel).post(create_channel))
        .route(
            "/channels/:channel_id",
            get(get_channel).put(update_channel).delete(delete_channel),
        )
        .route("/channels/:channel_id/oauth/start", post(oauth_start))
        .route("/calendar-plans", get(list_calendar).post(create_calendar))
        .route(
            "/calendar-plans/:plan_id",
            get(get_calendar)
                .put(update_calendar)
                .delete(delete_calendar),
        )
        .route("/pillars", get(pillars_list).post(pillar_create))
        .route("/slots", get(slots_list).post(slot_create))
        .route(
            "/tenant/config",
            get(tenant_config_get).put(tenant_config_put),
        )
        .route("/analytics", get(analytics))
        .route("/audit", get(audit))
        .route("/notices", get(customer_notices))
        .route("/auth/session", get(crate::auth_api::session))
        .merge(crate::onboarding::routes())
        .merge(crate::brand::routes())
        .merge(crate::facts::routes())
        .merge(crate::content::routes())
        .merge(crate::approvals::routes())
        .merge(crate::ai::routes::routes())
        .merge(crate::media::routes())
        .merge(crate::notifications::routes())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .with_state(state.clone());
    let v2 = Router::new()
        .route("/brands", get(list_brand).post(create_brand))
        .route(
            "/brands/:id",
            get(get_brand).put(update_brand).delete(delete_brand),
        )
        .route("/channels", get(list_channel).post(create_channel))
        .route(
            "/channels/:id",
            get(get_channel).put(update_channel).delete(delete_channel),
        )
        .route("/calendars", get(list_calendar).post(create_calendar))
        .route(
            "/calendars/:id",
            get(get_calendar)
                .put(update_calendar)
                .delete(delete_calendar),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .with_state(state.clone());
    Router::new()
        .route("/health", get(health))
        .nest(
            "/v1",
            Router::new()
                .nest("/auth", crate::auth_api::router())
                .merge(v1),
        )
        .nest("/v2", v2)
        .nest("/admin/v1", crate::admin::router(state.clone()))
        .layer(middleware::from_fn(json_errors))
        .with_state(state)
}

macro_rules! resource_handlers {
    ($list:ident,$create:ident,$get:ident,$update:ident,$delete:ident,$kind:ident,$input:ty) => {
        async fn $list(
            State(s): State<AppState>,
            ctx: TenantContext,
            Query(q): Query<ListQuery>,
        ) -> Result<Json<ListResponse>, ApiError> {
            list_kind(State(s), ctx, Query(q), ResourceKind::$kind).await
        }
        async fn $create(
            State(s): State<AppState>,
            ctx: TenantContext,
            Json(i): Json<$input>,
        ) -> Result<(StatusCode, Json<ResourceResponse>), ApiError> {
            create_kind(
                State(s),
                ctx,
                Json(serde_json::to_value(i).map_err(|_| ApiError::InvalidInput)?),
                ResourceKind::$kind,
            )
            .await
        }
        async fn $get(
            State(s): State<AppState>,
            ctx: TenantContext,
            Path(id): Path<Uuid>,
        ) -> Result<Json<ResourceResponse>, ApiError> {
            get_kind(State(s), ctx, Path(id), ResourceKind::$kind).await
        }
        async fn $update(
            State(s): State<AppState>,
            ctx: TenantContext,
            Path(id): Path<Uuid>,
            Json(i): Json<$input>,
        ) -> Result<Json<ResourceResponse>, ApiError> {
            update_kind(
                State(s),
                ctx,
                Path(id),
                Json(serde_json::to_value(i).map_err(|_| ApiError::InvalidInput)?),
                ResourceKind::$kind,
            )
            .await
        }
        async fn $delete(
            State(s): State<AppState>,
            ctx: TenantContext,
            Path(id): Path<Uuid>,
        ) -> Result<StatusCode, ApiError> {
            delete_kind(State(s), ctx, Path(id), ResourceKind::$kind).await
        }
    };
}
resource_handlers!(
    list_brand,
    create_brand,
    get_brand,
    update_brand,
    delete_brand,
    Brand,
    BrandInput
);
resource_handlers!(
    list_channel,
    create_channel,
    get_channel,
    update_channel,
    delete_channel,
    Channel,
    ChannelInput
);
resource_handlers!(
    list_calendar,
    create_calendar,
    get_calendar,
    update_calendar,
    delete_calendar,
    Calendar,
    CalendarInput
);
// Posts have no generic /v2 routes: they go through /v1, where approval rules apply.
