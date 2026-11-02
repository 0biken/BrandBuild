# Brandbuild — design handoff

Brandbuild turns an idea into a caption in the brand's voice, then schedules it to Instagram, LinkedIn, TikTok, Facebook and YouTube. Audience: student founders and small brands. **Web-first, mobile-optimised.**

## How to use this folder

- `screens/*.dc.html` — 40 screens. **Reference spec, not production code.** They use a custom canvas format (`<x-dc>`, `{{holes}}`, `<sc-for>`, `<sc-if>`, `./support.js`) that only renders inside the Claude Design canvas. Read them for layout, copy, states and behaviour, then rebuild in the real stack. Do not copy the markup or try to run them standalone.
- `canvas.json` — where each screen sits on the canvas, grouped in rows. Useful as a map of the product.
- `logo.svg` — the logo (black). Use white (`#FFFFFF`) on dark backgrounds.
- The live, clickable version is the published canvas; the interactive boards (marked below) have working states.

Read this file and the relevant screen before building any UI.

## Screen map

| Group | Screens |
|---|---|
| Web app | Main (home), Composer (interactive), Calendar |
| Onboarding | Connect, Verify (student ID), BrandSetup (brand voice) |
| Mobile (390×844) | MobileHome, MobileComposer, MobileSchedule |
| Public site | Landing, Pricing, Legal |
| Sign in | SignUp, LogIn, Code, Reset |
| Core app | Drafts, PostDetail (6 states), Analytics, Notifications |
| Settings | Settings, Billing, VerifyStatus |
| System | States (12 empty/error states), Dialogs, Paywall, NotFound, Emails |
| Customer app | Team, BrandProfile, Approvals, ApprovalInbox (phone), ApprovalReview (phone), ApprovalEmail |
| Admin (staff only) | AdminHome, AdminWorkspace, AdminUnclear, AdminSpend, AdminAudit, ReviewQueue (student ID review) |

Web screens are fluid and collapse to a phone layout below **860px**. Phone screens are fixed 390×844.

## Colour

| Token | Value | Use |
|---|---|---|
| primary | `#12A150` | buttons, links, focus ring |
| primary-hover | `#0B7A3B` | hover/pressed |
| forest | `#0F2A1B` | dark surfaces, admin header |
| lime | `#D4F25C` | accent, highlights, support-session banner |
| ink | `#0F1A13` | body text |
| page | `#F3F4EF` | app background (admin: `#EEF0EA`) |
| surface | `#FFFFFF` / `#FBFBF8` | cards |
| border | `#E3E5DD` | dividers, card borders |

Status colours carry meaning and are never the only signal (always pair with text or an icon):
- **Amber** — in progress, on hold, paused.
- **Red** — error or destructive.
- **Blue** (`#E7F1FB` bg, `#0A3D73` text) — awaiting approval.
- **Green** — published, success.

## Type

- **Bricolage Grotesque** — display and headings, tight tracking (`-0.02em` to `-0.04em`).
- **Geist** — UI text.
- **Geist Mono** — numbers, times, IDs.

## Motion

- Press feedback: `scale(0.97)`, 120ms, `cubic-bezier(.23,1,.32,1)`.
- Enter: from `scale(.95)` or `translateY(6px)`, 200–300ms. Stagger lists by about 40ms.
- Sheets: `cubic-bezier(.32,.72,0,1)`.
- Animate only `transform` and `opacity`.
- Honour `prefers-reduced-motion` everywhere.
- Hover effects only inside `@media (hover:hover) and (pointer:fine)`.
- No animation when switching tab-bar tabs.

## Accessibility

- 44px minimum touch targets.
- Real `button`, `a`, `label` elements. Switches are `<input type="checkbox" role="switch">`.
- Visible focus ring: 2px `#12A150`, offset 2px.
- Live regions (`aria-live`) for async status and toasts.
- No colour-only status.

## Product rules the screens already encode

- **Post states:** scheduled, awaiting approval, published, failed, checking (outcome unclear), paused.
- **Outcome unclear:** when a platform doesn't confirm a post, the customer sees "checking". Staff resolve it in AdminUnclear. **Retry is only allowed if the platform check found no matching post**, to prevent double posting.
- **Approvals:** editors send for approval; owners approve, request changes or reject. Unapproved posts wait; they do not auto-post. Actions can be undone.
- **Default account per platform** in Settings, for when two accounts share a platform.
- **Billing** lives in a hosted portal; the in-app page links out to it.
- **Pause publishing** (admin) holds posts, never deletes them, and needs a reason plus a customer-facing message.
- **Support access** (admin) needs a ticket, a customer-readable reason and a time limit; read-and-act needs a second approver; the customer is emailed; every page viewed is logged. The audit log is append-only.

## Open decisions (placeholders in the screens)

Search the screens for `[` to find them. Not decided yet:

- Prices and limits: `₦[PRICE]`, `[N]` (plan limits, generation cap)
- `[END DATE]` and what happens when Student Access ends
- `[X HOURS]` for student ID review; `[X MINUTES]` to confirm an unclear post
- `[PAYMENT PROVIDER]`
- Legal text and company details
- Launch platforms
- `$[DAILY BUDGET]`, monthly AI budget, audit-log retention `[N] months`, staff `[NAME]`
- Whether reviewers can edit a brand profile (currently: no)
- Whether any staff member may pause publishing, or only senior roles

## Sample data (not real)

Treat all figures as placeholders: "about 3× saves", "2.3× the saves", "Thursday and Friday evenings perform best", and every number in the admin screens.

## Not designed yet

Agency portal (later). Help centre and status page are bought in; the screens only link to them.
