// Read model for public-records permit leads (Command Center > Analytics).
//
// The tables hold the latest snapshot built by `npm run build:permit-leads`
// (scripts/build-permit-leads.mjs): Clark County + City of Vancouver permits joined to
// assessor parcels and WA L&I contractor licenses. They are research data, not
// business records: nothing here is a lead, quote or customer until a person acts on
// it. The tables are created on demand so a database that has never been loaded
// reports "no data yet" instead of failing.

export const PERMIT_LEAD_DDL = [
  `CREATE TABLE IF NOT EXISTS permit_prospects (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    issued TEXT, received TEXT, status TEXT, work_type TEXT,
    applicant_name TEXT, situs_address TEXT, jurisdiction TEXT, property_type TEXT, subdivision TEXT,
    year_built INTEGER, bldg_sqft INTEGER, lot_sqft INTEGER,
    owner_name TEXT, owner_mailing TEXT, owner_absentee INTEGER, applicant_is_owner INTEGER,
    last_sale_date TEXT, last_sale_cents INTEGER,
    entity_key TEXT, signals TEXT, score INTEGER NOT NULL DEFAULT 0, property_id INTEGER, imported_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_permit_prospects_kind ON permit_prospects(kind, score DESC, issued DESC)`,
  `CREATE TABLE IF NOT EXISTS permit_builders (
    entity_key TEXT PRIMARY KEY,
    display_name TEXT, applicants TEXT, permits INTEGER, lots INTEGER, subdivisions TEXT, jurisdictions TEXT,
    first_issued TEXT, last_issued TEXT, issued_30d INTEGER, issued_90d INTEGER,
    li_match TEXT, li_business TEXT, li_license TEXT, li_phone TEXT, li_address TEXT, li_principal TEXT,
    li_status TEXT, li_expires TEXT, li_ubi TEXT, imported_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS permit_import_meta (key TEXT PRIMARY KEY, value TEXT)`,
];

const created = new WeakSet();

export async function ensurePermitLeadTables(db) {
  if (!db || created.has(db)) return;
  for (const sql of PERMIT_LEAD_DDL) await db.prepare(sql).run();
  created.add(db);
}

const all = (statement) => statement.all().then((r) => r.results || []);
const parse = (text, fallback) => { try { const v = JSON.parse(text); return v ?? fallback; } catch { return fallback; } };

export const SIGNAL_LABELS = {
  single_family: 'Single-family home',
  owner_applied: 'Owner applied',
  addition: 'Addition',
  recent_permit: 'Permit in last 90 days',
  recent_sale: 'Sold in last 2 years',
};

/** Summary for the Analytics section: counts, charts and the builder table. */
export async function readPermitSummary(db, { builderLimit = 40 } = {}) {
  await ensurePermitLeadTables(db);
  const metaRows = await all(db.prepare(`SELECT key, value FROM permit_import_meta`));
  const meta = Object.fromEntries(metaRows.map((r) => [r.key, r.value]));
  if (!meta.imported_at) return { status: 'empty' };

  const [homeowners, newHomes, byMonth, builders, builderTotals] = await Promise.all([
    all(db.prepare(`SELECT score, signals, owner_absentee, year_built FROM permit_prospects WHERE kind = 'homeowner'`)),
    all(db.prepare(`SELECT issued, status FROM permit_prospects WHERE kind = 'new_home'`)),
    all(db.prepare(`SELECT substr(issued, 1, 7) AS month, COUNT(*) AS n FROM permit_prospects WHERE kind = 'new_home' AND issued != '' GROUP BY 1 ORDER BY 1`)),
    all(db.prepare(`SELECT * FROM permit_builders ORDER BY permits DESC, display_name LIMIT ?`).bind(builderLimit)),
    all(db.prepare(`SELECT COUNT(*) AS entities, SUM(CASE WHEN permits >= 2 THEN 1 ELSE 0 END) AS repeat_entities, SUM(CASE WHEN li_license != '' THEN 1 ELSE 0 END) AS matched, SUM(permits) AS permits FROM permit_builders`)),
  ]);

  const signalCounts = Object.fromEntries(Object.keys(SIGNAL_LABELS).map((k) => [k, 0]));
  const scoreHistogram = [0, 0, 0, 0, 0, 0];
  const decades = new Map();
  let absentee = 0;
  let built1016 = 0;
  for (const h of homeowners) {
    for (const s of parse(h.signals, [])) if (s in signalCounts) signalCounts[s] += 1;
    scoreHistogram[Math.min(Math.max(Number(h.score) || 0, 0), 5)] += 1;
    if (h.owner_absentee === 1) absentee += 1;
    const year = Number(h.year_built);
    if (year >= 2011 && year <= 2016) built1016 += 1;
    if (year > 1800) decades.set(Math.floor(year / 10) * 10, (decades.get(Math.floor(year / 10) * 10) || 0) + 1);
  }
  const totals = builderTotals[0] || {};
  return {
    status: 'ok',
    meta,
    homeowners: {
      total: homeowners.length,
      signals: Object.entries(signalCounts).map(([key, value]) => ({ key, label: SIGNAL_LABELS[key], value })),
      scoreHistogram: scoreHistogram.map((value, score) => ({ label: `${score} of 5`, value })),
      decades: [...decades.entries()].sort((a, b) => a[0] - b[0]).map(([decade, value]) => ({ label: `${decade}s`, value })),
      absentee,
      built2011to2016: built1016,
    },
    newHomes: {
      permits: newHomes.length,
      entities: Number(totals.entities) || 0,
      repeatEntities: Number(totals.repeat_entities) || 0,
      licenseMatched: Number(totals.matched) || 0,
      byMonth: byMonth.map((r) => ({ label: r.month, value: r.n })),
    },
    builders: builders.map((b) => ({
      name: b.display_name,
      applicants: parse(b.applicants, []),
      permits: b.permits,
      lots: b.lots,
      subdivisions: parse(b.subdivisions, []),
      jurisdictions: parse(b.jurisdictions, []),
      lastIssued: b.last_issued,
      issued30d: b.issued_30d,
      issued90d: b.issued_90d,
      license: b.li_license
        ? { match: b.li_match, business: b.li_business, number: b.li_license, phone: b.li_phone, address: b.li_address, principal: b.li_principal, status: b.li_status, expires: b.li_expires }
        : null,
    })),
  };
}

/** Homeowner remodel/addition rows, best fit first. Owner names are personal data: callers are behind the session gate. */
export async function readHomeownerLeads(db, { limit = 100 } = {}) {
  await ensurePermitLeadTables(db);
  const cap = Math.min(Math.max(Math.trunc(Number(limit)) || 100, 1), 300);
  const rows = await all(db.prepare(
    `SELECT id, issued, received, status, work_type, applicant_name, situs_address, jurisdiction, property_type, year_built, bldg_sqft,
            owner_name, owner_mailing, owner_absentee, applicant_is_owner, last_sale_date, last_sale_cents, signals, score
     FROM permit_prospects WHERE kind = 'homeowner'
     ORDER BY score DESC, COALESCE(NULLIF(issued, ''), received) DESC, id LIMIT ?`,
  ).bind(cap));
  return rows.map((r) => ({
    id: r.id,
    permitDate: r.issued || r.received || '',
    status: r.status,
    workType: r.work_type,
    address: r.situs_address,
    jurisdiction: r.jurisdiction,
    propertyType: r.property_type,
    yearBuilt: r.year_built,
    sqft: r.bldg_sqft,
    owner: r.owner_name,
    ownerMailing: r.owner_mailing,
    absentee: r.owner_absentee === 1,
    ownerApplied: r.applicant_is_owner === 1,
    lastSaleDate: r.last_sale_date || '',
    lastSaleCents: r.last_sale_cents,
    signals: parse(r.signals, []),
    score: r.score,
  }));
}
