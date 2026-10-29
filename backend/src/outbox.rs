//! Transactional outbox and publish-attempt helpers.
use serde_json::Value;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

pub async fn enqueue(
    tx: &mut Transaction<'_, Postgres>, tenant_id: Uuid, topic: &str, payload: Value,
) -> Result<Uuid, sqlx::Error> {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO outbox (id, tenant_id, topic, payload) VALUES ($1, $2, $3, $4)")
        .bind(id).bind(tenant_id).bind(topic).bind(payload).execute(&mut **tx).await?;
    Ok(id)
}

/// Create one publish attempt per tenant-scoped stable key. A duplicate request
/// returns the existing attempt id, allowing callers to safely retry enqueueing.
pub async fn ensure_publish_attempt(
    pool: &PgPool,
    tenant_id: Uuid,
    post_id: Uuid,
    post_version_id: Uuid,
    channel_id: Option<Uuid>,
    idempotency_key: &str,
) -> Result<Uuid, sqlx::Error> {
    let proposed_id = Uuid::new_v4();
    let inserted = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO publish_attempts (id, tenant_id, post_id, post_version_id, channel_id, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING id"
    ).bind(proposed_id).bind(tenant_id).bind(post_id).bind(post_version_id).bind(channel_id).bind(idempotency_key)
        .fetch_optional(pool).await?;
    if let Some(id) = inserted { return Ok(id); }
    sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM publish_attempts WHERE tenant_id = $1 AND idempotency_key = $2"
    ).bind(tenant_id).bind(idempotency_key).fetch_one(pool).await
}

/// Claim an outbox batch with row locks so competing workers don't process the
/// same ready message concurrently. Lease recovery and dispatch remain TODO.
pub async fn claim_batch(pool: &PgPool, limit: i64) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar::<_, Uuid>(
        "WITH picked AS (SELECT id FROM outbox WHERE processed_at IS NULL AND locked_at IS NULL AND available_at <= now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1) UPDATE outbox o SET locked_at = now(), attempts = attempts + 1 FROM picked WHERE o.id = picked.id RETURNING o.id"
    ).bind(limit).fetch_all(pool).await
}
