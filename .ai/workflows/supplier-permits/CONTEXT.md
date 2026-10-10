# Workflow: Supplier permit list

Load Mark's supplier's weekly permit report (Construction Monitor) into the Command Center and join it to public
county records, so Clearview can see which permits are new to its own lists. Lives in Command Center > Analytics >
"Supplier permit list" (`/internal/analytics`, endpoint `/internal/api/supplier-permits`).

## Load / exclude

| Load | Do not load |
|---|---|
| `internal/README.md` → "Supplier permit list" (commands, privacy, what each column means) | `.ai/workflows/lead-to-quote/`, `.ai/workflows/build-plan/` |
| `functions/internal/_lib/supplier-permits.mjs` (group rules, columns, table shape, readers) | analytics events, copy references, specialists |
| `scripts/supplier-permits/lib.mjs`, `pipeline.mjs`, `fetch.mjs`, `scripts/build-supplier-permits.mjs` (loader) | the report PDF, its parsed JSON, or `data/supplier-permits/` contents in chat or in git (owner names, addresses, phones) |
| `scripts/supplier-permits/parse-construction-monitor.py` (PDF → JSON) | `.ai/workflows/mail-pilot/` unless the cross-reference with it is the task |

## Input

One weekly report PDF from the supplier. It is licensed to a single subscriber and its footer forbids sharing, so
the PDF and everything parsed from it stay on the machine doing the work and in Mark's database. Never in git, in
chat, in an issue or in a screenshot that shows names or phone numbers.

1. `python3 scripts/supplier-permits/parse-construction-monitor.py REPORT.pdf --out <folder outside the repo>/wkNN.json`
   (needs `pdfplumber`). It reads the three-column layout by position, then checks itself against the report's own
   week totals (residential and commercial permit counts) and refuses to write if they do not add up.
2. Optional inputs for the cross-reference: the permit-leads snapshot (`data/permit-leads/prospects.csv`,
   `builders.csv`; run `npm run build:permit-leads` first) and the mail-pilot `properties.json`.

## Process

1. `npm run build:supplier-permits -- --in=<wkNN.json> [--mail-pilot=<properties.json>] [--pulled=YYYY-MM-DD]`.
   Only the county that has free parcel, sale and license data is loaded (Clark County by default); other counties
   in the report are counted as skipped. Per permit, deterministic code does the joins and no value is guessed:
   - the county permit record by case number (gives the property id), else the assessor parcel by street. One exact
     street match is used; several are left unmatched ("ambiguous"), none is "none";
   - latest priced sale, assessor owner and mailing address, year built, areas and values;
   - the contractor's WA L&I license by exact business name (a person's name matches a license principal only as a
     "verify" hint), the printed license is kept as printed;
   - whether the permit is already in permit-leads (same case, else same street), in the mail pilot, and whether the
     builder is already tracked (whole-name match; a name cut off by the report matches only when long enough;
     "HSR 124 LLC" vs "HSR 121 LLC" is flagged "related", never matched);
   - five equal-weight fit signals for remodel, ADU and re-roof permits only (single-family, no contractor named,
     addition or ADU, permit in the last 90 days, sold in the last 2 years). A sort order, not a probability.
2. Read the printed counts (permits, parcel matches, owner phones, already-known, license matches). Compare with the
   report's own totals and the last load before going further.
3. Load `data/supplier-permits/supplier-permits.sql` against the production database in Mark's account with the
   scratch config in `internal/README.md` → "Which database". It is a merge keyed by permit number: a permit seen
   again is refreshed (first_seen kept), new permits are added, permits absent from a later report stay, nothing is
   deleted, and an older file never overwrites newer rows.
4. Open Analytics, check the section, the list and the spreadsheet download.
5. Group rules, columns and table shape change in exactly one file, `functions/internal/_lib/supplier-permits.mjs`,
   so loader, endpoint, page and tests cannot disagree. Change it there, then `npm run test:supplier-permits`.

## Output

Rows in D1 (`supplier_permits`, `supplier_import_meta`), the Analytics section, and a spreadsheet
(`/internal/api/supplier-permits?view=csv[&group=…]`). Money is integer cents. The summary view carries counts and
builder business names only; the list and the spreadsheet carry owner names, mailing addresses and phones and are
separate requests behind the session gate, `private, no-store`, never cached by the service worker.

## Stop conditions

- The repository is public and the report is licensed: never commit, paste or screenshot the PDF, the parsed JSON, the
  SQL, the CSV or any row. The parser and the loader refuse any output folder in the repo except `data/`, which is
  git-ignored. Do not work around either.
- The parser's self-check fails (permits found ≠ the report's totals): open the PDF and fix the parser. Never pass
  `--allow-mismatch` to load.
- Owner phone numbers come from the report and are shown as plain text. Washington restricts unsolicited calls and
  texts: no calling, texting or auto-dialing from this list without the owner having asked to hear from us. Mail is the
  channel for homeowners. Contacting anyone is out of scope for this workflow.
- Do not present a name-only or "verify" license match as a verified license, and never treat "no match" as unlicensed.
- Never invent a business figure. Mark's job value, margin and close rate are typed input elsewhere, not filled in here.
- Loading into Mark's production D1 needs Keith's or Mark's explicit go-ahead, after the code is merged and deployed
  (the tables are created by the SQL file itself; the page shows "No supplier list loaded yet" until then).
- Oregon counties (Multnomah, Washington, Marion and the others in the same report) have no free parcel, sale or license
  source wired in: those permits are skipped, not half-enriched.

## Completion

Done when `npm run test:supplier-permits` and `npm run test:all` pass, the page was inspected in a browser at desktop
and phone width (empty and loaded states), the printed counts of the load match the parser's totals, the production
load is marked done or pending in `.ai/STATE.md`, and `.ai/STATE.md`, `.ai/CHANGELOG.md` and `HANDOFF.md` are updated.
