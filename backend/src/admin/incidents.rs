//! Provider incident notices (`/admin/v1/incidents`).
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

use crate::{api::ApiError, auth::AuthError, AppState};

use super::{audit, StaffContext, StaffRole};

const INCIDENT_VIEWERS: &[StaffRole] = &[
    StaffRole::Support,
    StaffRole::Operations,
    StaffRole::StudentReviewer,
    StaffRole::StaffAdmin,
];
const INCIDENT_OPERATORS: &[StaffRole] = &[StaffRole::Operations, StaffRole::StaffAdmin];

fn map_auth(err: AuthError) -> ApiError {
    match err {
        AuthError::Forbidden => ApiError::Forbidden,
        _ => ApiError::Internal,
    }
}

fn incident_json(r: &sqlx::postgres::PgRow) -> Result<Value, ApiError> {
    Ok(json!({
        "id": r.try_get::<Uuid, _>("id")?,
        "title": r.try_get::<String, _>("title")?,
        "platforms": r.try_get::<Vec<String>, _>("platforms")?,
        "customerMessage": r.try_get::<String, _>("customer_message")?,
        "publishBanner": r.try_get::<bool, _>("publish_banner")?,
        "createdBy": r.try_get::<String, _>("created_by_name")?,
        "createdAt": r.try_get::<DateTime<Utc>, _>("created_at")?.to_rfc3339(),
        "resolvedAt": r.try_get::<Option<DateTime<Utc>>, _>("resolved_at")?.map(|d| d.to_rfc3339()),
    }))
}

pub async fn list_incidents(
    State(s): State<AppState>,
    ctx: StaffContext,
) -> Result<Json<Value>, ApiError> {
    ctx.require(INCIDENT_VIEWERS).map_err(map_auth)?;
    let rows = sqlx::query(
        "SELECT i.id, i.title, i.platforms, i.customer_message, i.publish_banner,
                i.created_at, i.resolved_at, u.display_name AS created_by_name
         FROM admin.provider_incidents i
         JOIN admin.staff_users u ON u.id = i.created_by
         ORDER BY i.resolved_at IS NOT NULL ASC, i.created_at DESC
         LIMIT 50",
    )
    .fetch_all(&s.admin_pool)
    .await?;

    let data = rows
        .iter()
        .map(incident_json)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(json!({ "data": data })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateIncidentInput {
    pub title: String,
    pub platforms: Vec<String>,
    pub customer_message: String,
    pub publish_banner: Option<bool>,
}

pub async fn create_incident(
    State(s): State<AppState>,
    ctx: StaffContext,
    Json(input): Json<CreateIncidentInput>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    ctx.require(INCIDENT_OPERATORS).map_err(map_auth)?;
    let title = input.title.trim();
    let msg = input.customer_message.trim();
    if title.is_empty()
        || title.chars().count() > 200
        || msg.is_empty()
        || msg.chars().count() > 1000
        || input.platforms.is_empty()
        || !input
            .platforms
            .iter()
            .all(|p| matches!(p.as_str(), "ig" | "fb" | "li" | "tt"))
    {
        return Err(ApiError::InvalidInput);
    }
    let publish_banner = input.publish_banner.unwrap_or(false);

    let mut tx = s.admin_pool.begin().await?;
    let row = sqlx::query(
        "INSERT INTO admin.provider_incidents(title, platforms, customer_message, publish_banner, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, created_at",
    )
    .bind(title)
    .bind(&input.platforms)
    .bind(msg)
    .bind(publish_banner)
    .bind(ctx.staff_user_id)
    .fetch_one(&mut *tx)
    .await?;

    let id: Uuid = row.try_get("id")?;
    let created_at: DateTime<Utc> = row.try_get("created_at")?;
    let body = json!({
        "id": id,
        "title": title,
        "platforms": input.platforms,
        "customerMessage": msg,
        "publishBanner": publish_banner,
        "createdBy": ctx.display_name,
        "createdAt": created_at.to_rfc3339(),
        "resolvedAt": null,
    });
    let id_str = id.to_string();
    audit::record_ctx(
        &mut tx,
        &ctx,
        audit::CtxAudit {
            action: "incident_created",
            workspace_id: None,
            target_type: Some("provider_incident"),
            target_id: Some(&id_str),
            reason: Some(title),
            before_state: None,
            after_state: Some(body.clone()),
        },
    )
    .await?;
    tx.commit().await?;

    Ok((StatusCode::CREATED, Json(json!({ "data": body }))))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateIncidentInput {
    pub publish_banner: Option<bool>,
    pub resolve: Option<bool>,
}

pub async fn update_incident(
    State(s): State<AppState>,
    ctx: StaffContext,
    Path(id): Path<Uuid>,
    Json(input): Json<UpdateIncidentInput>,
) -> Result<Json<Value>, ApiError> {
    ctx.require(INCIDENT_OPERATORS).map_err(map_auth)?;
    let mut tx = s.admin_pool.begin().await?;

    let row = sqlx::query(
        "UPDATE admin.provider_incidents
         SET publish_banner = COALESCE($2, publish_banner),
             resolved_by = CASE WHEN $3::boolean IS TRUE AND resolved_at IS NULL THEN $4 ELSE resolved_by END,
             resolved_at = CASE WHEN $3::boolean IS TRUE AND resolved_at IS NULL THEN now() ELSE resolved_at END
         WHERE id = $1
         RETURNING id, title, platforms, customer_message, publish_banner, created_at, resolved_at",
    )
    .bind(id)
    .bind(input.publish_banner)
    .bind(input.resolve.unwrap_or(false))
    .bind(ctx.staff_user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::NotFound)?;

    let resolved_at: Option<DateTime<Utc>> = row.try_get("resolved_at")?;
    let action = if input.resolve.unwrap_or(false) {
        "incident_resolved"
    } else {
        "incident_updated"
    };
    let id_str = id.to_string();
    let after = json!({
        "publishBanner": row.try_get::<bool, _>("publish_banner")?,
        "resolvedAt": resolved_at.map(|d| d.to_rfc3339()),
    });
    audit::record_ctx(
        &mut tx,
        &ctx,
        audit::CtxAudit {
            action,
            workspace_id: None,
            target_type: Some("provider_incident"),
            target_id: Some(&id_str),
            reason: None,
            before_state: None,
            after_state: Some(after.clone()),
        },
    )
    .await?;
    tx.commit().await?;

    Ok(Json(json!({ "data": after })))
}
