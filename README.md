# Clearview Windows

Marketing site and internal quoting platform for **Clearview Windows**, operated by **Clear View Windows & Trim LLC**. The public site covers replacement and new-construction windows in Vancouver, WA, Clark County, and the surrounding service area.

- **Production:** https://windowsbyclearview.com
- **Stack:** Astro 7, static build, Cloudflare Pages
- **Server-side:** Cloudflare Pages Functions + D1
- **Internal app:** `/internal/*`
- **Customer assistant:** `/ask`
- **Pricing worker:** Cloudflare Worker + KV
- **Repository:** `ksksrbiz-arch/windowsbyclearveiw`

> The repository/domain spelling contains the historical `clearveiw` typo. The customer-facing brand and production domain use **ClearView/Clearview** correctly. Existing operational email addresses should not be changed without an actual mailbox/domain migration.

## Platform status

The platform has been through a substantial hardening pass covering the public marketing site, estimate intake, `/ask`, internal quoting, field photography, invoices, SEO, accessibility, and regression testing.

### Production checklist

- [ ] **Washington L&I contractor registration number** — set `lniNumber` in `src/data/site.ts` once the real registration number is available. The build warns while it is blank. Set `REQUIRE_LNI=1` in the production Pages environment afterward so future accidental removal fails the build.
- [ ] **`RESEND_API_KEY` on Pages** — required for live estimate delivery.
- [ ] **Reviews** — `/reviews` intentionally remains empty until real customer quotes are approved for publication.
- [ ] **Internal production bindings** — `QUOTES_DB`, `INTERNAL_PASSWORD`, and `INTERNAL_SESSION_SECRET` must be configured in Cloudflare Pages.
- [x] **Groq/Gemini integration** — `/ask` has provider fallback and graceful degradation.
- [ ] **Workers AI `AI` binding** — required for `/ask` photo analysis; the rest of `/ask` continues to work without it.
- [ ] **Durable rate limiting** — public estimate and `/ask` endpoints currently rely on validation, size limits, origin checks, honeypots, and provider controls rather than a durable application-level rate limiter.
- [ ] **Full production browser smoke pass** — source/build regression coverage is strong, but real-browser verification of the latest `/ask` production behavior should still be completed.

## Local development

Requires **Node 22.19.0 or newer**.

```bash
npm install
npm run dev
```

For a normal static build:

```bash
npm run build
npm run preview
```

`npm run dev` and `npm run preview` are useful for the static site, but they do not reproduce the full Cloudflare Pages Functions environment. Use `wrangler pages dev` when testing `/internal/*` or other server-side bindings.

## Cloudflare Pages

1. Import this repository into Cloudflare Pages.
2. Production branch: `main`.
3. Build command: `npm run build`.
4. Build output directory: `dist`.
5. Attach `windowsbyclearview.com` as the production custom domain.

The public site is intentionally static and does **not** require the Astro Cloudflare adapter. Pages Functions under `functions/` provide the server-side APIs.

The production build is pinned to Node `22.19.0` through `.node-version` and the package engine requirement.

## Project layout

| Area | Location |
| --- | --- |
| Public pages | `src/pages/` |
| Internal application | `src/pages/internal/` |
| Public API functions | `functions/api/` |
| Ask API | `functions/ask/api/` |
| Ask helpers | `functions/ask/_lib/` |
| Internal APIs/helpers | `functions/internal/` |
| Site/business data | `src/data/` |
| City content | `src/content/cities/` |
| Guide content | `src/content/guides/` |
| Review content | `src/content/reviews/` |
| Work photography | `src/assets/work/` + `src/data/work.ts` |
| Public static assets | `public/` |
| Pricing worker | `workers/pricing/` |
| Shared pricing validation | `shared/pricing-schema.mjs` |
| Regression tests | `scripts/test-*.mjs` |
| Live evaluations | `scripts/eval-*.mjs` |

## Where to edit content

| What | File |
| --- | --- |
| Phone, email, L&I, service area | `src/data/site.ts` |
| Pricing model | `src/data/pricing.ts` |
| Job photos, captions, alt text | `src/data/work.ts` + `src/assets/work/` |
| City pages | `src/content/cities/` |
| Reviews | `src/content/reviews/` |
| Guides | `src/content/guides/` |
| Contract terms | `src/data/contractTerms.ts` |
| Homepage video | `public/video/hero.mp4` |

### Adding a work photo

1. Put the original image in `src/assets/work/` with a descriptive filename.
2. Import it from `src/data/work.ts`.
3. Add accurate, human-written alt text.
4. Use `featured: true` only when the image belongs in the homepage featured block.

Astro processes images in `src/assets/` at build time. Do not put build-processed work photography in `public/` unless it intentionally needs to ship untouched.

### Adding a service area

Add the city markdown file under `src/content/cities/` and add the city to the `nearby` data in `src/data/site.ts` so the site's structured data and About content stay aligned.

## SEO, accessibility, and security

The public layout uses Astro's `ClientRouter` for page transitions and reinitializes page behavior through `astro:page-load` so forms, navigation state, reveal effects, and analytics continue working after client-side navigation.

The public platform includes:

- canonical URLs and Open Graph/Twitter metadata;
- JSON-LD and breadcrumb data;
- sitemap generation with internal routes excluded;
- `robots.txt` protection for internal tooling;
- `noindex, nofollow` on internal pages;
- skip navigation and semantic `<main>` landmarks;
- explicit image alt-text checks, including Astro `<Image>` usage;
- secure response headers in `public/_headers`;
- HSTS, frame protection, MIME sniffing protection, referrer policy, and a restrictive permissions policy;
- no-store behavior for sensitive estimate API responses;
- client-side analytics scheduled away from the critical navigation path;
- optimized hero imagery and metadata-only hero video preload.

The marketing regression suite also checks for unsupported regulated-business claims such as advertising the contractor as “bonded and insured” or inventing an L&I number.

## Pricing

The public calculator is `/tools/window-replacement-cost-calculator`. Its bundled numbers live in `src/data/pricing.ts`.

Each baseline is an **installed cost per opening** for a standard-size, ground-floor, vinyl insert installation, including the unit, labor, and normal finish work. Fiberglass, full-frame installation, second-story access, and custom shapes are modifiers rather than additional baselines.

To move from regional published averages to Clearview's own reviewed pricing:

1. Update `src/data/pricing.ts`.
2. Set `basis.source` to `'clearview'`.
3. Set `basis.reviewedAt` to the actual review date.

Zero-value opening types are hidden rather than treated as free.

### Pricing worker

`workers/pricing/` is a separate Cloudflare Worker backed by KV. It validates pricing rather than attempting to scrape or invent market prices.

| Route | Purpose |
| --- | --- |
| `GET /` | Return the validated pricing document |
| `GET /health` | Report validation state, age, and review status |
| `PUT /` | Replace pricing after bearer-token authentication and validation |
| Monthly cron | Revalidate pricing and optionally email a reminder |

The site keeps its own bundled pricing and only upgrades when the worker contains a document at least as recently reviewed. A worker outage, malformed response, or empty KV therefore cannot blank the estimator.

The worker uses:

| Variable | Project | Purpose |
| --- | --- | --- |
| `RESEND_API_KEY` | Pricing Worker | Reminder email from cron |
| `ADMIN_TOKEN` | Pricing Worker | Authorizes `PUT /` |
| `PUBLIC_PRICING_ENDPOINT` | Pages | Build-time pricing upgrade endpoint |
| `RESEND_API_KEY` | Pages | Estimate lead delivery |

`PUBLIC_PRICING_ENDPOINT` is read at **build time**, so changing it requires a Pages rebuild. Runtime secrets take effect without rebuilding.

Deploy the worker with:

```bash
cd workers/pricing
npx wrangler deploy
```

The shared validator in `shared/pricing-schema.mjs` rejects inverted ranges, excessive spreads, missing baselines, out-of-range multipliers, and future review dates.

## Estimate intake

The public estimate form submits to:

```text
POST /api/estimate
```

The Pages Function validates and sanitizes the submission before sending the published Resend templates.

Current protections include:

- `multipart/form-data` enforcement;
- request-size protection;
- same-origin `Origin` validation when an origin is supplied;
- honeypot spam detection;
- strict email validation;
- field-length and control-character normalization;
- capped visitor-journey fields;
- generic error responses that do not disclose provider/template internals;
- `nosniff` JSON responses;
- no-store response handling;
- real no-JavaScript fallback redirects to `/estimate/sent` and `/estimate/problem`.

The lead notification and customer receipt use the existing published Resend templates. The lead notification can include a generated vCard for the submitted contact details.

Current environment variables:

| Variable | Required | Default |
| --- | --- | --- |
| `RESEND_API_KEY` | Yes | — |
| `NOTIFY_EMAIL` | No | `owner@windowsbyclearveiw.com` |
| `RESEND_FROM` | No | `Clearview Windows <estimates@windowsbyclearveiw.com>` |

Do not change the legacy `clearveiw` mailbox address merely to correct the spelling; verify and migrate the actual mailbox first.

## Ask — design consultant

`/ask` is a public project-planning assistant. It can answer general window/construction questions, retrieve Clearview's published guide material, calculate a project price range through the pricing tool, search for current industry information, and route visitors to `/estimate` when a firm quote is appropriate.

The assistant uses provider fallback:

- **Groq:** `openai/gpt-oss-120b` for the primary fast path.
- **Gemini:** `gemini-3.6-flash` as the fallback/native function-calling path.

The API limits each turn's message and history size and limits tool rounds. Provider failure degrades gracefully rather than crashing the page.

### Knowledge boundaries

The assistant keeps three knowledge tiers separate:

1. **Clearview reference material** — published `/guides` plus controlled business facts. This is the source for Clearview-specific claims.
2. **`estimate_price`** — the only source for numerical pricing. It follows the same published pricing model as the public calculator.
3. **General knowledge/search** — industry information and current public information, never a substitute for Clearview-specific source material.

Safety rules explicitly prevent invented dimensions, quantities, specifications, warranties, L&I numbers, regulated-business claims, competitor promotion/comparison, legal advice, and firm final pricing outside the pricing tool.

### Photo analysis

Visitors can attach a window photo. The browser resizes it before sending it as a base64 field. `functions/ask/_lib/vision.mjs` uses the Cloudflare Workers AI `AI` binding for a factual visual description such as visible frame material, style, fogging, or damage.

The visual description is treated as an observation, **not a measurement**. The assistant is explicitly prevented from turning a photo into an assumed opening count or exact price input.

The photo itself is not persisted by the current implementation. Missing Workers AI configuration or quota exhaustion degrades gracefully and does not prevent the rest of the chat turn from completing.

### Retrieval

Guide retrieval is generated at build/development time rather than fetched live on every request.

`scripts/build-guides-index.mjs` reads published guides, splits them into `##` sections, embeds them with Gemini's `gemini-embedding-001`, and writes the committed index at:

```text
functions/ask/_data/guides-index.json
```

Regenerate after meaningful guide changes:

```bash
GEMINI_API_KEY=... node scripts/build-guides-index.mjs
```

### Ask observability

Ask turns are logged best-effort to the `ask_logs` table in the internal D1 database. The internal `/internal/ask-logs` screen is protected by the same authentication boundary as the rest of the internal application.

### Ask testing

Run the live evaluator with:

```bash
node scripts/eval-ask.mjs [baseUrl]
```

The evaluator covers guide grounding, business facts, regulated-claim refusals, pricing behavior, general questions, off-topic handling, photo measurement guardrails, project-state extraction, and multi-turn continuity.

Security-specific endpoint checks are available with:

```bash
npm run test:ask-security
```

## Internal Command Center

The internal application lives under `/internal/*` and is not part of the public marketing surface.

The root dashboard at `/internal/` is the **Command Center**. It provides a compact operational view of recent leads, quote counts/value, lead source/location summaries, and links to the internal tools. The dashboard reads through a small server-side aggregation endpoint rather than downloading every record to the browser.

The internal workflow supports:

- lead management;
- quote creation and editing;
- line-item pricing;
- contract generation;
- digital or print/manual signatures;
- opening/build-plan state;
- field measurements;
- opening and closeout evidence;
- field photography;
- payment/invoice tracking;
- finalized closeout and completion gates;
- Ask logs.

### Production bindings

Configure these in Cloudflare Pages → **Settings → Bindings/Environment** as appropriate:

| Name | Type | Purpose |
| --- | --- | --- |
| `QUOTES_DB` | D1 | Leads, quotes, invoices, internal state, Ask logs |
| `INTERNAL_PASSWORD` | Secret | Internal login password |
| `INTERNAL_SESSION_SECRET` | Secret | Signs the internal session cookie |
| `AI` | Workers AI binding | `/ask` photo analysis |
| `RESEND_API_KEY` | Secret/environment variable | Email delivery |

The root `wrangler.toml` is for local development and does not configure the real production Pages bindings.

### Local internal development

```bash
npm run build
npx wrangler d1 execute QUOTES_DB --local --file=internal/db/schema.sql
npx wrangler pages dev dist \
  --d1 QUOTES_DB=4700b6f7-c3d8-46c9-9b19-17cf34accb84 \
  -b INTERNAL_PASSWORD=devpassword \
  -b INTERNAL_SESSION_SECRET=devsecret \
  --ai AI
```

`npx astro dev` and `astro preview` do not provide the full Pages Functions environment, so use `wrangler pages dev` for internal/API testing.

### Internal data rules

A quote remains editable until it is finalized. Once a quote/contract is finalized, the application deliberately removes the normal edit path so a signed contract cannot be silently altered.

Completion requires the server-side finalized Closeout state. Field verification also requires the required measurement gate. Client UI state is not treated as the authoritative source for these release decisions.

Original field photos currently remain browser-local rather than being persisted to R2/cloud storage. The application maintains photo manifests and gates around the evidence workflow, but a server cannot independently prove the existence of a browser-local image.

The internal application currently uses a single shared login for the intended single-operator workflow. It does not provide per-user identity, password reset, or a full actor audit trail.

Contract language has not received attorney review. Do not treat it as a substitute for legal review.

## Regression and build testing

The repository has a layered test suite. Run the full local checks before considering a platform change complete:

```bash
npm run test:icm
npm run test:build-plan-state
npm run test:build-plan-integration
npm run test:production-hardening
npm run test:marketing-platform
npm run test:ask-security
npm run test:recent-fixes
npm run eval:build-plan
npm run build
```

Available npm scripts include:

| Script | Purpose |
| --- | --- |
| `test:icm` | Internal command/state routing checks |
| `test:build-plan-state` | Build-plan state machine regressions |
| `test:build-plan-integration` | Build-plan integration behavior |
| `test:production-hardening` | Internal production/security hardening checks |
| `test:marketing-platform` | Public-site routing, SEO, accessibility, form, and security regressions |
| `test:ask-security` | `/ask` endpoint security checks |
| `test:recent-fixes` | Regression coverage for recent field-photo, login, invoice, sitemap, and estimate fixes |
| `eval:build-plan` | End-to-end build-plan evaluation |
| `eval:ask` | Live `/ask` behavioral evaluation |
| `build:guides-index` | Regenerate the guide embedding index |
| `build` | Production Astro build |

The CI workflow runs the same core suite before the production build.

### CI note

GitHub Actions has recently experienced a repository/account-level startup/billing failure that can terminate a run before any workflow step starts. When that happens, the failure is infrastructure-level rather than a failing test in this repository. The local suite above remains the authoritative way to validate changes while that external issue persists.

## Deployment notes

For a normal Pages deployment, push to `main` after local tests/build are clean. Cloudflare Pages performs the Astro build and publishes `dist`.

For pricing-worker code changes:

```bash
cd workers/pricing
npx wrangler deploy
```

For guide-content changes that affect Ask retrieval:

```bash
GEMINI_API_KEY=... npm run build:guides-index
git add functions/ask/_data/guides-index.json
git commit -m "docs: refresh Ask guide index"
```

After changes to `/ask`, pricing, internal gates, estimate intake, or authentication, run both the relevant static regression suite and the appropriate live evaluator/browser smoke test.

## Known gaps / deliberate follow-ups

These are tracked deliberately rather than hidden behind optimistic documentation:

1. **Durable public rate limiting** — `/api/estimate` and `/ask/api/chat` have strong request/field guards but no durable application-level rate limiter.
2. **Production browser smoke coverage** — automated source/build tests do not replace checking the deployed UI in a real browser, particularly `/ask` sources/grounding and responsive behavior.
3. **Field-photo durability** — original photos are browser-local; durable cloud photo storage is not currently part of the workflow.
4. **Shared internal login** — appropriate for the current single-operator model, not a multi-user identity system.
5. **Legal review** — contract language needs professional review before being treated as legally authoritative.
6. **L&I registration data** — do not publish an invented or placeholder registration number.

## Important principle

This repository intentionally favors **fail-closed behavior for authoritative business state** and **graceful degradation for optional external services**:

- signed/finalized internal records cannot be silently rewritten;
- server-side gates outrank client UI state;
- pricing comes from a validated source;
- Clearview-specific Ask claims require controlled reference material;
- optional AI/email services fail gracefully instead of taking down the site;
- public/internal boundaries are enforced both in routing and metadata;
- regression tests are kept alongside the fixes they protect.
