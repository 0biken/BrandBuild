# BrandBuild — Task List

Legend: `[ ]` todo · `[x]` done · `[~]` partly done (what's missing is noted) · 🔴 blocker · ⏳ external wait · `CA-1` etc. = requirement ID in the PRD · `24HR` = idea borrowed from the 24HR social-publishing PRD (13 Nov 2026)

PRD: https://claude.ai/artifact/RWL9oMe2LsNdvCusZ4haXo

Phase numbers here differ from the 10-phase roadmap: TASKS Phase 0 = roadmap Phase 3 (backend foundations), Phase 1 = roadmap 4 (content), Phase 2 = roadmap 5 (AI planner), Phase 3 = roadmap 6 (social connections), Phase 4 = roadmap 7 (approvals and publishing). The admin console is roadmap Phase 8.

Status last checked against the code on 16 Nov 2026. The admin implementation and corrective migrations 0017–0024 were verified with PostgreSQL 16 and the customer/admin runtime roles: 88 backend tests passed without skips. Database tests can run locally with the test URLs in `docs/admin-runtime.md` and also run in CI.

Stack: Rust (Axum + SQLx) API + worker · Next.js/React + TypeScript web · PostgreSQL (RLS) ·
S3-compatible object storage · KMS/secret manager · Redis (cache/rate limits only)

Portals:
- **Build:** customer app (`app.brandbuild.co`, includes the phone approval inbox) and internal admin console (`admin.brandbuild.co`, behind SSO)
- **Exists:** marketing site + waitlist (`brandbuild.co`)
- **Buy:** billing portal, help center, status page
- **Later:** agency features inside the customer app

Release path: Now → Build MVP → 🚦 Beta gate → Private beta → 🚦 Launch gate → Public launch → After launch

---

## A. Do now (this week)

### Security
- [ ] 🔴 Rotate Google service-account key `90615e7e…` (waitlist-bot@brandbuild-waitlist) in Google Cloud console
- [ ] Delete local `brandbuild-waitlist-90615e7e25c6.json` and `.env.local` after rotation
- [ ] Delete stray `C:\Users\Sandy Star\Downloads\package-lock.json` (or set `turbopack.root`)

### Landing page fixes
- [ ] Reword "autopilot / posts that write themselves" to match the review-first product ("approve in a tap")
- [ ] Remove or verify unproven claims: "500+ businesses", "1M+", "300%", "15 hrs", Sarah Jenkins/Acme Beauty testimonial
- [ ] Add `public/assets/og-image.jpg` (1200×630) and set `metadataBase` in `src/app/layout.tsx`
- [ ] Fix BlogBuzz image: rename `blog_image_!.png` → `blog_image_1.png`
- [ ] Add `public/assets/testimonial-poster.jpg` or remove the `poster` attribute (Testimonial.tsx)
- [ ] Create `/terms` page (or remove footer link)
- [ ] Replace `href="#"` links: footer socials, CaseStudies, BlogBuzz (×2)
- [ ] Set real Meta Pixel ID or remove the pixel script (layout.tsx)
- [ ] Pick one domain: `brandbuild.co` vs `hello@brandbuild.com`
- [ ] Update privacy policy to mention Plausible, Meta Pixel and Google Forms
- [ ] Rewrite README (still create-next-app boilerplate)
- [ ] Optional: delete unused `WaitlistForm.tsx`, `PartnerLogos.tsx`; compress 8 MB PDF / 2 MB images in `public/assets`

---

## B. Platform access (start now, runs in parallel) ⏳
- [ ] 🔴 Create Meta developer app; set up a test Facebook Page + Instagram Business account
- [ ] Draft privacy policy URL, data deletion URL and screencast needed for Meta App Review
- [ ] Submit Meta App Review for Instagram content publishing + Pages permissions (beta gate depends on it)
- [ ] Record approved scopes, API version and account-eligibility rules in `docs/provider-contracts/meta.md`
- [ ] Decide v2 platforms (LinkedIn Pages, TikTok, X) and note each one's approval/cost requirements
- [ ] If LinkedIn is in v2: organisation posting needs LinkedIn's Community Management app review (legal details, privacy policy, app verification, screencast); start that paperwork early (24HR)

---

## C. Decisions to make before Phase 0 ends
- [ ] Launch market + locale (doc examples use `en-NG`) → affects platforms and payments
- [ ] Billing unit: workspace / connected account / posts per month
- [ ] Payments provider (Stripe vs Paystack/Flutterwave) — its hosted portal is the billing portal
- [ ] LLM provider + model for planning/copy
- [ ] AI image generation in MVP, or upload-only (CA-15)
- [ ] Help center and status page tools
- [ ] Hosting: managed Postgres, object storage, KMS, container platform
- [ ] Retention periods for prompts, drafts, media, metrics, audit records
- [ ] Who can pause all publishing / revoke tokens (incident roles)
- [ ] Agree PRD metric targets (approved without major edits ≥ 60%, first approved post < 15 min, publish success ≥ 99%)

---

## D. Build MVP (customer app + admin console)

### Phase 0 — Foundations
- [ ] Monorepo layout in `main-app/`: `apps/web` (customer app), `apps/admin` (admin console), `apps/api`, `crates/{domain,tenancy,content,policy,publishing,connectors,ai_gateway,media,analytics,observability}`, `migrations/`, `evals/`, `docs/adr/`
- [~] Cargo workspace + both Next.js apps; CI runs fmt, clippy, tests, web lint/build — CI done (`.github/workflows/backend.yml`, `web.yml`); single crate in `backend/`, no `apps/admin` yet
- [~] Local dev: docker-compose with Postgres + MinIO + Redis — Postgres only (`backend/docker-compose.yml`)
- [~] Sign up with email or Google; create a workspace (CA-1) — email sign-up creates a workspace; Google sign-in missing
- [~] Staff sign-in for the admin console via SSO; separate staff role, never a tenant member — Google Workspace OIDC and staff role/session boundaries implemented; production organisation/client configuration and live SSO verification remain
- [x] Tables: `tenants`, `memberships`, `brands`, `audit_events` with composite `(tenant_id, id)` keys
- [x] Server-built `TenantContext`; `set_config('app.tenant_id', …, true)` per transaction
- [x] RLS `ENABLE` + `FORCE` on every tenant table; runtime DB role without BYPASSRLS, separate migration role
- [x] Append-only audit event writer (actor, action, target, request_id) — `audit::record` writes post, approval, publish, brand, fact, media and workspace-setting changes
- [ ] Workspace lifecycle: provisioning → active → suspended → deletion_requested
- [x] Roles enforced server-side: Owner, Editor, Reviewer (MVP); Admin, Analyst later
- [x] ✅ Exit: cross-tenant negative tests pass using the real runtime role; no-context queries return nothing (`backend/tests/db.rs`)

### Phase 1 — Content workspace
- [x] Brand onboarding: name, category, location, audience, voice samples, offers with prices and end dates, words to avoid (CA-2) — offers live in brand facts
- [x] Brand facts with owner, verification status, expiry — `brand_facts` + `/v1/brand/facts`; any edit needs re-verifying; Brand screen has a Facts and offers section
- [ ] Version the brand brief: approved facts carry a source and owner sign-off, and AI drafts record which brief version they used (24HR)
- [~] Media library: upload, tag, reuse; quarantine → scan → process → ready, signature-based MIME check, size caps (CA-12) — all done except a real virus scanner (the `media.scan` step passes every file for now)
- [x] Store a sha256 hash for every media file and record it in the approved version, so the file that was approved is the file that publishes (24HR)
- [x] `content_items` state machine + immutable `content_versions` (canonical JSON + sha256 hash) — `posts` + `post_versions` with `content_hash`; handlers use `domain::next_state`
- [~] Draft editor with version diff view — `GET /v1/posts/{id}/versions` done; diff UI not built
- [x] Content schema `social_content.v1` with strict validation (reject unknown fields)
- [ ] ✅ Exit: user can create/edit/review content; every edit makes a new immutable version with evidence refs

### Phase 2 — Planning agent
- [x] AI gateway: provider adapter, structured-output validation, per-run token/USD budget, timeouts — `backend/src/ai/mod.rs` (a module, not yet its own crate); Gemini via AI Studio key, fake provider for tests; monthly per-workspace cap
- [x] `agent_runs` state machine (queued → context_loading → planning → generating → validating → awaiting_review) — migration 0009; cancel checked between steps
- [x] Context snapshot builder (tenant-scoped, minimal data, versioned) — `context.v1`: brand profile, verified facts, ready media, what's already planned; no emails or names
- [x] Generate a 2- or 4-week plan from a goal: candidates → hard-constraint filter → greedy ranker with diversity penalty (CA-4) — `POST /v1/plans`
- [x] Drafts per channel: caption, hashtags, alt text, uploaded image or image brief (CA-5)
- [x] Every price, offer, opening hour or claim links to a saved brand fact; unsupported claims blocked (CA-6) — also links: a site must appear in a cited fact
- [x] Deterministic validators: length, forbidden terms, duplicate similarity — `backend/src/ai/validate.rs`
- [~] Calendar UI: week and month views, slots per channel, timezone-aware (CA-4) — "Plan my weeks" with AI drafts in their slots; times still show in the browser's timezone, not the workspace's
- [x] Golden eval corpus + prompt-injection red-team cases in `evals/` — `backend/evals/`, `cargo run --bin evals -- --provider fake|gemini`; fake suite runs in `cargo test`
- [x] Limit the agent's tools to: read brand brief, list approved media, read calendar, read channel capabilities, propose plan, save drafts. No approve, publish, token or open-web tools; workspace scope enforced in code, not by the model (24HR) — the planner has no tools at all: one structured call, and code saves drafts
- [x] Plan-proposal format: each item carries platform, channel, media id, caption, proposed local time, sources, reasoning and warnings, plus model and prompt versions. Saving a proposal creates drafts only, never approvals (24HR)
- [~] Eval gate sizes: 60 quality cases (no cross-workspace facts or made-up claims), 30 attack cases (no approve/publish attempts, injected text can't widen tools), 20 owner-graded marketing reviews ≥ 4/5 on 80% (24HR) — 60 + 30 written and passing on the fake provider; live Gemini run and the 20 owner reviews (`backend/evals/owner-review.md`) not done yet
- [x] When the AI is down, over budget or cancelled: no half-saved content, and manual planning keeps working (24HR)
- [ ] ✅ Exit: eval targets met; no unsupported fact passes validation — validators pass all 90 planted cases; waiting on a live Gemini run and owner reviews

### Phase 3 — Social connections (needs B approved)
- [ ] `SocialConnector` trait + capability manifest type
- [ ] Meta connector: OAuth code flow + PKCE, exact redirect URIs, state/CSRF
- [ ] Store each sign-in attempt on the server: single-use, short-lived, tied to the person, workspace, platform and redirect; check it before exchanging the code. Today `oauth_states` saves the raw state, not a hash (24HR)
- [ ] Save the permissions the platform actually granted, not the ones requested; the user picks the Page or account explicitly instead of taking the first one found (24HR)
- [ ] Store the Facebook Page ID and the Instagram account ID in separate columns; refuse to activate a connection whose Instagram ID is unresolved (24HR found a bug where one was used for the other)
- [ ] Keep Meta and LinkedIn API versions in config, with contract tests before each upgrade (24HR hard-codes Meta v19.0)
- [ ] Reconnecting keeps drafts and history, but an approval never carries over to a different account without a new review (24HR)
- [ ] Detect personal (non-Business) Instagram accounts at connect time and guide the switch
- [ ] Token vault: envelope encryption via KMS; only secret refs in DB; redaction in logs
- [ ] OAuth connection state machine (connected / refresh_due / refreshing / reauth_required / revoked)
- [ ] Token refresh with distributed lock; disconnect/revoke flow
- [ ] Connected-accounts page: account, permissions, connection health (CA-3)
- [ ] ✅ Exit: sandbox accounts connect; scopes and capabilities display correctly

### Phase 4 — Approvals and safe publishing
- [~] Approval records bound to content hash + target-set hash + schedule hash; edits after approval send it back (CA-7) — content hash done and checked at publish; any edit sends it back; target-set and schedule hashes not added
- [x] Close the approval bypass on `feat/content-backend` (24HR) — scheduling records an approval for the exact version; edits go back to review; `/v2` post routes removed
- [x] "Require a second approver" workspace setting (24HR) — `PATCH /v1/settings/workspace`; publish rechecks it
- [x] Rescheduling an approved post needs a new approval when a second approver is required (24HR)
- [~] Approval inbox: phone-first approve / edit / reject, approve a whole week at once, opens from email link (CA-8) — backend routes done (list, approve, changes, reject, undo, withdraw, retry); approve-a-week and email links not built
- [x] Batch drafts: save 1–100 rows in one call with a key per row, so a retry returns the same posts and changed content under the same key is rejected; the AI planner saves through this (24HR) — `POST /v1/drafts/batch` and `draft_keys`
- [ ] Manual hand-off mode for channels we can't post to automatically (TikTok, personal profiles, before Meta review clears): approve → waiting for a person → they post and paste the link → shown as "reported by a person", never as verified (24HR)
- [ ] Schedule in the business's timezone; reschedule or cancel; DST gap/overlap prompts (CA-9) — store the UTC time plus the workspace timezone used to pick it; reject times that don't exist or are ambiguous around clock changes; never reinterpret saved times after a timezone change (24HR). Today everything is UTC with no workspace timezone
- [~] `publish_jobs` + `publish_attempts` tables; unique active-target index — `publish_attempts` with an idempotency key exists; no due-post runner picks up scheduled posts yet
- [~] Transactional outbox + dispatcher (`SKIP LOCKED`); inbox dedup for consumers — outbox with leases and `claim_batch` done (`outbox.rs`, `workers.rs`); topic handlers are no-ops
- [ ] Worker binary: lease + CAS claim → preflight → persist attempt → submit
- [ ] Recheck the approver, the approved version and the account's permissions right before sending (24HR)
- [ ] `unknown_outcome` state + reconciler (look up remote post before any retry)
- [ ] Publish outcomes shown as: rejected, outcome unknown, accepted by the platform, verified (where the API allows a read-back); a timeout is never counted as success or failure (24HR)
- [ ] Stop (fence) a worker whose lease ran out before anyone resolves its unclear post; never reset a stuck post to scheduled in bulk (24HR)
- [ ] Recover from a saved receipt when the platform returned a post ID but our final save failed; never re-create the post (24HR)
- [ ] Retry policy: backoff + jitter for transient only; per-tenant/provider concurrency limits
- [ ] Post status in the app: scheduled, publishing, published (link), failed (reason), outcome unclear (CA-10)
- [ ] Email alerts: posts awaiting approval, failed posts, reconnect needed (CA-11)
- [ ] OpenTelemetry traces request → run → job → connector; basic dashboards + alerts
- [ ] ✅ Exit: failure-injection tests show no blind retries on ambiguous timeout; two workers can't publish one job

### Admin console (built alongside Phases 0–4)
- [x] Find a workspace by email or name; see plan, connected accounts, post job states (AD-1) — admin app and tenant-safe staff API implemented
- [x] Pause publishing: everyone, one workspace, one account (AD-2) — persistent composed holds, pre-submit checks, and overdue-post handling verified; requests already sent cannot be canceled by a hold
- [~] Review and resolve "outcome unclear" posts (AD-3) — evidence/version checks, fencing, terminal retry guards and crash recovery verified; live provider reconciliation is not configured
- [x] AI spend and usage per workspace, with limits (AD-4) — reservations, uncertain-cost accounting and staff guardrails implemented and verified with runtime roles

### Metrics honesty (moved up from section I)
- [x] Missing ≠ zero: a metric we don't have is shown as "no data", never 0 (24HR)

### MVP if time (P1)
- [ ] Invite teammates as Owner, Editor or Reviewer (CA-13)
- [ ] Per-post reach and engagement + weekly summary email (CA-14)
- [ ] AI-generated images (CA-15)
- [x] Read-only support access with stated reason, logged (AD-5) — limited draft edits require a live second approver; role changes/logout revoke access; customer notifications are durably queued
- [ ] Feature flags and AI prompt versions per workspace (AD-6)

---

## E. 🚦 Beta gate
- [ ] Meta App Review approved
- [ ] Automated cross-tenant abuse tests green
- [ ] Duplicate-post and ambiguous-timeout failure tests pass

## F. Private beta
- [ ] Turn waitlist signups (Google Form) into app invites, in small batches (MK-1)
- [ ] Beta is free; collect feedback in-app or by email
- [ ] Track: approved without major edits, time to first approved post, publish success, cost per post
- [ ] Set targets for weekly active workspaces, week-4 retention, waitlist conversion

## G. 🚦 Launch gate
- [ ] Beta metric targets met
- [ ] Provider scopes/API versions re-verified against current Meta docs
- [ ] Backup restore drill done; workspace deletion + token revocation tested
- [ ] Runbooks: provider outage, expired creds, duplicate post, unknown outcome, key rotation, runaway spend
- [ ] Privacy policy and terms match data collected and platforms connected

## H. Public launch
- [ ] Free trial, plan choice, hosted checkout and billing portal (BI-1)
- [ ] Pricing and sign-up on the marketing site
- [ ] Help center and status page live
- [ ] Landing page shows real beta results instead of placeholders

---

## I. After launch

### Metrics and learning
- [ ] Metrics ingestion per provider; raw + normalized snapshots; missing ≠ zero (the Home-stats fix moved to the MVP); each metric records its source, account type, period and fetch time
- [ ] Analytics dashboard with denominators and time windows
- [ ] Experiment records (hypothesis, metric, stop rule) and recommendation summaries

### Bounded auto mode (CA-16)
- [ ] Policy engine with versioned rules and evaluation trace (deny on missing/stale data)
- [ ] Tenant opt-in for auto-publish on low-risk categories only
- [ ] Emergency stop + per-tenant budgets

### Agencies and growth
- [ ] Agency client switcher, client sign-off links, white-label reports (CA-17)
- [ ] LinkedIn / TikTok / X connectors
- [ ] Weighted fair queueing, partitioning if justified, dedicated tenant tiers
- [ ] Re-evaluate Temporal for orchestration
