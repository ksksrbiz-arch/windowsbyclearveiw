# ICM Changelog

Dated detail moved out of `STATE.md` on 2026-10-01 so `STATE.md` can stay a current-state snapshot.
History only: load this to answer "why was X built this way?", not to learn the current state.
Newest entries go at the top. Entries below are verbatim from `STATE.md` as of 2026-10-01.

## 2026-10-02 — Estimator and Ask show base prices only (frame-work allowance removed)

- Owner direction: the public calculator showed more than the base table (one slider read $850–$2,000 against $600–$1,400) because it added the frame-work allowance ($680–$1,700) across a third of the openings. That addition is removed from `src/components/CostEstimator.astro` and from the Ask copy `functions/ask/_lib/pricing.mjs` (and its `fullFrame` copy). The range is now the base opening prices x material, plus the Milgard upcharge on windows, plus the modifiers a visitor ticks.
- The note under the range no longer says it "allows for about a third of the openings needing more work". It now says these are base prices for standard openings and that extra work found at the measure is stated in the written estimate before anything is ordered (existing site wording; no new figures).
- `pricing.fullFrame` stays in `src/data/pricing.ts` because the internal quote builder (`src/pages/internal/quotes/new.astro`) uses it for the full-frame method; its blurb now says so.
- `scripts/test-ask-pricing-sync.mjs`: hand-worked checks are now 5 double-hung = $3,500–$7,000 and 1 slider = $600–$1,400. Viewed in a browser: 1 slider shows $600 – $1,400; 1 slider + 4 double-hung shows $3,400 – $7,000.
- Open (VERIFY, owner): jobs that do need frame work now come in above what the page quoted, by design. Whether doors, the Milgard upcharge and the modifiers should also return to earlier values is still undecided.

## 2026-10-02 — Homepage "New construction" card shows the page's own hero photo

- `src/pages/index.astro`: the New construction service card now uses `new-build-tan-corner`, the same photo as the `/new-construction` hero, instead of `new-build-sheathed-garage`. One line; `/new-construction`'s social-card image is unchanged. Viewed at 1280 px and 390 px.

## 2026-10-02 — Window opening prices set to owner's table

- `src/data/pricing.ts` and `functions/ask/_lib/pricing.mjs`: the seven window openings set to the owner's figures — Slider $600–$1,400, Double-hung $700–$1,400, Single-hung $700–$1,400, Picture/fixed $600–$1,500, Casement $700–$1,500, Awning $800–$1,500, Bay or bow $800–$1,500 (i.e. the pre-15%-cut values).
- Deliberately unchanged (not in the owner's table, still at the 15%-reduced values): sliding patio door $1,530–$2,380, French door $2,550–$4,250, Milgard upcharge $85, frame-work allowance $680–$1,700, and the add-on modifiers. VERIFY with the owner whether these should also go back.
- `scripts/test-ask-pricing-sync.mjs` hand-worked check updated (5 double-hung vinyl: $4,650 to $9,900).

## 2026-10-02 — Direct Google review link (supplied by owner)

- `src/data/site.ts`: new `social.googleReview` = the profile's own "Ask for reviews" link (g.page/r/…/review). `social.google` (share link) is unchanged and still drives the header icon, "See it on our Business Profile" link, `GoogleReviews`, and JsonLd `sameAs`.
- Review-asking links now use `googleReview` (falling back to `google`): footer "Review us on Google" and the two "leave a review" links on `/reviews`. Only `href`s changed, no copy.
- `functions/_lib/review-request.mjs`: fallback is now the direct review link instead of the share link (an explicit `GOOGLE_REVIEW_URL` or a configured `GOOGLE_PLACE_ID` still wins). `scripts/test-review-request.mjs` updated, plus a check that the two copies of the URL stay equal.
- Open: the link is not yet verified on the live site, and nothing in Cloudflare was changed (no env vars needed for this).

## 2026-10-02 — Crawl-audit fixes: image weight, titles, descriptions, links to the Cascade vs Milgard guide

Source: a Screaming Frog desktop crawl (106 URLs) and an OpenSEO audit run the same day. Both agreed the site is technically sound; these were the small items.

- **Image weight.** Two causes, both fixed. (1) Page-hero backgrounds were rendered at 2400px / q76 (~800 kB each) under a 58–88% black gradient. New `src/lib/hero-bg.ts` (`getHeroBg`, 1600px / q60) now serves all twelve hero pages; heroes are 76–230 kB. (2) `<Image widths={[...]}>` without `width` makes Astro write the full-size original as the fallback `src` (3059px sources, ~570–850 kB). Browsers pick from `srcset` and never fetch it, but crawlers do, and it shipped in `dist`. Every `<Image>` with `widths` now pins `width` to its largest candidate (`WorkCard`, `VideoHero` x2, `PhotoGuide`, home tiles x3, `/replacement`, `/window-features`, guide hero). `PhotoGuide` lead quality 78 -> 70. Measured on a clean build: `dist/_astro` raster images 23.6 MB -> about 7.5 MB; largest remaining file 339 kB (the 1400px lead photo). Browser-selected `srcset` candidates (what a visitor downloads) were already small and are unchanged except the lead photo.
- **Titles / descriptions** (the four in `KNOWN_OVER` in `scripts/test-seo-meta.mjs`, now an empty allowlist): `/new-construction` title 65 -> 57; `/guides/vinyl-vs-fiberglass-pacific-northwest` gets a new optional `seoTitle` frontmatter field (`src/content.config.ts`, used only for `<title>`; H1 unchanged) 64 -> 56; `/sliding-glass-doors` description 158 -> 142; `/window-features` description 160 -> 151; `/reviews` title "Reviews" (27 with suffix) -> "Clearview Windows reviews and references" (40). Wording otherwise unchanged; no new claims.
- **Links to `/guides/cascade-vs-milgard`** (had 3 inlinks; the "Keep reading" list is the first three guides by `order`, so orders 5 and 6 never appear in it). Added contextual links from `/window-features`, `/replacement`, `/sliding-glass-doors` and the cost guide body. Not changed: the "Keep reading" ordering.
- **Checked and deliberately left alone.** `alt=""` on the header/footer logo mark (74 uses) and on the three home service-tile photos: each sits beside link text that already names it, so empty alt is correct for decorative images; Screaming Frog counts them as missing. The hero photos are CSS backgrounds and cannot carry alt. `/cdn-cgi/l/email-protection` 404 is Cloudflare Email Address Obfuscation (edge-injected, not in the repo); disabling it is a Cloudflare dashboard choice and exposes the address to scrapers. The `/estimate?role=` and `?scope=` variants are already canonicalized and noindexed. `public/logo/icon-mark.png`, `lockup-on-white.png`, `lockup-transparent.png` (1–2 MB) are unreferenced brand masters; not deleted.
- **Open:** the cost guide's markdown changed (link only). `npm run build:guides-index` needs an embedding credential that was not available, so `/ask` retrieval text for that guide is one link-syntax edit stale; harmless, refresh on the next guide edit.

## 2026-10-02 — Trailing-slash redirect for the old guide; registration line on /about

- `public/_redirects`: added `/guides/full-frame-vs-insert/` -> `/guides/what-your-openings-need` 301. Cloudflare Pages matches the slash form separately, so the existing no-slash rule left `/guides/full-frame-vs-insert/` returning 404 (confirmed with `curl -I` on the live site on 2026-10-02; Ahrefs Site Audit crawl of 2026-10-01 listed it as the site's only 404). Destination kept identical to the existing rule (the topical replacement guide) rather than `/guides`. `scripts/test-public-terminology.mjs` now asserts both forms.
- `src/pages/about.astro`: added a "Contractor registration" block (legal name, UBI, L&I number, link to the L&I verify page) in its own section after "How our prices work." It reuses the wording already published on `/new-construction` and reads `site.lniNumber` / `site.ubiNumber`, so no new business fact was introduced and it disappears if `lniNumber` is unset. The same number was already in the footer on every page.
- Verified locally: `npm run test:all` (37 steps), `npm run build`, built `dist/about.html` contains the line and `dist/_redirects` contains both rules. Not yet verified live (needs deploy; re-check with `curl -I https://windowsbyclearview.com/guides/full-frame-vs-insert/` and expect 301).
- Open: credential wording still has no formal L&I/attorney sign-off (see README). The `/about` block adds no new wording beyond what `/new-construction` already says.

## 2026-10-02 — Permit leads on the Analytics page (public records)

- New **Permit leads** section in `/internal/analytics`: Clark County + City of Vancouver building permits (last 183 days) joined to county assessor parcels (address, owner, mailing address, year built, size, last sale) and the WA L&I contractor license list (data.wa.gov `m8qx-ubtq`). Two views: **builders** (new-home permits rolled up to the lot owner, because the permit applicant is often a permit service or engineer; exact-name license match with phone, labelled when it is a person-name match) and **homeowner remodel/addition permits** with an equal-weight fit count (single-family, owner applied, addition, permit in last 90 days, sold in last 2 years). Homeowner rows load only when the list is opened.
- Pipeline: `scripts/build-permit-leads.mjs` (`npm run build:permit-leads`, ~15 s, no credentials) with pure logic in `scripts/permit-leads/lib.mjs` and the network layer in `scripts/permit-leads/fetch.mjs`. Output is a whole-snapshot SQL file in the git-ignored `data/permit-leads/`; loading it is a separate `wrangler d1 execute` step (see `internal/README.md`). Read side: `functions/internal/_lib/permit-leads.mjs` (tables `permit_prospects`, `permit_builders`, `permit_import_meta`, created on first use) and `functions/internal/api/permit-leads.js`. Test: `npm run test:permit-leads`, added to `build.yml`.
- Decisions and limits: research data, not leads (nothing becomes a lead or quote without a person acting); no homeowner phone or email is ever produced or guessed (WA 2022 telephone-solicitation law; mail is the low-risk channel); future dates are dropped as county typos; same-size window replacements usually need no permit in Vancouver, so this finds new builds and remodels, not most simple replacement jobs. Owner names and mailing addresses are personal data in a public repo, hence the git-ignore.
- Not built on purpose: status tracking or "convert to lead" (CRM scope). Per the gap analysis the constraint is lead volume, so the first test is whether any of these builders answers; build workflow only after one does.

## 2026-10-02 — All prices lowered 15% (owner direction)

- `src/data/pricing.ts` and its hand-kept copy `functions/ask/_lib/pricing.mjs`: every dollar figure x 0.85 — openings (e.g. slider $600–$1,400 -> $510–$1,190; sliding patio door $1,800–$2,800 -> $1,530–$2,380; French door $3,000–$5,000 -> $2,550–$4,250), Milgard upcharge $100 -> $85, frame-work allowance $800–$2,000 -> $680–$1,700, and the add-on modifiers ($100–$200 -> $85–$170, $150 -> $128, $450 -> $383, $200 -> $170; zeros stay zero). The fiberglass multiplier (1.4) is not a price and is unchanged. `basis.reviewedAt` set to 2026-10-02.
- `scripts/test-ask-pricing-sync.mjs` hand-worked check updated (5 double-hung vinyl: $4,150 to $8,850). The sliding-door page and calculator read from the table, so they follow automatically.
- Not changed (not Clearview's figures): the regional-average range quoted in the `window-replacement-cost-washington` guide. VERIFY whether it should still say $600–$1,300.

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
