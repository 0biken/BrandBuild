# BrandBuild backend scaffold

Rust / Axum / Tokio API scaffold for BrandBuild. The project uses one binary crate with modules for HTTP routes, authentication boundaries, domain state transitions, Postgres, a transactional outbox, and background workers.

## Layout

- `src/api.rs`: `/health` and the Postgres-backed `/v1` and `/v2` resource handlers, behind the tenant auth middleware.
- `src/auth.rs`, `src/auth_api.rs`: JWT session resolution with a membership and role check on every request, plus signup, login, codes and password reset.
- `src/onboarding.rs`: the student check (school-email code) and onboarding steps.
- `src/domain.rs`: post state machine and deterministic publish idempotency key helper.
- `src/db.rs`: Postgres pool, sqlx migration runner, and `tenant_tx`, the per-workspace transaction every tenant query runs in.
- `src/outbox.rs`, `src/workers.rs`: transactional enqueue helper, `SKIP LOCKED` claim query, and worker loop stub.
- `migrations/0001_initial.sql`: multi-tenant schema, tenant-scoped FKs, indexes, immutable post versions, version-bound approvals, idempotent publish-attempt uniqueness, usage caps, audit log and outbox.

## Run locally

Requires Rust stable, Docker Compose, and `sqlx-cli` (`cargo install sqlx-cli --no-default-features --features rustls,postgres`). From this directory:

```sh
docker compose up -d postgres mailpit
export MIGRATION_DATABASE_URL=postgres://brandbuild:brandbuild@localhost:5432/brandbuild
export DATABASE_URL=postgres://brandbuild_app:brandbuild_app@localhost:5432/brandbuild
export JWT_SECRET=change-me-to-32-or-more-random-characters
export COOKIE_SECURE=false SMTP_HOST=localhost SMTP_TLS=none SMTP_FROM="BrandBuild <hello@brandbuild.local>"
cargo run
```

The API listens on `http://localhost:3000`; `GET /health` returns a basic health response. The binary runs migrations at startup. Codes the API emails show up in Mailpit at `http://localhost:8025`.

### Database roles and tenant isolation

Every table holding workspace data has forced row-level security (migration `0005_rls.sql`). Rows are visible only inside a transaction that set `app.tenant_id`, which `db::tenant_tx` does; with no tenant set, queries return nothing.

- `MIGRATION_DATABASE_URL`: the schema owner. Runs migrations at startup. If unset, `DATABASE_URL` is used for both (fine for a quick start, but the owner bypasses RLS).
- `DATABASE_URL`: the `brandbuild_app` role the API serves requests with. It has no `BYPASSRLS`, so Postgres itself keeps workspaces apart. Docker's init script (`docker/init-app-role.sql`) creates it with password `brandbuild_app`; in other environments create it with `CREATE ROLE brandbuild_app LOGIN PASSWORD '...'` before the first migration, or the migration creates it without login.
- Left without RLS on purpose: `users`, `tenants`, `tenant_memberships` and `auth_codes` (read during login, before a workspace is known), and `outbox` and `agent_runs` (read by the cross-workspace worker).

### Roles

Members are `owner`, `editor` or `reviewer`. Approve, request changes, schedule, publish and cancel need owner or reviewer. Connected channels and workspace settings need owner. Anything else is open to all members. A refused call answers 403 `forbidden`.

### Email

Codes for signup, login, password reset and the student check go out over SMTP. No provider is chosen yet; production only needs these settings:

| Setting | Meaning |
|---|---|
| `SMTP_HOST` | Server name. Unset means email is unavailable. |
| `SMTP_PORT` | Defaults to 587 (starttls), 465 (tls) or 1025 (none). |
| `SMTP_TLS` | `starttls` (default), `tls`, or `none` for Mailpit. |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | Optional. |
| `SMTP_FROM` | Sender, for example `BrandBuild <hello@example.com>`. |

If an email can't be sent, the call answers 503 `email_unavailable` and saves nothing, so a signup can simply be retried. Logging in with the right password before verifying answers 403 `email_not_verified`.

### Student check

School addresses end in `.edu`, `.edu.<country>` or `.ac.<country>`. `STUDENT_EMAIL_DOMAINS` adds more, comma-separated, including their subdomains (for example `covenantuniversity.org,example-college.com`). A verified address sets the workspace plan to `student`; "not a student" sets `creator`. Student ID upload answers 501 `not_available` until review is built.

### Tests

`cargo test` runs the unit and contract tests without a database. The database tests in `tests/db.rs` (isolation, roles, signup rollback, student check, onboarding) also run when these are set:

```sh
export TEST_DATABASE_URL=postgres://brandbuild:brandbuild@localhost:5432/brandbuild
export TEST_APP_DATABASE_URL=postgres://brandbuild_app:brandbuild_app@localhost:5432/brandbuild
cargo test --test db
```

## API

The contract is [`docs/api/openapi.yaml`](../docs/api/openapi.yaml). Each operation's `x-status` says whether this server already matches it, and `x-phase` says which roadmap phase closes the gap. Auth lives under `/v1/auth` and uses the HttpOnly `bb_session` cookie (Bearer also works). Set `COOKIE_SECURE=false` for local HTTP, and `PORT` to change the default 3000. `/v2`, calendar plans, pillars, slots, tenant config and audit are outside the contract.

## Decisions and next steps

- Kept a single binary crate to make the first backend easy to iterate on; split domain/services into crates when boundaries stabilize.
- No billing tables or payment paths. `usage_caps` is for rate limiting and per-tenant fair-use / agent-run limits.
- `post_versions` rejects UPDATE and DELETE; edits create new version rows. Approval rows reference the exact version they approved.
- `publish_attempts` has a tenant-scoped unique idempotency key. The helper derives it from tenant, post, and immutable version. Provider publishing/reconciliation and retry policy are still TODO.
- Invites and a members screen are not built yet; every new workspace has one owner.
- Encrypt OAuth credentials with a managed key, implement OAuth state/PKCE and provider callbacks, and never log tokens.
- Add transactional event + audit writes for mutations, worker lease recovery/retry/backoff, metrics ingestion, agent-run cap enforcement, and integration tests.
