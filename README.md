# Clearveiw Windows

Marketing site for **Clearveiw Windows, LLC** — replacement and new-construction
window installation in Vancouver, WA and the rest of Clark County.

- Domain: [windowsbyclearveiw.com](https://windowsbyclearveiw.com)
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
5. Attach `windowsbyclearveiw.com` after the first deploy.

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
2. Set `basis.source` to `'clearveiw'`.
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

**Deployed.** Live at `https://clearveiw-pricing.skdev-371.workers.dev`, bound to
the `clearveiw-pricing` KV namespace, with the monthly cron registered.

Two things are still unset, both on purpose — they are secrets and belong in the
dashboard rather than a transcript (*Workers → clearveiw-pricing → Settings →
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
curl -X PUT https://clearveiw-pricing.<subdomain>.workers.dev \
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

Environment variables it reads:

| Variable | Required | Default |
| --- | --- | --- |
| `RESEND_API_KEY` | yes | — |
| `NOTIFY_EMAIL` | no | `owner@windowsbyclearveiw.com` |
| `RESEND_FROM` | no | `Clearveiw Windows <estimates@windowsbyclearveiw.com>` |

With JavaScript the page swaps in a confirmation panel. Without it, the function
redirects to `/estimate/sent` or `/estimate/problem`, so the form still works.

## Notes

The legal / domain spelling **Clearveiw** is used throughout. Public copy can still
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
