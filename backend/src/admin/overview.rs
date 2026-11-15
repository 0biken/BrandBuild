//! Live operational overview (`/admin/v1/overview`).
use axum::{extract::State, Json};
use serde_json::{json, Value};

use crate::{api::ApiError, auth::AuthError, AppState};

use super::{StaffContext, StaffRole};

pub async fn get_overview(
    State(s): State<AppState>,
    ctx: StaffContext,
) -> Result<Json<Value>, ApiError> {
    ctx.require(&[
        StaffRole::Support,
        StaffRole::Operations,
        StaffRole::StudentReviewer,
        StaffRole::StaffAdmin,
    ])
    .map_err(|e| match e {
        AuthError::Forbidden => ApiError::Forbidden,
        _ => ApiError::Internal,
    })?;

    let summary: Value = sqlx::query_scalar("SELECT admin.overview_summary()")
        .fetch_one(&s.admin_pool)
        .await?;

    Ok(Json(json!({ "data": summary })))
}
