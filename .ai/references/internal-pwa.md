# Command Center PWA — contract

Reference for the installable, offline-tolerant Command Center (`/internal`). Code: `public/ops-sw.js`,
`public/ops.webmanifest`, `public/ops-offline.html`, `src/scripts/internal-pwa.ts`,
`src/layouts/InternalLayout.astro`, the "Phone app" card in `src/pages/internal/tools/index.astro`.
Guard: `npm run test:internal-pwa` (sandboxed worker + build checks). Not a business record; D1 stays the truth.

## Decisions that are easy to break

| Decision | Why |
|---|---|
| Manifest, worker and offline page are **public files outside `/internal`, named `ops-*`** (`/ops-sw.js`, `/ops.webmanifest`, `/ops-offline.html`; never `internal-*`) | `functions/internal/_middleware.js` 302s every unauthenticated `/internal/*` request to the login page; a manifest or worker request that redirects fails. None of them holds customer data. **Cloudflare Access gates `/internal*` by prefix** (it began doing so 2026-10-04: `/internalx` and `/internal-sw.js` were redirected to the Access sign-in), so a name starting with `internal` is not safe; tested. After a deploy or an Access change run `npm run check:pwa-live`. |
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
| Unsaved page while offline | `/ops-offline.html` (precached at install) | — |
| Unsaved data while offline | `503 {"error": "...offline...", "offline": true}` so existing pages show a readable message | — |
| A write (POST/PATCH/PUT/DELETE) to the same endpoints with no connection | Sent once, never saved or replayed. If the connection is dead the page gets `503 {"error": "No connection, so this could not be confirmed as saved. Nothing was queued…"}` instead of "Failed to fetch". A real server answer is passed through untouched. Other write endpoints (quotes, invoices, payments, photos, login/logout) are not touched at all | — |

Warm-up (`cv:warm`): after sign-in (and on reconnect; decided by `shouldWarm` in `src/lib/pwa-logic.ts` from state the worker keeps: never offline or while a run is in progress; at most every 6 h after a clean run, **but at once after a new deploy**; not again for 10 min after a failed or interrupted attempt for the same build; overlapping requests share one run) the worker fetches the pages in `WARM_PAGES`
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
- `/ops-sw.js` is served by Cloudflare with `max-age=14400` even though `_headers` says `no-cache` (the manifest's header
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

## How installed copies update (automatic)

Nothing to do on deploy. Mechanism, so it stays that way:

1. **Every deploy changes the worker file.** `astro.config.mjs` derives one build id (`<commit time ms>-<short commit>`, from git:
   Astro evaluates the config more than once per build, so a clock would give the pages and the worker different ids) and
   stamps it into `dist/ops-sw.js` (`BUILD_ID`, placeholder in `public/`) and every internal page (`<meta name="cv-build">`).
   The build fails if the placeholder is missing. Without git history the id falls back to a zero time plus the Pages commit
   hash: the worker still changes per deploy, but pages are never judged out of date.
2. **The browser installs the new worker itself** (`updateViaCache: 'none'`, `skipWaiting`, `clients.claim`), and the app also
   asks (`registration.update()`) when it comes to the front, when the connection returns, and every 30 min while visible
   (throttled to 5 min). The worker announces `cv:activated` with its build.
3. **Pages are always current anyway**: network first, so each navigation gets the new HTML and hashed assets.
4. **A page older than its worker** (`pageIsStale`: worker build newer; dev/unparseable ids never count) is handled by
   `updateAction`: reload now if the page is visible and has no unsaved input; reload when the app is next opened if it is in
   the background; otherwise show the "new version" banner with Reload. Never while offline (a reload would serve the saved copy
   again), never over unsaved input (`hasUnsavedInput` errs toward dirty), at most one automatic reload per 10 min (no loops).
5. **Saved pages and assets refresh at once** on a new build (the worker's warm state records the build of the last clean run).
6. Tools → Phone app shows the running version and has **Check for updates**.

What cannot be automatic: on **iOS** the home-screen name and icon come from the manifest at install time (re-add the app to change
them); Android refreshes them on its own schedule. Bump `VERSION` (not just the build) when the cache layout changes.

## Diagnostics and photo-backup status (Tools > Phone app)

- Photo backup row: `GET /internal/api/job-photos?status=1` (`configured`, `backedUp`) plus what the phone holds (`countPhotoBackupState`).
  Photos are the only data that exists solely on the device until R2 is connected, so the row says so in words (`photoBackupLine`).
- Worker log (`logEvent`/`readLog`, `cv-meta-v1`): 25 entries max; kinds `activated`, `warm-ok|warm-failed|warm-signed-out`,
  `session-ended`, `write-offline`, `saved-copy`; detail is a path without its query string. Never put customer data, ids or
  request bodies in it. Cleared with "Clear saved data".
- **Copy diagnostics** (`diagnosticsText`) is how to read the state of a real phone: builds, switches, counts, warm state, photo
  line, log. Ask for it before guessing at device-specific problems (iOS standalone, the Access sign-in inside the app).

## Migration from the old file names

Installed copies registered `/internal-sw.js`. The page script now registers `/ops-sw.js` at the same scope, which updates the existing
registration to the new script (same caches, `v1`); the old URL is never needed again (and Access was redirecting it anyway). Verified
in Chromium: a registration made by the old build switched to the new worker, kept its saved pages, and kept controlling the page.

## Changing the worker

1. Bump `VERSION` when caching behaviour changes (old `cv-*` caches are deleted on activate).
2. Keep writes out of it (tested), keep `DATA_ROUTES` an allowlist, keep pages free of customer data.
3. Browser check that the unit test cannot do: `wrangler pages dev dist` behind a proxy that drops connections,
   Chromium via Playwright: sign in, wait for warm-up, drop the connection, reload Today / Jobs / Field mode / Tools
   / an unsaved page, expire the cookie, log out. (Done 2026-10-03; steps in `.ai/CHANGELOG.md`.)

## Phone audit harness (manual)

Browser checks the unit tests cannot do. `npm run build`, then `wrangler pages dev dist` from a scratch folder holding a minimal
`wrangler.toml` (D1 only; the repo one declares a remote AI binding that needs a Cloudflare login), `--binding INTERNAL_PASSWORD=...
INTERNAL_SESSION_SECRET=...`, with `internal/db/schema.sql` and `functions/api/_data/schema.sql` applied to the local D1. Seed a
quote → plan → approve → sign → job through the API. For offline runs put a tiny proxy in front that destroys connections on demand
(Playwright's `setOffline` does not stop service-worker requests) and another toggle that 302s `/internal/*` to a second origin to
imitate Cloudflare Access. Then drive Chromium (touch, 390 and 360 wide): overflow, console/network errors, control sizes (>= 16 px,
>= 36 px), labels, keyboard types. Results and the fixes they led to: `.ai/CHANGELOG.md` (2026-10-03 entries).

Re-run 2026-10-08 (audit, no worker change): the proxy was a 25-line Node server on a second port with two switches (`drop` destroys every
connection; `access` answers `/internal*` with a 302 to another origin, leaving `/ops-*` public), Chromium with `serviceWorkers: 'allow'`,
and checks through `postMessage({type:'cv:status'})` plus `caches.open('cv-data-v1').keys()`. Wait for `warm.running === false` before
counting saved data (the first status call lands mid-run). Pass criteria are the rows of the tables above; the run is in `.ai/CHANGELOG.md`.

## Not built, on purpose (Cathedral order: Foundation first)

Offline write queue / Background Sync, push notifications (lead alerts already use ntfy), offline quotes or
invoices, saving quotes/payments/leads data, automatic photo upload changes, a React/Workbox build step.
Each needs its own decision; the first needs an answer to "what if the queued approval is stale when it replays".
