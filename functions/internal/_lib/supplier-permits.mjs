// Read model for the supplier permit list (Command Center > Analytics > "Supplier permit list").
//
// The tables hold permits from a licensed weekly report (Construction Monitor, via Dorian, Mark's supplier),
// joined by `npm run build:supplier-permits` to county parcels and WA L&I contractor licenses and compared with
// the permit-leads and mail-pilot lists. They are research data, not business records: nothing here is a lead,
// quote or customer until a person acts on it.
//
// Loading is a merge keyed by permit number, so each weekly edition adds to the table and a permit seen again
// is refreshed in place. Nothing is deleted by a load. Rows carry owner names, mailing addresses and phone
// numbers, so the summary below contains none of them (business names and counts only) and the list/CSV are
// separate requests behind the session gate.
//
// This file is the one place the group rules, the column list and the table shape live; the loader
// (scripts/supplier-permits/lib.mjs), the endpoint and the page all import from here.

export const SUPPLIER_COLUMNS = [
  'id', 'source', 'edition', 'section', 'county', 'city', 'zip', 'grp', 'category', 'subcategory', 'permit_type',
  'valuation_cents', 'site_address', 'permit_date', 'sqft', 'roles',
  'owner_name', 'owner_phone', 'owner_mailing', 'builder_name', 'builder_role', 'builder_phone', 'builder_license', 'builder_mailing', 'applicant_name',
  'no_contractor', 'parcel_match', 'property_id', 'property_type', 'subdivision', 'jurisdiction', 'zoning',
  'year_built', 'bldg_sqft', 'lot_sqft', 'assessed_cents', 'land_cents', 'building_cents',
  'assessor_owner', 'assessor_mailing', 'owner_absentee', 'owner_matches_assessor', 'last_sale_date', 'last_sale_cents',
  'li_match', 'li_business', 'li_license', 'li_status', 'li_expires', 'li_phone', 'li_type', 'li_specialty', 'li_ubi',
  'builder_key', 'tracked_builder', 'tracked_related', 'county_prospect_id', 'county_prospect_how', 'mail_pilot_ref',
  'signals', 'score', 'first_seen', 'last_seen', 'imported_at',
];

export const SUPPLIER_DDL = [
  `CREATE TABLE IF NOT EXISTS supplier_permits (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL, edition TEXT, section TEXT, county TEXT, city TEXT, zip TEXT,
    grp TEXT NOT NULL, category TEXT, subcategory TEXT, permit_type TEXT,
    valuation_cents INTEGER, site_address TEXT, permit_date TEXT, sqft INTEGER, roles TEXT,
    owner_name TEXT, owner_phone TEXT, owner_mailing TEXT,
    builder_name TEXT, builder_role TEXT, builder_phone TEXT, builder_license TEXT, builder_mailing TEXT, applicant_name TEXT,
    no_contractor INTEGER, parcel_match TEXT, property_id INTEGER, property_type TEXT, subdivision TEXT, jurisdiction TEXT, zoning TEXT,
    year_built INTEGER, bldg_sqft INTEGER, lot_sqft INTEGER, assessed_cents INTEGER, land_cents INTEGER, building_cents INTEGER,
    assessor_owner TEXT, assessor_mailing TEXT, owner_absentee INTEGER, owner_matches_assessor INTEGER, last_sale_date TEXT, last_sale_cents INTEGER,
    li_match TEXT, li_business TEXT, li_license TEXT, li_status TEXT, li_expires TEXT, li_phone TEXT, li_type TEXT, li_specialty TEXT, li_ubi TEXT,
    builder_key TEXT, tracked_builder TEXT, tracked_related TEXT, county_prospect_id TEXT, county_prospect_how TEXT, mail_pilot_ref TEXT,
    signals TEXT, score INTEGER NOT NULL DEFAULT 0, first_seen TEXT, last_seen TEXT, imported_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_permits_grp ON supplier_permits(grp, score DESC, permit_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_permits_builder ON supplier_permits(builder_key)`,
  `CREATE TABLE IF NOT EXISTS supplier_import_meta (key TEXT PRIMARY KEY, value TEXT)`,
];

const created = new WeakSet();

export async function ensureSupplierTables(db) {
  if (!db || created.has(db)) return;
  for (const sql of SUPPLIER_DDL) await db.prepare(sql).run();
  created.add(db);
}

// ---------- groups ----------

export const GROUPS = [
  { key: 'new_home', label: 'New home' },
  { key: 'remodel', label: 'Remodel / addition' },
  { key: 'adu', label: 'ADU / guest house' },
  { key: 'reroof', label: 'Re-roof' },
  { key: 'accessory', label: 'Accessory structure' },
  { key: 'multifamily', label: 'Duplex / apartment' },
  { key: 'site_work', label: 'Demolition, grading, foundation' },
  { key: 'other', label: 'Other residential' },
  { key: 'commercial', label: 'Commercial' },
];
export const GROUP_KEYS = GROUPS.map((g) => g.key);
export const GROUP_LABELS = Object.fromEntries(GROUPS.map((g) => [g.key, g.label]));
/** Only these groups get fit signals: they are the homeowner-style permits a window and trim crew can bid. */
export const SCORED_GROUPS = ['remodel', 'adu', 'reroof'];

const SUB_GROUPS = new Map([
  ['single family homes', 'new_home'],
  ['res rmdl, addn, int fin', 'remodel'],
  ['accessory dwelling units', 'adu'],
  ['reroof residential', 'reroof'],
  ['other residential structures', 'accessory'],
  ['garages & carports', 'accessory'],
  ['swimming pools & spas', 'accessory'],
  ['duplexes & twin homes', 'multifamily'],
  ['apartments & condos', 'multifamily'],
  ['demolition', 'site_work'],
  ['grading & dust', 'site_work'],
  ['footing & foundation residential', 'site_work'],
]);

/** Which of our groups a report section falls in. Anything commercial is "commercial"; unknown residential sections are "other". */
export function groupFor({ category, subcategory }) {
  if (/^commercial/i.test(String(category ?? ''))) return 'commercial';
  return SUB_GROUPS.get(String(subcategory ?? '').trim().toLowerCase()) || 'other';
}

export const cleanGroup = (raw) => {
  const key = String(raw ?? '').trim().toLowerCase();
  return GROUP_KEYS.includes(key) ? key : '';
};

export const SIGNAL_LABELS = {
  single_family: 'Single-family home',
  no_contractor: 'No contractor named',
  addition: 'Addition or ADU',
  recent_permit: 'Permit in last 90 days',
  recent_sale: 'Sold in last 2 years',
};

// ---------- metro ranking (the report's year-to-date single-family builder ranking) ----------

const STOP = new Set(['OF', 'THE', 'AND']);
const SUFFIX = /\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LP|LLP|LTD)\b/g;

/** Comparable word list for a company name: capitals, punctuation and company suffixes gone, "D R" joined to "DR". */
export function nameWords(value) {
  const text = String(value ?? '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9 ]/g, ' ').replace(SUFFIX, ' ');
  const joined = text.split(/\s+/).filter(Boolean).reduce((out, word) => {
    if (/^[A-Z]$/.test(word) && /^[A-Z]{1,2}$/.test(out.at(-1) ?? '')) out[out.length - 1] += word;
    else out.push(word);
    return out;
  }, []);
  return joined.filter((w) => !STOP.has(w));
}

/**
 * Where a builder sits in the report's metro ranking. The report prints truncated names ("Heritage Homes Of",
 * "Pacific Lifestyle"), so a ranking row matches when its words are the start of the builder's words (two words
 * or more, or the builder's name is exactly that). Several rows can be one company (two LLCs); homes are summed
 * and the best rank is reported.
 */
export function metroRankFor(name, ranking) {
  const words = nameWords(name);
  if (!words.length || !Array.isArray(ranking)) return null;
  const hits = ranking.filter((row) => {
    const rw = nameWords(row.name);
    if (!rw.length || rw.length > words.length) return false;
    if (rw.length < 2 && rw.length !== words.length) return false;
    return rw.every((w, i) => words[i] === w);
  });
  if (!hits.length) return null;
  return { rank: Math.min(...hits.map((h) => Number(h.rank) || Infinity)), homes: hits.reduce((n, h) => n + (Number(h.homes) || 0), 0), rows: hits.length };
}

// ---------- readers ----------

const all = (statement) => statement.all().then((r) => r.results || []);
const parse = (text, fallback) => { try { const v = JSON.parse(text); return v ?? fallback; } catch { return fallback; } };
const blank = (column) => `COALESCE(${column}, '') = ''`;
const filled = (column) => `COALESCE(${column}, '') != ''`;
const KNOWN = `(${filled('county_prospect_id')} OR ${filled('mail_pilot_ref')})`;

/** Counts, charts and the builder table. Business names only: no owner names, addresses or phone numbers of people. */
export async function readSupplierSummary(db, { builderLimit = 30 } = {}) {
  await ensureSupplierTables(db);
  const meta = Object.fromEntries((await all(db.prepare(`SELECT key, value FROM supplier_import_meta`))).map((r) => [r.key, r.value]));
  if (!meta.imported_at) return { status: 'empty' };
  const scored = SCORED_GROUPS.map((g) => `'${g}'`).join(',');
  const [byGroup, totals, builders, scoredRows, editions, bandRows] = await Promise.all([
    all(db.prepare(`SELECT grp, COUNT(*) AS n FROM supplier_permits GROUP BY grp`)),
    all(db.prepare(
      `SELECT COUNT(*) AS permits,
              SUM(CASE WHEN section = 'Pending' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN ${filled('owner_phone')} THEN 1 ELSE 0 END) AS with_owner_phone,
              SUM(CASE WHEN ${KNOWN} THEN 1 ELSE 0 END) AS known,
              SUM(CASE WHEN ${filled('county_prospect_id')} THEN 1 ELSE 0 END) AS in_permit_leads,
              SUM(CASE WHEN ${filled('mail_pilot_ref')} THEN 1 ELSE 0 END) AS in_mail_pilot,
              SUM(CASE WHEN parcel_match IN ('permit case', 'address exact', 'address close') THEN 1 ELSE 0 END) AS parcel_matched,
              MIN(permit_date) AS first_date, MAX(permit_date) AS last_date
       FROM supplier_permits`,
    )),
    all(db.prepare(
      `SELECT builder_key, MAX(builder_name) AS name, COUNT(*) AS permits, SUM(COALESCE(valuation_cents, 0)) AS value_cents, MAX(permit_date) AS last_date,
              MAX(tracked_builder) AS tracked, MAX(tracked_related) AS related, MAX(li_license) AS li_license, MAX(li_business) AS li_business,
              MAX(li_status) AS li_status, MAX(li_expires) AS li_expires, MAX(li_match) AS li_match,
              MAX(COALESCE(NULLIF(builder_phone, ''), li_phone)) AS phone
       FROM supplier_permits WHERE grp = 'new_home' AND ${filled('builder_key')}
       GROUP BY builder_key ORDER BY permits DESC, value_cents DESC, name LIMIT ?`,
    ).bind(builderLimit)),
    all(db.prepare(`SELECT signals, owner_absentee, ${filled('owner_phone')} AS has_phone, no_contractor FROM supplier_permits WHERE grp IN (${scored})`)),
    all(db.prepare(`SELECT edition, COUNT(*) AS n FROM supplier_permits GROUP BY edition ORDER BY edition`)),
    all(db.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN ${filled('tracked_builder')} THEN 1 ELSE 0 END) AS tracked FROM supplier_permits WHERE grp = 'new_home'`)),
  ]);
  const t = totals[0] || {};
  const counts = Object.fromEntries(byGroup.map((r) => [r.grp, r.n]));
  const signalCounts = Object.fromEntries(Object.keys(SIGNAL_LABELS).map((k) => [k, 0]));
  const histogram = [0, 0, 0, 0, 0, 0];
  let absentee = 0;
  let withPhone = 0;
  for (const r of scoredRows) {
    const signals = parse(r.signals, []);
    for (const s of signals) if (s in signalCounts) signalCounts[s] += 1;
    histogram[Math.min(signals.length, 5)] += 1;
    if (r.owner_absentee === 1) absentee += 1;
    if (r.has_phone) withPhone += 1;
  }
  const ranking = parse(meta.ranking_json, []);
  const band = bandRows[0] || {};
  return {
    status: 'ok',
    meta: {
      imported_at: meta.imported_at, edition: meta.edition || '', edition_start: meta.edition_start || '', edition_end: meta.edition_end || '',
      source: meta.source || '', xref_asof: meta.xref_asof || '',
    },
    totals: {
      permits: Number(t.permits) || 0, pending: Number(t.pending) || 0, withOwnerPhone: Number(t.with_owner_phone) || 0,
      known: Number(t.known) || 0, inPermitLeads: Number(t.in_permit_leads) || 0, inMailPilot: Number(t.in_mail_pilot) || 0,
      newToLists: (Number(t.permits) || 0) - (Number(t.known) || 0), parcelMatched: Number(t.parcel_matched) || 0,
    },
    window: { from: t.first_date || '', to: t.last_date || '' },
    groups: GROUPS.map((g) => ({ key: g.key, label: g.label, value: counts[g.key] || 0 })).filter((g) => g.value > 0),
    newHomes: { permits: Number(band.n) || 0, trackedPermits: Number(band.tracked) || 0 },
    scored: {
      total: scoredRows.length,
      withPhone,
      absentee,
      signals: Object.entries(signalCounts).map(([key, value]) => ({ key, label: SIGNAL_LABELS[key], value })),
      scoreHistogram: histogram.map((value, score) => ({ label: `${score} of 5`, value })),
    },
    editions: editions.map((e) => ({ edition: e.edition || '', permits: e.n })),
    builders: builders.map((b) => {
      const rank = metroRankFor(b.name, ranking);
      return {
        name: b.name,
        permits: b.permits,
        valueCents: Number(b.value_cents) || 0,
        lastDate: b.last_date || '',
        tracked: b.tracked || '',
        related: b.related || '',
        metro: rank,
        license: b.li_license ? { number: b.li_license, business: b.li_business || '', status: b.li_status || '', expires: b.li_expires || '', match: b.li_match || '' } : null,
        phone: b.phone || '',
      };
    }),
  };
}

const LIST_COLUMNS = `id, section, grp, city, zip, permit_type, valuation_cents, site_address, permit_date, owner_name, owner_phone, owner_mailing,
  builder_name, builder_phone, builder_license, no_contractor, parcel_match, property_type, year_built, bldg_sqft, lot_sqft, assessed_cents,
  owner_absentee, owner_matches_assessor, last_sale_date, last_sale_cents, li_license, li_status, li_expires, li_match, tracked_builder, tracked_related,
  county_prospect_id, mail_pilot_ref, signals, score`;
const MAX_PAGE = 300;
const clampLimit = (value) => Math.min(Math.max(Math.trunc(Number(value)) || 100, 1), MAX_PAGE);
const clampOffset = (value) => Math.max(Math.trunc(Number(value)) || 0, 0);

/** One database row -> the shape the endpoint, the page and the spreadsheet share. */
export function listRow(r) {
  return {
    id: r.id,
    pending: r.section === 'Pending',
    group: r.grp,
    groupLabel: GROUP_LABELS[r.grp] || r.grp,
    city: r.city || '',
    zip: r.zip || '',
    permitType: r.permit_type || '',
    valueCents: r.valuation_cents,
    address: r.site_address || '',
    permitDate: r.permit_date || '',
    owner: r.owner_name || '',
    ownerPhone: r.owner_phone || '',
    ownerMailing: r.owner_mailing || '',
    builder: r.builder_name || '',
    builderPhone: r.builder_phone || '',
    builderLicense: r.builder_license || '',
    noContractor: r.no_contractor === 1,
    parcelMatch: r.parcel_match || '',
    propertyType: r.property_type || '',
    yearBuilt: r.year_built,
    sqft: r.bldg_sqft,
    lotSqft: r.lot_sqft,
    assessedCents: r.assessed_cents,
    absentee: r.owner_absentee === 1,
    ownerDiffers: r.owner_matches_assessor === 0,
    lastSaleDate: r.last_sale_date || '',
    lastSaleCents: r.last_sale_cents,
    stateLicense: r.li_license ? { number: r.li_license, status: r.li_status || '', expires: r.li_expires || '', match: r.li_match || '' } : null,
    trackedBuilder: r.tracked_builder || '',
    relatedBuilder: r.tracked_related || '',
    inPermitLeads: r.county_prospect_id || '',
    mailPilot: r.mail_pilot_ref || '',
    signals: parse(r.signals, []),
    score: r.score,
  };
}

/** Rows for one group (or all), best fit first. Owner names, mailing addresses and phones: callers sit behind the session gate. */
export async function readSupplierList(db, { group = '', limit = 100, offset = 0 } = {}) {
  await ensureSupplierTables(db);
  const key = cleanGroup(group);
  const where = key ? 'WHERE grp = ?' : '';
  const bind = key ? [key] : [];
  const total = Number((await db.prepare(`SELECT COUNT(*) AS n FROM supplier_permits ${where}`).bind(...bind).first('n')) || 0);
  const rows = await all(db.prepare(
    `SELECT ${LIST_COLUMNS} FROM supplier_permits ${where} ORDER BY score DESC, permit_date DESC, id LIMIT ? OFFSET ?`,
  ).bind(...bind, clampLimit(limit), clampOffset(offset)));
  return { total, group: key, rows: rows.map(listRow) };
}

// ---------- spreadsheet file ----------

export const CSV_HEADER = [
  'Group', 'Permit', 'Permit type', 'Value', 'Site address', 'City', 'ZIP', 'Permit date',
  'Owner', 'Owner phone', 'Owner mailing address', 'Contractor / builder', 'Builder phone', 'Builder license (as printed)',
  'State license (L&I)', 'License status', 'License expires', 'Year built', 'Home sq ft', 'Lot sq ft', 'Assessed value',
  'Owner differs from county record', 'Owner lives elsewhere', 'Last sale date', 'Last sale price', 'In permit-leads', 'In mail pilot',
  'Builder already tracked', 'Fit (of 5)', 'Signals', 'County parcel match',
];

// The file opens in a spreadsheet: a cell that starts like a formula would run, so neutralize it the usual way.
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
const dollars = (cents) => (typeof cents === 'number' && Number.isFinite(cents) ? (cents / 100).toFixed(0) : '');

export function toSupplierCsv(rows) {
  const lines = [CSV_HEADER.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([
      r.groupLabel, r.id, r.permitType, dollars(r.valueCents), r.address, r.city, r.zip, r.permitDate,
      r.owner, r.ownerPhone, r.ownerMailing, r.builder, r.builderPhone, r.builderLicense,
      r.stateLicense?.number || '', r.stateLicense?.status || '', r.stateLicense?.expires || '', r.yearBuilt || '', r.sqft || '', r.lotSqft || '', dollars(r.assessedCents),
      r.ownerDiffers ? 'Y' : '', r.absentee ? 'Y' : '', r.lastSaleDate, dollars(r.lastSaleCents), r.inPermitLeads, r.mailPilot,
      r.trackedBuilder, SCORED_GROUPS.includes(r.group) ? r.score : '', r.signals.map((s) => SIGNAL_LABELS[s] || s).join('; '), r.parcelMatch,
    ].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Every row of the chosen group (or all of them) as a spreadsheet file. Paged internally: the cap is for the on-screen table. */
export async function readSupplierCsv(db, { group = '' } = {}) {
  const first = await readSupplierList(db, { group, limit: MAX_PAGE, offset: 0 });
  const rows = [...first.rows];
  for (let offset = MAX_PAGE; offset < first.total; offset += MAX_PAGE) {
    rows.push(...(await readSupplierList(db, { group, limit: MAX_PAGE, offset })).rows);
  }
  return { count: rows.length, group: first.group, csv: toSupplierCsv(rows) };
}
