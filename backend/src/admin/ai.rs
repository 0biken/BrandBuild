use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::{Duration, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    admin::{
        audit::{record, StaffAuditEntry},
        StaffContext, StaffRole,
    },
    api::ApiError,
    AppState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSummaryQuery {
    days: Option<i32>,
}

pub async fn get_ai_spend(
    State(state): State<AppState>,
    staff: StaffContext,
    Query(q): Query<AiSummaryQuery>,
) -> Result<Json<Value>, ApiError> {
    staff.require(&[
        StaffRole::Support,
        StaffRole::Operations,
        StaffRole::StaffAdmin,
    ])?;
    let days = q.days.unwrap_or(14).clamp(1, 90);
    let summary: Value = sqlx::query_scalar("SELECT admin.ai_spend_summary($1)")
        .bind(days)
        .fetch_one(&state.admin_pool)
        .await?;
    Ok(Json(json!({ "data": summary })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateAiPolicyInput {
    global_daily_usd_budget: Option<f64>,
    default_workspace_monthly_usd_budget: Option<f64>,
    default_workspace_daily_gen_limit: Option<i32>,
    alert_warn_pct: Option<i32>,
    alert_hard_pct: Option<i32>,
    reason: Option<String>,
}

pub async fn update_ai_policy(
    State(state): State<AppState>,
    staff: StaffContext,
    Json(input): Json<UpdateAiPolicyInput>,
) -> Result<Json<Value>, ApiError> {
    staff.require(&[StaffRole::Operations, StaffRole::StaffAdmin])?;
    if input.global_daily_usd_budget.is_some_and(|v| v < 0.0)
        || input
            .default_workspace_monthly_usd_budget
            .is_some_and(|v| v < 0.0)
        || input
            .default_workspace_daily_gen_limit
            .is_some_and(|v| v < 0)
        || input
            .alert_warn_pct
            .is_some_and(|v| !(1..=100).contains(&v))
        || input
            .alert_hard_pct
            .is_some_and(|v| !(1..=100).contains(&v))
    {
        return Err(ApiError::InvalidInput);
    }

    let mut tx = state.admin_pool.begin().await?;
    let before = sqlx::query(
        "SELECT global_daily_usd_budget::float8 AS g, default_workspace_monthly_usd_budget::float8 AS m,
                default_workspace_daily_gen_limit AS d, alert_warn_pct AS w, alert_hard_pct AS h
         FROM admin.ai_policies WHERE id = 1",
    )
    .fetch_one(&mut *tx)
    .await?;

    let before_json = json!({
        "globalDailyUsdBudget": before.get::<f64, _>("g"),
        "defaultWorkspaceMonthlyUsdBudget": before.get::<f64, _>("m"),
        "defaultWorkspaceDailyGenLimit": before.get::<i32, _>("d"),
        "alertWarnPct": before.get::<i32, _>("w"),
        "alertHardPct": before.get::<i32, _>("h"),
    });

    let updated = sqlx::query(
        "UPDATE admin.ai_policies SET
           global_daily_usd_budget = COALESCE($1::numeric, global_daily_usd_budget),
           default_workspace_monthly_usd_budget = COALESCE($2::numeric, default_workspace_monthly_usd_budget),
           default_workspace_daily_gen_limit = COALESCE($3, default_workspace_daily_gen_limit),
           alert_warn_pct = COALESCE($4, alert_warn_pct),
           alert_hard_pct = COALESCE($5, alert_hard_pct),
           updated_by = $6,
           updated_at = now()
         WHERE id = 1
         RETURNING global_daily_usd_budget::float8 AS g, default_workspace_monthly_usd_budget::float8 AS m,
                   default_workspace_daily_gen_limit AS d, alert_warn_pct AS w, alert_hard_pct AS h",
    )
    .bind(input.global_daily_usd_budget)
    .bind(input.default_workspace_monthly_usd_budget)
    .bind(input.default_workspace_daily_gen_limit)
    .bind(input.alert_warn_pct)
    .bind(input.alert_hard_pct)
    .bind(staff.staff_user_id)
    .fetch_one(&mut *tx)
    .await?;

    let after_json = json!({
        "globalDailyUsdBudget": updated.get::<f64, _>("g"),
        "defaultWorkspaceMonthlyUsdBudget": updated.get::<f64, _>("m"),
        "defaultWorkspaceDailyGenLimit": updated.get::<i32, _>("d"),
        "alertWarnPct": updated.get::<i32, _>("w"),
        "alertHardPct": updated.get::<i32, _>("h"),
    });

    let active_roles: Vec<String> = staff.roles.iter().map(|r| r.as_str().to_string()).collect();
    record(
        &mut tx,
        StaffAuditEntry {
            staff_user_id: Some(staff.staff_user_id),
            staff_email: Some(&staff.email),
            active_roles: &active_roles,
            action: "ai.policy_update",
            workspace_id: None,
            target_type: Some("ai_policy"),
            target_id: Some("1"),
            request_id: None,
            reason: input.reason.as_deref(),
            ticket_ref: None,
            support_session_id: None,
            before_state: Some(before_json),
            after_state: Some(after_json.clone()),
            outcome: "success",
        },
    )
    .await?;

    tx.commit().await?;
    Ok(Json(json!({ "data": after_json })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateWorkspaceAiInput {
    monthly_usd_budget: Option<f64>,
    daily_gen_limit: Option<i32>,
    suspend_hours: Option<i64>,
    clear_suspension: Option<bool>,
    reason: Option<String>,
}

pub async fn update_workspace_ai(
    State(state): State<AppState>,
    staff: StaffContext,
    Path(workspace_id): Path<Uuid>,
    Json(input): Json<UpdateWorkspaceAiInput>,
) -> Result<Json<Value>, ApiError> {
    staff.require(&[StaffRole::Operations, StaffRole::StaffAdmin])?;
    if input.monthly_usd_budget.is_some_and(|v| v < 0.0)
        || input.daily_gen_limit.is_some_and(|v| v < 0)
        || input.suspend_hours.is_some_and(|h| !(1..=720).contains(&h))
    {
        return Err(ApiError::InvalidInput);
    }

    let suspended_until = input
        .suspend_hours
        .map(|hrs| Utc::now() + Duration::hours(hrs));
    let clear_suspension = input.clear_suspension.unwrap_or(false);

    let mut tx = state.admin_pool.begin().await?;
    let row = sqlx::query(
        "INSERT INTO admin.workspace_ai_controls (
           tenant_id, monthly_usd_budget, daily_gen_limit, suspended_until, suspension_reason, updated_by, updated_at
         )
         VALUES ($1, $2::numeric, $3, $4, $5, $6, now())
         ON CONFLICT (tenant_id) DO UPDATE SET
           monthly_usd_budget = COALESCE(EXCLUDED.monthly_usd_budget, admin.workspace_ai_controls.monthly_usd_budget),
           daily_gen_limit = COALESCE(EXCLUDED.daily_gen_limit, admin.workspace_ai_controls.daily_gen_limit),
           suspended_until = CASE
             WHEN $7 THEN NULL
             WHEN EXCLUDED.suspended_until IS NOT NULL THEN EXCLUDED.suspended_until
             ELSE admin.workspace_ai_controls.suspended_until
           END,
           suspension_reason = CASE
             WHEN $7 THEN NULL
             WHEN EXCLUDED.suspended_until IS NOT NULL THEN EXCLUDED.suspension_reason
             ELSE admin.workspace_ai_controls.suspension_reason
           END,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()
         RETURNING monthly_usd_budget::float8 AS m, daily_gen_limit AS d, suspended_until, suspension_reason",
    )
    .bind(workspace_id)
    .bind(input.monthly_usd_budget)
    .bind(input.daily_gen_limit)
    .bind(suspended_until)
    .bind(input.reason.as_deref())
    .bind(staff.staff_user_id)
    .bind(clear_suspension)
    .fetch_one(&mut *tx)
    .await?;

    let after_json = json!({
        "tenantId": workspace_id,
        "monthlyUsdBudget": row.get::<Option<f64>, _>("m"),
        "dailyGenLimit": row.get::<Option<i32>, _>("d"),
        "suspendedUntil": row.get::<Option<chrono::DateTime<Utc>>, _>("suspended_until"),
        "suspensionReason": row.get::<Option<String>, _>("suspension_reason"),
    });

    let active_roles: Vec<String> = staff.roles.iter().map(|r| r.as_str().to_string()).collect();
    record(
        &mut tx,
        StaffAuditEntry {
            staff_user_id: Some(staff.staff_user_id),
            staff_email: Some(&staff.email),
            active_roles: &active_roles,
            action: "ai.workspace_control_update",
            workspace_id: Some(workspace_id),
            target_type: Some("workspace_ai_controls"),
            target_id: Some(&workspace_id.to_string()),
            request_id: None,
            reason: input.reason.as_deref(),
            ticket_ref: None,
            support_session_id: None,
            before_state: None,
            after_state: Some(after_json.clone()),
            outcome: "success",
        },
    )
    .await?;

    tx.commit().await?;
    Ok(Json(json!({ "data": after_json })))
}
