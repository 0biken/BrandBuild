//! Append-only audit trail. Every decision that changes what may be published, and every
//! change to facts or files the AI can use, writes one row in the same transaction.
use serde_json::Value;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::auth::TenantContext;

pub async fn record(
    tx: &mut Transaction<'_, Postgres>,
    ctx: &TenantContext,
    action: &str,
    resource_type: &str,
    resource_id: Uuid,
    details: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO audit_log(tenant_id,actor_id,action,resource_type,resource_id,details) VALUES($1,$2,$3,$4,$5,$6)",
    )
    .bind(ctx.tenant_id)
    .bind(ctx.actor_id)
    .bind(action)
    .bind(resource_type)
    .bind(resource_id)
    .bind(details)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
