# ICM State â€” 2026-10-01

## 2026-10-07 - Curated 4K gallery additions

Reviewed 239 owner-supplied Drive entries: 187 unique photographs and 52 byte-identical repeat files. Selected 12 clear exterior and interior views, upscaled with Higgsfield at its maximum 4K setting (3072 x 4096), and inspected before/after comparisons. New photos appear first in a separate gallery section; all 50 existing gallery photos, their order and captions, and hero/service assets remain unchanged. Responsive WebP previews keep downloads small; each new photo links to its full-resolution JPEG. Exported JPEGs contain no EXIF metadata. Source provenance: docs/GALLERY-PHOTOS-2026-10-07.md.

Validation: all 46 test:all checks passed. Final image production build and Edge checks at 1440px, 375px and 320px verify image loading, full-photo links, preserved existing captions/order, and no horizontal overflow. Production verification follows publication to main.


## 2026-10-07 - 1Commerce footer credit

Added a subtle teal pill badge, Built by 1Commerce, below the shared public footer. Links to https://1commercesolutions.com in a new tab with noopener noreferrer. Includes a 44px tap target, keyboard focus outline, and reduced-motion support.

Validation: all 46 test:all steps passed, including the production build. Edge browser checks passed at 1440px, 375px and 320px: correct link, visible focus, and no horizontal overflow. Desktop and phone screenshots inspected. Production verification follows the main publication.


## 2026-10-06 - Hali Kimball review card

Added the exact owner-supplied five-star Google quote to /reviews, with source attribution, accessible stars, and no inferred city or posting date. Updated the dated Google summary to 5.0 from two reviews. Static and live cards share the bordered style; live author/quote matches hide duplicate static cards while failures retain the fallback.

Validation: all 46 test:all steps passed, including production build. Browser checked at default desktop and 375px; no horizontal overflow. A simulated Google response showed one live Hali card and hid its static duplicate. Interception was cleared afterward. Production /api/google-reviews returned unconfigured; no live automatic feed or deployment is claimed. Setup: docs/REVIEW-CARDS.md and internal/README.md. Places needs the server-side key and verified Place ID; every-review import needs approved Business Profile API and owner OAuth.


## 2026-10-05 - Window Studio integration

Embedded an optional Blender-backed viewer on /window-features, using site tokens and the existing estimate scope handoff. Four v005 GLBs and posters; client navigation cleanup and error fallback. Fixed an Astro transitive advisory and Windows regression-test portability. All 46 test:all steps pass, including build. Implementation/audit: docs/WINDOW-STUDIO.md. Awaiting owner/installer visual review; no production publication.

## Status

**Phase 2 implementation in progress:** hardened ICM foundation + deterministic Build Plan lifecycle + quote/job approval gates + Ask specialist runtime + internal AI surfaces.

## What exists

- Root `CLAUDE.md` defines the agent operating contract.
- `.ai/CONTEXT.md` is the router.
- `.ai/RULES.md` defines evidence, uncertainty, safety, synchronization, and approval rules.
- `.ai/STATE.md` records current architecture state (snapshot); dated history lives in `.ai/CHANGELOG.md`.
- `.ai/workflows/build-plan/` defines the complete Build Plan pipeline, including human approval.
- `.ai/specialists/` defines specialist contracts used by Ask and internal AI routing.
- `functions/_lib/build-plan-rules.mjs` owns durable installation/material/QC rules and quality linting.
- `functions/_lib/build-plan-state.mjs` owns allowed Build Plan lifecycle transitions and source-snapshot invariant.
- `functions/internal/api/build-plan-state.js` persists state, recalculates live quality, detects quote drift, records approval, and locks approved plans until explicitly reopened.
- `src/pages/internal/quotes/build-plan-approval.astro` exposes the human approval gate with live quality/freshness checks.
- `functions/ask/_lib/icm-router.mjs` deterministically routes public and internal AI requests to one specialist.
- `functions/ask/_lib/icm-specialists.mjs` provides bounded runtime specialist contracts while `.ai/specialists/*/CONTEXT.md` remains canonical.
- `functions/ask/api/chat.js` injects the selected specialist contract before retrieval/model generation and returns route metadata.
- `/internal/copilot` provides an authenticated, read-only operational AI surface with bounded history and provider fallback.
- `/internal/leads/analyze` provides a human-invoked Lead Analyzer workflow.
- `functions/internal/api/lead-analyzer.js` reads bounded lead data from D1 and performs advisory analysis without mutation.
- `functions/internal/api/copilot-summary.js` converts a bounded Command Center snapshot into an advisory operational summary without mutation.
- `functions/api/estimate.js` preserves note line breaks and sends the customer receipt at most once per address per 24h (Mark's notification is never suppressed); behaviour is covered by `npm run test:estimate`, which executes the handler rather than regex-matching it.
- The quote â†’ plan â†’ approval â†’ signature â†’ job pipeline is executed end to end by `npm run test:quote-to-job` on a real SQL engine; build-plan state transitions never refresh the quote snapshot (only an editor re-save reconciles).
- Speed-to-lead: `functions/_lib/lead-alert.mjs` sends a PII-free ntfy push per valid lead (off unless `LEAD_ALERT_NTFY_TOPIC` is set). Review request: `functions/internal/api/review-request.js` asks once per job after a finalized closeout (email or Mark's own SMS) and records it in `review_requests`.
- **Permit guide (2026-10-03).** `/guides/window-replacement-permit-washington` answers the permit question from primary sources for Clark County, Camas, Battle Ground, Ridgefield, La Center and the state energy code. Vancouver, Washougal and Woodland are intentionally absent until verified (`.ai/WORKING.md` "Public copy log"). The Ask index still needs `npm run build:guides-index` with credentials.
- **Schedule and quote discovery (2026-10-03).** Schedule requests its selected Pacific calendar week using validated from/to bounds before pagination and reads all matching pages, excluding cancelled jobs. Quote search and status filters now run before pagination with matching item snapshots; the job-creation dropdown loads every finalized-quote page. Search is debounced and cancels late responses. Tests: `test:command-center`, `test:pagination`, `test:quote-to-job`, full local suite. Browser/iPhone checks remain VERIFY.
- **Queue reliability follow-up (2026-10-03).** Job status filters and active counts now cover the whole database before pagination. Follow-up lists request open tasks only and get whole-queue open/today/overdue totals from D1 using the shared Pacific business-day helper. Queue refreshes reject stale responses, handle an emptied last page and offer retry; failed Done saves show errors outside the hidden Add form. PATCH dueAt:null explicitly clears the date. Tests: `test:command-center`, `test:pagination`, full local suite. Browser/real-phone checks remain VERIFY.
- **Dashboard reliability follow-up (2026-10-03).** Scheduled job dates are formatted as calendar dates in UTC so the dashboard cannot show the previous day in Pacific time; follow-up Done buttons disable during saving, ignore repeated taps and surface server errors. The mobile More menu scrolls within short viewports and Escape restores focus. Regression: `test:command-center`; browser/real-iPhone visual checks remain VERIFY.
- **Command Center bug sweep (2026-10-03).** Money is shown to the cent (`src/lib/money.ts` + `functions/internal/_lib/money.mjs`, kept in step by `npm run test:command-center`); the quote builder keeps focus while typing and stacks lines on a phone; Mark's signature pad scales to the screen and submits strokes that the server renders (raw SVG is no longer accepted). Open items needing a human decision (field-gate unchecking, closeout editability) are listed in `CHANGELOG.md`.
- **Ask log keeps scrubbed questions for 30 days (2026-10-03, owner decision).** `ask_logs` stores the question and answer after `functions/ask/_lib/log-scrub.mjs` removes contact details (best effort); expired rows are deleted on insert, hidden on read and purged nightly by `workers/ops-cron`, whose backup leaves the text out. Privacy policy updated the same day. Tests: `npm run test:ask-logs`. **The ops-cron Worker deploys separately** (`cd workers/ops-cron && npx wrangler deploy`); until it is redeployed the policy's backup sentence is not yet true. Detail: `CHANGELOG.md`.
- **Ask â†’ person hand-off (2026-09-30).** `/ask` can end in a call-back request that posts to the existing `/api/estimate`; taps are counted in D1 (`ask_handoffs`, no text) and in GA4. Tests: `npm run test:ask-handoff`. Detail: `CHANGELOG.md`.
- `functions/api/google-reviews.js` + `functions/_lib/google-reviews.mjs` serve the pinned Google Business Profile's reviews to `/reviews`. Fully deterministic (no AI): fixed Place ID, name guard, bounded/sanitised output, fail-soft. It reports what Google returns and never generates or edits review text.
- `/internal/analytics` shows a deterministic requestsâ†’quotesâ†’signedâ†’jobsâ†’collected pipeline from D1 (`functions/internal/_lib/pipeline-summary.mjs`); stage totals are independent counts; per-source revenue is traced through `quotes.lead_id` (set by *Start quote* or confirmed by Mark from exact phone/email suggestions, never auto-linked; `functions/internal/_lib/lead-links.mjs`).
- `/internal/analytics` renders its numbers as dependency-free SVG charts (`src/lib/charts.ts`, `npm run test:charts`). Charts are a view; D1/GA4 remain the truth. Detail: `CHANGELOG.md`.
- **General (non-window) jobs, track-only (2026-09-30).** Mark can add a customer and job at `/internal/jobs/new` with no quote or Build Plan (`work_type='general'`). Validation: `functions/internal/_lib/general-jobs.mjs`. Tests: `npm run test:general-jobs`, `test:contact-import`. Not built by design: quotes/invoices/signing, warranty text for non-window work. Detail: `CHANGELOG.md`.
- **AI Gateway + model-aware embeddings (2026-10-01).** Groq/Gemini route through Cloudflare AI Gateway when `AI_GATEWAY_URL` is set; Ask embeds with the model named in `guides-index.json`. Tests: `npm run test:embeddings`. Detail: `CHANGELOG.md`.
- Home hero + Homeowners card (2026-10-02): `heroPhoto` in `src/data/work.ts` and `replacementTile` in `src/pages/index.astro` use `gray-lap-siding-triple-hung` (owner-supplied; also the default social-preview image). The hero and the Builders / Sliding glass doors card photos (`new-build-tan-corner`, `gray-siding-white-slider-deck`) were upscaled to 4K with Higgsfield. Detail: `CHANGELOG.md`.
- Images (2026-10-02): page-hero backgrounds come from `getHeroBg` in `src/lib/hero-bg.ts` (1600px / q60); any `<Image widths={[...]}>` must also set `width` to its largest candidate or Astro ships the full-size original as the fallback `src`. Titles <= 60 and descriptions <= 155 on every indexable page (`scripts/test-seo-meta.mjs`, no allowlist). Detail: `CHANGELOG.md`.
- **Phone app card shows photo-backup status and can copy diagnostics (2026-10-04).** `job-photos?status=1`, worker event log (no customer data), `diagnosticsText`. Whether `JOB_PHOTOS` is bound in production is unknown until someone opens that row. Detail: `CHANGELOG.md`.
- **Phone usability floor (2026-10-03).** Touch screens get 16 px form controls (no iOS focus zoom), thumb-sized tap-to-call/mail and brand links, labelled build-plan inputs; guard `npm run test:internal-mobile`. Production holds 0 leads, 0 quotes, 1 job (read-only check 2026-10-03): volume, not tooling, is the constraint. Detail: `CHANGELOG.md`.
- **Command Center PWA (2026-10-03).** `/internal` is installable (manifest `public/ops.webmanifest`, scope `/internal`) and tolerates no signal: `public/ops-sw.js` saves pages and assets, and a fixed allowlist of read-only data (dashboard, tasks, jobs, job-checklist, job-evidence) for 3 days; warm-up also saves each active job's Field-mode reads. **Writes are never queued** (approvals/price/state stay online); photos stay local-first as before. Logout and the login page wipe saved data; Tools â†’ Phone app shows status, install, refresh, clear. Installed copies update themselves on every deploy (build id stamped into the worker and pages; see the reference). Contract: `.ai/references/internal-pwa.md`. Test: `npm run test:internal-pwa` (in CI, after the build). Behind Access, a session end (any redirect on a data/write fetch) answers 401 `SESSION_ENDED` and wipes all saved data. Not verified on a real iPhone (iOS Safari/standalone, and the Access sign-in inside the installed app, are unproven).
- **Cloudflare Access for /internal (2026-09-30), built, off until configured.** `functions/internal/_lib/access.mjs` + `_middleware.js`: a verified Access JWT is a sign-in; the password still works unless `ACCESS_REQUIRED=1`. Needs `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` in Pages (steps in `internal/README.md`). Test: `npm run test:access` (in CI).
- **Companion Worker `workers/ops-cron/` (2026-09-30), built, not deployed.** Nightly D1 backup to private R2 and a weekday follow-up push; owner must deploy it (`internal/README.md`). Test: `npm run test:ops-cron`.
- **Abuse protection (2026-09-30).** `functions/_lib/abuse-guard.mjs`: D1 per-visitor rate limits (estimate 6/h, Ask chat 60/h, handoff 10/h, hashed IP, fail-open) are live; Turnstile: site key is wired (widget shows on /estimate); enforcement starts when the `TURNSTILE_SECRET_KEY` Pages secret is set (not yet) (steps in `internal/README.md`). Test: `npm run test:abuse-guard` (in CI).
- **Job photo backup to R2 (2026-09-30), built but not connected.** Until R2 and the `JOB_PHOTOS` binding are set up, the API answers 503 `PHOTO_STORAGE_NOT_CONFIGURED` and phone-only behavior is unchanged. Gap: Field-mode Photograph gate still trusts phone-reported counts. Tests: `npm run test:job-photos`, `test:photo-sync`. Detail: `CHANGELOG.md`.
- **Estimator pricing (2026-10-02, owner-provided).** `src/data/pricing.ts` is the source; `functions/ask/_lib/pricing.mjs` is a hand-kept copy (`npm run test:ask-pricing` fails on drift). Window openings (lowâ€“high, installed): Slider $600â€“$1,400, Double-hung $700â€“$1,400, Single-hung $700â€“$1,400, Picture/fixed $600â€“$1,500, Casement $700â€“$1,500, Awning $800â€“$1,500, Bay or bow $800â€“$1,500. The calculator and Ask show base prices only: no frame-work allowance is added to the range (removed 2026-10-02; `pricing.fullFrame` remains for the internal quote builder). Doors, the Milgard upcharge, the frame-level figure and the add-on modifiers were restored to their pre-15%-cut values on 2026-10-02 (owner confirmed), so the whole table is the owner's original (see `.ai/CHANGELOG.md`).
- **House siding page (2026-10-04).** `/siding` (`src/pages/siding.astro`): fiber cement lap and board and batten (primarily James Hardie), LP products such as SmartSide board, other wood siding; permit facts for Clark County, Camas, Battle Ground and Ridgefield from their own pages. Labor starts at $2 per sq ft on new construction and $3 on an existing home (square foot = total wall area, height times width); board and batten $3 new construction / $4 existing home, cedar $4 on any job; tear-off and new plywood $2; dry rot adds $1,500-$3,000 in labor depending on severity; material separate; `src/data/siding.ts`); manufacturer's warranty: 30 years for James Hardie siding (Hardie's own product pages), no length for other makers; four real siding photos (page hero, page section, `/gallery` Siding group); no certification claims. Linked from the primary nav (the header row is widened to 1340px above 1400px to make room for the eleventh link), the footer, home, `/replacement`, city pages and JSON-LD. Requests carry the note "House siding". Test `npm run test:siding`. Open owner items and the 90-day review rule are in `.ai/WORKING.md` "Public copy log".
- **Siding vs window work in the Command Center (2026-10-04).** Quotes carry `work_type` ('windows' | 'siding', fixed at creation; `functions/internal/_lib/work-types.mjs`); invoices copy it, jobs use it (jobs already had 'general'), leads have `service` ('siding' from the siding page, otherwise untagged = windows). Lists (quotes, invoices, jobs, leads) filter by type and every row shows a badge; the quote builder has a siding mode with the per-sq-ft labor rates from `src/data/siding.ts` (wall area = height x width). **A siding quote skips the window Build Plan** (it describes openings): signature alone approves it, `requireApprovedBuildPlan` returns early for siding and the Build Plan APIs answer 409 `SIDING_NO_BUILD_PLAN`. A signed siding quote becomes a job with no plan snapshot, no window checklist and no opening closeout (those answer 409 `SIDING_JOB`); schedule, notes, photos, payments and completion work as for any job. Window quotes keep every gate. Columns are added lazily. Test `npm run test:siding-work`. No siding install/QC knowledge is encoded (VERIFY, `.ai/WORKING.md`).
- Guide heroes (index + every article) carry an animated, reduced-motion-aware backdrop from `src/components/HeroAurora.astro` (decorative only; ambient period token `--dur-ambient`). Other `.page-hero` pages are unchanged. Detail: `CHANGELOG.md`.
- Quote follow-up cadence: `functions/internal/_lib/quote-follow-ups.mjs` creates day 2/7/14 reminders for unsigned draft quotes in `follow_up_tasks` (synced on queue reads, unique per step, auto-closed on sign/delete, never contacts customers).
- Permit leads (2026-10-02): `/internal/analytics` has a Permit leads section reading D1 tables `permit_prospects` / `permit_builders` / `permit_import_meta`, loaded by hand from `npm run build:permit-leads` (public county + L&I data; snapshot in git-ignored `data/permit-leads/`). Research data, not leads; no homeowner phone/email. Refresh and privacy steps: `internal/README.md`. Detail: `CHANGELOG.md`.
- Customer signing links: `/sign#<token>` + `functions/api/quote-sign.js` (public, token-authorized, stroke-only signatures, same Build Plan + terms gates) managed from `functions/internal/api/quote-share.js`; see `functions/internal/_lib/quote-signing.mjs`.

## Internal AI boundary

Internal AI follows deterministic routing first. AI may summarize, classify uncertainty, identify missing information, and recommend a next human action. It cannot approve gates, invent measurements/specifications/pricing/credentials/legal status, directly execute arbitrary SQL, or silently mutate business state.

Lead page-view behavior is contextual evidence only; it is not proof of customer intent. Lead Analyzer output is advisory and must be verified against the underlying record.

Command Center summarization uses a bounded server-generated snapshot rather than unrestricted D1 export. Numerical counts, totals, statuses, and transactional state remain application-owned facts.

## Deterministic Build Plan system

The application now:

- derives a plan from quote/items;
- versions and persists plans in D1;
- snapshots quote source data;
- detects stale plans when quote data changes;
- records authority/manufacturer source metadata;
- lints for missing openings, unsupported hard quantities, invented fastener specs, missing water management, missing drainage/operation checks, and quote/opening mismatches;
- recalculates quality against the current quote at state-check time;
- blocks approval on live quality blockers or stale quote data;
- records reviewer/state history;
- requires an explicit source snapshot for approval/job eligibility;
- locks an approved plan at the database layer until explicitly reopened;
- requires an approved current Build Plan before a quote can be finalized;
- requires an approved current Build Plan before a finalized quote can become a Job;
- rejects Job creation when the approved plan has changed after approval;
- snapshots the approved Build Plan into the Job;
- displays the plan in the internal Job view.

## CI / verification

The canonical test order is `.github/workflows/build.yml`; run it locally with `npm run test:all` and then `npm run build`. **GitHub Actions currently cannot run (billing issue, owner, 2026-10-01), so a missing or red Actions run is not a test result and local runs are the gate.** Cloudflare Pages previews are the independent build signal. When billing is fixed, the same suite runs in Actions with no change. Dated feature history lives in `CHANGELOG.md`.

Direct production execution of `/ask`, `/internal/copilot`, Lead Analyzer, and the Cloudflare Workers AI binding remains a deployment verification task.

## Public copy boundaries

Public pages must not state or imply who performs each step of the work: no team/staff/office claims, no "one-person" disclaimer, no personal owner name. Describe the process instead. The ICM specialists and internal pages may name the owner. See the 2026-09-27 entry in `HANDOFF.md`.

Public pages also must not name install methods (insert, full-frame, pocket, block frame, nail fin) for existing-home replacement; they say Clearview measures every opening and puts the right approach in the written estimate. Guarded by `npm run test:public-terminology`. See the 2026-09-29 entry in `HANDOFF.md`.

## Known architectural boundaries

Do not turn `.ai/` into a second database. Working artifacts can document decisions, but committed business state must remain in the application's transactional store.

Do not add an AI intent-classification hop ahead of the deterministic ICM router.

Do not treat generated confidence as human approval or evidence.

## Walk-test target

A fresh agent with no conversation memory should be able to read `CLAUDE.md`, `.ai/CONTEXT.md`, this file, and the relevant workflow contract and immediately determine where to work, what evidence is allowed, what output is required, and what remains incomplete.

### 2026-10-06 visual refinement

Replaced the initial outline card with a full-width teal gradient spotlight,
gold stars and initials avatar, larger quote, Google source badge and separate
author footer. Shared review-cards.css applies to both curated and live cards.
Checked desktop and 375px layout without horizontal overflow; review tests and
production build passed. Updated the same PR branch; production is still pending.