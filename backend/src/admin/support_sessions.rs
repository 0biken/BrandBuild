use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{
    admin::{
        audit::{record, StaffAuditEntry},
        StaffContext, StaffRole,
    },
    api::ApiError,
    auth::AuthError,
    AppState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionsQuery {
    workspace_id: Option<Uuid>,
    status: Option<String>,
}

pub async fn list_sessions(
    State(state): State<AppState>,
    staff: StaffContext,
    Query(q): Query<ListSessionsQuery>,
) -> Result<Json<Value>, ApiError> {
    staff.require(&[
        StaffRole::Support,
        StaffRole::Operations,
        StaffRole::StaffAdmin,
    ])?;
    let items: Value = sqlx::query_scalar("SELECT admin.list_support_sessions($1, $2)")
        .bind(q.workspace_id)
        .bind(q.status.as_deref())
        .fetch_one(&state.admin_pool)
        .await?;
    Ok(Json(json!({ "data": items })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestSessionInput {
    workspace_id: Uuid,
    mode: String,
    ticket_ref: String,
    reason: String,
    duration_minutes: Option<i32>,
}

pub async fn request_session(
    State(state): State<AppState>,
    staff: StaffContext,
    Json(input): Json<RequestSessionInput>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    staff.require(&[
        StaffRole::Support,
        StaffRole::Operations,
        StaffRole::StaffAdmin,
    ])?;
    if input.mode != "read_only" && input.mode != "read_write" {
        return Err(ApiError::InvalidInput);
    }
    let ticket = input.ticket_ref.trim();
    let reason = input.reason.trim();
    let duration = input.duration_minutes.unwrap_or(30);
    if ticket.is_empty()
        || ticket.chars().count() > 120
        || reason.chars().count() < 3
        || reason.chars().count() > 500
        || !(5..=60).contains(&duration)
    {
        return Err(ApiError::InvalidInput);
    }

    // Read-only sessions are pre-approved for immediate activation (still requires
    // customer notification on activation); read-write sessions require another
    // Operations or StaffAdmin approver.
    let initial_status = if input.mode == "read_only" {
        "approved"
    } else {
        "pending_approval"
    };

    let mut tx = state.admin_pool.begin().await?;
    let row = sqlx::query(
        "INSERT INTO admin.support_sessions (
           tenant_id, mode, ticket_ref, reason, duration_minutes, status, requested_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, status, created_at",
    )
    .bind(input.workspace_id)
    .bind(&input.mode)
    .bind(ticket)
    .bind(reason)
    .bind(duration)
    .bind(initial_status)
    .bind(staff.staff_user_id)
    .fetch_one(&mut *tx)
    .await?;

    let id: Uuid = row.try_get("id")?;
    let status: String = row.try_get("status")?;
    let created_at: DateTime<Utc> = row.try_get("created_at")?;

    let active_roles: Vec<String> = staff.roles.iter().map(|r| r.as_str().to_string()).collect();
    record(
        &mut tx,
        StaffAuditEntry {
            staff_user_id: Some(staff.staff_user_id),
            staff_email: Some(&staff.email),
            active_roles: &active_roles,
            action: "support_session.request",
            workspace_id: Some(input.workspace_id),
            target_type: Some("support_session"),
            target_id: Some(&id.to_string()),
            request_id: None,
            reason: Some(reason),
            ticket_ref: Some(ticket),
            support_session_id: Some(id),
            before_state: None,
            after_state: Some(
                json!({ "mode": input.mode, "status": status, "durationMinutes": duration }),
            ),
            outcome: "success",
        },
    )
    .await?;

    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({
            "data": {
                "id": id,
                "tenantId": input.workspace_id,
                "mode": input.mode,
                "ticketRef": ticket,
                "reason": reason,
                "durationMinutes": duration,
                "status": status,
                "createdAt": created_at,
            }
        })),
    ))
}

pub async fn approve_session(
    State(state): State<AppState>,
    staff: StaffContext,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    staff.require(&[StaffRole::Operations, StaffRole::StaffAdmin])?;
    let mut tx = state.admin_pool.begin().await?;
    let row = sqlx::query(
        "SELECT tenant_id, requested_by, status, ticket_ref, reason FROM admin.support_sessions WHERE id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::NotFound)?;

    let tenant_id: Uuid = row.try_get("tenant_id")?;
    let requested_by: Uuid = row.try_get("requested_by")?;
    let status: String = row.try_get("status")?;
    let ticket_ref: String = row.try_get("ticket_ref")?;
    let reason: String = row.try_get("reason")?;

    if requested_by == staff.staff_user_id {
        return Err(AuthError::Forbidden.into());
    }
    if status != "pending_approval" {
        return Err(ApiError::Conflict);
    }

    sqlx::query(
        "UPDATE admin.support_sessions SET status = 'approved', approved_by = $2 WHERE id = $1",
    )
    .bind(id)
    .bind(staff.staff_user_id)
    .execute(&mut *tx)
    .await?;

    let active_roles: Vec<String> = staff.roles.iter().map(|r| r.as_str().to_string()).collect();
    record(
        &mut tx,
        StaffAuditEntry {
            staff_user_id: Some(staff.staff_user_id),
            staff_email: Some(&staff.email),
            active_roles: &active_roles,
            action: "support_session.approve",
            workspace_id: Some(tenant_id),
            target_type: Some("support_session"),
            target_id: Some(&id.to_string()),
            request_id: None,
            reason: Some(&reason),
            ticket_ref: Some(&ticket_ref),
            support_session_id: Some(id),
            before_state: Some(json!({ "status": "pending_approval" })),
            after_state: Some(json!({ "status": "approved", "approvedBy": staff.staff_user_id })),
            outcome: "success",
        },
    )
    .await?;

    tx.commit().await?;
    Ok(Json(json!({ "data": { "id": id, "status": "approved" } })))
}

pub async fn activate_session(
    State(state): State<AppState>,
    staff: StaffContext,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    staff.require(&[
        StaffRole::Support,
        StaffRole::Operations,
        StaffRole::StaffAdmin,
    ])?;
    let mut tx = state.admin_pool.begin().await?;
    let eligible: Option<Value> =
        sqlx::query_scalar("SELECT admin.support_session_guard($1,$2,false,true)")
            .bind(id)
            .bind(staff.staff_user_id)
            .fetch_one(&mut *tx)
            .await?;
    if eligible.is_none() {
        return Err(AuthError::Forbidden.into());
    }

    let row = sqlx::query(
        "SELECT tenant_id, requested_by, status, duration_minutes, ticket_ref, reason
         FROM admin.support_sessions WHERE id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::NotFound)?;

    let tenant_id: Uuid = row.try_get("tenant_id")?;
    let requested_by: Uuid = row.try_get("requested_by")?;
    let status: String = row.try_get("status")?;
    let duration_minutes: i32 = row.try_get("duration_minutes")?;
    let ticket_ref: String = row.try_get("ticket_ref")?;
    let reason: String = row.try_get("reason")?;

    if requested_by != staff.staff_user_id && !staff.has_any(&[StaffRole::StaffAdmin]) {
        return Err(AuthError::Forbidden.into());
    }
    if status != "approved" {
        return Err(ApiError::Conflict);
    }

    let now = Utc::now();
    let expires_at = now + Duration::minutes(i64::from(duration_minutes));

    sqlx::query(
        "UPDATE admin.support_sessions
         SET status = 'active', customer_notification_queued_at = $2, activated_at = $2, expires_at = $3
         WHERE id = $1",
    )
    .bind(id)
    .bind(now)
    .bind(expires_at)
    .execute(&mut *tx)
    .await?;

    let queued: bool = sqlx::query_scalar("SELECT admin.queue_support_notification($1)")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    if !queued {
        return Err(ApiError::Conflict);
    }

    let active_roles: Vec<String> = staff.roles.iter().map(|r| r.as_str().to_string()).collect();
    record(
        &mut tx,
        StaffAuditEntry {
            staff_user_id: Some(staff.staff_user_id),
            staff_email: Some(&staff.email),
            active_roles: &active_roles,
            action: "support_session.activate",
            workspace_id: Some(tenant_id),
            target_type: Some("support_session"),
            target_id: Some(&id.to_string()),
            request_id: None,
            reason: Some(&reason),
            ticket_ref: Some(&ticket_ref),
            support_session_id: Some(id),
            before_state: Some(json!({ "status": "approved" })),
            after_state: Some(
                json!({ "status": "active", "expiresAt": expires_at, "customerNotificationQueuedAt": now }),
            ),
            outcome: "success",
        },
    )
    .await?;

    tx.commit().await?;
    tracing::info!(%id, %tenant_id, %ticket_ref, "support session activated; customer notification queued");

    Ok(Json(json!({
        "data": {
            "id": id,
            "tenantId": tenant_id,
            "status": "active",
            "activatedAt": now,
            "expiresAt": expires_at,
        }
    })))
}

pub async fn end_session(
    State(state): State<AppState>,
    staff: StaffContext,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    staff.require(&[
        StaffRole::Support,
        StaffRole::Operations,
        StaffRole::StaffAdmin,
    ])?;
    let mut tx = state.admin_pool.begin().await?;
    let row = sqlx::query(
        "SELECT tenant_id, requested_by, status, ticket_ref FROM admin.support_sessions WHERE id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::NotFound)?;

    let tenant_id: Uuid = row.try_get("tenant_id")?;
    let requested_by: Uuid = row.try_get("requested_by")?;
    let status: String = row.try_get("status")?;
    let ticket_ref: String = row.try_get("ticket_ref")?;

    if requested_by != staff.staff_user_id
        && !staff.has_any(&[StaffRole::Operations, StaffRole::StaffAdmin])
    {
        return Err(AuthError::Forbidden.into());
    }

    let next_status = if requested_by == staff.staff_user_id {
        "ended"
    } else {
        "revoked"
    };

    sqlx::query("UPDATE admin.support_sessions SET status = $2, ended_at = now() WHERE id = $1")
        .bind(id)
        .bind(next_status)
        .execute(&mut *tx)
        .await?;

    let active_roles: Vec<String> = staff.roles.iter().map(|r| r.as_str().to_string()).collect();
    record(
        &mut tx,
        StaffAuditEntry {
            staff_user_id: Some(staff.staff_user_id),
            staff_email: Some(&staff.email),
            active_roles: &active_roles,
            action: "support_session.end",
            workspace_id: Some(tenant_id),
            target_type: Some("support_session"),
            target_id: Some(&id.to_string()),
            request_id: None,
            reason: None,
            ticket_ref: Some(&ticket_ref),
            support_session_id: Some(id),
            before_state: Some(json!({ "status": status })),
            after_state: Some(json!({ "status": next_status })),
            outcome: "success",
        },
    )
    .await?;

    tx.commit().await?;
    Ok(Json(json!({ "data": { "id": id, "status": next_status } })))
}

async fn require_active_session(
    tx: &mut Transaction<'_, Postgres>,
    staff: &StaffContext,
    session_id: Uuid,
    require_write: bool,
) -> Result<(Uuid, String, DateTime<Utc>, String), ApiError> {
    let row: Option<Value> =
        sqlx::query_scalar("SELECT admin.support_session_guard($1,$2,$3,false)")
            .bind(session_id)
            .bind(staff.staff_user_id)
            .bind(require_write)
            .fetch_one(&mut **tx)
            .await?;
    let row = row.ok_or(AuthError::Forbidden)?;
    Ok((
        serde_json::from_value(row["tenant_id"].clone()).map_err(|_| ApiError::Internal)?,
        row["mode"].as_str().ok_or(ApiError::Internal)?.to_owned(),
        serde_json::from_value(row["expires_at"].clone()).map_err(|_| ApiError::Internal)?,
        row["ticket_ref"]
            .as_str()
            .ok_or(ApiError::Internal)?
            .to_owned(),
    ))
}

pub async fn view_workspace(
    State(state): State<AppState>,
    staff: StaffContext,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let mut tx = state.admin_pool.begin().await?;
    let (tenant_id, mode, expires_at, ticket_ref) =
        require_active_session(&mut tx, &staff, id, false).await?;

    let mut view: Value = sqlx::query_scalar("SELECT admin.support_workspace_view($1)")
        .bind(tenant_id)
        .fetch_one(&mut *tx)
        .await?;
    view["session"] = json!({
        "id": id,
        "mode": mode,
        "expiresAt": expires_at,
        "ticketRef": ticket_ref,
    });

    let active_roles: Vec<String> = staff.roles.iter().map(|r| r.as_str().to_string()).collect();
    record(
        &mut tx,
        StaffAuditEntry {
            staff_user_id: Some(staff.staff_user_id),
            staff_email: Some(&staff.email),
            active_roles: &active_roles,
            action: "support_session.page_view",
            workspace_id: Some(tenant_id),
            target_type: Some("support_session"),
            target_id: Some(&id.to_string()),
            request_id: None,
            reason: None,
            ticket_ref: Some(&ticket_ref),
            support_session_id: Some(id),
            before_state: None,
            after_state: None,
            outcome: "success",
        },
    )
    .await?;
    tx.commit().await?;

    Ok(Json(json!({ "data": view })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportDraftEditInput {
    title: String,
    body: String,
    reason: Option<String>,
}

pub async fn edit_draft(
    State(state): State<AppState>,
    staff: StaffContext,
    Path((id, post_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<SupportDraftEditInput>,
) -> Result<Json<Value>, ApiError> {
    let mut tx = state.admin_pool.begin().await?;
    let (tenant_id, _mode, _expires_at, ticket_ref) =
        require_active_session(&mut tx, &staff, id, true).await?;
    let title = input.title.trim();
    let body = input.body.trim();
    if title.is_empty() || title.chars().count() > 200 || body.chars().count() > 5000 {
        return Err(ApiError::InvalidInput);
    }

    let row: Option<Value> = sqlx::query_scalar("SELECT admin.support_draft_for_edit($1,$2,$3,$4)")
        .bind(tenant_id)
        .bind(post_id)
        .bind(staff.staff_user_id)
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    let row = row.ok_or(ApiError::NotFound)?;
    let version = row["version"].as_i64().ok_or(ApiError::Internal)? as i32;
    let mut content = row["content"].clone();
    content["caption"] = json!(body);
    crate::content::check_content(&content)?;
    let hash = crate::domain::content_hash(&content);
    let res: Value =
        sqlx::query_scalar("SELECT admin.support_update_draft($1, $2, $3, $4, $5, $6, $7, $8)")
            .bind(tenant_id)
            .bind(post_id)
            .bind(title)
            .bind(&content)
            .bind(hash)
            .bind(staff.staff_user_id)
            .bind(id)
            .bind(version)
            .fetch_one(&mut *tx)
            .await?;

    if !res["ok"].as_bool().unwrap_or(false) {
        return match res["reason"].as_str() {
            Some("not_found") => Err(ApiError::NotFound),
            Some("forbidden") => Err(AuthError::Forbidden.into()),
            _ => Err(ApiError::Conflict),
        };
    }

    let active_roles: Vec<String> = staff.roles.iter().map(|r| r.as_str().to_string()).collect();
    record(
        &mut tx,
        StaffAuditEntry {
            staff_user_id: Some(staff.staff_user_id),
            staff_email: Some(&staff.email),
            active_roles: &active_roles,
            action: "support_session.draft_edit",
            workspace_id: Some(tenant_id),
            target_type: Some("post"),
            target_id: Some(&post_id.to_string()),
            request_id: None,
            reason: input.reason.as_deref(),
            ticket_ref: Some(&ticket_ref),
            support_session_id: Some(id),
            before_state: None,
            after_state: Some(json!({ "title": title, "version": res["version"] })),
            outcome: "success",
        },
    )
    .await?;

    tx.commit().await?;
    Ok(Json(json!({ "data": res })))
}
