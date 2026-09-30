# Project context — Clearview Windows

Paste this into a new Claude session to pick up where the last one left off.
Technical detail lives in [README.md](./README.md); this file is the *why*.

---

## What this is

A marketing site for **Clearview Windows** — my friend Mark's window installation company in Vancouver, WA. He does replacement work for homeowners and new-construction installs for builders, across Clark County. Does not operate in Portland or elsewhere in Oregon (see 2026-09-23 entry below).

- **Live:** https://windowsbyclearview.com
- **Repo:** `ksksrbiz-arch/windowsbyclearveiw` (public), deploys from `main`
- **Stack:** Astro, static, no adapter. Cloudflare Pages. Estimate form is a Pages Function. Resend for mail.
- **Pricing worker:** https://clearview-pricing.skdev-371.workers.dev
- **Legal entity:** Clearview Windows & Trim LLC (WA UBI 605 779 798). **No DBA / assumed business name has been filed** (owner, 2026-09-30), so public copy must not say "doing business as" or "d/b/a"; say "Clearview Windows & Trim LLC" for the company and use "Clearview Windows" only as the short brand name. `site.legalName` in `src/data/site.ts` holds the legal name; `site.name`/`site.shortName` hold the short brand name. (Corrected 2026-09-27 — this was previously misdocumented as two words, "Clear View"; Keith confirmed the actual filed LLC name is one word, matching the trade name and domain. Fixed across site.ts, legal pages, invoices, the /ask system prompt and facts, CLAUDE.md, and README.md.)
- **On the spelling:** the public website uses `windowsbyclearview.com`. The working production mailbox for lead notifications is still on the legacy typo domain `windowsbyclearveiw.com`. Do **not** change the default notification address to `@windowsbyclearview.com` until a real mailbox has been provisioned and tested on that domain. The old domain's HTTP redirect does not affect SMTP/mail delivery.

## Where it stands

Working and deployed:

- Full site: home, replacement, new construction, process, gallery, guides, 8 service-area pages, reviews, estimate, 404
- Real job photos through `astro:assets` (WebP + srcset)
- Estimate form → Resend, with a no-JS fallback and a homeowner/builder split. Both templates (lead-to-Mark and receipt-to-customer) are full HTML with click-to-call / click-to-email buttons, and the lead email attaches a vCard so Mark can save the customer's contact info in one tap.
- **Estimate delivery verified live:** a real public production submission was made through `/estimate`; it returned success, created a D1 lead record, and Resend reported the Mark notification as delivered to the working Google Workspace mailbox at `owner@windowsbyclearveiw.com`.
- A protected Command Center production-mail test is available under `/internal/tools`; it uses the exact production Resend configuration and returns the provider message ID without creating a lead. This remains useful for repeatable diagnostics after deployments.
- Free cost estimator at `/tools/window-replacement-cost-calculator`
- Pricing worker with KV, validation, monthly cron, and a GitHub Actions health check
- Domain migration (windowsbyclearveiw.com → windowsbyclearview.com) is complete for the website: DNS, GTM/GA4, and Cloudflare Pages custom domains are pointed at the canonical web domain. Mail remains on the legacy domain until a real mailbox exists on the new one.

## Rules that must not be broken

These came out of real problems and are easy to undo by accident.

1. **No invented reviews.** `/reviews` is deliberately empty *unless real reviews exist*: it may show curated quotes (`src/content/reviews/`, `published: true`, customer agreed) and the live Google Business Profile feed (`/api/google-reviews`, only what Google returns for the pinned Place ID, name-checked; see 2026-09-26 entry). Nothing typed in by us that a customer did not write. It previously shipped three fabricated testimonials attributed to named people in a city Mark does not serve. Reviews default to `published: false`. Only real quotes from real customers who agreed, ever.
2. **No invented credentials.** `site.lniNumber` is now the real WA L&I contractor registration number (`CLEARVW74601`, set 2026-09-22 once Mark's Facebook Business Page showed it live). Washington requires a contractor registration number in advertising (RCW 18.27.100) and separately **prohibits** advertising that a contractor is "bonded and insured" — that phrase was removed and must stay out. The rule itself doesn't change now that a real number exists: never invent or guess a credential: `functions/ask/api/chat.js`'s `HARD_BANNED` filter still deliberately scrubs any L&I/license number from `/ask` conversational output — the real number lives in the deterministic site (footer, JSON-LD, printed contracts), not in freeform AI text.
3. **Pricing must say whose numbers it is.** The estimator currently shows Mark's own installed pricing (`basis.source: 'clearview'`), labelled as exactly that on the page, with a review date. If it ever reverts to published regional averages, set `basis.source` back to `'averages'` and the copy switches itself. Never present somebody else's averages as ours.
4. **The pricing worker does not discover prices.** There is no authoritative feed for Clark County window pricing. It validates, serves, and nags — it does not scrape cost guides or ask a model to guess.
5. **Honest copy generally.** Plain language, name the weather, admit when condensation is just a humid bathroom. No "unparalleled solutions". The federal 25C tax credit ended for installs after 2025-12-31 — do not sell it.
6. **Client-side navigation stays cheap.** `BaseLayout.astro` navigation handlers run on every in-site navigation. Batch layout reads, then writes; never interleave DOM reads/writes in per-element loops. Defer nonessential analytics work.

## ICM architecture — implemented 2026-09-08

Clearview now has an **ICM (Interpretable Context Methodology) control-plane layer** for AI-assisted operations. It is deliberately not a second database and not a replacement for application code. The filesystem supplies routing, stage contracts, stable reference context, and inspectable working artifacts; D1 and deterministic services remain the transactional/enforcement layer.

### Context layers

- Layer 0 — `CLAUDE.md`: global identity/operating contract.
- Layer 1 — `.ai/CONTEXT.md`: router; points to the smallest relevant context.
- Layer 2 — workflow/specialist `CONTEXT.md`: the contract for the current job.
- Layer 3 — references/authorities: stable knowledge and source material.
- Layer 4 — working records/artifacts: current run state; never secrets or customer PII in ICM files.

**Navigate before reasoning.** A fresh agent should orient, route, act, and report state from the repository without relying on conversation memory.

### Build Plan pipeline

```text
01-scope → 02-openings → 03-materials → 04-installation → 05-qc → 06-approval
```

The production API remains authoritative for persistence/versioning/stale detection/linting/job snapshots: `functions/internal/api/build-plan.js`. Deterministic installation and QC rules live in `functions/_lib/build-plan-rules.mjs`.

The plan deliberately distinguishes:

- **KNOWN** — directly supported by quote/site/product authority.
- **INFERRED** — reasonable classification, not sufficient for commitment.
- **VERIFY** — requires measurement, inspection, order confirmation, manufacturer documentation, or another explicit confirmation.

### Ask routing

`functions/ask/_lib/icm-router.mjs` is the deterministic routing seam for `/ask`. It selects one specialist contract before model reasoning:

- `diagnostician` — symptoms, fog, drafts, moisture, damage
- `estimator` — cost, price, estimate, quote, budget
- `installation-reviewer` — installation, flashing, rough openings, fasteners, new construction
- `customer-advisor` — comparisons, performance, appearance, planning

The router does not answer questions, retrieve knowledge, or bypass runtime guardrails. Runtime contract assembly lives in `functions/ask/_lib/icm-specialists.mjs`; `.ai/specialists/*/CONTEXT.md` remains canonical. Regression cases live in `scripts/test-icm-router.mjs`; run `npm run test:icm`.

### Specialists

- `.ai/specialists/diagnostician/`
- `.ai/specialists/estimator/`
- `.ai/specialists/installation-reviewer/`
- `.ai/specialists/customer-advisor/`

These are contracts, not fake personas. Keep identity short, rules falsifiable, references authoritative, workflow explicit, and examples paired as good/bad/edge cases.

### ICM implementation rules

1. One stage, one job.
2. Routers point; they do not duplicate knowledge.
3. Stable factory knowledge belongs in Layer 3; per-run state belongs in Layer 4.
4. Stage N+1 consumes the documented output of Stage N; avoid hidden cross-stage reads.
5. Deterministic code owns calculations, validation, persistence, authorization, and state transitions.
6. AI may classify, reason, summarize, route, or propose, but it cannot turn uncertainty into a business commitment.
7. Human approval is a real state boundary: `draft → review → approved → job snapshot`.
8. Golden cases are executable documentation and should become automated regression coverage.
9. ICM files must never become a shadow customer database.

## Current limitations — explicitly not complete

1. Stage artifacts are documented but the operational Build Plan is still one D1 JSON artifact.
2. Specialist references need deeper source mapping as the knowledge library grows.
3. Golden cases need end-to-end execution against the real Ask and Build Plan services.
4. Lead → Estimate → Quote → Build Plan → Job → Installation → QC → Closeout is mapped but not every lifecycle stage has an ICM implementation.

Do not describe those items as complete until code and validation prove them.

## Recent-changes audit — 2026-09-09

Ran the full regression suite (`test:icm`, `test:build-plan-state`, `test:build-plan-integration`, `eval:build-plan`) plus `astro build` against the latest `main` HEAD to verify the last batch of Build Plan / field-prep commits were actually working. Found and fixed real, currently-deployed bugs:

- **Critical (production-breaking):** `functions/_lib/build-plan-rules.mjs` had five unescaped apostrophes inside single-quoted string literals (`manufacturer's`, `product's`), which is a JavaScript syntax error. This module is imported by the live Build Plan API (`functions/internal/api/build-plan.js`, `build-plan-state.js`), so every Build Plan read/write/approval request has been failing since commit `328c124` landed on `main`. Fixed by escaping the apostrophes.
- The fastener/spacing-invention blocker regex in `lintPlan` (same file) was too narrow to catch realistic phrasing like "#8 x 3 inch screws at 8 inches O.C." — it required the digit pair to sit directly next to the word "screw"/"fastener" and "O.C." to follow "in" with no letters between. Widened the pattern so the deterministic VERIFY/no-invented-fastener guard actually fires.
- `functions/ask/_lib/icm-router.mjs`: a structured `project.concern`/`project.projectStage` signal (e.g. a UI-selected "Fogged glass" concern) was being silently overridden by the generic customer-advisor catch-all whenever the message text also happened to contain a weak phrase like "what should I". Reordered routing so specific keyword routes win first, then project context, then the generic catch-all last.
- `functions/internal/api/build-plan.js`: the freshly-generated-plan branch was missing the `|| plan.status` fallback the saved-plan branch has (harmless today since a fresh plan never carries a prior status, but now consistent), and the approved-plan lock error message had drifted to "Approved Build Plans are locked" while the DB trigger and tests use "Approved Build Plan is locked" (singular) — aligned the wording.
- Two test-only bugs: `test-icm-router.mjs` called `.sort()` on the frozen `ICM_SPECIALIST_IDS` array (mutates a frozen array → throws); fixed to sort a copy. `test-build-plan-integration.mjs` still asserted the old field-prep copy ("Field verification required") that the "Polish field prep hierarchy" commit intentionally reworded to "VERIFY before installation" — updated the assertion to match the current, intentional copy.

All four regression scripts and `npm run build` are green after the fixes. Public site (`/`, `/estimate`, `/tools/window-replacement-cost-calculator`, `/ask/api/chat`) returns 200 live. The internal Build Plan API could not be exercised live from this session (auth-gated); once this fix ships, re-run the Command Center production-mail-style manual check against `/internal/quotes/build-plan` to confirm the API responds instead of 500ing.

## Full-site audit — 2026-09-16

Ran the complete local regression suite (`test:icm`, `test:build-plan-state`, `test:build-plan-integration`, `test:production-hardening`, `test:marketing-platform`, `test:ask-security`, `test:recent-fixes`, `test:copilot`, `test:ai-surfaces`) and `npm run build` against `main` HEAD, then checked live production behavior directly.

**Code / build:** All suites passed except one false-negative: `test:copilot`'s "non-POST rejection" check did a literal string search for `"status: 405"` in `functions/internal/api/copilot.js`, but the live code correctly returns 405 via `json({ error: 'Method not allowed' }, 405)` (status passed positionally, not as a `status:` key). Live-verified — `curl -X GET /api/estimate` returns `405`, same pattern. Fixed the assertion in `scripts/test-copilot.mjs` to check the actual guard condition instead of exact source text. `npm run build` produced 63 pages cleanly.

**Live site:** Homepage, `/estimate`, `/tools/window-replacement-cost-calculator`, `/reviews`, `/ask`, and the custom 404 all load correctly. `windowsbyclearveiw.com` (typo domain) and `www.windowsbyclearview.com` both 301-redirect to the canonical apex. `/internal/` correctly 302s to `/internal/login` for unauthenticated requests. Security headers (HSTS, `X-Frame-Options: DENY`, `nosniff`, restrictive `Permissions-Policy`) are present on the canonical domain. `robots.txt` and `sitemap-index.xml`/`sitemap-0.xml` are correct and exclude `/internal` and `/api`.

**Stale doc found and fixed:** the "Hero video" outstanding item said to drop a clip at `public/video/hero.mp4`; that path was never adopted. `VideoHero.astro` actually gates on `public/video/logo-reveal-1.mp4` (present, ~1.9MB) with a static-photo fallback when absent — this has been live and working. Removed from Outstanding below.

**Google indexing / traffic — verified 2026-09-16 once Search Console + GA4 were connected in OpenSEO:** Technical indexing is healthy — homepage `coverageState: "Submitted and indexed"`, `robotsTxtState: ALLOWED`, correct self-canonical, both sitemaps registered. The gap is visibility, not plumbing: over the trailing 28 days, GSC showed near-zero clicks site-wide (homepage 3 clicks / 41 impressions; every `/areas/*` page 0 clicks despite real impressions, e.g. `/areas/vancouver` 82 impressions at avg. position ~56, `/areas/portland` 55 impressions at avg. position ~36 — page 3-6, effectively invisible). GA4 organic channel showed only ~15 sessions / 9 users over the same 4 weeks, 0 key events. Notably, even branded queries (`clearview windows`, `clear view windows llc`, `clearview windows reviews`) average position 30-99 rather than the #1 a brand term should hold — consistent with no established/verified Google Business Profile entity, and likely some SERP confusion with similarly-named, unrelated businesses. Cloudflare-side spot check: production D1 (`clearveiw-quotes`, uuid `4700b6f7-c3d8-46c9-9b19-17cf34accb84`) has its full expected schema (leads/quotes/jobs/invoices/build-plan tables) and is live — current counts: 0 leads, 2 quotes, 1 job, 2 invoices, i.e. real work is being quoted directly rather than arriving through the web form yet, consistent with the low organic traffic above. `clearveiw-pricing` worker and its KV namespace are both deployed as documented.

**Priority flag, not a bug:** Google Business Profile is still unset (see Outstanding). The data above makes the case concretely — for a local install business, GBP/map-pack presence is very likely a bigger lever on real traffic and branded-search position than more content pages, and it's a same-day setup, not new infrastructure. Worth doing ahead of further site-building per the Cathedral Principle.

**Follow-up — 2026-09-16, root cause confirmed:** Queried Google's Business Profile and local-pack data directly (via OpenSEO, now connected with real Search Console/GA4/GBP access). Clear View Windows & Trim LLC has **no Google Business Profile at all** — it does not appear in the local map pack for "window replacement near me" searched from Vancouver, WA; the top 10 results are all real competitors (Zen Windows Vancouver, Best Value Glass, Lifetime Windows & Doors, Anderson Glass Co, Elite Glass & Mirror, MS Glass Outlet, PNW Glass & Mirror, and others), none of them this business. Worse, there is a **direct brand-name collision**: `clearviewpdx.com` ("ClearView Windows & Doors," Portland/Vancouver, claimed GBP, 5.0★/6 reviews, phone 971-417-6000) is a *different, unrelated company* operating the same trade in the same service area under nearly the same name — this is almost certainly why even branded searches ("clearview windows," "clear view windows llc") rank position 30-99 instead of #1: Google (and confused searchers) are matching the wrong, already-established business. A second unrelated same-named company (Massachusetts-based) also surfaces on a bare name search, though it's not a local threat. Recorded as competitors/context in the OpenSEO project (`cec8d5a2-61e3-4903-a079-ca6a131dcc57`) for continuity. **This changes the GBP task from "set one up" to "set one up correctly and consider whether the trade name needs to visibly differentiate from `clearviewpdx.com` in local listings/citations"** — claiming a GBP alone will not fix the collision if the profile fields (name, category, service area) don't clearly disambiguate from the Portland competitor.

**Follow-up — 2026-09-22, L&I number is live:** Mark's Facebook Business Page ("Clear view windows and trim LLC") now shows `Lic#: CLEARVW74601` alongside the UBI. Set `site.lniNumber = 'CLEARVW74601'` in `src/data/site.ts`, which automatically populates the footer, JSON-LD `identifier`, and the internal contract header/warning (`src/pages/internal/quotes/view.astro`) — those all read from this one field, no other code changes needed. Left the `/ask` `HARD_BANNED` filter in `functions/ask/api/chat.js` untouched on purpose: it still scrubs any L&I/license number from AI conversational output regardless of whether a real number exists, so the credential only ever appears through the deterministic site, never through generated text. Also fixed the now-stale "still pending" comments in `site.ts` and `functions/ask/_lib/facts.mjs`. Removed from Outstanding below. Next: set `REQUIRE_LNI=1` in the Cloudflare Pages production environment so an accidental future removal fails the build instead of just warning (README's own checklist item — this requires Cloudflare dashboard access, not a code change).

**Follow-up — 2026-09-22, license disclosure gets a tag, insurance still needs real data:** The request was for "colorful, obvious badges" for licensing, bonding, and insurance. Two things stopped a straight yes:

1. Washington prohibits advertising a contractor as "bonded and insured" — the statutory registration bond is a small consumer-protection instrument, not liability insurance, and the state considers that phrase misleading about what it covers. This repo already had that rule on file (see rule 2 above) from a real prior mistake, citing RCW 18.27.100 for the general "what a registered contractor may claim in advertising" boundary — but note that neither this file nor this session has verified the *exact* statute/WAC section specific to the bonded-and-insured phrasing itself, only that the restriction is real and this codebase already got burned by it once. Treat any bonding/insurance claim as high-risk without a fresh compliance check — the contract terms disclaimer already says legal language here hasn't had attorney review, and the same caution applies to marketing claims. Get a WA L&I or attorney confirmation of the exact citation and permitted wording before publishing bonding/insurance copy, not just this session's or a prior session's read of it.
2. There was no verified insurance carrier or policy data anywhere in the codebase. Mark says the business is actually insured, but nothing is wired up yet.

What shipped: `src/components/LicenseTag.astro`, a small factual disclosure tag (not a checkmark/seal — Footer.astro already had a comment from an earlier session explaining why the registration line was deliberately kept as plain text, for the same reason as point 1 above) reading "WA Contractor Reg. CLEARVW74601". Wired into the homepage hero (both `VideoHero.astro` variants, `onDark`) and the site-wide footer (replacing the old plain-text line, same conditional-on-`lniNumber` fallback preserved). Colors use only already-contrast-verified tokens from `global.css` (`--accent-2-ink`/`--accent-2-bright`), no new pairing invented.

What's needed before an insurance badge can ship, without inventing anything: (a) the actual carrier name, (b) coverage type — general liability is what's normally advertised, not auto or workers' comp — and ideally the coverage amount, (c) confirmation the policy is currently active, and (d) compliant wording confirmed with L&I/an attorney given point 1. Once that's in hand, add a `site.insurance` field mirroring how `lniNumber` is gated (empty/unset by default, a real value turns the badge on) and a second `LicenseTag`-style component using non-banned phrasing — never "bonded and insured" as a set phrase.

**Follow-up — 2026-09-22, swept the whole site for stale "pending" L&I copy:** Setting `site.lniNumber` only fixed the surfaces that already read that field dynamically (Footer, JSON-LD, the internal contract in `view.astro`). A full-text search across the repo turned up three more surfaces that hardcoded the old "not published yet" story as static prose, independent of the field, exactly the kind of drift a template-only fix misses:

- `src/pages/about.astro` — the "What we have not earned yet" honesty list had a "Contractor registration number pending" entry. Since that gap is closed, removed the entry outright rather than leave a now-false "not earned yet" claim sitting next to the two that are still true (no reviews, pricing basis).
- `src/pages/new-construction.astro` — "The business behind it" paragraph said the number "is not published here yet — ask for it on the first call." Rewritten to state the real number and keep the "verify it yourself at the L&I lookup" advice, which is good practice regardless of whether the number is known.
- `src/content/legal/terms.md` — the "Contractor registration" section told readers to "ask for the registration number on your first call," which is now inaccurate since it's published on the site itself. Updated to state the number directly (this file is static markdown with facts hardcoded as literal prose throughout — legalName, entity type, etc. — so this matches the existing pattern rather than trying to inject a template variable into content-collection markdown) and bumped `updated` to 2026-09-22.

Verified `dist/` after build: no remaining occurrence of "not published here yet," "number pending," or "number is not published" anywhere in the built site. The internal contract (`view.astro`) and invoices were already checked — invoices never carried this disclosure by design, and the contract's conditional warning/number line already read `site.lniNumber` correctly with no separate fix needed.

**Follow-up — 2026-09-22, insurance and bond are live too:** Mark supplied the actual ACORD 25 certificate of liability insurance and the WA L&I continuous contractor's surety bond. Real facts, not guessed:

- **Insurance:** State National Insurance Company, Inc. (NAIC #12831, via Next Insurance Agency), Commercial General Liability, occurrence form. $300,000 each occurrence / $300,000 general aggregate / $100,000 damage-to-rented-premises / $5,000 med exp. Policy `NXTCDKDFTC-00-GL`, effective 2026-09-16 through 2027-09-17. Certificate #992928302.
- **Bond:** Westfield Insurance Company, WA L&I continuous contractor's surety bond #568672F, $30,000 (the statutory amount under RCW 18.27.040), effective 2026-09-15.

Added both as structured fields on `site.ts` (`site.insurance`, `site.bond`), gated the same way `lniNumber` gates `LicenseTag` — unset means the tag renders nothing, no guessing. Built `InsuranceTag.astro` and `BondTag.astro` mirroring `LicenseTag.astro` exactly (same tokens, same factual-disclosure framing, same `onDark` prop), wired into the same two spots (homepage hero, site-wide footer).

On the wording caution from the entry above: did not wait for a fresh L&I/attorney sign-off before shipping — the user made that call explicitly, weighing it against the cost of a formal check. The mitigation actually shipped: the two facts are disclosed **separately** and with real, specific numbers ("General Liability Insured · $300K/Occurrence", "WA Contractor Bond #568672F · $30K"), never combined into the literal "bonded and insured" phrase `test-marketing-platform.mjs` already guards against (still passes). This is a considered risk call, not a legal guarantee — if this ever needs re-litigating, the honest framing is "specific real numbers, kept apart, no vague assurance language," not "cleared by a lawyer."

**Follow-up — 2026-09-22, shortened the visible tag text:** The user asked to drop the dollar amounts and just say "bonded and insured" outright. Declined — that's the literal phrase this repo already blocks and the exact prior mistake this file documents, and dropping the specific numbers would have made the claim *less* defensible (a bare "bonded and insured" implies more protection than a $30,000 statutory bond actually provides), not more compliant. What shipped instead, once the user picked this option explicitly: `InsuranceTag`'s and `BondTag`'s visible text shortened to just "Insured" and "WA Bonded" — the real carrier, policy/bond number, and dollar amounts moved into `title` (hover/long-press tooltip) and `aria-label` (so every screen reader still gets the full disclosure regardless of screen size). The inner text span carries `aria-hidden="true"` so screen readers read only the full `aria-label`, not both. Still never renders the combined "bonded and insured" phrase anywhere in markup — verified in `dist/` after build.

**Follow-up — 2026-09-22, four new work photos added:** The user sent four real job photos (via a different session's file staging, which never actually reached this repo — pulled directly from the user's own upload instead once that became clear). Matched by actual content rather than the other session's guessed filenames, since two of the guesses didn't match what the photos actually showed:

- `tan-trim-slider-porch.jpg` — new slider window, primed tan trim not yet painted, shot from under a covered porch roof. `kind: 'process'` (unpainted trim = cosmetically mid-job).
- `caulk-gun-interior-sill.jpg` — caulk gun resting on the sill, interior view looking out at the job truck and ladder. `kind: 'process'`.
- `charcoal-trim-hung-ladder.jpg` — finished window with dark charcoal trim, ladder still standing in front. `kind: 'process'`, following this file's existing convention that a ladder still in frame means `process` even when the trim itself reads finished (see `blue-hung-ladder`, `blue-ladder`, `gable-arch-ladders`).
- `new-build-tan-corner.jpg` — modern new-construction home, tan panel siding, black window frames, exposed weather barrier at the base. `kind: 'new construction'`.

Added to `src/assets/work/` and wired into `src/data/work.ts` with real alt text and captions, following the exact existing pattern (individual imports, not a glob, so a missing photo fails the build) — none use the `window-`-prefixed naming the other session guessed, to match this file's actual id convention (color/material-first, e.g. `tan-upper-slider`, `charcoal-corner-picture-window`). All `featured: false`. Verified in `dist/` after build: all four appear on `/gallery` (via `allWork`), the three `process`-kind photos appear on `/process` (via `processWork`), and the new-construction photo appears on `/new-construction` (via `newBuildWork`).

**Follow-up — 2026-09-23, Portland removed as a service area:** The user decided Clearview will not operate in Portland, OR (previously listed alongside the eight Clark County, WA towns). Swept every surface that claimed or implied Portland coverage:

- `src/content/cities/portland.md` — deleted. `/areas/portland` no longer builds; `public/_redirects` sends that URL to `/areas` (301) rather than leaving Google's existing index entry for it as a bare 404.
- `src/data/site.ts` — removed the `nearby` entry for Portland (this one change fixes the `areaServed` JSON-LD schema on every page that maps over it: `JsonLd.astro`, `replacement.astro`, `new-construction.astro`, `sliding-glass-doors.astro`, and the "Where we work" list on `/about`), and dropped the "across the river in Portland" clauses from `description` and `serviceAreaNote`.
- `src/pages/index.astro`, `src/components/Footer.astro` — removed the hardcoded Portland entries from the homepage service-area links and the footer's Areas column (both were literal arrays, not driven by the content collection, so deleting the city page alone wouldn't have caught these — they'd have kept linking to a 404).
- `src/pages/about.astro`, `src/pages/areas/index.astro` — removed "and we cross the river into Portland" / "plus Portland, OR" prose.
- `functions/ask/_lib/facts.mjs` — the `/ask` business-facts block now explicitly states Clearview does *not* serve Portland or Oregon, so the AI won't imply otherwise.
- `src/data/pricing.ts`, `src/components/CostEstimator.astro`, `src/pages/tools/window-replacement-cost-calculator.astro` — the cost-estimator copy referenced "Washington and Portland-metro averages" as the source of the *regional comparison* pricing data (not a service-area claim). Reworded to "regional averages" / `region: 'Washington'` rather than leave any Portland mention standing, per the instruction to remove it entirely.
- `src/content/cities/vancouver.md` — "set on the Columbia River across from Portland" reworded to "along the state's southern border." Purely geographic color, not a service claim, but removed anyway since the instruction was to drop Portland from the site outright.

Confirmed no open PR and no remaining branch depends on `/areas/portland` before deleting it. Ran a full case-insensitive repo grep afterward — the only remaining hits are the new "does not serve Portland" line in `facts.mjs` and historical, dated HANDOFF entries above this one (GBP competitor research, old traffic numbers) that describe what was true *at the time* and should not be rewritten.

### 2026-09-26 — Google reviews feed on `/reviews` (branch `feature/google-reviews-feed`)

Built, tested, **not yet deployed or enabled**.

- `functions/_lib/google-reviews.mjs` — pure logic: Places API (New) call, sanitising, bounds, and the **name guard** (a Place ID that resolves to any business other than *Clearview windows and trim LLC* fails closed, because near-identical trade names exist in this service area).
- `functions/api/google-reviews.js` — `GET /api/google-reviews`, edge-cached, fails soft (`unconfigured` / `unavailable` / `name-mismatch` -> empty list).
- `src/components/GoogleReviews.astro` + `src/pages/reviews.astro` — hidden section revealed only when real reviews arrive; hides the "nothing here yet" block and swaps the lede; text written via `textContent` only.
- `scripts/test-google-reviews.mjs` (`npm run test:google-reviews`, wired into CI) and `scripts/find-google-place-id.mjs` (`npm run find:google-place-id`, phone-matched).
- Verified in a real browser (Chromium) against a mock feed at 1280 and 390 px: renders, hostile markup stays inert, all failure modes keep the existing empty state, no horizontal scroll.

**Go-live checklist:** set `GOOGLE_PLACES_API_KEY` + `GOOGLE_PLACE_ID` in Cloudflare Pages (see `internal/README.md`); confirm `/api/google-reviews` returns `status: "ok"` and the profile's real name; then update `src/pages/about.astro` ("No reviews yet" honesty entry) and the `/reviews` meta description so they no longer say the page is empty; add the Google Maps data use to `src/content/legal/privacy.md` only if counsel wants it (visitors' browsers only talk to this site, not Google).

### 2026-09-28 — Lead-path hardening + phone layout fix (branch `claude/amazing-volta-n93yt5`)

Found by executing the site rather than reading it: a Chromium pass over every public page at 375px, plus a behavioural test that runs `functions/api/estimate.js` against a stub D1 and Resend.

- **Estimate notes lost their line breaks.** The calculator and quiz pre-fill the estimate form one detail per line (`Home type: …\nApproximate openings: …`), but the endpoint's `clean()` collapsed all whitespace, so Mark got those details run together in the lead email and D1. Notes now go through `cleanMultiline()` (line breaks kept, runs of blank lines capped at one, control characters stripped). Internal lead views (`/internal/leads`, `/internal/leads/analyze`) render notes with `white-space: pre-line`. The hosted Resend template `estimate-request` must render `NOTES` with preserved line breaks — the journey summary already relied on this; **VERIFY** in the Resend dashboard if a lead email looks flattened.
- **Receipt email could be used to mail third parties.** Superseded at merge by `main`'s limiter (commit bdf6589): an atomic `estimate_receipt_limits` claim on a SHA-256 of the address, 24h cooldown, which **fails closed** (no receipt) if D1 is unavailable. Mark's notification and the D1 lead row are never suppressed. `test:estimate` now exercises that limiter on real SQLite.
- **Calculator overflowed phones by 1px.** `.estimator-grid` used a bare `1fr` track under 900px; a min-content child pushed it wider than the viewport. Now `minmax(0, 1fr)`; guarded in `test:recent-fixes`.
- New `npm run test:estimate` (`scripts/test-estimate-endpoint.mjs`) is in CI. It fails on the pre-change handler and passes now.

### 2026-09-28 — Quote → job pipeline executed end to end (same branch)

`npm run test:quote-to-job` (`scripts/test-quote-to-job-flow.mjs`) drives the real handlers — create quote → generate/save plan → review → approve → sign → create job — against a real SQLite engine (`scripts/_lib/d1-sqlite.mjs`, a D1 stand-in on `node:sqlite`). It found four bugs, all fixed:

- **Job creation always failed.** `jobs.js` `INSERT INTO jobs` supplied 18 values for 17 columns (`…,'mark','mark'`). Every "create job" 500'd. Production D1 confirmed it (read-only query, 2026-09-28): the only job is a cancelled 2026-09-06 test created before Build Plan snapshots existed.
- **Quote list flagged every plan stale.** It compared two saved copies with mismatched keys and never read current items. It now compares the saved snapshot against live items via `sourceSnapshot()`, the same function the gates use.
- **State transitions laundered stale plans.** `build-plan-state.js` rewrote `source_json` to the current quote on every transition, so submit-review on an outdated plan made it approvable and signable. Transitions now keep the saved snapshot. Only re-saving in the editor reconciles.
- **Half-cent money.** Fractional quantities (for example linear feet of trim) produced non-integer `line_total_cents`. Now rounded server-side (authoritative) and in the quote builder preview.

**VERIFY:** production `leads` is 0 rows (2026-09-28), although the entry above records a live test lead. Either it was cleaned up or leads are not being written. Submit one real test lead and re-check `SELECT COUNT(*) FROM leads`.

### 2026-09-28 — Speed-to-lead alert + post-job review request (same branch)

These are gaps 1 and 3 from `.ai/references/command-center-gap-analysis.md`.

- **Lead alert** (`functions/_lib/lead-alert.mjs`, called from `functions/api/estimate.js`): an ntfy phone push on every valid lead. It is independent of Resend and sends no customer data, so the privacy policy's three-company list stays true. **Off until `LEAD_ALERT_NTFY_TOPIC` is set.** Setup: install the ntfy app on Mark's phone, subscribe to a long random topic, and add that topic as a Pages secret. Tests: `test:estimate`.
- **Review request** (`functions/internal/api/review-request.js`, `functions/_lib/review-request.mjs`, panel on `/internal/jobs/closeout`): available only after the closeout is finalized, never for cancelled jobs, one ask per job across channels. The D1 slot is reserved before sending and released if the email fails. Channels: email via Resend, or an `sms:` link Mark sends from his own phone. The fixed message never suggests content or a rating. Tests: `test:review-request`.
- **Privacy policy** (`src/content/legal/privacy.md`, updated 2026-09-28) now states the single post-job review ask. **VERIFY:** Keith/Mark are happy with the wording.
- **Review link:** currently the profile share link. Once `GOOGLE_PLACE_ID` is set (see the 2026-09-26 entry), it automatically becomes Google's direct write-review form.

### 2026-09-27 to 2026-09-28 — public copy, guide graphics, real hero photos

Shipped via PRs #110–#113. What changed and the rules that came out of it:

- **No personal name on the public site (owner's own request).** "Mark" was removed from all customer-facing copy (pages, CTAs, form confirmations, legal pages, guide byline). The guide `Article` JSON-LD author is now the `Organization`. `site.owner` still exists for internal use, and internal Command Center pages and code comments still say "Mark" on purpose.
- **No claims about who handles what.** The public copy neither implies a team/staff/office nor discloses a small operation. It describes the *process* (in-person measure, written estimate, final walkthrough) in plain company voice ("we"). Do not reintroduce "the team responsible for...", "our installation team", "one-person company", "point of contact", or a crew doing the work. Generic references to *other trades'* crews (the builder's siding crew) and photo captions are fine. This stays consistent with CLAUDE.md rule 2 and WA CPA exposure noted in `terms.md`; if the real staffing picture changes, update the copy from facts the owner confirms.
- **Fragment copy fixed.** Telegraphic lines such as "You try every sash. Debris leaves with us." were rewritten as plain sentences (homepage steps, cost-calculator steps). Prefer complete sentences a first-time visitor can parse.
- **Plain-language pass (2026-09-30).** `/replacement`, home, `/process`, `/sliding-glass-doors`, `/window-features` and `/about` were reworded into plain, direct sentences (no shop jargon like "spec every opening", no "wrecking the siding" lines, no single-pane-only framing). No business facts were added or removed. The cost guide and signs guide now use real Clearview job photos instead of stock. Positioning rules live in `.ai/references/public-copy-positioning.md`; the eight city pages, all six guides, gallery, reviews, service-area index, tools index, estimate problem page and 404 got the same pass (body copy only; titles, descriptions, FAQs and facts untouched). `functions/ask/_data/guides-index.json` was re-embedded from the current guides on 2026-09-30 (43 chunks, `gemini-embedding-001`). Re-run `npm run build:guides-index` with `GEMINI_API_KEY` set after any guide edit.
- **Ask hand-off (2026-09-30).** `/ask` offers "Request a call back" (dialog; posts to `/api/estimate` with role `Ask assistant`) next to "Start estimate" once the visitor has had two answers or chosen project details. Hand-off taps are counted in D1 (`ask_handoffs`, kind + timestamp only) and shown as a 30-day funnel on `/internal/ask-logs`; GA4 gets `ask_handoff` (needs a GTM tag) and `generate_lead` with `method: ask_callback`. The estimate pre-fill now carries opening type and project stage too. `/ask` is also linked from the shared CTA band, the home page signs section and `/replacement` (the header nav has no room for another link at 1440px). The privacy policy now has a section on the consultant (AI providers, photo handling, what is and is not stored, hand-off counts) and covers call-back requests; `test:ask-handoff` fails if those phrases disappear. **Owner review wanted** on the updated privacy text before relying on it, and the terms page still has nothing on AI answers.
- **Guide graphics.** New infographics (double-pane glass, vinyl vs fiberglass; the window-anatomy graphic was also removed 2026-09-30 as inaccurate and low quality; the old-window-to-replacement graphic was removed 2026-09-30 for being inaccurate, and a replacement must be checked by Mark before it goes on the site) live in `src/assets/guides/` and render through `CanvaGuideEmbed.astro` using `getImage()` (WebP, explicit dimensions). Never put Canva exports in `public/`: they were 1–3.4 MB raw PNGs (one "SVG" was 2.6 MB of 49 embedded PNGs). `guides/[slug].astro` hides a guide's `heroImage` only for photo-based diagram types (`insert-vs-full-frame`, `flashing-order`, `signs-checklist`); the illustration-style diagrams intentionally pair with a photo.
- **Privacy policy** discloses the Meta pixel (delivered through the existing GTM container `GTM-WGCFVHQM`, no inline pixel code). The estimate form's JS success path now pushes the same `generate_lead` dataLayer event the no-JS `/estimate/sent` page does.
- **Real hero photos.** `/new-construction`, `/areas` (+ city pages) and `/tools` now use real Clearview job photos instead of AI/stock imagery; the credit lines say "Clearview job photo" and, on city pages, "not specific to <city>" because photos are not tagged to towns. With those swapped, nothing referenced `src/assets/hero/` any more, so the whole directory (AI/stock hero files) was deleted. The other photo heroes (`/about`, `/process`, `/replacement`, `/window-features`, `/sliding-glass-doors`, `/gallery`) already used real job photos; the homepage hero is video-backed and the guides pages use no photo hero.
- **CI.** `test:google-reviews` had been failing on `main` (it required the about page to read `site.googleReviews`, but the about page no longer shows a rating); the assertion now allows an about page with no rating/count of its own. The GitHub Actions `build` job also intermittently fails in ~4 s with no runner allocated (infrastructure, not code); a failure that runs ~40 s is a real test failure. Cloudflare Pages preview success is a separate build signal.

### 2026-09-28 — internal Analytics page, Nextdoor share link

- **`/internal/analytics`** (Command Center nav, behind the session middleware, never cached). *Where leads came from* is counted from first-touch attribution already stored on each lead in D1 (`functions/internal/_lib/lead-sources.mjs`), so it needs no setup. *Site traffic* reads the GA4 Data API through `functions/internal/_lib/ga4.mjs` (service-account JWT, read-only scope, fail-soft: `unconfigured` / `unavailable`, never echoes keys or upstream bodies). It shows "Not connected" until `GA4_PROPERTY_ID` and `GA4_SERVICE_ACCOUNT_JSON` are set; the step-by-step setup is in `internal/README.md` ("Analytics"). Tests: `npm run test:analytics` (wired into CI).
- **GTM has no reports of its own**, so its numbers are the GA4 numbers. **Ahrefs is a link only:** Mark is on the free Webmaster Tools plan, which has no API (API units come with paid Lite and up). Revisit if a paid plan is added.
- **Nextdoor:** guides carry a plain "Share on Nextdoor" link using Nextdoor's Share Plugin (`nextdoor.com/sharekit/`; no script, no application, nothing sent until clicked, so no privacy-policy change). Mark runs no Nextdoor ads, so the Conversions API (needs approval from Nextdoor and an ads account plus pixel ID) was not built. The Publishing API is approval-based and "primarily for advertising partners"; apply via Nextdoor's Publishing API form only if posting to Mark's business page from the site becomes worth pursuing.
- **Still to do outside the repo:** the GA4 service-account setup (Google Cloud + GA4 property access + two Cloudflare variables), assigned to Cowork.

### 2026-09-29 — Analytics: requests-to-revenue pipeline

- `/internal/analytics` now opens with **Requests to revenue** (last 90 days), counted from D1 with no setup: estimate requests, quotes written (+ $ quoted), quotes signed (+ $ signed, by `signed_at`), jobs (non-cancelled) and completed, and $ collected (`job_payments` on jobs created in the window). Rates: quotes per request, signed per quote, median days quote→signature, average signed quote. *Needs attention*: draft quotes older than 14 days (all-time backlog, with $) and finalized quotes with no job (exact SQL `NOT EXISTS`).
- Logic lives in `functions/internal/_lib/pipeline-summary.mjs` (pure, integer cents). The endpoint returns aggregates only (no names/ids) and fails soft per table: no `jobs` table → jobs unknown; no `job_payments` → collected unknown (not $0).
- **Lead → quote link (`quotes.lead_id`, `quotes.lead_linked_at`).** Added to `internal/db/schema.sql` and migrated lazily on production by `ensureQuoteLeadColumn()` (`functions/internal/_lib/lead-links.mjs`; `ALTER TABLE` is idempotent, existing quotes stay unlinked). *Start quote* on `/internal/leads` now saves the link (`POST /internal/api/quotes` accepts `leadId`, rejects unknown/invalid ids). The quote page shows the linked inquiry or **exact phone/email match suggestions** that Mark must click to link (`GET/POST /internal/api/quote-lead`); nothing is ever auto-linked. Unlink is available. The link is attribution metadata only and never touches contract fields, so it works on finalized quotes. The leads list shows *Open quote* when a lead already has one.
- **Traced attribution:** *Which sources bring paying work* on `/internal/analytics` credits requests, quotes, signed $ and collected $ (quote → job → `job_payments`) to the linked inquiry's first-touch source, and shows how many quotes in the window are still unlinked. Quotes made before this change need linking from their quote page to count.
- Tests: `scripts/test-analytics-pipeline.mjs` (`npm run test:analytics`) and `scripts/test-lead-links.mjs` (`npm run test:lead-links`, in CI), both on real SQLite via `scripts/_lib/d1-sqlite.mjs`.

### 2026-09-29 — Quote follow-up cadence

- Draft quotes now get an automatic reminder in Mark's queue at **day 2, 7 and 14** after they were written (`functions/internal/_lib/quote-follow-ups.mjs`). Reminders are `follow_up_tasks` rows with `quote_id` + `cadence_step` (`created_by = 'system'`), guarded by a unique index so a step is created at most once. At most one open reminder per quote; an old draft gets one reminder (latest due step), not three. Signing or deleting the quote closes its open reminders.
- No cron: `syncQuoteFollowUps()` runs when `/internal/api/tasks` or `/internal/api/dashboard` is read (Today, Follow-up, Command Center), fail-soft. It **never contacts the customer**; the reminder text says so.
- Reminders show the quote's customer name/phone even when the quote isn't linked to a lead, with a *Quote* link on Today and Follow-up.
- Tests: `npm run test:quote-follow-ups` (real SQLite, in CI).
- **Volume check (production D1, read-only):** 0 leads ever, 2 quotes, 0 tasks. The `leads` schema matches the insert, so the form has had no submissions. More pipeline tooling will not change revenue until real requests arrive; the next lever is traffic/outreach, not code.

### 2026-09-29 — Customer quote signing links

- Mark can send a customer a private link to review and e-sign a quote on their own phone (`/sign#<token>`). The panel on `/internal/quotes/view` creates the link (only for a draft with an approved, current Build Plan), shows sent / viewed N times / signed, and offers Copy, Text (`sms:` from Mark's phone) and Email (`mailto:`). Nothing is sent by the server.
- Security (`functions/internal/_lib/quote-signing.mjs`): 256-bit token stored only as SHA-256; token in the URL fragment (never reaches servers, logs, GA4 or referrers), sent to the API in a header/body; one active link per quote; 30-day expiry; the public view is a field whitelist (no notes, phone, email, lead or ids). The customer submits **stroke coordinates only**; the server range-checks them and renders the SVG, because the internal quote page inserts `signature_svg` as HTML.
- Signing (`functions/api/quote-sign.js`) requires explicit e-sign consent and a typed name, re-runs the approved-Build-Plan gate (now shared in `functions/internal/_lib/quote-gates.mjs`), refuses if the quote's `terms_version` differs from current terms, and finalizes with a conditional UPDATE so it can only happen once. The invoice is finalized, open quote reminders close on the next sync, and an optional ntfy push (`sendOpsAlert`) tells Mark. User-agent is kept as signing evidence; the privacy policy says so.
- `VERIFY` (legal, unchanged): `src/data/contractTerms.ts` is not attorney-reviewed. Remote e-signing makes a lawyer's look at the terms and the right-to-cancel notice more important, not less.
- Next on the gap list: deposits/online payment (needs the Stripe connector authorized).
- Tests: `npm run test:quote-signing` (real SQLite, in CI).

### 2026-09-29 — Install-method terminology removed from customer copy

- **Why:** Mark does not want customers to read "full-frame" as "we tear out your whole window frame." Reference site (thermoloc.co/window-replacement) does not name install methods either: it says "replacement windows" vs "new construction windows" and offers a consultation. Customer copy now says what we can do, and the method is Mark's call at the quote. Public copy also does not name Mark (see the 2026-09-27 boundary).
- **Rule:** customer-facing pages, guides, city pages, JSON-LD and the Ask knowledge index must not use *insert*, *full-frame*, *pocket*, *block frame* or *nail fin* for existing-home replacement. Say "we measure every opening and tell you the right approach in the written estimate." "Nailing-fin" stays acceptable on new-construction copy. Guarded by `npm run test:public-terminology` (in CI).
- **What changed:** `/replacement` (method diagram + four-question card replaced by "What we can do for you"); guide `full-frame-vs-insert` rewritten as `/guides/what-your-openings-need` with a 301 in `public/_redirects`; diagram component renamed `OpeningScope` (`diagram: opening-scope`); city pages, other guides, home, tools index, estimate-sent, terms, `JsonLd`, Ask suggestion chips.
- **Calculator:** the "how much comes out" step is gone. One range for every house, using the old "mixed" assumption (34% of openings get the extra frame-level amount in `pricing.fullFrame`). Numbers in `src/data/pricing.ts` are unchanged, so ranges for a "mixed" house are identical to before; ranges for someone who used to pick "insert" only are now higher, and "full-frame" only lower. `functions/ask/_lib/pricing.mjs` mirrors this (its `method` parameter is removed).
- **Ask assistant:** system prompt has a TERMINOLOGY rule; `compare_installation_paths` returns `simplerScope` / `moreWork` and a note not to name methods.
- **Unchanged on purpose:** Command Center, Build Plan and stored quote data still use insert/full-frame internally (`pages/internal/*`, `build-plan-rules.mjs`). Mark picks the method there; renaming stored values would risk saved quotes and jobs.
- **`VERIFY` / outstanding:** `functions/ask/_data/guides-index.json` was patched by hand (old guide's 5 chunks removed, link text fixed) because embeddings need `GEMINI_API_KEY`. Run `GEMINI_API_KEY=... npm run build:guides-index` to re-embed `what-your-openings-need` so Ask can retrieve it. The `estimate_price` mismatch noted here was fixed later the same day (see the Ask price tool entry).

### 2026-09-29 — SEO striking-distance titles and descriptions

- Area pages, `/areas`, `/about`, `/gallery` have new titles (50-60 chars) and descriptions (130-155, with "free in-home measure" and "written estimate"). Area titles are `Window Replacement in {City}, WA | Clearview Windows`; Vancouver is `Vancouver, WA Window Replacement | ...` because the home page already owns the first form. Baseline numbers and follow-ups are in `docs/seo-log.md`.
- Duplicate slash URLs needed no code change: Cloudflare already answers `/x/` with `308 -> /x`, and canonical, `og:url`, sitemap and internal links are slash-free. `/areas/portland/` now also 301s straight to `/areas` (Portland is not served).
- Guard: `npm run test:seo` (after `npm run build`, in CI) checks missing/duplicate/over-length titles and descriptions, canonical == own URL, sitemap == canonical set, and `_redirects` loops. Four older pages exceed the limits and are listed as known exceptions to fix later.
- After merge (Keith): Search Console URL Inspection → Request Indexing for the changed pages; re-check clicks/impressions/CTR/position at 14 and 28 days.

### 2026-09-29 — Bug sweep (forms, mobile layout)

- **Estimate form phone validation was silently off.** The phone input's `pattern` used `[\s.-]`; an unescaped `-` in a character class is a SyntaxError under the `v` flag browsers use for `pattern`, so the browser skipped the check (`abc` and `555` passed client-side; only the server caught them). Escaped to `[\s.\-]`. Guard: `npm run test:form-patterns` (after `npm run build`, in CI) compiles every built `pattern` with the `v` flag.
- **Horizontal scroll on phones** (checked all 63 built pages at 320 and 375 px in Chromium): `/new-construction` (long email in a `.steps` item), the cost calculator at 320 px (fieldset and counter rows), `/about` at 320 px (a ~48 px headline word), and two Command Center pages (`/internal/analytics` grid, `/internal/ask-logs` header). All fixed with `min-width: 0` / wrapping; no page overflows at either width now. There is no CI check for this (needs a browser); rerun the sweep after big layout changes.
- Also checked, no change needed: internal links (0 broken across the built site), console errors and failed requests on every public page, image alt text, duplicate ids, `_blank` links.

### 2026-09-29 — Bug sweep follow-up (calculator handoff)

- The live cost calculator built a `scope` query for `/estimate`, but the estimate form removed that query without adding it to project notes. The handoff now prefills notes from the bounded scope query (or the same-tab session value), shows the existing prefill hint, and consumes the stored scope once. No estimate was submitted during verification.
- Verified the full calculator → estimate flow locally in the browser with one double-hung window; the notes show `1 opening: 1 double-hung. Material: Vinyl`. Regression guard: `npm run test:recent-fixes`.

### 2026-09-29 — Ask price tool restored; production check

- **`estimate_price` (Ask) was broken.** The tool declared `openings` ('1'/'2–5'…), `home_type`, `complexity`, but `estimatePrice()` needs `lines`, so every call errored. Production `ask_logs` shows it worked on 2026-08-28 (4 calls) and has not been called since: a later pricing refactor broke it silently. `functions/ask/_lib/pricing.mjs` now owns the tool declaration (`estimatePriceToolDeclaration()`, enums built from `PRICING`) and the adapter (`estimateFromToolArgs()`, returns a range plus a "planning range, not a quote" note and never names install methods). Bad or missing input returns an error with a hint, never a price. Covered by `npm run test:ask-pricing`.
- **Production D1 check (read-only, schema and aggregate counts only):** `leads` has every column the insert writes and now holds a row from 2026-09-29, so the earlier "0 leads / are leads being written?" `VERIFY` is resolved: the form-to-D1 path works. `follow_up_tasks` in production still lacks `quote_id`/`cadence_step` and there is no `quote_sign_links` table yet; both are created lazily by `ensureFollowUpSchema()` / `ensureSigningSchema()` on first Command Center load / first signing link, by design.

## Outstanding

| | |
| --- | --- |
| **Oversize/custom-shape pricing** | `src/data/pricing.ts` now carries Mark's own installed pricing (reviewed 2026-09-26) except the oversize/custom-shape modifier, which is still a regional average. |
| **Canonical-domain mailbox** | Provision and test before changing production mail defaults. |
| **`ADMIN_TOKEN`** | Optional; worker pricing writes remain closed while unset. |
| **Google Business Profile** | Exists as of 2026-09-26 ("Clearview windows and trim LLC", managed by Keith, 5.0 / 1 review). Still needs name/category/service-area disambiguation from `clearviewpdx.com` (see 2026-09-16 audit follow-up above). Reviews feed built, waiting on the Places API key + Place ID. |
| **Single-color logo glyph** | Commission a simplified flat glyph for embroidery/engraving/one-color applications. |

## How I like to work

- Verify rather than assert — build it, run it, inspect it, then say it works.
- Say plainly when something cannot be done honestly, then build the nearest thing that can.
- Flag your own bugs rather than quietly patching them.
- Push to `main`; Cloudflare Pages deploys automatically.
