-- Milestone 6: Controlled customer support sessions & explicit staff attribution.

CREATE TABLE admin.support_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('read_only', 'read_write')),
  ticket_ref text NOT NULL CHECK (length(trim(ticket_ref)) BETWEEN 1 AND 120),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  duration_minutes int NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 60),
  status text NOT NULL DEFAULT 'pending_approval' CHECK (
    status IN ('pending_approval', 'approved', 'active', 'ended', 'revoked', 'rejected', 'expired')
  ),
  requested_by uuid NOT NULL REFERENCES admin.staff_users(id),
  approved_by uuid REFERENCES admin.staff_users(id),
  CONSTRAINT support_session_no_self_approve CHECK (approved_by IS NULL OR approved_by <> requested_by),
  customer_notified_at timestamptz,
  activated_at timestamptz,
  expires_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX support_sessions_tenant_idx ON admin.support_sessions (tenant_id, created_at DESC);
CREATE INDEX support_sessions_status_idx ON admin.support_sessions (status, created_at DESC);

REVOKE ALL ON admin.support_sessions FROM PUBLIC, brandbuild_app;

ALTER TABLE post_versions
  ADD COLUMN IF NOT EXISTS staff_actor_id uuid REFERENCES admin.staff_users(id),
  ADD COLUMN IF NOT EXISTS support_session_id uuid REFERENCES admin.support_sessions(id);

ALTER TABLE post_activity
  ADD COLUMN IF NOT EXISTS staff_actor_id uuid REFERENCES admin.staff_users(id),
  ADD COLUMN IF NOT EXISTS support_session_id uuid REFERENCES admin.support_sessions(id);

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS staff_actor_id uuid REFERENCES admin.staff_users(id),
  ADD COLUMN IF NOT EXISTS support_session_id uuid REFERENCES admin.support_sessions(id);

CREATE OR REPLACE FUNCTION admin.list_support_sessions(
  p_tenant_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin, pg_temp
AS $$
DECLARE
  v_items jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(s)), '[]'::jsonb) INTO v_items
  FROM (
    SELECT
      ss.id,
      ss.tenant_id AS "tenantId",
      t.name AS "workspaceName",
      ss.mode,
      ss.ticket_ref AS "ticketRef",
      ss.reason,
      ss.duration_minutes AS "durationMinutes",
      ss.status,
      ss.requested_by AS "requestedBy",
      req.display_name AS "requestedByName",
      req.email AS "requestedByEmail",
      ss.approved_by AS "approvedBy",
      app.display_name AS "approvedByName",
      ss.customer_notified_at AS "customerNotifiedAt",
      ss.activated_at AS "activatedAt",
      ss.expires_at AS "expiresAt",
      ss.ended_at AS "endedAt",
      ss.created_at AS "createdAt"
    FROM admin.support_sessions ss
    JOIN tenants t ON t.id = ss.tenant_id
    JOIN admin.staff_users req ON req.id = ss.requested_by
    LEFT JOIN admin.staff_users app ON app.id = ss.approved_by
    WHERE (p_tenant_id IS NULL OR ss.tenant_id = p_tenant_id)
      AND (p_status IS NULL OR ss.status = p_status)
    ORDER BY ss.created_at DESC
    LIMIT 100
  ) s;
  RETURN v_items;
END;
$$;

ALTER FUNCTION admin.list_support_sessions(uuid, text) OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.list_support_sessions(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.list_support_sessions(uuid, text) TO brandbuild_admin;

CREATE OR REPLACE FUNCTION admin.support_workspace_view(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin, pg_temp
AS $$
DECLARE
  v_ws jsonb;
  v_drafts jsonb;
  v_brand jsonb;
  v_facts jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', id,
    'name', name,
    'plan', plan,
    'timezone', timezone
  ) INTO v_ws FROM tenants WHERE id = p_tenant_id;

  SELECT COALESCE(jsonb_agg(row_to_json(p)), '[]'::jsonb) INTO v_drafts
  FROM (
    SELECT
      id,
      COALESCE(title, '') AS title,
      COALESCE(body, '') AS body,
      platforms,
      state::text AS state,
      scheduled_for AS "scheduledFor",
      updated_at AS "updatedAt"
    FROM posts
    WHERE tenant_id = p_tenant_id
    ORDER BY updated_at DESC
    LIMIT 40
  ) p;

  SELECT to_jsonb(bp) INTO v_brand
  FROM (
    SELECT tone, audience, offerings, avoid
    FROM brand_profiles
    WHERE tenant_id = p_tenant_id
  ) bp;

  SELECT COALESCE(jsonb_agg(row_to_json(f)), '[]'::jsonb) INTO v_facts
  FROM (
    SELECT id, kind, label, value, verified
    FROM brand_facts
    WHERE tenant_id = p_tenant_id
    ORDER BY created_at DESC
    LIMIT 30
  ) f;

  RETURN jsonb_build_object(
    'workspace', v_ws,
    'drafts', v_drafts,
    'brand', v_brand,
    'facts', v_facts
  );
END;
$$;

ALTER FUNCTION admin.support_workspace_view(uuid) OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.support_workspace_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.support_workspace_view(uuid) TO brandbuild_admin;

CREATE OR REPLACE FUNCTION admin.support_update_draft(
  p_tenant_id uuid,
  p_post_id uuid,
  p_title text,
  p_body text,
  p_staff_id uuid,
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin, pg_temp
AS $$
DECLARE
  v_post posts%ROWTYPE;
  v_next_ver int;
BEGIN
  SELECT * INTO v_post FROM posts WHERE id = p_post_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_post.state::text NOT IN ('draft', 'idea') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_draft');
  END IF;

  UPDATE posts
  SET title = p_title,
      body = p_body,
      updated_at = now()
  WHERE id = p_post_id;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_ver FROM post_versions WHERE post_id = p_post_id;

  INSERT INTO post_versions (post_id, tenant_id, version, content, created_by, staff_actor_id, support_session_id)
  VALUES (
    p_post_id,
    p_tenant_id,
    v_next_ver,
    jsonb_build_object('title', p_title, 'body', p_body),
    NULL,
    p_staff_id,
    p_session_id
  );

  INSERT INTO post_activity (tenant_id, post_id, actor_id, kind, body, staff_actor_id, support_session_id)
  VALUES (
    p_tenant_id,
    p_post_id,
    NULL,
    'support_edit',
    'Draft updated by BrandBuild Support',
    p_staff_id,
    p_session_id
  );

  INSERT INTO audit_log (tenant_id, actor_id, action, resource_type, resource_id, meta, staff_actor_id, support_session_id)
  VALUES (
    p_tenant_id,
    NULL,
    'support.draft_updated',
    'post',
    p_post_id,
    jsonb_build_object('attribution', 'BrandBuild Support'),
    p_staff_id,
    p_session_id
  );

  RETURN jsonb_build_object('ok', true, 'id', p_post_id, 'version', v_next_ver);
END;
$$;

ALTER FUNCTION admin.support_update_draft(uuid, uuid, text, text, uuid, uuid) OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.support_update_draft(uuid, uuid, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.support_update_draft(uuid, uuid, text, text, uuid, uuid) TO brandbuild_admin;
