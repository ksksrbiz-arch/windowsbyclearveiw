# SEO log

Newest first. One entry per change that could move search results, with the numbers
that motivated it so the follow-up check has a baseline.

## 2026-09-29 — Striking-distance titles and descriptions (area pages)

**Why.** Search Console (28 days, Aug 29 to Sep 26, 2026) shows the area pages ranking
around position 22-24 with almost no clicks, and slash/no-slash duplicates splitting signals.
Titles and meta descriptions are the cheapest lever for page-one clicks.

**Baseline (clicks / impressions / avg position, top 10 rows only):**

| URL | Clicks | Impr. | Pos |
|---|---|---|---|
| / | 10 | 81 | 28.2 |
| /gallery | 1 | 11 | 23.3 |
| /about | 0 | 46 | 22.8 |
| /about/ (duplicate) | 0 | 17 | 14.5 |
| /areas | 0 | 44 | 24.2 |
| /areas/ (duplicate) | 0 | 6 | 51.5 |
| /areas/battle-ground | 0 | 28 | 21.9 |
| /areas/battle-ground/ (duplicate) | 0 | 7 | 41.9 |
| /areas/brush-prairie | 0 | 83 | 23.2 |
| /areas/brush-prairie/ (duplicate) | 0 | 2 | 48.5 |

**Changed.**
- Titles and descriptions rewritten for the 8 area pages, `/areas`, `/about`, `/gallery`
  (targets: title 50-60 chars, description 130-155, "free in-home measure" + "written estimate").
- Area titles follow `Window Replacement in {City}, WA | Clearview Windows`. Vancouver is
  `Vancouver, WA Window Replacement | Clearview Windows` because the home page already uses the
  first form and two pages should not compete for it.
- New guard `npm run test:seo` (run after `npm run build`, in CI): missing/duplicate/over-length
  titles and descriptions, canonical != own URL, sitemap not canonical, redirect loops.

**Duplicate URLs: no change needed.** `trailingSlash: 'never'` + `build.format: 'file'`; canonical,
`og:url`, sitemap and internal links are already slash-free. Cloudflare Pages already answers
`/about/` with `308 -> /about` (checked with `curl -sI`); a 308 is a permanent redirect and
Google treats it like a 301. No redirect rules were added for that (they could only add loops).
The slash duplicates in Search Console are most likely old discovery; watch them fall off.

**Portland.** Not served. `/areas/portland` already 301s to `/areas`; added the slash form
`/areas/portland/` so it is one hop.

**Follow-ups.** `/guides/vinyl-vs-fiberglass-pacific-northwest` and `/new-construction` titles
are over 60 chars; `/sliding-glass-doors` and `/window-features` descriptions are over 155
(listed in `KNOWN_OVER` in the test).

**Re-check** at 14 and 28 days: clicks, impressions, CTR, position for each URL above.
Titles influence clicks more than rankings; no result is guaranteed.
