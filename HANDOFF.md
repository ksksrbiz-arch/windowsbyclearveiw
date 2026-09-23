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
- **Legal entity:** Clear View Windows & Trim LLC (WA UBI 605 779 798), doing business as "Clearview Windows". `site.legalName` in `src/data/site.ts` holds the legal name; `site.name`/`site.shortName` hold the trade name.
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

1. **No invented reviews.** `/reviews` is deliberately empty. It previously shipped three fabricated testimonials attributed to named people in a city Mark does not serve. Reviews default to `published: false`. Only real quotes from real customers who agreed, ever.
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

## Outstanding

| | |
| --- | --- |
| **Mark's real pricing** | Replace regional averages when actual ranges are supplied. |
| **Canonical-domain mailbox** | Provision and test before changing production mail defaults. |
| **`ADMIN_TOKEN`** | Optional; worker pricing writes remain closed while unset. |
| **Google Business Profile** | Urgent — none exists. Must also disambiguate from `clearviewpdx.com`, an unrelated same-named competitor already claimed in the same service area (see 2026-09-16 audit follow-up above). |
| **Single-color logo glyph** | Commission a simplified flat glyph for embroidery/engraving/one-color applications. |

## How I like to work

- Verify rather than assert — build it, run it, inspect it, then say it works.
- Say plainly when something cannot be done honestly, then build the nearest thing that can.
- Flag your own bugs rather than quietly patching them.
- Push to `main`; Cloudflare Pages deploys automatically.
