# ICM State — 2026-10-01

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
- The quote → plan → approval → signature → job pipeline is executed end to end by `npm run test:quote-to-job` on a real SQL engine; build-plan state transitions never refresh the quote snapshot (only an editor re-save reconciles).
- Speed-to-lead: `functions/_lib/lead-alert.mjs` sends a PII-free ntfy push per valid lead (off unless `LEAD_ALERT_NTFY_TOPIC` is set). Review request: `functions/internal/api/review-request.js` asks once per job after a finalized closeout (email or Mark's own SMS) and records it in `review_requests`.
- **Ask → person hand-off (2026-09-30).** `/ask` can end in a call-back request that posts to the existing `/api/estimate`; taps are counted in D1 (`ask_handoffs`, no text) and in GA4. Tests: `npm run test:ask-handoff`. Detail: `CHANGELOG.md`.
- `functions/api/google-reviews.js` + `functions/_lib/google-reviews.mjs` serve the pinned Google Business Profile's reviews to `/reviews`. Fully deterministic (no AI): fixed Place ID, name guard, bounded/sanitised output, fail-soft. It reports what Google returns and never generates or edits review text.
- `/internal/analytics` shows a deterministic requests→quotes→signed→jobs→collected pipeline from D1 (`functions/internal/_lib/pipeline-summary.mjs`); stage totals are independent counts; per-source revenue is traced through `quotes.lead_id` (set by *Start quote* or confirmed by Mark from exact phone/email suggestions, never auto-linked; `functions/internal/_lib/lead-links.mjs`).
- `/internal/analytics` renders its numbers as dependency-free SVG charts (`src/lib/charts.ts`, `npm run test:charts`). Charts are a view; D1/GA4 remain the truth. Detail: `CHANGELOG.md`.
- **General (non-window) jobs, track-only (2026-09-30).** Mark can add a customer and job at `/internal/jobs/new` with no quote or Build Plan (`work_type='general'`). Validation: `functions/internal/_lib/general-jobs.mjs`. Tests: `npm run test:general-jobs`, `test:contact-import`. Not built by design: quotes/invoices/signing, warranty text for non-window work. Detail: `CHANGELOG.md`.
- **AI Gateway + model-aware embeddings (2026-10-01).** Groq/Gemini route through Cloudflare AI Gateway when `AI_GATEWAY_URL` is set; Ask embeds with the model named in `guides-index.json`. Tests: `npm run test:embeddings`. Detail: `CHANGELOG.md`.
- **Cloudflare Access for /internal (2026-09-30), built, off until configured.** `functions/internal/_lib/access.mjs` + `_middleware.js`: a verified Access JWT is a sign-in; the password still works unless `ACCESS_REQUIRED=1`. Needs `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` in Pages (steps in `internal/README.md`). Test: `npm run test:access` (in CI).
- **Companion Worker `workers/ops-cron/` (2026-09-30), built, not deployed.** Nightly D1 backup to private R2 and a weekday follow-up push; owner must deploy it (`internal/README.md`). Test: `npm run test:ops-cron`.
- **Abuse protection (2026-09-30).** `functions/_lib/abuse-guard.mjs`: D1 per-visitor rate limits (estimate 6/h, Ask chat 60/h, handoff 10/h, hashed IP, fail-open) are live; Turnstile: site key is wired (widget shows on /estimate); enforcement starts when the `TURNSTILE_SECRET_KEY` Pages secret is set (not yet) (steps in `internal/README.md`). Test: `npm run test:abuse-guard` (in CI).
- **Job photo backup to R2 (2026-09-30), built but not connected.** Until R2 and the `JOB_PHOTOS` binding are set up, the API answers 503 `PHOTO_STORAGE_NOT_CONFIGURED` and phone-only behavior is unchanged. Gap: Field-mode Photograph gate still trusts phone-reported counts. Tests: `npm run test:job-photos`, `test:photo-sync`. Detail: `CHANGELOG.md`.
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
