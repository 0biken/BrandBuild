use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PostState {
    Draft,
    InReview,
    ChangesRequested,
    Approved,
    Scheduled,
    Publishing,
    Reconciling,
    Published,
    Failed,
    Canceled,
    Expired,
}

#[derive(Clone, Copy, Debug)]
pub enum PostAction {
    SubmitForReview,
    Approve,
    RequestChanges,
    Schedule,
    BeginPublish,
    Reconcile,
    PublishSucceeded,
    PublishFailed,
    Cancel,
    Expire,
}

#[derive(Debug, Error)]
pub enum TransitionError {
    #[error("action {action:?} is not valid from state {state:?}")]
    Invalid { state: PostState, action: PostAction },
}

impl PostState {
    pub fn transition(self, action: PostAction) -> Result<Self, TransitionError> {
        use PostAction::*;
        use PostState::*;
        let next = match (self, action) {
            (Draft | ChangesRequested, SubmitForReview) => InReview,
            (InReview, Approve) => Approved,
            (InReview, RequestChanges) => ChangesRequested,
            (Approved, Schedule) => Scheduled,
            (Approved | Scheduled, BeginPublish) => Publishing,
            (Publishing, Reconcile) => Reconciling,
            (Publishing | Reconciling, PublishSucceeded) => Published,
            (Publishing | Reconciling, PublishFailed) => Failed,
            (Draft | InReview | ChangesRequested | Approved | Scheduled, Cancel) => Canceled,
            (Scheduled, Expire) => Expired,
            _ => return Err(TransitionError::Invalid { state: self, action }),
        };
        Ok(next)
    }
}

/// Stable idempotency key for one tenant+post+immutable version publish operation.
pub fn publish_idempotency_key(tenant_id: Uuid, post_id: Uuid, version_id: Uuid) -> String {
    format!("publish:{tenant_id}:{post_id}:{version_id}")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn publishing_can_enter_reconciliation() {
        assert_eq!(PostState::Publishing.transition(PostAction::Reconcile).unwrap(), PostState::Reconciling);
    }
    #[test]
    fn published_is_terminal() {
        assert!(PostState::Published.transition(PostAction::Cancel).is_err());
    }
}
