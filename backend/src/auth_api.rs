use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::State,
    http::{header::SET_COOKIE, HeaderMap, StatusCode},
    response::{AppendHeaders, IntoResponse, Response},
    routing::post,
    Json, Router,
};
use chrono::{Duration, Utc};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use lettre::{
    message::Mailbox, transport::smtp::authentication::Credentials, AsyncSmtpTransport,
    AsyncTransport, Message, Tokio1Executor,
};
use rand::{distributions::Uniform, prelude::Distribution, thread_rng};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{
    auth::{cookie_value, set_cookie, TenantContext, RESET_COOKIE, SESSION_COOKIE},
    AppState,
};

const CODE_TTL_MINUTES: i64 = 10;
const MAX_CODE_ATTEMPTS: i32 = 5;
const MAX_RESET_TOKEN_MINUTES: i64 = 15;
const SESSION_HOURS: i64 = 12;

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    tenant_id: String,
    exp: usize,
    #[serde(default)]
    purpose: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SignUpInput {
    name: String,
    identifier: String,
    password: String,
}
#[derive(Debug, Deserialize)]
pub struct LoginInput {
    identifier: String,
    password: String,
}
#[derive(Debug, Deserialize)]
pub struct CodeInput {
    identifier: String,
    code: String,
}
#[derive(Debug, Deserialize)]
pub struct RequestCodeInput {
    identifier: String,
}
#[derive(Debug, Deserialize)]
pub struct ResetPasswordInput {
    password: String,
}

#[derive(Debug, thiserror::Error)]
pub enum AuthApiError {
    #[error("request data is invalid")]
    Invalid,
    #[error("email or password is incorrect")]
    Unauthorized,
    #[error("email is already registered")]
    Conflict,
    #[error("verification code is invalid or expired")]
    InvalidCode,
    #[error("verification code has expired")]
    CodeExpired,
    #[error("please verify your email first")]
    EmailNotVerified,
    #[error("we couldn't send the email; try again in a moment")]
    EmailUnavailable,
    #[error("authentication is not configured")]
    NotConfigured,
    #[error("internal server error")]
    Internal,
}
impl axum::response::IntoResponse for AuthApiError {
    fn into_response(self) -> axum::response::Response {
        let (status, code) = match self {
            Self::Invalid => (StatusCode::UNPROCESSABLE_ENTITY, "invalid_request"),
            Self::Unauthorized => (StatusCode::UNAUTHORIZED, "invalid_credentials"),
            Self::Conflict => (StatusCode::CONFLICT, "account_exists"),
            Self::InvalidCode => (StatusCode::UNAUTHORIZED, "invalid_code"),
            Self::CodeExpired => (StatusCode::GONE, "code_expired"),
            Self::EmailNotVerified => (StatusCode::FORBIDDEN, "email_not_verified"),
            Self::EmailUnavailable => (StatusCode::SERVICE_UNAVAILABLE, "email_unavailable"),
            Self::NotConfigured => (StatusCode::SERVICE_UNAVAILABLE, "auth_not_configured"),
            Self::Internal => (StatusCode::INTERNAL_SERVER_ERROR, "internal_error"),
        };
        (
            status,
            Json(json!({"error":{"code":code,"message":self.to_string()}})),
        )
            .into_response()
    }
}

fn normalized_email(value: &str) -> Result<String, AuthApiError> {
    let email = value.trim().to_ascii_lowercase();
    let mut parts = email.split('@');
    let local_ok = parts
        .next()
        .is_some_and(|part| !part.is_empty() && part.len() <= 64);
    let domain_ok = parts
        .next()
        .is_some_and(|part| part.contains('.') && !part.starts_with('.') && !part.ends_with('.'));
    if !local_ok || !domain_ok || parts.next().is_some() || email.len() > 254 {
        return Err(AuthApiError::Invalid);
    }
    Ok(email)
}

fn validate_password(password: &str) -> Result<(), AuthApiError> {
    if !(8..=128).contains(&password.len())
        || !password
            .chars()
            .any(|character| character.is_ascii_uppercase())
        || !password
            .chars()
            .any(|character| character.is_ascii_lowercase())
        || !password.chars().any(|character| character.is_ascii_digit())
    {
        return Err(AuthApiError::Invalid);
    }
    Ok(())
}

fn hash_password(password: &str) -> Result<String, AuthApiError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| AuthApiError::Internal)
}

fn verify_hash(value: &str, hash: &str) -> bool {
    PasswordHash::new(hash).ok().is_some_and(|parsed| {
        Argon2::default()
            .verify_password(value.as_bytes(), &parsed)
            .is_ok()
    })
}

fn jwt_secret() -> Result<Vec<u8>, AuthApiError> {
    let secret = std::env::var("JWT_SECRET").map_err(|_| AuthApiError::NotConfigured)?;
    if secret.len() < 32 {
        return Err(AuthApiError::NotConfigured);
    }
    Ok(secret.into_bytes())
}

fn signed_token(
    user_id: Uuid,
    tenant_id: Uuid,
    lifetime: Duration,
    purpose: Option<&str>,
) -> Result<String, AuthApiError> {
    let claims = Claims {
        sub: user_id.to_string(),
        tenant_id: tenant_id.to_string(),
        exp: (Utc::now() + lifetime).timestamp() as usize,
        purpose: purpose.map(str::to_owned),
    };

    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(&jwt_secret()?),
    )
    .map_err(|_| AuthApiError::Internal)
}

fn generate_code() -> String {
    Uniform::from(0..10)
        .sample_iter(&mut thread_rng())
        .take(6)
        .map(|digit| char::from(b'0' + digit as u8))
        .collect()
}

fn hash_code(code: &str) -> Result<String, AuthApiError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(code.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| AuthApiError::Internal)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SmtpTls {
    /// Upgrade a plain connection (port 587). The default.
    StartTls,
    /// TLS from the first byte (port 465).
    Tls,
    /// No encryption, for a local test inbox such as Mailpit. Never use in production.
    None,
}

fn smtp_tls(value: Option<&str>) -> SmtpTls {
    match value {
        Some("tls") => SmtpTls::Tls,
        Some("none") => SmtpTls::None,
        _ => SmtpTls::StartTls,
    }
}

fn smtp_transport() -> Result<AsyncSmtpTransport<Tokio1Executor>, AuthApiError> {
    let host = std::env::var("SMTP_HOST").map_err(|_| AuthApiError::EmailUnavailable)?;
    let mode = smtp_tls(std::env::var("SMTP_TLS").ok().as_deref());
    let default_port = match mode {
        SmtpTls::StartTls => 587,
        SmtpTls::Tls => 465,
        SmtpTls::None => 1025,
    };
    let port = std::env::var("SMTP_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(default_port);
    let builder = match mode {
        SmtpTls::StartTls => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&host)
            .map_err(|_| AuthApiError::EmailUnavailable)?,
        SmtpTls::Tls => AsyncSmtpTransport::<Tokio1Executor>::relay(&host)
            .map_err(|_| AuthApiError::EmailUnavailable)?,
        SmtpTls::None => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&host),
    }
    .port(port);
    let builder = match (
        std::env::var("SMTP_USERNAME"),
        std::env::var("SMTP_PASSWORD"),
    ) {
        (Ok(username), Ok(password)) => builder.credentials(Credentials::new(username, password)),
        _ => builder,
    };
    Ok(builder.build())
}

/// Emails a code. Any delivery problem, including missing settings, is `EmailUnavailable`,
/// so callers roll back and the person can simply try again.
pub(crate) async fn send_code_email(
    to: &str,
    code: &str,
    purpose: &str,
) -> Result<(), AuthApiError> {
    let subject = match purpose {
        "verify_email" => "Your BrandBuild verification code",
        "student_email" => "Your BrandBuild student check code",
        _ => "Your BrandBuild password reset code",
    };
    send_email(to, subject, &format!(
        "Your BrandBuild code is {code}. It expires in {CODE_TTL_MINUTES} minutes. If you did not request this, you can ignore this email."
    )).await
}

pub(crate) async fn send_email(to: &str, subject: &str, body: &str) -> Result<(), AuthApiError> {
    let from: Mailbox = std::env::var("SMTP_FROM")
        .map_err(|_| AuthApiError::EmailUnavailable)?
        .parse()
        .map_err(|_| AuthApiError::EmailUnavailable)?;
    let message = Message::builder()
        .from(from)
        .to(to.parse().map_err(|_| AuthApiError::Invalid)?)
        .subject(subject)
        .body(body.to_owned())
        .map_err(|_| AuthApiError::Internal)?;
    smtp_transport()?.send(message).await.map_err(|error| {
        tracing::error!(error=?error, "code email delivery failed");
        AuthApiError::EmailUnavailable
    })?;
    Ok(())
}

/// Stores a fresh code for `purpose`, retiring any earlier one, and returns it so the
/// caller can email it before committing.
pub(crate) async fn store_code(
    tx: &mut Transaction<'static, Postgres>,
    user_id: Uuid,
    purpose: &str,
) -> Result<String, AuthApiError> {
    let code = generate_code();
    let hash = hash_code(&code)?;
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
        .bind(user_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| AuthApiError::Internal)?
        .ok_or(AuthApiError::Invalid)?;
    sqlx::query(
        "UPDATE auth_codes SET consumed_at=now() WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL",
    )
    .bind(user_id)
    .bind(purpose)
    .execute(&mut **tx)
    .await
    .map_err(|_| AuthApiError::Internal)?;
    sqlx::query(
        "INSERT INTO auth_codes(user_id,purpose,code_hash,expires_at) VALUES($1,$2,$3,now()+make_interval(mins => $4))",
    )
    .bind(user_id)
    .bind(purpose)
    .bind(hash)
    .bind(CODE_TTL_MINUTES as i32)
    .execute(&mut **tx)
    .await
    .map_err(|error| {
        tracing::error!(error=?error, "failed to store auth code");
        AuthApiError::Internal
    })?;
    Ok(code)
}

/// Checks `code` against the user's latest live code for any of `purposes`.
/// `Ok(Some(purpose))` consumes it. `Ok(None)` means wrong code: the attempt is recorded,
/// so the caller must commit before rejecting.
pub(crate) async fn consume_code(
    tx: &mut Transaction<'static, Postgres>,
    user_id: Uuid,
    purposes: &[&str],
    code: &str,
) -> Result<Option<String>, AuthApiError> {
    if code.len() != 6 || !code.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(AuthApiError::InvalidCode);
    }
    let purposes: Vec<String> = purposes.iter().map(|p| (*p).to_owned()).collect();
    let row = sqlx::query(
        "SELECT id,purpose,code_hash FROM auth_codes WHERE user_id=$1 AND purpose=ANY($2) AND consumed_at IS NULL AND expires_at>now() AND attempts<$3 ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
    )
    .bind(user_id)
    .bind(&purposes)
    .bind(MAX_CODE_ATTEMPTS)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AuthApiError::Internal)?;
    let Some(row) = row else {
        let expired: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM auth_codes WHERE user_id=$1 AND purpose=ANY($2) AND consumed_at IS NULL AND expires_at<=now())",
        )
        .bind(user_id)
        .bind(&purposes)
        .fetch_one(&mut **tx)
        .await
        .map_err(|_| AuthApiError::Internal)?;
        return Err(if expired {
            AuthApiError::CodeExpired
        } else {
            AuthApiError::InvalidCode
        });
    };
    let code_id: Uuid = row.try_get("id").map_err(|_| AuthApiError::Internal)?;
    let purpose: String = row.try_get("purpose").map_err(|_| AuthApiError::Internal)?;
    let hash: String = row
        .try_get("code_hash")
        .map_err(|_| AuthApiError::Internal)?;
    if !verify_hash(code, &hash) {
        sqlx::query("UPDATE auth_codes SET attempts=attempts+1 WHERE id=$1")
            .bind(code_id)
            .execute(&mut **tx)
            .await
            .map_err(|_| AuthApiError::Internal)?;
        return Ok(None);
    }
    sqlx::query("UPDATE auth_codes SET consumed_at=now() WHERE id=$1")
        .bind(code_id)
        .execute(&mut **tx)
        .await
        .map_err(|_| AuthApiError::Internal)?;
    Ok(Some(purpose))
}

async fn begin(pool: &PgPool) -> Result<Transaction<'static, Postgres>, AuthApiError> {
    pool.begin().await.map_err(|_| AuthApiError::Internal)
}

/// 204 carrying any Set-Cookie values.
fn no_content(cookies: Vec<String>) -> Response {
    (
        StatusCode::NO_CONTENT,
        AppendHeaders(cookies.into_iter().map(|cookie| (SET_COOKIE, cookie))),
    )
        .into_response()
}

fn session_cookie(user_id: Uuid, tenant_id: Uuid) -> Result<String, AuthApiError> {
    let token = signed_token(user_id, tenant_id, Duration::hours(SESSION_HOURS), None)?;
    Ok(set_cookie(SESSION_COOKIE, &token, SESSION_HOURS * 3600))
}

/// Creates the user, workspace and first code in one transaction, committed only once the
/// code email has gone out. If email fails, nothing is kept and signing up again works.
async fn signup(
    State(state): State<AppState>,
    Json(input): Json<SignUpInput>,
) -> Result<Response, AuthApiError> {
    let email = normalized_email(&input.identifier)?;
    let name = input.name.trim();
    if name.is_empty() || name.len() > 120 {
        return Err(AuthApiError::Invalid);
    }
    validate_password(&input.password)?;
    let password_hash = hash_password(&input.password)?;
    let user_id = Uuid::new_v4();
    let tenant_id = Uuid::new_v4();
    let slug = format!("workspace-{}", tenant_id.simple());
    let mut tx = begin(&state.pool).await?;
    let inserted = sqlx::query(
        "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING id",
    )
    .bind(user_id)
    .bind(&email)
    .bind(name)
    .bind(password_hash)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| {
        tracing::error!(error=?error, "signup insert failed");
        AuthApiError::Internal
    })?;
    if inserted.is_none() {
        return Err(AuthApiError::Conflict);
    }
    sqlx::query("INSERT INTO tenants(id,name,slug) VALUES($1,$2,$3)")
        .bind(tenant_id)
        .bind(format!("{name}'s workspace"))
        .bind(slug)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            tracing::error!(error=?error, "workspace creation failed");
            AuthApiError::Internal
        })?;
    sqlx::query("INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')")
        .bind(tenant_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| AuthApiError::Internal)?;
    // onboarding_steps is tenant data, so row-level security needs the new workspace set.
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind(tenant_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|_| AuthApiError::Internal)?;
    sqlx::query("INSERT INTO onboarding_steps(tenant_id) VALUES($1)")
        .bind(tenant_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| AuthApiError::Internal)?;
    let code = store_code(&mut tx, user_id, "verify_email").await?;
    send_code_email(&email, &code, "verify_email").await?;
    tx.commit().await.map_err(|_| AuthApiError::Internal)?;
    Ok(no_content(vec![]))
}

async fn login(
    State(state): State<AppState>,
    Json(input): Json<LoginInput>,
) -> Result<Response, AuthApiError> {
    let email = normalized_email(&input.identifier)?;
    let row = sqlx::query(
        "SELECT u.id,u.password_hash,u.email_verified_at,m.tenant_id FROM users u JOIN tenant_memberships m ON m.user_id=u.id WHERE u.email=$1 ORDER BY m.created_at LIMIT 1",
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| AuthApiError::Internal)?
    .ok_or(AuthApiError::Unauthorized)?;
    let user_id: Uuid = row.try_get("id").map_err(|_| AuthApiError::Internal)?;
    let password_hash: Option<String> = row
        .try_get("password_hash")
        .map_err(|_| AuthApiError::Internal)?;
    let verified: Option<chrono::DateTime<Utc>> = row
        .try_get("email_verified_at")
        .map_err(|_| AuthApiError::Internal)?;
    let tenant_id: Uuid = row
        .try_get("tenant_id")
        .map_err(|_| AuthApiError::Internal)?;
    if !password_hash
        .as_deref()
        .is_some_and(|hash| verify_hash(&input.password, hash))
    {
        return Err(AuthApiError::Unauthorized);
    }
    // Only said after the right password, so it can't be used to probe for accounts.
    if verified.is_none() {
        return Err(AuthApiError::EmailNotVerified);
    }
    Ok(no_content(vec![session_cookie(user_id, tenant_id)?]))
}

async fn request_code(
    State(state): State<AppState>,
    Json(input): Json<RequestCodeInput>,
) -> Result<Response, AuthApiError> {
    let email = normalized_email(&input.identifier)?;
    let row = sqlx::query("SELECT id,email_verified_at FROM users WHERE email=$1")
        .bind(&email)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AuthApiError::Internal)?;
    if let Some(row) = row {
        let user_id: Uuid = row.try_get("id").map_err(|_| AuthApiError::Internal)?;
        let verified: Option<chrono::DateTime<Utc>> = row
            .try_get("email_verified_at")
            .map_err(|_| AuthApiError::Internal)?;
        let purpose = if verified.is_some() {
            "reset_password"
        } else {
            "verify_email"
        };
        let mut tx = begin(&state.pool).await?;
        let code = store_code(&mut tx, user_id, purpose).await?;
        send_code_email(&email, &code, purpose).await?;
        tx.commit().await.map_err(|_| AuthApiError::Internal)?;
    }
    // Same response whether the account exists or not.
    Ok(no_content(vec![]))
}

async fn verify_code(
    State(state): State<AppState>,
    Json(input): Json<CodeInput>,
) -> Result<Response, AuthApiError> {
    let email = normalized_email(&input.identifier)?;
    let mut tx = begin(&state.pool).await?;
    let (user_id, tenant_id): (Uuid, Uuid) = sqlx::query_as(
        "SELECT u.id,m.tenant_id FROM users u JOIN tenant_memberships m ON m.user_id=u.id WHERE u.email=$1 ORDER BY m.created_at LIMIT 1",
    )
    .bind(&email)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AuthApiError::Internal)?
    .ok_or(AuthApiError::InvalidCode)?;
    let Some(purpose) = consume_code(
        &mut tx,
        user_id,
        &["verify_email", "reset_password"],
        &input.code,
    )
    .await?
    else {
        tx.commit().await.map_err(|_| AuthApiError::Internal)?;
        return Err(AuthApiError::InvalidCode);
    };
    if purpose == "verify_email" {
        sqlx::query("UPDATE users SET email_verified_at=now() WHERE id=$1")
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(|_| AuthApiError::Internal)?;
    }
    tx.commit().await.map_err(|_| AuthApiError::Internal)?;
    if purpose == "verify_email" {
        Ok(no_content(vec![session_cookie(user_id, tenant_id)?]))
    } else {
        let reset_token = signed_token(
            user_id,
            tenant_id,
            Duration::minutes(MAX_RESET_TOKEN_MINUTES),
            Some("reset_password"),
        )?;
        Ok(no_content(vec![set_cookie(
            RESET_COOKIE,
            &reset_token,
            MAX_RESET_TOKEN_MINUTES * 60,
        )]))
    }
}

async fn reset_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<ResetPasswordInput>,
) -> Result<Response, AuthApiError> {
    validate_password(&input.password)?;
    let reset_token = cookie_value(&headers, RESET_COOKIE).ok_or(AuthApiError::Unauthorized)?;
    let mut validation = jsonwebtoken::Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    let claims = jsonwebtoken::decode::<Claims>(
        &reset_token,
        &jsonwebtoken::DecodingKey::from_secret(&jwt_secret()?),
        &validation,
    )
    .map_err(|_| AuthApiError::Unauthorized)?
    .claims;
    if claims.purpose.as_deref() != Some("reset_password") {
        return Err(AuthApiError::Unauthorized);
    }
    let user_id = Uuid::parse_str(&claims.sub).map_err(|_| AuthApiError::Unauthorized)?;
    let tenant_id = Uuid::parse_str(&claims.tenant_id).map_err(|_| AuthApiError::Unauthorized)?;
    let member: Option<(Uuid,)> = sqlx::query_as(
        "SELECT tenant_id FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2",
    )
    .bind(tenant_id)
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| AuthApiError::Internal)?;
    if member.is_none() {
        return Err(AuthApiError::Unauthorized);
    }
    let password_hash = hash_password(&input.password)?;
    sqlx::query("UPDATE users SET password_hash=$2 WHERE id=$1")
        .bind(user_id)
        .bind(password_hash)
        .execute(&state.pool)
        .await
        .map_err(|_| AuthApiError::Internal)?;
    Ok(no_content(vec![
        session_cookie(user_id, tenant_id)?,
        set_cookie(RESET_COOKIE, "", 0),
    ]))
}

async fn logout() -> Response {
    no_content(vec![set_cookie(SESSION_COOKIE, "", 0)])
}

fn public_role(role: &str) -> &'static str {
    match role {
        "owner" => "owner",
        "reviewer" => "reviewer",
        _ => "editor",
    }
}

/// The signed-in user. Lives behind the auth middleware, unlike the routes in `router`.
pub async fn session(
    State(state): State<AppState>,
    ctx: TenantContext,
) -> Result<Json<Value>, AuthApiError> {
    let row = sqlx::query(
        "SELECT u.email,u.display_name,m.role FROM users u JOIN tenant_memberships m ON m.user_id=u.id WHERE u.id=$1 AND m.tenant_id=$2",
    )
    .bind(ctx.actor_id)
    .bind(ctx.tenant_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| AuthApiError::Internal)?;
    let email: String = row.try_get("email").map_err(|_| AuthApiError::Internal)?;
    let name: Option<String> = row
        .try_get("display_name")
        .map_err(|_| AuthApiError::Internal)?;
    let role: String = row.try_get("role").map_err(|_| AuthApiError::Internal)?;
    Ok(Json(json!({"data":{
        "userId": ctx.actor_id,
        "name": name.unwrap_or_default(),
        "identifier": email,
        "role": public_role(&role),
    }})))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/signup", post(signup))
        .route("/login", post(login))
        .route("/logout", post(logout))
        .route("/code", post(request_code))
        .route("/code/verify", post(verify_code))
        .route("/password", post(reset_password))
}

#[cfg(test)]
mod tests {
    use super::{
        hash_password, normalized_email, smtp_tls, validate_password, verify_hash, AuthApiError,
        SmtpTls,
    };

    #[test]
    fn smtp_mode_defaults_to_starttls() {
        assert_eq!(smtp_tls(None), SmtpTls::StartTls);
        assert_eq!(smtp_tls(Some("starttls")), SmtpTls::StartTls);
        assert_eq!(smtp_tls(Some("tls")), SmtpTls::Tls);
        assert_eq!(smtp_tls(Some("none")), SmtpTls::None);
    }

    #[test]
    fn email_is_trimmed_and_case_normalized() {
        assert_eq!(
            normalized_email("  User@Example.COM ").unwrap(),
            "user@example.com"
        );
    }

    #[test]
    fn malformed_email_is_rejected() {
        assert!(matches!(
            normalized_email("not-an-email"),
            Err(AuthApiError::Invalid)
        ));
    }

    #[test]
    fn password_policy_requires_length_and_mixed_character_classes() {
        assert!(validate_password("ValidPass123").is_ok());
        assert!(validate_password("short1A").is_err());
        assert!(validate_password("alllowercase123").is_err());
    }

    #[test]
    fn password_hash_verifies_only_the_original_password() {
        let hash = hash_password("ValidPass123").unwrap();
        assert!(verify_hash("ValidPass123", &hash));
        assert!(!verify_hash("DifferentPass123", &hash));
    }
}
