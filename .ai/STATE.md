# ICM State â€” 2026-10-01

## 2026-10-09 - Supplier permit list in the Command Center (branch `claude/supplier-permit-list`)

Keith asked to enrich the weekly permit report from Mark's supplier (Construction Monitor, week 40: Oct 1 to 7, Portland / Vancouver / Salem) and load it into the internal platform. New: Analytics > "Supplier permit list" (counts, two charts, a builders table, a filterable permit list and a spreadsheet download), the endpoint `/internal/api/supplier-permits` (summary without personal data; list and CSV as separate requests behind the session gate, `no-store`), tables `supplier_permits` / `supplier_import_meta` (created by the SQL file), and the pipeline: `parse-construction-monitor.py` (PDF to JSON by position, self-checked against the report's own week totals) then `npm run build:supplier-permits` (joins each Clark County permit to its county parcel by permit case or street, latest sale, WA L&I license by exact business name, the permit-leads and mail-pilot lists, and five equal-weight fit signals on remodel / ADU / re-roof permits). Loading is a merge keyed by permit number: weekly reports add up, first_seen is kept, nothing is deleted, an older file never overwrites newer rows. Week 40 build: 197 Clark County permits (48 new homes, 44 remodels, 8 ADUs, 56 commercial), 178 matched to a county parcel (19 left blank: no street, new lot, or several parcels at one address), 170 with an owner phone printed in the report, 26 already in permit leads and 4 in the mail pilot, 41 contractors matched to an active L&I license. Oregon permits (428 in this report) are skipped: no free parcel, sale or license source is wired in.

Licence and privacy: the report is licensed to one subscriber and forbids sharing, and it holds owner names, mailing addresses and phones, in a public repository. The PDF, the parsed JSON, the SQL and the CSV stay outside git (`data/supplier-permits/` is git-ignored; the parser and the build refuse any other folder in the repo). Owner phones render as plain text; Washington restricts unsolicited calls and texts, so mail is the channel for homeowners. Keith gave the go-ahead to load it after these caveats were raised; this session did not see Mark told what the section holds, so Keith should make sure he knows. Contract: `.ai/workflows/supplier-permits/CONTEXT.md`; steps: `internal/README.md`. Tests: `npm run test:supplier-permits` (report validation, parcel / builder / license joins, fit signals, query safety, merge SQL on a real SQL engine, endpoint, session gate, CSV safety, page and docs wiring) and `npm run test:internal-pwa` (the API is never cached), both in `npm run test:all` and CI. The PDF parser is not in CI (it needs a licensed report); its totals self-check is the guard.

Production load: PENDING until this branch is merged and deployed, then run `data/supplier-permits/supplier-permits.sql` against `clearveiw-quotes` in Mark's account (the SQL is on the machine that built it, not in git). VERIFY after loading: the Analytics section shows week 40 with 197 permits. Revenue note: this is research data; it adds no customer, quote or job, and production still has few of those. Treat it as a way to find window and trim work on permits already pulled, not as more tooling to build.

## 2026-10-09 - Google operations tools (account activation pending)

Added Command Center > Tools > Google tools: Search Console top queries/pages, Business Profile metrics/reviews, address validation, Routes waypoint planning, five-day Weather, Document AI receipt/invoice extraction, Cloud Vision label OCR, owned Calendar reads/reviewed appointment creation, and manually reviewed USD expenses. Reports and proposals stay separate from job state; no automatic customer messaging, payments, quote changes or schedule changes. Scoped server credentials, authenticated same-origin writes, bounded uploads/results, fixed endpoints/timeouts and D1 daily attempt caps enforce the boundary. Conflicting retry IDs are rejected; expense saves use integer cents. Full 50-step suite passed with a 69-page build; final 69-page build passed after the attribution and upload controls. Merged code commit b8b6d34 to main; Cloudflare production deployment 4b98c654-f62c-43e2-81d4-dac32607fa2b is Active. Canonical PWA files carry b8b6d34 and pass the live check; both new page and API redirect unauthenticated requests to Access. Authenticated UI/API/provider tests remain VERIFY.

VERIFY: browser control repeatedly timed out, so no new APIs/credentials/roles/OAuth grants or Document AI processor have been activated this turn. Existing GA4 reader may supply Search Console auth only after that service-account email receives property access. Business Profile project approval can block reports/reviews. New connections must be live-tested; configured flags do not assert access. Authenticated desktop/phone UI and production connection tests await browser reconnection. Setup details: `.ai/references/google-operations.md` and `internal/README.md`.



## 2026-10-09 - Website buying intent and Tag Manager audit

Added fixed, privacy-limited buying-intent events for service/pricing/reviews visits, calculator starts/results/handoffs, estimate and callback form progress/errors, consultant starts, FAQ opens, review/email/download/outbound clicks, active reading and studio starts. Browser counters expire after 90 days and honor GPC/DNT. Submitted leads carry bounded, allowlisted activity to a lazily added intent_json column; Leads displays fixed signals, browser sessions and deterministic engagement score. GA4 Analytics adds a fail-soft 28-day behavior chart. Updated privacy disclosures. No form contents or internal visitor ID enter GA4.

Browser GTM audit paused duplicate generated GA4 config/event bridge tags, sanitized URLs/referrers/clicks, narrowed Meta's broad custom trigger and limited Ahrefs initialization to once per page. GA4 enhanced automatic form/search/outbound/download events were disabled in favor of explicit counts. Synthetic local calculator and form-start flow appeared in Google DebugView; transport URLs exclude scope/query notes. Chrome DNT=1 independently suppressed new events. The local test fixture is discarded by the final rebuild. After integrating main's new quote planner, all 49 required checks passed and the final build produced 68 pages. GTM version 12 is live, including separate sanitized public campaign identifiers; Cloudflare deployed 0587d5f successfully to the canonical domain. Live requests verified clean page URLs and separate public campaign metadata. Disabled Google tag user-provided data capabilities after identifying automatic contact-data detection. Estimate handoff removes project details while retaining only sanitized campaign identifiers, preventing late tag loading from losing campaign attribution. The revised 49-step suite and final 68-page build passed. Internal live UI sign-in rejected the active Cloudflare account; authorized sign-in is pending, so GA4 server reader connection remains unverified.
## 2026-10-09 - No public pricing (calculator is now a quote funnel)

Owner direction (Mark): no dollar figures anywhere on the public site. One switch, `publicPricing = false` in `src/data/pricing.ts`, mirrored as `PUBLIC_PRICING` in `functions/ask/_lib/pricing.mjs` (`npm run test:ask-pricing` fails on drift). The price data itself is untouched and still feeds the Command Center quote builder. The calculator page (URL unchanged) is now a project planner: count openings, pick window line and details, then "Get my free quote" carries the scope into `/estimate` notes (existing `scope` handoff). Its serialised model carries no prices. Dollar figures and price-like claims were removed from the siding page (rates stay in `src/data/siding.ts`), sliding glass doors (rows and `Offer` schema), the cost / Cascade-vs-Milgard / vinyl-vs-fiberglass guides (information kept, numbers dropped), About, tools index, shared CTA and hero links, and the JSON-LD `priceRange`. Ask no longer offers `estimate_price`, its prompt and facts say Clearview does not publish prices, and any `$` figure in a reply is a violation that triggers the repair path. Guard: `npm run test:no-public-pricing` (scans built public HTML, after build); `test:siding`, `test:pricing-health` updated.

**Not done / open:** the Ask guide index text was patched in place (no embedding keys here); re-run `npm run build:guides-index` when a key is available. The site tagline "Great prices." is unchanged (a claim, not a figure; Mark's call). Legal pages (terms, privacy, accessibility) only had the tool's name adjusted; Keith should eyeball them.

## 2026-10-08 - Google reviews visibility and branded panel

Added Reviews to desktop and mobile navigation, and live Google rating badges to the home hero, shared estimate CTA, footer and estimate form sidebar. A shared browser request updates ratings across page transitions without extra requests for each badge. Failed feeds leave a plain reviews link without a rating claim. The reviews page now leads with a white Google-branded panel, Google logo, gold stars, live rating/count, three written customer reviews and a direct write-review button. Customer text still uses textContent. Corrected the dated fallback to the verified 5.0 / 4 ratings on 2026-10-08. Review cards now reinitialize on client navigation.

Validation: all 48 test:all steps; browser checks at 320, 390, 1401, 1440, 1481 and 1920 px found no horizontal overflow or desktop navigation overlap. Live Google feed was used in the local preview; repeat menu navigation loads all three written reviews and the estimate sidebar shows the live rating. Generic fallback was checked with the endpoint unavailable. Publication and final live verification follow the main push.

## 2026-10-08 - Audit and bug-fix pass on the Command Center and phone app (branch `claude/internal-pwa-audit`)

Five bugs fixed with regression tests (`npm run test:internal-audit`, a new CI step): Field mode's evidence save used snake_case keys the API refuses, so the Verify gate and therefore job completion could not be done from the phone; the Build Plan editor accepted client-supplied state, approver and history; a malformed `cv_session` cookie caused a 500; the quote builder blocked the save without a message on a fractional or blank quantity; the Mail pilot break-even box showed a profit message when profit was not the problem. The phone app (service worker, offline, expiry, Access redirect, logout) held up under a real-browser test and was not changed. Decisions left open for Mark or Keith (approval actor, photo-count trust, Origin checks, 30-day cookie after logout, fractional quantities, a few gate and dashboard edge cases) are in `HANDOFF.md`. Not testable here: a real iPhone and the live Access sign-in. Full detail: `.ai/CHANGELOG.md` (2026-10-08, audit).

## 2026-10-08 - Mail pilot in the Command Center (branch `claude/mail-pilot-internal`)

New page `/internal/mail-pilot` (Tools > Mail pilot) for the direct-mail test: homes in Clark County WA that sold or pulled a re-roof/remodel permit, built from public county records, sorted into groups A-E by one deterministic rule set (`functions/internal/_lib/mail-pilot.mjs`), with charts, a break-even box that takes Mark's own numbers, and a mail-merge CSV. The first pull holds 528 homes; wave 1 (groups A, B, C) is 193. Data is loaded by hand into D1 tables `mail_pilot_properties` / `mail_pilot_meta` from the git-ignored `data/mail-pilot/` (the repository is public and the data is street addresses); loading is a merge, so printed `CV-####` codes never change. Contract: `.ai/workflows/mail-pilot/CONTEXT.md`; steps and privacy: `internal/README.md`. Tests: `npm run test:mail-pilot` (rules, loader validation, merge SQL on a real engine, endpoint, session gate and address-file guards, CSV safety, break-even math) and `npm run test:internal-pwa` (the API is never cached by the service worker), both in `npm run test:all` and CI; real-browser pass at desktop and phone width, empty state included.

**Not done / owner-side:** (1) Done 2026-10-08: the 528 homes were loaded into Mark's production D1 (CV-0001 to CV-0528; groups 13 / 45 / 135 / 150 / 185; counts and checksums matched the load file). Re-pulls are merge loads (see `internal/README.md`, "Which database": the repo's `wrangler.toml` is not the production database). (2) The reference-code link (`utm_campaign=CV-####`) rides the site's existing first-touch UTM capture but has not been proven end to end in production; check the first real request in Leads. (3) The county pull that produces the properties file is not scripted in this repo yet, so the mid-November re-pull (about six weeks after the window, to catch late-posted sales) needs that step rebuilt or repeated by hand. (4) Clearview's average job value, margin and close rate are not known; the break-even box shows nothing until they are typed in. (5) Group D is an optional later comparison batch, not a withheld control.

## 2026-10-08 - Permit answers on city pages and door-hanger tracking link

Camas, Battle Ground, Ridgefield, La Center and Brush Prairie city pages each gain a permit FAQ item and a short section linking the permit guide; wording restates the guide's primary-source findings only (Vancouver, Washougal, Woodland unchanged until verified). `/neighbors` redirects (302) to `/estimate?utm_source=doorhanger&utm_medium=print&utm_campaign=jobsite-neighbors` so a printed QR code is short and leads show as "Arrived via doorhanger/print". Print file lives outside the repo (4.25 x 11 in door hanger with the QR). Validation: all 46 test:all steps. Production verification follows the main push.

## 2026-10-07 - Existing repository photo resolution refresh

Audited all 87 tracked raster assets. Fourteen existing photographs below 4K are enhanced with Higgsfield at its maximum 4K setting and replace their sources at the same paths. The unused window-features-installation.jpg reuses the existing window-features-installation-4k.png master. Existing high-resolution job photos, logos, diagrams and model posters are retained. Original photo order, captions, alt text and page placements are unchanged; source aspect ratios are preserved within the upscaler's minor dimension rounding. JPEG exports omit EXIF. Before/after comparisons are inspected, including the retained door-number privacy blur.

WorkCard now supplies 680px and 900px WebP variants for high-density screens, retaining its 450px fallback and the same layout. Inventory and source dimensions: docs/REPO-PHOTO-AUDIT-2026-10-07.md. Validation: all 46 test:all steps and a separate production build passed. Local Edge checks at 1440px, 375px and 320px verify gallery photo order/alt text, image decoding on gallery/siding/guide pages, no horizontal overflow, and 900px image delivery on a 2x desktop screen. Production verification follows the main push.


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
- Mail pilot (2026-10-08): `/internal/mail-pilot` reads D1 tables `mail_pilot_properties` / `mail_pilot_meta`, loaded by hand from `npm run build:mail-pilot` (public county records; address file in git-ignored `data/mail-pilot/`, merge-load keeps printed `CV-####` codes). Research data, not leads; segment rules in one module. Loaded into production 2026-10-08 (528 homes). Contract: `.ai/workflows/mail-pilot/CONTEXT.md`. Detail: `CHANGELOG.md`.
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