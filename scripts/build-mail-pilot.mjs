#!/usr/bin/env node
// Builds the mail-pilot load file for Command Center > Mail pilot.
//
//   npm run build:mail-pilot -- --in=/path/to/properties.json
//   npm run build:mail-pilot -- --in=... --pulled=2026-10-08 --out=data/mail-pilot --min-price=50000 --cutoff-year=1995
//
// Input is the properties file from the county-records pull (an array of rows, or { "rows": [...] };
// the row fields are listed in .ai/workflows/mail-pilot/CONTEXT.md). This script validates every row,
// sorts each property into a segment with the one set of rules in functions/internal/_lib/mail-pilot.mjs,
// and writes mail-pilot.sql, ready for D1:
//
//   npx wrangler d1 execute QUOTES_DB --remote --file=data/mail-pilot/mail-pilot.sql
//
// Loading is a merge: a property keeps the reference code printed on its mail, new properties get the
// next code, and nothing is deleted. The output directory holds street addresses and this repository is
// public, so the script refuses to write anywhere in the repo except the git-ignored data/ folder.
// Nothing is loaded into D1 by this script.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RULES, SEGMENTS } from '../functions/internal/_lib/mail-pilot.mjs';
import { assertPrivateOutput, normalizeAll, rowsOf, tallySegments, toSql } from './mail-pilot/lib.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const die = (message) => { console.error(`build:mail-pilot: ${message}`); process.exit(2); };

const input = arg('in');
if (!input) die('--in=<properties.json> is required (see .ai/workflows/mail-pilot/CONTEXT.md for the row fields).');
const today = new Date().toISOString().slice(0, 10);
const pulledOn = arg('pulled') || today;
if (!/^\d{4}-\d{2}-\d{2}$/.test(pulledOn)) die('--pulled must be YYYY-MM-DD (the day the county data was pulled).');
const minPrice = arg('min-price') === undefined ? DEFAULT_RULES.minPrice : Number(arg('min-price'));
const cutoffYear = arg('cutoff-year') === undefined ? DEFAULT_RULES.cutoffYear : Number(arg('cutoff-year'));
if (!Number.isFinite(minPrice) || minPrice < 0) die('--min-price must be a dollar amount.');
if (!Number.isInteger(cutoffYear) || cutoffYear < 1800 || cutoffYear > 2100) die('--cutoff-year must be a year.');
const rules = { minPrice, cutoffYear, likelyDeeds: DEFAULT_RULES.likelyDeeds };

let out;
try { out = assertPrivateOutput(arg('out') || 'data/mail-pilot', repoRoot); } catch (error) { die(error.message); }

let rows;
try {
  rows = normalizeAll(rowsOf(JSON.parse(readFileSync(input, 'utf8'))), rules);
} catch (error) {
  die(error.message);
}

const importedAt = new Date().toISOString();
const meta = {
  min_price: String(minPrice),
  cutoff_year: String(cutoffYear),
  likely_deeds: rules.likelyDeeds.join(','),
  sources: 'Clark County WA public GIS: recent sales (LandRecords), permits (Permitting), taxlots, zoning and school districts (gis.clark.wa.gov)',
  rows_in_file: String(rows.length),
};
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'mail-pilot.sql'), toSql({ rows, meta, importedAt, pulledOn }));

const tally = tallySegments(rows);
console.log(`rows: ${rows.length} (${rows.filter((r) => r.ref).length} already carry a reference code)`);
for (const s of SEGMENTS) console.log(`  ${s.key}  ${s.name.padEnd(28)} ${String(tally[s.key]).padStart(4)}   ${s.wave}`);
console.log(`rules: likely market sale = priced at ${minPrice}+ on ${rules.likelyDeeds.join(', ')}; older home = built in or before ${cutoffYear}`);
console.log(`wrote ${join(out, 'mail-pilot.sql')}`);
