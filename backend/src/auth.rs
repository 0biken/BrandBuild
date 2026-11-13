//! Authentication boundary. Tenant identity comes from a signed JWT carrying user and
//! tenant IDs. Membership and role are revalidated against Postgres on every request.
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

/// A member's role in a workspace.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Owner,
    Editor,
    Reviewer,
}

impl Role {
    pub fn parse(value: &str) -> Self {
        match value {
            "owner" => Self::Owner,
            "reviewer" => Self::Reviewer,
            _ => Self::Editor,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Editor => "editor",
            Self::Reviewer => "reviewer",
        }
    }
}

/// Who may approve, send back, schedule, publish or cancel a post.
pub const DECIDERS: &[Role] = &[Role::Owner, Role::Reviewer];
/// Who may change workspace settings and connected channels.
pub const OWNERS: &[Role] = &[Role::Owner];

#[derive(Clone, Debug)]
pub struct TenantContext {
    pub tenant_id: Uuid,
    pub actor_id: Uuid,
    pub role: Role,
}

impl TenantContext {
    /// Ok when the member's role is one of `allowed`.
    pub fn require(&self, allowed: &[Role]) -> Result<(), AuthError> {
        if allowed.contains(&self.role) {
            Ok(())
        } else {
            Err(AuthError::Forbidden)
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("missing or invalid authenticated tenant context")]
    Unauthorized,
    #[error("you don't have permission to do that")]
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
    /// Set on single-purpose tokens such as password reset. Those never sign anyone in.
    #[serde(default)]
    purpose: Option<String>,
}

/// Checks a session token's signature and expiry and returns (tenant, user).
/// Single-purpose tokens, such as password-reset tokens, are rejected.
pub fn session_identity(token: &str, secret: &[u8]) -> Result<(Uuid, Uuid), AuthError> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    let claims = decode::<Claims>(token, &DecodingKey::from_secret(secret), &validation)
        .map_err(|_| AuthError::Unauthorized)?
        .claims;
    if claims.purpose.is_some() {
        return Err(AuthError::Unauthorized);
    }
    let actor = Uuid::parse_str(&claims.sub).map_err(|_| AuthError::Unauthorized)?;
    let tenant = Uuid::parse_str(&claims.tenant_id).map_err(|_| AuthError::Unauthorized)?;
    Ok((tenant, actor))
}

pub async fn resolve_bearer(parts: &Parts, pool: &PgPool) -> Result<TenantContext, AuthError> {
    // Local endpoint checks can use explicit DEV_* values. They are disabled unless
    // configured; production uses signed session tokens and a membership lookup.
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
        session_identity(&token, secret.as_bytes())?
    };
    let member: Option<(String,)> =
        sqlx::query_as("SELECT role FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2")
            .bind(tenant_id)
            .bind(actor_id)
            .fetch_optional(pool)
            .await
            .map_err(|_| AuthError::Unauthorized)?;
    let Some((role,)) = member else {
        return Err(AuthError::Forbidden);
    };
    Ok(TenantContext {
        tenant_id,
        actor_id,
        role: Role::parse(&role),
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

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{encode, EncodingKey, Header};
    use serde_json::json;

    const SECRET: &[u8] = b"0123456789abcdef0123456789abcdef";

    fn token(purpose: Option<&str>) -> String {
        let mut claims = json!({
            "sub": Uuid::new_v4().to_string(),
            "tenant_id": Uuid::new_v4().to_string(),
            "exp": (chrono::Utc::now().timestamp() + 600) as usize,
        });
        if let Some(p) = purpose {
            claims["purpose"] = json!(p);
        }
        encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(SECRET),
        )
        .unwrap()
    }

    #[test]
    fn session_tokens_sign_in() {
        assert!(session_identity(&token(None), SECRET).is_ok());
    }

    #[test]
    fn reset_tokens_never_sign_in() {
        assert!(matches!(
            session_identity(&token(Some("reset_password")), SECRET),
            Err(AuthError::Unauthorized)
        ));
    }

    #[test]
    fn roles_gate_actions() {
        let ctx = |role| TenantContext {
            tenant_id: Uuid::nil(),
            actor_id: Uuid::nil(),
            role,
        };
        assert!(ctx(Role::Owner).require(DECIDERS).is_ok());
        assert!(ctx(Role::Reviewer).require(DECIDERS).is_ok());
        assert!(ctx(Role::Editor).require(DECIDERS).is_err());
        assert!(ctx(Role::Reviewer).require(OWNERS).is_err());
        assert_eq!(Role::parse("member"), Role::Editor);
    }
}
