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
  SELECT * INTO v_pa FROM publish_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF EXISTS (SELECT 1 FROM admin.publish_resolution_idempotency WHERE attempt_id=p_attempt_id
    AND idempotency_key=p_idempotency_key AND action<>p_action) THEN
    RETURN jsonb_build_object('ok',false,'reason','conflict');
  END IF;
  SELECT result INTO v_existing
  FROM admin.publish_resolution_idempotency
  WHERE attempt_id = p_attempt_id AND idempotency_key = p_idempotency_key AND action = p_action;
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

  IF v_pa.resolved_at IS NOT NULL OR v_pa.state NOT IN ('unknown', 'running', 'queued') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'conflict');
  END IF;

  IF p_action = 'confirm_published' THEN
    IF v_pa.reconcile_evidence->>'status' IS DISTINCT FROM 'confirmed_published' OR NULLIF(btrim(v_pa.platform_post_id), '') IS NULL OR v_pa.receipt IS NULL OR v_pa.receipt = 'null'::jsonb OR v_pa.reconcile_evidence->>'platformPostId' IS DISTINCT FROM v_pa.platform_post_id THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'missing_receipt');
    END IF;

    UPDATE publish_attempts
    SET state = 'succeeded',
        receipt = receipt,
        fenced_at = COALESCE(fenced_at, now()),
        lease_token = NULL,
        resolved_by = p_staff_id,
        resolved_at = now(),
        resolution_note = p_note,
        finished_at = COALESCE(finished_at, now()),
        version = version + 1
    WHERE id = p_attempt_id;

    UPDATE posts
    SET state = 'published',
        platform_post_id = v_pa.platform_post_id,
        published_at = COALESCE(published_at, now()),
        updated_at = now()
    WHERE id = v_pa.post_id AND tenant_id = v_pa.tenant_id;

    v_res := jsonb_build_object('ok', true, 'action', 'confirm_published', 'tenantId', v_pa.tenant_id, 'state', 'succeeded');

  ELSIF p_action = 'mark_failed' THEN
    IF v_pa.reconcile_evidence->>'status' IS DISTINCT FROM 'confirmed_not_published' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'failure_not_confirmed');
    END IF;
    UPDATE publish_attempts
    SET state = 'failed',
        error = p_note,
        fenced_at = COALESCE(fenced_at, now()),
        lease_token = NULL,
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
    -- A local fence cannot cancel a remote request. Retry only after the original
    -- connector has actually returned an unknown outcome and released its lease.
    IF v_pa.state <> 'unknown' OR v_pa.finished_at IS NULL OR v_pa.lease_token IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'submission_not_terminal');
    END IF;
    IF v_pa.reconcile_evidence->>'status' IS DISTINCT FROM 'confirmed_not_published' OR v_pa.reconcile_evidence->'retryEligible' IS DISTINCT FROM 'true'::jsonb THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'retry_not_confirmed');
    END IF;

    UPDATE publish_attempts
    SET state = 'failed',

        fenced_at = COALESCE(fenced_at, now()),
        lease_token = NULL,
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

    INSERT INTO outbox (tenant_id, topic, payload)
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
        fenced_at = COALESCE(fenced_at, now()),
        lease_token = NULL,
        state = 'unknown',
        resolution_note = p_note,
        version = version + 1
    WHERE id = p_attempt_id;

    UPDATE posts SET state = 'reconciling', updated_at = now() WHERE id = v_pa.post_id AND tenant_id = v_pa.tenant_id AND state = 'publishing';
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


