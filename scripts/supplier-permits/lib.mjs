// Pure functions for the supplier-permits loader: no network, no clock reads except where `now` is passed in.
// The network layer is scripts/supplier-permits/fetch.mjs and the orchestrator is scripts/build-supplier-permits.mjs.
//
// Input is the JSON written by scripts/supplier-permits/parse-construction-monitor.py (permits from a licensed weekly
// report). Each permit is joined to its county parcel, its latest sale and a WA L&I contractor license, compared with
// the permit-leads and mail-pilot lists, given deterministic fit signals, and written as a merge into D1.
// Nothing here guesses a phone number, an owner or a license: a value is copied from the report or from one of the
// public sources, or it is left empty.
import { applicantIsOwnerName, daysBetween, isoDate, looksLikeBusiness, matchLicense, nameTokens, normName, sameTokens, streetOf } from '../permit-leads/lib.mjs';
import { SCORED_GROUPS, SUPPLIER_COLUMNS, SUPPLIER_DDL, groupFor, nameWords } from '../../functions/internal/_lib/supplier-permits.mjs';

export { assertPrivateOutput } from '../mail-pilot/lib.mjs';

const BUILDER_ROLES = ['Contractor', 'Contr-Owner', 'Owner-Contractor', 'Owner-Builder'];
const OWNER_ROLES = ['Owner', 'Owner-Builder', 'Contr-Owner', 'Owner-Contractor'];
const JUNK = /^(No Address Given|Unable to Acquire)/i;
const SECTIONS = ['Approved', 'Pending'];
const PHONE = /^\d{3}-\d{3}-\d{4}$/;

const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const posInt = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value)) : null);
const cents = (dollars) => (Number.isFinite(Number(dollars)) && Number(dollars) > 0 ? Math.round(Number(dollars) * 100) : null);
const alnum = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---------- the report's own fields ----------

/** MM/DD/YYYY as printed -> YYYY-MM-DD, or null when it is not a real date. */
export function reportDate(value) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text(value));
  if (!m) return null;
  const iso = `${m[3]}-${m[1]}-${m[2]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

const phoneOf = (value) => (PHONE.test(text(value)) ? text(value) : '');

/** One contact: name first, then mailing lines. The report's "No Address Given" and "Unable to Acquire..." are not data. */
function contactOf(entry, roles) {
  for (const c of Array.isArray(entry.contacts) ? entry.contacts : []) {
    if (!roles.includes(c.role)) continue;
    const lines = (Array.isArray(c.lines) ? c.lines : []).map(text).filter((l) => l && !JUNK.test(l));
    if (!lines.length) continue;
    return { role: c.role, name: lines[0], mailing: lines.slice(1).join(', '), phone: phoneOf(c.phone), license: text(c.lic) };
  }
  return null;
}

/**
 * Validate the parsed report and turn each permit of one county into a flat row, before enrichment.
 * Throws on anything that would make a later join wrong (missing or repeated permit number, bad section, bad date).
 */
export function normalizeEntries(input, { county = 'Clark County' } = {}) {
  const entries = Array.isArray(input?.entries) ? input.entries : null;
  if (!entries?.length) throw new Error('The parsed report has no entries.');
  const e = input.edition || {};
  if (!Number.isInteger(e.week) || !Number.isInteger(e.year) || !reportDate(`${String(e.start).slice(5, 7)}/${String(e.start).slice(8, 10)}/${String(e.start).slice(0, 4)}`)) {
    throw new Error('The parsed report needs edition {week, year, start, end} (start and end as YYYY-MM-DD).');
  }
  const edition = { label: `${e.year}-W${String(e.week).padStart(2, '0')}`, start: e.start, end: e.end, region: text(e.region) };
  const seen = new Set();
  const rows = [];
  let skipped = 0;
  for (const entry of entries) {
    if (entry.county !== county) { skipped += 1; continue; }
    const id = text(entry.pmt);
    if (!id) throw new Error(`A ${county} permit on page ${entry.page ?? '?'} has no permit number.`);
    if (seen.has(id)) throw new Error(`Permit ${id} appears twice in the parsed report.`);
    seen.add(id);
    if (!SECTIONS.includes(entry.section)) throw new Error(`Permit ${id}: section "${entry.section}" must be Approved or Pending.`);
    const value = entry.valuation;
    if (value !== null && value !== undefined && !(Number.isFinite(Number(value)) && Number(value) >= 0)) throw new Error(`Permit ${id}: valuation "${value}" is not a dollar amount.`);
    let permitDate = null;
    if (entry.date) {
      permitDate = reportDate(entry.date);
      if (!permitDate) throw new Error(`Permit ${id}: date "${entry.date}" is not MM/DD/YYYY.`);
    }
    const grp = groupFor({ category: entry.category, subcategory: entry.sub });
    const owner = contactOf(entry, OWNER_ROLES) || contactOf(entry, ['Applicant']);
    let builder = contactOf(entry, BUILDER_ROLES);
    // On a new home the developer or builder company is usually the listed owner.
    if (!builder && grp === 'new_home' && owner) builder = { ...owner, role: `${owner.role} (no contractor listed)`, license: '' };
    const street = text(String(entry.street ?? '').split('|')[0]);
    rows.push({
      id,
      section: entry.section,
      county,
      city: text(entry.city),
      zip: text(entry.zip).slice(0, 5),
      grp,
      category: text(entry.category),
      subcategory: text(entry.sub),
      permitType: text(entry.type),
      valuationCents: cents(value),
      street: JUNK.test(street) ? '' : street,
      permitDate,
      sqft: posInt(entry.sf),
      roles: [...new Set((entry.contacts || []).filter((c) => (c.lines || []).length).map((c) => c.role))],
      owner: owner || { role: '', name: '', mailing: '', phone: '', license: '' },
      builder: builder || { role: '', name: '', mailing: '', phone: '', license: '' },
      applicant: contactOf(entry, ['Applicant'])?.name || '',
      noContractor: !(entry.contacts || []).some((c) => c.role === 'Contractor' && (c.lines || []).length),
    });
  }
  return { edition, rows, skipped, ranking: Array.isArray(input.ranking) ? input.ranking : [], report: input.report || {} };
}

// ---------- addresses ----------

const SUFFIX_WORDS = { STREET: 'ST', AVENUE: 'AVE', DRIVE: 'DR', COURT: 'CT', CIRCLE: 'CIR', LANE: 'LN', ROAD: 'RD', PLACE: 'PL', BOULEVARD: 'BLVD', TERRACE: 'TER', HIGHWAY: 'HWY', PARKWAY: 'PKWY', TRAIL: 'TRL', PLAZA: 'PLZ' };
const DIRECTIONS = { NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW' };

/** Street as the county prints it, for a parcel lookup: capitals, single spaces, unit dropped. '' when there is no usable street. */
export function lookupStreet(street) {
  const s = text(String(street ?? '').split('|')[0]).toUpperCase().replace(/\s+(APT|UNIT|STE|SUITE|SPC|#)\s*\S+.*$/, '');
  return /^\d/.test(s) ? s : '';
}

/** Comparable form of a street: abbreviations and directions standardized, punctuation gone. */
export function addressKey(street) {
  return lookupStreet(street).replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).map((w) => DIRECTIONS[w] || SUFFIX_WORDS[w] || w).join(' ');
}

const zipOf = (situs) => String(situs ?? '').split(',').at(-1).trim().slice(0, 5);

/**
 * Pick the one assessor parcel for a street from the county's candidates (a prefix search, so they can include other
 * streets that merely start the same way). Same street in standard form, unit ignored, is "address exact"; the same
 * street followed by extra words ("BLDG 2") is "address close"; several of either are never guessed between, and a
 * longer street name ("1 A STATION RD" for "1 A ST") is not a match at all.
 */
export function parcelChoice(candidates, { street, zip }) {
  if (!Array.isArray(candidates) || !candidates.length) return { parcel: null, how: 'none' };
  let list = candidates;
  if (zip) {
    const sameZip = list.filter((c) => zipOf(c.SitAddrs) === zip);
    if (sameZip.length) list = sameZip;
  }
  const key = addressKey(street);
  if (!key) return { parcel: null, how: 'none' };
  const keyOf = (c) => addressKey(streetOf(c.SitAddrs));
  const exact = list.filter((c) => keyOf(c) === key);
  if (exact.length === 1) return { parcel: exact[0], how: 'address exact' };
  if (exact.length > 1) return { parcel: null, how: 'ambiguous' };
  const near = list.filter((c) => keyOf(c).startsWith(`${key} `));
  if (near.length === 1) return { parcel: near[0], how: 'address close' };
  return { parcel: null, how: near.length > 1 ? 'ambiguous' : 'none' };
}

// ---------- builders ----------

/** The tracked builder (permit-leads) a printed name refers to, or ''. The report truncates long names ("Richmond American Homes Of"). */
export function trackedBuilderFor(name, builders) {
  const words = nameWords(name);
  if (!words.length) return '';
  const key = words.join(' ');
  for (const b of builders) if (nameWords(b.display_name || b.entity_key).join(' ') === key) return b.display_name;
  const raw = text(name);
  const maybeTruncated = raw.length >= 25 || /\b(OF|AND|THE)$/i.test(raw);
  if (maybeTruncated && words.length >= 2) {
    for (const b of builders) {
      const bw = nameWords(b.display_name || b.entity_key);
      if (words.length < bw.length && words.every((w, i) => bw[i] === w)) return b.display_name;
    }
  }
  return '';
}

/** A tracked builder with the same name apart from a number ("HSR 121 LLC" vs "HSR 124 LLC"): a hint to check, never a match. */
export function relatedBuilderFor(name, builders) {
  const words = nameWords(name);
  const base = words.filter((w) => !/^\d+$/.test(w));
  if (!base.length || base.length === words.length) return '';
  for (const b of builders) {
    const bw = nameWords(b.display_name || b.entity_key);
    const bbase = bw.filter((w) => !/^\d+$/.test(w));
    if (bbase.length !== bw.length && bbase.join(' ') === base.join(' ') && bw.join(' ') !== words.join(' ')) return b.display_name;
  }
  return '';
}

/** Does the owner named on the permit match the assessor's owner? null when either is unknown. */
export function ownerMatchesAssessor(permitOwner, assessorOwner) {
  if (!text(permitOwner) || !text(assessorOwner)) return null;
  if (normName(permitOwner) === normName(assessorOwner) || sameTokens(permitOwner, assessorOwner)) return 1;
  if (!looksLikeBusiness(permitOwner) && applicantIsOwnerName(permitOwner, assessorOwner)) return 1;
  const a = nameTokens(permitOwner);
  const b = nameTokens(assessorOwner);
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size >= 2 && [...small].every((t) => large.has(t))) return 1;
  return 0;
}

// ---------- signals ----------

const isSingleFamily = (propertyType) => /\bSFR\b|SINGLE FAMILY/i.test(String(propertyType ?? ''));
const ADDITION = /\b(ADDITION|ADU|ACCESSORY DWELLING|GUEST HOUSE)\b/i;

/**
 * Deterministic fit signals for the homeowner-style groups (remodel, ADU, re-roof): the score is how many are true.
 * A sort order, not a probability and not a price; the weights are equal on purpose. Same five as the permit-leads
 * remodel list, except that "no contractor named" replaces "owner applied" (the report names roles, not applicants).
 */
export function supplierSignals({ group, propertyType, noContractor, permitType, permitDate, lastSaleDate, now }) {
  if (!SCORED_GROUPS.includes(group)) return [];
  const signals = [];
  if (isSingleFamily(propertyType)) signals.push('single_family');
  if (noContractor) signals.push('no_contractor');
  if (ADDITION.test(String(permitType ?? ''))) signals.push('addition');
  if (permitDate && daysBetween(permitDate, now) <= 90 && daysBetween(permitDate, now) >= 0) signals.push('recent_permit');
  if (lastSaleDate && daysBetween(lastSaleDate, now) <= 730) signals.push('recent_sale');
  return signals;
}

// ---------- the other lists ----------

/** Minimal CSV reader for the snapshot files this repo writes (quoted cells, doubled quotes, embedded commas). */
export function parseCsv(textIn) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = String(textIn ?? '');
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some((v) => v !== '')) rows.push(row); }
  const [head, ...body] = rows;
  return head ? body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))) : [];
}

export function indexProspects(prospects) {
  const byId = new Map();
  const byAddress = new Map();
  for (const p of prospects) {
    if (p.id) byId.set(alnum(p.id), p);
    const key = addressKey(p.situs_address);
    if (key) { if (!byAddress.has(key)) byAddress.set(key, []); byAddress.get(key).push(p); }
  }
  return { byId, byAddress };
}

export function indexMailPilot(rows) {
  const byCase = new Map();
  const byAddress = new Map();
  for (const r of rows) {
    const ref = r.ref || (r.pid ? `pid ${r.pid}` : '');
    if (r.permit_case) byCase.set(alnum(r.permit_case), ref);
    const key = addressKey(r.street);
    if (key && !byAddress.has(key)) byAddress.set(key, ref);
  }
  return { byCase, byAddress };
}

// ---------- enrichment ----------

/**
 * Join one normalized row to everything we know about it.
 * ctx: { now, casePermits: Map(permit number -> {sn}), parcelsBySn: Map, candidatesByStreet: Map(lookupStreet -> parcels),
 *        latestSale: Map(sn -> sale), licenseIndex, prospects: {byId, byAddress}, mailPilot: {byCase, byAddress}, trackedBuilders: [] }
 */
export function enrichRow(row, ctx) {
  const key = addressKey(row.street);
  const sn = Number(ctx.casePermits?.get(String(row.id).toUpperCase())?.sn) || null;
  let parcel = null;
  let how = 'none';
  if (sn && ctx.parcelsBySn?.get(sn)) { parcel = ctx.parcelsBySn.get(sn); how = 'permit case'; } else if (key) {
    ({ parcel, how } = parcelChoice(ctx.candidatesByStreet?.get(lookupStreet(row.street)), { street: row.street, zip: row.zip }));
  }
  const propertyId = parcel ? Number(parcel.serial_num) || null : null;
  const sale = propertyId ? ctx.latestSale?.get(propertyId) : null;
  const saleDate = sale ? isoDate(sale.SaleDate) : '';
  const notFuture = (iso) => (iso && iso <= ctx.now ? iso : '');
  const lastSaleDate = notFuture(saleDate);
  const assessorOwner = text(parcel?.Owner);
  const assessorMailing = text(parcel?.OwnAddrs);
  const siteStreet = parcel ? streetOf(parcel.SitAddrs) : row.street;
  const mailing = assessorMailing || row.owner.mailing;
  const absentee = mailing && siteStreet ? (normName(streetOf(mailing)) === normName(siteStreet) ? 0 : 1) : null;
  const propertyType = text(parcel?.PT1Desc);
  const signals = supplierSignals({ group: row.grp, propertyType, noContractor: row.noContractor, permitType: row.permitType, permitDate: row.permitDate, lastSaleDate, now: ctx.now });

  const builder = row.builder;
  const license = builder.name && (looksLikeBusiness(builder.name) || /^(Contractor|Contr-Owner|Owner-Contractor)/.test(builder.role))
    ? matchLicense({ entityName: builder.name, applicants: [builder.name] }, ctx.licenseIndex || { byBusiness: new Map(), byPrincipal: [] })
    : { license: null, how: '' };
  const li = license.license;

  const prospectById = ctx.prospects?.byId.get(alnum(row.id));
  const prospectByAddress = key ? ctx.prospects?.byAddress.get(key)?.[0] : null;
  const countyProspect = prospectById || prospectByAddress || null;
  const mailRef = ctx.mailPilot?.byCase.get(alnum(row.id)) || (key ? ctx.mailPilot?.byAddress.get(key) : '') || '';

  return {
    id: row.id, source: 'construction_monitor', edition: ctx.edition, section: row.section, county: row.county, city: row.city, zip: row.zip,
    grp: row.grp, category: row.category, subcategory: row.subcategory, permit_type: row.permitType,
    valuation_cents: row.valuationCents, site_address: row.street, permit_date: row.permitDate, sqft: row.sqft, roles: JSON.stringify(row.roles),
    owner_name: row.owner.name, owner_phone: row.owner.phone, owner_mailing: row.owner.mailing,
    builder_name: builder.name, builder_role: builder.role, builder_phone: builder.phone, builder_license: builder.license, builder_mailing: builder.mailing, applicant_name: row.applicant,
    no_contractor: row.noContractor ? 1 : 0, parcel_match: how, property_id: propertyId, property_type: propertyType,
    subdivision: parcel?.Legal ? text(parcel.Legal).split(/\s+(?:LOTS?|BLK|BLOCK|PHASE|TRACT|UNIT|PH\s?\d*)\b|\s#/i)[0].slice(0, 80) : '',
    jurisdiction: text(parcel?.Juris), zoning: text(parcel?.zn_abrev),
    year_built: Number(parcel?.Yrblt) > 1800 ? Number(parcel.Yrblt) : null, bldg_sqft: posInt(parcel?.bldgsqft), lot_sqft: posInt(parcel?.LotSqFt),
    assessed_cents: cents(parcel?.TaxTotVal), land_cents: cents(parcel?.LandVal), building_cents: cents(parcel?.BldVl),
    assessor_owner: assessorOwner, assessor_mailing: assessorMailing, owner_absentee: absentee, owner_matches_assessor: parcel ? ownerMatchesAssessor(row.owner.name, assessorOwner) : null,
    last_sale_date: lastSaleDate, last_sale_cents: lastSaleDate ? cents(sale?.SalePrice) : null,
    li_match: license.how.replace(/^(lot owner|applicant) business name exact/, 'business name exact'), li_business: li?.businessname ?? '', li_license: li?.contractorlicensenumber ?? '', li_status: li?.contractorlicensestatus ?? '',
    li_expires: String(li?.licenseexpirationdate ?? '').slice(0, 10), li_phone: li?.phonenumber ?? '', li_type: li?.contractorlicensetypecodedesc ?? '',
    li_specialty: li?.specialtycode1desc ?? '', li_ubi: li?.ubi ?? '',
    builder_key: builder.name && looksLikeBusiness(builder.name) ? normName(builder.name) : '',
    tracked_builder: builder.name ? trackedBuilderFor(builder.name, ctx.trackedBuilders || []) : '',
    tracked_related: builder.name ? relatedBuilderFor(builder.name, ctx.trackedBuilders || []) : '',
    county_prospect_id: countyProspect?.id ?? '', county_prospect_how: countyProspect ? (prospectById ? 'same permit' : 'same address') : '',
    mail_pilot_ref: mailRef,
    signals, score: signals.length,
  };
}

// ---------- SQL output (for `wrangler d1 execute --file`) ----------

const sqlText = (value) => (value === null || value === undefined || value === '' ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`);
const sqlNum = (value) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? String(Math.trunc(Number(value))) : 'NULL');
const INTEGERS = new Set(['valuation_cents', 'sqft', 'no_contractor', 'property_id', 'year_built', 'bldg_sqft', 'lot_sqft', 'assessed_cents', 'land_cents', 'building_cents', 'owner_absentee', 'owner_matches_assessor', 'last_sale_cents', 'score']);
const KEPT_ON_UPDATE = new Set(['id', 'first_seen']);

/**
 * A merge, not a replace: a permit already in the table is refreshed in place (its first_seen is kept), new permits
 * are added, permits missing from this edition are left alone. DDL is included so the file also works on a database
 * that has never seen these tables. Running the same file twice leaves the same rows.
 */
export function toSql({ rows, meta, importedAt, pulledOn }) {
  const lines = SUPPLIER_DDL.map((statement) => `${statement.trim().replace(/;$/, '')};`);
  const names = SUPPLIER_COLUMNS.join(', ');
  const updates = SUPPLIER_COLUMNS.filter((c) => !KEPT_ON_UPDATE.has(c)).map((c) => `${c} = excluded.${c}`).join(', ');
  // An older file loaded after a newer one must not put old values back: a row is only refreshed by a file at least as new.
  const newerRow = `WHERE excluded.imported_at >= COALESCE(supplier_permits.imported_at, '')`;
  for (const r of rows) {
    const full = { ...r, signals: JSON.stringify(r.signals ?? []), first_seen: pulledOn, last_seen: pulledOn, imported_at: importedAt };
    const values = SUPPLIER_COLUMNS.map((c) => (INTEGERS.has(c) ? sqlNum(full[c]) : sqlText(full[c])));
    lines.push(`INSERT INTO supplier_permits (${names}) VALUES (${values.join(', ')}) ON CONFLICT(id) DO UPDATE SET ${updates} ${newerRow};`);
  }
  // The meta rows follow the same rule, judged by the stored imported_at, which is written first.
  const newerMeta = `WHERE COALESCE((SELECT value FROM supplier_import_meta WHERE key = 'imported_at'), '') <= ${sqlText(importedAt)}`;
  const keys = Object.keys(meta).sort((a, b) => (a === 'imported_at' ? -1 : b === 'imported_at' ? 1 : 0));
  for (const key of keys) {
    lines.push(`INSERT INTO supplier_import_meta (key, value) VALUES (${sqlText(key)}, ${sqlText(meta[key])}) ON CONFLICT(key) DO UPDATE SET value = excluded.value ${newerMeta};`);
  }
  return `${lines.join('\n')}\n`;
}

/** Counts for the build's printed summary (no names or addresses). */
export function tally(rows) {
  const by = (fn) => rows.reduce((acc, r) => { const k = fn(r); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  return {
    permits: rows.length,
    byGroup: by((r) => r.grp),
    parcel: by((r) => r.parcel_match),
    withOwnerPhone: rows.filter((r) => r.owner_phone).length,
    knownPermitLeads: rows.filter((r) => r.county_prospect_id).length,
    knownMailPilot: rows.filter((r) => r.mail_pilot_ref).length,
    trackedBuilder: rows.filter((r) => r.tracked_builder).length,
    licenseMatched: rows.filter((r) => r.li_license).length,
    scored: by((r) => (['remodel', 'adu', 'reroof'].includes(r.grp) ? r.score : 'n/a')),
  };
}
