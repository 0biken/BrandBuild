//! Google Workspace OpenID Connect authentication for staff.
//! Follows Google OIDC guidance: single-use state, nonce verification, server-side
//! ID-token signature/issuer/audience/expiry/email_verified/hd validation, and
//! individual staff allowlist lookup.
use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Redirect, Response},
    Json,
};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use rand::RngCore;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

use crate::{api::ApiError, auth::set_cookie, AppState};

use super::{
    audit::{self, StaffAuditEntry},
    hash_token, StaffContext, ADMIN_SESSION_COOKIE,
};

const SESSION_MAX_AGE_SECS: i64 = 8 * 60 * 60;

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn oidc_config() -> Result<(String, String, String, String), ApiError> {
    let client_id = std::env::var("ADMIN_GOOGLE_CLIENT_ID")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .ok_or(ApiError::NotAvailable)?;
    let client_secret = std::env::var("ADMIN_GOOGLE_CLIENT_SECRET")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .ok_or(ApiError::NotAvailable)?;
    let redirect_uri = std::env::var("ADMIN_GOOGLE_REDIRECT_URI")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .ok_or(ApiError::NotAvailable)?;
    let hd = std::env::var("ADMIN_GOOGLE_HD")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .ok_or(ApiError::NotAvailable)?;
    Ok((client_id, client_secret, redirect_uri, hd))
}

fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[derive(Deserialize)]
pub struct StartQuery {
    pub format: Option<String>,
    pub redirect_to: Option<String>,
}

pub async fn google_start(
    State(s): State<AppState>,
    Query(q): Query<StartQuery>,
) -> Result<Response, ApiError> {
    let (client_id, _, redirect_uri, hd) = oidc_config()?;
    let state = random_hex(32);
    let nonce = random_hex(32);
    let state_hash = hash_token(&state);
    let redirect_to = q
        .redirect_to
        .filter(|r| r.starts_with('/') && !r.starts_with("//"));

    sqlx::query(
        "INSERT INTO admin.oidc_states(state_hash, nonce, redirect_to, expires_at)
         VALUES ($1, $2, $3, now() + interval '10 minutes')",
    )
    .bind(&state_hash)
    .bind(&nonce)
    .bind(&redirect_to)
    .execute(&s.admin_pool)
    .await?;

    let auth_base = std::env::var("ADMIN_GOOGLE_AUTH_URL")
        .unwrap_or_else(|_| "https://accounts.google.com/o/oauth2/v2/auth".to_owned());
    let auth_url = format!(
        "{auth_base}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&nonce={}&hd={}&prompt=select_account",
        url_encode(&client_id),
        url_encode(&redirect_uri),
        url_encode("openid email profile"),
        url_encode(&state),
        url_encode(&nonce),
        url_encode(&hd),
    );

    if q.format.as_deref() == Some("json") {
        Ok(Json(json!({ "data": { "authUrl": auth_url } })).into_response())
    } else {
        Ok(Redirect::temporary(&auth_url).into_response())
    }
}

#[derive(Deserialize)]
pub struct CallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    id_token: Option<String>,
}

#[derive(Deserialize)]
struct JwkSet {
    keys: Vec<JwkKey>,
}

#[derive(Deserialize)]
struct JwkKey {
    kid: Option<String>,
    kty: String,
    n: Option<String>,
    e: Option<String>,
}

#[derive(Deserialize)]
struct GoogleClaims {
    iss: String,
    aud: String,
    sub: String,
    email: Option<String>,
    email_verified: Option<bool>,
    hd: Option<String>,
    nonce: Option<String>,
    name: Option<String>,
}

pub async fn google_callback(
    State(s): State<AppState>,
    Query(q): Query<CallbackQuery>,
) -> Result<Response, ApiError> {
    if q.error.is_some() {
        return Err(ApiError::Forbidden);
    }
    let code = q
        .code
        .as_deref()
        .filter(|c| !c.is_empty())
        .ok_or(ApiError::InvalidInput)?;
    let state = q
        .state
        .as_deref()
        .filter(|st| !st.is_empty())
        .ok_or(ApiError::InvalidInput)?;
    let (client_id, client_secret, redirect_uri, expected_hd) = oidc_config()?;

    let state_hash = hash_token(state);
    let oidc_row = sqlx::query(
        "UPDATE admin.oidc_states
         SET consumed_at = now()
         WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > now()
         RETURNING nonce, redirect_to",
    )
    .bind(&state_hash)
    .fetch_optional(&s.admin_pool)
    .await?
    .ok_or(ApiError::Forbidden)?;

    let expected_nonce: String = oidc_row.try_get("nonce")?;
    let redirect_to: Option<String> = oidc_row.try_get("redirect_to")?;

    let token_url = std::env::var("ADMIN_GOOGLE_TOKEN_URL")
        .unwrap_or_else(|_| "https://oauth2.googleapis.com/token".to_owned());
    let jwks_url = std::env::var("ADMIN_GOOGLE_JWKS_URL")
        .unwrap_or_else(|_| "https://www.googleapis.com/oauth2/v3/certs".to_owned());

    let http = reqwest::Client::new();
    let token_res = http
        .post(&token_url)
        .form(&[
            ("code", code),
            ("client_id", &client_id),
            ("client_secret", &client_secret),
            ("redirect_uri", &redirect_uri),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|_| ApiError::Internal)?;

    if !token_res.status().is_success() {
        return Err(ApiError::Forbidden);
    }
    let token_body: TokenResponse = token_res.json().await.map_err(|_| ApiError::Internal)?;
    let id_token = token_body.id_token.ok_or(ApiError::Forbidden)?;

    let header = decode_header(&id_token).map_err(|_| ApiError::Forbidden)?;
    if header.alg != Algorithm::RS256 {
        return Err(ApiError::Forbidden);
    }
    let kid = header.kid.ok_or(ApiError::Forbidden)?;

    let jwks: JwkSet = http
        .get(&jwks_url)
        .send()
        .await
        .map_err(|_| ApiError::Internal)?
        .json()
        .await
        .map_err(|_| ApiError::Internal)?;

    let key = jwks
        .keys
        .into_iter()
        .find(|k| k.kid.as_deref() == Some(&kid) && k.kty == "RSA")
        .ok_or(ApiError::Forbidden)?;
    let (Some(n), Some(e)) = (key.n.as_deref(), key.e.as_deref()) else {
        return Err(ApiError::Forbidden);
    };
    let decoding_key = DecodingKey::from_rsa_components(n, e).map_err(|_| ApiError::Forbidden)?;

    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[&client_id]);
    validation.set_issuer(&["https://accounts.google.com", "accounts.google.com"]);
    validation.validate_exp = true;

    let claims = decode::<GoogleClaims>(&id_token, &decoding_key, &validation)
        .map_err(|_| ApiError::Forbidden)?
        .claims;

    if !matches!(
        claims.iss.as_str(),
        "https://accounts.google.com" | "accounts.google.com"
    ) || claims.aud != client_id
        || claims.nonce.as_deref() != Some(expected_nonce.as_str())
        || claims.email_verified != Some(true)
        || claims.hd.as_deref() != Some(expected_hd.as_str())
    {
        return Err(ApiError::Forbidden);
    }

    let email = claims
        .email
        .as_deref()
        .map(|e| e.trim().to_ascii_lowercase())
        .filter(|e| !e.is_empty())
        .ok_or(ApiError::Forbidden)?;

    let mut tx = s.admin_pool.begin().await?;
    let staff = sqlx::query(
        "SELECT id, google_sub, email, display_name, roles, is_active
         FROM admin.staff_users
         WHERE google_sub = $1 OR (google_sub IS NULL AND lower(email) = lower($2))",
    )
    .bind(&claims.sub)
    .bind(&email)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(staff) = staff else {
        audit::record(
            &mut tx,
            StaffAuditEntry {
                staff_user_id: None,
                staff_email: Some(&email),
                active_roles: &[],
                action: "staff_login_denied",
                workspace_id: None,
                target_type: Some("staff_user"),
                target_id: None,
                request_id: None,
                reason: Some("not_allowlisted"),
                ticket_ref: None,
                support_session_id: None,
                before_state: None,
                after_state: Some(json!({ "email": email, "google_sub": claims.sub })),
                outcome: "denied",
            },
        )
        .await?;
        tx.commit().await?;
        return Err(ApiError::Forbidden);
    };

    let staff_id: Uuid = staff.try_get("id")?;
    let is_active: bool = staff.try_get("is_active")?;
    let roles: Vec<String> = staff.try_get("roles")?;
    if !is_active || roles.is_empty() {
        audit::record(
            &mut tx,
            StaffAuditEntry {
                staff_user_id: Some(staff_id),
                staff_email: Some(&email),
                active_roles: &roles,
                action: "staff_login_denied",
                workspace_id: None,
                target_type: Some("staff_user"),
                target_id: Some(&staff_id.to_string()),
                request_id: None,
                reason: Some("inactive_or_no_roles"),
                ticket_ref: None,
                support_session_id: None,
                before_state: None,
                after_state: None,
                outcome: "denied",
            },
        )
        .await?;
        tx.commit().await?;
        return Err(ApiError::Forbidden);
    }

    let existing_sub: Option<String> = staff.try_get("google_sub")?;
    let display_name = claims
        .name
        .as_deref()
        .filter(|n| !n.trim().is_empty())
        .map(str::to_owned);

    sqlx::query(
        "UPDATE admin.staff_users
         SET google_sub = COALESCE(google_sub, $2),
             display_name = COALESCE($3, display_name),
             last_login_at = now(),
             updated_at = now()
         WHERE id = $1",
    )
    .bind(staff_id)
    .bind(&claims.sub)
    .bind(&display_name)
    .execute(&mut *tx)
    .await?;

    let raw_session = random_hex(32);
    let session_hash = hash_token(&raw_session);
    let session_id: Uuid = sqlx::query_scalar(
        "INSERT INTO admin.staff_sessions(staff_user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '8 hours')
         RETURNING id",
    )
    .bind(staff_id)
    .bind(&session_hash)
    .fetch_one(&mut *tx)
    .await?;

    audit::record(
        &mut tx,
        StaffAuditEntry {
            staff_user_id: Some(staff_id),
            staff_email: Some(&email),
            active_roles: &roles,
            action: "staff_login",
            workspace_id: None,
            target_type: Some("staff_session"),
            target_id: Some(&session_id.to_string()),
            request_id: None,
            reason: None,
            ticket_ref: None,
            support_session_id: None,
            before_state: existing_sub.map(|sub| json!({ "google_sub": sub })),
            after_state: Some(json!({ "session_id": session_id })),
            outcome: "success",
        },
    )
    .await?;
    tx.commit().await?;

    let app_origin = std::env::var("ADMIN_APP_ORIGIN").unwrap_or_default();
    let dest = format!(
        "{}{}",
        app_origin.trim_end_matches('/'),
        redirect_to.as_deref().unwrap_or("/")
    );
    let cookie = set_cookie(ADMIN_SESSION_COOKIE, &raw_session, SESSION_MAX_AGE_SECS);
    let mut headers = HeaderMap::new();
    headers.insert(
        header::SET_COOKIE,
        cookie.parse().map_err(|_| ApiError::Internal)?,
    );
    Ok((StatusCode::FOUND, headers, Redirect::temporary(&dest)).into_response())
}

pub async fn logout(State(s): State<AppState>, ctx: StaffContext) -> Result<Response, ApiError> {
    let mut tx = s.admin_pool.begin().await?;
    if let Some(session_id) = ctx.session_id {
        sqlx::query("UPDATE admin.staff_sessions SET revoked_at = now() WHERE id = $1")
            .bind(session_id)
            .execute(&mut *tx)
            .await?;
    }
    let sid_str = ctx.session_id.map(|id| id.to_string());
    audit::record_ctx(
        &mut tx,
        &ctx,
        audit::CtxAudit {
            action: "staff_logout",
            workspace_id: None,
            target_type: Some("staff_session"),
            target_id: sid_str.as_deref(),
            reason: None,
            before_state: None,
            after_state: None,
        },
    )
    .await?;
    tx.commit().await?;

    let cookie = set_cookie(ADMIN_SESSION_COOKIE, "", 0);
    let mut headers = HeaderMap::new();
    headers.insert(
        header::SET_COOKIE,
        cookie.parse().map_err(|_| ApiError::Internal)?,
    );
    Ok((
        StatusCode::OK,
        headers,
        Json(json!({ "data": { "loggedOut": true } })),
    )
        .into_response())
}

pub async fn me(ctx: StaffContext) -> Json<Value> {
    Json(json!({
        "data": {
            "id": ctx.staff_user_id,
            "email": ctx.email,
            "displayName": ctx.display_name,
            "roles": ctx.roles,
        }
    }))
}
