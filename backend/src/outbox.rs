//! Transactional outbox helpers. Dispatch is at-least-once; consumers use event IDs for idempotency.
use serde_json::Value;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

pub async fn enqueue(tx: &mut Transaction<'_, Postgres>, tenant_id: Uuid, topic: &str, payload: Value) -> Result<Uuid, sqlx::Error> {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO outbox (id, tenant_id, topic, payload) VALUES ($1, $2, $3, $4)")
        .bind(id).bind(tenant_id).bind(topic).bind(payload).execute(&mut **tx).await?;
    Ok(id)
}

/// Create one publish attempt per tenant-scoped stable key, returning existing IDs for retries.
pub async fn ensure_publish_attempt(pool: &PgPool, tenant_id: Uuid, post_id: Uuid, post_version_id: Uuid, channel_id: Option<Uuid>, idempotency_key: &str) -> Result<Uuid, sqlx::Error> {
    let proposed_id = Uuid::new_v4();
    if let Some(id) = sqlx::query_scalar::<_, Uuid>("INSERT INTO publish_attempts (id, tenant_id, post_id, post_version_id, channel_id, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id,idempotency_key) DO NOTHING RETURNING id")
        .bind(proposed_id).bind(tenant_id).bind(post_id).bind(post_version_id).bind(channel_id).bind(idempotency_key).fetch_optional(pool).await? { return Ok(id); }
    sqlx::query_scalar::<_, Uuid>("SELECT id FROM publish_attempts WHERE tenant_id=$1 AND idempotency_key=$2").bind(tenant_id).bind(idempotency_key).fetch_one(pool).await
}

#[derive(Clone, Debug)]
pub struct ClaimedEvent { pub id: Uuid, pub tenant_id: Uuid, pub topic: String, pub payload: Value, pub attempts: i32 }

/// Claims ready events and reclaims expired leases using row locks. Lease time is recorded atomically.
pub async fn claim_batch(pool: &PgPool, worker_id: &str, limit: i64, lease_seconds: i64) -> Result<Vec<ClaimedEvent>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let rows = sqlx::query_as::<_, (Uuid, Uuid, String, Value, i32)>(
        "WITH picked AS (SELECT id FROM outbox WHERE processed_at IS NULL AND failed_at IS NULL AND available_at <= now() AND (locked_at IS NULL OR locked_at < now() - ($3 * interval '1 second')) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1) UPDATE outbox o SET locked_at=now(), lease_owner=$2, attempts=o.attempts+1 FROM picked WHERE o.id=picked.id RETURNING o.id,o.tenant_id,o.topic,o.payload,o.attempts"
    ).bind(limit.clamp(1, 500)).bind(worker_id).bind(lease_seconds.max(1)).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(rows.into_iter().map(|(id, tenant_id, topic, payload, attempts)| ClaimedEvent { id, tenant_id, topic, payload, attempts }).collect())
}

pub async fn mark_processed(pool: &PgPool, id: Uuid, worker_id: &str) -> Result<bool, sqlx::Error> {
    let n = sqlx::query("UPDATE outbox SET processed_at=now(),locked_at=NULL,lease_owner=NULL,last_error=NULL WHERE id=$1 AND lease_owner=$2 AND processed_at IS NULL AND failed_at IS NULL")
        .bind(id).bind(worker_id).execute(pool).await?.rows_affected();
    Ok(n == 1)
}

/// Retry with exponential backoff until max_attempts, then mark terminally failed.
pub async fn mark_failed(pool: &PgPool, id: Uuid, worker_id: &str, attempts: i32, max_attempts: i32, error: &str) -> Result<bool, sqlx::Error> {
    let delay_seconds = retry_delay_seconds(attempts);
    let n = if attempts >= max_attempts {
        sqlx::query("UPDATE outbox SET failed_at=now(),locked_at=NULL,lease_owner=NULL,last_error=$3 WHERE id=$1 AND lease_owner=$2 AND processed_at IS NULL AND failed_at IS NULL")
            .bind(id).bind(worker_id).bind(error).execute(pool).await?.rows_affected()
    } else {
        sqlx::query("UPDATE outbox SET available_at=now()+($4 * interval '1 second'),locked_at=NULL,lease_owner=NULL,last_error=$3 WHERE id=$1 AND lease_owner=$2 AND processed_at IS NULL AND failed_at IS NULL")
            .bind(id).bind(worker_id).bind(error).bind(delay_seconds).execute(pool).await?.rows_affected()
    };
    Ok(n == 1)
}

pub fn retry_delay_seconds(attempts: i32) -> i64 { 2_i64.saturating_pow(attempts.clamp(1, 10) as u32).min(3600) }

#[cfg(test)]
mod tests {
    use super::retry_delay_seconds;
    #[test]
    fn retry_backoff_is_exponential_and_bounded() {
        assert_eq!(retry_delay_seconds(1), 2);
        assert_eq!(retry_delay_seconds(2), 4);
        assert_eq!(retry_delay_seconds(10), 1024);
        assert_eq!(retry_delay_seconds(99), 1024);
    }
    #[test]
    fn attempts_are_clamped_to_at_least_one() { assert_eq!(retry_delay_seconds(0), 2); }
}
