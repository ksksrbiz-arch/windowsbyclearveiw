# Command Center PWA — contract

Reference for the installable, offline-tolerant Command Center (`/internal`). Code: `public/internal-sw.js`,
`public/internal.webmanifest`, `public/internal-offline.html`, `src/scripts/internal-pwa.ts`,
`src/layouts/InternalLayout.astro`, the "Phone app" card in `src/pages/internal/tools/index.astro`.
Guard: `npm run test:internal-pwa` (sandboxed worker + build checks). Not a business record; D1 stays the truth.

## Decisions that are easy to break

| Decision | Why |
|---|---|
| Manifest, worker and offline page are **public files outside `/internal/`** | `functions/internal/_middleware.js` 302s every unauthenticated `/internal/*` request to the login page; a manifest or worker request that redirects fails. None of them holds customer data. |
| Scope is **`/internal`, no trailing slash** | Cloudflare Pages 308-redirects `/internal/` to `/internal` (the Dashboard is `internal.html`). A scope ending in `/` would leave the Dashboard outside the app. Verified with `wrangler pages dev`. |
| Saved pages are rebuilt as a plain 200 (`plainCopy`) | Pages 308s `/x.html` to `/x`; Chrome refuses a *redirected* response for a navigation (`ERR_FAILED`). Found in the 2026-10-03 browser test. |
| Redirects and `/internal/login` are never saved | A saved login bounce would "log in" offline to a dead form. |
| **No offline write queue. Ever, without a new decision.** | Approvals, price, quote state, payments and checklist gates are state boundaries (CLAUDE.md rules 3, 4, 6). A write goes to the network and fails visibly. Photos are the one local-first path and predate this (`photo-sync.ts`). |
| Data is an **allowlist** of GET routes | PII lives in these responses. Adding a route means deciding what leaks if the phone is lost. `quote-share` (signing tokens), quotes, invoices, payments, leads, analytics, copilot, ask-logs, photos are deliberately not saved. The test pins the list. |

## What is saved, and for how long

| Kind | Rule | Lifetime |
|---|---|---|
| Pages (`/internal*` HTML) | Network first, saved copy on failure or after 5 s. Key = path only (no query, no trailing slash). Static Astro output: no customer data in the HTML. | Until replaced or cleared |
| Assets (`/_astro`, `/fonts`, `/logo`, icons) | Cache first. Two stores: **pinned** (exactly what the warmed pages need; swept to that set after every clean warm-up, never capped, so newer deploys cannot evict a file a saved page still uses) and **runtime** (anything else seen; capped at 250, oldest dropped) | Pinned: until the next clean warm-up replaces it. Runtime: until evicted |
| Data (`dashboard`, `tasks`, `jobs`, `job-checklist`, `job-evidence`; GET only) | Network first, saved copy on failure or after 5 s, marked `x-cv-from-cache`; capped at 80 entries | **3 days**, then deleted on read |
| Unsaved page while offline | `/internal-offline.html` (precached at install) | — |
| Unsaved data while offline | `503 {"error": "...offline...", "offline": true}` so existing pages show a readable message | — |
| A write (POST/PATCH/PUT/DELETE) to the same endpoints with no connection | Sent once, never saved or replayed. If the connection is dead the page gets `503 {"error": "No connection, so this could not be confirmed as saved. Nothing was queued…"}` instead of "Failed to fetch". A real server answer is passed through untouched. Other write endpoints (quotes, invoices, payments, photos, login/logout) are not touched at all | — |

Warm-up (`cv:warm`): after sign-in (and on reconnect; decided by `shouldWarm` in `src/lib/pwa-logic.ts`: never offline, at most every 6 h after a clean run, and not again for 10 min after any attempt, so a failing run does not repeat on every page load; overlapping requests share one run in the worker) the worker fetches the pages in `WARM_PAGES`
plus every `/_astro` asset they reference (JS imports and CSS `url()`s, three levels deep). It also saves the list data
in `WARM_DATA` and, for up to 8 active (not completed/cancelled) jobs on the dashboard, the three reads Field mode makes
(`jobs?id=`, `job-checklist?jobId=`, `job-evidence?jobId=`), so tomorrow's job opens offline without having been opened
first. Every page must exist in the build (tested). Signed out → it stops and saves nothing.

## Session and privacy

- Logout and the login page send `cv:clear`: all saved **data** is deleted. A data response that is a login redirect,
  or any 401/403/404, deletes that saved copy and the page shows "Your session ended" with a Sign in link.
- Tools → Phone app → **Clear saved data** (`cv:clear`, scope `all`) also drops pages and assets. Job photos are
  never touched by the worker (they are in IndexedDB, `field-photo-db.ts`).
- Saved data sits in browser Cache Storage on the phone, unencrypted, like the photos already do. A lost phone is
  covered by the phone's lock, the 30-day session cookie, and Cloudflare Access if enabled (`access.mjs`).
- **Production is behind Cloudflare Access** (checked 2026-10-03: `/internal/*` 302s to `<team>.cloudflareaccess.com`). A
  fetch that follows that redirect fails CORS and looks exactly like being offline, so data and write fetches use
  `redirect: 'manual'`: any redirect means the session ended. The worker then answers `401 {"code": "SESSION_ENDED"}`
  (pages show the message), wipes **all** saved data (`endSession`), and the banner offers Sign in. Real offline is still a
  network error and still serves saved copies. Navigations pass the redirect through, so the browser lands on the Access
  sign-in. Access session length (owner chose 1 month in `internal/README.md`) therefore sets how long the app works unattended.
- **Open, needs a real iPhone:** in an installed iOS home-screen app the Access sign-in is a different origin, which iOS may
  open outside the app's cookie jar; if sign-in loops, that is why. Android Chrome PWAs handle it normally.
- `/internal-sw.js` is served by Cloudflare with `max-age=14400` even though `_headers` says `no-cache` (the manifest's header
  applied; the cause is likely the zone's Browser Cache TTL). Harmless for updates: registration uses `updateViaCache: 'none'`,
  which makes update checks skip the HTTP cache. Optional owner fix: Caching → Browser Cache TTL → Respect Existing Headers.

## UI behaviour

- Banner (`[data-pwa-banner]`, wording in `bannerFor`): offline ("Offline. Saved copies…"), saved copy served
  ("The connection is weak", with a Reload link: pages do not refetch by themselves, and a reload could lose an
  unsaved Field-mode entry, so it is the user's call), session ended (Sign in link; outranks the others). `navigator.onLine` can be true on a dead connection, hence two wordings.
- Standalone only: a Back button in the header (`[data-pwa-back]`), and `navigator.storage.persist()` so the browser
  does not evict job photos under storage pressure.
- Install: Android/desktop capture `beforeinstallprompt` (Tools card button). iOS has no prompt: the card shows
  Share → Add to Home Screen. **The iOS home-screen app has its own storage and cookies**: it asks for the password
  once and cannot see photos taken in Safari. The card shows how many photos Safari holds.
- Manifest: `short_name` "Clearview Ops" (home-screen label), start `/internal/today`, shortcuts Today, Follow-up,
  Jobs, Job photos. Names are owner-changeable; keep `short_name` <= 14 characters (tested).

## Changing the worker

1. Bump `VERSION` when caching behaviour changes (old `cv-*` caches are deleted on activate).
2. Keep writes out of it (tested), keep `DATA_ROUTES` an allowlist, keep pages free of customer data.
3. Browser check that the unit test cannot do: `wrangler pages dev dist` behind a proxy that drops connections,
   Chromium via Playwright: sign in, wait for warm-up, drop the connection, reload Today / Jobs / Field mode / Tools
   / an unsaved page, expire the cookie, log out. (Done 2026-10-03; steps in `.ai/CHANGELOG.md`.)

## Not built, on purpose (Cathedral order: Foundation first)

Offline write queue / Background Sync, push notifications (lead alerts already use ntfy), offline quotes or
invoices, saving quotes/payments/leads data, automatic photo upload changes, a React/Workbox build step.
Each needs its own decision; the first needs an answer to "what if the queued approval is stale when it replays".
