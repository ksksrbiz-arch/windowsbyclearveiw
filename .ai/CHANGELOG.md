# ICM Changelog

Dated detail moved out of `STATE.md` on 2026-10-01 so `STATE.md` can stay a current-state snapshot.
History only: load this to answer "why was X built this way?", not to learn the current state.
Newest entries go at the top. Entries below are verbatim from `STATE.md` as of 2026-10-01.

## 2026-10-01 — Editing a draft revokes its unsigned signing links

- `functions/internal/api/quotes/[id].js` PUT: any edit to a draft quote now revokes that quote's unsigned customer signing links in the same batch as the update, so a customer cannot sign totals they never saw. The response includes `signLinkRevoked`. Sending a new link still requires the Build Plan to be re-approved (existing `BUILD_PLAN_STALE` gate). Covered by `npm run test:quote-signing` (owner approved the change, 2026-10-01).

## 2026-10-01 — Audit round 2: ask-logs parsing, tasks list without quote_id

- `src/pages/internal/ask-logs.astro`: `tools_used` / `sources` are parsed defensively, so one malformed row no longer blanks the whole list.
- `functions/internal/api/tasks.js` GET: if the lazy follow-up sync fails and `follow_up_tasks.quote_id` is missing, the queue still lists (without the quote join) instead of returning 500. No regression test: the sync re-adds the column on the same request, so the failure path is not reproducible in the harness.

## 2026-10-01 — Animated guide heroes

- New `src/components/HeroAurora.astro`: a decorative, `aria-hidden` backdrop for the guide heroes — three slow teal/clay colour fields (transform-only drift, periods 1x/1.3x/0.9x of the new `--dur-ambient` token so the loop never visibly repeats), a faint window-mullion grid, and a soft glint that sweeps across then rests. `tone="dark"` is used on the guide article hero (`src/pages/guides/[slug].astro`, which also gets a min-height and bottom-aligned copy); `tone="light"` on the guides index hero (`src/pages/guides/index.astro`), pulled back and masked off the copy column so the grey labels keep their contrast.
- `prefers-reduced-motion` freezes the fields at their resting positions and hides the glint; print hides the whole layer. `--dur-ambient` is deliberately not in the reduced-motion duration zeroing (a 0s infinite loop would spin), so the component switches its own animations off.
- Measured, not assumed: worst-case hero text contrast over a full 30s cycle was 6.10:1 (small meta line, brightest pixel under it); no horizontal overflow at 390px. Not applied to other `.page-hero` pages — opt-in per page.

## 2026-10-01 - Public pages audit

- `/areas` meta description now takes the phone from `site.phone` instead of a hardcoded number; regression assertion in `scripts/test-public-terminology.mjs`.
## 2026-10-01 — Unit 10 audit fixes

- `workers/ops-cron/src/backup.mjs`: blob columns are base64-encoded in chunks; spreading a large blob into `String.fromCharCode` overflowed the stack and would have failed the nightly backup.
- `src/pages/internal/tools/measurements.astro` and `photos.astro`: `esc()` now escapes quotes, since values are interpolated into HTML attributes (a room name containing `"` broke the field).
- Regression assertions in `scripts/test-ops-cron.mjs`, `scripts/test-recent-fixes.mjs`.
## 2026-10-01 — Lead capture audit fixes

- `functions/api/estimate.js`: the alert email's "Email <name>" mailto button now percent-encodes the address (a legal local part such as `a?cc=b` could otherwise add mailto header fields). Regression test in `scripts/test-estimate-endpoint.mjs`.
- `src/components/EstimateForm.astro`: after a JS submit succeeds the success panel receives focus so screen-reader and keyboard users are not left on a hidden button.
## 2026-10-01 — Internal API audit fixes (unit 9)

- `payments.js`: `amountPaidCents` of `""`, `null`, `true`, `[]` no longer coerces to 0/1 and rewrites the payment record; refused with 400.
- `jobs.js` PATCH: `scheduledDate` must be a real `YYYY-MM-DD` (was free text, truncated to 10 chars).
- `quotes/[id].js` PATCH: digital-signature UPDATE bound 4 values to 5 placeholders (signing on Mark's device could not finalize); fixed, test in `test-quote-to-job-flow.mjs`. Signing UPDATE is also conditional on `status = 'draft'` so two concurrent signatures cannot both finalize.
- `tasks.js` POST: `leadId` null/blank/0 stores NULL (was `Number(null) = 0`). Regression asserts in `scripts/test-general-jobs.mjs`.
## 2026-10-01 — Internal UI escape helpers escape quotes

- Internal pages' `esc`/`escapeHtml` helpers (textContent to innerHTML) did not escape `"` or `'`, so customer/plan text interpolated into `value="..."` / `href="..."` attributes could break out of the attribute. They now escape quotes too; `scripts/test-internal-runtime-styles.mjs` asserts it.
## 2026-10-01 - /ask audit fixes
- `/ask/api/*` rate-limit bucket lookup ignores a trailing slash (was `''`, which skipped the limit).
- `/ask/api/chat` returns 400 for `null`/array JSON bodies instead of throwing; Groq tool-call arguments that parse to non-objects are treated as invalid.
- Regression assertions in `scripts/test-ask-security.mjs`.
## 2026-10-01 — Signature points must be numbers

- `quote-signing.mjs` `renderSignatureSvg`: stroke points are now required to be JSON numbers; previously `null`, `""` or `true` were coerced to 0 and accepted. Regression assertion in `scripts/test-quote-signing.mjs`.

## 2026-10-01 — Guide share sheet

- `src/pages/guides/[slug].astro`: added a **Share** button that opens the device share sheet (Web Share API: title + canonical guide URL). It is hidden until the browser supports `navigator.share`. The per-guide "Share on Nextdoor" link was removed (owner, 2026-10-01); Nextdoor stays in the header/footer business links only. No data is sent anywhere until the visitor picks a target.

## 2026-10-01 — ICM alignment pass

- Root `CLAUDE.md` reduced to a routing-only file with load/exclusion tables; Ask routing and ICM rules moved to `.ai/references/ask-routing.md` and `.ai/references/icm-rules.md`.
- Added a Completion section to every stage, workflow and specialist contract.
- Added workflows: `public-copy-sweep`, `lead-to-quote`, `job-closeout`, `analytics-events`, `deploy-check`.
- Added `npm run test:icm-structure` and `npm run test:all`.
- Folder name stays `.ai/` (decision 2026-10-01).
- GitHub Actions cannot run (billing issue, owner, 2026-10-01); local runs are the gate.

## Feature detail moved from STATE.md (2026-10-01)

- **Ask → person hand-off (2026-09-30).** `/ask` can now end in a call-back request, not only a link. `src/pages/ask.astro` shows the hand-off bar after two answers (or earlier once the visitor has chosen project details); `src/scripts/ask-callback.ts` owns the call-back dialog, which shows the visitor exactly what will be sent (project details plus their own questions, editable) and posts to the existing `/api/estimate` with role `Ask assistant`, so validation, the lead record, the phone alert and the email are unchanged. `src/lib/ask-handoff.ts` holds the pure helpers (estimate pre-fill query, lead notes). Hand-off taps are counted by `functions/ask/api/handoff.js` into `ask_handoffs` (kind + timestamp only, no text, no id; created on demand) and pushed to GA4 as `ask_handoff`; a submitted call-back also pushes the existing `generate_lead` event with `method: ask_callback`. `/internal/ask-logs` shows the 30-day funnel. Covered by `npm run test:ask-handoff`. The GTM tag for `ask_handoff` is set up and tested (owner, 2026-09-30). The terms page covers the consultant in its own section.

- `/internal/analytics` renders its data as charts (funnel, signed $ by source, lead-source and channel donuts, landing-page and top-page bars, weekly lead columns, 28-day GA4 sessions/visitors lines) via dependency-free SVG builders in `src/lib/charts.ts` (`npm run test:charts`, in CI). The page must not use innerHTML (existing test), so SVG is mounted with DOMParser + importNode. GA4 adds a fifth `batchRunReports` request (`daily`, max 31 days); charts for GA4 appear only when GA4 is connected. Charts are a view over the same numbers; D1/GA4 remain the truth.

- **General (non-window) jobs, track-only (2026-09-30).** Mark can add a customer and a job directly at `/internal/jobs/new` for work that is not a window job: no quote, no Build Plan, no in-app contract (his agreement stays on his own paper; an optional contract date is only a note). Stored on `jobs` with `work_type='general'` (existing rows default to `'windows'`), `work_description` (free text), `agreed_cents`, `contract_date`; `quote_id` stays NULL. Validation is deterministic in `functions/internal/_lib/general-jobs.mjs` (also owns the lazy column migration `ensureGeneralJobColumns`, called by the jobs, payments and dashboard endpoints so page-open order after a deploy cannot matter). Payments and the dashboard take a job's total from `COALESCE(quote total, agreed_cents)`; the agreed amount cannot be edited below what is recorded as paid. General jobs skip the window checklist/closeout gate when completed; window jobs are gated exactly as before and cannot take general edits. Analytics keeps general jobs out of the quote→job funnel counts but includes their money in Collected (`jobs.otherWork`). Covered by `npm run test:general-jobs` (real SQLite, in CI). **Contact import:** the new-job form can fill the customer fields from a phone contact: the browser Contact Picker where offered (Chrome on Android; button is hidden elsewhere) or a `.vcf` file (every phone; on iPhone: Share Contact → Save to Files). Parsing is pure and client-side in `src/lib/contact-import.ts` (vCard 2.1/3.0/4.0, folded lines, quoted-printable, multi-contact files with a chooser); nothing is sent or stored until Mark saves the job, and an import replaces all five customer fields so two contacts never mix. `npm run test:contact-import` (in CI). The `jobs` table is created by `ensureJobsSchema` (`functions/internal/_lib/jobs-schema.mjs`), which the jobs API, dashboard, Payments and copilot summary all call first. **Not built (by design, until Mark needs it):** quotes/invoices/signing for general work, a separate customer list, follow-up tasks or lead attribution for these customers, contract/warranty text for non-window work (never invent it).

- **AI Gateway + model-aware embeddings (2026-10-01).** `functions/_lib/ai-gateway.mjs` routes Groq/Gemini calls through Cloudflare AI Gateway when `AI_GATEWAY_URL` is set (payload logging off, direct fallback, keys in headers). `functions/ask/_lib/embeddings.mjs` embeds Ask queries with the model named in `guides-index.json` (Gemini today; Workers AI `@cf/baai/bge-m3` supported, index not yet rebuilt, its `minScore` is a placeholder until `npm run eval:retrieval` is run with credentials). Tests: `npm run test:embeddings` (in CI).

- **Companion Worker `workers/ops-cron/` (2026-09-30), built, not deployed.** Nightly D1 backup to private R2 `clearview-db-backups` (30 kept, verified after write, failure pushed) and a weekday follow-up count push. Restore script `scripts/restore-from-backup.mjs`. Owner must `wrangler deploy` it and set `LEAD_ALERT_NTFY_TOPIC` (steps in `internal/README.md`). Test: `npm run test:ops-cron` (in CI).

- **Job photo backup to R2 (2026-09-30), built but not yet connected.** Photos from the Photos tool are saved on the phone first (IndexedDB, unchanged), then compressed (max 2000 px JPEG) and uploaded to a private Cloudflare R2 bucket through `functions/internal/api/job-photos.js` (binding `JOB_PHOTOS`; one row per photo in D1 `job_photos`, validation in `functions/internal/_lib/job-photos.mjs`: type sniffed from bytes, JPEG/PNG/WebP only, 8 MB cap, idempotent on the phone's photo id, orphan file deleted if the row fails). The phone logic (`src/lib/photo-sync.ts`) uploads oldest first, stops on the first connection/sign-in/not-connected failure, never removes a local photo because an upload failed, and resumes on page load and the `online` event. The Photos page shows the backup state, marks each photo, shows photos taken on other devices, and deletes both copies. **Until R2 is enabled, the bucket created and the `JOB_PHOTOS` binding added in the Pages dashboard (steps in `internal/README.md`), the API answers 503 `PHOTO_STORAGE_NOT_CONFIGURED` and everything behaves as before.** Not done yet: the Field-mode Photograph gate still trusts phone-reported counts (`job_opening_evidence.photo_summary_json`) rather than counting R2 photos, and Field mode's photo counts read the local phone only. Tests: `npm run test:job-photos` (real SQLite + in-memory R2), `npm run test:photo-sync` (both in CI).
