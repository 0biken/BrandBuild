use crate::{outbox, AppState};
use serde_json::json;
use tokio::time::{sleep, Duration};
use uuid::Uuid;

const LEASE_SECONDS: i64 = 60;
const MAX_ATTEMPTS: i32 = 8;

/// At-least-once consumer. External platform adapters remain intentionally no-op until
/// credentials and provider implementations are configured. Agent jobs are recorded as runs.
pub async fn run(state: AppState) {
    let worker_id = format!("worker-{}", Uuid::new_v4());
    loop {
        match outbox::claim_batch(&state.pool, &worker_id, 32, LEASE_SECONDS).await {
            Ok(events) if events.is_empty() => sleep(Duration::from_secs(2)).await,
            Ok(events) => {
                for event in events {
                    let result = dispatch(&state, &event).await;
                    match result {
                        Ok(()) => {
                            if let Err(error) = outbox::mark_processed(&state.pool, event.id, &worker_id).await {
                                tracing::error!(event_id=%event.id, %error, "failed marking outbox event processed");
                            }
                        }
                        Err(error) => {
                            tracing::warn!(event_id=%event.id, attempts=event.attempts, %error, "outbox dispatch failed");
                            if let Err(db_error) = outbox::mark_failed(&state.pool, event.id, &worker_id, event.attempts, MAX_ATTEMPTS, &error.to_string()).await {
                                tracing::error!(event_id=%event.id, %db_error, "failed persisting outbox failure");
                            }
                        }
                    }
                }
            }
            Err(error) => {
                tracing::error!(%error, "outbox claim failed");
                sleep(Duration::from_secs(5)).await;
            }
        }
    }
}

async fn dispatch(state: &AppState, event: &outbox::ClaimedEvent) -> Result<(), String> {
    match event.topic.as_str() {
        "agent.run" => run_agent_placeholder(state, event).await,
        // Notifications, metrics, and publish are safe no-op consumers until adapter services are configured.
        "post.publish" | "metrics.collect" | "notification.send" | "post.scheduled" | "post.published" | "post.failed" => {
            tracing::info!(event_id=%event.id, topic=%event.topic, "accepted by scaffold adapter; no external platform action configured");
            Ok(())
        }
        _ => Err(format!("unsupported outbox topic: {}", event.topic)),
    }
}

async fn run_agent_placeholder(state: &AppState, event: &outbox::ClaimedEvent) -> Result<(), String> {
    let kind = event.payload.get("kind").and_then(|v| v.as_str()).unwrap_or("agent_step_placeholder");
    let input = event.payload.get("input").cloned().unwrap_or_else(|| event.payload.clone());
    let mut tx = state.pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)").bind(event.tenant_id.to_string()).execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO agent_runs(tenant_id,kind,status,input,output,started_at,finished_at) VALUES($1,$2,'succeeded',$3,$4,now(),now())")
        .bind(event.tenant_id).bind(kind).bind(input).bind(json!({"status":"placeholder_completed","outbox_event_id":event.id,"note":"no model provider configured"})).execute(&mut *tx).await.map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())
}
