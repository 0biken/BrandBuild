//! Workspace search, operational detail, and internal staff notes (`/admin/v1/workspaces`).
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

use crate::{api::ApiError, auth::AuthError, AppState};

use super::{audit, StaffContext, StaffRole};

const WORKSPACE_VIEWERS: &[StaffRole] = &[
    StaffRole::Support,
    StaffRole::Operations,
    StaffRole::StaffAdmin,
];

fn map_auth(err: AuthError) -> ApiError {
    match err {
        AuthError::Forbidden => ApiError::Forbidden,
        _ => ApiError::Internal,
    }
}

#[derive(Deserialize)]
pub struct WorkspaceSearchQuery {
    pub q: Option<String>,
    pub plan: Option<String>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

pub async fn search_workspaces(
    State(s): State<AppState>,
    ctx: StaffContext,
    Query(query): Query<WorkspaceSearchQuery>,
) -> Result<Json<Value>, ApiError> {
    ctx.require(WORKSPACE_VIEWERS).map_err(map_auth)?;
    if let Some(ref p) = query.plan {
        if !p.is_empty() && !matches!(p.as_str(), "student" | "creator" | "business") {
            return Err(ApiError::InvalidInput);
        }
    }
    let limit = query.limit.unwrap_or(25).clamp(1, 100);
    let offset = query.offset.unwrap_or(0).max(0);

    let data: Value = sqlx::query_scalar("SELECT admin.search_workspaces($1, $2, $3, $4)")
        .bind(query.q.as_deref())
        .bind(query.plan.as_deref())
        .bind(limit)
        .bind(offset)
        .fetch_one(&s.admin_pool)
        .await?;

    Ok(Json(json!({ "data": data })))
}

pub async fn get_workspace(
    State(s): State<AppState>,
    ctx: StaffContext,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    ctx.require(WORKSPACE_VIEWERS).map_err(map_auth)?;

    let detail: Option<Value> = sqlx::query_scalar("SELECT admin.workspace_detail($1)")
        .bind(id)
        .fetch_one(&s.admin_pool)
        .await?;

    let detail = detail.ok_or(ApiError::NotFound)?;
    Ok(Json(json!({ "data": detail })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateNoteInput {
    pub note: String,
}

pub async fn add_note(
    State(s): State<AppState>,
    ctx: StaffContext,
    Path(id): Path<Uuid>,
    Json(input): Json<CreateNoteInput>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    ctx.require(WORKSPACE_VIEWERS).map_err(map_auth)?;
    let trimmed = input.note.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 2000 {
        return Err(ApiError::InvalidInput);
    }

    let mut tx = s.admin_pool.begin().await?;
    let row = sqlx::query(
        "INSERT INTO admin.workspace_notes(workspace_id, staff_user_id, note)
         VALUES ($1, $2, $3)
         RETURNING id, created_at",
    )
    .bind(id)
    .bind(ctx.staff_user_id)
    .bind(trimmed)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23503") => ApiError::NotFound,
        _ => ApiError::from(e),
    })?;

    let note_id: Uuid = row.try_get("id")?;
    let created_at: DateTime<Utc> = row.try_get("created_at")?;
    let body = json!({
        "id": note_id,
        "note": trimmed,
        "staffName": ctx.display_name,
        "staffEmail": ctx.email,
        "createdAt": created_at.to_rfc3339(),
    });
    let note_id_str = note_id.to_string();
    audit::record_ctx(
        &mut tx,
        &ctx,
        audit::CtxAudit {
            action: "workspace_note_added",
            workspace_id: Some(id),
            target_type: Some("workspace_note"),
            target_id: Some(&note_id_str),
            reason: None,
            before_state: None,
            after_state: Some(json!({ "noteId": note_id })),
        },
    )
    .await?;
    tx.commit().await?;

    Ok((StatusCode::CREATED, Json(json!({ "data": body }))))
}
