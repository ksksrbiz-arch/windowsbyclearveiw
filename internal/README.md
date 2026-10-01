# Mark's internal quoting tool

`/internal/*` is a gated set of pages, behind `wrangler.toml`'s local dev
config here and separately configured in the Cloudflare Pages dashboard for
production. It is not part of the marketing site: it's excluded from the
sitemap and `robots.txt`, and every page carries `noindex, nofollow`.

The internal area now opens on a **Command Center** at `/internal/`: a compact,
field-friendly snapshot of recent leads, draft/finalized quote counts and value,
lead source/location summaries, and quick links into the existing screens. The
dashboard uses `/internal/api/dashboard`, a small read-only API that aggregates
D1 data server-side instead of downloading the full leads and quotes lists.

What the internal tool does: Mark logs in with one shared password, builds a
firm-price quote starting from `src/data/pricing.ts` (fully editable per line),
and gets it signed — either on-screen with a finger/mouse signature pad, or
printed and signed by hand (he confirms it back in the tool once it's actually
signed). The signed quote doubles as the contract, with the terms from
`src/data/contractTerms.ts`. A quote stays a fully editable draft — customer
info, line items, discount, everything — right up until it's signed.

## Before this works in production

Cloudflare Pages → this project → **Settings → Bindings** (not Environment
variables — D1 needs a real binding, and this stays separate from
`RESEND_API_KEY`'s Environment variables entry):

| Binding | Type | Value |
| --- | --- | --- |
| `QUOTES_DB` | D1 database | `clearview-quotes` (`4700b6f7-c3d8-46c9-9b19-17cf34accb84`) |
| `INTERNAL_PASSWORD` | Secret | The one password Mark keeps on his phone |
| `JOB_PHOTOS` | R2 bucket | `clearview-job-photos` (optional until set up; see "Job photo storage" below) |
| `INTERNAL_SESSION_SECRET` | Secret | A long random string — signs the login session cookie. Generate once with `openssl rand -hex 32` and never rotate it casually; rotating it logs everyone out |

Set these for **Production**, and again for **Preview** if you want to test
the tool on preview deploys. The committed `wrangler.toml` in the repo root
is **local-dev only** — it lets `wrangler d1 execute --local` and
`wrangler pages dev` simulate the database on disk. It is never read by the
real Cloudflare Pages build.

## AI Gateway for Groq and Gemini (optional)

Cloudflare AI Gateway sits between this site and Groq/Gemini and adds, in the Cloudflare
dashboard (AI → AI Gateway), request counts, token and cost totals, latency, errors, and
optional spending/rate limits. It is **off until `AI_GATEWAY_URL` is set**; nothing changes before that.

What the code guarantees (`functions/_lib/ai-gateway.mjs`, covered by `npm run test:embeddings`):

- **Customer text is not stored by the gateway.** Every call sends `cf-aig-collect-log-payload: false`,
  so only metadata (tokens, cost, status, duration, which feature) is logged. This matches the
  Ask log, which deliberately keeps no question text. Do not turn payload logging on at the
  gateway level without a decision to change that.
- **The gateway can never take Ask down.** If it is unreachable, misconfigured (401/403/404) or
  down (502/503/504) the same request goes straight to the provider.
- **No answer caching.** Ask answers depend on the conversation, photos and live pricing.
- **Provider keys travel in headers**, never in a URL (so they cannot land in a URL log).
- Covers Ask chat plus the internal lead analyzer, copilot and copilot summary (tagged by
  feature in the gateway log). Groq and Gemini fallback between providers is the app's own and is unchanged.

One-time setup (owner, free):

1. Cloudflare dashboard → AI → AI Gateway → **Create gateway** (name it `clearview`). Leave
   caching off. Leave "Authenticated gateway" off unless you also set `AI_GATEWAY_TOKEN`.
2. Copy the gateway's base URL, which looks like
   `https://gateway.ai.cloudflare.com/v1/<account id>/clearview`.
3. Pages → Settings → Environment variables (Production): `AI_GATEWAY_URL` = that URL. Redeploy.
4. Ask one question on `/ask`, then check the gateway's Logs tab shows a request with status 200
   and no prompt text. (Not tested against the real gateway yet: the Gemini path
   `/google-ai-studio/v1beta/...` follows Cloudflare's docs pattern; if the first Gemini request
   shows an error in the gateway, Ask still answers through the direct fallback.)

## Cloudflare Access sign-in (optional; replaces the shared password)

Today the Command Center has one shared password. Cloudflare Access (Zero Trust, free for small
teams; confirm the current limit on the plan page) puts a real login in front of `/internal`:
each person signs in with their own email (one-time code or Google), it can require MFA, every
sign-in is logged, and removing a person cuts them off at once.

The code side is built and **off until configured** (`functions/internal/_lib/access.mjs`). When
on, a request that carries a valid, correctly signed Access token counts as signed in. The
shared password keeps working alongside it, so turning this on cannot lock anyone out.

Owner steps (Cloudflare dashboard → Zero Trust; it asks you to pick a team name the first time):

1. Access → Applications → **Add → Self-hosted**. Domain `windowsbyclearview.com`, path
   **`internal`** (covers everything under `/internal`). Do **not** protect the whole site:
   customers must still reach `/sign`, `/api/estimate` and the public pages.
2. Policy: **Allow**, include the emails of the people who should get in (Mark, Keith). Login
   method: one-time PIN is enough. Set **session duration to 1 month** so Mark's phone is not
   asked to sign in again every day (photo uploads queue on the phone and retry if a session lapses).
3. Open the application and copy its **Application Audience (AUD) tag**.
4. Pages → Settings → Environment variables (Production): `ACCESS_TEAM_DOMAIN` = your team name
   (the part before `.cloudflareaccess.com`) and `ACCESS_AUD` = the AUD tag. Redeploy.
5. Test on Mark's phone and on a computer: sign in through the Access screen, confirm the
   dashboard, a photo upload and a quote all work.
6. Only after that works for everyone: set `ACCESS_REQUIRED` = `1` and redeploy. The shared
   password is then refused everywhere, including on the `*.pages.dev` address (which Access
   does not cover), and `INTERNAL_PASSWORD` can be deleted later. Setting `ACCESS_REQUIRED`
   without the team and AUD values is ignored, so it cannot lock anyone out by itself.

## Nightly backup and morning nudge (companion Worker)

Pages Functions cannot run on a schedule, so scheduled work lives in a small separate Worker,
`workers/ops-cron/` (`clearview-ops-cron`). It has no public URL and does two things:

- **Nightly D1 backup** (about 3:15 AM Pacific): every table and row is written as one gzip file
  `d1/YYYY-MM-DD.json.gz` to the **private** R2 bucket `clearview-db-backups`; the newest 30 are
  kept. The file is checked after writing, and a failure pushes "Database backup FAILED" to the
  phone (same ntfy channel as new-lead alerts). D1's own Time Travel still exists; this is the
  copy we control.
- **Weekday follow-up nudge** (about 8:30 AM Pacific): one push such as "3 follow-ups to do,
  1 overdue, 2 due today" that opens the follow-up list. Counts only, no names. Silent when
  nothing is due.

The bucket `clearview-db-backups` already exists. One-time deploy (needs a Cloudflare login, so
it is an owner step):

1. `cd workers/ops-cron && npx wrangler deploy` (or Cloudflare dashboard → Workers → Create →
   connect this GitHub repo, root directory `workers/ops-cron`).
2. `npx wrangler secret put LEAD_ALERT_NTFY_TOPIC` and paste the same value the Pages project
   uses. Without it the job still runs; it just cannot push.
3. Check: dashboard → Workers → `clearview-ops-cron` → Triggers → "Run" the backup cron once,
   then look for `d1/<today>.json.gz` in the bucket.

**Restoring** (only ever into a new, empty database, never over live data):
download a backup file, then
`node scripts/restore-from-backup.mjs backup.json.gz > restore.sql` and
`npx wrangler d1 execute <new-db> --remote --file restore.sql`. The script only prints SQL.
Tests prove a backup restores row for row into a fresh database.

Backups contain customer data, so the bucket must stay private (no public URL, no custom
domain). Cost: a few KB per night, far inside R2's free tier.

## Spam and abuse protection (Turnstile and rate limits)

The public lead form (`/api/estimate`) and the Ask assistant (`/ask/api/chat`, `/ask/api/handoff`)
are open to the internet. Two layers protect them, both in `functions/_lib/abuse-guard.mjs`:

1. **Rate limit, always on.** Per visitor (a hash of the IP, never the IP itself), kept in D1
   table `rate_limits`: estimate form 6 per hour; Ask chat 60 per hour; Ask handoff 10 per hour.
   Over the limit the visitor is told to call. If D1 is unavailable the limit steps aside
   rather than block anyone.
2. **Cloudflare Turnstile.** The widget exists and its public **site key** is committed in
   `src/data/site.ts` (`turnstileSiteKey`), so the check now shows on the estimate form. The
   server only *requires* a token once the **secret key** is added as the Pages secret
   `TURNSTILE_SECRET_KEY` (Production and Preview), then redeploy. Until then the widget is
   cosmetic and nothing is refused. Add it with
   `npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name <pages-project>` (paste the
   secret when asked; do not put it in chat or the repo) or in the dashboard under Settings →
   Variables and Secrets. The widget's allowed hostnames must include `windowsbyclearview.com`
   (and `www.` if used), or the check fails on the live site. If Cloudflare's verifier cannot be
   reached the lead is let through (a lost lead costs more than one bot message).

Mark should still see the real leads: test by sending one estimate request after enabling.

## Job photo storage (Cloudflare R2)

Photos Mark takes on his phone (Photos tool, `/internal/tools/photos`) are saved on the
phone first and then backed up to a **private R2 bucket**, so a lost, reset or full phone no
longer loses the job record, and the same photos show up on any device he signs in on.
Nothing is public: the bucket has no public URL, and every photo is served through
`/internal/api/job-photos`, which needs the Command Center login.

**Until the steps below are done, nothing breaks.** The Photos page says "Not connected yet",
photos stay on the phone exactly as before, and they upload on their own (oldest first) the
first time the phone is online after storage is connected.

One-time setup, in the Cloudflare dashboard:

1. **Enable R2** for the account (R2 object storage → get started). Cloudflare may ask for a
   payment method; the free tier below is expected to cover this use.
2. **Create a bucket** named `clearview-job-photos` (leave public access off).
3. Pages → this project → **Settings → Bindings → Add → R2 bucket**: variable name
   **`JOB_PHOTOS`**, bucket `clearview-job-photos`. Add it for **Production** (and **Preview**
   if you test on preview deploys), then **redeploy** so the binding takes effect.

Design notes:

- **What is stored.** The phone shrinks each photo to at most 2000 px on the long edge (JPEG,
  roughly 0.3 to 1.5 MB instead of 5 to 12 MB) before uploading and keeps the original on the
  phone. The server accepts only JPEG, PNG and WebP, decided from the file's own bytes, up to
  8 MB. Objects live at `jobs/<job id>/<photo id>.<ext>` (ids made by the server, never the file
  name); one row per photo in the D1 table `job_photos` (created on first use) holds the job,
  opening, stage, note and the phone's own photo id.
- **Retries are safe.** The phone sends its own photo id with every upload, and the server
  returns the existing photo instead of storing a second copy.
- **Deleting.** Deleting a photo that is backed up removes it from the phone and from R2. "Clear
  this phone's photos for this job" only frees phone storage; cloud copies are kept.
- **Cost (Cloudflare's published R2 pricing, checked 2026-09-30).** Free each month: 10 GB of
  storage, 1 million writes, 10 million reads; above that $0.015 per GB-month, and no charge for
  downloads. At about 1 MB per photo the free storage holds several thousand photos.
- **What this does not do yet.** The server-side Photograph gate in Field mode still trusts the
  photo counts the phone reports; it does not yet count the photos stored in R2. Photos taken on
  a second phone do show in the Photos tool, but Field mode's own photo counts are read from the
  phone you are holding.
- **Local development.** `wrangler pages dev dist --r2 JOB_PHOTOS` simulates the bucket on disk.

## Analytics (internal `/internal/analytics` page)

The page shows three things. **Requests to revenue** counts the last 90 days of
estimate requests, quotes, signatures, jobs and payments straight from D1 (no
setup), plus stale drafts and finalized quotes still waiting on a job. Those totals
are separate counts. Below them, **Which sources bring paying work** follows
quotes linked to a website inquiry (set by *Start quote*, or by clicking a
suggested match on the quote page) through to signature and payment. **Where leads came from** is counted from the
first-touch attribution already stored on each lead in D1, so it works with no
setup. **Site traffic** comes from the Google Analytics 4 Data API through
`functions/internal/api/analytics.js` and is optional: until it is configured the
page says "Not connected" and everything else keeps working. Google Tag Manager
only collects data (it has no reports), so its numbers are the GA4 numbers.
Ahrefs is a link only, because Ahrefs Webmaster Tools (the free plan) has no API.

Setup, in order (needs Google Cloud, GA4 and Cloudflare access):

1. **Find the GA4 property ID.** GA4 -> Admin -> Property settings -> *Property ID*
   (a number such as `123456789`). It is **not** the `G-YE96XMJSWJ` measurement ID.
2. **Enable the API.** Google Cloud Console (any project) -> APIs & Services ->
   enable **Google Analytics Data API**.
3. **Create a service account.** IAM & Admin -> Service accounts -> create
   `clearview-analytics-reader`. It needs no project roles.
4. **Create a key.** That account -> Keys -> Add key -> JSON. If the organization
   blocks key creation (policy `iam.disableServiceAccountKeyCreation`), stop and
   ask Keith; do not work around it.
5. **Grant read access in GA4.** GA4 -> Admin -> Property access management -> add
   the service account's email as **Viewer**.
6. **Store the credentials.** Cloudflare Pages -> this project -> Settings ->
   Variables and Secrets (Production):

| Variable | Type | Value |
| --- | --- | --- |
| `GA4_PROPERTY_ID` | Text | The numeric property ID from step 1 |
| `GA4_SERVICE_ACCOUNT_JSON` | Secret | The whole downloaded JSON key file, pasted as-is |

7. **Redeploy**, sign in, open `/internal/analytics`; the Site traffic panel should
   read **Connected**. Then delete the downloaded key file from your machine. The
   key must never be committed to the repo or pasted into chat.

The service account can only read analytics (scope `analytics.readonly`). If the
panel shows "Unavailable" after setup, the usual causes are the account not yet
added as Viewer, the Data API not enabled, or a wrong property ID.

## Google reviews feed (public `/reviews` page)

`functions/api/google-reviews.js` serves the pinned Google Business Profile's
reviews to `/reviews`. It is optional: with nothing configured it returns
`{ status: "unconfigured" }` and the page keeps its honest empty state.

Cloudflare Pages -> this project -> **Settings -> Variables and Secrets**:

| Variable | Type | Value |
| --- | --- | --- |
| `GOOGLE_PLACES_API_KEY` | Secret | Google Cloud key, restricted to **Places API (New)** only |
| `GOOGLE_PLACE_ID` | Text | Place ID of *Clearview windows and trim LLC*. Find it with `GOOGLE_PLACES_API_KEY=... npm run find:google-place-id` (matches on phone number, not just name) |
| `GOOGLE_PLACE_EXPECTED_NAME` | Text, optional | Defaults to `Clearview windows and trim LLC`. If Google returns a different name for the Place ID, the feed shows nothing |
| `GOOGLE_REVIEWS_TTL_SECONDS` | Text, optional | Edge cache for good responses. Default 21600 (6 h), clamped 300-86400 |

Notes: the Places API returns at most the 5 most relevant reviews, not all of
them. Reviews are shown as written with Google attribution, and no
`aggregateRating` / review schema is emitted (Google treats self-serving review
markup as ineligible). Places API content has caching limits in Google's terms,
so keep the TTL short-ish; the compliant way to show *every* review later is the
Business Profile API with owner OAuth (Keith manages the profile), which needs
Google's API access approval.

## Local development

```bash
npm run build
npx wrangler d1 execute QUOTES_DB --local --file=internal/db/schema.sql
npx wrangler pages dev dist \
  --d1 QUOTES_DB=4700b6f7-c3d8-46c9-9b19-17cf34accb84 \
  -b INTERNAL_PASSWORD=devpassword \
  -b INTERNAL_SESSION_SECRET=devsecret \
  --ai AI
```

`--ai AI` binds Workers AI for the `/ask` photo-analysis feature — it proxies to
the real Cloudflare API, so it needs `wrangler login` to actually return a result
locally; without login it fails gracefully (see the main README's `/ask` section).

`npx astro dev`/`astro preview` do **not** run Pages Functions, so `/internal/*`
will 404 or fail to authenticate under those — use `wrangler pages dev` for
anything touching `/internal/`.

## Schema changes

Edit `internal/db/schema.sql`, then apply it to both copies by hand:

```bash
npx wrangler d1 execute QUOTES_DB --local --file=internal/db/schema.sql
npx wrangler d1 execute QUOTES_DB --remote --file=internal/db/schema.sql
```

There's no migration runner — this is a two-table schema for one internal
user, and a migration framework would be more code than the thing it's
guarding.

## Known gaps, on purpose

- **No attorney review.** `src/data/contractTerms.ts` has a warning at the
top. The right-to-cancel language follows the FTC Cooling-Off Rule model
language, but it has not been checked by a Washington attorney. Do not
treat the printed contract as legally bulletproof until someone has.
- **No edit-after-finalize.** A draft quote (built but not yet signed —
either path) can be edited freely from its "Edit quote" link. Once it's
finalized (a digital signature attached, or a printed copy confirmed
signed), there is no UI or API path to change it — a mistake at that
point means starting a new quote. This is deliberate: a signed contract
shouldn't be silently editable.
- **Single shared password.** There's no per-user login, audit log of who
created which quote, or password reset flow. Fine for one person (Mark);
revisit if a second person needs access.
