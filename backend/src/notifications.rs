//! In-app notifications and each member's notification settings
//! (docs/api/openapi.yaml, tag `notifications`).
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{postgres::PgRow, Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{api::ApiError, auth::TenantContext, db::tenant_tx, AppState};

type Tx = Transaction<'static, Postgres>;

/// The workspace's owners and reviewers, optionally leaving out whoever is acting.
pub async fn deciders(
    tx: &mut Tx,
    ctx: &TenantContext,
    except_actor: bool,
) -> Result<Vec<Uuid>, ApiError> {
    Ok(sqlx::query_scalar(
        "SELECT user_id FROM tenant_memberships WHERE tenant_id=$1 AND role IN ('owner','reviewer') AND ($2::uuid IS NULL OR user_id<>$2)",
    )
    .bind(ctx.tenant_id)
    .bind(except_actor.then_some(ctx.actor_id))
    .fetch_all(&mut **tx)
    .await?)
}

/// Writes one notification per recipient, in the caller's transaction.
pub async fn notify(
    tx: &mut Tx,
    tenant_id: Uuid,
    to: &[Uuid],
    kind: &str,
    title: &str,
    body: &str,
    href: &str,
) -> Result<(), ApiError> {
    if to.is_empty() {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO notifications(tenant_id,user_id,kind,title,body,href) SELECT $1,u,$3,$4,$5,$6 FROM unnest($2::uuid[]) AS u",
    )
    .bind(tenant_id)
    .bind(to)
    .bind(kind)
    .bind(title)
    .bind(body)
    .bind(href)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn notification_json(row: &PgRow) -> Result<Value, ApiError> {
    Ok(json!({
        "id": row.try_get::<Uuid, _>("id")?,
        "kind": row.try_get::<String, _>("kind")?,
        "title": row.try_get::<String, _>("title")?,
        "body": row.try_get::<String, _>("body")?,
        "at": row.try_get::<DateTime<Utc>, _>("created_at")?.to_rfc3339(),
        "read": row.try_get::<Option<DateTime<Utc>>, _>("read_at")?.is_some(),
        "href": row.try_get::<String, _>("href")?,
    }))
}

async fn list_notifications(
    State(s): State<AppState>,
    ctx: TenantContext,
) -> Result<Json<Value>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let rows = sqlx::query(
        "SELECT id,kind,title,body,href,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC, id LIMIT 100",
    )
    .bind(ctx.actor_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    let data = rows
        .iter()
        .map(notification_json)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(json!({ "data": data })))
}

async fn mark_read(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let id = Uuid::parse_str(&id).map_err(|_| ApiError::NotFound)?;
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let row = sqlx::query(
        "UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id,kind,title,body,href,read_at,created_at",
    )
    .bind(id)
    .bind(ctx.actor_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::NotFound)?;
    tx.commit().await?;
    Ok(Json(json!({ "data": notification_json(&row)? })))
}

async fn mark_all_read(
    State(s): State<AppState>,
    ctx: TenantContext,
) -> Result<StatusCode, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    sqlx::query("UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL")
        .bind(ctx.actor_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn prefs(tx: &mut Tx, ctx: &TenantContext) -> Result<Value, ApiError> {
    let row = sqlx::query(
        "SELECT post_reminders,scheduled_alerts,weekly_insights FROM notification_prefs WHERE user_id=$1",
    )
    .bind(ctx.actor_id)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(match row {
        Some(row) => json!({
            "postReminders": row.try_get::<bool, _>("post_reminders")?,
            "scheduledAlerts": row.try_get::<bool, _>("scheduled_alerts")?,
            "weeklyInsights": row.try_get::<bool, _>("weekly_insights")?,
        }),
        None => json!({ "postReminders": true, "scheduledAlerts": true, "weeklyInsights": true }),
    })
}

async fn get_prefs(State(s): State<AppState>, ctx: TenantContext) -> Result<Json<Value>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let out = prefs(&mut tx, &ctx).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": out })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrefsInput {
    post_reminders: Option<bool>,
    scheduled_alerts: Option<bool>,
    weekly_insights: Option<bool>,
}

async fn update_prefs(
    State(s): State<AppState>,
    ctx: TenantContext,
    Json(input): Json<PrefsInput>,
) -> Result<Json<Value>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    sqlx::query(
        "INSERT INTO notification_prefs(tenant_id,user_id,post_reminders,scheduled_alerts,weekly_insights)
         VALUES($1,$2,COALESCE($3,true),COALESCE($4,true),COALESCE($5,true))
         ON CONFLICT(tenant_id,user_id) DO UPDATE SET
           post_reminders=COALESCE($3,notification_prefs.post_reminders),
           scheduled_alerts=COALESCE($4,notification_prefs.scheduled_alerts),
           weekly_insights=COALESCE($5,notification_prefs.weekly_insights),
           updated_at=now()",
    )
    .bind(ctx.tenant_id)
    .bind(ctx.actor_id)
    .bind(input.post_reminders)
    .bind(input.scheduled_alerts)
    .bind(input.weekly_insights)
    .execute(&mut *tx)
    .await?;
    let out = prefs(&mut tx, &ctx).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": out })))
}

/// Mounted inside the authenticated `/v1` router.
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/notifications", get(list_notifications))
        .route("/notifications/read-all", post(mark_all_read))
        .route("/notifications/:notification_id/read", post(mark_read))
        .route(
            "/settings/notifications",
            get(get_prefs).patch(update_prefs),
        )
}
