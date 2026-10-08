// Pure functions for the mail-pilot loader: no network, no clock reads except where `today` is passed in.
// The orchestrator is scripts/build-mail-pilot.mjs; it stays thin so this file carries the logic the tests
// exercise. The segment rules themselves live in functions/internal/_lib/mail-pilot.mjs, next to the
// code that reads them, so the loader and the page cannot disagree.
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { DEFAULT_RULES, MAIL_PILOT_DDL, REF_PREFIX, SEGMENTS, segmentFor } from '../../functions/internal/_lib/mail-pilot.mjs';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const REF_PATTERN = new RegExp(`^${REF_PREFIX}\\d{4,}$`);
const SOURCES = new Set(['Sale', 'Permit', 'Sale + permit']);
const PERMIT_TYPES = { REROOF: 'REROOF', REMODEL: 'REMODEL', 'ADD/REM': 'ADDITION', ADDITION: 'ADDITION' };

const blank = (value) => value === null || value === undefined || String(value).trim() === '';
const text = (value) => (blank(value) ? null : String(value).trim());
const whole = (value) => (blank(value) || !Number.isFinite(Number(value)) ? null : Math.trunc(Number(value)));

/** Rows from a parsed input file: a bare array or { rows: [...] }. */
export function rowsOf(parsed) {
  const rows = Array.isArray(parsed) ? parsed : parsed?.rows;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('The input file has no rows. Expected an array, or an object with a "rows" array.');
  return rows;
}

/**
 * Validate and normalize one input row. Throws with the property id so a bad file is fixed at the
 * source instead of loaded half-wrong. Money is stored in integer cents, like the rest of the database.
 */
export function normalizeRow(input, rules = DEFAULT_RULES) {
  const pid = whole(input?.pid);
  const label = `property ${input?.pid ?? '(no id)'}`;
  const fail = (message) => { throw new Error(`${label}: ${message}`); };
  if (!pid || pid < 1) fail('pid must be a positive whole number');

  const street = text(input.street);
  const city = text(input.city);
  if (!street) fail('street is required');
  if (!city) fail('city is required');
  const zip = blank(input.zip) ? null : String(input.zip).trim().padStart(5, '0');
  if (zip && !/^\d{5}$/.test(zip)) fail(`zip "${input.zip}" is not 5 digits`);

  const source = text(input.source);
  if (!SOURCES.has(source)) fail(`source "${input.source}" must be Sale, Permit or Sale + permit`);

  const dates = {};
  for (const [field, key] of [['sale_date', 'sale_date'], ['prior_date', 'prior_sale_date'], ['permit_issued', 'permit_issued']]) {
    const value = text(input[field]);
    if (value && !ISO_DATE.test(value)) fail(`${field} "${value}" must be YYYY-MM-DD`);
    dates[key] = value;
  }

  const permitRaw = text(input.permit_wt);
  const permitType = permitRaw ? PERMIT_TYPES[permitRaw.toUpperCase()] : null;
  if (permitRaw && !permitType) fail(`permit type "${permitRaw}" must be REROOF, REMODEL or ADD/REM`);

  const price = (field) => {
    if (blank(input[field])) return null;
    const value = Number(input[field]);
    if (!Number.isFinite(value) || value < 0) fail(`${field} must be a dollar amount`);
    return Math.round(value * 100);
  };
  const saleCents = price('sale_price');

  const row = {
    pid,
    ref: text(input.ref),
    street,
    city,
    state: text(input.state) || 'WA',
    zip,
    jurisdiction: text(input.jur),
    source,
    sale_date: dates.sale_date,
    sale_cents: saleCents,
    deed: text(input.deed),
    prior_sale_date: dates.prior_sale_date,
    prior_sale_cents: price('prior_price'),
    permit_case: text(input.permit_case),
    permit_type: permitType,
    permit_issued: dates.permit_issued,
    permit_status: text(input.permit_status),
    year_built: whole(input.yr),
    living_sqft: whole(input.area),
    lot_sqft: whole(input.lot_sqft),
    subdivision: text(input.subdivision),
    school_district: text(input.school_dist),
    address_points: Math.max(whole(input.addr_points) ?? 1, 1),
    notes: text(input.notes),
  };
  if (row.ref && !REF_PATTERN.test(row.ref)) fail(`reference code "${row.ref}" must look like ${REF_PREFIX}0001`);
  if (source === 'Permit' && !permitType) fail('a Permit row needs a permit type');
  if (source === 'Sale' && !row.sale_date) fail('a Sale row needs a sale date');

  row.segment = segmentFor({ permitType, salePrice: saleCents === null ? null : saleCents / 100, deed: row.deed, yearBuilt: row.year_built }, rules);
  // A pipeline that already sorted rows into segments must agree with the rules; a mismatch means one of the two is stale.
  const claimed = text(input.segment ?? input.seg);
  if (claimed && claimed !== row.segment) fail(`file says segment ${claimed} but the rules give ${row.segment}`);
  return row;
}

/** Normalize every row and refuse duplicates. Rows that already carry a reference code are placed first. */
export function normalizeAll(inputs, rules = DEFAULT_RULES) {
  const rows = inputs.map((input) => normalizeRow(input, rules));
  const pids = new Set();
  const refs = new Set();
  for (const row of rows) {
    if (pids.has(row.pid)) throw new Error(`property ${row.pid}: appears twice in the file`);
    pids.add(row.pid);
    if (row.ref) {
      if (refs.has(row.ref)) throw new Error(`property ${row.pid}: reference code ${row.ref} is already used by another row`);
      refs.add(row.ref);
    }
  }
  // Explicit codes go in first so a code handed out automatically can never collide with one in the file.
  return [...rows.filter((r) => r.ref), ...rows.filter((r) => !r.ref)];
}

const sqlText = (value) => (value === null || value === undefined || value === '' ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`);
const sqlNum = (value) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? String(Math.trunc(Number(value))) : 'NULL');

// The next unused code, computed by the database at insert time so a later load never reuses a printed code.
const NEXT_REF = `'${REF_PREFIX}' || printf('%04d', COALESCE((SELECT MAX(CAST(substr(ref, ${REF_PREFIX.length + 1}) AS INTEGER)) FROM mail_pilot_properties), 0) + 1)`;

const COLUMNS = ['pid', 'ref', 'street', 'city', 'state', 'zip', 'jurisdiction', 'source', 'segment', 'sale_date', 'sale_cents', 'deed', 'prior_sale_date', 'prior_sale_cents', 'permit_case', 'permit_type', 'permit_issued', 'permit_status', 'year_built', 'living_sqft', 'lot_sqft', 'subdivision', 'school_district', 'address_points', 'notes', 'first_seen', 'last_seen'];
// A reload refreshes facts but never changes a property's reference code or when it was first seen.
const UPDATE = COLUMNS.filter((c) => !['pid', 'ref', 'first_seen'].includes(c));

/**
 * Merge, not replace: a property keeps its reference code across loads because that code is printed on
 * mail. New properties get the next code. Rows missing from a later pull are left as they were.
 */
export function toSql({ rows, meta, importedAt, pulledOn }) {
  const lines = MAIL_PILOT_DDL.map((statement) => `${statement.trim().replace(/;$/, '')};`);
  for (const r of rows) {
    const values = {
      pid: sqlNum(r.pid), ref: r.ref ? sqlText(r.ref) : NEXT_REF, street: sqlText(r.street), city: sqlText(r.city), state: sqlText(r.state), zip: sqlText(r.zip),
      jurisdiction: sqlText(r.jurisdiction), source: sqlText(r.source), segment: sqlText(r.segment), sale_date: sqlText(r.sale_date), sale_cents: sqlNum(r.sale_cents),
      deed: sqlText(r.deed), prior_sale_date: sqlText(r.prior_sale_date), prior_sale_cents: sqlNum(r.prior_sale_cents), permit_case: sqlText(r.permit_case),
      permit_type: sqlText(r.permit_type), permit_issued: sqlText(r.permit_issued), permit_status: sqlText(r.permit_status), year_built: sqlNum(r.year_built),
      living_sqft: sqlNum(r.living_sqft), lot_sqft: sqlNum(r.lot_sqft), subdivision: sqlText(r.subdivision), school_district: sqlText(r.school_district),
      address_points: sqlNum(r.address_points), notes: sqlText(r.notes), first_seen: sqlText(pulledOn), last_seen: sqlText(pulledOn),
    };
    lines.push(
      `INSERT INTO mail_pilot_properties (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map((c) => values[c]).join(', ')}) ` +
      `ON CONFLICT(pid) DO UPDATE SET ${UPDATE.map((c) => `${c} = excluded.${c}`).join(', ')};`,
    );
  }
  for (const [key, value] of Object.entries({ ...meta, imported_at: importedAt, pulled_on: pulledOn })) {
    lines.push(`INSERT INTO mail_pilot_meta (key, value) VALUES (${sqlText(key)}, ${sqlText(value)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`);
  }
  return `${lines.join('\n')}\n`;
}

/** Counts per segment, for the console summary and the tests. */
export function tallySegments(rows) {
  return Object.fromEntries(SEGMENTS.map((s) => [s.key, rows.filter((r) => r.segment === s.key).length]));
}

/**
 * The output holds street addresses and this repository is public. Refuse any output directory that sits
 * inside the repo except under data/ (git-ignored); a path outside the repo is fine.
 */
export function assertPrivateOutput(out, repoRoot) {
  const target = resolve(repoRoot, out);
  const rel = relative(resolve(repoRoot), target);
  const outside = rel.startsWith('..') || isAbsolute(rel);
  const underData = rel === 'data' || rel.startsWith(`data${sep}`);
  if (!outside && !underData) throw new Error(`Refusing to write addresses to "${out}": inside the repository, only data/ is git-ignored. Use data/mail-pilot or a folder outside the repo.`);
  return target;
}
