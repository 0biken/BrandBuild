-- Function ownership does not imply access to the referenced tables. Keep the
-- cross-tenant privilege on the NOLOGIN definer, never on either runtime role.
GRANT USAGE ON SCHEMA public, admin TO brandbuild_admin_definer;
GRANT SELECT ON public.tenants, public.users, public.tenant_memberships,
  public.posts, public.post_versions, public.approvals, public.publish_attempts,
  public.channels, public.agent_runs, public.usage_caps, public.student_checks,
  public.student_submissions, public.brand_profiles, public.brand_facts,
  public.post_activity, public.audit_log, public.outbox
  TO brandbuild_admin_definer;
GRANT UPDATE ON public.tenants, public.posts, public.publish_attempts,
  public.student_submissions, public.student_checks TO brandbuild_admin_definer;
GRANT INSERT ON public.post_versions, public.post_activity, public.audit_log,
  public.outbox, public.publish_attempts, public.student_checks
  TO brandbuild_admin_definer;

GRANT SELECT ON admin.staff_users, admin.staff_audit_log, admin.workspace_notes,
  admin.publishing_holds, admin.provider_incidents, admin.support_sessions,
  admin.ai_policies, admin.workspace_ai_controls, admin.ai_reservations,
  admin.publish_resolution_idempotency TO brandbuild_admin_definer;
GRANT INSERT, UPDATE ON admin.ai_reservations TO brandbuild_admin_definer;
GRANT INSERT ON admin.publish_resolution_idempotency TO brandbuild_admin_definer;
-- reserve_ai_budget locks the singleton policy row FOR UPDATE.
GRANT UPDATE ON admin.ai_policies TO brandbuild_admin_definer;

GRANT SELECT, INSERT, UPDATE ON admin.ai_policies,
  admin.workspace_ai_controls, admin.support_sessions TO brandbuild_admin;

-- EXECUTE is insufficient without schema USAGE. No customer table grants are
-- added: only explicitly granted functions are callable through this namespace.
GRANT USAGE ON SCHEMA admin TO brandbuild_app;
REVOKE ALL ON ALL TABLES IN SCHEMA admin FROM brandbuild_app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM brandbuild_admin;
ALTER ROLE brandbuild_admin NOBYPASSRLS;
