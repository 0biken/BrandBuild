# BrandBuild — Task List

Legend: `[ ]` todo · `[x]` done · 🔴 blocker · ⏳ external wait · MVP = needed before first paying customer

Stack: Rust (Axum + SQLx) API + worker · Next.js/React + TypeScript web · PostgreSQL (RLS) ·
S3-compatible object storage · KMS/secret manager · Redis (cache/rate limits only)

---

## A. Do now (this week)

### Security
- [ ] 🔴 Rotate Google service-account key `90615e7e…` (waitlist-bot@brandbuild-waitlist) in Google Cloud console
- [ ] Delete local `brandbuild-waitlist-90615e7e25c6.json` and `.env.local` after rotation
- [ ] Delete stray `C:\Users\Sandy Star\Downloads\package-lock.json` (or set `turbopack.root`)

### Landing page fixes
- [ ] Add `public/assets/og-image.jpg` (1200×630) and set `metadataBase` in `src/app/layout.tsx`
- [ ] Fix BlogBuzz image: rename `blog_image_!.png` → `blog_image_1.png`
- [ ] Add `public/assets/testimonial-poster.jpg` or remove the `poster` attribute (Testimonial.tsx)
- [ ] Create `/terms` page (or remove footer link)
- [ ] Replace `href="#"` links: footer socials, CaseStudies, BlogBuzz (×2)
- [ ] Set real Meta Pixel ID or remove the pixel script (layout.tsx)
- [ ] Pick one domain: `brandbuild.co` vs `hello@brandbuild.com`
- [ ] Update privacy policy to mention Plausible, Meta Pixel and Google Forms
- [ ] Remove or verify unproven claims: "500+ businesses", "1M+", "300%", "15 hrs", Sarah Jenkins/Acme Beauty testimonial
- [ ] Align "autopilot / posts that write themselves" copy with review-first product (see Phase 6)
- [ ] Rewrite README (still create-next-app boilerplate)
- [ ] Optional: delete unused `WaitlistForm.tsx`, `PartnerLogos.tsx`; compress 8 MB PDF / 2 MB images in `public/assets`

---

## B. Platform access (start now, runs in parallel) ⏳
- [ ] 🔴 Create Meta developer app; set up a test Facebook Page + Instagram Business account
- [ ] Draft privacy policy URL, data deletion URL and screencast needed for Meta App Review
- [ ] Submit Meta App Review for Instagram content publishing + Pages permissions
- [ ] Record approved scopes, API version and account-eligibility rules in `docs/provider-contracts/meta.md`
- [ ] Decide v2 platforms (LinkedIn Pages, TikTok, X) and note each one's approval/cost requirements

---

## C. Decisions to make before Phase 0 ends
- [ ] Launch market + locale (doc examples use `en-NG`) → affects platforms and payments
- [ ] Billing unit: workspace / connected account / scheduled post / AI spend
- [ ] Payments provider (Stripe vs Paystack/Flutterwave)
- [ ] LLM provider + model for planning/copy; image generation yes/no for MVP
- [ ] Hosting: managed Postgres, object storage, KMS, container platform
- [ ] Retention periods for prompts, drafts, media, metrics, audit records
- [ ] Who can pause all publishing / revoke tokens (incident roles)

---

## D. Main app build

### Phase 0 — Foundations (MVP)
- [ ] Monorepo layout in `main-app/`: `apps/web`, `apps/api`, `crates/{domain,tenancy,content,policy,publishing,connectors,ai_gateway,media,analytics,observability}`, `migrations/`, `evals/`, `docs/adr/`
- [ ] Cargo workspace + `apps/web` (Next.js, TS); CI runs fmt, clippy, tests, web lint/build
- [ ] Local dev: docker-compose with Postgres + MinIO + Redis
- [ ] Auth (email + OAuth login) and sessions
- [ ] Tables: `tenants`, `memberships`, `brands`, `audit_events` with composite `(tenant_id, id)` keys
- [ ] Server-built `TenantContext`; `set_config('app.tenant_id', …, true)` per transaction
- [ ] RLS `ENABLE` + `FORCE` on every tenant table; runtime DB role without BYPASSRLS, separate migration role
- [ ] Append-only audit event writer (actor, action, target, request_id)
- [ ] Workspace lifecycle: provisioning → active → suspended → deletion_requested
- [ ] Role/capability matrix (Owner, Admin, Editor, Reviewer, Analyst) enforced server-side
- [ ] ✅ Exit: cross-tenant negative tests pass using the real runtime role; no-context queries return nothing

### Phase 1 — Content workspace (MVP)
- [ ] Brand profile: voice, audience, offers, location, prohibited claims, goals
- [ ] Fact sources with owner, verification status, expiry
- [ ] Media library: upload to quarantine → scan → process → ready (signature-based MIME check, size caps)
- [ ] `content_items` state machine + immutable `content_versions` (canonical JSON + sha256 hash)
- [ ] Manual draft editor in web app, version diff view
- [ ] Content schema `social_content.v1` with strict validation (reject unknown fields)
- [ ] ✅ Exit: user can create/edit/review content; every edit makes a new immutable version with evidence refs

### Phase 2 — Planning agent (MVP)
- [ ] `ai_gateway` crate: provider adapter, structured-output validation, per-run token/USD budget, timeouts
- [ ] `agent_runs` state machine (queued → context_loading → planning → generating → validating → awaiting_review)
- [ ] Context snapshot builder (tenant-scoped, minimal data, versioned)
- [ ] Planner: candidate ideas → hard-constraint filter → greedy ranker with diversity penalty
- [ ] Copy generator: channel-specific variants, alt text, claims bound to fact IDs
- [ ] Deterministic validators: length, forbidden terms, duplicate similarity, unsupported claims
- [ ] Calendar UI (week/month, slots per channel, timezone-aware)
- [ ] Golden eval corpus + prompt-injection red-team cases in `evals/`
- [ ] ✅ Exit: eval targets met; no unsupported fact passes validation

### Phase 3 — Social connections (MVP, needs B approved)
- [ ] `SocialConnector` trait + capability manifest type
- [ ] Meta connector: OAuth code flow + PKCE, exact redirect URIs, state/CSRF
- [ ] Token vault: envelope encryption via KMS; only secret refs in DB; redaction in logs
- [ ] OAuth connection state machine (connected / refresh_due / refreshing / reauth_required / revoked)
- [ ] Token refresh with distributed lock; disconnect/revoke flow
- [ ] Connected-accounts UI showing account, scopes, capabilities
- [ ] ✅ Exit: sandbox accounts connect; scopes and capabilities display correctly

### Phase 4 — Safe publishing (MVP)
- [ ] Approval records bound to content hash + target-set hash + schedule hash; edits revoke approval
- [ ] Review queue UI (mobile-friendly approve/reject)
- [ ] `publish_jobs` + `publish_attempts` tables; unique active-target index
- [ ] Transactional outbox + dispatcher (`SKIP LOCKED`); inbox dedup for consumers
- [ ] Worker binary: lease + CAS claim → preflight → persist attempt → submit
- [ ] `unknown_outcome` state + reconciler (look up remote post before any retry)
- [ ] Retry policy: backoff + jitter for transient only; per-tenant/provider concurrency limits
- [ ] UTC + IANA timezone scheduling; DST gap/overlap prompts
- [ ] Global / tenant / account publishing pause switches
- [ ] Notifications: publish success, failure, "outcome unclear", reauth needed
- [ ] OpenTelemetry traces request → run → job → connector; basic dashboards + alerts
- [ ] ✅ Exit: failure-injection tests show no blind retries on ambiguous timeout; two workers can't publish one job

### MVP launch checklist
- [ ] Automated cross-tenant abuse tests green
- [ ] Provider scopes/API versions re-verified against current Meta docs
- [ ] Backup restore drill done; tenant deletion + token revocation tested
- [ ] Runbooks: provider outage, expired creds, duplicate post, unknown outcome, key rotation, runaway spend
- [ ] Privacy/terms match data collected and platforms connected
- [ ] Billing live per decision in C

### Phase 5 — Metrics and learning (post-MVP)
- [ ] Metrics ingestion per provider; raw + normalized snapshots; missing ≠ zero
- [ ] Analytics dashboard with denominators and time windows
- [ ] Experiment records (hypothesis, metric, stop rule) and recommendation summaries
- [ ] ✅ Exit: experiments report windows and sample sizes

### Phase 6 — Bounded auto mode (post-MVP)
- [ ] Policy engine with versioned rules and evaluation trace (deny on missing/stale data)
- [ ] Tenant opt-in for auto-publish on low-risk categories only
- [ ] Emergency stop + per-tenant budgets
- [ ] ✅ Exit: policy audit + risk tests pass; disable-all works

### Phase 7 — Scale / hard isolation (later)
- [ ] Weighted fair queueing, partitioning if justified, dedicated tenant tiers
- [ ] Re-evaluate Temporal for orchestration
- [ ] Add LinkedIn / TikTok / X connectors
