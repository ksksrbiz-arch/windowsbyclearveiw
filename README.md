# Clearview Windows

Marketing site for **Clearview Windows** (operated by Clear View Windows & Trim
LLC) — replacement and new-construction window installation in Vancouver, WA
and the rest of Clark County.

- Domain: [windowsbyclearview.com](https://windowsbyclearview.com)
- Stack: [Astro](https://astro.build) (static, no adapter)
- Deploy: Cloudflare Pages from this GitHub repo

## Before this counts as live advertising

- [ ] **L&I contractor registration number.** Set `lniNumber` in `src/data/site.ts`.
      Washington requires a registered contractor's number in advertising, and a
      website is advertising. The build prints a warning while it is empty, and the
      footer says the number is pending rather than inventing one. Once you have
      the number, set `REQUIRE_LNI=1` in the Pages production environment so a
      later edit that blanks it fails the build instead of quietly publishing.
      Washington also prohibits advertising that a contractor is "bonded and
      insured", so that phrase is deliberately absent from the footer.
- [ ] **`RESEND_API_KEY`** set in Cloudflare Pages → Settings → Environment variables
      (Production, and Preview if you want to test there). Without it the estimate
      form answers "Mail is not configured yet" and no lead reaches Mark.
- [ ] **Reviews.** `/reviews` is deliberately empty. Only add entries with
      `published: true` for quotes from real customers who agreed to be quoted.
- [ ] **Pricing.** The cost estimator currently runs on published Washington /
      Portland-metro averages, labelled as such on the page. Mark's own ranges
      convert better — see [Pricing](#pricing) below.
- [ ] **Internal quoting tool bindings.** `/internal/*` (Mark's quote +
      contract + signature tool) needs `QUOTES_DB`, `INTERNAL_PASSWORD`, and
      `INTERNAL_SESSION_SECRET` set in Cloudflare Pages → Settings → Bindings
      before it works in production. See [internal/README.md](internal/README.md).
- [x] **`GROQ_API_KEY` and `GEMINI_API_KEY`** set in Cloudflare Pages →
      Settings → Environment variables. Without them `/ask` still loads but
      answers "The assistant isn't available right now" instead of crashing.
      See [Ask, the design-consultant chatbot](#ask-the-design-consultant-chatbot)
      below.
- [ ] **`AI` Workers AI binding** set in Cloudflare Pages → Settings →
      **Bindings** (not Environment variables — this is a binding, same
      category as `QUOTES_DB`, not a secret). Free up to 10,000 Neurons/day,
      no billing setup. Without it the photo-upload button on `/ask` still
      works, it just answers that photo analysis isn't configured yet rather
      than failing the turn. See
      [Ask, the design-consultant chatbot](#ask-the-design-consultant-chatbot).

## Local development

Requires Node 22.12+.

```bash
npm install
npm run dev
```

Build check:

```bash
npm run build
npm run preview
```

## Cloudflare Pages

1. Workers & Pages → Create → Pages → Import this repository.
2. Production branch: `main`
3. Build command: `npm run build`
4. Build output directory: `dist`
5. Attach `windowsbyclearview.com` after the first deploy.

No Cloudflare adapter is required while the site stays static. The estimate form
runs as a Pages Function from `functions/api/estimate.js`.

## Where to edit content

| What | File |
| --- | --- |
| Phone, email, L&I, service area | `src/data/site.ts` |
| Job photos, captions, alt text | `src/data/work.ts` + `src/assets/work/` |
| City pages | `src/content/cities/` |
| Reviews | `src/content/reviews/` |
| Guides | `src/content/guides/` |
| Homepage video | `public/video/hero.mp4` |

### Adding a photo

1. Drop the file in `src/assets/work/` with a descriptive name (`green-gable.jpg`).
2. Import it in `src/data/work.ts` and add an entry with real alt text.
3. `featured: true` puts it in the six-tile block on the homepage.

Astro resizes these at build time and emits WebP, so commit the original — do not
pre-shrink it. Photos are *not* in `public/`; anything there ships unprocessed.

### Adding a service area

Add a markdown file to `src/content/cities/`, then add the city to `nearby` in
`src/data/site.ts` so it shows up in the schema and the About page.

## Pricing

The cost estimator at `/tools/window-replacement-cost-calculator` gets every
number from `src/data/pricing.ts`. Nothing else in the codebase knows about money.

Each opening figure is **installed cost per opening**: unit, labour, and normal
finish work, for a standard-size ground-floor opening, **in vinyl, as an insert**.
Fiberglass, full-frame, second-story access, and custom shapes are modifiers —
never fold them into the baseline or they get counted twice.

To switch from regional averages to Mark's real pricing:

1. Replace the figures in `src/data/pricing.ts`.
2. Set `basis.source` to `'clearview'`.
3. Set `basis.reviewedAt` to today.

The estimator copy changes automatically — it stops saying "published Washington
averages" and starts presenting them as ours. An opening type left at `0` is
hidden from the tool rather than counted as free.

### The pricing worker

`workers/pricing/` is a Cloudflare Worker that keeps the numbers honest. It
deliberately does **not** try to discover market prices — there is no
authoritative feed for Clark County window pricing, and anything scraping cost
guides or asking a model to guess would drift silently while looking
authoritative. What it does:

| Route | Purpose |
| --- | --- |
| `GET /` | Serve the current pricing document (refuses if it fails validation) |
| `GET /health` | Validation state, age, and whether a review is overdue |
| `PUT /` | Replace pricing — bearer token, validated before it is stored |
| cron (monthly) | Re-validate and email Mark when it is stale or broken |

The site ships its own copy of the numbers and only *upgrades* from the worker,
so an outage there can never blank out the estimator.

**Deployed.** Live at `https://clearview-pricing.skdev-371.workers.dev`, bound to
the `clearview-pricing` KV namespace, with the monthly cron registered.

Two things are still unset, both on purpose — they are secrets and belong in the
dashboard rather than a transcript (*Workers → clearview-pricing → Settings →
Variables → Add secret*):

| Secret | Effect while unset |
| --- | --- |
| `RESEND_API_KEY` | Cron runs but skips the reminder email |
| `ADMIN_TOKEN` | `PUT /` returns 401, so pricing can only change via the repo |

Everything else works without them.

### Which variable goes where

Easy to get backwards, because the same key lives in two projects for two
different reasons:

| Variable | Project | Read at | Effect |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | **Worker** | runtime | Cron sends the reminder email |
| `RESEND_API_KEY` | **Pages** | runtime | Estimate form delivers leads |
| `PUBLIC_PRICING_ENDPOINT` | **Pages** | **build** | Site upgrades pricing from the worker |
| `ADMIN_TOKEN` | **Worker** | runtime | `PUT /` accepts new pricing |

`PUBLIC_PRICING_ENDPOINT` is the one that trips people up: Astro inlines it at
build time, so setting it does nothing until the site is rebuilt. Push a commit
or hit *Retry deployment* in Pages. The runtime ones take effect immediately.

Setting `PUBLIC_PRICING_ENDPOINT` on the Worker instead of on Pages has no
effect — the worker never reads it.

Redeploy after a code change:

```bash
cd workers/pricing && npx wrangler deploy
```

Push new pricing without a redeploy:

```bash
curl -X PUT https://clearview-pricing.<subdomain>.workers.dev \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  --data @pricing.json
```

Validation (`shared/pricing-schema.mjs`, shared by the site and the worker)
rejects inverted ranges, spreads wider than 5×, missing baselines, multipliers
outside 0.5–3×, and future review dates.

**Which copy wins.** The site renders its bundled numbers immediately, then
upgrades from the worker only if the stored document's `basis.reviewedAt` is at
least as recent as its own. So committing fresher numbers to the repo beats a
stale copy sitting in KV, and a worker outage, a malformed response, or an empty
KV can never blank out the estimator. An empty KV is a normal state meaning
"the repo is the source of truth".

`.github/workflows/pricing-health.yml` runs the same check monthly from GitHub
Actions and fails the job when pricing is invalid or overdue. It needs no
secrets, so it works even before `RESEND_API_KEY` is set — and a failure shows up
in the repo rather than only in an inbox. Delete it if the worker's own email
turns out to be enough.

## The estimate form

`POST /api/estimate` → Resend, using two published templates:

- Lead to Mark — [estimate-request](https://resend.com/templates/f8b73ea1-867e-48b8-8ccf-926b1a825913)
- Receipt to the customer — [estimate-received](https://resend.com/templates/68555c62-cbc3-4061-8dfe-ea1b02a59c75)

Both are full HTML emails, not plain text: a "Call now" `tel:` button and a
"Reply by email" `mailto:` button on each, sized for one-tap use on a phone.
The lead email to Mark also carries a `.vcf` vCard attachment built from the
submitted name, phone, and email, so he can save the customer to his contacts
in one tap instead of retyping it. Edit the templates in the Resend dashboard
(the IDs above) — the Pages Function only fills in the variables.

Environment variables it reads:

| Variable | Required | Default |
| --- | --- | --- |
| `RESEND_API_KEY` | yes | — |
| `NOTIFY_EMAIL` | no | `owner@windowsbyclearveiw.com` |
| `RESEND_FROM` | no | `Clearview Windows <estimates@windowsbyclearview.com>` |

With JavaScript the page swaps in a confirmation panel. Without it, the function
redirects to `/estimate/sent` or `/estimate/problem`, so the form still works.

## Ask, the design-consultant chatbot

`/ask` is a public agentic assistant — a visitor can plan a real project with
it: ask general window/construction questions, get a real price range for a
described job, and get pointed to `/estimate` when it's time to make it firm.
It runs an actual tool-calling loop (up to 3 LLM calls per turn) against
**Groq** (`openai/gpt-oss-120b`, OpenAI-compatible tool calling) as the fast
path, falling back to **Gemini** (`gemini-3.6-flash`, native function
calling) if Groq is unavailable — same two tools, same guardrails, either
way. Model names in this space drift fast; if either starts 404ing, check
`GET /ask/api/models` (lists what's actually live from each provider, using
the real keys server-side) before guessing a new one.

**Its knowledge has three tiers, and the system prompt is explicit about
never mixing them:**

1. **Reference material** — `/guides` content (embedded and retrieved by
   cosine similarity, see below) plus a short list of basic business facts
   (phone, service area, hours). The only source for anything about
   Clearview itself.
2. **The `estimate_price` tool** (`functions/ask/_lib/pricing.mjs`) — the
   only source for a number. Runs Clearview's own published pricing model,
   the exact same figures and formula as
   `/tools/window-replacement-cost-calculator` (duplicated by hand, kept in
   sync manually — see the file's own comment). The model is instructed to
   call this for any price question rather than ever stating a number from
   memory, and to present the result as a range and a starting point, never
   a final total.
3. **General knowledge**, plus the `search_web` tool
   (`functions/ask/_lib/search.mjs`, DuckDuckGo's HTML results page — there
   is no official free search API, this is how every free DDG integration
   works) for anything current like rebate programs or code changes. Scoped
   hard to windows/doors/home construction/home improvement, and to
   describing the *industry*, never Clearview's own claims or policies.

Hard rules that hold regardless of tier: never "bonded and insured" (RCW
18.27.100), never a specific L&I number, never a competitor, never legal
advice, never a firm final price outside the tool.

**Photo analysis.** A visitor can attach a photo of a window on `/ask`.
It's resized client-side (max 1024px, JPEG) and sent as a base64 field
alongside the message — no multipart upload, no new content-type on the
endpoint. `functions/ask/_lib/vision.mjs` runs it through Workers AI
(`@cf/meta/llama-3.2-11b-vision-instruct`, the `AI` binding) for a factual
description only — frame material, style, visible fog or damage — *before*
the main chat call, the same eager-not-tool-gated shape retrieval already
uses below. The description is folded into that turn's reference material,
labelled as machine-generated observations, and the system prompt has an
explicit guardrail: describe in general terms, never state it as certain,
never treat it as a measurement, never call `estimate_price` from a guessed
opening count. **The photo itself is never stored anywhere** — analyzed and
discarded, matching the lead form's "no lists, no resale" stance; if Mark
ever wants to review photos afterward, that's an R2 bucket added later, not
today. Binding missing or the daily Neuron quota exhausted both degrade the
same way as a Gemini outage: the chat turn still completes, just without
visual context, rather than failing.

**Retrieval is build-time, not live.** `scripts/build-guides-index.mjs` reads
every published guide, splits it into one chunk per `##` section, embeds each
chunk with Gemini's `gemini-embedding-001`, and writes
`functions/ask/_data/guides-index.json` — committed to the repo, not
generated on deploy. That is deliberate: retrieval quality shouldn't depend
on Gemini being reachable at build time, and guide content changes rarely
enough that regenerating by hand is no burden. Run it after editing a guide:

```bash
GEMINI_API_KEY=... node scripts/build-guides-index.mjs
```

Get a free key at <https://aistudio.google.com/apikey>. `GROQ_API_KEY` is
free at <https://console.groq.com>. Set both in Cloudflare Pages → Settings
→ Environment variables — `GEMINI_API_KEY` alone is enough for the feature to
work (it's its own fallback and what retrieval depends on); `GROQ_API_KEY` is
what makes the common case fast. No key set at all → the page still loads,
answering with a message pointing to the phone number instead of crashing.

**Visibility.** Every question/answer/model-used/tools-used/sources is
logged (best-effort, never blocking the chat turn) to an `ask_logs` table —
see `functions/ask/_data/schema.sql`, applied to the same D1 database as the
internal quoting tool (`QUOTES_DB`) rather than provisioning a second
database for one small table. View it at `/internal/ask-logs`, gated behind
the same login as the quoting tool.

**Regression testing.** `node scripts/eval-ask.mjs [baseUrl]` runs six checks
against a live `/ask/api/chat` (sources present, safety-rail probes, pricing
gives a range not a firm number, general knowledge answered directly rather
than refused, off-topic redirects). Two real bugs found while building this
— a truncated-answer issue and a stale-model-name issue — would have been
caught by this automatically instead of by manual testing. Run it after any
change to the system prompt, tools, or model names, against both local dev
and production.

There is no rate limiting on `/ask/api/chat` beyond message-length and
history caps; the worst case of abuse is hitting a provider's free-tier
limits, at which point the fallback chain (and, ultimately, the graceful
"unavailable" message) takes over. Revisit if that turns out to matter.

## Performance: keep `astro:page-load` handlers cheap

The site uses Astro View Transitions (`<ClientRouter />`), so an in-site link
click does a client-side DOM swap rather than a full navigation. Everything
wired to the `astro:page-load` event in `BaseLayout.astro` — the GTM
`dataLayer` pushes, the scroll-reveal `IntersectionObserver` setup — reruns on
*every* navigation, including the very first page load, so it sits directly in
front of the LCP element.

Two real regressions came from this, both measured with the browser's
Performance API rather than assumed:

- **Synchronous analytics pushes.** `trackPageView()` and `trackVisitJourney()`
  used to push to `window.dataLayer` synchronously inside the `astro:page-load`
  handler. GTM evaluates every tag/trigger synchronously on each push, which
  measured as ~465ms of blocked main thread on a single in-site click. Fixed by
  deferring both through `requestIdleCallback` (with a `setTimeout` fallback),
  so tracking still fires every navigation, just after the page has painted.
- **Interleaved layout reads/writes.** `initReveal()`'s "reveal anything
  already in view" pass used to loop over each `[data-reveal]` element doing
  `el.getBoundingClientRect()` (read) immediately followed by
  `el.classList.add('is-revealed')` (write) in the same iteration. Since that
  class change affects the reveal animation's transform/opacity, each write
  invalidated layout, forcing the next read to synchronously recompute it — a
  forced-reflow thrash that a live DevTools trace measured at ~540ms of Layout
  work, over half of the homepage's LCP. Fixed by splitting it into two
  passes: read every element's position first, then apply all the class
  changes after.

The lesson generalizes: anything hung on `astro:page-load` runs on the
critical path of every navigation, not just once. Batch DOM reads and writes
separately, and push non-essential work (analytics, logging) off the main
thread with `requestIdleCallback` rather than firing it inline.

## Notes

The legal / domain spelling **Clearview** is used throughout. Public copy can still
say "Clearview" if you decide that is the brand.

## Images: why WebP, and why not Cloudflare Transformations

Cloudflare Image Transformations is enabled on the zone. It is deliberately
not used, and AVIF is deliberately not generated. Both were measured rather
than assumed, on this site's own photos:

| | Result |
| --- | --- |
| Worst-case page image weight | `/gallery`, 26 photos, **182 KB** after a full scroll at 1280px |
| Homepage image weight | **101 KB** |
| AVIF q50 vs WebP q72 | 36% smaller — **but measurably lower quality** (higher RMSE against the lossless original on all four photos tested) |
| AVIF q60 vs WebP q72 | quality-matched, and only **10% smaller** (161 KB across all 26 photos at every width) |
| AVIF encode cost | **1866 ms/image** vs 55 ms for WebP — roughly 34x, which would take the build from ~4 s to several minutes |

So AVIF buys about 5 KB per page at equivalent quality, for a build that is
orders of magnitude slower. Transformations would mainly buy the same AVIF via
`format=auto`, while moving images off immutable fingerprinted `/_astro/` URLs
onto edge-transformed ones and introducing a 5,000/month quota where there is
currently none.

Leaving Transformations enabled costs nothing while unused, so it stays on for
any future need. It just is not wired into this site.

**The real ceiling is the source photos.** Every one is 450x600 from a phone.
Tiles are sized never to exceed that (measured: 450px at a 1440px viewport,
397px at 1280px), but a retina display still wants 900px and there is no such
file. No format or CDN fixes that — only a reshoot does.
