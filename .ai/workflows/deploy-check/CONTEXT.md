# Workflow: Deploy check

Ship a change to production and confirm it works. Includes any domain, DNS or mail-default change.

## Load / exclude

| Load | Do not load |
|---|---|
| `README.md` → "Deployment notes" and wrangler sections | analytics, copy references, specialists |
| `internal/README.md` (secrets, bindings, Access, R2, ops-cron setup) | `.ai/workflows/build-plan/` |
| `.github/workflows/build.yml` (the canonical test order) | |

## Input

A change ready on a branch or `main`. Cloudflare Pages deploys `main` automatically; it builds Astro and
publishes `dist`. Pages bindings (D1 `QUOTES_DB`, R2 `JOB_PHOTOS`, secrets) live in the Pages dashboard, not
in the repo `wrangler.toml`.

## Process

1. Run `npm run test:all`, then `npm run build`, locally. GitHub Actions does not currently run (billing issue,
   2026-10-01), so do not treat a missing or red Actions run as a result; the local run is the gate.
2. Check the Cloudflare Pages preview/production build for the commit.
3. Anything that needs a binding or secret that is not set must degrade safely (Turnstile, Access, R2, AI Gateway
   are all built "off until configured"). Do not claim they are on until the owner has set them.
4. Test server-side behavior with `wrangler pages dev`; `astro dev` does not reproduce Functions.
5. Inspect the live page in a browser for UI-dependent changes (phone width included).
6. Domain/mail: public site is `windowsbyclearview.com`. Production mail remains on the legacy
   `windowsbyclearveiw.com` until a real mailbox exists on the canonical domain and is tested with the
   Command Center mail test. Do not change the default notification address before that.

## Output

A deployed commit, a note of what was checked live, and a list of owner-side steps still pending.

## Stop conditions

A test fails; a deploy needs a secret you do not have; a change would alter mail defaults or domain routing
without a tested mailbox; the preview and the local build disagree.

## Completion

Done when local tests and build pass, the Pages build succeeded, the live behavior was inspected (or marked
`VERIFY` if the deploy could not be inspected), and `.ai/STATE.md`, `.ai/CHANGELOG.md` and `HANDOFF.md` are updated.
