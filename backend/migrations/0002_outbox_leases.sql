ALTER TABLE outbox
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_owner text;

CREATE INDEX IF NOT EXISTS outbox_lease_recovery_idx
  ON outbox(locked_at) WHERE processed_at IS NULL AND failed_at IS NULL;

-- Worker dispatch is at-least-once. Consumers must be idempotent by outbox id.
