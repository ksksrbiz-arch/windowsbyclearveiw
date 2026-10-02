// Pure functions for the permit-leads pipeline: no network, no clock reads except
// where `now` is passed in. The network layer is scripts/permit-leads/fetch.mjs and
// the orchestrator is scripts/build-permit-leads.mjs; both stay thin so this file
// carries the logic that tests exercise.
//
// Sources (all public): Clark County + City of Vancouver permits and assessor
// parcels (gis.clark.wa.gov ArcGIS) and WA L&I contractor licenses (data.wa.gov).
// Nothing here guesses a phone number or an email address. A value is either
// copied from one of those sources or left empty.

const DAY = 86400000;

const SUFFIX = /\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LP|LLP|LTD|THE)\b/g;
const BUSINESS = /\b(LLC|L L C|INC|CORP|CORPORATION|CO|COMPANY|LP|LLP|LTD|JV|HOMES?|HOLDINGS?|PROPERTIES|DEVELOPMENT|BUILDERS?|CONSTRUCTION|PARTNERS|ENTERPRISES)\b/;

/** Uppercase, punctuation and company suffixes removed, single-spaced. */
export function normName(value) {
  const text = String(value ?? '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(SUFFIX, ' ');
  // "D R HORTON" and "DR HORTON" are one company: join runs of single letters.
  const joined = text.split(/\s+/).filter(Boolean).reduce((out, word) => {
    if (/^[A-Z]$/.test(word) && /^[A-Z]{1,2}$/.test(out.at(-1) ?? '')) out[out.length - 1] += word;
    else out.push(word);
    return out;
  }, []);
  return joined.join(' ');
}

/** Word set of a name, for order-independent person matching ("Smith John" vs "SMITH, JOHN"). */
export function nameTokens(value) {
  return new Set(normName(value).split(' ').filter(Boolean));
}

export function sameTokens(a, b) {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (x.size < 2 || x.size !== y.size) return false;
  for (const token of x) if (!y.has(token)) return false;
  return true;
}

/** True when a person-style applicant name appears within the parcel's owner string (sole owner or one of several). */
export function applicantIsOwnerName(applicant, owner) {
  const a = nameTokens(applicant);
  const o = nameTokens(owner);
  if (a.size < 2 || looksLikeBusiness(applicant)) return false;
  for (const token of a) if (!o.has(token)) return false;
  return true;
}

export const looksLikeBusiness = (value) => BUSINESS.test(String(value ?? '').toUpperCase());

/** Assessor SitAddrs is "1616 W 31ST ST, VANCOUVER, 98660". Returns the street part only. */
export function streetOf(situs) {
  return String(situs ?? '').split(',')[0].trim();
}

/** "SUNSET VIEW ADDN #3 LOTS 3 & 4 BLK 1" -> "SUNSET VIEW ADDN". Best effort, display only. */
export function subdivisionOf(legal) {
  const text = String(legal ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const cut = text.search(/\s+(?:LOTS?|BLK|BLOCK|PHASE|TRACT|UNIT|PH\s?\d*)\b|\s#/i);
  return (cut > 3 ? text.slice(0, cut) : text).trim();
}

/** ArcGIS dates are epoch milliseconds. Returns YYYY-MM-DD, or '' for null and the 1900/2222 placeholders. */
export function isoDate(ms) {
  if (ms === null || ms === undefined || ms === '') return '';
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getUTCFullYear();
  return year >= 1990 && year <= 2100 ? date.toISOString().slice(0, 10) : '';
}

export const daysBetween = (fromIso, toIso) => Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / DAY);

const cents = (dollars) => (Number.isFinite(Number(dollars)) && Number(dollars) > 0 ? Math.round(Number(dollars) * 100) : null);
const posInt = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value)) : null);

/** Which kind of lead a permit row is, or null if it is neither. */
export function permitKind(row) {
  const type = String(row.case_type ?? '').toUpperCase();
  const work = String(row.WorkType ?? '').toUpperCase();
  const caseType = String(row.CaseType ?? '');
  if ((type === 'NHC' || type === 'SFR') && row.issued) return 'new_home';
  if (work === 'REMODEL' || work === 'ADDITION' || caseType === 'Residential Addition/Alteration') return 'homeowner';
  return null;
}

const isSingleFamily = (propertyType) => /\bSFR\b|SINGLE FAMILY/i.test(String(propertyType ?? ''));

/**
 * Deterministic "fit signals" for a homeowner remodel/addition permit. The score is
 * just how many of these are true. It is a sort key, not a probability and not a
 * price, and the weights are all equal on purpose.
 */
export function homeownerSignals({ propertyType, applicantIsOwner, workType, issued, lastSaleDate, now }) {
  const signals = [];
  if (isSingleFamily(propertyType)) signals.push('single_family');
  if (applicantIsOwner) signals.push('owner_applied');
  if (String(workType ?? '').toUpperCase() === 'ADDITION') signals.push('addition');
  if (issued && daysBetween(issued, now) <= 90) signals.push('recent_permit');
  if (lastSaleDate && daysBetween(lastSaleDate, now) <= 730) signals.push('recent_sale');
  return signals;
}

/**
 * Join one permit row to its parcel (assessor) and latest recorded sale.
 * `parcel` and `sale` may be undefined; every parcel-derived field is then empty.
 */
export function buildProspect(permit, parcel, sale, { now }) {
  const kind = permitKind(permit);
  if (!kind) return null;
  // A permit cannot be issued, received or sold after today; the county data has a few
  // typo dates (2029, 2039...) that would otherwise draw phantom months on the charts.
  const notFuture = (iso) => (iso && iso <= now ? iso : '');
  const issued = notFuture(isoDate(permit.issued));
  const received = notFuture(isoDate(permit.RecdDate));
  if (kind === 'new_home' && !issued) return null;
  const owner = String(parcel?.Owner ?? '').trim();
  const mailing = String(parcel?.OwnAddrs ?? '').trim();
  const street = streetOf(parcel?.SitAddrs);
  const applicant = String(permit.name ?? '').trim();
  const yearBuilt = Number(parcel?.Yrblt) > 1800 ? Number(parcel.Yrblt) : null;
  const saleDate = notFuture(isoDate(sale?.SaleDate));
  const applicantIsOwner = Boolean(owner && applicant && applicantIsOwnerName(applicant, owner));
  const signals = kind === 'homeowner'
    ? homeownerSignals({ propertyType: parcel?.PT1Desc, applicantIsOwner, workType: permit.WorkType, issued: issued || received, lastSaleDate: saleDate, now })
    : [];
  return {
    id: String(permit.caseno),
    kind,
    issued,
    received,
    status: String(permit.status ?? ''),
    work_type: String(permit.WorkType ?? '').trim(),
    applicant_name: applicant,
    situs_address: street,
    jurisdiction: String(parcel?.Juris ?? ''),
    property_type: String(parcel?.PT1Desc ?? '').trim(),
    subdivision: subdivisionOf(parcel?.Legal),
    year_built: yearBuilt,
    bldg_sqft: posInt(parcel?.bldgsqft),
    lot_sqft: posInt(parcel?.LotSqFt),
    owner_name: owner,
    owner_mailing: mailing,
    owner_absentee: mailing && street ? (normName(streetOf(mailing)) === normName(street) ? 0 : 1) : null,
    applicant_is_owner: applicantIsOwner ? 1 : 0,
    last_sale_date: saleDate,
    last_sale_cents: saleDate ? cents(sale?.SalePrice) : null,
    // For new homes the lot owner is the project entity (the builder or its LLC).
    entity_key: kind === 'new_home' && owner && looksLikeBusiness(owner) ? normName(owner) : '',
    signals,
    score: signals.length,
    property_id: Number(permit.sn) || null,
  };
}

/** Latest sale with a real price per property. `sales` are Recent Sales attribute rows. */
export function latestSales(sales) {
  const out = new Map();
  for (const sale of sales) {
    const date = isoDate(sale.SaleDate);
    if (!date || !(Number(sale.SalePrice) > 0)) continue;
    const key = Number(sale.prop_id);
    const current = out.get(key);
    if (!current || date > isoDate(current.SaleDate)) out.set(key, sale);
  }
  return out;
}

/** Index L&I licenses (ACTIVE only is the caller's job) for exact-name lookups. */
export function indexLicenses(licenses) {
  const byBusiness = new Map();
  const byPrincipal = [];
  for (const license of licenses) {
    const key = normName(license.businessname);
    if (key) {
      if (!byBusiness.has(key)) byBusiness.set(key, []);
      byBusiness.get(key).push(license);
    }
    if (license.primaryprincipalname) byPrincipal.push(license);
  }
  return { byBusiness, byPrincipal };
}

const newest = (licenses) => [...licenses].sort((a, b) => String(b.licenseexpirationdate ?? '').localeCompare(String(a.licenseexpirationdate ?? '')))[0];

/**
 * Find an L&I license for a builder. Order of confidence:
 *   1. the lot-owner entity's name equals an L&I business name
 *   2. an applicant's name equals an L&I business name
 *   3. an applicant's name equals a license principal's name (a person; verify)
 * Anything else is "no match", which is not proof the builder is unlicensed
 * (out-of-state builders often license under a different name).
 */
export function matchLicense({ entityName, applicants }, index) {
  const owner = index.byBusiness.get(normName(entityName));
  if (owner?.length) return { license: newest(owner), how: 'lot owner business name exact', candidates: owner.length };
  for (const applicant of applicants) {
    const hit = index.byBusiness.get(normName(applicant));
    if (hit?.length) return { license: newest(hit), how: 'applicant business name exact', candidates: hit.length };
  }
  for (const applicant of applicants) {
    if (looksLikeBusiness(applicant)) continue;
    const hits = index.byPrincipal.filter((license) => sameTokens(license.primaryprincipalname, applicant));
    if (hits.length) return { license: newest(hits), how: 'principal name (a person) - verify', candidates: hits.length };
  }
  return { license: null, how: '', candidates: 0 };
}

const top = (counter, n) => [...counter.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n).map(([k]) => k);
const tally = (counter, key) => { if (key) counter.set(key, (counter.get(key) || 0) + 1); };

/** Roll new-home prospects up to the lot-owner entity (the builder or project LLC). */
export function rollUpBuilders(prospects, licenseIndex, { now }) {
  const groups = new Map();
  for (const p of prospects) {
    if (p.kind !== 'new_home' || !p.entity_key) continue;
    if (!groups.has(p.entity_key)) groups.set(p.entity_key, []);
    groups.get(p.entity_key).push(p);
  }
  const builders = [];
  for (const [key, rows] of groups) {
    const names = new Map();
    const applicants = new Map();
    const subdivisions = new Map();
    const jurisdictions = new Map();
    const lots = new Set();
    for (const r of rows) {
      tally(names, r.owner_name);
      tally(applicants, r.applicant_name);
      tally(subdivisions, r.subdivision);
      tally(jurisdictions, r.jurisdiction);
      lots.add(r.property_id ?? r.id);
    }
    const displayName = top(names, 1)[0] || key;
    const match = matchLicense({ entityName: displayName, applicants: top(applicants, 5) }, licenseIndex);
    const issued = rows.map((r) => r.issued).filter(Boolean).sort();
    const age = (r) => (r.issued ? daysBetween(r.issued, now) : Infinity);
    const license = match.license;
    builders.push({
      entity_key: key,
      display_name: displayName,
      applicants: top(applicants, 5),
      permits: rows.length,
      lots: lots.size,
      subdivisions: top(subdivisions, 3),
      jurisdictions: top(jurisdictions, 3),
      first_issued: issued[0] || '',
      last_issued: issued.at(-1) || '',
      issued_30d: rows.filter((r) => age(r) <= 30).length,
      issued_90d: rows.filter((r) => age(r) <= 90).length,
      li_match: match.how,
      li_candidates: match.candidates,
      li_business: license?.businessname ?? '',
      li_license: license?.contractorlicensenumber ?? '',
      li_phone: license?.phonenumber ?? '',
      li_address: license ? [license.address1, license.city, [license.state, license.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '',
      li_principal: license?.primaryprincipalname ?? '',
      li_status: license?.contractorlicensestatus ?? '',
      li_expires: String(license?.licenseexpirationdate ?? '').slice(0, 10),
      li_ubi: license?.ubi ?? '',
    });
  }
  return builders.sort((a, b) => b.permits - a.permits || a.display_name.localeCompare(b.display_name));
}

// ---------- SQL output (for `wrangler d1 execute --file`) ----------

const sqlText = (value) => (value === null || value === undefined || value === '' ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`);
const sqlNum = (value) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? String(Math.trunc(Number(value))) : 'NULL');

/**
 * Whole-snapshot replace: the tables hold the latest build, not history. DDL is
 * included so the file also works on a database that has never seen these tables.
 */
export function toSql({ prospects, builders, meta, ddl, importedAt }) {
  const lines = [...ddl.map((statement) => `${statement.trim().replace(/;$/, '')};`), 'DELETE FROM permit_prospects;', 'DELETE FROM permit_builders;', 'DELETE FROM permit_import_meta;'];
  for (const p of prospects) {
    lines.push(
      `INSERT INTO permit_prospects (id, kind, issued, received, status, work_type, applicant_name, situs_address, jurisdiction, property_type, subdivision, year_built, bldg_sqft, lot_sqft, owner_name, owner_mailing, owner_absentee, applicant_is_owner, last_sale_date, last_sale_cents, entity_key, signals, score, property_id, imported_at) VALUES (` +
      [sqlText(p.id), sqlText(p.kind), sqlText(p.issued), sqlText(p.received), sqlText(p.status), sqlText(p.work_type), sqlText(p.applicant_name), sqlText(p.situs_address), sqlText(p.jurisdiction), sqlText(p.property_type), sqlText(p.subdivision), sqlNum(p.year_built), sqlNum(p.bldg_sqft), sqlNum(p.lot_sqft), sqlText(p.owner_name), sqlText(p.owner_mailing), sqlNum(p.owner_absentee), sqlNum(p.applicant_is_owner), sqlText(p.last_sale_date), sqlNum(p.last_sale_cents), sqlText(p.entity_key), sqlText(JSON.stringify(p.signals)), sqlNum(p.score), sqlNum(p.property_id), sqlText(importedAt)].join(', ') + ');',
    );
  }
  for (const b of builders) {
    lines.push(
      `INSERT INTO permit_builders (entity_key, display_name, applicants, permits, lots, subdivisions, jurisdictions, first_issued, last_issued, issued_30d, issued_90d, li_match, li_business, li_license, li_phone, li_address, li_principal, li_status, li_expires, li_ubi, imported_at) VALUES (` +
      [sqlText(b.entity_key), sqlText(b.display_name), sqlText(JSON.stringify(b.applicants)), sqlNum(b.permits), sqlNum(b.lots), sqlText(JSON.stringify(b.subdivisions)), sqlText(JSON.stringify(b.jurisdictions)), sqlText(b.first_issued), sqlText(b.last_issued), sqlNum(b.issued_30d), sqlNum(b.issued_90d), sqlText(b.li_match), sqlText(b.li_business), sqlText(b.li_license), sqlText(b.li_phone), sqlText(b.li_address), sqlText(b.li_principal), sqlText(b.li_status), sqlText(b.li_expires), sqlText(b.li_ubi), sqlText(importedAt)].join(', ') + ');',
    );
  }
  for (const [key, value] of Object.entries(meta)) {
    lines.push(`INSERT INTO permit_import_meta (key, value) VALUES (${sqlText(key)}, ${sqlText(value)});`);
  }
  return lines.join('\n') + '\n';
}
