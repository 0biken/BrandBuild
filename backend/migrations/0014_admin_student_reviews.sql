-- Milestone 5: Private student-ID submissions, review decisions, and entitlement expiry.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS plan_paid_until timestamptz;

CREATE TABLE public.student_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  applicant_user_id uuid NOT NULL REFERENCES users(id),
  applicant_name text NOT NULL CHECK (length(trim(applicant_name)) BETWEEN 1 AND 200),
  school text NOT NULL CHECK (length(trim(school)) BETWEEN 1 AND 200),
  card_expiry_date date NOT NULL,
  file_storage_key text NOT NULL,
  preview_storage_key text,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  file_size_bytes int NOT NULL CHECK (file_size_bytes BETWEEN 1 AND 10485760),
  scan_status text NOT NULL DEFAULT 'quarantine' CHECK (scan_status IN ('quarantine', 'ready', 'blocked')),
  decision_status text NOT NULL DEFAULT 'pending' CHECK (decision_status IN ('pending', 'approved', 'rejected')),
  reviewer_id uuid REFERENCES admin.staff_users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  checklist jsonb,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX student_submissions_queue_idx
  ON public.student_submissions (decision_status, scan_status, created_at ASC);
CREATE INDEX student_submissions_tenant_idx
  ON public.student_submissions (tenant_id, created_at DESC);

ALTER TABLE public.student_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_submissions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.student_submissions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

REVOKE ALL ON public.student_submissions FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.student_submissions TO brandbuild_app;

CREATE OR REPLACE FUNCTION admin.list_student_reviews(p_status text DEFAULT 'pending')
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
      s.id,
      s.tenant_id AS "tenantId",
      t.name AS "workspaceName",
      u.email AS "ownerEmail",
      s.applicant_name AS "applicantName",
      s.school,
      s.card_expiry_date AS "cardExpiryDate",
      s.mime_type AS "mimeType",
      s.file_size_bytes AS "fileSizeBytes",
      s.scan_status AS "scanStatus",
      s.decision_status AS "decisionStatus",
      s.rejection_reason AS "rejectionReason",
      s.version,
      (s.preview_storage_key IS NOT NULL OR s.mime_type IN ('image/jpeg', 'image/png')) AS "previewReady",
      s.created_at AS "createdAt",
      s.reviewed_at AS "reviewedAt"
    FROM public.student_submissions s
    JOIN tenants t ON t.id = s.tenant_id
    JOIN users u ON u.id = s.applicant_user_id
    WHERE (p_status = 'all' OR s.decision_status = p_status)
    ORDER BY
      CASE WHEN s.decision_status = 'pending' THEN 0 ELSE 1 END,
      s.created_at ASC
    LIMIT 100
  ) q;
  RETURN v_items;
END;
$$;

ALTER FUNCTION admin.list_student_reviews(text) OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.list_student_reviews(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.list_student_reviews(text) TO brandbuild_admin;

CREATE OR REPLACE FUNCTION admin.get_student_review_storage(p_submission_id uuid)
RETURNS TABLE (
  tenant_id uuid,
  file_storage_key text,
  preview_storage_key text,
  mime_type text,
  scan_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT s.tenant_id, s.file_storage_key, s.preview_storage_key, s.mime_type, s.scan_status
  FROM public.student_submissions s
  WHERE s.id = p_submission_id;
END;
$$;

ALTER FUNCTION admin.get_student_review_storage(uuid) OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.get_student_review_storage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.get_student_review_storage(uuid) TO brandbuild_admin;

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
    IF v_sub.card_expiry_date <= (now() AT TIME ZONE 'UTC')::date THEN
      RETURN QUERY SELECT 'expired_card'::text, v_sub.tenant_id, v_email, v_sub.applicant_name, NULL::timestamptz;
      RETURN;
    END IF;

    v_ends := LEAST(
      now() + interval '12 months',
      (v_sub.card_expiry_date + interval '1 day')::timestamptz
    );

    UPDATE public.student_submissions
    SET decision_status = 'approved',
        reviewer_id = p_reviewer_id,
        reviewed_at = now(),
        checklist = p_checklist,
        version = version + 1
    WHERE id = p_submission_id;

    INSERT INTO student_checks (tenant_id, status, method, checked_at)
    VALUES (v_sub.tenant_id, 'verified', 'id_card', now())
    ON CONFLICT (tenant_id) DO UPDATE SET
      status = 'verified',
      method = 'id_card',
      checked_at = now();

    UPDATE tenants
    SET plan = 'student',
        plan_ends_at = v_ends
    WHERE id = v_sub.tenant_id;

    RETURN QUERY SELECT 'approved'::text, v_sub.tenant_id, v_email, v_sub.applicant_name, v_ends;
  ELSIF p_decision = 'rejected' THEN
    UPDATE public.student_submissions
    SET decision_status = 'rejected',
        rejection_reason = p_rejection_reason,
        reviewer_id = p_reviewer_id,
        reviewed_at = now(),
        checklist = p_checklist,
        version = version + 1
    WHERE id = p_submission_id;

    INSERT INTO student_checks (tenant_id, status, method, checked_at)
    VALUES (v_sub.tenant_id, 'not_student', 'id_card', now())
    ON CONFLICT (tenant_id) DO UPDATE SET
      status = 'not_student',
      method = 'id_card',
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

CREATE OR REPLACE FUNCTION admin.expire_student_entitlements()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin, pg_temp
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE tenants
  SET plan = 'creator',
      plan_ends_at = NULL
  WHERE plan = 'student'
    AND plan_ends_at IS NOT NULL
    AND plan_ends_at <= now()
    AND (plan_paid_until IS NULL OR plan_paid_until <= now());
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

ALTER FUNCTION admin.expire_student_entitlements() OWNER TO brandbuild_admin_definer;
REVOKE ALL ON FUNCTION admin.expire_student_entitlements() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.expire_student_entitlements() TO brandbuild_admin;
