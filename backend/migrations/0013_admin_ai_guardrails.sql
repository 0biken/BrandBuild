-- Milestone 4: AI spending guardrails, atomic reservations, uncertain timeout billing,
-- and admin AI spend summary.

ALTER TABLE agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_status_known,
  ADD CONSTRAINT agent_runs_status_known CHECK (status IN (
    'queued', 'context_loading', 'planning', 'generating', 'validating',
    'awaiting_review', 'failed', 'canceled', 'succeeded', 'running', 'uncertain')),
  ADD COLUMN IF NOT EXISTS pricing_version text NOT NULL DEFAULT 'v1';

CREATE TABLE admin.ai_policies (
  id int PRIMARY KEY CHECK (id = 1),
  global_daily_usd_budget numeric(10, 4) NOT NULL DEFAULT 50.0000 CHECK (global_daily_usd_budget >= 0),
  default_workspace_monthly_usd_budget numeric(10, 4) NOT NULL DEFAULT 5.0000 CHECK (default_workspace_monthly_usd_budget >= 0),
  default_workspace_daily_gen_limit int NOT NULL DEFAULT 25 CHECK (default_workspace_daily_gen_limit >= 0),
  alert_warn_pct int NOT NULL DEFAULT 80 CHECK (alert_warn_pct BETWEEN 1 AND 100),
  alert_hard_pct int NOT NULL DEFAULT 100 CHECK (alert_hard_pct BETWEEN 1 AND 100),
  updated_by uuid REFERENCES admin.staff_users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO admin.ai_policies (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE admin.workspace_ai_controls (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  monthly_usd_budget numeric(10, 4) CHECK (monthly_usd_budget IS NULL OR monthly_usd_budget >= 0),
  daily_gen_limit int CHECK (daily_gen_limit IS NULL OR daily_gen_limit >= 0),
  suspended_until timestamptz,
  suspension_reason text,
  updated_by uuid REFERENCES admin.staff_users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin.ai_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_run_id uuid,
  kind text NOT NULL CHECK (kind IN ('plan', 'generate')),
  model text NOT NULL,
  pricing_version text NOT NULL DEFAULT 'v1',
  reserved_usd numeric(10, 4) NOT NULL CHECK (reserved_usd >= 0),
  settled_usd numeric(10, 4) CHECK (settled_usd IS NULL OR settled_usd >= 0),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'settled', 'uncertain', 'released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

CREATE INDEX ai_reservations_created_idx ON admin.ai_reservations (created_at DESC);
CREATE INDEX ai_reservations_tenant_created_idx ON admin.ai_reservations (tenant_id, created_at DESC);
CREATE INDEX ai_reservations_status_idx ON admin.ai_reservations (status);

REVOKE ALL ON admin.ai_policies, admin.workspace_ai_controls, admin.ai_reservations FROM PUBLIC, brandbuild_app;

-- Atomically checks global + workspace caps and reserves the max permitted charge.
CREATE OR REPLACE FUNCTION admin.reserve_ai_budget(
  p_tenant_id uuid,
  p_kind text,
  p_model text,
  p_pricing_version text,
  p_max_usd numeric
)
RETURNS TABLE (
  allowed boolean,
  reservation_id uuid,
  denial_reason text,
  global_pct int,
  workspace_pct int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin, pg_temp
AS $$
DECLARE
  v_pol admin.ai_policies%ROWTYPE;
  v_ctl admin.workspace_ai_controls%ROWTYPE;
  v_utc_day_start timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_utc_month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_global_used numeric(12, 4);
  v_ws_month_used numeric(12, 4);
  v_ws_day_runs bigint;
  v_ws_month_runs bigint;
  v_ws_run_limit bigint;
  v_ws_month_budget numeric(10, 4);
  v_ws_daily_limit int;
  v_res_id uuid;
  v_gpct int := 0;
  v_wpct int := 0;
BEGIN
  -- Serialize budget checks against the singleton policy row so concurrent requests
  -- cannot overshoot global or workspace caps.
  SELECT * INTO v_pol FROM admin.ai_policies WHERE id = 1 FOR UPDATE;

  SELECT * INTO v_ctl FROM admin.workspace_ai_controls WHERE tenant_id = p_tenant_id;
  IF FOUND AND v_ctl.suspended_until IS NOT NULL AND v_ctl.suspended_until > now() THEN
    RETURN QUERY SELECT false, NULL::uuid, 'workspace_suspended'::text, 0, 0;
    RETURN;
  END IF;

  v_ws_month_budget := COALESCE(v_ctl.monthly_usd_budget, v_pol.default_workspace_monthly_usd_budget);
  v_ws_daily_limit := COALESCE(v_ctl.daily_gen_limit, v_pol.default_workspace_daily_gen_limit);

  SELECT COALESCE(SUM(
    CASE
      WHEN status = 'reserved' THEN reserved_usd
      WHEN status IN ('settled', 'uncertain') THEN COALESCE(settled_usd, reserved_usd)
      ELSE 0
    END
  ), 0) INTO v_global_used
  FROM admin.ai_reservations
  WHERE created_at >= v_utc_day_start
    AND status IN ('reserved', 'settled', 'uncertain');

  IF v_pol.global_daily_usd_budget > 0 THEN
    v_gpct := LEAST(999, ROUND(((v_global_used + p_max_usd) / v_pol.global_daily_usd_budget) * 100)::int);
  END IF;

  IF v_global_used + p_max_usd > v_pol.global_daily_usd_budget THEN
    RETURN QUERY SELECT false, NULL::uuid, 'global_daily_budget'::text, v_gpct, 0;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(
    CASE
      WHEN status = 'reserved' THEN reserved_usd
      WHEN status IN ('settled', 'uncertain') THEN COALESCE(settled_usd, reserved_usd)
      ELSE 0
    END
  ), 0) INTO v_ws_month_used
  FROM admin.ai_reservations
  WHERE tenant_id = p_tenant_id
    AND created_at >= v_utc_month_start
    AND status IN ('reserved', 'settled', 'uncertain');

  IF v_ws_month_budget > 0 THEN
    v_wpct := LEAST(999, ROUND(((v_ws_month_used + p_max_usd) / v_ws_month_budget) * 100)::int);
  END IF;

  IF v_ws_month_used + p_max_usd > v_ws_month_budget THEN
    RETURN QUERY SELECT false, NULL::uuid, 'workspace_monthly_budget'::text, v_gpct, v_wpct;
    RETURN;
  END IF;

  SELECT count(*) INTO v_ws_day_runs
  FROM agent_runs
  WHERE tenant_id = p_tenant_id AND created_at >= v_utc_day_start;

  IF v_ws_day_runs >= v_ws_daily_limit THEN
    RETURN QUERY SELECT false, NULL::uuid, 'workspace_daily_limit'::text, v_gpct, v_wpct;
    RETURN;
  END IF;

  SELECT count(*), COALESCE((SELECT agent_runs_limit FROM usage_caps WHERE tenant_id = p_tenant_id), 100)::bigint
  INTO v_ws_month_runs, v_ws_run_limit
  FROM agent_runs
  WHERE tenant_id = p_tenant_id AND created_at >= v_utc_month_start;

  IF v_ws_month_runs >= v_ws_run_limit THEN
    RETURN QUERY SELECT false, NULL::uuid, 'workspace_monthly_runs'::text, v_gpct, v_wpct;
    RETURN;
  END IF;

  INSERT INTO admin.ai_reservations (tenant_id, kind, model, pricing_version, reserved_usd, status)
  VALUES (p_tenant_id, p_kind, p_model, p_pricing_version, p_max_usd, 'reserved')
  RETURNING id INTO v_res_id;

  RETURN QUERY SELECT true, v_res_id, NULL::text, v_gpct, v_wpct;
END;
$$;

ALTER FUNCTION admin.reserve_ai_budget(uuid, text, text, text, numeric) OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.reserve_ai_budget(uuid, text, text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.reserve_ai_budget(uuid, text, text, text, numeric) TO brandbuild_app, brandbuild_admin;

CREATE OR REPLACE FUNCTION admin.settle_ai_reservation(
  p_reservation_id uuid,
  p_status text,
  p_settled_usd numeric,
  p_agent_run_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin, pg_temp
AS $$
BEGIN
  UPDATE admin.ai_reservations
  SET status = p_status,
      settled_usd = p_settled_usd,
      agent_run_id = COALESCE(p_agent_run_id, agent_run_id),
      settled_at = now()
  WHERE id = p_reservation_id;
END;
$$;

ALTER FUNCTION admin.settle_ai_reservation(uuid, text, numeric, uuid) OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.settle_ai_reservation(uuid, text, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.settle_ai_reservation(uuid, text, numeric, uuid) TO brandbuild_app, brandbuild_admin;

CREATE OR REPLACE FUNCTION admin.ai_spend_summary(p_days int DEFAULT 14)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin, pg_temp
AS $$
DECLARE
  v_utc_day_start timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_utc_month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_pol jsonb;
  v_today jsonb;
  v_month jsonb;
  v_daily jsonb;
  v_by_feature jsonb;
  v_top_workspaces jsonb;
  v_uncertain jsonb;
BEGIN
  SELECT jsonb_build_object(
    'globalDailyUsdBudget', global_daily_usd_budget::float8,
    'defaultWorkspaceMonthlyUsdBudget', default_workspace_monthly_usd_budget::float8,
    'defaultWorkspaceDailyGenLimit', default_workspace_daily_gen_limit,
    'alertWarnPct', alert_warn_pct,
    'alertHardPct', alert_hard_pct
  ) INTO v_pol FROM admin.ai_policies WHERE id = 1;

  SELECT jsonb_build_object(
    'costUsd', COALESCE((
      SELECT SUM(CASE WHEN status='reserved' THEN reserved_usd WHEN status IN ('settled','uncertain') THEN COALESCE(settled_usd, reserved_usd) ELSE 0 END)::float8
      FROM admin.ai_reservations WHERE created_at >= v_utc_day_start
    ), 0),
    'reservedUsd', COALESCE((
      SELECT SUM(reserved_usd)::float8 FROM admin.ai_reservations WHERE created_at >= v_utc_day_start AND status = 'reserved'
    ), 0),
    'uncertainUsd', COALESCE((
      SELECT SUM(COALESCE(settled_usd, reserved_usd))::float8 FROM admin.ai_reservations WHERE created_at >= v_utc_day_start AND status = 'uncertain'
    ), 0),
    'runs', (SELECT count(*) FROM agent_runs WHERE created_at >= v_utc_day_start),
    'failedButBilledRuns', (SELECT count(*) FROM agent_runs WHERE created_at >= v_utc_day_start AND status = 'uncertain')
  ) INTO v_today;

  SELECT jsonb_build_object(
    'costUsd', COALESCE((
      SELECT SUM(CASE WHEN status='reserved' THEN reserved_usd WHEN status IN ('settled','uncertain') THEN COALESCE(settled_usd, reserved_usd) ELSE 0 END)::float8
      FROM admin.ai_reservations WHERE created_at >= v_utc_month_start
    ), 0),
    'runs', (SELECT count(*) FROM agent_runs WHERE created_at >= v_utc_month_start),
    'failedButBilledRuns', (SELECT count(*) FROM agent_runs WHERE created_at >= v_utc_month_start AND status = 'uncertain')
  ) INTO v_month;

  SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.day), '[]'::jsonb) INTO v_daily
  FROM (
    SELECT
      to_char(gs.day, 'YYYY-MM-DD') AS day,
      COALESCE((
        SELECT SUM(CASE WHEN r.status='reserved' THEN r.reserved_usd WHEN r.status IN ('settled','uncertain') THEN COALESCE(r.settled_usd, r.reserved_usd) ELSE 0 END)::float8
        FROM admin.ai_reservations r
        WHERE (r.created_at AT TIME ZONE 'UTC')::date = gs.day
      ), 0) AS "costUsd",
      (SELECT count(*) FROM agent_runs a WHERE (a.created_at AT TIME ZONE 'UTC')::date = gs.day) AS runs,
      (SELECT count(*) FROM agent_runs a WHERE (a.created_at AT TIME ZONE 'UTC')::date = gs.day AND a.status IN ('failed', 'uncertain')) AS "failedRuns"
    FROM generate_series(
      (now() AT TIME ZONE 'UTC')::date - (GREATEST(1, p_days) - 1),
      (now() AT TIME ZONE 'UTC')::date,
      interval '1 day'
    ) AS gs(day)
  ) d;

  SELECT COALESCE(jsonb_agg(row_to_json(f)), '[]'::jsonb) INTO v_by_feature
  FROM (
    SELECT
      CASE
        WHEN kind = 'plan' THEN 'plan'
        WHEN COALESCE(input->>'tweak', '') <> '' THEN 'tweak'
        ELSE 'generate'
      END AS feature,
      count(*) AS runs,
      COALESCE(SUM(cost_usd), 0)::float8 AS "costUsd"
    FROM agent_runs
    WHERE created_at >= v_utc_month_start
    GROUP BY 1
    ORDER BY 3 DESC
  ) f;

  SELECT COALESCE(jsonb_agg(row_to_json(w)), '[]'::jsonb) INTO v_top_workspaces
  FROM (
    SELECT
      t.id,
      t.name,
      t.plan,
      COUNT(a.id) AS runs,
      COALESCE((
        SELECT SUM(CASE WHEN r.status='reserved' THEN r.reserved_usd WHEN r.status IN ('settled','uncertain') THEN COALESCE(r.settled_usd, r.reserved_usd) ELSE 0 END)::float8
        FROM admin.ai_reservations r
        WHERE r.tenant_id = t.id AND r.created_at >= v_utc_month_start
      ), 0) AS "costUsd",
      COALESCE(c.monthly_usd_budget, (SELECT default_workspace_monthly_usd_budget FROM admin.ai_policies WHERE id = 1))::float8 AS "monthlyBudgetUsd",
      COALESCE(c.daily_gen_limit, (SELECT default_workspace_daily_gen_limit FROM admin.ai_policies WHERE id = 1)) AS "dailyGenLimit",
      c.suspended_until AS "suspendedUntil",
      c.suspension_reason AS "suspensionReason"
    FROM tenants t
    LEFT JOIN agent_runs a ON a.tenant_id = t.id AND a.created_at >= v_utc_month_start
    LEFT JOIN admin.workspace_ai_controls c ON c.tenant_id = t.id
    GROUP BY t.id, t.name, t.plan, c.monthly_usd_budget, c.daily_gen_limit, c.suspended_until, c.suspension_reason
    ORDER BY "costUsd" DESC, runs DESC
    LIMIT 20
  ) w;

  SELECT COALESCE(jsonb_agg(row_to_json(u)), '[]'::jsonb) INTO v_uncertain
  FROM (
    SELECT
      r.id,
      r.tenant_id AS "tenantId",
      t.name AS "workspaceName",
      r.kind,
      r.model,
      r.reserved_usd::float8 AS "reservedUsd",
      r.settled_usd::float8 AS "settledUsd",
      r.status,
      r.created_at AS "createdAt"
    FROM admin.ai_reservations r
    JOIN tenants t ON t.id = r.tenant_id
    WHERE r.status = 'uncertain'
    ORDER BY r.created_at DESC
    LIMIT 25
  ) u;

  RETURN jsonb_build_object(
    'generatedAt', now(),
    'policy', v_pol,
    'today', v_today,
    'month', v_month,
    'daily', v_daily,
    'byFeature', v_by_feature,
    'topWorkspaces', v_top_workspaces,
    'uncertainRuns', v_uncertain
  );
END;
$$;

ALTER FUNCTION admin.ai_spend_summary(int) OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.ai_spend_summary(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.ai_spend_summary(int) TO brandbuild_admin;
