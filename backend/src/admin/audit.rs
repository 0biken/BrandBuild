//! Append-only staff audit log writer and query endpoints.
//! Every staff mutation calls `record` inside the same database transaction as the change.
use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, StatusCode},
    response::Response,
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{api::ApiError, auth::AuthError, AppState};

use super::{StaffContext, StaffRole};

pub struct StaffAuditEntry<'a> {
    pub staff_user_id: Option<Uuid>,
    pub staff_email: Option<&'a str>,
    pub active_roles: &'a [String],
    pub action: &'a str,
    pub workspace_id: Option<Uuid>,
    pub target_type: Option<&'a str>,
    pub target_id: Option<&'a str>,
    pub request_id: Option<&'a str>,
    pub reason: Option<&'a str>,
    pub ticket_ref: Option<&'a str>,
    pub support_session_id: Option<Uuid>,
    pub before_state: Option<Value>,
    pub after_state: Option<Value>,
    pub outcome: &'a str,
}

pub async fn record(
    tx: &mut Transaction<'_, Postgres>,
    entry: StaffAuditEntry<'_>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO admin.staff_audit_log(
            staff_user_id, staff_email, active_roles, action, workspace_id,
            target_type, target_id, request_id, reason, ticket_ref,
            support_session_id, before_state, after_state, outcome
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
    )
    .bind(entry.staff_user_id)
    .bind(entry.staff_email)
    .bind(entry.active_roles)
    .bind(entry.action)
    .bind(entry.workspace_id)
    .bind(entry.target_type)
    .bind(entry.target_id)
    .bind(entry.request_id)
    .bind(entry.reason)
    .bind(entry.ticket_ref)
    .bind(entry.support_session_id)
    .bind(entry.before_state)
    .bind(entry.after_state)
    .bind(entry.outcome)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub struct CtxAudit<'a> {
    pub action: &'a str,
    pub workspace_id: Option<Uuid>,
    pub target_type: Option<&'a str>,
    pub target_id: Option<&'a str>,
    pub reason: Option<&'a str>,
    pub before_state: Option<Value>,
    pub after_state: Option<Value>,
}

pub async fn record_ctx(
    tx: &mut Transaction<'_, Postgres>,
    ctx: &StaffContext,
    entry: CtxAudit<'_>,
) -> Result<(), sqlx::Error> {
    let roles: Vec<String> = ctx.roles.iter().map(|r| r.as_str().to_owned()).collect();
    record(
        tx,
        StaffAuditEntry {
            staff_user_id: Some(ctx.staff_user_id),
            staff_email: Some(&ctx.email),
            active_roles: &roles,
            action: entry.action,
            workspace_id: entry.workspace_id,
            target_type: entry.target_type,
            target_id: entry.target_id,
            request_id: None,
            reason: entry.reason,
            ticket_ref: None,
            support_session_id: None,
            before_state: entry.before_state,
            after_state: entry.after_state,
            outcome: "success",
        },
    )
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditQuery {
    pub staff_user_id: Option<Uuid>,
    pub workspace_id: Option<Uuid>,
    pub action: Option<String>,
    pub limit: Option<i64>,
}

pub async fn list_audit(
    State(s): State<AppState>,
    ctx: StaffContext,
    Query(q): Query<AuditQuery>,
) -> Result<Json<Value>, ApiError> {
    ctx.require(&[
        StaffRole::Support,
        StaffRole::Operations,
        StaffRole::StudentReviewer,
        StaffRole::StaffAdmin,
    ])
    .map_err(|e| match e {
        AuthError::Forbidden => ApiError::Forbidden,
        _ => ApiError::Internal,
    })?;
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let rows = sqlx::query(
        "SELECT id, staff_user_id, staff_email, active_roles, action, workspace_id,
                target_type, target_id, request_id, reason, ticket_ref,
                support_session_id, before_state, after_state, outcome, created_at
         FROM admin.staff_audit_log
         WHERE ($1::uuid IS NULL OR staff_user_id = $1)
           AND ($2::uuid IS NULL OR workspace_id = $2)
           AND ($3::text IS NULL OR action = $3)
         ORDER BY created_at DESC, id DESC
         LIMIT $4",
    )
    .bind(q.staff_user_id)
    .bind(q.workspace_id)
    .bind(q.action.as_deref().filter(|a| !a.trim().is_empty()))
    .bind(limit)
    .fetch_all(&s.admin_pool)
    .await?;

    let mut data = Vec::with_capacity(rows.len());
    for row in rows {
        data.push(json!({
            "id": row.try_get::<Uuid, _>("id")?,
            "staffUserId": row.try_get::<Option<Uuid>, _>("staff_user_id")?,
            "staffEmail": row.try_get::<Option<String>, _>("staff_email")?,
            "activeRoles": row.try_get::<Vec<String>, _>("active_roles")?,
            "action": row.try_get::<String, _>("action")?,
            "workspaceId": row.try_get::<Option<Uuid>, _>("workspace_id")?,
            "targetType": row.try_get::<Option<String>, _>("target_type")?,
            "targetId": row.try_get::<Option<String>, _>("target_id")?,
            "requestId": row.try_get::<Option<String>, _>("request_id")?,
            "reason": row.try_get::<Option<String>, _>("reason")?,
            "ticketRef": row.try_get::<Option<String>, _>("ticket_ref")?,
            "supportSessionId": row.try_get::<Option<Uuid>, _>("support_session_id")?,
            "beforeState": row.try_get::<Option<Value>, _>("before_state")?,
            "afterState": row.try_get::<Option<Value>, _>("after_state")?,
            "outcome": row.try_get::<String, _>("outcome")?,
            "createdAt": row.try_get::<DateTime<Utc>, _>("created_at")?.to_rfc3339(),
        }));
    }
    Ok(Json(json!({ "data": data })))
}

/// Neutralizes spreadsheet formula-injection prefixes (`=`, `+`, `-`, `@`, tab, CR)
/// and quotes RFC 4180 CSV cells.
pub fn csv_safe_cell(raw: &str) -> String {
    let trimmed = raw.trim_start_matches(' ');
    let neutralized = if trimmed.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{raw}")
    } else {
        raw.to_owned()
    };
    if neutralized.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", neutralized.replace('"', "\"\""))
    } else {
        neutralized
    }
}

pub async fn export_audit_csv(
    State(s): State<AppState>,
    ctx: StaffContext,
    Query(q): Query<AuditQuery>,
) -> Result<Response, ApiError> {
    ctx.require(&[
        StaffRole::Support,
        StaffRole::Operations,
        StaffRole::StudentReviewer,
        StaffRole::StaffAdmin,
    ])
    .map_err(|e| match e {
        AuthError::Forbidden => ApiError::Forbidden,
        _ => ApiError::Internal,
    })?;

    let limit = q.limit.unwrap_or(500).clamp(1, 2000);
    let rows = sqlx::query(
        "SELECT id, staff_email, active_roles, action, workspace_id,
                target_type, target_id, reason, ticket_ref, outcome, created_at
         FROM admin.staff_audit_log
         WHERE ($1::uuid IS NULL OR staff_user_id = $1)
           AND ($2::uuid IS NULL OR workspace_id = $2)
           AND ($3::text IS NULL OR action = $3)
         ORDER BY created_at DESC, id DESC
         LIMIT $4",
    )
    .bind(q.staff_user_id)
    .bind(q.workspace_id)
    .bind(q.action.as_deref().filter(|a| !a.trim().is_empty()))
    .bind(limit)
    .fetch_all(&s.admin_pool)
    .await?;

    let mut csv = String::from(
        "id,createdAt,staffEmail,activeRoles,action,workspaceId,targetType,targetId,reason,ticketRef,outcome\r\n",
    );
    for row in &rows {
        let id = row.try_get::<Uuid, _>("id")?.to_string();
        let created_at = row.try_get::<DateTime<Utc>, _>("created_at")?.to_rfc3339();
        let staff_email = row
            .try_get::<Option<String>, _>("staff_email")?
            .unwrap_or_default();
        let roles = row.try_get::<Vec<String>, _>("active_roles")?.join("|");
        let action = row.try_get::<String, _>("action")?;
        let ws_id = row
            .try_get::<Option<Uuid>, _>("workspace_id")?
            .map(|u| u.to_string())
            .unwrap_or_default();
        let target_type = row
            .try_get::<Option<String>, _>("target_type")?
            .unwrap_or_default();
        let target_id = row
            .try_get::<Option<String>, _>("target_id")?
            .unwrap_or_default();
        let reason = row
            .try_get::<Option<String>, _>("reason")?
            .unwrap_or_default();
        let ticket_ref = row
            .try_get::<Option<String>, _>("ticket_ref")?
            .unwrap_or_default();
        let outcome = row.try_get::<String, _>("outcome")?;

        let cells = [
            csv_safe_cell(&id),
            csv_safe_cell(&created_at),
            csv_safe_cell(&staff_email),
            csv_safe_cell(&roles),
            csv_safe_cell(&action),
            csv_safe_cell(&ws_id),
            csv_safe_cell(&target_type),
            csv_safe_cell(&target_id),
            csv_safe_cell(&reason),
            csv_safe_cell(&ticket_ref),
            csv_safe_cell(&outcome),
        ];
        csv.push_str(&cells.join(","));
        csv.push_str("\r\n");
    }

    let mut tx = s.admin_pool.begin().await?;
    let active_roles: Vec<String> = ctx.roles.iter().map(|r| r.as_str().to_string()).collect();
    record(
        &mut tx,
        StaffAuditEntry {
            staff_user_id: Some(ctx.staff_user_id),
            staff_email: Some(&ctx.email),
            active_roles: &active_roles,
            action: "audit.export",
            workspace_id: q.workspace_id,
            target_type: Some("staff_audit_log"),
            target_id: None,
            request_id: None,
            reason: None,
            ticket_ref: None,
            support_session_id: None,
            before_state: None,
            after_state: Some(json!({ "rowCount": rows.len() })),
            outcome: "success",
        },
    )
    .await?;
    tx.commit().await?;

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/csv; charset=utf-8")
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=\"brandbuild-staff-audit.csv\"",
        )
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(csv))
        .unwrap())
}

#[cfg(test)]
mod tests {
    use super::csv_safe_cell;

    #[test]
    fn csv_neutralizes_formula_injection() {
        assert_eq!(csv_safe_cell("=CMD()"), "'=CMD()");
        assert_eq!(csv_safe_cell("+1+2"), "'+1+2");
        assert_eq!(csv_safe_cell("-2+3"), "'-2+3");
        assert_eq!(csv_safe_cell("@SUM(A1)"), "'@SUM(A1)");
        assert_eq!(csv_safe_cell("normal, text"), "\"normal, text\"");
    }
}
