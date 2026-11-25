//! Publishing connector contract, lease fencing, pre-submit hold checks, and reconciliation.
use std::{future::Future, pin::Pin};

use crate::db::tenant_tx;
use serde::{Deserialize, Serialize};
use serde_json::Value;
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
        _idempotency_key: &'a str,
        _content: &'a Value,
    ) -> BoxFuture<'a, PublishOutcome> {
        Box::pin(async move {
            PublishOutcome::Failed {
                error: format!(
                    "Provider adapter for {provider} is not configured; publishing is unsupported."
                ),
            }
        })
    }

    fn reconcile<'a>(
        &'a self,
        provider: &'a str,
        _idempotency_key: &'a str,
        _platform_post_id: Option<&'a str>,
    ) -> BoxFuture<'a, ReconcileOutcome> {
        Box::pin(async move {
            ReconcileOutcome::Inconclusive {
                reason: format!("Provider reconciliation for {provider} is not configured."),
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
    let mut tx = tenant_tx(pool, tenant_id)
        .await
        .map_err(|e| e.to_string())?;
    let previous: Option<(String, bool, bool, bool, Uuid)> = sqlx::query_as(
        "SELECT state::text, fenced_at IS NOT NULL OR resolved_at IS NOT NULL,
         submission_started_at IS NOT NULL,
         COALESCE(lease_expires_at,started_at+interval '60 seconds','-infinity'::timestamptz)<=now(), post_id
         FROM publish_attempts WHERE id=$1 FOR UPDATE")
        .bind(attempt_id).fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?;
    if let Some((state, fenced, submitted, expired, post)) = previous {
        if state == "running" && !fenced {
            if !expired {
                // Do not acknowledge the outbox delivery or steal a live claim.
                return Err("Publish attempt still has an active worker lease".into());
            }
            if submitted {
                sqlx::query(
                    "UPDATE publish_attempts SET state='unknown', fenced_at=now(),
                    finished_at=NULL, reconcile_evidence=NULL, version=version+1,
                    error='Worker lease expired after submission began; remote outcome unresolved'
                    WHERE id=$1",
                )
                .bind(attempt_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
                sqlx::query("UPDATE posts SET state='reconciling',updated_at=now() WHERE id=$1 AND state='publishing'")
                    .bind(post).execute(&mut *tx).await.map_err(|e| e.to_string())?;
                tx.commit().await.map_err(|e| e.to_string())?;
                return Ok(());
            }
            // An expired worker must pass the lease CAS before it can submit.
            // Replacing this token makes resuming that old worker harmless.
            sqlx::query("UPDATE publish_attempts SET state='queued',lease_token=NULL,worker_id=NULL WHERE id=$1")
                .bind(attempt_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
        }
    }
    let row = sqlx::query(
        "UPDATE publish_attempts pa SET state='running', worker_id=$2, lease_token=$3,
         started_at=now(), lease_expires_at=now()+interval '60 seconds',
         submission_started_at=NULL,finished_at=NULL,reconcile_evidence=NULL,receipt=NULL,
         platform_post_id=NULL,version=pa.version+1
         FROM posts p, post_versions pv
         WHERE pa.id=$1 AND pa.tenant_id=$4 AND pa.state='queued'
           AND pa.fenced_at IS NULL AND pa.resolved_at IS NULL
           AND p.id=pa.post_id AND p.tenant_id=pa.tenant_id AND p.state='publishing'
           AND pv.id=pa.post_version_id AND pv.tenant_id=pa.tenant_id AND pv.post_id=p.id
         RETURNING pa.post_id, pa.post_version_id, pa.channel_id, pa.idempotency_key, pv.content,
         (SELECT provider FROM channels WHERE id=pa.channel_id AND tenant_id=pa.tenant_id) AS provider,
         p.platforms"
    ).bind(attempt_id).bind(worker_id).bind(lease).bind(tenant_id)
     .fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    let Some(row) = row else {
        return Ok(());
    };
    let post_id: Uuid = row.try_get("post_id").map_err(|e| e.to_string())?;
    let version_id: Uuid = row.try_get("post_version_id").map_err(|e| e.to_string())?;
    let channel_id: Option<Uuid> = row.try_get("channel_id").map_err(|e| e.to_string())?;
    let key: String = row.try_get("idempotency_key").map_err(|e| e.to_string())?;
    let content: Value = row.try_get("content").map_err(|e| e.to_string())?;
    let platforms: Vec<String> = row.try_get("platforms").map_err(|e| e.to_string())?;
    let provider: Option<String> = row.try_get("provider").map_err(|e| e.to_string())?;
    let provider = provider
        .or_else(|| platforms.first().cloned())
        .unwrap_or_default();
    let holds: Value = sqlx::query_scalar("SELECT admin.active_holds_for_target($1,$2)")
        .bind(tenant_id)
        .bind(channel_id)
        .fetch_one(admin_pool)
        .await
        .map_err(|e| e.to_string())?;

    // The final preflight CAS observes any resolution made while checking holds.
    let mut tx = tenant_tx(pool, tenant_id)
        .await
        .map_err(|e| e.to_string())?;
    let valid = sqlx::query("UPDATE publish_attempts SET version=version+1
        WHERE id=$1 AND lease_token=$2 AND state='running' AND fenced_at IS NULL AND resolved_at IS NULL
        AND lease_expires_at>now()")
        .bind(attempt_id).bind(lease).execute(&mut *tx).await.map_err(|e| e.to_string())?.rows_affected()==1;
    if !valid {
        return Err("Publish preflight lease was revoked or expired".into());
    }
    let facts = crate::approvals::lock(&mut tx, post_id)
        .await
        .map_err(|e| format!("publish preflight: {e:?}"))?;
    let approved = facts.state == "publishing"
        && facts.version_id == version_id
        && crate::approvals::is_approved(&mut tx, tenant_id, post_id, &facts)
            .await
            .map_err(|e| format!("publish approval check: {e:?}"))?;
    if !approved || holds.as_array().is_some_and(|a| !a.is_empty()) {
        let reason = if approved {
            "Paused by active publishing hold before provider submission"
        } else {
            "Current post version no longer has a valid approval"
        };
        sqlx::query("UPDATE publish_attempts SET state='failed', error=$2, finished_at=now(), lease_token=NULL,lease_expires_at=NULL,version=version+1 WHERE id=$1")
            .bind(attempt_id).bind(reason).execute(&mut *tx).await.map_err(|e| e.to_string())?;
        sqlx::query("UPDATE posts SET state=$2::post_state, updated_at=now() WHERE id=$1 AND state='publishing'")
            .bind(post_id).bind(if approved { "approved" } else { "failed" }).execute(&mut *tx).await.map_err(|e| e.to_string())?;
        tx.commit().await.map_err(|e| e.to_string())?;
        return Ok(());
    }
    sqlx::query("UPDATE publish_attempts SET submission_started_at=now(),lease_expires_at=now()+interval '60 seconds' WHERE id=$1 AND lease_token=$2")
        .bind(attempt_id).bind(lease).execute(&mut *tx).await.map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    let outcome = connector.publish(&provider, &key, &content).await;
    let (attempt_state, post_state, pid, receipt, error) = match outcome {
        PublishOutcome::Published {
            platform_post_id,
            receipt,
        } => (
            "succeeded",
            "published",
            Some(platform_post_id),
            Some(receipt),
            None,
        ),
        PublishOutcome::Failed { error } => ("failed", "failed", None, None, Some(error)),
        PublishOutcome::UnknownOutcome {
            error,
            partial_receipt,
        } => ("unknown", "reconciling", None, partial_receipt, Some(error)),
    };
    // Updating the attempt locks it until the post update commits. A concurrent admin
    // resolution therefore either wins the CAS or executes after this transaction.
    let mut tx = tenant_tx(pool, tenant_id)
        .await
        .map_err(|e| e.to_string())?;
    let saved = sqlx::query("UPDATE publish_attempts SET state=$3::publish_attempt_state,
        platform_post_id=$4, receipt=$5, error=$6, finished_at=now(), reconcile_evidence=NULL,
        lease_token=NULL,lease_expires_at=NULL,version=version+1
        WHERE id=$1 AND lease_token=$2 AND state='running' AND fenced_at IS NULL AND resolved_at IS NULL")
        .bind(attempt_id).bind(lease).bind(attempt_state).bind(&pid).bind(receipt).bind(error)
        .execute(&mut *tx).await.map_err(|e| e.to_string())?.rows_affected()==1;
    if saved {
        sqlx::query(
            "UPDATE posts SET state=$2::post_state, platform_post_id=COALESCE($3,platform_post_id),
            published_at=CASE WHEN $2='published' THEN now() ELSE published_at END, updated_at=now()
            WHERE id=$1 AND state='publishing'",
        )
        .bind(post_id)
        .bind(post_state)
        .bind(pid)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}
