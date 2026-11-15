use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    admin::{
        audit::{record, StaffAuditEntry},
        StaffContext, StaffRole,
    },
    api::ApiError,
    publishing::{DefaultNoopConnector, ReconcileOutcome, SocialConnector},
    AppState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnclearQuery {
    platform: Option<String>,
    workspace_id: Option<Uuid>,
}

pub async fn list_unclear(
    State(state): State<AppState>,
    staff: StaffContext,
    Query(q): Query<UnclearQuery>,
) -> Result<Json<Value>, ApiError> {
    staff.require(&[
        StaffRole::Support,
        StaffRole::Operations,
        StaffRole::StaffAdmin,
    ])?;
    let platform = q.platform.as_deref().filter(|p| !p.trim().is_empty());
    let items: Value = sqlx::query_scalar("SELECT admin.list_unclear_attempts($1, $2)")
        .bind(platform)
        .bind(q.workspace_id)
        .fetch_one(&state.admin_pool)
        .await?;
    Ok(Json(json!({ "data": items })))
}

pub async fn reconcile_attempt(
    State(state): State<AppState>,
    staff: StaffContext,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    staff.require(&[StaffRole::Operations, StaffRole::StaffAdmin])?;
    let row = sqlx::query(
        "SELECT pa.tenant_id, pa.idempotency_key, pa.platform_post_id, c.provider
         FROM publish_attempts pa
         LEFT JOIN channels c ON c.id = pa.channel_id
         WHERE pa.id = $1",
    )
    .bind(id)
    .fetch_optional(&state.admin_pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    let tenant_id: Uuid = row.try_get("tenant_id")?;
    let idempotency_key: String = row.try_get("idempotency_key")?;
    let platform_post_id: Option<String> = row.try_get("platform_post_id")?;
    let provider: String = row
        .try_get::<Option<String>, _>("provider")?
        .unwrap_or_else(|| "ig".to_owned());

    let connector = DefaultNoopConnector;
    let outcome = connector
        .reconcile(&provider, &idempotency_key, platform_post_id.as_deref())
        .await;

    let (evidence, receipt, resolved_pid) = match &outcome {
        ReconcileOutcome::ConfirmedPublished {
            platform_post_id: pid,
            receipt,
        } => (
            json!({
                "status": "confirmed_published",
                "platformPostId": pid,
                "retryEligible": false,
            }),
            Some(receipt.clone()),
            Some(pid.clone()),
        ),
        ReconcileOutcome::ConfirmedNotPublished {
            reason,
            retry_eligible,
        } => (
            json!({
                "status": "confirmed_not_published",
                "reason": reason,
                "retryEligible": retry_eligible,
            }),
            None,
            None,
        ),
        ReconcileOutcome::Inconclusive { reason } => (
            json!({
                "status": "inconclusive",
                "reason": reason,
                "retryEligible": false,
            }),
            None,
            None,
        ),
    };

    let saved: Value = sqlx::query_scalar("SELECT admin.save_reconcile_evidence($1, $2, $3, $4)")
        .bind(id)
        .bind(&evidence)
        .bind(&receipt)
        .bind(&resolved_pid)
        .fetch_one(&state.admin_pool)
        .await?;

    let mut tx = state.admin_pool.begin().await?;
    let active_roles: Vec<String> = staff.roles.iter().map(|r| r.as_str().to_string()).collect();
    record(
        &mut tx,
        StaffAuditEntry {
            staff_user_id: Some(staff.staff_user_id),
            staff_email: Some(&staff.email),
            active_roles: &active_roles,
            action: "publish_attempt.reconcile",
            workspace_id: Some(tenant_id),
            target_type: Some("publish_attempt"),
            target_id: Some(&id.to_string()),
            request_id: None,
            reason: None,
            ticket_ref: None,
            support_session_id: None,
            before_state: None,
            after_state: Some(evidence),
            outcome: "success",
        },
    )
    .await?;
    tx.commit().await?;

    Ok(Json(json!({ "data": saved })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolveAttemptInput {
    expected_version: i32,
    idempotency_key: String,
    action: String,
    note: String,
    receipt: Option<Value>,
}

pub async fn resolve_attempt(
    State(state): State<AppState>,
    staff: StaffContext,
    Path(id): Path<Uuid>,
    Json(input): Json<ResolveAttemptInput>,
) -> Result<Json<Value>, ApiError> {
    staff.require(&[StaffRole::Operations, StaffRole::StaffAdmin])?;
    let note = input.note.trim();
    let idem = input.idempotency_key.trim();
    if note.is_empty() || idem.is_empty() || idem.chars().count() > 160 {
        return Err(ApiError::InvalidInput);
    }
    if !matches!(
        input.action.as_str(),
        "confirm_published" | "mark_failed" | "retry" | "escalate"
    ) {
        return Err(ApiError::InvalidInput);
    }

    let mut tx = state.admin_pool.begin().await?;
    let res: Value =
        sqlx::query_scalar("SELECT admin.resolve_publish_attempt($1, $2, $3, $4, $5, $6, $7)")
            .bind(id)
            .bind(input.expected_version)
            .bind(idem)
            .bind(&input.action)
            .bind(staff.staff_user_id)
            .bind(note)
            .bind(&input.receipt)
            .fetch_one(&mut *tx)
            .await?;

    if !res["ok"].as_bool().unwrap_or(false) {
        return match res["reason"].as_str() {
            Some("not_found") => Err(ApiError::NotFound),
            Some("missing_receipt") | Some("retry_not_confirmed") | Some("invalid_action") => {
                Err(ApiError::InvalidInput)
            }
            _ => Err(ApiError::Conflict),
        };
    }

    let tenant_id = res["tenantId"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok());
    let active_roles: Vec<String> = staff.roles.iter().map(|r| r.as_str().to_string()).collect();
    let audit_action = format!("publish_attempt.{}", input.action);
    record(
        &mut tx,
        StaffAuditEntry {
            staff_user_id: Some(staff.staff_user_id),
            staff_email: Some(&staff.email),
            active_roles: &active_roles,
            action: &audit_action,
            workspace_id: tenant_id,
            target_type: Some("publish_attempt"),
            target_id: Some(&id.to_string()),
            request_id: Some(idem),
            reason: Some(note),
            ticket_ref: None,
            support_session_id: None,
            before_state: Some(json!({ "version": input.expected_version })),
            after_state: Some(res.clone()),
            outcome: "success",
        },
    )
    .await?;

    tx.commit().await?;
    Ok(Json(json!({ "data": res })))
}
