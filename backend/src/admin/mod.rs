//! Admin console API (`/admin/v1`).
//! Staff identities, sessions, and permissions are completely isolated from customer accounts.
use axum::{
    extract::{FromRequestParts, Request, State},
    http::request::Parts,
    middleware::{self, Next},
    response::Response,
    routing::{get, patch, post},
    Router,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    auth::{cookie_value, AuthError},
    AppState,
};

pub mod ai;
pub mod audit;
pub mod auth;
pub mod holds;
pub mod incidents;
pub mod overview;
pub mod publish_attempts;
pub mod staff;
pub mod student_reviews;
pub mod support_sessions;
pub mod workspaces;

pub const ADMIN_SESSION_COOKIE: &str = "bb_admin_session";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StaffRole {
    Support,
    Operations,
    StudentReviewer,
    StaffAdmin,
}

impl StaffRole {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "support" => Some(Self::Support),
            "operations" => Some(Self::Operations),
            "student_reviewer" => Some(Self::StudentReviewer),
            "staff_admin" => Some(Self::StaffAdmin),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Support => "support",
            Self::Operations => "operations",
            Self::StudentReviewer => "student_reviewer",
            Self::StaffAdmin => "staff_admin",
        }
    }
}

#[derive(Clone, Debug)]
pub struct StaffContext {
    pub staff_user_id: Uuid,
    pub email: String,
    pub display_name: String,
    pub roles: Vec<StaffRole>,
    pub session_id: Option<Uuid>,
}

impl StaffContext {
    pub fn has_any(&self, allowed: &[StaffRole]) -> bool {
        self.roles.iter().any(|r| allowed.contains(r))
    }

    pub fn require(&self, allowed: &[StaffRole]) -> Result<(), AuthError> {
        if self.has_any(allowed) {
            Ok(())
        } else {
            Err(AuthError::Forbidden)
        }
    }
}

#[axum::async_trait]
impl<S: Send + Sync> FromRequestParts<S> for StaffContext {
    type Rejection = AuthError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<StaffContext>()
            .cloned()
            .ok_or(AuthError::Unauthorized)
    }
}

pub fn hash_token(raw: &str) -> String {
    format!("{:x}", Sha256::digest(raw.as_bytes()))
}

pub async fn resolve_staff(parts: &Parts, state: &AppState) -> Result<StaffContext, AuthError> {
    if let Some(dev_email) = parts
        .headers
        .get("x-dev-admin-email")
        .and_then(|v| v.to_str().ok())
    {
        if std::env::var("ALLOW_DEV_ADMIN_AUTH").ok().as_deref() != Some("true") {
            return Err(AuthError::Unauthorized);
        }
        let row = sqlx::query(
            "SELECT id, email, display_name, roles, is_active
             FROM admin.staff_users
             WHERE lower(email) = lower($1)",
        )
        .bind(dev_email.trim())
        .fetch_optional(&state.admin_pool)
        .await
        .map_err(|_| AuthError::Unauthorized)?
        .ok_or(AuthError::Forbidden)?;

        let active: bool = row
            .try_get("is_active")
            .map_err(|_| AuthError::Unauthorized)?;
        if !active {
            return Err(AuthError::Forbidden);
        }
        let raw_roles: Vec<String> = row.try_get("roles").map_err(|_| AuthError::Unauthorized)?;
        let roles: Vec<StaffRole> = raw_roles
            .iter()
            .filter_map(|r| StaffRole::parse(r))
            .collect();
        if roles.is_empty() {
            return Err(AuthError::Forbidden);
        }
        return Ok(StaffContext {
            staff_user_id: row.try_get("id").map_err(|_| AuthError::Unauthorized)?,
            email: row.try_get("email").map_err(|_| AuthError::Unauthorized)?,
            display_name: row
                .try_get("display_name")
                .map_err(|_| AuthError::Unauthorized)?,
            roles,
            session_id: None,
        });
    }

    let raw_token =
        cookie_value(&parts.headers, ADMIN_SESSION_COOKIE).ok_or(AuthError::Unauthorized)?;
    let token_hash = hash_token(&raw_token);

    let row = sqlx::query(
        "SELECT s.id AS session_id, u.id AS staff_user_id, u.email, u.display_name, u.roles, u.is_active
         FROM admin.staff_sessions s
         JOIN admin.staff_users u ON u.id = s.staff_user_id
         WHERE s.token_hash = $1
           AND s.revoked_at IS NULL
           AND s.expires_at > now()
           AND s.last_active_at > now() - interval '30 minutes'",
    )
    .bind(&token_hash)
    .fetch_optional(&state.admin_pool)
    .await
    .map_err(|_| AuthError::Unauthorized)?
    .ok_or(AuthError::Unauthorized)?;

    let active: bool = row
        .try_get("is_active")
        .map_err(|_| AuthError::Unauthorized)?;
    if !active {
        return Err(AuthError::Forbidden);
    }

    let raw_roles: Vec<String> = row.try_get("roles").map_err(|_| AuthError::Unauthorized)?;
    let roles: Vec<StaffRole> = raw_roles
        .iter()
        .filter_map(|r| StaffRole::parse(r))
        .collect();
    if roles.is_empty() {
        return Err(AuthError::Forbidden);
    }

    let session_id: Uuid = row
        .try_get("session_id")
        .map_err(|_| AuthError::Unauthorized)?;

    // Touch last_active_at for 30-minute inactivity sliding window.
    let _ = sqlx::query("UPDATE admin.staff_sessions SET last_active_at = now() WHERE id = $1")
        .bind(session_id)
        .execute(&state.admin_pool)
        .await;

    Ok(StaffContext {
        staff_user_id: row
            .try_get("staff_user_id")
            .map_err(|_| AuthError::Unauthorized)?,
        email: row.try_get("email").map_err(|_| AuthError::Unauthorized)?,
        display_name: row
            .try_get("display_name")
            .map_err(|_| AuthError::Unauthorized)?,
        roles,
        session_id: Some(session_id),
    })
}

async fn admin_auth_middleware(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Result<Response, AuthError> {
    let (mut parts, body) = request.into_parts();
    let ctx = resolve_staff(&parts, &state).await?;
    parts.extensions.insert(ctx);
    Ok(next.run(Request::from_parts(parts, body)).await)
}

pub fn router(state: AppState) -> Router<AppState> {
    let protected = Router::new()
        .route("/auth/logout", post(auth::logout))
        .route("/me", get(auth::me))
        .route("/overview", get(overview::get_overview))
        .route("/workspaces", get(workspaces::search_workspaces))
        .route("/workspaces/:id", get(workspaces::get_workspace))
        .route("/workspaces/:id/notes", post(workspaces::add_note))
        .route(
            "/publishing-holds",
            get(holds::list_holds).post(holds::create_hold),
        )
        .route("/publishing-holds/:id/release", post(holds::release_hold))
        .route(
            "/incidents",
            get(incidents::list_incidents).post(incidents::create_incident),
        )
        .route("/incidents/:id", patch(incidents::update_incident))
        .route("/ai", get(ai::get_ai_spend))
        .route("/ai/policy", patch(ai::update_ai_policy))
        .route("/ai/workspaces/:id", patch(ai::update_workspace_ai))
        .route("/student-reviews", get(student_reviews::list_reviews))
        .route(
            "/student-reviews/:id/preview",
            get(student_reviews::get_preview),
        )
        .route(
            "/student-reviews/:id/decision",
            post(student_reviews::decide_review),
        )
        .route(
            "/support-sessions",
            get(support_sessions::list_sessions).post(support_sessions::request_session),
        )
        .route(
            "/support-sessions/:id/approve",
            post(support_sessions::approve_session),
        )
        .route(
            "/support-sessions/:id/activate",
            post(support_sessions::activate_session),
        )
        .route(
            "/support-sessions/:id/end",
            post(support_sessions::end_session),
        )
        .route(
            "/support-sessions/:id/workspace",
            get(support_sessions::view_workspace),
        )
        .route(
            "/support-sessions/:id/drafts/:post_id",
            patch(support_sessions::edit_draft),
        )
        .route("/publish-attempts", get(publish_attempts::list_unclear))
        .route(
            "/publish-attempts/:id/reconcile",
            post(publish_attempts::reconcile_attempt),
        )
        .route(
            "/publish-attempts/:id/resolve",
            post(publish_attempts::resolve_attempt),
        )
        .route("/staff", get(staff::list_staff).post(staff::create_staff))
        .route("/staff/:id", patch(staff::update_staff))
        .route("/audit", get(audit::list_audit))
        .route("/audit/export", get(audit::export_audit_csv))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            admin_auth_middleware,
        ))
        .with_state(state.clone());

    Router::new()
        .route("/auth/google/start", get(auth::google_start))
        .route("/auth/google/callback", get(auth::google_callback))
        .merge(protected)
        .with_state(state)
}
