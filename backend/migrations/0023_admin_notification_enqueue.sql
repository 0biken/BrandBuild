-- Publishing-hold handlers enqueue customer notices in the same transaction as
-- the hold and staff audit record. They need INSERT only, not cross-tenant reads.
GRANT INSERT ON public.outbox TO brandbuild_admin;
