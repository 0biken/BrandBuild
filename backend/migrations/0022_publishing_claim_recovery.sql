-- Persist the boundary after which a crashed worker may already have sent a
-- remote request. Lease expiry alone never proves that request did not publish.
ALTER TABLE public.publish_attempts
  ADD COLUMN submission_started_at timestamptz,
  ADD COLUMN lease_expires_at timestamptz;

-- Legacy claims have no trustworthy pre-submission marker. Treat them as
-- possibly submitted rather than automatically sending a second request.
UPDATE public.publish_attempts SET
  submission_started_at=COALESCE(started_at,created_at),
  lease_expires_at=COALESCE(started_at,created_at)+interval '60 seconds'
WHERE state IN ('running','unknown');
