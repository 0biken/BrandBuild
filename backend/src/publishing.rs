//! Publishing connector contract, lease fencing, pre-submit hold checks, and reconciliation.
use std::{future::Future, pin::Pin};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum PublishOutcome {
    Published {
        platform_post_id: String,
        receipt: Value,
    },
    Failed {
        error: String,
    },
    UnknownOutcome {
        error: String,
        partial_receipt: Option<Value>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReconcileOutcome {
    ConfirmedPublished {
        platform_post_id: String,
        receipt: Value,
    },
    ConfirmedNotPublished {
        reason: String,
        retry_eligible: bool,
    },
    Inconclusive {
        reason: String,
    },
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub trait SocialConnector: Send + Sync {
    fn publish<'a>(
        &'a self,
        provider: &'a str,
        idempotency_key: &'a str,
        content: &'a Value,
    ) -> BoxFuture<'a, PublishOutcome>;

    fn reconcile<'a>(
        &'a self,
        provider: &'a str,
        idempotency_key: &'a str,
        platform_post_id: Option<&'a str>,
    ) -> BoxFuture<'a, ReconcileOutcome>;
}

pub struct DefaultNoopConnector;

impl SocialConnector for DefaultNoopConnector {
    fn publish<'a>(
        &'a self,
        provider: &'a str,
        idempotency_key: &'a str,
        _content: &'a Value,
    ) -> BoxFuture<'a, PublishOutcome> {
        Box::pin(async move {
            PublishOutcome::UnknownOutcome {
                error: format!(
                    "Provider adapter for {provider} is not configured; manual reconciliation required."
                ),
                partial_receipt: Some(json!({ "idempotencyKey": idempotency_key, "adapter": "noop" })),
            }
        })
    }

    fn reconcile<'a>(
        &'a self,
        provider: &'a str,
        _idempotency_key: &'a str,
        platform_post_id: Option<&'a str>,
    ) -> BoxFuture<'a, ReconcileOutcome> {
        Box::pin(async move {
            if let Some(pid) = platform_post_id {
                ReconcileOutcome::ConfirmedPublished {
                    platform_post_id: pid.to_owned(),
                    receipt: json!({ "provider": provider, "platformPostId": pid, "verifiedBy": "receipt" }),
                }
            } else {
                ReconcileOutcome::Inconclusive {
                    reason: format!("Provider reconciliation for {provider} is not configured."),
                }
            }
        })
    }
}

/// Executes a queued publish attempt with lease fencing and a pre-submission hold recheck.
pub async fn execute_publish_attempt(
    pool: &PgPool,
    admin_pool: &PgPool,
    connector: &dyn SocialConnector,
    worker_id: &str,
    tenant_id: Uuid,
    attempt_id: Uuid,
) -> Result<(), String> {
    let lease = Uuid::new_v4();
    let row = sqlx::query(
        "UPDATE publish_attempts pa
         SET state = 'running',
             worker_id = $2,
             lease_token = $3,
             started_at = COALESCE(started_at, now())
         FROM posts p, post_versions pv
         WHERE pa.id = $1
           AND pa.tenant_id = $4
           AND pa.state = 'queued'
           AND pa.fenced_at IS NULL
           AND p.id = pa.post_id
           AND pv.id = pa.post_version_id
         RETURNING pa.post_id, pa.channel_id, pa.idempotency_key, pv.content,
                   (SELECT provider FROM channels WHERE id = pa.channel_id) AS provider,
                   p.platforms",
    )
    .bind(attempt_id)
    .bind(worker_id)
    .bind(lease)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let Some(row) = row else {
        return Ok(());
    };

    let post_id: Uuid = row.try_get("post_id").map_err(|e| e.to_string())?;
    let channel_id: Option<Uuid> = row.try_get("channel_id").map_err(|e| e.to_string())?;
    let idempotency_key: String = row.try_get("idempotency_key").map_err(|e| e.to_string())?;
    let content: Value = row.try_get("content").map_err(|e| e.to_string())?;
    let provider: Option<String> = row.try_get("provider").map_err(|e| e.to_string())?;
    let platforms: Vec<String> = row.try_get("platforms").map_err(|e| e.to_string())?;
    let provider = provider.unwrap_or_else(|| {
        platforms
            .first()
            .cloned()
            .unwrap_or_else(|| "ig".to_owned())
    });

    // Re-check active global, workspace, and channel holds immediately before provider submission.
    let holds: Value = sqlx::query_scalar("SELECT admin.active_holds_for_target($1, $2)")
        .bind(tenant_id)
        .bind(channel_id)
        .fetch_one(admin_pool)
        .await
        .map_err(|e| e.to_string())?;

    if holds.as_array().is_some_and(|a| !a.is_empty()) {
        sqlx::query(
            "UPDATE publish_attempts
             SET state = 'failed',
                 error = 'Paused by active publishing hold before provider submission',
                 finished_at = now()
             WHERE id = $1 AND lease_token = $2 AND fenced_at IS NULL",
        )
        .bind(attempt_id)
        .bind(lease)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

        sqlx::query(
            "UPDATE posts SET state = 'approved', updated_at = now()
             WHERE id = $1 AND tenant_id = $2 AND state = 'publishing'",
        )
        .bind(post_id)
        .bind(tenant_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let outcome = connector
        .publish(&provider, &idempotency_key, &content)
        .await;

    // Fence check: if an admin fenced this worker while in flight, do not mutate post state.
    let still_valid: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM publish_attempts WHERE id = $1 AND lease_token = $2 AND fenced_at IS NULL",
    )
    .bind(attempt_id)
    .bind(lease)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    if still_valid.is_none() {
        tracing::warn!(%attempt_id, worker_id, "publish worker fenced before persisting outcome");
        return Ok(());
    }

    match outcome {
        PublishOutcome::Published {
            platform_post_id,
            receipt,
        } => {
            sqlx::query(
                "UPDATE publish_attempts
                 SET state = 'succeeded', platform_post_id = $3, receipt = $4, finished_at = now()
                 WHERE id = $1 AND lease_token = $2 AND fenced_at IS NULL",
            )
            .bind(attempt_id)
            .bind(lease)
            .bind(&platform_post_id)
            .bind(&receipt)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

            sqlx::query(
                "UPDATE posts SET state = 'published', published_at = now(), updated_at = now()
                 WHERE id = $1 AND tenant_id = $2",
            )
            .bind(post_id)
            .bind(tenant_id)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        }
        PublishOutcome::Failed { error } => {
            sqlx::query(
                "UPDATE publish_attempts
                 SET state = 'failed', error = $3, finished_at = now()
                 WHERE id = $1 AND lease_token = $2 AND fenced_at IS NULL",
            )
            .bind(attempt_id)
            .bind(lease)
            .bind(&error)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

            sqlx::query(
                "UPDATE posts SET state = 'failed', updated_at = now()
                 WHERE id = $1 AND tenant_id = $2",
            )
            .bind(post_id)
            .bind(tenant_id)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        }
        PublishOutcome::UnknownOutcome {
            error,
            partial_receipt,
        } => {
            sqlx::query(
                "UPDATE publish_attempts
                 SET state = 'unknown', error = $3, receipt = COALESCE($4, receipt), finished_at = now()
                 WHERE id = $1 AND lease_token = $2 AND fenced_at IS NULL",
            )
            .bind(attempt_id)
            .bind(lease)
            .bind(&error)
            .bind(&partial_receipt)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

            sqlx::query(
                "UPDATE posts SET state = 'unknown_outcome', updated_at = now()
                 WHERE id = $1 AND tenant_id = $2",
            )
            .bind(post_id)
            .bind(tenant_id)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}
