# BrandBuild backend scaffold

Rust / Axum / Tokio API scaffold for BrandBuild. The project uses one binary crate with modules for HTTP routes, authentication boundaries, domain state transitions, Postgres, a transactional outbox, and background workers.

## Layout

- `src/api.rs`: `/health` and the Postgres-backed `/v1` and `/v2` resource handlers, behind the tenant auth middleware.
- `src/auth.rs`, `src/auth_api.rs`: JWT session resolution with a membership check on every request, plus signup, login, codes and password reset.
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

The API listens on `http://localhost:3000`; `GET /health` returns a basic health response. The binary also runs migrations at startup.

## API

The contract is [`docs/api/openapi.yaml`](../docs/api/openapi.yaml). Each operation's `x-status` says whether this server already matches it, and `x-phase` says which roadmap phase closes the gap. Auth lives under `/v1/auth` and uses the HttpOnly `bb_session` cookie (Bearer also works). Set `COOKIE_SECURE=false` for local HTTP, and `PORT` to change the default 3000. `/v2`, calendar plans, pillars, slots, tenant config and audit are outside the contract.

## Decisions and next steps

- Kept a single binary crate to make the first backend easy to iterate on; split domain/services into crates when boundaries stabilize.
- No billing tables or payment paths. `usage_caps` is for rate limiting and per-tenant fair-use / agent-run limits.
- `post_versions` rejects UPDATE and DELETE; edits create new version rows. Approval rows reference the exact version they approved.
- `publish_attempts` has a tenant-scoped unique idempotency key. The helper derives it from tenant, post, and immutable version. Provider publishing/reconciliation and retry policy are still TODO.
- Add auth/session persistence and tenant membership resolution; implement handlers with tenant predicates on every query; add role-based authorization and request validation.
- Encrypt OAuth credentials with a managed key, implement OAuth state/PKCE and provider callbacks, and never log tokens.
- Add transactional event + audit writes for mutations, worker lease recovery/retry/backoff, metrics ingestion, agent-run cap enforcement, and integration tests.
- Run `cargo test` for the state machine unit tests. No database was started or contacted during scaffold creation.
