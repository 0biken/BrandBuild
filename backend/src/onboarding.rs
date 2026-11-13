//! Student check and onboarding progress (docs/api/openapi.yaml, tag `onboarding`).
//! Everything here is per workspace and runs in a tenant transaction.
use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{Postgres, Row, Transaction};

use crate::{
    api::ApiError,
    auth::TenantContext,
    auth_api::{consume_code, send_code_email, store_code, AuthApiError},
    db::tenant_tx,
    AppState,
};

impl From<AuthApiError> for ApiError {
    fn from(err: AuthApiError) -> Self {
        match err {
            AuthApiError::Invalid => Self::InvalidInput,
            AuthApiError::InvalidCode => Self::InvalidCode,
            AuthApiError::CodeExpired => Self::CodeExpired,
            AuthApiError::EmailUnavailable => Self::EmailUnavailable,
            _ => Self::Internal,
        }
    }
}

/// True for school addresses: `.edu`, `.edu.<country>`, `.ac.<country>`, or a domain
/// listed (comma-separated) in STUDENT_EMAIL_DOMAINS, including its subdomains.
pub fn is_academic(email: &str, extra_domains: &str) -> bool {
    let email = email.trim().to_ascii_lowercase();
    let Some((_, domain)) = email.rsplit_once('@') else {
        return false;
    };
    let labels: Vec<&str> = domain.split('.').collect();
    if labels.len() < 2 || labels.iter().any(|label| label.is_empty()) {
        return false;
    }
    let last = labels[labels.len() - 1];
    let second = labels[labels.len() - 2];
    let standard = last == "edu"
        || (labels.len() >= 3
            && (second == "edu" || second == "ac")
            && last.len() == 2
            && last.bytes().all(|b| b.is_ascii_alphabetic()));
    standard
        || extra_domains
            .split(',')
            .map(|d| d.trim().to_ascii_lowercase())
            .filter(|d| !d.is_empty())
            .any(|d| domain == d || domain.ends_with(&format!(".{d}")))
}

async fn student_state(tx: &mut Transaction<'static, Postgres>) -> Result<Value, ApiError> {
    let row = sqlx::query("SELECT status,method,email FROM student_checks")
        .fetch_optional(&mut **tx)
        .await?;
    let Some(row) = row else {
        return Ok(json!({"status":"none"}));
    };
    let mut out = json!({"status": row.try_get::<String, _>("status")?});
    if let Some(method) = row.try_get::<Option<String>, _>("method")? {
        out["method"] = json!(method);
    }
    if let Some(email) = row.try_get::<Option<String>, _>("email")? {
        out["email"] = json!(email);
    }
    Ok(out)
}

async fn set_student(
    tx: &mut Transaction<'static, Postgres>,
    ctx: &TenantContext,
    status: &str,
    method: Option<&str>,
    email: Option<&str>,
) -> Result<(), ApiError> {
    sqlx::query(
        "INSERT INTO student_checks(tenant_id,status,method,email,checked_at) VALUES($1,$2,$3,$4,CASE WHEN $2 IN ('verified','not_student') THEN now() END)
         ON CONFLICT(tenant_id) DO UPDATE SET status=EXCLUDED.status,method=EXCLUDED.method,email=EXCLUDED.email,checked_at=EXCLUDED.checked_at,updated_at=now()",
    )
    .bind(ctx.tenant_id)
    .bind(status)
    .bind(method)
    .bind(email)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn set_plan(
    tx: &mut Transaction<'static, Postgres>,
    ctx: &TenantContext,
    plan: &str,
) -> Result<(), ApiError> {
    sqlx::query("UPDATE tenants SET plan=$2,updated_at=now() WHERE id=$1")
        .bind(ctx.tenant_id)
        .bind(plan)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn get_student_check(
    State(s): State<AppState>,
    ctx: TenantContext,
) -> Result<Json<Value>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let state = student_state(&mut tx).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": state })))
}

#[derive(Deserialize)]
struct StudentEmailInput {
    email: String,
}

async fn send_student_code(
    State(s): State<AppState>,
    ctx: TenantContext,
    Json(input): Json<StudentEmailInput>,
) -> Result<Json<Value>, ApiError> {
    let email = input.email.trim().to_ascii_lowercase();
    let extra = std::env::var("STUDENT_EMAIL_DOMAINS").unwrap_or_default();
    if !is_academic(&email, &extra) {
        return Err(ApiError::InvalidInput);
    }
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let code = store_code(&mut tx, ctx.actor_id, "student_email").await?;
    set_student(&mut tx, &ctx, "code_sent", Some("email"), Some(&email)).await?;
    send_code_email(&email, &code, "student_email").await?;
    let state = student_state(&mut tx).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": state })))
}

#[derive(Deserialize)]
struct CodeOnlyInput {
    code: String,
}

async fn verify_student_code(
    State(s): State<AppState>,
    ctx: TenantContext,
    Json(input): Json<CodeOnlyInput>,
) -> Result<Json<Value>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let current = student_state(&mut tx).await?;
    if current["status"] != "code_sent" {
        return Err(ApiError::Conflict);
    }
    if consume_code(&mut tx, ctx.actor_id, &["student_email"], &input.code)
        .await?
        .is_none()
    {
        tx.commit().await?;
        return Err(ApiError::InvalidCode);
    }
    let email = current["email"].as_str().map(str::to_owned);
    set_student(&mut tx, &ctx, "verified", Some("email"), email.as_deref()).await?;
    set_plan(&mut tx, &ctx, "student").await?;
    let state = student_state(&mut tx).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": state })))
}

/// ID upload is deferred until media storage exists.
async fn submit_student_id() -> ApiError {
    ApiError::NotAvailable
}

async fn skip_student_check(
    State(s): State<AppState>,
    ctx: TenantContext,
) -> Result<Json<Value>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    set_student(&mut tx, &ctx, "not_student", None, None).await?;
    set_plan(&mut tx, &ctx, "creator").await?;
    let state = student_state(&mut tx).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": state })))
}

async fn onboarding_state(tx: &mut Transaction<'static, Postgres>) -> Result<Value, ApiError> {
    let row = sqlx::query("SELECT verify,connect,brand FROM onboarding_steps")
        .fetch_optional(&mut **tx)
        .await?;
    Ok(match row {
        Some(row) => json!({
            "verify": row.try_get::<String, _>("verify")?,
            "connect": row.try_get::<String, _>("connect")?,
            "brand": row.try_get::<String, _>("brand")?,
        }),
        None => json!({"verify":"todo","connect":"todo","brand":"todo"}),
    })
}

async fn get_onboarding(
    State(s): State<AppState>,
    ctx: TenantContext,
) -> Result<Json<Value>, ApiError> {
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    let state = onboarding_state(&mut tx).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": state })))
}

#[derive(Deserialize)]
struct StepInput {
    status: String,
}

async fn complete_step(
    State(s): State<AppState>,
    ctx: TenantContext,
    Path(step): Path<String>,
    Json(input): Json<StepInput>,
) -> Result<Json<Value>, ApiError> {
    // Column names come from this fixed list, never from the request.
    let column = match step.as_str() {
        "verify" => "verify",
        "connect" => "connect",
        "brand" => "brand",
        _ => return Err(ApiError::NotFound),
    };
    if input.status != "done" && input.status != "skipped" {
        return Err(ApiError::InvalidInput);
    }
    let mut tx = tenant_tx(&s.pool, ctx.tenant_id).await?;
    sqlx::query(&format!(
        "INSERT INTO onboarding_steps(tenant_id,{column}) VALUES($1,$2) ON CONFLICT(tenant_id) DO UPDATE SET {column}=EXCLUDED.{column},updated_at=now()"
    ))
    .bind(ctx.tenant_id)
    .bind(&input.status)
    .execute(&mut *tx)
    .await?;
    let state = onboarding_state(&mut tx).await?;
    tx.commit().await?;
    Ok(Json(json!({ "data": state })))
}

/// Mounted inside the authenticated `/v1` router.
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/student-check", get(get_student_check))
        .route("/student-check/code", post(send_student_code))
        .route("/student-check/code/verify", post(verify_student_code))
        .route("/student-check/id", post(submit_student_id))
        .route("/student-check/skip", post(skip_student_check))
        .route("/onboarding", get(get_onboarding))
        .route("/onboarding/:step", post(complete_step))
}

#[cfg(test)]
mod tests {
    use super::is_academic;

    #[test]
    fn school_addresses_count() {
        assert!(is_academic("ada@stu.ui.edu.ng", ""));
        assert!(is_academic("ada@ox.ac.uk", ""));
        assert!(is_academic("ada@mit.edu", ""));
        assert!(is_academic("Ada@Student.Unilag.EDU.NG", ""));
    }

    #[test]
    fn other_addresses_do_not() {
        assert!(!is_academic("ada@gmail.com", ""));
        assert!(!is_academic("ada@edu.com", ""));
        assert!(!is_academic("ada@ac.com", ""));
        assert!(!is_academic("not-an-email", ""));
        assert!(!is_academic("ada@.edu", ""));
    }

    #[test]
    fn extra_domains_and_their_subdomains_count() {
        assert!(is_academic(
            "ada@covenantuniversity.org",
            "covenantuniversity.org"
        ));
        assert!(is_academic(
            "ada@stu.covenantuniversity.org",
            " other.org , covenantuniversity.org"
        ));
        assert!(!is_academic(
            "ada@notcovenantuniversity.org",
            "covenantuniversity.org"
        ));
    }
}
