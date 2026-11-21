-- Phase 5: AI planning runs and idempotent draft batches.

-- A run moves queued → context_loading → planning → generating → validating →
-- awaiting_review, or ends failed / canceled. 'succeeded' and 'running' are kept for rows
-- written by the earlier placeholder worker.
ALTER TABLE agent_runs
  ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN goal jsonb,
  ADD COLUMN context_snapshot jsonb,
  ADD COLUMN context_version text,
  ADD COLUMN model text,
  ADD COLUMN prompt_version text,
  ADD COLUMN input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  ADD COLUMN output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  ADD COLUMN cost_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT agent_runs_status_known CHECK (status IN (
    'queued', 'context_loading', 'planning', 'generating', 'validating',
    'awaiting_review', 'failed', 'canceled', 'succeeded', 'running'));

-- One row per idempotency key used to save a draft. A retry with the same key and the
-- same request gets the same draft back; the same key with a different request is refused.
CREATE TABLE draft_keys (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (length(key) BETWEEN 1 AND 200),
  post_id uuid NOT NULL,
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key),
  FOREIGN KEY (tenant_id, post_id) REFERENCES posts(tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE draft_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON draft_keys
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
