//! Authentication boundary. Tenant identity is derived from validated server-side
//! session claims and membership, never accepted from request JSON.
use axum::{extract::FromRequestParts, http::{request::Parts, StatusCode}, response::{IntoResponse, Response}};
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct TenantContext {
    pub tenant_id: Uuid,
    pub actor_id: Uuid,
}

#[derive(Debug, thiserror::Error)]
#[error("missing authenticated tenant context")]
pub struct AuthError;

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        StatusCode::UNAUTHORIZED.into_response()
    }
}

impl<S: Send + Sync> FromRequestParts<S> for TenantContext {
    type Rejection = AuthError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts.extensions.get::<TenantContext>().cloned().ok_or(AuthError)
    }
}

/// TODO: validate an HttpOnly session cookie or JWT, resolve the user's active
/// tenant from persisted memberships, then insert TenantContext into request extensions.
/// Never trust tenant_id from a body, query parameter, or unsigned header.
pub async fn resolve_session_placeholder() -> Result<TenantContext, AuthError> {
    Err(AuthError)
}
