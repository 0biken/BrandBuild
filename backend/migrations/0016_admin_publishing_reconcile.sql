-- Milestone 7: Publishing worker lease fencing, receipts, reconciliation evidence,
-- and unclear-post resolution with optimistic concurrency & idempotency.

ALTER TABLE publish_attempts
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS fenced_at timestamptz,
  ADD COLUMN IF NOT EXISTS receipt jsonb,
  ADD COLUMN IF NOT EXISTS reconcile_evidence jsonb,
  ADD COLUMN IF NOT EXISTS escalated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES admin.staff_users(id),
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1;

CREATE TABLE admin.publish_resolution_idempotency (
  attempt_id uuid NOT NULL REFERENCES publish_attempts(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  action text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, idempotency_key)
);

REVOKE ALL ON admin.publish_resolution_idempotency FROM PUBLIC, brandbuild_app;

CREATE OR REPLACE FUNCTION admin.list_unclear_attempts(
  p_platform text DEFAULT NULL,
  p_workspace_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin, pg_temp
AS $$
DECLARE
  v_items jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(q)), '[]'::jsonb) INTO v_items
  FROM (
    SELECT
      pa.id,
      pa.tenant_id AS "tenantId",
      t.name AS "workspaceName",
      pa.post_id AS "postId",
      COALESCE(p.title, '') AS "postTitle",
      p.platforms,
      pa.post_version_id AS "postVersionId",
      pv.version AS "approvedVersion",
      pv.content AS "approvedContent",
      pa.channel_id AS "channelId",
      c.provider AS "channelProvider",
      c.display_name AS "channelName",
      pa.attempt_no AS "attemptNo",
      pa.state::text AS state,
      pa.platform_post_id AS "platformPostId",
      pa.response,
      pa.receipt,
      pa.reconcile_evidence AS "reconcileEvidence",
      pa.worker_id AS "workerId",
      pa.fenced_at AS "fencedAt",
      pa.escalated,
      pa.error,
      pa.version,
      pa.started_at AS "startedAt",
      pa.finished_at AS "finishedAt",
      pa.created_at AS "createdAt"
    FROM publish_attempts pa
    JOIN tenants t ON t.id = pa.tenant_id
    JOIN posts p ON p.id = pa.post_id
    JOIN post_versions pv ON pv.id = pa.post_version_id
    LEFT JOIN channels c ON c.id = pa.channel_id
    WHERE (pa.state = 'unknown' OR (pa.escalated = true AND pa.resolved_at IS NULL))
      AND (p_workspace_id IS NULL OR pa.tenant_id = p_workspace_id)
      AND (p_platform IS NULL OR c.provider = p_platform OR p_platform = ANY(p.platforms))
    ORDER BY pa.created_at ASC
    LIMIT 100
  ) q;
  RETURN v_items;
END;
$$;

ALTER FUNCTION admin.list_unclear_attempts(text, uuid) OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.list_unclear_attempts(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.list_unclear_attempts(text, uuid) TO brandbuild_admin;

CREATE OR REPLACE FUNCTION admin.save_reconcile_evidence(
  p_attempt_id uuid,
  p_evidence jsonb,
  p_receipt jsonb DEFAULT NULL,
  p_platform_post_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin, pg_temp
AS $$
DECLARE
  v_row publish_attempts%ROWTYPE;
BEGIN
  UPDATE publish_attempts
  SET reconcile_evidence = p_evidence,
      receipt = COALESCE(p_receipt, receipt),
      platform_post_id = COALESCE(p_platform_post_id, platform_post_id),
      version = version + 1
  WHERE id = p_attempt_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'tenantId', v_row.tenant_id,
    'version', v_row.version,
    'reconcileEvidence', v_row.reconcile_evidence,
    'receipt', v_row.receipt,
    'platformPostId', v_row.platform_post_id
  );
END;
$$;

ALTER FUNCTION admin.save_reconcile_evidence(uuid, jsonb, jsonb, text) OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.save_reconcile_evidence(uuid, jsonb, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.save_reconcile_evidence(uuid, jsonb, jsonb, text) TO brandbuild_admin;

CREATE OR REPLACE FUNCTION admin.resolve_publish_attempt(
  p_attempt_id uuid,
  p_expected_version int,
  p_idempotency_key text,
  p_action text,
  p_staff_id uuid,
  p_note text,
  p_receipt jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin, pg_temp
AS $$
DECLARE
  v_existing jsonb;
  v_pa publish_attempts%ROWTYPE;
  v_new_attempt_id uuid;
  v_res jsonb;
BEGIN
  SELECT result INTO v_existing
  FROM admin.publish_resolution_idempotency
  WHERE attempt_id = p_attempt_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN v_existing || jsonb_build_object('idempotentReplay', true);
  END IF;

  SELECT * INTO v_pa FROM publish_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_pa.version <> p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'conflict');
  END IF;

  IF v_pa.state NOT IN ('unknown', 'running', 'queued') AND p_action <> 'escalate' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'conflict');
  END IF;

  IF p_action = 'confirm_published' THEN
    IF p_receipt IS NULL AND v_pa.receipt IS NULL AND v_pa.platform_post_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'missing_receipt');
    END IF;

    UPDATE publish_attempts
    SET state = 'succeeded',
        receipt = COALESCE(p_receipt, receipt),
        resolved_by = p_staff_id,
        resolved_at = now(),
        resolution_note = p_note,
        finished_at = COALESCE(finished_at, now()),
        version = version + 1
    WHERE id = p_attempt_id;

    UPDATE posts
    SET state = 'published',
        published_at = COALESCE(published_at, now()),
        updated_at = now()
    WHERE id = v_pa.post_id AND tenant_id = v_pa.tenant_id;

    v_res := jsonb_build_object('ok', true, 'action', 'confirm_published', 'tenantId', v_pa.tenant_id, 'state', 'succeeded');

  ELSIF p_action = 'mark_failed' THEN
    UPDATE publish_attempts
    SET state = 'failed',
        error = p_note,
        resolved_by = p_staff_id,
        resolved_at = now(),
        resolution_note = p_note,
        finished_at = COALESCE(finished_at, now()),
        version = version + 1
    WHERE id = p_attempt_id;

    UPDATE posts
    SET state = 'failed',
        updated_at = now()
    WHERE id = v_pa.post_id AND tenant_id = v_pa.tenant_id;

    v_res := jsonb_build_object('ok', true, 'action', 'mark_failed', 'tenantId', v_pa.tenant_id, 'state', 'failed');

  ELSIF p_action = 'retry' THEN
    IF COALESCE((v_pa.reconcile_evidence->>'retryEligible')::boolean, false) IS NOT TRUE THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'retry_not_confirmed');
    END IF;

    UPDATE publish_attempts
    SET state = 'failed',
        fenced_at = now(),
        resolved_by = p_staff_id,
        resolved_at = now(),
        resolution_note = p_note,
        finished_at = COALESCE(finished_at, now()),
        version = version + 1
    WHERE id = p_attempt_id;

    INSERT INTO publish_attempts (
      tenant_id, post_id, post_version_id, channel_id, idempotency_key, state, attempt_no
    ) VALUES (
      v_pa.tenant_id,
      v_pa.post_id,
      v_pa.post_version_id,
      v_pa.channel_id,
      format('%s:retry:%s', v_pa.idempotency_key, v_pa.attempt_no + 1),
      'queued',
      v_pa.attempt_no + 1
    ) RETURNING id INTO v_new_attempt_id;

    UPDATE posts SET state = 'publishing', updated_at = now()
    WHERE id = v_pa.post_id AND tenant_id = v_pa.tenant_id;

    INSERT INTO outbox_events (tenant_id, topic, payload)
    VALUES (
      v_pa.tenant_id,
      'post.publish',
      jsonb_build_object('attempt_id', v_new_attempt_id, 'post_id', v_pa.post_id)
    );

    v_res := jsonb_build_object(
      'ok', true,
      'action', 'retry',
      'tenantId', v_pa.tenant_id,
      'newAttemptId', v_new_attempt_id
    );

  ELSIF p_action = 'escalate' THEN
    UPDATE publish_attempts
    SET escalated = true,
        resolution_note = p_note,
        version = version + 1
    WHERE id = p_attempt_id;

    v_res := jsonb_build_object('ok', true, 'action', 'escalate', 'tenantId', v_pa.tenant_id);
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_action');
  END IF;

  INSERT INTO admin.publish_resolution_idempotency (attempt_id, idempotency_key, action, result)
  VALUES (p_attempt_id, p_idempotency_key, p_action, v_res);

  RETURN v_res;
END;
$$;

ALTER FUNCTION admin.resolve_publish_attempt(uuid, int, text, text, uuid, text, jsonb) OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.resolve_publish_attempt(uuid, int, text, text, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.resolve_publish_attempt(uuid, int, text, text, uuid, text, jsonb) TO brandbuild_admin;
