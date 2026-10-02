// Permit-leads pipeline and Analytics endpoint. No network: the paging logic runs against a
// fake fetch, and the generated SQL is executed on a real SQL engine (node:sqlite).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createD1 } from './_lib/d1-sqlite.mjs';
import { PERMIT_LEAD_DDL } from '../functions/internal/_lib/permit-leads.mjs';
import * as permitApi from '../functions/internal/api/permit-leads.js';
import { arcgisAll, fetchPermits } from './permit-leads/fetch.mjs';
import {
  applicantIsOwnerName, buildProspect, homeownerSignals, indexLicenses, isoDate, latestSales, looksLikeBusiness, matchLicense,
  normName, permitKind, rollUpBuilders, sameTokens, subdivisionOf, toSql,
} from './permit-leads/lib.mjs';

const pass = (message) => console.log(`PASS: ${message}`);
const NOW = '2026-10-02';
const ms = (iso) => Date.parse(`${iso}T00:00:00Z`);

// ---------- names ----------
assert.equal(normName('D R Horton-Inc Portland'), normName('DR HORTON INC - PORTLAND'), 'initials spaced or not are one company');
assert.equal(normName('Holt Homes LLC'), 'HOLT HOMES');
assert.ok(sameTokens('Smith John', 'SMITH, JOHN'), 'person names match regardless of order and punctuation');
assert.ok(!sameTokens('Smith', 'SMITH'), 'a single word is never a person match');
assert.ok(applicantIsOwnerName('Smith John', 'SMITH JOHN & SMITH MARY'), 'one of several co-owners applied');
assert.ok(!applicantIsOwnerName('Acme Builders LLC', 'ACME BUILDERS LLC'), 'a company applicant is a contractor, not the homeowner');
assert.ok(!applicantIsOwnerName('Jones Pat', 'SMITH JOHN'));
assert.ok(looksLikeBusiness('Mill Creek JV LLC') && looksLikeBusiness('Pacific Lifestyle Homes Inc') && !looksLikeBusiness('Kangas Tye & Kangas Jessie'));
assert.equal(subdivisionOf('SUNSET VIEW ADDN       #3 LOTS 3 & 4 BLK 1'), 'SUNSET VIEW ADDN');
assert.equal(subdivisionOf('HEARTWOOD PH1 LOT 12'), 'HEARTWOOD');
assert.equal(subdivisionOf(null), '');
assert.equal(isoDate(ms('2026-07-09')), '2026-07-09');
assert.equal(isoDate(Date.UTC(1900, 0, 1)), '', 'the 1900 placeholder is not a date');
assert.equal(isoDate(Date.UTC(2222, 2, 16)), '', 'the 2222 placeholder is not a date');
assert.equal(isoDate(null), '');
pass('names, subdivisions and placeholder dates are normalized');

// ---------- permit kinds and signals ----------
assert.equal(permitKind({ case_type: 'NHC', issued: ms('2026-08-01') }), 'new_home');
assert.equal(permitKind({ case_type: 'NHC', issued: null }), null, 'a new-home permit that is not issued yet is not counted');
assert.equal(permitKind({ case_type: 'RES', WorkType: 'REMODEL' }), 'homeowner');
assert.equal(permitKind({ case_type: 'RES', WorkType: 'ADDITION' }), 'homeowner');
assert.equal(permitKind({ case_type: 'MPE', WorkType: 'ELECTRICAL', issued: ms('2026-08-01') }), null, 'electrical and plumbing permits are not leads');
assert.deepEqual(
  homeownerSignals({ propertyType: 'SFR UNIT NOT SHARING STRUCTURE', applicantIsOwner: true, workType: 'ADDITION', issued: '2026-09-20', lastSaleDate: '2025-01-01', now: NOW }),
  ['single_family', 'owner_applied', 'addition', 'recent_permit', 'recent_sale'],
);
assert.deepEqual(homeownerSignals({ propertyType: 'OFFICE BLDG', workType: 'REMODEL', issued: '2025-01-01', lastSaleDate: '2020-01-01', now: NOW }), [], 'old permit, commercial, old sale: no signals');
pass('permit kinds and fit signals are deterministic');

// ---------- prospects ----------
const parcel = { serial_num: 100, Owner: 'SMITH JOHN & SMITH MARY', OwnAddrs: '9 ELSEWHERE RD, SEATTLE, WA, 98101', SitAddrs: '123 N MAIN ST, VANCOUVER, 98660', Yrblt: 1975, PT1Desc: 'SFR UNIT NOT SHARING STRUCTURE WITH OTHER USES', Juris: 'Vancouver', bldgsqft: 1800, LotSqFt: 7000, Legal: 'OAK GROVE LOT 4' };
const remodel = buildProspect({ caseno: 'RES-1', case_type: 'RES', WorkType: 'REMODEL', status: 'Open', issued: ms('2026-09-20'), name: 'Smith John', sn: 100 }, parcel, { SaleDate: ms('2025-06-01'), SalePrice: 410000 }, { now: NOW });
assert.equal(remodel.kind, 'homeowner');
assert.equal(remodel.situs_address, '123 N MAIN ST');
assert.equal(remodel.owner_absentee, 1, 'owner mailing address differs from the property');
assert.equal(remodel.applicant_is_owner, 1);
assert.equal(remodel.last_sale_cents, 41000000, 'sale price is stored in integer cents');
assert.deepEqual(remodel.signals, ['single_family', 'owner_applied', 'recent_permit', 'recent_sale']);
assert.equal(remodel.score, 4);
assert.equal(buildProspect({ caseno: 'N9', case_type: 'NHC', issued: ms('2029-04-01'), sn: 1 }, undefined, undefined, { now: NOW }), null, 'a new-home permit "issued" in the future is a typo, not a lead');
assert.equal(buildProspect({ caseno: 'R9', case_type: 'RES', WorkType: 'REMODEL', issued: ms('2039-01-01'), RecdDate: ms('2026-09-01'), sn: 1 }, undefined, undefined, { now: NOW }).issued, '', 'a future issue date is dropped but the permit is kept');
const noParcel = buildProspect({ caseno: 'RES-2', case_type: 'RES', WorkType: 'REMODEL', issued: ms('2026-09-20'), name: 'Nobody', sn: 999 }, undefined, undefined, { now: NOW });
assert.equal(noParcel.situs_address, '');
assert.equal(noParcel.owner_absentee, null, 'absentee is unknown without a parcel, not false');
assert.equal(noParcel.year_built, null);
const sales = latestSales([{ prop_id: 1, SaleDate: ms('2020-01-01'), SalePrice: 100 }, { prop_id: 1, SaleDate: ms('2024-01-01'), SalePrice: 200 }, { prop_id: 1, SaleDate: ms('2025-01-01'), SalePrice: 0 }, { prop_id: 2, SaleDate: ms('2024-01-01'), SalePrice: 0 }]);
assert.equal(sales.get(1).SalePrice, 200, 'latest sale with a real price');
assert.ok(!sales.has(2), 'a zero-price transfer is not a sale');
pass('permits join to parcels and sales without inventing missing values');

// ---------- builders ----------
const lot = (caseno, owner, applicant, issued, sub, sn) => buildProspect(
  { caseno, case_type: 'NHC', status: 'Open', issued: ms(issued), name: applicant, sn },
  { Owner: owner, SitAddrs: `${sn} LOT ST, VANCOUVER, 98685`, Juris: 'Clark County', PT1Desc: 'UNUSED PLATTED LAND.', Legal: `${sub} LOT ${sn}` }, undefined, { now: NOW },
);
const prospects = [
  lot('N1', 'D R HORTON INC - PORTLAND', 'DR Horton-Inc Portland', '2026-09-25', 'KUNZE FARMS', 1),
  lot('N2', 'DR HORTON INC - PORTLAND', 'DR Horton-Inc Portland', '2026-08-01', 'KUNZE FARMS', 2),
  lot('N3', 'DR HORTON INC - PORTLAND', 'Iron Oak Engineers', '2026-05-01', 'FOUR CREEKS', 3),
  lot('N4', 'ACME BUILDERS LLC', 'Acme Permits', '2026-09-30', 'OAK GROVE', 4),
  lot('N5', 'KANGAS TYE & KANGAS JESSIE', 'Robin Pierce', '2026-09-01', 'HILLSIDE', 5),
];
assert.equal(prospects[4].entity_key, '', 'a lot owned by a person is not rolled up as a builder');
const licenses = indexLicenses([
  { businessname: 'D R HORTON INC-PORTLAND', contractorlicensenumber: 'DRHORIP1', phonenumber: '5034767447', address1: '1 Main', city: 'Portland', state: 'OR', zip: '97201', primaryprincipalname: 'DOE, JANE', contractorlicensestatus: 'ACTIVE', licenseexpirationdate: '2027-01-01T00:00:00.000', ubi: '1' },
  { businessname: 'Zed Construction LLC', contractorlicensenumber: 'ZED1', primaryprincipalname: 'PIERCE, ROBIN', contractorlicensestatus: 'ACTIVE', licenseexpirationdate: '2027-01-01T00:00:00.000' },
]);
const builders = rollUpBuilders(prospects, licenses, { now: NOW });
assert.equal(builders.length, 2, 'spaced and unspaced "D R Horton" are one builder entity');
assert.equal(builders[0].permits, 3);
assert.equal(builders[0].issued_30d, 1);
assert.equal(builders[0].issued_90d, 2);
assert.deepEqual(builders[0].subdivisions.sort(), ['FOUR CREEKS', 'KUNZE FARMS']);
assert.equal(builders[0].li_license, 'DRHORIP1');
assert.equal(builders[0].li_match, 'lot owner business name exact');
assert.equal(builders[1].li_license, '', 'no license found is reported as empty, not guessed');
assert.equal(builders[1].li_phone, '');
const person = matchLicense({ entityName: 'NOBODY LLC', applicants: ['Pierce Robin'] }, licenses);
assert.equal(person.how, 'principal name (a person) - verify', 'a person-name match is labelled as needing verification');
assert.equal(matchLicense({ entityName: 'NOBODY LLC', applicants: ['Acme Permits'] }, licenses).license, null);
pass('builders roll up by lot-owner entity and licenses match only on exact names');

// ---------- SQL snapshot + API on a real SQL engine ----------
const tricky = buildProspect({ caseno: "RES-3", case_type: 'RES', WorkType: 'ADDITION', status: 'Open', issued: ms('2026-09-28'), name: "O'Brien Pat", sn: 7 },
  { Owner: "O'BRIEN PAT", OwnAddrs: '5 OAK ST, VANCOUVER, WA, 98660', SitAddrs: '5 OAK ST, VANCOUVER, 98660', Yrblt: 2013, PT1Desc: 'SFR UNIT', Juris: 'Vancouver' }, undefined, { now: NOW });
assert.equal(tricky.applicant_is_owner, 1);
assert.equal(tricky.owner_absentee, 0);
const all = [remodel, noParcel, tricky, ...prospects];
const sql = toSql({ prospects: all, builders, meta: { imported_at: '2026-10-02T12:00:00.000Z', window_start: '2026-04-02', window_end: NOW }, ddl: PERMIT_LEAD_DDL, importedAt: '2026-10-02T12:00:00.000Z' });
assert.ok(sql.includes("O''Brien"), 'single quotes are escaped');
const db = createD1();
const ask = async (query = '', env = { QUOTES_DB: db }, method = 'GET') => permitApi.onRequest({ request: new Request(`https://example.test/internal/api/permit-leads${query}`, { method }), env });

assert.deepEqual(await (await ask()).json(), { status: 'empty' }, 'a database that was never loaded reports no data yet');
await db.exec(sql);
await db.exec(sql); // reloading replaces the snapshot rather than duplicating it
const summary = await (await ask()).json();
assert.equal(summary.status, 'ok');
assert.equal(summary.meta.window_end, NOW);
assert.equal(summary.homeowners.total, 3);
assert.equal(summary.newHomes.permits, 5);
assert.equal(summary.newHomes.entities, 2);
assert.equal(summary.newHomes.licenseMatched, 1);
assert.equal(summary.builders[0].name, 'DR HORTON INC - PORTLAND', 'display name is the most common owner spelling');
assert.equal(summary.builders[0].license.number, 'DRHORIP1');
assert.equal(summary.builders[1].license, null);
assert.equal(summary.homeowners.built2011to2016, 1);
assert.ok(summary.homeowners.signals.find((s) => s.key === 'owner_applied').value >= 2);
const list = await (await ask('?view=homeowners&limit=2')).json();
assert.equal(list.rows.length, 2, 'limit is honoured');
assert.ok(list.rows[0].score >= list.rows[1].score, 'best fit first');
assert.equal(list.rows[0].absentee === true || list.rows[0].absentee === false, true);
assert.equal((await ask('?view=nope')).status, 400);
assert.equal((await ask('', {})).status, 200);
assert.deepEqual(await (await ask('', {})).json(), { status: 'unavailable' }, 'no database binding is reported, not thrown');
assert.equal((await ask('', { QUOTES_DB: db }, 'POST')).status, 405);
assert.equal((await ask('?view=homeowners&limit=99999')).status, 200, 'an oversized limit is clamped, not an error');
pass('the snapshot loads idempotently and the endpoint reads it, fail-soft');

// ---------- paging against a fake ArcGIS ----------
{
  const calls = [];
  const feature = (n) => ({ attributes: { OBJECTID: n, caseno: `C${n}` } });
  const fakeFetch = async (url, init) => {
    const body = new URLSearchParams(init?.body ?? '');
    calls.push({ url, offset: Number(body.get('resultOffset')), where: body.get('where'), geometry: body.get('returnGeometry') });
    const offset = Number(body.get('resultOffset'));
    const features = offset === 0 ? Array.from({ length: 2000 }, (_, i) => feature(i)) : [feature(2000)];
    return { ok: true, json: async () => ({ features }) };
  };
  const rows = await arcgisAll(fakeFetch, 'https://example.test/q', { where: '1=1' });
  assert.equal(rows.length, 2001, 'a full first page triggers a second request');
  assert.deepEqual(calls.map((c) => c.offset), [0, 2000]);
  assert.ok(calls.every((c) => c.geometry === 'false'), 'geometry is never requested');
  calls.length = 0;
  const permits = await fetchPermits(async (url, init) => {
    const where = new URLSearchParams(init.body).get('where');
    calls.push(where);
    return { ok: true, json: async () => ({ features: url.includes('/4/') ? [{ attributes: { caseno: 'A', status: 'Closed', issued: 1 } }] : [{ attributes: { caseno: 'A', RecdDate: 2, status: 'Open', issued: null } }] }) };
  }, '2026-04-02');
  assert.ok(calls.some((w) => w.includes("timestamp '2026-04-02 00:00:00'")), 'the window is sent as a date literal');
  assert.equal(permits.length, 1, 'the same case from both layers is one permit');
  assert.equal(permits[0].RecdDate, 2);
  assert.equal(permits[0].issued, 1, 'a null in the active layer does not erase a value from the history layer');
  pass('layers are paged to the end, merged by case number, and read without geometry');
}

// ---------- the page, the docs and the repo hygiene ----------
{
  const page = fs.readFileSync('src/pages/internal/analytics.astro', 'utf8');
  const endpoint = fs.readFileSync('functions/internal/api/permit-leads.js', 'utf8');
  const readme = fs.readFileSync('internal/README.md', 'utf8');
  const middleware = fs.readFileSync('functions/internal/_middleware.js', 'utf8');
  const gitignore = fs.readFileSync('.gitignore', 'utf8');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(page), 'permit data is written with textContent only');
  assert.ok(/permit-leads/.test(page) && /view=homeowners/.test(page), 'the page reads the endpoint, and fetches homeowner rows only on request');
  assert.ok(/private, no-store/.test(endpoint), 'the endpoint is never cached');
  assert.ok(!/permit-leads/.test(middleware), 'the endpoint is not on a public path list');
  assert.ok(/^data\/permit-leads\/$/m.test(gitignore), 'snapshots with owner names are git-ignored');
  assert.ok(/build:permit-leads/.test(readme) && /wrangler d1 execute QUOTES_DB --remote --file=data\/permit-leads/.test(readme), 'the refresh steps are documented');
  assert.ok(!/api\.(ahrefs|openseo)/.test(endpoint), 'no paid API is called');
  pass('the page is textContent-only, the endpoint is internal and uncached, and snapshots stay out of git');
}

console.log('Permit-leads checks passed.');
