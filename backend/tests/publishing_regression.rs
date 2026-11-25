use brandbuild_backend::{
    db,
    publishing::{
        execute_publish_attempt, BoxFuture, DefaultNoopConnector, PublishOutcome, ReconcileOutcome,
        SocialConnector,
    },
};
use serde_json::{json, Value};
use sqlx::{postgres::PgPoolOptions, PgPool};
use uuid::Uuid;

#[tokio::test]
async fn unconfigured_connector_never_claims_a_provider_submission_or_verification() {
    let connector = DefaultNoopConnector;
    assert!(matches!(
        connector.publish("ig", "key", &json!({})).await,
        PublishOutcome::Failed { .. }
    ));
    assert!(matches!(
        connector
            .reconcile("ig", "key", Some("unverified-id"))
            .await,
        ReconcileOutcome::Inconclusive { .. }
    ));
}

async fn pools() -> Option<(PgPool, PgPool, PgPool)> {
    let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
        return None;
    };
    let owner = PgPoolOptions::new()
        .max_connections(3)
        .connect(&url)
        .await
        .unwrap();
    db::migrate(&owner).await.unwrap();
    let app = PgPoolOptions::new()
        .max_connections(3)
        .after_connect(|c, _| {
            Box::pin(async move {
                sqlx::query("SET ROLE brandbuild_app").execute(c).await?;
                Ok(())
            })
        })
        .connect(&url)
        .await
        .unwrap();
    let admin = PgPoolOptions::new()
        .max_connections(3)
        .after_connect(|c, _| {
            Box::pin(async move {
                sqlx::query("SET ROLE brandbuild_admin").execute(c).await?;
                Ok(())
            })
        })
        .connect(&url)
        .await
        .unwrap();
    Some((owner, app, admin))
}

async fn seed(owner: &PgPool, state: &str) -> (Uuid, Uuid, Uuid, Uuid) {
    let tenant = Uuid::new_v4();
    let post = Uuid::new_v4();
    let version = Uuid::new_v4();
    let attempt = Uuid::new_v4();
    sqlx::query("INSERT INTO tenants(id,name,slug) VALUES($1,'Publishing regression',$2)")
        .bind(tenant)
        .bind(tenant.to_string())
        .execute(owner)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO posts(id,tenant_id,state,platforms) VALUES($1,$2,'publishing',ARRAY['ig'])",
    )
    .bind(post)
    .bind(tenant)
    .execute(owner)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO post_versions(id,tenant_id,post_id,version,content) VALUES($1,$2,$3,1,'{}')",
    )
    .bind(version)
    .bind(tenant)
    .bind(post)
    .execute(owner)
    .await
    .unwrap();
    sqlx::query("INSERT INTO publish_attempts(id,tenant_id,post_id,post_version_id,idempotency_key,state) VALUES($1,$2,$3,$4,$5,$6::publish_attempt_state)").bind(attempt).bind(tenant).bind(post).bind(version).bind(attempt.to_string()).bind(state).execute(owner).await.unwrap();
    sqlx::query("INSERT INTO approvals(tenant_id,post_id,post_version_id,decision,content_hash) VALUES($1,$2,$3,'approved',$4)").bind(tenant).bind(post).bind(version).bind(brandbuild_backend::domain::content_hash(&json!({}))).execute(owner).await.unwrap();
    (tenant, post, version, attempt)
}

struct Unknown;
impl SocialConnector for Unknown {
    fn publish<'a>(
        &'a self,
        _: &'a str,
        _: &'a str,
        _: &'a Value,
    ) -> BoxFuture<'a, PublishOutcome> {
        Box::pin(async {
            PublishOutcome::UnknownOutcome {
                error: "timeout".into(),
                partial_receipt: None,
            }
        })
    }
    fn reconcile<'a>(
        &'a self,
        _: &'a str,
        _: &'a str,
        _: Option<&'a str>,
    ) -> BoxFuture<'a, ReconcileOutcome> {
        Box::pin(async {
            ReconcileOutcome::Inconclusive {
                reason: "timeout".into(),
            }
        })
    }
}

#[tokio::test]
async fn worker_runs_under_rls_and_unknown_outcome_becomes_reconciling() {
    let Some((owner, app, admin)) = pools().await else {
        return;
    };
    let (tenant, post, _, attempt) = seed(&owner, "queued").await;
    execute_publish_attempt(
        &app,
        &admin,
        &Unknown,
        "wrong-tenant",
        Uuid::new_v4(),
        attempt,
    )
    .await
    .unwrap();
    let untouched: String =
        sqlx::query_scalar("SELECT state::text FROM publish_attempts WHERE id=$1")
            .bind(attempt)
            .fetch_one(&owner)
            .await
            .unwrap();
    assert_eq!(untouched, "queued");
    execute_publish_attempt(&app, &admin, &Unknown, "regression", tenant, attempt)
        .await
        .unwrap();
    let states: (String, String) = sqlx::query_as("SELECT pa.state::text,p.state::text FROM publish_attempts pa JOIN posts p ON p.id=pa.post_id WHERE pa.id=$1").bind(attempt).fetch_one(&owner).await.unwrap();
    assert_eq!(states, ("unknown".into(), "reconciling".into()));
    let state: String = sqlx::query_scalar("SELECT state::text FROM posts WHERE id=$1")
        .bind(post)
        .fetch_one(&owner)
        .await
        .unwrap();
    assert_eq!(state, "reconciling");
}

#[tokio::test]
async fn arbitrary_receipts_and_unproven_failure_cannot_resolve_unknown_attempts() {
    let Some((owner, _, admin)) = pools().await else {
        return;
    };
    let (_, _, _, attempt) = seed(&owner, "unknown").await;
    for action in ["confirm_published", "mark_failed", "retry"] {
        let result: Value = sqlx::query_scalar("SELECT admin.resolve_publish_attempt($1,1,$2,$3,NULL,'test note','{\"anything\":true}')").bind(attempt).bind(Uuid::new_v4().to_string()).bind(action).fetch_one(&admin).await.unwrap();
        assert_eq!(result["ok"], false, "{action}: {result}");
    }
}

struct ResolveDuringPublish {
    admin: PgPool,
    owner: PgPool,
    attempt: Uuid,
    action: String,
}
impl SocialConnector for ResolveDuringPublish {
    fn publish<'a>(
        &'a self,
        _: &'a str,
        _: &'a str,
        _: &'a Value,
    ) -> BoxFuture<'a, PublishOutcome> {
        Box::pin(async move {
            let old_evidence: Option<Value> =
                sqlx::query_scalar("SELECT reconcile_evidence FROM publish_attempts WHERE id=$1")
                    .bind(self.attempt)
                    .fetch_one(&self.owner)
                    .await
                    .unwrap();
            assert_eq!(
                old_evidence, None,
                "new execution must invalidate prior evidence"
            );
            if self.action != "retry" {
                let evidence = if self.action == "confirm_published" {
                    json!({"status":"confirmed_published","platformPostId":"verified-id","retryEligible":false})
                } else {
                    json!({"status":"confirmed_not_published","retryEligible":true})
                };
                sqlx::query("UPDATE publish_attempts SET reconcile_evidence=$2,receipt='{\"verified\":true}',platform_post_id='verified-id' WHERE id=$1")
                    .bind(self.attempt).bind(evidence).execute(&self.owner).await.unwrap();
            }
            let version: i32 =
                sqlx::query_scalar("SELECT version FROM publish_attempts WHERE id=$1")
                    .bind(self.attempt)
                    .fetch_one(&self.owner)
                    .await
                    .unwrap();
            let key = Uuid::new_v4().to_string();
            let resolved: Value = sqlx::query_scalar(
                "SELECT admin.resolve_publish_attempt($1,$2,$3,$4,NULL,'race resolution',NULL)",
            )
            .bind(self.attempt)
            .bind(version)
            .bind(&key)
            .bind(&self.action)
            .fetch_one(&self.admin)
            .await
            .unwrap();
            if self.action == "mark_failed" {
                assert_eq!(
                    resolved["ok"], false,
                    "an active remote request cannot be declared failed"
                );
                return PublishOutcome::UnknownOutcome {
                    error: "response lost".into(),
                    partial_receipt: None,
                };
            }
            assert_eq!(resolved["ok"], true, "{resolved}");
            let replay: Value = sqlx::query_scalar(
                "SELECT admin.resolve_publish_attempt($1,$2,$3,$4,NULL,'race resolution',NULL)",
            )
            .bind(self.attempt)
            .bind(version)
            .bind(&key)
            .bind(&self.action)
            .fetch_one(&self.admin)
            .await
            .unwrap();
            assert_eq!(replay["idempotentReplay"], true);
            PublishOutcome::Published {
                platform_post_id: "late-worker-id".into(),
                receipt: json!({"late":true}),
            }
        })
    }
    fn reconcile<'a>(
        &'a self,
        _: &'a str,
        _: &'a str,
        _: Option<&'a str>,
    ) -> BoxFuture<'a, ReconcileOutcome> {
        Box::pin(async {
            ReconcileOutcome::Inconclusive {
                reason: "unused".into(),
            }
        })
    }
}

#[tokio::test]
async fn confirmation_and_escalation_fence_inflight_worker_and_clear_old_evidence() {
    let Some((owner, app, admin)) = pools().await else {
        return;
    };
    for (action, expected_attempt, expected_post) in [
        ("confirm_published", "succeeded", "published"),
        ("escalate", "unknown", "reconciling"),
    ] {
        let (tenant, _post, _, attempt) = seed(&owner, "queued").await;
        let evidence = if action == "confirm_published" {
            json!({"status":"confirmed_published","platformPostId":"verified-id","retryEligible":false})
        } else {
            json!({"status":"confirmed_not_published","retryEligible":true})
        };
        sqlx::query("UPDATE publish_attempts SET reconcile_evidence=$2,receipt='{\"verified\":true}',platform_post_id='verified-id' WHERE id=$1").bind(attempt).bind(evidence).execute(&owner).await.unwrap();
        let connector = ResolveDuringPublish {
            admin: admin.clone(),
            owner: owner.clone(),
            attempt,
            action: action.into(),
        };
        execute_publish_attempt(&app, &admin, &connector, "race-worker", tenant, attempt)
            .await
            .unwrap();
        let result: (String, bool, Option<Uuid>, String, String) = sqlx::query_as("SELECT pa.state::text,pa.fenced_at IS NOT NULL,pa.lease_token,pa.platform_post_id,p.state::text FROM publish_attempts pa JOIN posts p ON p.id=pa.post_id WHERE pa.id=$1").bind(attempt).fetch_one(&owner).await.unwrap();
        assert_eq!(
            result,
            (
                expected_attempt.into(),
                true,
                None,
                "verified-id".into(),
                expected_post.into()
            ),
            "{action}"
        );
    }
}

#[tokio::test]
async fn stale_approval_blocks_provider_submission() {
    let Some((owner, app, admin)) = pools().await else {
        return;
    };
    let (tenant, _, _, attempt) = seed(&owner, "queued").await;
    sqlx::query("UPDATE approvals SET content_hash='stale' WHERE tenant_id=$1")
        .bind(tenant)
        .execute(&owner)
        .await
        .unwrap();
    execute_publish_attempt(&app, &admin, &Unknown, "stale-worker", tenant, attempt)
        .await
        .unwrap();
    let state: String = sqlx::query_scalar("SELECT state::text FROM publish_attempts WHERE id=$1")
        .bind(attempt)
        .fetch_one(&owner)
        .await
        .unwrap();
    assert_eq!(state, "failed");
}

#[tokio::test]
async fn stale_reconciliation_cannot_overwrite_a_later_staff_resolution() {
    let Some((owner, _, admin)) = pools().await else {
        return;
    };
    let (_, _, _, attempt) = seed(&owner, "unknown").await;
    let target: Value = sqlx::query_scalar("SELECT admin.get_reconcile_target($1)")
        .bind(attempt)
        .fetch_one(&admin)
        .await
        .unwrap();
    assert_eq!(target["version"], 1);
    let resolved: Value = sqlx::query_scalar("SELECT admin.resolve_publish_attempt($1,1,'escalation','escalate',NULL,'review needed',NULL)").bind(attempt).fetch_one(&admin).await.unwrap();
    assert_eq!(resolved["ok"], true);
    let saved: Value = sqlx::query_scalar("SELECT admin.save_reconcile_evidence($1,1,'{\"status\":\"confirmed_published\"}','{}','unverified')").bind(attempt).fetch_one(&admin).await.unwrap();
    assert_eq!(saved["ok"], false);
    let evidence: Option<Value> =
        sqlx::query_scalar("SELECT reconcile_evidence FROM publish_attempts WHERE id=$1")
            .bind(attempt)
            .fetch_one(&owner)
            .await
            .unwrap();
    assert_eq!(evidence, None);
}

#[tokio::test]
async fn retry_requires_a_terminal_unknown_attempt_even_with_negative_evidence() {
    let Some((owner, _, admin)) = pools().await else {
        return;
    };
    for state in ["queued", "running", "unknown"] {
        let (_, _, _, attempt) = seed(&owner, state).await;
        sqlx::query("UPDATE publish_attempts SET reconcile_evidence='{\"status\":\"confirmed_not_published\",\"retryEligible\":true}' WHERE id=$1").bind(attempt).execute(&owner).await.unwrap();
        let resolved: Value = sqlx::query_scalar("SELECT admin.resolve_publish_attempt($1,1,'retry','retry',NULL,'retry after verification',NULL)").bind(attempt).fetch_one(&admin).await.unwrap();
        assert_eq!(resolved["ok"], false, "{state}: {resolved}");
    }
    let (tenant, post, _, attempt) = seed(&owner, "unknown").await;
    sqlx::query("UPDATE publish_attempts SET finished_at=now(),lease_token=NULL,reconcile_evidence='{\"status\":\"confirmed_not_published\",\"retryEligible\":true}' WHERE id=$1").bind(attempt).execute(&owner).await.unwrap();
    for _ in 0..2 {
        let result: Value=sqlx::query_scalar("SELECT admin.resolve_publish_attempt($1,1,'terminal-retry','retry',NULL,'verified terminal outcome',NULL)").bind(attempt).fetch_one(&admin).await.unwrap();
        assert_eq!(result["ok"], true, "{result}");
    }
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM outbox WHERE tenant_id=$1 AND payload->>'post_id'=$2",
    )
    .bind(tenant)
    .bind(post.to_string())
    .fetch_one(&owner)
    .await
    .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn expired_unsubmitted_claim_is_recovered_instead_of_silently_acknowledged() {
    let Some((owner, app, admin)) = pools().await else {
        return;
    };
    let (tenant, post, _, attempt) = seed(&owner, "running").await;
    sqlx::query("UPDATE publish_attempts SET started_at=now()-interval '10 minutes', lease_token=gen_random_uuid() WHERE id=$1").bind(attempt).execute(&owner).await.unwrap();
    execute_publish_attempt(&app, &admin, &Unknown, "replacement", tenant, attempt)
        .await
        .unwrap();
    let states: (String,String) = sqlx::query_as("SELECT pa.state::text,p.state::text FROM publish_attempts pa JOIN posts p ON p.id=pa.post_id WHERE pa.id=$1 AND p.id=$2").bind(attempt).bind(post).fetch_one(&owner).await.unwrap();
    assert_eq!(states, ("unknown".into(), "reconciling".into()));
}

#[tokio::test]
async fn live_claim_is_not_stolen_and_expired_submission_is_never_resent() {
    let Some((owner, app, admin)) = pools().await else {
        return;
    };
    let (tenant, _, _, attempt) = seed(&owner, "running").await;
    let token = Uuid::new_v4();
    sqlx::query("UPDATE publish_attempts SET started_at=now(),lease_token=$2,lease_expires_at=now()+interval '1 minute',submission_started_at=now() WHERE id=$1")
        .bind(attempt).bind(token).execute(&owner).await.unwrap();
    assert!(
        execute_publish_attempt(&app, &admin, &Unknown, "duplicate", tenant, attempt)
            .await
            .is_err()
    );
    let current: Uuid = sqlx::query_scalar("SELECT lease_token FROM publish_attempts WHERE id=$1")
        .bind(attempt)
        .fetch_one(&owner)
        .await
        .unwrap();
    assert_eq!(current, token);
    sqlx::query(
        "UPDATE publish_attempts SET lease_expires_at=now()-interval '1 minute' WHERE id=$1",
    )
    .bind(attempt)
    .execute(&owner)
    .await
    .unwrap();
    execute_publish_attempt(&app, &admin, &Unknown, "recovery", tenant, attempt)
        .await
        .unwrap();
    let result:(String,bool,bool,bool)=sqlx::query_as("SELECT state::text,fenced_at IS NOT NULL,finished_at IS NULL,lease_token=$2 FROM publish_attempts WHERE id=$1")
        .bind(attempt).bind(token).fetch_one(&owner).await.unwrap();
    assert_eq!(result, ("unknown".into(), true, true, true));
    sqlx::query("UPDATE publish_attempts SET reconcile_evidence='{\"status\":\"confirmed_not_published\",\"retryEligible\":true}' WHERE id=$1").bind(attempt).execute(&owner).await.unwrap();
    let resolved:Value=sqlx::query_scalar("SELECT admin.resolve_publish_attempt($1,(SELECT version FROM publish_attempts WHERE id=$1),'unsafe-retry','retry',NULL,'retry',NULL)").bind(attempt).fetch_one(&owner).await.unwrap();
    assert_eq!(resolved["ok"], false);
}

#[tokio::test]
async fn active_negative_evidence_cannot_resolve_failure_or_survive_worker_completion() {
    let Some((owner, app, admin)) = pools().await else {
        return;
    };
    let (tenant, _, _, attempt) = seed(&owner, "queued").await;
    let connector = ResolveDuringPublish {
        owner: owner.clone(),
        admin: admin.clone(),
        attempt,
        action: "mark_failed".into(),
    };
    execute_publish_attempt(
        &app,
        &admin,
        &connector,
        "running-negative",
        tenant,
        attempt,
    )
    .await
    .unwrap();
    let terminal:(String,bool,bool,Option<Value>,i32)=sqlx::query_as("SELECT state::text,finished_at IS NOT NULL,lease_token IS NULL,reconcile_evidence,version FROM publish_attempts WHERE id=$1")
        .bind(attempt).fetch_one(&owner).await.unwrap();
    assert_eq!(
        (terminal.0.as_str(), terminal.1, terminal.2, terminal.3),
        ("unknown", true, true, None)
    );
    for action in ["mark_failed", "retry"] {
        let result:Value=sqlx::query_scalar("SELECT admin.resolve_publish_attempt($1,$2,$3,$3,NULL,'negative evidence is stale',NULL)").bind(attempt).bind(terminal.4).bind(action).fetch_one(&admin).await.unwrap();
        assert_eq!(result["ok"], false, "{action}: {result}");
    }
    let saved:Value=sqlx::query_scalar("SELECT admin.save_reconcile_evidence($1,$2,'{\"status\":\"confirmed_not_published\",\"retryEligible\":true}',NULL,NULL)")
        .bind(attempt).bind(terminal.4).fetch_one(&admin).await.unwrap();
    assert_eq!(saved["ok"], true);
    let result:Value=sqlx::query_scalar("SELECT admin.resolve_publish_attempt($1,$2,'fresh-failure','mark_failed',NULL,'verified after completion',NULL)")
        .bind(attempt).bind(saved["version"].as_i64().unwrap() as i32).fetch_one(&admin).await.unwrap();
    assert_eq!(result["ok"], true, "{result}");
}
