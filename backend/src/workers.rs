use crate::AppState;
use tokio::time::{sleep, Duration};

/// Worker loop placeholder: publish jobs, fetch metrics, and agent runs should be
/// consumed via transactional outbox with bounded retries and tenant fair-use limits.
pub async fn run(_state: AppState) {
    loop {
        // TODO: claim outbox batch, dispatch by topic, persist outcomes, and release leases.
        sleep(Duration::from_secs(30)).await;
    }
}
