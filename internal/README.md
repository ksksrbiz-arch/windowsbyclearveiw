# Mark's internal quoting tool

`/internal/*` is a gated set of pages, behind `wrangler.toml`'s local dev
config here and separately configured in the Cloudflare Pages dashboard for
production. It is not part of the marketing site: it's excluded from the
sitemap and `robots.txt`, and every page carries `noindex, nofollow`.

What it does: Mark logs in with one shared password, builds a firm-price
quote starting from `src/data/pricing.ts` (fully editable per line), and gets
it signed — either on-screen with a finger/mouse signature pad, or printed
and signed by hand. The signed quote doubles as the contract, with the terms
from `src/data/contractTerms.ts`.

## Before this works in production

Cloudflare Pages → this project → **Settings → Bindings** (not Environment
variables — D1 needs a real binding, and this stays separate from
`RESEND_API_KEY`'s Environment variables entry):

| Binding | Type | Value |
| --- | --- | --- |
| `QUOTES_DB` | D1 database | `clearveiw-quotes` (`4700b6f7-c3d8-46c9-9b19-17cf34accb84`) |
| `INTERNAL_PASSWORD` | Secret | The one password Mark keeps on his phone |
| `INTERNAL_SESSION_SECRET` | Secret | A long random string — signs the login session cookie. Generate once with `openssl rand -hex 32` and never rotate it casually; rotating it logs everyone out |

Set these for **Production**, and again for **Preview** if you want to test
the tool on preview deploys. The committed `wrangler.toml` in the repo root
is **local-dev only** — it lets `wrangler d1 execute --local` and
`wrangler pages dev` simulate the database on disk. It is never read by the
real Cloudflare Pages build.

## Local development

```bash
npm run build
npx wrangler d1 execute QUOTES_DB --local --file=internal/db/schema.sql
npx wrangler pages dev dist \
  --d1 QUOTES_DB=4700b6f7-c3d8-46c9-9b19-17cf34accb84 \
  -b INTERNAL_PASSWORD=devpassword \
  -b INTERNAL_SESSION_SECRET=devsecret
```

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
- **No edit-after-finalize.** Once a quote is signed, there is no UI or API
  path to change it — a mistake means starting a new quote. This is
  deliberate: a signed contract shouldn't be silently editable.
- **Single shared password.** There's no per-user login, audit log of who
  created which quote, or password reset flow. Fine for one person (Mark);
  revisit if a second person needs access.
