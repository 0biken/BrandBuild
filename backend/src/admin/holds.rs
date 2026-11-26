//! Scoped publishing holds (`/admin/v1/publishing-holds`).
//! Supports global, workspace, and channel holds. Releasing a hold preserves
//! future scheduled posts and moves overdue scheduled posts to `approved` so
//! resuming never causes a publishing burst.
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

use crate::{api::ApiError, auth::AuthError, outbox, AppState};

use super::{audit, StaffContext, StaffRole};

const HOLD_VIEWERS: &[StaffRole] = &[
    StaffRole::Support,
    StaffRole::Operations,
    StaffRole::StaffAdmin,
];
const HOLD_OPERATORS: &[StaffRole] = &[StaffRole::Operations, StaffRole::StaffAdmin];

fn map_auth(err: AuthError) -> ApiError {
    match err {
        AuthError::Forbidden => ApiError::Forbidden,
        _ => ApiError::Internal,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListHoldsQuery {
    pub workspace_id: Option<Uuid>,
    pub include_released: Option<bool>,
}

pub async fn list_holds(
    State(s): State<AppState>,
    ctx: StaffContext,
    Query(q): Query<ListHoldsQuery>,
) -> Result<Json<Value>, ApiError> {
    ctx.require(HOLD_VIEWERS).map_err(map_auth)?;
    let include_released = q.include_released.unwrap_or(false);

    let rows = sqlx::query(
        "SELECT h.id, h.scope, h.workspace_id, h.channel_id, h.internal_reason,
                h.customer_message, h.created_at, h.released_at, h.release_reason,
                cu.display_name AS created_by_name,
                ru.display_name AS released_by_name
         FROM admin.publishing_holds h
         JOIN admin.staff_users cu ON cu.id = h.created_by
         LEFT JOIN admin.staff_users ru ON ru.id = h.released_by
         WHERE ($1::boolean OR h.released_at IS NULL)
           AND ($2::uuid IS NULL OR h.scope = 'global' OR h.workspace_id = $2)
         ORDER BY h.created_at DESC
         LIMIT 100",
    )
    .bind(include_released)
    .bind(q.workspace_id)
    .fetch_all(&s.admin_pool)
    .await?;

    let mut data = Vec::with_capacity(rows.len());
    for r in rows {
        data.push(json!({
            "id": r.try_get::<Uuid, _>("id")?,
            "scope": r.try_get::<String, _>("scope")?,
            "workspaceId": r.try_get::<Option<Uuid>, _>("workspace_id")?,
            "channelId": r.try_get::<Option<Uuid>, _>("channel_id")?,
            "internalReason": r.try_get::<String, _>("internal_reason")?,
            "customerMessage": r.try_get::<String, _>("customer_message")?,
            "createdBy": r.try_get::<String, _>("created_by_name")?,
            "createdAt": r.try_get::<DateTime<Utc>, _>("created_at")?.to_rfc3339(),
            "releasedBy": r.try_get::<Option<String>, _>("released_by_name")?,
            "releasedAt": r.try_get::<Option<DateTime<Utc>>, _>("released_at")?.map(|d| d.to_rfc3339()),
            "releaseReason": r.try_get::<Option<String>, _>("release_reason")?,
        }));
    }
    Ok(Json(json!({ "data": data })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateHoldInput {
    pub scope: String,
    pub workspace_id: Option<Uuid>,
    pub channel_id: Option<Uuid>,
    pub internal_reason: String,
    pub customer_message: String,
}

pub async fn create_hold(
    State(s): State<AppState>,
    ctx: StaffContext,
    Json(input): Json<CreateHoldInput>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    ctx.require(HOLD_OPERATORS).map_err(map_auth)?;
    let reason = input.internal_reason.trim();
    let msg = input.customer_message.trim();
    if reason.is_empty()
        || reason.chars().count() > 500
        || msg.is_empty()
        || msg.chars().count() > 1000
    {
        return Err(ApiError::InvalidInput);
    }

    match input.scope.as_str() {
        "global" if input.workspace_id.is_none() && input.channel_id.is_none() => {}
        "workspace" if input.workspace_id.is_some() && input.channel_id.is_none() => {}
        "channel" if input.workspace_id.is_some() && input.channel_id.is_some() => {}
        _ => return Err(ApiError::InvalidInput),
    }

    let mut tx = s.admin_pool.begin().await?;
    let row = sqlx::query(
        "INSERT INTO admin.publishing_holds(
            scope, workspace_id, channel_id, internal_reason, customer_message, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, created_at",
    )
    .bind(&input.scope)
    .bind(input.workspace_id)
    .bind(input.channel_id)
    .bind(reason)
    .bind(msg)
    .bind(ctx.staff_user_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23505") => ApiError::Conflict,
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23503") => ApiError::NotFound,
        _ => ApiError::from(e),
    })?;

    let hold_id: Uuid = row.try_get("id")?;
    let created_at: DateTime<Utc> = row.try_get("created_at")?;

    if let Some(ws_id) = input.workspace_id {
        outbox::enqueue(
            &mut tx,
            ws_id,
            "notification.send",
            json!({
                "kind": "publishing_hold_created",
                "holdId": hold_id,
                "idempotencyKey": format!("hold:{hold_id}:created"),
                "message": msg,
            }),
        )
        .await?;
    }

    let hold_id_str = hold_id.to_string();
    audit::record_ctx(
        &mut tx,
        &ctx,
        audit::CtxAudit {
            action: "publishing_hold_created",
            workspace_id: input.workspace_id,
            target_type: Some("publishing_hold"),
            target_id: Some(&hold_id_str),
            reason: Some(reason),
            before_state: None,
            after_state: Some(json!({
                "scope": input.scope,
                "workspaceId": input.workspace_id,
                "channelId": input.channel_id,
                "customerMessage": msg,
            })),
        },
    )
    .await?;
    tx.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "data": {
                "id": hold_id,
                "scope": input.scope,
                "workspaceId": input.workspace_id,
                "channelId": input.channel_id,
                "internalReason": reason,
                "customerMessage": msg,
                "createdBy": ctx.display_name,
                "createdAt": created_at.to_rfc3339(),
            }
        })),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseHoldInput {
    pub reason: Option<String>,
}

pub async fn release_hold(
    State(s): State<AppState>,
    ctx: StaffContext,
    Path(id): Path<Uuid>,
    Json(input): Json<ReleaseHoldInput>,
) -> Result<Json<Value>, ApiError> {
    ctx.require(HOLD_OPERATORS).map_err(map_auth)?;
    let release_reason = input
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .map(str::to_owned);

    let mut tx = s.admin_pool.begin().await?;
    let row = sqlx::query(
        "UPDATE admin.publishing_holds
         SET released_by = $2, released_at = now(), release_reason = $3
         WHERE id = $1 AND released_at IS NULL
         RETURNING scope, workspace_id, channel_id, internal_reason, released_at",
    )
    .bind(id)
    .bind(ctx.staff_user_id)
    .bind(&release_reason)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::NotFound)?;

    let scope: String = row.try_get("scope")?;
    let workspace_id: Option<Uuid> = row.try_get("workspace_id")?;
    let channel_id: Option<Uuid> = row.try_get("channel_id")?;
    let released_at: DateTime<Utc> = row.try_get("released_at")?;

    let held_overdue: i64 =
        sqlx::query_scalar("SELECT admin.hold_overdue_posts_on_resume($1, $2, $3)")
            .bind(&scope)
            .bind(workspace_id)
            .bind(channel_id)
            .fetch_one(&mut *tx)
            .await?;

    if let Some(ws_id) = workspace_id {
        outbox::enqueue(
            &mut tx,
            ws_id,
            "notification.send",
            json!({
                "kind": "publishing_hold_released",
                "holdId": id,
                "idempotencyKey": format!("hold:{id}:released"),
                "heldOverduePosts": held_overdue,
            }),
        )
        .await?;
    }

    let id_str = id.to_string();
    audit::record_ctx(
        &mut tx,
        &ctx,
        audit::CtxAudit {
            action: "publishing_hold_released",
            workspace_id,
            target_type: Some("publishing_hold"),
            target_id: Some(&id_str),
            reason: release_reason.as_deref(),
            before_state: Some(json!({ "scope": scope, "channelId": channel_id })),
            after_state: Some(
                json!({ "releasedAt": released_at.to_rfc3339(), "heldOverduePosts": held_overdue }),
            ),
        },
    )
    .await?;
    tx.commit().await?;

    Ok(Json(json!({
        "data": {
            "id": id,
            "releasedAt": released_at.to_rfc3339(),
            "heldOverduePosts": held_overdue,
        }
    })))
}
