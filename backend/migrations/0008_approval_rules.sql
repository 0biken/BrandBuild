-- Phase 4 finish: approval rules, integrity hashes, media states, brand facts.

-- A workspace can require a second person to approve every post.
ALTER TABLE tenants
  ADD COLUMN require_second_approver boolean NOT NULL DEFAULT false,
  ADD COLUMN timezone text NOT NULL DEFAULT 'UTC';

-- 'rejected': the post went back to Drafts without a note.
-- 'undone': reverses the decision before it, which stays on record.
ALTER TYPE approval_decision ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE approval_decision ADD VALUE IF NOT EXISTS 'undone';

-- sha256 of the version's canonical JSON. An approval records the hash it saw, and
-- publishing checks the post still has that hash.
ALTER TABLE post_versions ADD COLUMN content_hash text;
ALTER TABLE approvals ADD COLUMN content_hash text;

-- Uploads wait in quarantine until the scan step marks them ready. The hash ties the
-- file that was approved to the file that publishes.
ALTER TABLE media_assets
  ADD COLUMN sha256 text,
  ADD COLUMN status text NOT NULL DEFAULT 'ready' CHECK (status IN ('quarantine', 'ready', 'blocked')),
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE media_assets ALTER COLUMN status SET DEFAULT 'quarantine';

-- Facts the AI may state: offers, prices, opening hours, claims. Only verified,
-- unexpired facts reach the planner, and every price or claim in a draft must cite one.
CREATE TABLE brand_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('offer', 'price', 'hours', 'claim', 'other')),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  value text NOT NULL CHECK (length(value) BETWEEN 1 AND 1000),
  price numeric(12, 2),
  currency text,
  starts_at timestamptz,
  ends_at timestamptz,
  source text,
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'verified')),
  verified_by uuid REFERENCES users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, id)
);
CREATE INDEX brand_facts_tenant_idx ON brand_facts(tenant_id, created_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE brand_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_facts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON brand_facts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
