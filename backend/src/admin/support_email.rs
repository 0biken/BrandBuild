//! Durable support notifications. Delivery is at least once; SMTP failures remain queued.
use sqlx::{PgPool, Row};
use uuid::Uuid;

pub async fn deliver_pending(pool: &PgPool) -> Result<(), sqlx::Error> {
    // Limit each pass so the worker yields between batches. SKIP LOCKED permits multiple workers.
    for _ in 0..20 {
        let mut tx = pool.begin().await?;
        let row = sqlx::query("SELECT id,support_session_id,recipients,subject,body FROM admin.support_notification_outbox WHERE delivered_at IS NULL AND available_at<=clock_timestamp() ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED")
            .fetch_optional(&mut *tx).await?;
        let Some(row) = row else {
            return Ok(());
        };
        let id: Uuid = row.try_get("id")?;
        let session: Uuid = row.try_get("support_session_id")?;
        let recipients: Vec<String> = row.try_get("recipients")?;
        let subject: String = row.try_get("subject")?;
        let body: String = row.try_get("body")?;
        let mut delivered = true;
        for recipient in recipients {
            if let Err(error) = crate::auth_api::send_email(&recipient, &subject, &body).await {
                tracing::warn!(?error, %id, "support notification delivery failed; retry queued");
                delivered = false;
                break;
            }
        }
        if delivered {
            sqlx::query("UPDATE admin.support_notification_outbox SET delivered_at=clock_timestamp(),attempts=attempts+1 WHERE id=$1").bind(id).execute(&mut *tx).await?;
            sqlx::query("UPDATE admin.support_sessions SET customer_notified_at=clock_timestamp() WHERE id=$1").bind(session).execute(&mut *tx).await?;
        } else {
            sqlx::query("UPDATE admin.support_notification_outbox SET attempts=attempts+1,available_at=clock_timestamp()+interval '1 minute' WHERE id=$1").bind(id).execute(&mut *tx).await?;
        }
        tx.commit().await?;
    }
    Ok(())
}
