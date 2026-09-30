# ICM State — 2026-09-28

## Status

**Phase 2 implementation in progress:** hardened ICM foundation + deterministic Build Plan lifecycle + quote/job approval gates + Ask specialist runtime + internal AI surfaces.

## What exists

- Root `CLAUDE.md` defines the agent operating contract.
- `.ai/CONTEXT.md` is the router.
- `.ai/RULES.md` defines evidence, uncertainty, safety, synchronization, and approval rules.
- `.ai/STATE.md` records architecture state rather than mixing state into identity.
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
- The quote → plan → approval → signature → job pipeline is executed end to end by `npm run test:quote-to-job` on a real SQL engine; build-plan state transitions never refresh the quote snapshot (only an editor re-save reconciles).
- Speed-to-lead: `functions/_lib/lead-alert.mjs` sends a PII-free ntfy push per valid lead (off unless `LEAD_ALERT_NTFY_TOPIC` is set). Review request: `functions/internal/api/review-request.js` asks once per job after a finalized closeout (email or Mark's own SMS) and records it in `review_requests`.
- **Ask → person hand-off (2026-09-30).** `/ask` can now end in a call-back request, not only a link. `src/pages/ask.astro` shows the hand-off bar after two answers (or earlier once the visitor has chosen project details); `src/scripts/ask-callback.ts` owns the call-back dialog, which shows the visitor exactly what will be sent (project details plus their own questions, editable) and posts to the existing `/api/estimate` with role `Ask assistant`, so validation, the lead record, the phone alert and the email are unchanged. `src/lib/ask-handoff.ts` holds the pure helpers (estimate pre-fill query, lead notes). Hand-off taps are counted by `functions/ask/api/handoff.js` into `ask_handoffs` (kind + timestamp only, no text, no id; created on demand) and pushed to GA4 as `ask_handoff`; a submitted call-back also pushes the existing `generate_lead` event with `method: ask_callback`. `/internal/ask-logs` shows the 30-day funnel. Covered by `npm run test:ask-handoff`. The GTM tag for `ask_handoff` is set up and tested (owner, 2026-09-30). The terms page covers the consultant in its own section.
- `functions/api/google-reviews.js` + `functions/_lib/google-reviews.mjs` serve the pinned Google Business Profile's reviews to `/reviews`. Fully deterministic (no AI): fixed Place ID, name guard, bounded/sanitised output, fail-soft. It reports what Google returns and never generates or edits review text.
- `/internal/analytics` shows a deterministic requests→quotes→signed→jobs→collected pipeline from D1 (`functions/internal/_lib/pipeline-summary.mjs`); stage totals are independent counts; per-source revenue is traced through `quotes.lead_id` (set by *Start quote* or confirmed by Mark from exact phone/email suggestions, never auto-linked; `functions/internal/_lib/lead-links.mjs`).
- `/internal/analytics` renders its data as charts (funnel, signed $ by source, lead-source and channel donuts, landing-page and top-page bars, weekly lead columns, 28-day GA4 sessions/visitors lines) via dependency-free SVG builders in `src/lib/charts.ts` (`npm run test:charts`, in CI). The page must not use innerHTML (existing test), so SVG is mounted with DOMParser + importNode. GA4 adds a fifth `batchRunReports` request (`daily`, max 31 days); charts for GA4 appear only when GA4 is connected. Charts are a view over the same numbers; D1/GA4 remain the truth.
- **General (non-window) jobs, track-only (2026-09-30).** Mark can add a customer and a job directly at `/internal/jobs/new` for work that is not a window job: no quote, no Build Plan, no in-app contract (his agreement stays on his own paper; an optional contract date is only a note). Stored on `jobs` with `work_type='general'` (existing rows default to `'windows'`), `work_description` (free text), `agreed_cents`, `contract_date`; `quote_id` stays NULL. Validation is deterministic in `functions/internal/_lib/general-jobs.mjs` (also owns the lazy column migration `ensureGeneralJobColumns`, called by the jobs, payments and dashboard endpoints so page-open order after a deploy cannot matter). Payments and the dashboard take a job's total from `COALESCE(quote total, agreed_cents)`; the agreed amount cannot be edited below what is recorded as paid. General jobs skip the window checklist/closeout gate when completed; window jobs are gated exactly as before and cannot take general edits. Analytics keeps general jobs out of the quote→job funnel counts but includes their money in Collected (`jobs.otherWork`). Covered by `npm run test:general-jobs` (real SQLite, in CI). **Contact import:** the new-job form can fill the customer fields from a phone contact: the browser Contact Picker where offered (Chrome on Android; button is hidden elsewhere) or a `.vcf` file (every phone; on iPhone: Share Contact → Save to Files). Parsing is pure and client-side in `src/lib/contact-import.ts` (vCard 2.1/3.0/4.0, folded lines, quoted-printable, multi-contact files with a chooser); nothing is sent or stored until Mark saves the job, and an import replaces all five customer fields so two contacts never mix. `npm run test:contact-import` (in CI). The `jobs` table is created by `ensureJobsSchema` (`functions/internal/_lib/jobs-schema.mjs`), which the jobs API, dashboard, Payments and copilot summary all call first. **Not built (by design, until Mark needs it):** quotes/invoices/signing for general work, a separate customer list, follow-up tasks or lead attribution for these customers, contract/warranty text for non-window work (never invent it).
- **Cloudflare Access for /internal (2026-09-30), built, off until configured.** `functions/internal/_lib/access.mjs` + `_middleware.js`: a verified Access JWT is a sign-in; the password still works unless `ACCESS_REQUIRED=1`. Needs `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` in Pages (steps in `internal/README.md`). Test: `npm run test:access` (in CI).
- **Companion Worker `workers/ops-cron/` (2026-09-30), built, not deployed.** Nightly D1 backup to private R2 `clearview-db-backups` (30 kept, verified after write, failure pushed) and a weekday follow-up count push. Restore script `scripts/restore-from-backup.mjs`. Owner must `wrangler deploy` it and set `LEAD_ALERT_NTFY_TOPIC` (steps in `internal/README.md`). Test: `npm run test:ops-cron` (in CI).
- **Abuse protection (2026-09-30).** `functions/_lib/abuse-guard.mjs`: D1 per-visitor rate limits (estimate 6/h, Ask chat 60/h, handoff 10/h, hashed IP, fail-open) are live; Turnstile on the estimate form is built but inactive until `site.turnstileSiteKey` and the `TURNSTILE_SECRET_KEY` secret are set (steps in `internal/README.md`). Test: `npm run test:abuse-guard` (in CI).
- **Job photo backup to R2 (2026-09-30), built but not yet connected.** Photos from the Photos tool are saved on the phone first (IndexedDB, unchanged), then compressed (max 2000 px JPEG) and uploaded to a private Cloudflare R2 bucket through `functions/internal/api/job-photos.js` (binding `JOB_PHOTOS`; one row per photo in D1 `job_photos`, validation in `functions/internal/_lib/job-photos.mjs`: type sniffed from bytes, JPEG/PNG/WebP only, 8 MB cap, idempotent on the phone's photo id, orphan file deleted if the row fails). The phone logic (`src/lib/photo-sync.ts`) uploads oldest first, stops on the first connection/sign-in/not-connected failure, never removes a local photo because an upload failed, and resumes on page load and the `online` event. The Photos page shows the backup state, marks each photo, shows photos taken on other devices, and deletes both copies. **Until R2 is enabled, the bucket created and the `JOB_PHOTOS` binding added in the Pages dashboard (steps in `internal/README.md`), the API answers 503 `PHOTO_STORAGE_NOT_CONFIGURED` and everything behaves as before.** Not done yet: the Field-mode Photograph gate still trusts phone-reported counts (`job_opening_evidence.photo_summary_json`) rather than counting R2 photos, and Field mode's photo counts read the local phone only. Tests: `npm run test:job-photos` (real SQLite + in-memory R2), `npm run test:photo-sync` (both in CI).
- Quote follow-up cadence: `functions/internal/_lib/quote-follow-ups.mjs` creates day 2/7/14 reminders for unsigned draft quotes in `follow_up_tasks` (synced on queue reads, unique per step, auto-closed on sign/delete, never contacts customers).
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

The GitHub build workflow runs the full regression suite (`test:icm`, `test:build-plan-state`, `test:build-plan-integration`, `test:production-hardening`, `test:marketing-platform`, `test:ask-security`, `test:recent-fixes`, `test:copilot`, `test:ai-surfaces`, `test:google-reviews`, `eval:build-plan`) and the production build. It does execute. Two failure modes exist: a ~4 s failure where no runner is allocated (GitHub-side infrastructure, not a test result) and a longer failure that is a real test failure; reproduce the latter locally with the same sequence from `.github/workflows/build.yml`. Cloudflare Pages previews are an independent build signal.

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
