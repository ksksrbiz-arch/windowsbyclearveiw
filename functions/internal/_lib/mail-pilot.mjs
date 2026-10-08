// Read model for the direct-mail pilot (Command Center > Mail pilot).
//
// The tables hold the latest load of `npm run build:mail-pilot` (scripts/mail-pilot/lib.mjs): recent home
// sales and re-roof / remodel permits from Clark County public records, one row per property, each
// sorted into a mailing segment. They are research data, not business records: nothing here is a lead,
// quote or customer until a person acts on it. The tables are created on demand so a database that has
// never been loaded reports "no data yet" instead of failing.
//
// Segment rules live here, in one place, so the loader, the page and the tests cannot drift apart.

export const MAIL_PILOT_DDL = [
  `CREATE TABLE IF NOT EXISTS mail_pilot_properties (
    pid INTEGER PRIMARY KEY,
    ref TEXT NOT NULL UNIQUE,
    street TEXT NOT NULL, city TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'WA', zip TEXT, jurisdiction TEXT,
    source TEXT NOT NULL,
    segment TEXT NOT NULL,
    sale_date TEXT, sale_cents INTEGER, deed TEXT,
    prior_sale_date TEXT, prior_sale_cents INTEGER,
    permit_case TEXT, permit_type TEXT, permit_issued TEXT, permit_status TEXT,
    year_built INTEGER, living_sqft INTEGER, lot_sqft INTEGER,
    subdivision TEXT, school_district TEXT,
    address_points INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    first_seen TEXT, last_seen TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mail_pilot_segment ON mail_pilot_properties(segment, zip, street)`,
  `CREATE TABLE IF NOT EXISTS mail_pilot_meta (key TEXT PRIMARY KEY, value TEXT)`,
];

/** Defaults the loader writes to mail_pilot_meta; a different cutoff or price floor is a loader flag. */
export const DEFAULT_RULES = Object.freeze({
  minPrice: 50000,
  cutoffYear: 1995,
  likelyDeeds: Object.freeze(['D-SWD', 'D-WARR', 'D-B&S']),
});

export const REF_PREFIX = 'CV-';

/** Segment key, plain-language name, which wave it belongs to, and the rule as the page words it. */
export const SEGMENTS = Object.freeze([
  { key: 'A', name: 'Re-roof permit', wave: 'wave1', rule: 'A re-roof permit was issued at this home in the window.' },
  { key: 'B', name: 'Remodel / addition permit', wave: 'wave1', rule: 'A remodel or addition permit was issued in the window. The county does not publish what the work is.' },
  { key: 'C', name: 'Recent buyer, older home', wave: 'wave1', rule: 'Sold in the window to a likely market buyer, no permit, and built in or before the cutoff year.' },
  { key: 'D', name: 'Recent buyer, newer home', wave: 'compare', rule: 'Same as C but built after the cutoff year (or the year is unknown). Not in wave 1: mail a small batch later to see whether home age changes the response.' },
  { key: 'E', name: 'Other transfer (hold)', wave: 'hold', rule: 'No permit and not a likely market sale: a quitclaim, probate, trust transfer or a sale with no price.' },
]);
export const WAVE1_SEGMENTS = Object.freeze(SEGMENTS.filter((s) => s.wave === 'wave1').map((s) => s.key));

const num = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

/** A sale counts as a likely market sale only with a real price on an arm's-length style deed. */
export function isLikelyMarketSale({ salePrice, deed }, rules = DEFAULT_RULES) {
  const price = num(salePrice);
  return price !== null && price >= rules.minPrice && rules.likelyDeeds.includes(String(deed ?? ''));
}

/**
 * Deterministic segment for one property. Order matters: a permit outranks a sale, so a home that sold
 * and then pulled a permit is a permit lead, not a buyer lead. An unknown year built falls to D (the
 * comparison group) rather than being assumed old.
 */
export function segmentFor({ permitType, salePrice, deed, yearBuilt }, rules = DEFAULT_RULES) {
  if (String(permitType ?? '').toUpperCase() === 'REROOF') return 'A';
  if (permitType) return 'B';
  if (isLikelyMarketSale({ salePrice, deed }, rules)) {
    const year = num(yearBuilt);
    return year && year <= rules.cutoffYear ? 'C' : 'D';
  }
  return 'E';
}

const created = new WeakSet();

export async function ensureMailPilotTables(db) {
  if (!db || created.has(db)) return;
  for (const sql of MAIL_PILOT_DDL) await db.prepare(sql).run();
  created.add(db);
}

const all = (statement) => statement.all().then((r) => r.results || []);

export const AGE_BANDS = Object.freeze(['1979 or earlier', '1980 to 1995', '1996 to 2005', '2006 to 2015', '2016 or later', 'Unknown']);
export function ageBand(year) {
  const y = num(year);
  if (!y || y < 1700) return 'Unknown';
  if (y <= 1979) return AGE_BANDS[0];
  if (y <= 1995) return AGE_BANDS[1];
  if (y <= 2005) return AGE_BANDS[2];
  if (y <= 2015) return AGE_BANDS[3];
  return AGE_BANDS[4];
}

const PRICE_EDGES = [0, 300000, 400000, 500000, 600000, 800000, Infinity];
export const PRICE_BANDS = Object.freeze(['Under $300k', '$300k to $399k', '$400k to $499k', '$500k to $599k', '$600k to $799k', '$800k and up']);
export function priceBand(cents) {
  const dollars = (num(cents) ?? 0) / 100;
  const i = PRICE_EDGES.findIndex((edge, k) => dollars >= edge && dollars < PRICE_EDGES[k + 1]);
  return PRICE_BANDS[Math.max(i, 0)];
}

function weekStart(iso) {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

const tally = (map, key) => map.set(key, (map.get(key) || 0) + 1);
const ranked = (map) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value }));

/** Counts for the page. Contains no street addresses, so it is safe to fetch on every page view. */
export async function readMailPilotSummary(db) {
  await ensureMailPilotTables(db);
  const metaRows = await all(db.prepare(`SELECT key, value FROM mail_pilot_meta`));
  const meta = Object.fromEntries(metaRows.map((r) => [r.key, r.value]));
  if (!meta.imported_at) return { status: 'empty' };

  const rows = await all(db.prepare(
    `SELECT segment, source, city, sale_date, sale_cents, deed, permit_type, permit_issued, year_built, address_points FROM mail_pilot_properties`,
  ));
  const rules = {
    minPrice: num(meta.min_price) ?? DEFAULT_RULES.minPrice,
    cutoffYear: num(meta.cutoff_year) ?? DEFAULT_RULES.cutoffYear,
    likelyDeeds: String(meta.likely_deeds || DEFAULT_RULES.likelyDeeds.join(',')).split(',').filter(Boolean),
  };

  const bySegment = Object.fromEntries(SEGMENTS.map((s) => [s.key, 0]));
  const cities = new Map();
  const ages = new Map(AGE_BANDS.map((b) => [b, 0]));
  const prices = new Map(PRICE_BANDS.map((b) => [b, 0]));
  const weeks = new Map();
  const dates = { saleMin: '', saleMax: '', permitMin: '', permitMax: '' };
  let verify = 0;
  let likelySales = 0;
  let permits = 0;
  for (const row of rows) {
    if (row.segment in bySegment) bySegment[row.segment] += 1;
    if (WAVE1_SEGMENTS.includes(row.segment)) tally(cities, row.city || '(unknown)');
    if (Number(row.address_points) > 1) verify += 1;
    if (row.permit_type) {
      permits += 1;
      if (row.permit_issued && (!dates.permitMin || row.permit_issued < dates.permitMin)) dates.permitMin = row.permit_issued;
      if (row.permit_issued && row.permit_issued > dates.permitMax) dates.permitMax = row.permit_issued;
    }
    if (row.sale_date) {
      if (!dates.saleMin || row.sale_date < dates.saleMin) dates.saleMin = row.sale_date;
      if (row.sale_date > dates.saleMax) dates.saleMax = row.sale_date;
      const week = weekStart(row.sale_date);
      if (week) weeks.set(week, (weeks.get(week) || 0) + 1);
    }
    if (isLikelyMarketSale({ salePrice: (num(row.sale_cents) ?? 0) / 100, deed: row.deed }, rules)) {
      likelySales += 1;
      tally(ages, ageBand(row.year_built));
      tally(prices, priceBand(row.sale_cents));
    }
  }
  const wave1 = WAVE1_SEGMENTS.reduce((sum, key) => sum + bySegment[key], 0);
  return {
    status: 'ok',
    meta,
    rules,
    totals: { addresses: rows.length, wave1, likelySales, permits, verify },
    window: { salesFrom: dates.saleMin, salesTo: dates.saleMax, permitsFrom: dates.permitMin, permitsTo: dates.permitMax },
    segments: SEGMENTS.map((s) => ({ ...s, addresses: bySegment[s.key] })),
    cities: ranked(cities),
    ageBands: AGE_BANDS.map((label) => ({ label, value: ages.get(label) })),
    priceBands: PRICE_BANDS.map((label) => ({ label, value: prices.get(label) })),
    weeklySales: [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value })),
  };
}

const MAX_PAGE = 300;

/** One page of addresses, optionally for some segments. Street addresses: callers are behind the session gate. */
export async function readMailPilotList(db, { segments = [], limit = 100, offset = 0 } = {}) {
  await ensureMailPilotTables(db);
  const keys = cleanSegments(segments);
  const cap = Math.min(Math.max(Math.trunc(Number(limit)) || 100, 1), MAX_PAGE);
  const skip = Math.max(Math.trunc(Number(offset)) || 0, 0);
  const where = keys.length ? `WHERE segment IN (${keys.map(() => '?').join(',')})` : '';
  const [rows, total] = await Promise.all([
    all(db.prepare(
      `SELECT ref, street, city, state, zip, segment, source, sale_date, sale_cents, permit_type, permit_issued, year_built, living_sqft, address_points, notes
       FROM mail_pilot_properties ${where} ORDER BY segment, zip, street, pid LIMIT ? OFFSET ?`,
    ).bind(...keys, cap, skip)),
    db.prepare(`SELECT COUNT(*) AS n FROM mail_pilot_properties ${where}`).bind(...keys).first('n'),
  ]);
  return {
    total: Number(total) || 0,
    rows: rows.map((r) => ({
      ref: r.ref,
      street: r.street,
      city: r.city,
      state: r.state,
      zip: r.zip,
      segment: r.segment,
      source: r.source,
      saleDate: r.sale_date || '',
      saleCents: r.sale_cents,
      permitType: r.permit_type || '',
      permitIssued: r.permit_issued || '',
      yearBuilt: r.year_built,
      livingSqft: r.living_sqft,
      verify: Number(r.address_points) > 1,
      notes: r.notes || '',
    })),
  };
}

/** Segment keys from a query string ("A,B,C"): letters in SEGMENTS only, in order, no duplicates. */
export function cleanSegments(input) {
  const wanted = new Set((Array.isArray(input) ? input : String(input ?? '').split(',')).map((s) => String(s).trim().toUpperCase()));
  return SEGMENTS.map((s) => s.key).filter((key) => wanted.has(key));
}

export const CSV_HEADER = ['Reference code', 'Mail-to line', 'Street', 'City', 'State', 'ZIP', 'Segment', 'Segment name', 'Source', 'Verify address (several address points)'];
export const MAIL_TO_LINE = 'CURRENT RESIDENT';

// Spreadsheet programs run a cell that starts with = + - @ as a formula. Addresses never should, but the
// file leaves the system and opens in Excel, so neutralize it the usual way.
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const upper = (value) => String(value ?? '').toUpperCase();

export function toMailMergeCsv(rows) {
  const names = Object.fromEntries(SEGMENTS.map((s) => [s.key, s.name]));
  const lines = [CSV_HEADER.map(csvCell).join(',')];
  for (const r of rows) {
    // Street and city in capitals, the way the postal service and most print vendors want them.
    lines.push([r.ref, MAIL_TO_LINE, upper(r.street), upper(r.city), r.state, r.zip, r.segment, names[r.segment] || '', r.source, r.verify ? 'Y' : ''].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Mail-merge file for the chosen segments (default: wave 1). Not paged: a mail house wants the whole list. */
export async function readMailPilotCsv(db, { segments = WAVE1_SEGMENTS } = {}) {
  const keys = cleanSegments(segments);
  const chosen = keys.length ? keys : [...WAVE1_SEGMENTS];
  // Page through everything; the cap exists for the on-screen table, not for the file.
  const first = await readMailPilotList(db, { segments: chosen, limit: MAX_PAGE, offset: 0 });
  const out = [...first.rows];
  for (let offset = MAX_PAGE; offset < first.total; offset += MAX_PAGE) {
    out.push(...(await readMailPilotList(db, { segments: chosen, limit: MAX_PAGE, offset })).rows);
  }
  return { segments: chosen, count: out.length, csv: toMailMergeCsv(out) };
}
