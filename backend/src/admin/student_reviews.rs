use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::Response,
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
    AppState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueQuery {
    status: Option<String>,
}

pub async fn list_reviews(
    State(state): State<AppState>,
    staff: StaffContext,
    Query(q): Query<QueueQuery>,
) -> Result<Json<Value>, ApiError> {
    staff.require(&[StaffRole::StudentReviewer, StaffRole::StaffAdmin])?;
    let status = match q.status.as_deref() {
        Some("approved") => "approved",
        Some("rejected") => "rejected",
        Some("all") => "all",
        _ => "pending",
    };
    let items: Value = sqlx::query_scalar("SELECT admin.list_student_reviews($1)")
        .bind(status)
        .fetch_one(&state.admin_pool)
        .await?;
    Ok(Json(json!({ "data": items })))
}

pub async fn get_preview(
    State(state): State<AppState>,
    staff: StaffContext,
    Path(id): Path<Uuid>,
) -> Result<Response, ApiError> {
    staff.require(&[StaffRole::StudentReviewer, StaffRole::StaffAdmin])?;
    let row = sqlx::query(
        "SELECT tenant_id, file_storage_key, preview_storage_key, mime_type, scan_status
         FROM admin.get_student_review_storage($1)",
    )
    .bind(id)
    .fetch_optional(&state.admin_pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    let tenant_id: Uuid = row.try_get("tenant_id")?;

    let preview_key: Option<String> = row.try_get("preview_storage_key")?;
    let mime_type: String = row.try_get("mime_type")?;
    let scan_status: String = row.try_get("scan_status")?;

    if scan_status != "ready" {
        return Err(ApiError::Conflict);
    }

    let (storage_key, content_type) = match preview_key {
        Some(pk) => {
            let ct = if mime_type == "application/pdf" {
                "image/png".to_owned()
            } else {
                mime_type
            };
            (pk, ct)
        }
        None => return Err(ApiError::Conflict),
    };

    // PDFs are never served as active documents, even for legacy rows.
    if content_type != "image/png" && content_type != "image/jpeg" {
        return Err(ApiError::Conflict);
    }
    let bytes = state.storage.read(&storage_key).await?;

    let mut tx = state.admin_pool.begin().await?;
    let active_roles: Vec<String> = staff.roles.iter().map(|r| r.as_str().to_string()).collect();
    record(
        &mut tx,
        StaffAuditEntry {
            staff_user_id: Some(staff.staff_user_id),
            staff_email: Some(&staff.email),
            active_roles: &active_roles,
            action: "student_review.document_view",
            workspace_id: Some(tenant_id),
            target_type: Some("student_submission"),
            target_id: Some(&id.to_string()),
            request_id: None,
            reason: None,
            ticket_ref: None,
            support_session_id: None,
            before_state: None,
            after_state: None,
            outcome: "success",
        },
    )
    .await?;
    tx.commit().await?;

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-store, private")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(
            header::CONTENT_SECURITY_POLICY,
            "default-src 'none'; sandbox",
        )
        .body(Body::from(bytes))
        .unwrap())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DecisionInput {
    expected_version: i32,
    decision: String,
    name_matches: Option<bool>,
    school_recognised: Option<bool>,
    expiry_future_dated: Option<bool>,
    genuine_card: Option<bool>,
    rejection_reason: Option<String>,
}

pub async fn decide_review(
    State(state): State<AppState>,
    staff: StaffContext,
    Path(id): Path<Uuid>,
    Json(input): Json<DecisionInput>,
) -> Result<Json<Value>, ApiError> {
    staff.require(&[StaffRole::StudentReviewer, StaffRole::StaffAdmin])?;
    let decision = input.decision.as_str();
    if decision != "approved" && decision != "rejected" {
        return Err(ApiError::InvalidInput);
    }

    if decision == "approved" {
        let all_checked = input.name_matches.unwrap_or(false)
            && input.school_recognised.unwrap_or(false)
            && input.expiry_future_dated.unwrap_or(false)
            && input.genuine_card.unwrap_or(false);
        if !all_checked {
            return Err(ApiError::InvalidInput);
        }
    } else if input
        .rejection_reason
        .as_deref()
        .is_none_or(|r| r.trim().is_empty())
    {
        return Err(ApiError::InvalidInput);
    }

    let checklist = json!({
        "nameMatches": input.name_matches.unwrap_or(false),
        "schoolRecognised": input.school_recognised.unwrap_or(false),
        "expiryFutureDated": input.expiry_future_dated.unwrap_or(false),
        "genuineCard": input.genuine_card.unwrap_or(false),
    });

    let mut tx = state.admin_pool.begin().await?;
    let row = sqlx::query(
        "SELECT outcome, tenant_id, applicant_email, applicant_name, plan_ends_at
         FROM admin.decide_student_review($1, $2, $3, $4, $5, $6)",
    )
    .bind(id)
    .bind(input.expected_version)
    .bind(decision)
    .bind(staff.staff_user_id)
    .bind(&checklist)
    .bind(input.rejection_reason.as_deref().map(str::trim))
    .fetch_one(&mut *tx)
    .await?;

    let outcome: String = row.try_get("outcome")?;
    let tenant_id: Option<Uuid> = row.try_get("tenant_id")?;
    let applicant_email: Option<String> = row.try_get("applicant_email")?;
    let plan_ends_at: Option<chrono::DateTime<chrono::Utc>> = row.try_get("plan_ends_at")?;

    match outcome.as_str() {
        "not_found" => return Err(ApiError::NotFound),
        "conflict" | "not_ready" => return Err(ApiError::Conflict),
        "expired_card" | "invalid" => return Err(ApiError::InvalidInput),
        _ => {}
    }

    let active_roles: Vec<String> = staff.roles.iter().map(|r| r.as_str().to_string()).collect();
    let audit_action = if decision == "approved" {
        "student_review.approve"
    } else {
        "student_review.reject"
    };
    record(
        &mut tx,
        StaffAuditEntry {
            staff_user_id: Some(staff.staff_user_id),
            staff_email: Some(&staff.email),
            active_roles: &active_roles,
            action: audit_action,
            workspace_id: tenant_id,
            target_type: Some("student_submission"),
            target_id: Some(&id.to_string()),
            request_id: None,
            reason: input.rejection_reason.as_deref().map(str::trim),
            ticket_ref: None,
            support_session_id: None,
            before_state: Some(
                json!({ "decisionStatus": "pending", "version": input.expected_version }),
            ),
            after_state: Some(json!({
                "decisionStatus": decision,
                "planEndsAt": plan_ends_at,
                "checklist": checklist,
            })),
            outcome: "success",
        },
    )
    .await?;

    tx.commit().await?;

    if let Some(email) = applicant_email.as_deref() {
        tracing::info!(%id, %email, decision, "student ID review decision recorded");
    }

    Ok(Json(json!({
        "data": {
            "id": id,
            "decisionStatus": decision,
            "planEndsAt": plan_ends_at,
        }
    })))
}

/// Worker entry point: expiry is atomic and document deletion retries on failure.
pub async fn maintain_student_documents(state: &AppState) -> Result<(), ApiError> {
    sqlx::query("SELECT admin.expire_student_entitlements()")
        .execute(&state.admin_pool)
        .await?;
    let due = sqlx::query("SELECT id,file_storage_key,preview_storage_key FROM admin.student_documents_due_for_purge()")
        .fetch_all(&state.admin_pool).await?;
    for row in due {
        let id: Uuid = row.try_get("id")?;
        let file: String = row.try_get("file_storage_key")?;
        let preview: Option<String> = row.try_get("preview_storage_key")?;
        async fn delete_if_present(state: &AppState, key: &str) -> Result<(), ApiError> {
            match state.storage.delete(key).await {
                Ok(()) => Ok(()),
                Err(crate::storage::StorageError::Store(object_store::Error::NotFound {
                    ..
                })) => Ok(()),
                Err(err) => Err(err.into()),
            }
        }
        delete_if_present(state, &file).await?;
        if let Some(key) = preview.filter(|key| key != &file) {
            delete_if_present(state, &key).await?;
        }
        sqlx::query("SELECT admin.mark_student_documents_purged($1)")
            .bind(id)
            .execute(&state.admin_pool)
            .await?;
    }
    Ok(())
}
