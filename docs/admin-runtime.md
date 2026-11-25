# Admin runtime and regression verification

The corrective migrations after `0016` preserve the original migration history.
Run migrations with the schema-owner account before starting the API. The runtime
roles must not be superusers and must not have `BYPASSRLS`:

- `DATABASE_URL`: `brandbuild_app`, for tenant-scoped customer and worker operations.
- `ADMIN_DATABASE_URL`: `brandbuild_admin`, for staff sessions and explicitly granted operations.
- `MIGRATION_DATABASE_URL`: schema owner, used only for migrations.

`brandbuild_admin_definer` is a NOLOGIN role used by narrowly granted database
functions. Neither runtime role should be a member of it. Provision LOGIN and a
secret for the runtime roles separately; migrations do not set production passwords.

## Support notifications

Activation atomically queues a notification to workspace owners. The queued
timestamp and actual delivery timestamp are distinct. The maintenance worker retries
SMTP failures and marks delivery only after SMTP succeeds. Configure `SMTP_HOST`,
`SMTP_PORT`, `SMTP_TLS`, `SMTP_FROM`, and optional credentials as described in the
backend README. Delivery is at least once: a crash after SMTP acceptance but before
database commit can cause a duplicate email.

Role changes, account disablement, and staff logout revoke related support grants.
Every support read/edit rechecks the grant and the second approver's eligibility.

## Student document processing

Set `STUDENT_ID_SCANNER` to a trusted ClamAV-compatible executable (`clamscan` or
`clamdscan`). It is invoked directly without a shell and must return ClamAV exit
codes: 0 clean, 1 infected, anything else unavailable. Keep signatures updated.
An unavailable scanner returns HTTP 503; files are not marked ready.

PDF processing additionally requires `pdftoppm` and Linux `prlimit`. Rasterization
is bounded by time, memory, file size and preview dimensions. Both the original
document and generated preview are scanned. No raw PDF fallback is served.

The maintenance worker runs every minute, expires student plans, and retries object
deletion for documents past retention: 30 days after a review decision, 90 days for
pending submissions, and 7 days for quarantined documents. Metadata is retained.
Migration `0020` quarantines legacy ready documents that never went through scanning;
those applicants must resubmit.

## Publishing

The default connector explicitly fails publishing because a live social adapter is
not configured. It cannot verify posts. The console must not be represented as a
live publishing integration until a real provider adapter is installed and tested.

Approved publish requests enqueue an attempt and outbox event atomically. The worker
rechecks the current approval under tenant isolation. Staff resolution requires
connector evidence; a timeout or arbitrary receipt is not proof of success or failure.
Failure and retry decisions require a completed uncertain attempt with no active
worker lease, followed by fresh reconciliation. Expired claims that never reached
submission can be reclaimed; claims that may have submitted are fenced and sent
to investigation without resubmitting. Reconciliation evidence is invalidated when
execution starts and when its outcome is persisted.

## Verification

The admin production build uses Next.js's supported Webpack mode, matching its
development command. This avoids the Windows Turbopack PostCSS subprocess failure
observed during verification. Run `npm run build:admin` from `main-app`.

Use an isolated PostgreSQL 16 database and three connection URLs:

```powershell
$env:TEST_DATABASE_URL = 'postgres://owner:password@localhost:5432/brandbuild_test'
$env:TEST_APP_DATABASE_URL = 'postgres://brandbuild_app:brandbuild_app@localhost:5432/brandbuild_test'
$env:TEST_ADMIN_DATABASE_URL = 'postgres://brandbuild_admin:brandbuild_admin@localhost:5432/brandbuild_test'
cargo test -j 1 -- --test-threads=1
```

The test setup provisions test-only role logins. Tests use the customer and admin
runtime roles for API and worker operations; owner access is restricted to migrations,
fixture creation and assertions. Database tests require the URLs above. The scanner
regression uses a benign executable fixture to test the process protocol; deployment
still requires a smoke test with the actual scanner, signatures and PDF tools.
