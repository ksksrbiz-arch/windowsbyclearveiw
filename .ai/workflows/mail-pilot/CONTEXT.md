# Workflow: Mail pilot

Refresh and read the direct-mail pilot: a postcard test to Clark County homes that just sold or pulled a
re-roof / remodel permit, built from public county records. Lives at Command Center > Mail pilot
(`/internal/mail-pilot`).

## Load / exclude

| Load | Do not load |
|---|---|
| `internal/README.md` → "Mail pilot" (commands, privacy, what the groups mean) | `.ai/workflows/lead-to-quote/`, `.ai/workflows/build-plan/` |
| `functions/internal/_lib/mail-pilot.mjs` (the one set of segment rules, tables, readers) | analytics, copy references, specialists |
| `scripts/mail-pilot/lib.mjs`, `scripts/build-mail-pilot.mjs` (loader) | `data/mail-pilot/` contents in chat or in git (street addresses) |
| `src/lib/mail-pilot.ts` (break-even arithmetic, tracking link) | |

## Input

A properties file from the county-records pull: a JSON array of rows, or `{ "rows": [...] }`. One row per
property. The pull itself (Clark County public GIS: LandRecords sales, Permitting, taxlots, zoning, school
districts) is done by hand or ad hoc; no script in this repo fetches it yet, and the file is not committed.

| Field | Required | Meaning |
|---|---|---|
| `pid` | yes | County parcel/property id, positive integer; unique in the file |
| `street`, `city` | yes | Situs address as the county prints it |
| `state`, `zip` | no | Default `WA`; ZIP is left-padded to 5 digits |
| `source` | yes | `Sale`, `Permit` or `Sale + permit` |
| `sale_date`, `sale_price`, `deed` | Sale rows need `sale_date` | ISO date, whole dollars, county deed code (`D-SWD`, `D-WARR`, `D-B&S` count as market deeds) |
| `prior_date`, `prior_price` | no | The sale before this one |
| `permit_case`, `permit_wt`, `permit_status`, `permit_issued` | Permit rows need `permit_wt` | `permit_wt` is `REROOF`, `REMODEL` or `ADD/REM` |
| `yr`, `area`, `lot_sqft`, `subdivision`, `school_dist`, `jur` | no | Assessor facts |
| `addr_points` | no | Address points on the parcel; more than 1 is flagged "verify address" in the CSV |
| `ref` | no | An existing `CV-####` code, if this property was loaded before |
| `segment` or `seg` | no | If given, it must equal what the rules compute, or the build stops |

## Process

1. Pull fresh county data. The county posts sales late: the newest weeks are incomplete, so re-pull about
   six weeks after the window you care about.
2. `npm run build:mail-pilot -- --in=<properties.json> --pulled=YYYY-MM-DD` validates every row, sorts each
   property into a segment (A re-roof permit, B remodel/addition permit, C recent buyer in an older home,
   D recent buyer in a newer home, E other transfer) and writes `data/mail-pilot/mail-pilot.sql`. The
   output directory is git-ignored; the script refuses any other folder inside the repo.
3. Read the printed segment tally. Compare it with the last load before going further.
4. Load it: `npx wrangler d1 execute QUOTES_DB --remote --file=data/mail-pilot/mail-pilot.sql`. This is a
   merge. A property keeps the `CV-####` code printed on its mail, new properties get the next code, rows
   missing from the new pull are left alone, nothing is deleted.
5. Open `/internal/mail-pilot` and check the totals, the charts and the Download button (the mail-merge CSV).
6. Segment rules change in exactly one place, `functions/internal/_lib/mail-pilot.mjs`, so the loader, the page
   and the tests cannot disagree. Change them there, then `npm run test:mail-pilot`.

## Output

Rows in D1 (`mail_pilot_properties`, `mail_pilot_meta`), the page, and the mail-merge CSV
(`/internal/api/mail-pilot?view=csv`). The CSV is what goes to the print shop. Money is stored in integer cents.

## Stop conditions

- The repository is public: never commit, paste into chat or write anywhere but `data/` the file that holds
  street addresses. The loader refuses any other folder in the repo and the API sits behind the session gate with
  `no-store`; do not work around either.
- Never invent a business figure. The break-even box takes Mark's job value, margin and close rate as typed
  input and shows nothing until it has them.
- Never change or reuse a printed `CV-####` code.
- A row fails validation, or a pre-sorted `segment` disagrees with the rules: fix the source file, do not
  loosen the check.
- Loading into Mark's production D1 is his or Keith's explicit go-ahead, after the code is merged and deployed.
- Mailing, buying postage or contacting any homeowner is out of scope for this workflow.

## Completion

Done when `npm run test:mail-pilot` and `npm run test:all` pass, the page was inspected in a browser at desktop
and phone width (empty state included), the segment tally of the load matches what was agreed, the production
load is marked done or pending in `.ai/STATE.md`, and `.ai/STATE.md`, `.ai/CHANGELOG.md` and `HANDOFF.md`
are updated.
