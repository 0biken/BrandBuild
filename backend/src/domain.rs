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
    /// Content, targets or (with a second approver required) time changed after review.
    Edit,
    /// The sender takes the request back to Drafts.
    Withdraw,
    /// A decider turns it down without a note; it goes back to Drafts.
    Reject,
    /// A decider reverses their last decision.
    Undo,
    /// Try a failed post again with the version that was approved.
    Retry,
}

#[derive(Debug, Error)]
pub enum TransitionError {
    #[error("action {action:?} is not valid from state {state:?}")]
    Invalid {
        state: PostState,
        action: PostAction,
    },
}

impl PostState {
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "draft" => Self::Draft,
            "in_review" => Self::InReview,
            "changes_requested" => Self::ChangesRequested,
            "approved" => Self::Approved,
            "scheduled" => Self::Scheduled,
            "publishing" => Self::Publishing,
            "reconciling" => Self::Reconciling,
            "published" => Self::Published,
            "failed" => Self::Failed,
            "canceled" => Self::Canceled,
            "expired" => Self::Expired,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::InReview => "in_review",
            Self::ChangesRequested => "changes_requested",
            Self::Approved => "approved",
            Self::Scheduled => "scheduled",
            Self::Publishing => "publishing",
            Self::Reconciling => "reconciling",
            Self::Published => "published",
            Self::Failed => "failed",
            Self::Canceled => "canceled",
            Self::Expired => "expired",
        }
    }

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
            (
                Draft | InReview | ChangesRequested | Approved | Scheduled | Failed | Expired,
                Cancel,
            ) => Canceled,
            (Scheduled, Expire) => Expired,
            (InReview | Approved | Scheduled | Failed, Edit) => InReview,
            (InReview, Withdraw | Reject) => Draft,
            (Approved | Scheduled | Draft | ChangesRequested, Undo) => InReview,
            (Failed, Retry) => Scheduled,
            _ => {
                return Err(TransitionError::Invalid {
                    state: self,
                    action,
                })
            }
        };
        Ok(next)
    }
}

/// Applies `action` to a database state string, as the handlers store it.
pub fn next_state(state: &str, action: PostAction) -> Option<&'static str> {
    PostState::parse(state)?
        .transition(action)
        .ok()
        .map(PostState::as_str)
}

/// The value with object keys sorted at every level, so equal content always serialises
/// to the same bytes.
pub fn canonical(value: &serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut out = serde_json::Map::new();
            for key in keys {
                out.insert(key.clone(), canonical(&map[key]));
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.iter().map(canonical).collect()),
        other => other.clone(),
    }
}

/// sha256 (hex) of the canonical JSON of a post version's content.
pub fn content_hash(content: &serde_json::Value) -> String {
    use sha2::{Digest, Sha256};
    let bytes = serde_json::to_vec(&canonical(content)).unwrap_or_default();
    format!("{:x}", Sha256::digest(bytes))
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
        assert_eq!(
            PostState::Publishing
                .transition(PostAction::Reconcile)
                .unwrap(),
            PostState::Reconciling
        );
    }
    #[test]
    fn editing_reviewed_content_needs_review_again() {
        for state in ["approved", "scheduled", "failed", "in_review"] {
            assert_eq!(
                next_state(state, PostAction::Edit),
                Some("in_review"),
                "{state}"
            );
        }
        assert_eq!(next_state("publishing", PostAction::Edit), None);
        assert_eq!(next_state("published", PostAction::Edit), None);
    }
    #[test]
    fn hash_ignores_key_order() {
        let a = serde_json::json!({"caption":"Hi","media":[{"b":1,"a":2}]});
        let b = serde_json::json!({"media":[{"a":2,"b":1}],"caption":"Hi"});
        assert_eq!(content_hash(&a), content_hash(&b));
        assert_ne!(
            content_hash(&a),
            content_hash(&serde_json::json!({"caption":"Hi!"}))
        );
        assert_eq!(content_hash(&a).len(), 64);
    }
    #[test]
    fn published_is_terminal() {
        assert!(PostState::Published.transition(PostAction::Cancel).is_err());
    }
}
