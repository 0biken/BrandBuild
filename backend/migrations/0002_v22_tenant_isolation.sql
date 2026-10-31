-- v2.2 tenant-safe operational model. Each tenant-owned row is protected by FORCE RLS.
-- Deploy with an application role that does not own the tables and lacks BYPASSRLS.
CREATE TABLE tenants_v22 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tier text NOT NULL DEFAULT 'pool' CHECK(tier IN ('pool','dedicated','silo')),
 config jsonb NOT NULL DEFAULT '{}'::jsonb, config_version integer NOT NULL DEFAULT 1 CHECK(config_version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE brand_profile (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants_v22(id) ON DELETE CASCADE,
 name text NOT NULL, website_url text, voice jsonb NOT NULL DEFAULT '{}'::jsonb, audience jsonb NOT NULL DEFAULT '{}'::jsonb, guidelines text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE TABLE pillar (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants_v22(id) ON DELETE CASCADE,
 brand_profile_id uuid NOT NULL, name text NOT NULL, description text, weight smallint NOT NULL DEFAULT 1 CHECK(weight>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,brand_profile_id) REFERENCES brand_profile(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE asset (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants_v22(id) ON DELETE CASCADE,
 object_key text NOT NULL, kind text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,object_key)
);
CREATE TABLE channel_connection (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants_v22(id) ON DELETE CASCADE,
 provider text NOT NULL, external_account_id text, display_name text, state text NOT NULL DEFAULT 'not_connected', scopes text[] NOT NULL DEFAULT '{}',
 credentials_ciphertext bytea, wrapped_data_key bytea, token_expires_at timestamptz, is_active boolean NOT NULL DEFAULT false,
 capabilities jsonb NOT NULL DEFAULT '{}'::jsonb, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE TABLE calendar_plan (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants_v22(id) ON DELETE CASCADE,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), state text NOT NULL DEFAULT 'draft', starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), CHECK(ends_at>=starts_at)
);
CREATE TABLE content_slot (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants_v22(id) ON DELETE CASCADE, plan_id uuid NOT NULL, pillar_id uuid,
 channel_id uuid NOT NULL, target_at timestamptz NOT NULL, window_end timestamptz NOT NULL, state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','filled','skipped','filling','missed')),
 brief jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id), CHECK(window_end>=target_at),
 FOREIGN KEY(tenant_id,plan_id) REFERENCES calendar_plan(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,pillar_id) REFERENCES pillar(tenant_id,id), FOREIGN KEY(tenant_id,channel_id) REFERENCES channel_connection(tenant_id,id)
);
CREATE TABLE post (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants_v22(id) ON DELETE CASCADE, slot_id uuid UNIQUE, channel_id uuid NOT NULL,
 state post_state NOT NULL DEFAULT 'draft', current_version_id uuid, scheduled_for timestamptz, platform_post_id text,
 state_changed_at timestamptz NOT NULL DEFAULT now(), row_version integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,slot_id) REFERENCES content_slot(tenant_id,id), FOREIGN KEY(tenant_id,channel_id) REFERENCES channel_connection(tenant_id,id)
);
CREATE TABLE post_version (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants_v22(id) ON DELETE CASCADE, post_id uuid NOT NULL,
 n integer NOT NULL CHECK(n>0), author text NOT NULL CHECK(author IN ('agent','human')), body text NOT NULL, hashtags text[] NOT NULL DEFAULT '{}', asset_ids uuid[] NOT NULL DEFAULT '{}',
 risk jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(post_id,n), UNIQUE(tenant_id,post_id,id),
 FOREIGN KEY(tenant_id,post_id) REFERENCES post(tenant_id,id) ON DELETE CASCADE
);
ALTER TABLE post ADD CONSTRAINT post_current_version_fk FOREIGN KEY(tenant_id,id,current_version_id) REFERENCES post_version(tenant_id,post_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION reject_post_version_mutation_v22() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'post_version rows are immutable; insert a new version'; END; $$;
CREATE TRIGGER post_version_immutable_v22 BEFORE UPDATE OR DELETE ON post_version FOR EACH ROW EXECUTE FUNCTION reject_post_version_mutation_v22();
CREATE TABLE approval (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants_v22(id) ON DELETE CASCADE, post_id uuid NOT NULL, version_id uuid NOT NULL,
 actor text NOT NULL, decision text NOT NULL CHECK(decision IN ('approved','changes_requested')), comment text, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,post_id,version_id) REFERENCES post_version(tenant_id,post_id,id) ON DELETE CASCADE
);
CREATE TABLE publish_attempt (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants_v22(id) ON DELETE CASCADE, post_id uuid NOT NULL, version_id uuid NOT NULL, channel_id uuid NOT NULL,
 idempotency_key text NOT NULL, outcome text NOT NULL CHECK(outcome IN ('started','succeeded','retryable','permanent','unknown')), platform_response jsonb,
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, UNIQUE(tenant_id,idempotency_key),
 FOREIGN KEY(tenant_id,post_id,version_id) REFERENCES post_version(tenant_id,post_id,id), FOREIGN KEY(tenant_id,channel_id) REFERENCES channel_connection(tenant_id,id)
);
CREATE TABLE metric_snapshot (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants_v22(id) ON DELETE CASCADE, post_id uuid NOT NULL, channel_id uuid,
 captured_at timestamptz NOT NULL DEFAULT now(), metrics jsonb NOT NULL, FOREIGN KEY(tenant_id,post_id) REFERENCES post(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,channel_id) REFERENCES channel_connection(tenant_id,id)
);
CREATE TABLE agent_run (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants_v22(id) ON DELETE CASCADE, kind text NOT NULL, status text NOT NULL DEFAULT 'queued',
 input jsonb NOT NULL DEFAULT '{}'::jsonb, output jsonb, cost_per_step jsonb NOT NULL DEFAULT '{}'::jsonb, config_version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz
);
CREATE TABLE usage_ledger (
 id bigserial PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants_v22(id) ON DELETE CASCADE, run_id uuid REFERENCES agent_run(id), meter text NOT NULL,
 quantity bigint NOT NULL CHECK(quantity>=0), cost numeric(18,6) NOT NULL DEFAULT 0, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_event (
 id bigserial PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants_v22(id) ON DELETE CASCADE, actor text NOT NULL, action text NOT NULL,
 resource_type text NOT NULL, resource_id uuid, details jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE post_event (
 id bigserial PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants_v22(id) ON DELETE CASCADE, post_id uuid NOT NULL, from_state post_state,
 to_state post_state NOT NULL, trigger text NOT NULL, actor text NOT NULL, at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 FOREIGN KEY(tenant_id,post_id) REFERENCES post(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE outbox (
 id bigserial PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants_v22(id) ON DELETE CASCADE, topic text NOT NULL, payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['tenants_v22','brand_profile','pillar','asset','channel_connection','calendar_plan','content_slot','post','post_version','approval','publish_attempt','metric_snapshot','agent_run','usage_ledger','audit_event','post_event','outbox'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=current_setting(''app.tenant_id'',true)::uuid) WITH CHECK (tenant_id=current_setting(''app.tenant_id'',true)::uuid)',t);
 END LOOP;
END $$;
CREATE INDEX content_slot_plan_idx ON content_slot(tenant_id,plan_id);
CREATE INDEX post_state_idx ON post(tenant_id,state,updated_at DESC);
CREATE INDEX approval_version_idx ON approval(tenant_id,post_id,version_id,created_at DESC);
CREATE INDEX audit_event_tenant_idx ON audit_event(tenant_id,created_at DESC);
