use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{extract::State, http::StatusCode, routing::post, Json, Router};
use chrono::{Duration, Utc};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use lettre::{
    message::Mailbox, transport::smtp::authentication::Credentials, AsyncSmtpTransport,
    AsyncTransport, Message, Tokio1Executor,
};
use rand::{distributions::Uniform, prelude::Distribution, thread_rng};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::AppState;

const CODE_TTL_MINUTES: i64 = 10;
const MAX_CODE_ATTEMPTS: i32 = 5;
const MAX_RESET_TOKEN_MINUTES: i64 = 15;

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
    reset_token: String,
    password: String,
}

#[derive(Debug, thiserror::Error)]
enum AuthApiError {
    #[error("request data is invalid")]
    Invalid,
    #[error("email or password is incorrect")]
    Unauthorized,
    #[error("email is already registered")]
    Conflict,
    #[error("verification code is invalid or expired")]
    InvalidCode,
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

async fn send_code_email(to: &str, code: &str, purpose: &str) -> Result<(), AuthApiError> {
    let host = std::env::var("SMTP_HOST").map_err(|_| AuthApiError::NotConfigured)?;
    let username = std::env::var("SMTP_USERNAME").map_err(|_| AuthApiError::NotConfigured)?;
    let password = std::env::var("SMTP_PASSWORD").map_err(|_| AuthApiError::NotConfigured)?;
    let from: Mailbox = std::env::var("SMTP_FROM")
        .map_err(|_| AuthApiError::NotConfigured)?
        .parse()
        .map_err(|_| AuthApiError::NotConfigured)?;
    let port = std::env::var("SMTP_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(587);
    let subject = if purpose == "verify_email" {
        "Your BrandBuild verification code"
    } else {
        "Your BrandBuild password reset code"
    };
    let message = Message::builder()
        .from(from)
        .to(to.parse().map_err(|_| AuthApiError::Invalid)?)
        .subject(subject)
        .body(format!(
            "Your BrandBuild code is {code}. It expires in {CODE_TTL_MINUTES} minutes. If you did not request this, you can ignore this email."
        ))
        .map_err(|_| AuthApiError::Internal)?;
    let transport = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&host)
        .map_err(|_| AuthApiError::NotConfigured)?
        .port(port)
        .credentials(Credentials::new(username, password))
        .build();
    transport.send(message).await.map_err(|error| {
        tracing::error!(error=?error, "auth email delivery failed");
        AuthApiError::Internal
    })?;
    Ok(())
}

async fn issue_code(
    pool: &PgPool,
    user_id: Uuid,
    email: &str,
    purpose: &str,
) -> Result<(), AuthApiError> {
    let code = generate_code();
    let hash = hash_code(&code)?;
    let mut tx = pool.begin().await.map_err(|_| AuthApiError::Internal)?;
    sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE")
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| AuthApiError::Internal)?
        .ok_or(AuthApiError::Invalid)?;
    sqlx::query(
        "UPDATE auth_codes SET consumed_at=now() WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL",
    )
    .bind(user_id)
    .bind(purpose)
    .execute(&mut *tx)
    .await
    .map_err(|_| AuthApiError::Internal)?;
    sqlx::query(
        "INSERT INTO auth_codes(user_id,purpose,code_hash,expires_at) VALUES($1,$2,$3,now()+make_interval(mins => $4))",
    )
    .bind(user_id)
    .bind(purpose)
    .bind(hash)
    .bind(CODE_TTL_MINUTES as i32)
    .execute(&mut *tx)
    .await
    .map_err(|error| {
        tracing::error!(error=?error, "failed to store auth code");
        AuthApiError::Internal
    })?;
    tx.commit().await.map_err(|_| AuthApiError::Internal)?;
    send_code_email(email, &code, purpose).await
}

async fn signup(
    State(state): State<AppState>,
    Json(input): Json<SignUpInput>,
) -> Result<(StatusCode, Json<Value>), AuthApiError> {
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
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| AuthApiError::Internal)?;
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
    tx.commit().await.map_err(|_| AuthApiError::Internal)?;
    issue_code(&state.pool, user_id, &email, "verify_email").await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"data":{"user_id":user_id,"email":email,"verification_required":true}})),
    ))
}

async fn login(
    State(state): State<AppState>,
    Json(input): Json<LoginInput>,
) -> Result<Json<Value>, AuthApiError> {
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
        || verified.is_none()
    {
        return Err(AuthApiError::Unauthorized);
    }
    let token = signed_token(user_id, tenant_id, Duration::hours(12), None)?;
    Ok(Json(json!({
        "data": {
            "access_token": token,
            "token_type": "Bearer",
            "expires_in": 43200,
            "user": {"id": user_id, "email": email}
        }
    })))
}

async fn request_code(
    State(state): State<AppState>,
    Json(input): Json<RequestCodeInput>,
) -> Result<Json<Value>, AuthApiError> {
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
        issue_code(&state.pool, user_id, &email, purpose).await?;
    }
    // Return the same response whether the account exists or not.
    Ok(Json(json!({"data":{"accepted":true}})))
}

async fn verify_code(
    State(state): State<AppState>,
    Json(input): Json<CodeInput>,
) -> Result<Json<Value>, AuthApiError> {
    let email = normalized_email(&input.identifier)?;
    if input.code.len() != 6 || !input.code.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(AuthApiError::InvalidCode);
    }
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| AuthApiError::Internal)?;
    let row = sqlx::query(
        "SELECT u.id,ac.purpose FROM users u JOIN auth_codes ac ON ac.user_id=u.id WHERE u.email=$1 AND ac.consumed_at IS NULL AND ac.expires_at>now() AND ac.attempts<$2 ORDER BY ac.created_at DESC LIMIT 1 FOR UPDATE OF ac",
    )
    .bind(&email)
    .bind(MAX_CODE_ATTEMPTS)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AuthApiError::Internal)?
    .ok_or(AuthApiError::InvalidCode)?;
    let user_id: Uuid = row.try_get("id").map_err(|_| AuthApiError::Internal)?;
    let purpose: String = row.try_get("purpose").map_err(|_| AuthApiError::Internal)?;
    if purpose != "verify_email" && purpose != "reset_password" {
        return Err(AuthApiError::InvalidCode);
    }
    let row = sqlx::query(
        "SELECT id,code_hash FROM auth_codes WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at>now() AND attempts<$3 ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
    )
    .bind(user_id)
    .bind(&purpose)
    .bind(MAX_CODE_ATTEMPTS)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AuthApiError::Internal)?
    .ok_or(AuthApiError::InvalidCode)?;
    let code_id: Uuid = row.try_get("id").map_err(|_| AuthApiError::Internal)?;
    let hash: String = row
        .try_get("code_hash")
        .map_err(|_| AuthApiError::Internal)?;
    if !verify_hash(&input.code, &hash) {
        sqlx::query("UPDATE auth_codes SET attempts=attempts+1 WHERE id=$1")
            .bind(code_id)
            .execute(&mut *tx)
            .await
            .map_err(|_| AuthApiError::Internal)?;
        tx.commit().await.map_err(|_| AuthApiError::Internal)?;
        return Err(AuthApiError::InvalidCode);
    }
    sqlx::query("UPDATE auth_codes SET consumed_at=now() WHERE id=$1")
        .bind(code_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| AuthApiError::Internal)?;
    let (user_id, tenant_id): (Uuid, Uuid) = sqlx::query_as(
        "SELECT u.id,m.tenant_id FROM users u JOIN tenant_memberships m ON m.user_id=u.id WHERE u.email=$1 ORDER BY m.created_at LIMIT 1",
    )
    .bind(&email)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| AuthApiError::Internal)?;
    if purpose == "verify_email" {
        sqlx::query("UPDATE users SET email_verified_at=now() WHERE id=$1")
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(|_| AuthApiError::Internal)?;
    }
    tx.commit().await.map_err(|_| AuthApiError::Internal)?;
    if purpose == "verify_email" {
        let token = signed_token(user_id, tenant_id, Duration::hours(12), None)?;
        Ok(Json(json!({
            "data": {
                "verified": true,
                "access_token": token,
                "token_type": "Bearer",
                "expires_in": 43200
            }
        })))
    } else {
        let reset_token = signed_token(
            user_id,
            tenant_id,
            Duration::minutes(MAX_RESET_TOKEN_MINUTES),
            Some("reset_password"),
        )?;
        Ok(Json(
            json!({"data":{"verified":true,"reset_token":reset_token}}),
        ))
    }
}

async fn reset_password(
    State(state): State<AppState>,
    Json(input): Json<ResetPasswordInput>,
) -> Result<Json<Value>, AuthApiError> {
    validate_password(&input.password)?;
    let mut validation = jsonwebtoken::Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    let claims = jsonwebtoken::decode::<Claims>(
        &input.reset_token,
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
    let access_token = signed_token(user_id, tenant_id, Duration::hours(12), None)?;
    Ok(Json(json!({
        "data": {
            "password_changed": true,
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": 43200
        }
    })))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/signup", post(signup))
        .route("/login", post(login))
        .route("/code/request", post(request_code))
        .route("/code/verify", post(verify_code))
        .route("/password/reset", post(reset_password))
}

#[cfg(test)]
mod tests {
    use super::{hash_password, normalized_email, validate_password, verify_hash, AuthApiError};

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
