-- Plan, student check and onboarding progress, one row each per workspace.
ALTER TABLE tenants
  ADD COLUMN plan text NOT NULL DEFAULT 'creator' CHECK (plan IN ('student', 'creator', 'business')),
  ADD COLUMN plan_ends_at timestamptz;

ALTER TABLE auth_codes DROP CONSTRAINT IF EXISTS auth_codes_purpose_check;
ALTER TABLE auth_codes
  ADD CONSTRAINT auth_codes_purpose_check
  CHECK (purpose IN ('verify_email', 'reset_password', 'student_email'));

CREATE TABLE student_checks (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'none'
    CHECK (status IN ('none', 'code_sent', 'verified', 'pending_review', 'not_student')),
  method text CHECK (method IN ('email', 'id')),
  email text,
  checked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE onboarding_steps (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  verify text NOT NULL DEFAULT 'todo' CHECK (verify IN ('todo', 'done', 'skipped')),
  connect text NOT NULL DEFAULT 'todo' CHECK (connect IN ('todo', 'done', 'skipped')),
  brand text NOT NULL DEFAULT 'todo' CHECK (brand IN ('todo', 'done', 'skipped')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Workspaces that existed before onboarding was tracked count as set up.
INSERT INTO onboarding_steps (tenant_id, verify, connect, brand)
SELECT id, 'done', 'done', 'done' FROM tenants;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['student_checks', 'onboarding_steps'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END $$;
