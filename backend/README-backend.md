# BrandBuild backend scaffold

Rust / Axum / Tokio API scaffold for BrandBuild. The project uses one binary crate with modules for HTTP routes, authentication boundaries, domain state transitions, Postgres, a transactional outbox, and background workers.

## Layout

- `src/api.rs`: `/health`, `/v1` compatibility placeholders, and typed `/v2` resource handlers for brands, channels, calendars, posts, analytics, and audit. V2 currently uses a process-local in-memory store and returns structured JSON errors; data resets on restart and tenant authentication/authorization must be applied before production use.
- `src/auth.rs`: tenant context extraction and a deliberately unimplemented session/JWT resolver. Tenant identity must be resolved from validated server-side auth and membership, never request input.
- `src/domain.rs`: post state machine and deterministic publish idempotency key helper.
- `src/db.rs`: Postgres pool and sqlx migration runner.
- `src/outbox.rs`, `src/workers.rs`: transactional enqueue helper, `SKIP LOCKED` claim query, and worker loop stub.
- `migrations/0001_initial.sql`: multi-tenant schema, tenant-scoped FKs, indexes, immutable post versions, version-bound approvals, idempotent publish-attempt uniqueness, usage caps, audit log and outbox.

## Run locally

Requires Rust stable, Docker Compose, and `sqlx-cli` (`cargo install sqlx-cli --no-default-features --features rustls,postgres`). From this directory:

```sh
docker compose up -d postgres
export DATABASE_URL=postgres://brandbuild:brandbuild@localhost:5432/brandbuild
sqlx migrate run
cargo run
```

The API listens on `http://localhost:3000`; `GET /health` returns a basic health response. Migration execution is intentionally explicit; the binary does not auto-migrate.

## Route scaffold

`/v1/tenant/config`, `/v1/brand`, `/v1/brand/pillars`, `/v1/channels` and channel OAuth start/callback placeholders, `/v1/calendar-plans` and slots, `/v1/posts` plus approve/request-changes/schedule/cancel actions, `/v1/analytics`, and `/v1/audit` remain compatibility placeholders. V2 exposes `GET/POST /v2/brands`, `GET/PUT/DELETE /v2/brands/:id`, the same CRUD shape for `/v2/channels`, `/v2/calendars`, and `/v2/posts`, plus `GET /v2/analytics` and `GET /v2/audit`. V2 writes and audit entries are held in process memory, so they reset on restart and are not shared across instances. Authentication/authorization middleware is not wired yet; protect the routes before exposing tenant data.

## Decisions and next steps

- Kept a single binary crate to make the first backend easy to iterate on; split domain/services into crates when boundaries stabilize.
- No billing tables or payment paths. `usage_caps` is for rate limiting and per-tenant fair-use / agent-run limits.
- `post_versions` rejects UPDATE and DELETE; edits create new version rows. Approval rows reference the exact version they approved.
- `publish_attempts` has a tenant-scoped unique idempotency key. The helper derives it from tenant, post, and immutable version. Provider publishing/reconciliation and retry policy are still TODO.
- Add auth/session persistence and tenant membership resolution; implement handlers with tenant predicates on every query; add role-based authorization and request validation.
- Encrypt OAuth credentials with a managed key, implement OAuth state/PKCE and provider callbacks, and never log tokens.
- Add transactional event + audit writes for mutations, worker lease recovery/retry/backoff, metrics ingestion, agent-run cap enforcement, and integration tests.
- Run `cargo test` for the state machine unit tests. No database was started or contacted during scaffold creation.
