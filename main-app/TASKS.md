# BrandBuild — Task List

Legend: `[ ]` todo · `[x]` done · 🔴 blocker · ⏳ external wait · `CA-1` etc. = requirement ID in the PRD

PRD: https://claude.ai/artifact/RWL9oMe2LsNdvCusZ4haXo

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
- [ ] Cargo workspace + both Next.js apps; CI runs fmt, clippy, tests, web lint/build
- [ ] Local dev: docker-compose with Postgres + MinIO + Redis
- [ ] Sign up with email or Google; create a workspace (CA-1)
- [ ] Staff sign-in for the admin console via SSO; separate staff role, never a tenant member
- [ ] Tables: `tenants`, `memberships`, `brands`, `audit_events` with composite `(tenant_id, id)` keys
- [ ] Server-built `TenantContext`; `set_config('app.tenant_id', …, true)` per transaction
- [ ] RLS `ENABLE` + `FORCE` on every tenant table; runtime DB role without BYPASSRLS, separate migration role
- [ ] Append-only audit event writer (actor, action, target, request_id)
- [ ] Workspace lifecycle: provisioning → active → suspended → deletion_requested
- [ ] Roles enforced server-side: Owner, Editor, Reviewer (MVP); Admin, Analyst later
- [ ] ✅ Exit: cross-tenant negative tests pass using the real runtime role; no-context queries return nothing

### Phase 1 — Content workspace
- [ ] Brand onboarding: name, category, location, audience, voice samples, offers with prices and end dates, words to avoid (CA-2)
- [ ] Brand facts with owner, verification status, expiry
- [ ] Media library: upload, tag, reuse; quarantine → scan → process → ready, signature-based MIME check, size caps (CA-12)
- [ ] `content_items` state machine + immutable `content_versions` (canonical JSON + sha256 hash)
- [ ] Draft editor with version diff view
- [ ] Content schema `social_content.v1` with strict validation (reject unknown fields)
- [ ] ✅ Exit: user can create/edit/review content; every edit makes a new immutable version with evidence refs

### Phase 2 — Planning agent
- [ ] `ai_gateway` crate: provider adapter, structured-output validation, per-run token/USD budget, timeouts
- [ ] `agent_runs` state machine (queued → context_loading → planning → generating → validating → awaiting_review)
- [ ] Context snapshot builder (tenant-scoped, minimal data, versioned)
- [ ] Generate a 2- or 4-week plan from a goal: candidates → hard-constraint filter → greedy ranker with diversity penalty (CA-4)
- [ ] Drafts per channel: caption, hashtags, alt text, uploaded image or image brief (CA-5)
- [ ] Every price, offer, opening hour or claim links to a saved brand fact; unsupported claims blocked (CA-6)
- [ ] Deterministic validators: length, forbidden terms, duplicate similarity
- [ ] Calendar UI: week and month views, slots per channel, timezone-aware (CA-4)
- [ ] Golden eval corpus + prompt-injection red-team cases in `evals/`
- [ ] ✅ Exit: eval targets met; no unsupported fact passes validation

### Phase 3 — Social connections (needs B approved)
- [ ] `SocialConnector` trait + capability manifest type
- [ ] Meta connector: OAuth code flow + PKCE, exact redirect URIs, state/CSRF
- [ ] Detect personal (non-Business) Instagram accounts at connect time and guide the switch
- [ ] Token vault: envelope encryption via KMS; only secret refs in DB; redaction in logs
- [ ] OAuth connection state machine (connected / refresh_due / refreshing / reauth_required / revoked)
- [ ] Token refresh with distributed lock; disconnect/revoke flow
- [ ] Connected-accounts page: account, permissions, connection health (CA-3)
- [ ] ✅ Exit: sandbox accounts connect; scopes and capabilities display correctly

### Phase 4 — Approvals and safe publishing
- [ ] Approval records bound to content hash + target-set hash + schedule hash; edits after approval send it back (CA-7)
- [ ] Approval inbox: phone-first approve / edit / reject, approve a whole week at once, opens from email link (CA-8)
- [ ] Schedule in the business's timezone; reschedule or cancel; DST gap/overlap prompts (CA-9)
- [ ] `publish_jobs` + `publish_attempts` tables; unique active-target index
- [ ] Transactional outbox + dispatcher (`SKIP LOCKED`); inbox dedup for consumers
- [ ] Worker binary: lease + CAS claim → preflight → persist attempt → submit
- [ ] `unknown_outcome` state + reconciler (look up remote post before any retry)
- [ ] Retry policy: backoff + jitter for transient only; per-tenant/provider concurrency limits
- [ ] Post status in the app: scheduled, publishing, published (link), failed (reason), outcome unclear (CA-10)
- [ ] Email alerts: posts awaiting approval, failed posts, reconnect needed (CA-11)
- [ ] OpenTelemetry traces request → run → job → connector; basic dashboards + alerts
- [ ] ✅ Exit: failure-injection tests show no blind retries on ambiguous timeout; two workers can't publish one job

### Admin console (built alongside Phases 0–4)
- [ ] Find a workspace by email or name; see plan, connected accounts, post job states (AD-1)
- [ ] Pause publishing: everyone, one workspace, one account (AD-2)
- [ ] Review and resolve "outcome unclear" posts (AD-3)
- [ ] AI spend and usage per workspace, with limits (AD-4)

### MVP if time (P1)
- [ ] Invite teammates as Owner, Editor or Reviewer (CA-13)
- [ ] Per-post reach and engagement + weekly summary email (CA-14)
- [ ] AI-generated images (CA-15)
- [ ] Read-only support access with stated reason, logged (AD-5)
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
- [ ] Metrics ingestion per provider; raw + normalized snapshots; missing ≠ zero
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
