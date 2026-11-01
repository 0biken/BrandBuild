CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TYPE post_state AS ENUM ('draft','in_review','changes_requested','approved','scheduled','publishing','reconciling','published','failed','canceled','expired');
CREATE TYPE approval_decision AS ENUM ('approved','changes_requested');
CREATE TYPE publish_attempt_state AS ENUM ('queued','running','succeeded','failed','unknown');

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tenant_memberships (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX tenant_memberships_user_idx ON tenant_memberships(user_id);

CREATE TABLE brand_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL, website_url text, voice jsonb NOT NULL DEFAULT '{}'::jsonb,
  audience jsonb NOT NULL DEFAULT '{}'::jsonb, guidelines text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX brand_profiles_tenant_idx ON brand_profiles(tenant_id);
CREATE TABLE content_pillars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  brand_profile_id uuid NOT NULL, name text NOT NULL, description text, weight smallint NOT NULL DEFAULT 1 CHECK (weight > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), FOREIGN KEY (tenant_id, brand_profile_id) REFERENCES brand_profiles(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX content_pillars_brand_idx ON content_pillars(tenant_id, brand_profile_id);

CREATE TABLE channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  brand_profile_id uuid, provider text NOT NULL, external_account_id text, display_name text,
  scopes text[] NOT NULL DEFAULT '{}', credentials_ciphertext bytea, token_expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), FOREIGN KEY (tenant_id, brand_profile_id) REFERENCES brand_profiles(tenant_id, id) ON DELETE SET NULL (brand_profile_id)
);
CREATE INDEX channels_tenant_provider_idx ON channels(tenant_id, provider);
CREATE TABLE oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL, state_hash text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (provider, state_hash)
);
CREATE INDEX oauth_states_expiry_idx ON oauth_states(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE calendar_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  brand_profile_id uuid, name text NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'draft', settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), CHECK (ends_on >= starts_on),
  FOREIGN KEY (tenant_id, brand_profile_id) REFERENCES brand_profiles(tenant_id, id) ON DELETE SET NULL (brand_profile_id)
);
CREATE INDEX calendar_plans_window_idx ON calendar_plans(tenant_id, starts_on, ends_on);
CREATE TABLE calendar_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL, channel_id uuid, pillar_id uuid, scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open', notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), FOREIGN KEY (tenant_id, plan_id) REFERENCES calendar_plans(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, channel_id) REFERENCES channels(tenant_id, id) ON DELETE SET NULL (channel_id),
  FOREIGN KEY (tenant_id, pillar_id) REFERENCES content_pillars(tenant_id, id) ON DELETE SET NULL (pillar_id)
);
CREATE INDEX calendar_slots_schedule_idx ON calendar_slots(tenant_id, scheduled_for);
CREATE INDEX calendar_slots_plan_idx ON calendar_slots(tenant_id, plan_id);

CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  brand_profile_id uuid, channel_id uuid, calendar_slot_id uuid, current_version integer NOT NULL DEFAULT 1,
  state post_state NOT NULL DEFAULT 'draft', scheduled_for timestamptz, published_at timestamptz,
  platform_post_id text, created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), FOREIGN KEY (tenant_id, brand_profile_id) REFERENCES brand_profiles(tenant_id, id) ON DELETE SET NULL (brand_profile_id),
  FOREIGN KEY (tenant_id, channel_id) REFERENCES channels(tenant_id, id) ON DELETE SET NULL (channel_id),
  FOREIGN KEY (tenant_id, calendar_slot_id) REFERENCES calendar_slots(tenant_id, id) ON DELETE SET NULL
);
CREATE INDEX posts_tenant_state_idx ON posts(tenant_id, state, updated_at DESC);
CREATE INDEX posts_due_idx ON posts(scheduled_for) WHERE state = 'scheduled';
CREATE TABLE post_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, post_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0), content jsonb NOT NULL, created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, post_id, version), UNIQUE (tenant_id, post_id, id),
  FOREIGN KEY (tenant_id, post_id) REFERENCES posts(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX post_versions_post_idx ON post_versions(tenant_id, post_id, version DESC);
CREATE FUNCTION reject_post_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'post_versions are immutable; create a new version'; END; $$;
CREATE TRIGGER post_versions_immutable BEFORE UPDATE OR DELETE ON post_versions FOR EACH ROW EXECUTE FUNCTION reject_post_version_mutation();
CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, post_id uuid NOT NULL, post_version_id uuid NOT NULL,
  reviewer_id uuid REFERENCES users(id) ON DELETE SET NULL, decision approval_decision NOT NULL, comment text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, post_id, post_version_id) REFERENCES post_versions(tenant_id, post_id, id) ON DELETE CASCADE
);
CREATE INDEX approvals_version_idx ON approvals(tenant_id, post_id, post_version_id, decided_at DESC);
CREATE TABLE publish_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, post_id uuid NOT NULL, post_version_id uuid NOT NULL,
  channel_id uuid, idempotency_key text NOT NULL, state publish_attempt_state NOT NULL DEFAULT 'queued',
  attempt_no integer NOT NULL DEFAULT 1 CHECK (attempt_no > 0), platform_post_id text, response jsonb,
  error text, started_at timestamptz, finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, post_id, post_version_id) REFERENCES post_versions(tenant_id, post_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, channel_id) REFERENCES channels(tenant_id, id) ON DELETE SET NULL (channel_id)
);
CREATE INDEX publish_attempts_work_idx ON publish_attempts(state, created_at) WHERE state IN ('queued','running','unknown');
CREATE INDEX publish_attempts_post_idx ON publish_attempts(tenant_id, post_id, created_at DESC);

CREATE TABLE metric_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, post_id uuid NOT NULL, channel_id uuid,
  captured_at timestamptz NOT NULL DEFAULT now(), metrics jsonb NOT NULL,
  FOREIGN KEY (tenant_id, post_id) REFERENCES posts(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, channel_id) REFERENCES channels(tenant_id, id) ON DELETE SET NULL (channel_id)
);
CREATE INDEX metric_snapshots_post_time_idx ON metric_snapshots(tenant_id, post_id, captured_at DESC);
CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL, status text NOT NULL DEFAULT 'queued', input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb, error text, usage_units integer NOT NULL DEFAULT 0 CHECK (usage_units >= 0),
  started_at timestamptz, finished_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_runs_tenant_time_idx ON agent_runs(tenant_id, created_at DESC);
CREATE INDEX agent_runs_pending_idx ON agent_runs(created_at) WHERE status IN ('queued','running');
CREATE TABLE usage_caps (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL DEFAULT date_trunc('month', now()),
  agent_runs_limit integer NOT NULL DEFAULT 100 CHECK (agent_runs_limit >= 0),
  agent_runs_used integer NOT NULL DEFAULT 0 CHECK (agent_runs_used >= 0),
  requests_per_minute integer NOT NULL DEFAULT 120 CHECK (requests_per_minute >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL, action text NOT NULL, resource_type text NOT NULL,
  resource_id uuid, details jsonb NOT NULL DEFAULT '{}'::jsonb, request_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_time_idx ON audit_log(tenant_id, created_at DESC);
CREATE INDEX audit_log_resource_idx ON audit_log(tenant_id, resource_type, resource_id, created_at DESC);
CREATE TABLE outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  topic text NOT NULL, payload jsonb NOT NULL, attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(), locked_at timestamptz, processed_at timestamptz,
  last_error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_ready_idx ON outbox(available_at, created_at) WHERE processed_at IS NULL;
CREATE INDEX outbox_tenant_topic_idx ON outbox(tenant_id, topic, created_at DESC);
