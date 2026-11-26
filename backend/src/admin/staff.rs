//! Staff allowlist and role management (`/admin/v1/staff`).
//! Only Staff Administrators may list, add, or modify staff accounts.
//! Role changes and disablement revoke active sessions in the same transaction.
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

use crate::{api::ApiError, auth::AuthError, AppState};

use super::{audit, StaffContext, StaffRole};

fn map_auth(err: AuthError) -> ApiError {
    match err {
        AuthError::Forbidden => ApiError::Forbidden,
        _ => ApiError::Internal,
    }
}

fn validate_roles(roles: &[String]) -> Result<Vec<String>, ApiError> {
    if roles.is_empty() {
        return Err(ApiError::InvalidInput);
    }
    let mut out = Vec::with_capacity(roles.len());
    for r in roles {
        let parsed = StaffRole::parse(r).ok_or(ApiError::InvalidInput)?;
        let s = parsed.as_str().to_owned();
        if !out.contains(&s) {
            out.push(s);
        }
    }
    Ok(out)
}

fn staff_json(row: &sqlx::postgres::PgRow) -> Result<Value, ApiError> {
    Ok(json!({
        "id": row.try_get::<Uuid, _>("id")?,
        "email": row.try_get::<String, _>("email")?,
        "displayName": row.try_get::<String, _>("display_name")?,
        "roles": row.try_get::<Vec<String>, _>("roles")?,
        "isActive": row.try_get::<bool, _>("is_active")?,
        "lastLoginAt": row.try_get::<Option<DateTime<Utc>>, _>("last_login_at")?.map(|d| d.to_rfc3339()),
        "createdAt": row.try_get::<DateTime<Utc>, _>("created_at")?.to_rfc3339(),
    }))
}

pub async fn list_staff(
    State(s): State<AppState>,
    ctx: StaffContext,
) -> Result<Json<Value>, ApiError> {
    ctx.require(&[StaffRole::StaffAdmin]).map_err(map_auth)?;
    let rows = sqlx::query(
        "SELECT id, email, display_name, roles, is_active, last_login_at, created_at
         FROM admin.staff_users
         ORDER BY created_at ASC, email ASC",
    )
    .fetch_all(&s.admin_pool)
    .await?;

    let data = rows.iter().map(staff_json).collect::<Result<Vec<_>, _>>()?;
    Ok(Json(json!({ "data": data })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateStaffInput {
    pub email: String,
    pub display_name: String,
    pub roles: Vec<String>,
}

pub async fn create_staff(
    State(s): State<AppState>,
    ctx: StaffContext,
    Json(input): Json<CreateStaffInput>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    ctx.require(&[StaffRole::StaffAdmin]).map_err(map_auth)?;
    let email = input.email.trim().to_ascii_lowercase();
    let display_name = input.display_name.trim();
    if email.is_empty() || !email.contains('@') || display_name.is_empty() {
        return Err(ApiError::InvalidInput);
    }
    let roles = validate_roles(&input.roles)?;

    let mut tx = s.admin_pool.begin().await?;
    let row = sqlx::query(
        "INSERT INTO admin.staff_users(email, display_name, roles)
         VALUES ($1, $2, $3)
         RETURNING id, email, display_name, roles, is_active, last_login_at, created_at",
    )
    .bind(&email)
    .bind(display_name)
    .bind(&roles)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23505") => ApiError::Conflict,
        _ => ApiError::from(e),
    })?;

    let id: Uuid = row.try_get("id")?;
    let body = staff_json(&row)?;
    let id_str = id.to_string();
    audit::record_ctx(
        &mut tx,
        &ctx,
        audit::CtxAudit {
            action: "staff_created",
            workspace_id: None,
            target_type: Some("staff_user"),
            target_id: Some(&id_str),
            reason: None,
            before_state: None,
            after_state: Some(body.clone()),
        },
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({ "data": body }))))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateStaffInput {
    pub display_name: Option<String>,
    pub roles: Option<Vec<String>>,
    pub is_active: Option<bool>,
    pub reason: Option<String>,
}

pub async fn update_staff(
    State(s): State<AppState>,
    ctx: StaffContext,
    Path(id): Path<Uuid>,
    Json(input): Json<UpdateStaffInput>,
) -> Result<Json<Value>, ApiError> {
    ctx.require(&[StaffRole::StaffAdmin]).map_err(map_auth)?;
    let roles = match input.roles {
        Some(ref r) => Some(validate_roles(r)?),
        None => None,
    };

    let mut tx = s.admin_pool.begin().await?;
    let before = sqlx::query(
        "SELECT id, email, display_name, roles, is_active, last_login_at, created_at
         FROM admin.staff_users
         WHERE id = $1
         FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::NotFound)?;

    let before_json = staff_json(&before)?;
    let prev_roles: Vec<String> = before.try_get("roles")?;
    let prev_active: bool = before.try_get("is_active")?;

    let next_name = input
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| before.try_get("display_name").unwrap_or_default());
    let next_roles = roles.unwrap_or_else(|| prev_roles.clone());
    let next_active = input.is_active.unwrap_or(prev_active);

    // Prevent the last active Staff Administrator from locking themselves out.
    if id == ctx.staff_user_id && (!next_active || !next_roles.contains(&"staff_admin".to_owned()))
    {
        return Err(ApiError::Conflict);
    }

    let after = sqlx::query(
        "UPDATE admin.staff_users
         SET display_name = $2, roles = $3, is_active = $4, updated_at = now()
         WHERE id = $1
         RETURNING id, email, display_name, roles, is_active, last_login_at, created_at",
    )
    .bind(id)
    .bind(&next_name)
    .bind(&next_roles)
    .bind(next_active)
    .fetch_one(&mut *tx)
    .await?;

    // Revoke active sessions whenever roles change or the account is disabled.
    if next_roles != prev_roles || !next_active {
        sqlx::query(
            "UPDATE admin.staff_sessions SET revoked_at = now()
             WHERE staff_user_id = $1 AND revoked_at IS NULL",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }

    let after_json = staff_json(&after)?;
    let id_str = id.to_string();
    audit::record_ctx(
        &mut tx,
        &ctx,
        audit::CtxAudit {
            action: "staff_updated",
            workspace_id: None,
            target_type: Some("staff_user"),
            target_id: Some(&id_str),
            reason: input.reason.as_deref(),
            before_state: Some(before_json),
            after_state: Some(after_json.clone()),
        },
    )
    .await?;
    tx.commit().await?;

    Ok(Json(json!({ "data": after_json })))
}
