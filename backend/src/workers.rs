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
                    let result = dispatch(&state, &worker_id, &event).await;
                    match result {
                        Ok(()) => {
                            if let Err(error) =
                                outbox::mark_processed(&state.pool, event.id, &worker_id).await
                            {
                                tracing::error!(event_id=%event.id, %error, "failed marking outbox event processed");
                            }
                        }
                        Err(error) => {
                            tracing::warn!(event_id=%event.id, attempts=event.attempts, %error, "outbox dispatch failed");
                            if let Err(db_error) = outbox::mark_failed(
                                &state.pool,
                                event.id,
                                &worker_id,
                                event.attempts,
                                MAX_ATTEMPTS,
                                &error.to_string(),
                            )
                            .await
                            {
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

async fn dispatch(
    state: &AppState,
    worker_id: &str,
    event: &outbox::ClaimedEvent,
) -> Result<(), String> {
    match event.topic.as_str() {
        "post.publish" => {
            let attempt_id = payload_id(event, "attempt_id")?;
            let connector = crate::publishing::DefaultNoopConnector;
            crate::publishing::execute_publish_attempt(
                &state.pool,
                &state.admin_pool,
                &connector,
                worker_id,
                event.tenant_id,
                attempt_id,
            )
            .await
        }
        "agent.run" => match payload_id(event, "run_id") {
            Ok(run) => crate::ai::planner::run(state, event.tenant_id, run).await,
            Err(_) => run_agent_placeholder(state, event).await,
        },
        "media.scan" => {
            let media = payload_id(event, "media_id")?;
            crate::media::finish_scan(&state.pool, event.tenant_id, media)
                .await
                .map_err(|e| e.to_string())
        }
        "post.changes_requested" => {
            notify_author(
                state,
                event,
                "Changes requested on {title}",
                "Open it in Drafts to see the note.",
                "/app/drafts",
            )
            .await
        }
        "post.canceled" => {
            notify_author(
                state,
                event,
                "{title} was canceled",
                "It won't go out.",
                "/app/calendar",
            )
            .await
        }
        // Notifications, metrics, and publish are safe no-op consumers until adapter services are configured.
        "metrics.collect" | "notification.send" | "post.scheduled" | "post.published"
        | "post.failed" => {
            tracing::info!(event_id=%event.id, topic=%event.topic, "accepted by scaffold adapter; no external platform action configured");
            Ok(())
        }
        _ => Err(format!("unsupported outbox topic: {}", event.topic)),
    }
}

async fn run_agent_placeholder(
    state: &AppState,
    event: &outbox::ClaimedEvent,
) -> Result<(), String> {
    let kind = event
        .payload
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("agent_step_placeholder");
    let input = event
        .payload
        .get("input")
        .cloned()
        .unwrap_or_else(|| event.payload.clone());
    let mut tx = state.pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("SELECT set_config('app.tenant_id',$1,true)")
        .bind(event.tenant_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO agent_runs(tenant_id,kind,status,input,output,started_at,finished_at) VALUES($1,$2,'succeeded',$3,$4,now(),now())")
        .bind(event.tenant_id).bind(kind).bind(input).bind(json!({"status":"placeholder_completed","outbox_event_id":event.id,"note":"no model provider configured"})).execute(&mut *tx).await.map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())
}

fn payload_id(event: &outbox::ClaimedEvent, key: &str) -> Result<Uuid, String> {
    event
        .payload
        .get(key)
        .and_then(|v| v.as_str())
        .and_then(|v| Uuid::parse_str(v).ok())
        .ok_or_else(|| format!("{} event without {key}", event.topic))
}

/// Tells whoever wrote or sent the post what a decider did, unless they did it themself.
async fn notify_author(
    state: &AppState,
    event: &outbox::ClaimedEvent,
    title: &str,
    body: &str,
    href: &str,
) -> Result<(), String> {
    let post = payload_id(event, "post_id")?;
    let actor = payload_id(event, "actor_id").ok();
    let mut tx = crate::db::tenant_tx(&state.pool, event.tenant_id)
        .await
        .map_err(|e| e.to_string())?;
    let row: Option<(String, Option<Uuid>)> = sqlx::query_as(
        "SELECT title,COALESCE(review_requested_by,created_by) FROM posts WHERE id=$1",
    )
    .bind(post)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    let Some((post_title, Some(author))) = row else {
        return Ok(());
    };
    if Some(author) != actor {
        crate::notifications::notify(
            &mut tx,
            event.tenant_id,
            &[author],
            "approval",
            &title.replace("{title}", &post_title),
            body,
            href,
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}
