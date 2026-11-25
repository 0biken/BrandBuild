-- Repair student review schema usage and explicitly grant later-created private tables.
GRANT SELECT, UPDATE ON public.student_submissions TO brandbuild_admin_definer;
ALTER TABLE public.student_submissions ADD COLUMN documents_purged_at timestamptz;
CREATE INDEX student_submissions_retention_idx ON public.student_submissions(reviewed_at)
  WHERE documents_purged_at IS NULL AND decision_status <> 'pending';
-- Existing ready rows were never scanned. Require a fresh submission.
UPDATE public.student_submissions SET scan_status='quarantine' WHERE scan_status='ready';
CREATE OR REPLACE FUNCTION admin.decide_student_review(
  p_submission_id uuid,
  p_expected_version int,
  p_decision text,
  p_reviewer_id uuid,
  p_checklist jsonb DEFAULT NULL,
  p_rejection_reason text DEFAULT NULL
)
RETURNS TABLE (
  outcome text,
  tenant_id uuid,
  applicant_email text,
  applicant_name text,
  plan_ends_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin, pg_temp
AS $$
DECLARE
  v_sub public.student_submissions%ROWTYPE;
  v_email text;
  v_ends timestamptz;
BEGIN
  SELECT * INTO v_sub FROM public.student_submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_sub.version <> p_expected_version OR v_sub.decision_status <> 'pending' THEN
    RETURN QUERY SELECT 'conflict'::text, v_sub.tenant_id, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_sub.scan_status <> 'ready' THEN
    RETURN QUERY SELECT 'not_ready'::text, v_sub.tenant_id, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT email INTO v_email FROM users WHERE id = v_sub.applicant_user_id;

  IF p_decision = 'approved' THEN
    IF p_checklist IS NULL OR NOT (p_checklist @> '{"nameMatches":true,"schoolRecognised":true,"expiryFutureDated":true,"genuineCard":true}'::jsonb) THEN
      RETURN QUERY SELECT 'invalid'::text, v_sub.tenant_id, NULL::text, NULL::text, NULL::timestamptz;
      RETURN;
    END IF;
    IF v_sub.card_expiry_date <= (now() AT TIME ZONE 'UTC')::date THEN
      RETURN QUERY SELECT 'expired_card'::text, v_sub.tenant_id, v_email, v_sub.applicant_name, NULL::timestamptz;
      RETURN;
    END IF;

    v_ends := LEAST(
      now() + interval '12 months',
      ((v_sub.card_expiry_date + 1)::timestamp AT TIME ZONE 'UTC')
    );

    UPDATE public.student_submissions
    SET decision_status = 'approved',
        reviewer_id = p_reviewer_id,
        reviewed_at = now(),
        checklist = p_checklist,
        version = version + 1
    WHERE id = p_submission_id;

    INSERT INTO student_checks (tenant_id, status, method, checked_at)
    VALUES (v_sub.tenant_id, 'verified', 'id', now())
    ON CONFLICT ON CONSTRAINT student_checks_pkey DO UPDATE SET
      status = 'verified',
      method = 'id',
      checked_at = now();

    UPDATE tenants AS t
    SET plan = 'student',
        plan_ends_at = v_ends, updated_at = now()
    WHERE t.id = v_sub.tenant_id
      AND t.plan <> 'business'
      AND (t.plan_paid_until IS NULL OR t.plan_paid_until <= now())
      AND (t.plan_ends_at IS NULL OR t.plan_ends_at < v_ends);

    RETURN QUERY SELECT 'approved'::text, v_sub.tenant_id, v_email, v_sub.applicant_name, v_ends;
  ELSIF p_decision = 'rejected' THEN
    IF p_rejection_reason IS NULL OR length(trim(p_rejection_reason)) = 0 THEN
      RETURN QUERY SELECT 'invalid'::text, v_sub.tenant_id, NULL::text, NULL::text, NULL::timestamptz;
      RETURN;
    END IF;
    UPDATE public.student_submissions
    SET decision_status = 'rejected',
        rejection_reason = p_rejection_reason,
        reviewer_id = p_reviewer_id,
        reviewed_at = now(),
        checklist = p_checklist,
        version = version + 1
    WHERE id = p_submission_id;

    INSERT INTO student_checks (tenant_id, status, method, checked_at)
    VALUES (v_sub.tenant_id, 'not_student', 'id', now())
    ON CONFLICT ON CONSTRAINT student_checks_pkey DO UPDATE SET
      status = 'not_student',
      method = 'id',
      checked_at = now();

    RETURN QUERY SELECT 'rejected'::text, v_sub.tenant_id, v_email, v_sub.applicant_name, NULL::timestamptz;
  ELSE
    RETURN QUERY SELECT 'invalid'::text, v_sub.tenant_id, NULL::text, NULL::text, NULL::timestamptz;
  END IF;
END;
$$;

ALTER FUNCTION admin.decide_student_review(uuid, int, text, uuid, jsonb, text) OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.decide_student_review(uuid, int, text, uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.decide_student_review(uuid, int, text, uuid, jsonb, text) TO brandbuild_admin;


CREATE OR REPLACE FUNCTION admin.student_documents_due_for_purge()
RETURNS TABLE(id uuid, file_storage_key text, preview_storage_key text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, admin
AS $$ SELECT s.id,s.file_storage_key,s.preview_storage_key
 FROM public.student_submissions s WHERE s.documents_purged_at IS NULL
 AND ((s.reviewed_at < now() - interval '30 days')
      OR (s.scan_status <> 'ready' AND s.created_at < now() - interval '7 days')
      OR (s.decision_status = 'pending' AND s.created_at < now() - interval '90 days'))
 ORDER BY s.created_at LIMIT 100 $$;
ALTER FUNCTION admin.student_documents_due_for_purge() OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.student_documents_due_for_purge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.student_documents_due_for_purge() TO brandbuild_admin;
CREATE OR REPLACE FUNCTION admin.mark_student_documents_purged(p_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, admin
AS $$ UPDATE public.student_submissions SET documents_purged_at=now(),scan_status='blocked',preview_storage_key=NULL WHERE id=p_id $$;
ALTER FUNCTION admin.mark_student_documents_purged(uuid) OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.mark_student_documents_purged(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.mark_student_documents_purged(uuid) TO brandbuild_admin;
