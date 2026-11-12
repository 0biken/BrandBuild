//! Authentication boundary. Tenant identity comes from a signed JWT carrying user and
//! tenant IDs. Membership is revalidated against Postgres on every request.
use axum::{
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Response},
};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

pub const SESSION_COOKIE: &str = "bb_session";
pub const RESET_COOKIE: &str = "bb_reset";

/// Reads one cookie from the request's Cookie header.
pub fn cookie_value(headers: &axum::http::HeaderMap, name: &str) -> Option<String> {
    headers
        .get_all(axum::http::header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value.to_owned())
}

/// Builds a Set-Cookie value. A max_age of 0 clears the cookie.
pub fn set_cookie(name: &str, value: &str, max_age: i64) -> String {
    let secure = if std::env::var("COOKIE_SECURE").ok().as_deref() == Some("false") {
        ""
    } else {
        "; Secure"
    };
    format!("{name}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}")
}

#[derive(Clone, Debug)]
pub struct TenantContext {
    pub tenant_id: Uuid,
    pub actor_id: Uuid,
}

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("missing or invalid authenticated tenant context")]
    Unauthorized,
    #[error("tenant membership is not active")]
    Forbidden,
    #[error("authentication is not configured")]
    NotConfigured,
}
impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::Forbidden => StatusCode::FORBIDDEN,
            _ => StatusCode::UNAUTHORIZED,
        };
        status.into_response()
    }
}

#[derive(Deserialize)]
struct Claims {
    sub: String,
    tenant_id: String,
    exp: usize,
}

pub async fn resolve_bearer(parts: &Parts, pool: &PgPool) -> Result<TenantContext, AuthError> {
    // Local endpoint checks can use explicit DEV_* values. They are disabled unless
    // configured; production uses signed bearer tokens and a membership lookup.
    let dev = parts
        .headers
        .get("x-dev-tenant-id")
        .and_then(|v| v.to_str().ok());
    let dev_actor = parts
        .headers
        .get("x-dev-actor-id")
        .and_then(|v| v.to_str().ok());
    let (tenant_id, actor_id) = if let (Some(t), Some(a)) = (dev, dev_actor) {
        if std::env::var("ALLOW_DEV_AUTH").ok().as_deref() != Some("true") {
            return Err(AuthError::Unauthorized);
        }
        (
            Uuid::parse_str(t).map_err(|_| AuthError::Unauthorized)?,
            Uuid::parse_str(a).map_err(|_| AuthError::Unauthorized)?,
        )
    } else {
        let secret = std::env::var("JWT_SECRET").map_err(|_| AuthError::NotConfigured)?;
        let bearer = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|h| h.strip_prefix("Bearer "))
            .map(str::to_owned);
        let token = bearer
            .or_else(|| cookie_value(&parts.headers, SESSION_COOKIE))
            .ok_or(AuthError::Unauthorized)?;
        let mut validation = Validation::new(Algorithm::HS256);
        validation.validate_exp = true;
        let claims = decode::<Claims>(
            &token,
            &DecodingKey::from_secret(secret.as_bytes()),
            &validation,
        )
        .map_err(|_| AuthError::Unauthorized)?
        .claims;
        let actor = Uuid::parse_str(&claims.sub).map_err(|_| AuthError::Unauthorized)?;
        let tenant = Uuid::parse_str(&claims.tenant_id).map_err(|_| AuthError::Unauthorized)?;
        (tenant, actor)
    };
    let member: Option<(Uuid,)> =
        sqlx::query_as("SELECT user_id FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2")
            .bind(tenant_id)
            .bind(actor_id)
            .fetch_optional(pool)
            .await
            .map_err(|_| AuthError::Unauthorized)?;
    if member.is_none() {
        return Err(AuthError::Forbidden);
    }
    Ok(TenantContext {
        tenant_id,
        actor_id,
    })
}

#[axum::async_trait]
impl<S: Send + Sync> FromRequestParts<S> for TenantContext {
    type Rejection = AuthError;
    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<TenantContext>()
            .cloned()
            .ok_or(AuthError::Unauthorized)
    }
}
