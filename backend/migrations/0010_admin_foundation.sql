-- Admin Console Milestone 1: isolated admin schema, roles, staff identities,
-- sessions, OIDC login state, and append-only staff audit log.

CREATE SCHEMA IF NOT EXISTS admin;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brandbuild_admin') THEN
    CREATE ROLE brandbuild_admin NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brandbuild_admin_definer') THEN
    CREATE ROLE brandbuild_admin_definer NOLOGIN BYPASSRLS;
  END IF;
END $$;

REVOKE ALL ON SCHEMA admin FROM PUBLIC;
REVOKE ALL ON SCHEMA admin FROM brandbuild_app;
GRANT USAGE ON SCHEMA admin TO brandbuild_admin;
GRANT USAGE ON SCHEMA admin TO brandbuild_admin_definer;

CREATE TABLE admin.staff_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub text UNIQUE,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  roles text[] NOT NULL DEFAULT '{}'
    CHECK (roles <@ ARRAY['support', 'operations', 'student_reviewer', 'staff_admin']),
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin.staff_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES admin.staff_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_sessions_user_idx ON admin.staff_sessions(staff_user_id) WHERE revoked_at IS NULL;
CREATE INDEX staff_sessions_expiry_idx ON admin.staff_sessions(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE admin.oidc_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE,
  nonce text NOT NULL,
  redirect_to text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oidc_states_expiry_idx ON admin.oidc_states(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE admin.staff_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid REFERENCES admin.staff_users(id) ON DELETE SET NULL,
  staff_email text,
  active_roles text[] NOT NULL DEFAULT '{}',
  action text NOT NULL,
  workspace_id uuid,
  target_type text,
  target_id text,
  request_id text,
  reason text,
  ticket_ref text,
  support_session_id uuid,
  before_state jsonb,
  after_state jsonb,
  outcome text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'denied', 'error')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_audit_log_time_idx ON admin.staff_audit_log(created_at DESC);
CREATE INDEX staff_audit_log_staff_idx ON admin.staff_audit_log(staff_user_id, created_at DESC);
CREATE INDEX staff_audit_log_workspace_idx ON admin.staff_audit_log(workspace_id, created_at DESC);
CREATE INDEX staff_audit_log_action_idx ON admin.staff_audit_log(action, created_at DESC);

CREATE FUNCTION admin.reject_staff_audit_mutation() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, admin
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.audit_retention_purge', true) = 'true' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'admin.staff_audit_log is append-only';
END;
$$;

CREATE TRIGGER staff_audit_log_immutable
  BEFORE UPDATE OR DELETE ON admin.staff_audit_log
  FOR EACH ROW EXECUTE FUNCTION admin.reject_staff_audit_mutation();

-- Explicit least-privilege grants for brandbuild_admin (NOBYPASSRLS).
GRANT SELECT, INSERT, UPDATE, DELETE ON admin.staff_users, admin.staff_sessions, admin.oidc_states TO brandbuild_admin;
GRANT SELECT, INSERT ON admin.staff_audit_log TO brandbuild_admin;

GRANT USAGE ON SCHEMA public TO brandbuild_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO brandbuild_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO brandbuild_admin;
REVOKE ALL ON _sqlx_migrations FROM brandbuild_admin;

-- Customer app role must never read or mutate admin tables.
REVOKE ALL ON ALL TABLES IN SCHEMA admin FROM brandbuild_app;
