-- Tenant isolation in Postgres itself.
--
-- The API connects as brandbuild_app, which has no BYPASSRLS. Every tenant data table
-- only shows rows whose tenant_id matches app.tenant_id, which the API sets per
-- transaction (db::tenant_tx). With no tenant set, NULLIF turns '' into NULL and the
-- policy matches nothing, so a forgotten context returns no rows instead of all of them.
--
-- Left without RLS on purpose:
--   users, tenants, tenant_memberships, auth_codes: sign-in reads them before any tenant
--     is known.
--   outbox, agent_runs: the background worker reads them across tenants.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brandbuild_app') THEN
    -- Created without a password; ops (or the dev init script) gives it LOGIN and one.
    CREATE ROLE brandbuild_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO brandbuild_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO brandbuild_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO brandbuild_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO brandbuild_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO brandbuild_app;
-- The app never runs migrations.
REVOKE ALL ON _sqlx_migrations FROM brandbuild_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'brand_profiles', 'content_pillars', 'channels', 'oauth_states', 'calendar_plans',
    'calendar_slots', 'posts', 'post_versions', 'approvals', 'publish_attempts',
    'metric_snapshots', 'usage_caps', 'audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END $$;
