#!/usr/bin/env node
// Builds the supplier permit list for Command Center > Analytics from one parsed Construction Monitor report.
//
//   python3 scripts/supplier-permits/parse-construction-monitor.py REPORT.pdf --out /private/wk40.json
//   npm run build:supplier-permits -- --in=/private/wk40.json --mail-pilot=/private/properties.json
//   npm run build:supplier-permits -- --in=/private/wk40.json --pulled=2026-10-09 --out=data/supplier-permits
//
// Flags
//   --in=FILE          parsed report (required)
//   --county=NAME      which county's permits to load (default "Clark County": the one with free parcel, sale and license data)
//   --pulled=DATE      YYYY-MM-DD the data was pulled (default today); sets first_seen/last_seen and the age-based signals
//   --leads=DIR        permit-leads snapshot to compare against (default data/permit-leads; prospects.csv and builders.csv)
//   --mail-pilot=FILE  mail-pilot properties.json to compare against (optional)
//   --out=DIR          where the files go (default data/supplier-permits; git-ignored, and refused anywhere else in the repo)
//
// Writes supplier-permits.sql (a merge: a permit already in D1 is refreshed, new ones are added, none are deleted) and
// supplier-permits.csv (the same rows for a spreadsheet). Both hold owner names, mailing addresses and phone numbers from a
// licensed report, and this repository is public, so they stay in a git-ignored folder with owner-only permissions.
// The terminal output is counts only. Nothing is loaded into D1 by this script; see .ai/workflows/supplier-permits/CONTEXT.md.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRow, toSupplierCsv } from '../functions/internal/_lib/supplier-permits.mjs';
import { assertPrivateOutput, parseCsv, tally, toSql } from './supplier-permits/lib.mjs';
import { buildSupplierRows } from './supplier-permits/pipeline.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const die = (message) => { console.error(message); process.exit(2); };

const inputPath = arg('in');
if (!inputPath) die('--in=<parsed report .json> is required (see scripts/supplier-permits/parse-construction-monitor.py).');
const today = new Date().toISOString().slice(0, 10);
const pulled = arg('pulled') || today;
if (!/^\d{4}-\d{2}-\d{2}$/.test(pulled)) die('--pulled must be YYYY-MM-DD');
const county = arg('county') || 'Clark County';
const leadsDir = resolve(REPO, arg('leads') || 'data/permit-leads');
const out = (() => { try { return assertPrivateOutput(arg('out') || 'data/supplier-permits', REPO); } catch (error) { return die(error.message); } })();

const readCsv = (file) => (existsSync(file) ? parseCsv(readFileSync(file, 'utf8')) : []);
const prospects = readCsv(join(leadsDir, 'prospects.csv'));
const builders = readCsv(join(leadsDir, 'builders.csv'));
if (!prospects.length) console.warn(`No permit-leads snapshot in ${leadsDir}: the "already in permit-leads" and "builder already tracked" columns will be empty. Run npm run build:permit-leads first.`);
const leadsSql = join(leadsDir, 'permit-leads.sql');
const xrefAsOf = existsSync(leadsSql) ? /'imported_at',\s*'([^']+)'/.exec(readFileSync(leadsSql, 'utf8'))?.[1] || '' : '';

let mailPilotRows = [];
if (arg('mail-pilot')) {
  const parsed = JSON.parse(readFileSync(resolve(arg('mail-pilot')), 'utf8'));
  mailPilotRows = Array.isArray(parsed) ? parsed : parsed.rows || [];
}

const input = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
console.log(`Pulled ${pulled}; county: ${county}`);
const built = await buildSupplierRows({ input, fetchImpl: fetch, prospects, builders, mailPilotRows, now: pulled, county, log: (line) => console.log(line) });

const importedAt = new Date().toISOString();
const meta = {
  imported_at: importedAt,
  edition: built.edition.label,
  edition_start: built.edition.start,
  edition_end: built.edition.end,
  source: `Construction Monitor weekly permit report, ${built.edition.region || 'Portland / Vancouver / Salem'}; county parcels and sales (gis.clark.wa.gov); WA L&I contractor licenses (data.wa.gov m8qx-ubtq)`,
  xref_asof: xrefAsOf,
  ranking_json: JSON.stringify(built.ranking),
  report_json: JSON.stringify(built.report),
  license_note: 'Permit report licensed to a single subscriber. Internal research only: do not share, forward or publish.',
};

mkdirSync(out, { recursive: true });
const sqlFile = join(out, 'supplier-permits.sql');
const csvFile = join(out, 'supplier-permits.csv');
writeFileSync(sqlFile, toSql({ rows: built.rows, meta, importedAt, pulledOn: pulled }), { mode: 0o600 });
writeFileSync(csvFile, toSupplierCsv(built.rows.map((r) => listRow({ ...r, signals: JSON.stringify(r.signals) }))), { mode: 0o600 });
chmodSync(sqlFile, 0o600);
chmodSync(csvFile, 0o600);

const t = tally(built.rows);
console.log(`permits: ${t.permits}; by group: ${Object.entries(t.byGroup).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`parcel match: ${Object.entries(t.parcel).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`with an owner phone: ${t.withOwnerPhone}; already in permit-leads: ${t.knownPermitLeads}; already in mail pilot: ${t.knownMailPilot}`);
console.log(`builder already tracked: ${t.trackedBuilder}; matched to an active L&I license: ${t.licenseMatched}`);
console.log(`fit score (remodel, ADU, re-roof): ${Object.entries(t.scored).filter(([k]) => k !== 'n/a').map(([k, v]) => `${k} of 5: ${v}`).join(', ')}`);
console.log(`wrote ${sqlFile} and ${csvFile} (owner-only permissions)`);
