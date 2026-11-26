-- Admin Console Milestone 2: staff-only workspace notes and locked-down
-- SECURITY DEFINER functions for cross-workspace overview and workspace search/detail.

CREATE TABLE admin.workspace_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  staff_user_id uuid NOT NULL REFERENCES admin.staff_users(id) ON DELETE RESTRICT,
  note text NOT NULL CHECK (length(trim(note)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_notes_ws_idx ON admin.workspace_notes(workspace_id, created_at DESC);

GRANT SELECT, INSERT ON admin.workspace_notes TO brandbuild_admin;
REVOKE ALL ON admin.workspace_notes FROM brandbuild_app;

-- Cross-workspace overview summary (owned by brandbuild_admin_definer with BYPASSRLS).
CREATE FUNCTION admin.overview_summary() RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, admin
AS $$
DECLARE
  v_unclear_count bigint;
  v_unclear_oldest double precision;
  v_student_count bigint;
  v_student_oldest double precision;
  v_failed_today bigint;
  v_total_today bigint;
  v_platforms jsonb;
  v_ai_runs bigint;
  v_ai_cost double precision;
  v_top_ws jsonb;
  v_recent_actions jsonb;
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

  RETURN jsonb_build_object(
    'generatedAt', now(),
    'unclear', jsonb_build_object('count', v_unclear_count, 'oldestMinutes', v_unclear_oldest),
    'studentReviews', jsonb_build_object('count', v_student_count, 'oldestMinutes', v_student_oldest),
    'pausedWorkspaces', jsonb_build_object('count', 0),
    'failedToday', jsonb_build_object('failed', v_failed_today, 'total', v_total_today),
    'platforms', v_platforms,
    'aiToday', jsonb_build_object('runs', v_ai_runs, 'costUsd', v_ai_cost, 'topWorkspace', v_top_ws),
    'recentActions', v_recent_actions
  );
END;
$$;

ALTER FUNCTION admin.overview_summary() OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.overview_summary() FROM PUBLIC, brandbuild_app;
GRANT EXECUTE ON FUNCTION admin.overview_summary() TO brandbuild_admin;

-- Paginated workspace search across tenants, owner emails, workspace ID, and exact post ID.
CREATE FUNCTION admin.search_workspaces(
  p_query text,
  p_plan text,
  p_limit int,
  p_offset int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, admin
AS $$
DECLARE
  v_q text := NULLIF(trim(COALESCE(p_query, '')), '');
  v_plan text := NULLIF(trim(COALESCE(p_plan, '')), '');
  v_limit int := GREATEST(1, LEAST(COALESCE(p_limit, 25), 100));
  v_offset int := GREATEST(0, COALESCE(p_offset, 0));
  v_total bigint;
  v_items jsonb;
BEGIN
  WITH matched AS (
    SELECT t.id, t.name, t.slug, t.plan, t.plan_ends_at, t.created_at,
           owner_u.email AS owner_email,
           owner_u.display_name AS owner_name,
           (SELECT count(*) FROM public.channels c WHERE c.tenant_id = t.id AND c.is_active) AS active_channels,
           (SELECT count(*) FROM public.posts p WHERE p.tenant_id = t.id AND p.deleted_at IS NULL AND p.state = 'reconciling') AS unclear_posts,
           (SELECT count(*) FROM public.posts p WHERE p.tenant_id = t.id AND p.deleted_at IS NULL AND p.state = 'failed' AND p.updated_at >= now() - interval '7 days') AS failed_posts_7d
    FROM public.tenants t
    LEFT JOIN LATERAL (
      SELECT u.email, u.display_name
      FROM public.tenant_memberships tm
      JOIN public.users u ON u.id = tm.user_id
      WHERE tm.tenant_id = t.id AND tm.role = 'owner'
      ORDER BY tm.created_at ASC
      LIMIT 1
    ) owner_u ON true
    WHERE (v_plan IS NULL OR t.plan = v_plan)
      AND (
        v_q IS NULL
        OR t.name ILIKE '%' || v_q || '%'
        OR t.slug ILIKE '%' || v_q || '%'
        OR t.id::text = v_q
        OR EXISTS (
          SELECT 1
          FROM public.tenant_memberships tm2
          JOIN public.users u2 ON u2.id = tm2.user_id
          WHERE tm2.tenant_id = t.id AND u2.email ILIKE '%' || v_q || '%'
        )
        OR EXISTS (
          SELECT 1
          FROM public.posts p2
          WHERE p2.tenant_id = t.id AND p2.id::text = v_q
        )
      )
  )
  SELECT (SELECT count(*) FROM matched),
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'id', m.id,
             'name', m.name,
             'slug', m.slug,
             'plan', m.plan,
             'planEndsAt', m.plan_ends_at,
             'ownerEmail', m.owner_email,
             'ownerName', m.owner_name,
             'activeChannels', m.active_channels,
             'unclearPosts', m.unclear_posts,
             'failedPosts7d', m.failed_posts_7d,
             'createdAt', m.created_at
           ))
           FROM (
             SELECT * FROM matched
             ORDER BY created_at DESC, id DESC
             LIMIT v_limit OFFSET v_offset
           ) m
         ), '[]'::jsonb)
  INTO v_total, v_items;

  RETURN jsonb_build_object('total', v_total, 'items', v_items);
END;
$$;

ALTER FUNCTION admin.search_workspaces(text, text, int, int) OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.search_workspaces(text, text, int, int) FROM PUBLIC, brandbuild_app;
GRANT EXECUTE ON FUNCTION admin.search_workspaces(text, text, int, int) TO brandbuild_admin;

-- Detailed operational view for one workspace (excludes credentials_ciphertext and draft bodies).
CREATE FUNCTION admin.workspace_detail(p_workspace_id uuid) RETURNS jsonb
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
    'auditEvents', v_audit
  );
END;
$$;

ALTER FUNCTION admin.workspace_detail(uuid) OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.workspace_detail(uuid) FROM PUBLIC, brandbuild_app;
GRANT EXECUTE ON FUNCTION admin.workspace_detail(uuid) TO brandbuild_admin;
