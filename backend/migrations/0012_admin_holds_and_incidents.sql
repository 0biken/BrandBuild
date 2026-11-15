-- Admin Console Milestone 3: Scoped publishing holds (global, workspace, channel)
-- and customer-facing provider incident notices.

CREATE TABLE admin.publishing_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('global', 'workspace', 'channel')),
  workspace_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  channel_id uuid,
  internal_reason text NOT NULL CHECK (length(trim(internal_reason)) BETWEEN 1 AND 500),
  customer_message text NOT NULL CHECK (length(trim(customer_message)) BETWEEN 1 AND 1000),
  created_by uuid NOT NULL REFERENCES admin.staff_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_by uuid REFERENCES admin.staff_users(id) ON DELETE RESTRICT,
  released_at timestamptz,
  release_reason text,
  FOREIGN KEY (workspace_id, channel_id) REFERENCES public.channels(tenant_id, id) ON DELETE CASCADE,
  CHECK (
    (scope = 'global' AND workspace_id IS NULL AND channel_id IS NULL)
    OR (scope = 'workspace' AND workspace_id IS NOT NULL AND channel_id IS NULL)
    OR (scope = 'channel' AND workspace_id IS NOT NULL AND channel_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX publishing_holds_active_global_idx
  ON admin.publishing_holds(scope) WHERE scope = 'global' AND released_at IS NULL;
CREATE UNIQUE INDEX publishing_holds_active_ws_idx
  ON admin.publishing_holds(workspace_id) WHERE scope = 'workspace' AND released_at IS NULL;
CREATE UNIQUE INDEX publishing_holds_active_ch_idx
  ON admin.publishing_holds(workspace_id, channel_id) WHERE scope = 'channel' AND released_at IS NULL;

CREATE TABLE admin.provider_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  platforms text[] NOT NULL CHECK (platforms <@ ARRAY['ig', 'fb', 'li', 'tt'] AND cardinality(platforms) > 0),
  customer_message text NOT NULL CHECK (length(trim(customer_message)) BETWEEN 1 AND 1000),
  publish_banner boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES admin.staff_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES admin.staff_users(id) ON DELETE RESTRICT,
  resolved_at timestamptz
);
CREATE INDEX provider_incidents_active_idx ON admin.provider_incidents(created_at DESC) WHERE resolved_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON admin.publishing_holds, admin.provider_incidents TO brandbuild_admin;
REVOKE ALL ON admin.publishing_holds, admin.provider_incidents FROM brandbuild_app;

-- Locked-down check used by both worker and customer/admin APIs to evaluate composed holds.
CREATE FUNCTION admin.active_holds_for_target(p_workspace_id uuid, p_channel_id uuid) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, admin
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', h.id,
    'scope', h.scope,
    'workspaceId', h.workspace_id,
    'channelId', h.channel_id,
    'customerMessage', h.customer_message,
    'createdAt', h.created_at
  ) ORDER BY h.created_at ASC), '[]'::jsonb)
  FROM admin.publishing_holds h
  WHERE h.released_at IS NULL
    AND (
      h.scope = 'global'
      OR (h.scope = 'workspace' AND h.workspace_id = p_workspace_id)
      OR (h.scope = 'channel' AND h.workspace_id = p_workspace_id AND h.channel_id = p_channel_id)
    );
$$;

ALTER FUNCTION admin.active_holds_for_target(uuid, uuid) OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.active_holds_for_target(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.active_holds_for_target(uuid, uuid) TO brandbuild_admin, brandbuild_app;

CREATE FUNCTION admin.active_customer_incidents() RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, admin
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'title', i.title,
    'platforms', i.platforms,
    'customerMessage', i.customer_message,
    'createdAt', i.created_at
  ) ORDER BY i.created_at DESC), '[]'::jsonb)
  FROM admin.provider_incidents i
  WHERE i.resolved_at IS NULL AND i.publish_banner = true;
$$;

ALTER FUNCTION admin.active_customer_incidents() OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.active_customer_incidents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.active_customer_incidents() TO brandbuild_admin, brandbuild_app;

-- Update overview_summary() to include real paused workspace count and active incidents.
CREATE OR REPLACE FUNCTION admin.overview_summary() RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, admin
AS $$
DECLARE
  v_unclear_count bigint;
  v_unclear_oldest double precision;
  v_student_count bigint;
  v_student_oldest double precision;
  v_paused_count bigint;
  v_global_paused boolean;
  v_failed_today bigint;
  v_total_today bigint;
  v_platforms jsonb;
  v_ai_runs bigint;
  v_ai_cost double precision;
  v_top_ws jsonb;
  v_recent_actions jsonb;
  v_active_incidents jsonb;
BEGIN
  SELECT count(*),
         EXTRACT(EPOCH FROM (now() - min(updated_at))) / 60.0
  INTO v_unclear_count, v_unclear_oldest
  FROM public.posts
  WHERE state = 'reconciling' AND deleted_at IS NULL;

  SELECT count(*),
         EXTRACT(EPOCH FROM (now() - min(updated_at))) / 60.0
  INTO v_student_count, v_student_oldest
  FROM public.student_checks
  WHERE status = 'pending_review';

  SELECT count(DISTINCT workspace_id)
  INTO v_paused_count
  FROM admin.publishing_holds
  WHERE released_at IS NULL AND scope IN ('workspace', 'channel');

  SELECT EXISTS(
    SELECT 1 FROM admin.publishing_holds WHERE released_at IS NULL AND scope = 'global'
  ) INTO v_global_paused;

  WITH today_attempts AS (
    SELECT COALESCE(c.provider, 'unknown') AS platform,
           pa.state
    FROM public.publish_attempts pa
    LEFT JOIN public.channels c ON c.tenant_id = pa.tenant_id AND c.id = pa.channel_id
    WHERE pa.created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
  ),
  platforms AS (
    SELECT unnest(ARRAY['ig', 'fb', 'li', 'tt']) AS platform
  ),
  agg AS (
    SELECT p.platform,
           count(*) FILTER (WHERE ta.state = 'succeeded') AS verified,
           0::bigint AS accepted_unverified,
           count(*) FILTER (WHERE ta.state = 'failed') AS failed,
           count(*) FILTER (WHERE ta.state = 'unknown') AS unclear
    FROM platforms p
    LEFT JOIN today_attempts ta ON ta.platform = p.platform
    GROUP BY p.platform
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'platform', platform,
           'verified', verified,
           'acceptedUnverified', accepted_unverified,
           'failed', failed,
           'unclear', unclear
         ) ORDER BY platform), '[]'::jsonb),
         COALESCE(sum(failed), 0),
         COALESCE(sum(verified + accepted_unverified + failed + unclear), 0)
  INTO v_platforms, v_failed_today, v_total_today
  FROM agg;

  SELECT count(*), COALESCE(sum(cost_usd), 0)::float8
  INTO v_ai_runs, v_ai_cost
  FROM public.agent_runs
  WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC');

  SELECT jsonb_build_object('id', t.id, 'name', t.name, 'costUsd', COALESCE(sum(ar.cost_usd), 0)::float8)
  INTO v_top_ws
  FROM public.agent_runs ar
  JOIN public.tenants t ON t.id = ar.tenant_id
  WHERE ar.created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
  GROUP BY t.id, t.name
  ORDER BY sum(ar.cost_usd) DESC
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', l.id,
           'staffEmail', l.staff_email,
           'staffName', COALESCE(u.display_name, l.staff_email, 'System'),
           'action', l.action,
           'workspaceId', l.workspace_id,
           'targetType', l.target_type,
           'targetId', l.target_id,
           'reason', l.reason,
           'createdAt', l.created_at
         )), '[]'::jsonb)
  INTO v_recent_actions
  FROM (
    SELECT id, staff_user_id, staff_email, action, workspace_id, target_type, target_id, reason, created_at
    FROM admin.staff_audit_log
    ORDER BY created_at DESC, id DESC
    LIMIT 6
  ) l
  LEFT JOIN admin.staff_users u ON u.id = l.staff_user_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', i.id,
           'title', i.title,
           'platforms', i.platforms,
           'customerMessage', i.customer_message,
           'publishBanner', i.publish_banner,
           'createdAt', i.created_at
         ) ORDER BY i.created_at DESC), '[]'::jsonb)
  INTO v_active_incidents
  FROM admin.provider_incidents i
  WHERE i.resolved_at IS NULL;

  RETURN jsonb_build_object(
    'generatedAt', now(),
    'unclear', jsonb_build_object('count', v_unclear_count, 'oldestMinutes', v_unclear_oldest),
    'studentReviews', jsonb_build_object('count', v_student_count, 'oldestMinutes', v_student_oldest),
    'pausedWorkspaces', jsonb_build_object('count', v_paused_count, 'globalPaused', v_global_paused),
    'failedToday', jsonb_build_object('failed', v_failed_today, 'total', v_total_today),
    'platforms', v_platforms,
    'aiToday', jsonb_build_object('runs', v_ai_runs, 'costUsd', v_ai_cost, 'topWorkspace', v_top_ws),
    'recentActions', v_recent_actions,
    'activeIncidents', v_active_incidents
  );
END;
$$;

-- Update workspace_detail(uuid) to include active holds affecting the workspace.
CREATE OR REPLACE FUNCTION admin.workspace_detail(p_workspace_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, admin
AS $$
DECLARE
  v_ws record;
  v_owner jsonb;
  v_student jsonb;
  v_team jsonb;
  v_channels jsonb;
  v_posts jsonb;
  v_ai jsonb;
  v_notes jsonb;
  v_audit jsonb;
  v_holds jsonb;
BEGIN
  SELECT id, name, slug, plan, plan_ends_at, timezone, require_second_approver, created_at
  INTO v_ws
  FROM public.tenants
  WHERE id = p_workspace_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object('id', u.id, 'email', u.email, 'displayName', u.display_name)
  INTO v_owner
  FROM public.tenant_memberships tm
  JOIN public.users u ON u.id = tm.user_id
  WHERE tm.tenant_id = p_workspace_id AND tm.role = 'owner'
  ORDER BY tm.created_at ASC
  LIMIT 1;

  SELECT jsonb_build_object('status', sc.status, 'method', sc.method, 'checkedAt', sc.checked_at)
  INTO v_student
  FROM public.student_checks sc
  WHERE sc.tenant_id = p_workspace_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'userId', u.id,
           'email', u.email,
           'displayName', u.display_name,
           'role', tm.role
         ) ORDER BY tm.created_at ASC), '[]'::jsonb)
  INTO v_team
  FROM public.tenant_memberships tm
  JOIN public.users u ON u.id = tm.user_id
  WHERE tm.tenant_id = p_workspace_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'provider', c.provider,
           'displayName', c.display_name,
           'externalAccountId', c.external_account_id,
           'scopes', c.scopes,
           'isActive', c.is_active,
           'tokenExpiresAt', c.token_expires_at
         ) ORDER BY c.created_at ASC), '[]'::jsonb)
  INTO v_channels
  FROM public.channels c
  WHERE c.tenant_id = p_workspace_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'title', p.title,
           'platforms', p.platforms,
           'state', p.state::text,
           'scheduledFor', p.scheduled_for,
           'publishedAt', p.published_at,
           'updatedAt', p.updated_at
         )), '[]'::jsonb)
  INTO v_posts
  FROM (
    SELECT id, title, platforms, state, scheduled_for, published_at, updated_at
    FROM public.posts
    WHERE tenant_id = p_workspace_id AND deleted_at IS NULL
    ORDER BY COALESCE(scheduled_for, updated_at) DESC
    LIMIT 20
  ) p;

  SELECT jsonb_build_object(
           'runsThisMonth', (
             SELECT count(*) FROM public.agent_runs ar
             WHERE ar.tenant_id = p_workspace_id
               AND ar.created_at >= date_trunc('month', now() AT TIME ZONE 'UTC')
           ),
           'costUsdThisMonth', (
             SELECT COALESCE(sum(cost_usd), 0)::float8 FROM public.agent_runs ar
             WHERE ar.tenant_id = p_workspace_id
               AND ar.created_at >= date_trunc('month', now() AT TIME ZONE 'UTC')
           ),
           'agentRunsLimit', COALESCE((SELECT agent_runs_limit FROM public.usage_caps WHERE tenant_id = p_workspace_id), 100)
         )
  INTO v_ai;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', n.id,
           'note', n.note,
           'staffName', u.display_name,
           'staffEmail', u.email,
           'createdAt', n.created_at
         ) ORDER BY n.created_at DESC), '[]'::jsonb)
  INTO v_notes
  FROM admin.workspace_notes n
  JOIN admin.staff_users u ON u.id = n.staff_user_id
  WHERE n.workspace_id = p_workspace_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', l.id,
           'staffEmail', l.staff_email,
           'action', l.action,
           'reason', l.reason,
           'outcome', l.outcome,
           'createdAt', l.created_at
         )), '[]'::jsonb)
  INTO v_audit
  FROM (
    SELECT id, staff_email, action, reason, outcome, created_at
    FROM admin.staff_audit_log
    WHERE workspace_id = p_workspace_id
    ORDER BY created_at DESC
    LIMIT 15
  ) l;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', h.id,
           'scope', h.scope,
           'channelId', h.channel_id,
           'internalReason', h.internal_reason,
           'customerMessage', h.customer_message,
           'createdBy', u.display_name,
           'createdAt', h.created_at
         ) ORDER BY h.created_at ASC), '[]'::jsonb)
  INTO v_holds
  FROM admin.publishing_holds h
  JOIN admin.staff_users u ON u.id = h.created_by
  WHERE h.released_at IS NULL
    AND (h.scope = 'global' OR h.workspace_id = p_workspace_id);

  RETURN jsonb_build_object(
    'id', v_ws.id,
    'name', v_ws.name,
    'slug', v_ws.slug,
    'plan', v_ws.plan,
    'planEndsAt', v_ws.plan_ends_at,
    'timezone', v_ws.timezone,
    'requireSecondApprover', v_ws.require_second_approver,
    'createdAt', v_ws.created_at,
    'owner', v_owner,
    'studentCheck', COALESCE(v_student, jsonb_build_object('status', 'none')),
    'team', v_team,
    'channels', v_channels,
    'posts', v_posts,
    'ai', v_ai,
    'notes', v_notes,
    'auditEvents', v_audit,
    'activeHolds', v_holds
  );
END;
$$;

-- Moves overdue scheduled posts back to 'approved' (scheduled_for = NULL) when a hold
-- is released, so resuming never triggers a burst of past-due posts.
CREATE FUNCTION admin.hold_overdue_posts_on_resume(
  p_scope text,
  p_workspace_id uuid,
  p_channel_id uuid
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, admin
AS $$
DECLARE
  v_count bigint;
BEGIN
  UPDATE public.posts p
  SET state = 'approved',
      scheduled_for = NULL,
      updated_at = now()
  WHERE p.state = 'scheduled'
    AND p.deleted_at IS NULL
    AND p.scheduled_for <= now()
    AND (
      p_scope = 'global'
      OR (p_scope = 'workspace' AND p.tenant_id = p_workspace_id)
      OR (p_scope = 'channel' AND p.tenant_id = p_workspace_id AND p.channel_id = p_channel_id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM admin.publishing_holds h
      WHERE h.released_at IS NULL
        AND (
          h.scope = 'global'
          OR (h.scope = 'workspace' AND h.workspace_id = p.tenant_id)
          OR (h.scope = 'channel' AND h.workspace_id = p.tenant_id AND h.channel_id = p.channel_id)
        )
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

ALTER FUNCTION admin.hold_overdue_posts_on_resume(text, uuid, uuid) OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.hold_overdue_posts_on_resume(text, uuid, uuid) FROM PUBLIC, brandbuild_app;
GRANT EXECUTE ON FUNCTION admin.hold_overdue_posts_on_resume(text, uuid, uuid) TO brandbuild_admin;

