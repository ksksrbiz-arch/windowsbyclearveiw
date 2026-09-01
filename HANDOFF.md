# Project context — Clearview Windows

Paste this into a new Claude session to pick up where the last one left off.
Technical detail lives in [README.md](./README.md); this file is the *why*.

---

## What this is

A marketing site for **Clearview Windows** — my friend Mark's window
installation company in Vancouver, WA. He does replacement work for homeowners
and new-construction installs for builders, across Clark County and across the
river into Portland.

- **Live:** https://windowsbyclearview.com
- **Repo:** `ksksrbiz-arch/windowsbyclearveiw` (public), deploys from `main`
- **Stack:** Astro, static, no adapter. Cloudflare Pages. Estimate form is a
  Pages Function. Resend for mail.
- **Pricing worker:** https://clearview-pricing.skdev-371.workers.dev
- **Legal entity:** Clear View Windows & Trim LLC (WA UBI 605 779 798),
  doing business as "Clearview Windows". `site.legalName` in
  `src/data/site.ts` holds the legal name; `site.name`/`site.shortName` hold
  the trade name.
- **Note the spelling:** the trade name and current domain are
  "Clear**veiw**", not "Clearview" — a holdover from before the legal name
  was settled. Mark is purchasing windowsbyclearview.com and the site will
  migrate there, at which point the "veiw" spelling gets fixed sitewide too.
  Until that migration happens, do not "fix" the spelling piecemeal.

## Where it stands

Working and deployed:

- Full site: home, replacement, new construction, process, gallery, guides,
  8 service-area pages, reviews, estimate, 404
- 26 of Mark's real job photos through `astro:assets` (WebP + srcset)
- Estimate form → Resend, with a no-JS fallback and a homeowner/builder split
- Free cost estimator at `/tools/window-replacement-cost-calculator`
- Pricing worker with KV, validation, monthly cron, and a GitHub Actions
  health check

## Rules that must not be broken

These came out of real problems and are easy to undo by accident.

1. **No invented reviews.** `/reviews` is deliberately empty. It previously
   shipped three fabricated testimonials attributed to named people in a city
   Mark does not serve. Reviews default to `published: false`. Only real quotes
   from real customers who agreed, ever.

2. **No invented credentials.** `site.lniNumber` is empty and the footer says
   the number is pending. Washington requires a contractor registration number
   in advertising (RCW 18.27.100) and separately **prohibits** advertising that
   a contractor is "bonded and insured" — that phrase was removed and must stay
   out.

3. **Pricing must say whose numbers it is.** The estimator currently shows
   published 2026 Washington / Portland-metro averages, labelled as exactly
   that on the page, with a review date. When Mark supplies his own ranges, set
   `basis.source` to `'clearview'` and the copy switches itself. Never present
   somebody else's averages as ours.

4. **The pricing worker does not discover prices.** There is no authoritative
   feed for Clark County window pricing. It validates, serves, and nags — it
   does not scrape cost guides or ask a model to guess.

5. **Honest copy generally.** Plain language, name the weather, admit when
   condensation is just a humid bathroom. No "unparalleled solutions". The
   federal 25C tax credit ended for installs after 2025-12-31 — do not sell it.

## Outstanding

| | |
| --- | --- |
| **L&I registration number** | The last real blocker on this being legitimate advertising in WA. Set `lniNumber` in `src/data/site.ts`. |
| **Mark's real pricing** | Replaces the regional averages. Format and basis are documented under "Pricing" in the README. |
| **Estimate form end-to-end test** | `RESEND_API_KEY` is set on Pages now, but no real lead has been confirmed delivered. A valid submission emails Mark for real. |
| **Hero video** | Drop a 15–25s clip at `public/video/hero.mp4` and the homepage hero switches from photo to video automatically. |
| **`ADMIN_TOKEN`** | Unset, so the worker's `PUT /` is closed and pricing changes go through the repo. Optional. |
| **Google Business Profile** | Not set up. For a local installer this matters as much as the site. |

## How I like to work

- Verify rather than assert — build it, run it, screenshot it, then say it works.
- Say plainly when something cannot be done honestly, then build the nearest
  thing that can.
- Flag your own bugs when you find them rather than quietly patching.
- Push to `main`. Cloudflare Pages deploys automatically.
