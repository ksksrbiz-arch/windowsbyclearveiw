// Supplier permit list: report validation, parcel/builder/license joins, fit signals, the merge SQL on a real SQL
// engine, the endpoint, the page, and the privacy guards. No network: the county and L&I endpoints are a fake fetch,
// and every name, address and phone number below is made up. (The PDF parser, scripts/supplier-permits/
// parse-construction-monitor.py, needs a licensed report to run, so it is checked by its own totals self-check, not here.)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createD1 } from './_lib/d1-sqlite.mjs';
import * as api from '../functions/internal/api/supplier-permits.js';
import { onRequest as gate } from '../functions/internal/_middleware.js';
import {
  CSV_HEADER, GROUPS, GROUP_KEYS, SCORED_GROUPS, SIGNAL_LABELS, SUPPLIER_COLUMNS, SUPPLIER_DDL, cleanGroup, groupFor, listRow, metroRankFor, nameWords, readSupplierCsv, readSupplierList, readSupplierSummary, toSupplierCsv,
} from '../functions/internal/_lib/supplier-permits.mjs';
import { CASE_NUMBER, SUPPLIER_LICENSE_FIELDS, SUPPLIER_PARCEL_FIELDS, fetchCasePermits, fetchParcelCandidates, fetchSupplierLicenses, fetchSupplierParcels, likeLiteral } from './supplier-permits/fetch.mjs';
import { fetchParcels } from './permit-leads/fetch.mjs';
import {
  addressKey, assertPrivateOutput, enrichRow, indexMailPilot, indexProspects, lookupStreet, normalizeEntries, ownerMatchesAssessor, parcelChoice, parseCsv, relatedBuilderFor, reportDate, supplierSignals, tally, toSql, trackedBuilderFor,
} from './supplier-permits/lib.mjs';
import { buildSupplierRows } from './supplier-permits/pipeline.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const pass = (message) => console.log(`PASS: ${message}`);
const NOW = '2026-10-09';
const ms = (iso) => Date.parse(`${iso}T00:00:00Z`);

// ---------- groups ----------
assert.equal(groupFor({ category: 'Residential', subcategory: 'Single Family Homes' }), 'new_home');
assert.equal(groupFor({ category: 'Residential', subcategory: 'Res Rmdl, Addn, Int Fin' }), 'remodel');
assert.equal(groupFor({ category: 'Residential', subcategory: 'Accessory Dwelling Units' }), 'adu');
assert.equal(groupFor({ category: 'Residential', subcategory: 'Reroof Residential' }), 'reroof');
assert.equal(groupFor({ category: 'Residential', subcategory: 'Garages & Carports' }), 'accessory');
assert.equal(groupFor({ category: 'Residential', subcategory: 'Duplexes & Twin Homes' }), 'multifamily');
assert.equal(groupFor({ category: 'Residential', subcategory: 'Demolition' }), 'site_work');
assert.equal(groupFor({ category: 'Residential', subcategory: 'Something New' }), 'other', 'an unknown residential section is "other", never silently scored');
assert.equal(groupFor({ category: 'Commercial', subcategory: 'Single Family Homes' }), 'commercial', 'commercial wins over a sub-heading');
assert.equal(groupFor({}), 'other');
assert.equal(cleanGroup(' Remodel '), 'remodel');
assert.equal(cleanGroup('x; DROP TABLE'), '', 'a group filter is one of the known keys or nothing');
assert.deepEqual(SCORED_GROUPS, ['remodel', 'adu', 'reroof']);
assert.ok(SCORED_GROUPS.every((g) => GROUP_KEYS.includes(g)) && GROUPS.every((g) => g.label));
pass('permit sections map to groups, and only the three homeowner-style groups are scored');

// ---------- the report's own fields ----------
assert.equal(reportDate('10/05/2026'), '2026-10-05');
assert.equal(reportDate('02/30/2026'), null, 'a date that does not exist is rejected');
assert.equal(reportDate('2026-10-05'), null);
assert.equal(reportDate(''), null);

const contact = (role, lines, extra = {}) => ({ role, lines, phone: null, fax: null, lic: null, ...extra });
const entry = (over = {}) => ({
  page: 4, section: 'Approved', county: 'Clark County', category: 'Residential', sub: 'Single Family Homes', type: 'New Single Family Home', valuation: 350000,
  pmt: 'NHC-2026-90001', street: '100 NE TESTING ST', city: 'Vancouver', state: 'WA', zip: '98660', date: '10/05/2026', sf: 2100, extra: [], contacts: [], ...over,
});
const report = () => ({
  source: 'Construction Monitor',
  edition: { week: 40, year: 2026, start: '2026-10-01', end: '2026-10-07', region: 'Portland/Vancouver/Salem' },
  report: { residential: 5, commercial: 1, solar: 0 },
  ranking: [{ rank: 3, name: 'Testco Homes', homes: 40, valueCents: 1 }, { rank: 8, name: 'Heritage Homes Of', homes: 20, valueCents: 1 }, { rank: 9, name: 'HSR', homes: 12, valueCents: 1 }],
  entries: [
    entry({ valuation: 400000, date: '10/06/2026', contacts: [contact('Owner', ['TESTCO HOMES LLC', 'PO BOX 1', 'PORTLAND OR 97201'], { phone: '503-555-0100' })] }),
    entry({ pmt: 'NHC-2026-90002', street: '200 NE TESTING ST', date: '10/03/2026', valuation: 350000, contacts: [contact('Owner', ['HSR 124 LLC', 'No Address Given'])] }),
    entry({
      pmt: 'RES-390001', sub: 'Res Rmdl, Addn, Int Fin', type: 'Residential Addition', street: '300 NE Testing St # 5', valuation: 80000, date: '10/05/2026',
      contacts: [
        contact('Owner', ['SMITH JOHN', '300 NE TESTING ST', 'VANCOUVER WA 98660'], { phone: '360-555-0101' }),
        contact('Contractor', ['ACME BUILDERS LLC', '1 Builder Way', 'VANCOUVER WA 98660'], { phone: '360-555-0102', lic: 'ACMEBBL999' }),
      ],
    }),
    entry({ pmt: 'RES-390002', section: 'Pending', sub: 'Res Rmdl, Addn, Int Fin', type: 'Residential Alteration', street: '400 NE TESTING ST', valuation: 25000, date: '10/08/2026', contacts: [contact('Owner', ['DOE JANE'])] }),
    entry({
      pmt: 'CMI-390003', category: 'Commercial', sub: 'Commercial Alterations', type: 'Tenant Improvement', street: 'No Address Given', valuation: 900000, date: '10/02/2026',
      contacts: [contact('Contractor', ['BIG BOX CONSTRUCTION INC'], { lic: 'BIGBOXC111' })],
    }),
    entry({ pmt: 'RES-390004', sub: 'Accessory Dwelling Units', type: 'Accessory Dwelling Unit', street: '500 NE TESTING ST', valuation: 150000, date: '09/01/2026', contacts: [contact('Applicant', ["ROE O'RICHARD"])] }),
    entry({ pmt: 'PRT-2026-1', county: 'Multnomah County', contacts: [] }),
  ],
});

{
  const n = normalizeEntries(report());
  assert.equal(n.edition.label, '2026-W40');
  assert.equal(n.rows.length, 6);
  assert.equal(n.skipped, 1, 'another county is skipped, not loaded');
  const [home, hsr, remodel, pending, commercial, adu] = n.rows;
  assert.equal(home.grp, 'new_home');
  assert.equal(home.builder.name, 'TESTCO HOMES LLC', 'on a new home with no contractor the listed owner is the builder');
  assert.equal(home.builder.role, 'Owner (no contractor listed)');
  assert.equal(home.builder.license, '');
  assert.equal(home.noContractor, true);
  assert.equal(home.owner.mailing, 'PO BOX 1, PORTLAND OR 97201');
  assert.equal(home.valuationCents, 40000000);
  assert.equal(hsr.owner.mailing, '', '"No Address Given" is not an address');
  assert.equal(remodel.grp, 'remodel');
  assert.equal(remodel.builder.name, 'ACME BUILDERS LLC');
  assert.equal(remodel.builder.license, 'ACMEBBL999');
  assert.equal(remodel.builder.phone, '360-555-0102');
  assert.equal(remodel.owner.phone, '360-555-0101');
  assert.equal(remodel.noContractor, false);
  assert.equal(pending.section, 'Pending');
  assert.equal(pending.builder.name, '', 'a remodel with no contractor does not borrow the owner as builder');
  assert.equal(commercial.street, '', '"No Address Given" is not a street');
  assert.equal(commercial.grp, 'commercial');
  assert.equal(adu.owner.name, "ROE O'RICHARD", 'with no owner listed the applicant stands in');
  assert.deepEqual(adu.roles, ['Applicant']);

  const bad = (mutate, pattern) => { const r = report(); mutate(r); assert.throws(() => normalizeEntries(r), pattern); };
  bad((r) => { r.entries = []; }, /no entries/);
  bad((r) => { r.edition = {}; }, /edition/);
  bad((r) => { r.entries[1].pmt = ''; }, /no permit number/);
  bad((r) => { r.entries[1].pmt = r.entries[0].pmt; }, /appears twice/);
  bad((r) => { r.entries[0].section = 'Closed'; }, /Approved or Pending/);
  bad((r) => { r.entries[0].date = '13/45/2026'; }, /MM\/DD\/YYYY/);
  bad((r) => { r.entries[0].valuation = 'lots'; }, /not a dollar amount/);
  assert.doesNotThrow(() => normalizeEntries({ ...report(), entries: [report().entries[0]] }));
  assert.equal(normalizeEntries({ ...report(), entries: [entry({ date: null, valuation: null })] }).rows[0].permitDate, null, 'a missing date and value stay missing');
  pass('the parsed report is validated, junk addresses are dropped, and a new home without a contractor falls back to its owner');
}

// ---------- addresses and parcels ----------
assert.equal(lookupStreet('300 NE Testing St # 5'), '300 NE TESTING ST');
assert.equal(lookupStreet('300 NE Testing St Apt 2B'), '300 NE TESTING ST');
assert.equal(lookupStreet('300 NE Testing St | Lot 4'), '300 NE TESTING ST', 'a second address line is dropped');
assert.equal(lookupStreet('No Address Given'), '', 'a street must start with a number');
assert.equal(addressKey('1616 West 31st Street'), addressKey('1616 W 31ST ST'), 'directions and suffixes are standardized');
assert.notEqual(addressKey('1616 W 31ST ST'), addressKey('1616 E 31ST ST'));
const P = (serial, street, extra = {}) => ({ serial_num: serial, SitAddrs: `${street}, VANCOUVER, 98660`, Owner: 'X', ...extra });
assert.deepEqual(parcelChoice([], { street: '1 A ST', zip: '98660' }), { parcel: null, how: 'none' });
assert.deepEqual(parcelChoice(undefined, { street: '1 A ST' }), { parcel: null, how: 'none' });
assert.equal(parcelChoice([P(1, '1 A ST')], { street: '1 A ST', zip: '98660' }).how, 'address exact');
assert.equal(parcelChoice([P(1, '1 A ST #5')], { street: '1 A ST', zip: '98660' }).how, 'address exact', 'a unit number is ignored on both sides');
assert.equal(parcelChoice([P(1, '1 A ST BLDG 2')], { street: '1 A ST', zip: '98660' }).how, 'address close', 'the same street followed by extra words is "close", and says so');
assert.equal(parcelChoice([P(1, '1 A STATION RD')], { street: '1 A ST', zip: '98660' }).how, 'none', 'a longer street name that merely starts the same is not the street');
assert.equal(parcelChoice([P(1, '1 A ST BLDG 2'), P(2, '1 A ST BLDG 3')], { street: '1 A ST', zip: '98660' }).how, 'ambiguous');
assert.equal(parcelChoice([P(1, '1 A ST')], { street: 'No Address Given', zip: '98660' }).how, 'none');
assert.equal(parcelChoice([P(1, '1 A ST'), P(2, '1 A ST')], { street: '1 A ST', zip: '98660' }).how, 'ambiguous', 'two parcels at one address are never guessed between');
assert.equal(parcelChoice([P(1, '1 A ST'), P(2, '1 A STREET EXTRA')], { street: '1 A ST', zip: '98660' }).parcel.serial_num, 1, 'an exact street beats a longer one');
assert.equal(parcelChoice([P(1, '1 A ST #5'), P(2, '1 A ST #6')], { street: '1 A ST', zip: '98660' }).how, 'ambiguous');
assert.equal(parcelChoice([{ ...P(1, '1 A ST'), SitAddrs: '1 A ST, CAMAS, 98607' }, P(2, '1 A ST')], { street: '1 A ST', zip: '98660' }).parcel.serial_num, 2, 'the permit ZIP picks between same-numbered streets in different cities');
pass('addresses are compared in a standard form and an unclear match is left blank');

// ---------- builders ----------
const tracked = [{ entity_key: 'TESTCO HOMES', display_name: 'TESTCO HOMES LLC' }, { entity_key: 'HSR 121', display_name: 'HSR 121 LLC' }, { entity_key: 'RICHMOND AMERICAN HOMES OF WASHINGTON', display_name: 'RICHMOND AMERICAN HOMES OF WASHINGTON INC' }];
assert.equal(trackedBuilderFor('Testco Homes, L.L.C.', tracked), 'TESTCO HOMES LLC', 'punctuation and suffixes do not matter');
assert.equal(trackedBuilderFor('Testco Construction', tracked), '');
assert.equal(trackedBuilderFor('', tracked), '');
assert.equal(trackedBuilderFor('Richmond American Homes Of', tracked), 'RICHMOND AMERICAN HOMES OF WASHINGTON INC', 'the report cuts long names off; a cut-off name that starts a tracked one matches');
assert.equal(trackedBuilderFor('Testco', tracked), '', 'a short name that merely starts a tracked one does not match');
assert.equal(trackedBuilderFor('HSR 124 LLC', tracked), '', 'a number makes it a different entity');
assert.equal(relatedBuilderFor('HSR 124 LLC', tracked), 'HSR 121 LLC', 'same name apart from a number is flagged as related');
assert.equal(relatedBuilderFor('HSR 121 LLC', tracked), '', 'an exact match is not "related"');
assert.equal(relatedBuilderFor('Testco Homes', tracked), '');
const ranking = [
  { rank: 1, name: 'DR Horton', homes: 100 }, { rank: 2, name: 'Pacific Lifestyle', homes: 60 }, { rank: 3, name: 'Heritage Homes Of', homes: 20 },
  { rank: 7, name: 'Holt Homes', homes: 15 }, { rank: 12, name: 'Holt Homes', homes: 9 }, { rank: 20, name: 'Pacific', homes: 4 },
];
assert.deepEqual(metroRankFor('D R HORTON INC - PORTLAND', ranking), { rank: 1, homes: 100, rows: 1 });
assert.deepEqual(metroRankFor('Pacific Lifestyle Homes', ranking), { rank: 2, homes: 60, rows: 1 }, 'the printed (short) name starts the builder\'s name');
assert.deepEqual(metroRankFor('Pacific', ranking), { rank: 20, homes: 4, rows: 1 }, 'a one-word row only matches an exactly one-word name');
assert.deepEqual(metroRankFor('Heritage Homes LLC', ranking), { rank: 3, homes: 20, rows: 1 });
assert.deepEqual(metroRankFor('Holt Homes LLC', ranking), { rank: 7, homes: 24, rows: 2 }, 'two ranking rows for one company: homes add up, the best rank is shown');
assert.equal(metroRankFor('Unknown Builders', ranking), null);
assert.equal(metroRankFor('', ranking), null);
assert.equal(metroRankFor('DR Horton', null), null);
assert.deepEqual(nameWords('Smith & Sons, Inc.'), ['SMITH', 'SONS']);
assert.equal(ownerMatchesAssessor('SMITH JOHN', 'SMITH JOHN & SMITH MARY'), 1);
assert.equal(ownerMatchesAssessor('Smith, John', 'JOHN SMITH'), 1);
assert.equal(ownerMatchesAssessor('JONES PAT', 'SMITH JOHN'), 0);
assert.equal(ownerMatchesAssessor('', 'SMITH JOHN'), null);
assert.equal(ownerMatchesAssessor('SMITH JOHN', ''), null);
pass('builders match on whole names, cut-off names and numbered entities are handled, and the metro ranking is read by name');

// ---------- fit signals ----------
const sig = (over = {}) => supplierSignals({ group: 'remodel', propertyType: 'SFR UNIT', noContractor: true, permitType: 'Residential Addition', permitDate: '2026-10-05', lastSaleDate: '2025-06-01', now: NOW, ...over });
assert.deepEqual(sig(), ['single_family', 'no_contractor', 'addition', 'recent_permit', 'recent_sale']);
assert.deepEqual(sig({ group: 'new_home' }), [], 'new homes, commercial and the rest are not scored');
assert.deepEqual(sig({ group: 'commercial' }), []);
assert.ok(!sig({ noContractor: false }).includes('no_contractor'));
assert.ok(!sig({ propertyType: 'CONDO' }).includes('single_family'));
assert.ok(sig({ permitType: 'ADU' }).includes('addition') && sig({ permitType: 'Guest House' }).includes('addition'));
assert.ok(!sig({ permitType: 'Residential Alteration' }).includes('addition'));
assert.ok(sig({ permitDate: '2026-07-11' }).includes('recent_permit'), '90 days is inside');
assert.ok(!sig({ permitDate: '2026-07-10' }).includes('recent_permit'), '91 days is outside');
assert.ok(!sig({ permitDate: '2026-10-20' }).includes('recent_permit'), 'a permit dated after the pull is not recent');
assert.ok(sig({ lastSaleDate: '2024-10-10' }).includes('recent_sale') && !sig({ lastSaleDate: '2024-10-08' }).includes('recent_sale'));
assert.ok(!sig({ lastSaleDate: '' }).includes('recent_sale'));
assert.deepEqual(Object.keys(SIGNAL_LABELS), ['single_family', 'no_contractor', 'addition', 'recent_permit', 'recent_sale']);
pass('fit signals are the same five checks, equal weight, on the three homeowner-style groups only');

// ---------- csv reader ----------
assert.deepEqual(parseCsv('a,b\r\n1,"x, ""y"""\n\n2,"line\nbreak"\n'), [{ a: '1', b: 'x, "y"' }, { a: '2', b: 'line\nbreak' }], 'quotes, embedded commas, blank lines and line breaks');
assert.deepEqual(parseCsv(''), []);
assert.deepEqual(parseCsv('a,b\n1'), [{ a: '1', b: '' }]);
pass('the snapshot CSV reader handles quoting');

// ---------- the county and L&I sources, as a fake fetch ----------
const CASES = [{ caseno: 'NHC-2026-90001', sn: 1001 }, { caseno: 'RES-390099', sn: 9 }];
const PARCELS = [
  { serial_num: 1001, Owner: 'TESTCO HOMES LLC', OwnAddrs: 'PO BOX 1, PORTLAND, OR, 97201', SitAddrs: '100 NE TESTING ST, VANCOUVER, 98660', Yrblt: 0, PT1Desc: 'VACANT LAND', Juris: 'Vancouver', bldgsqft: 0, LotSqFt: 5000, Legal: 'TESTING ESTATES LOT 4 BLK 1', LandVal: 100000, BldVl: 0, TaxTotVal: 100000, zn_abrev: 'R-6      ' },
  { serial_num: 2001, Owner: 'SMITH JOHN', OwnAddrs: '999 SE ELSEWHERE AVE, PORTLAND, OR, 97201', SitAddrs: '300 NE TESTING ST, VANCOUVER, 98660', Yrblt: 1985, PT1Desc: 'SFR UNIT', Juris: 'Vancouver', bldgsqft: 1800, LotSqFt: 7000, Legal: 'TESTING ESTATES LOT 9', LandVal: 150000, BldVl: 250000, TaxTotVal: 400000, zn_abrev: 'R-6' },
  { serial_num: 3001, Owner: 'HSR 124 LLC', OwnAddrs: '2 DEV WAY, VANCOUVER, WA, 98660', SitAddrs: '200 NE TESTING ST, VANCOUVER, 98660', Yrblt: 0, PT1Desc: 'VACANT LAND', Juris: 'Vancouver', bldgsqft: 0, LotSqFt: 4000, Legal: '', LandVal: 90000, BldVl: 0, TaxTotVal: 90000, zn_abrev: 'R-6' },
  { serial_num: 4001, Owner: 'DOE JANE', OwnAddrs: '400 NE TESTING ST, VANCOUVER, WA, 98660', SitAddrs: '400 NE TESTING ST, VANCOUVER, 98660', Yrblt: 1990, PT1Desc: 'SFR UNIT', Juris: 'Vancouver', bldgsqft: 1500, LotSqFt: 6000, Legal: '', LandVal: 1, BldVl: 1, TaxTotVal: 2, zn_abrev: 'R-6' },
  { serial_num: 4002, Owner: 'DOE JOHN', OwnAddrs: '400 NE TESTING ST, VANCOUVER, WA, 98660', SitAddrs: '400 NE TESTING ST, VANCOUVER, 98660', Yrblt: 1990, PT1Desc: 'SFR UNIT', Juris: 'Vancouver', bldgsqft: 1500, LotSqFt: 6000, Legal: '', LandVal: 1, BldVl: 1, TaxTotVal: 2, zn_abrev: 'R-6' },
];
const SALES = [{ prop_id: 2001, SalePrice: 400000, SaleDate: ms('2025-06-01') }, { prop_id: 2001, SalePrice: 100000, SaleDate: ms('2001-01-01') }, { prop_id: 3001, SalePrice: 0, SaleDate: ms('2026-01-01') }];
const LICENSES = [
  { businessname: 'TESTCO HOMES LLC', contractorlicensenumber: 'TESTCHL123', phonenumber: '5035550123', contractorlicensestatus: 'ACTIVE', licenseexpirationdate: '2028-01-01T00:00:00.000', ubi: '601000001', contractorlicensetypecodedesc: 'CONSTRUCTION CONTRACTOR', specialtycode1desc: 'GENERAL', primaryprincipalname: 'TESTER, TESS' },
  { businessname: 'ACME BUILDERS LLC', contractorlicensenumber: 'ACMEBBL999', phonenumber: '3605550102', contractorlicensestatus: 'ACTIVE', licenseexpirationdate: '2027-06-30T00:00:00.000', ubi: '601000002', contractorlicensetypecodedesc: 'CONSTRUCTION CONTRACTOR', specialtycode1desc: 'GENERAL', primaryprincipalname: 'ACME, AL' },
];
const makeFetch = (calls = []) => async (url, init) => {
  const u = String(url);
  const body = init?.body ? new URLSearchParams(init.body) : null;
  const where = body?.get('where') || '';
  calls.push({ url: u, where, outFields: body?.get('outFields') || '', method: init?.method || 'GET' });
  const features = (list) => ({ ok: true, json: async () => ({ features: list.map((attributes) => ({ attributes })) }) });
  if (u.includes('/Permitting/MapServer/4/query')) { const ids = [...where.matchAll(/'([^']+)'/g)].map((m) => m[1]); return features(CASES.filter((c) => ids.includes(c.caseno))); }
  if (u.includes('/Permitting/MapServer/2/query')) return features([]);
  if (u.includes('/Addressing/MapServer/10/query')) {
    const byId = /serial_num IN \(([\d,]+)\)/.exec(where);
    if (byId) return features(PARCELS.filter((p) => byId[1].split(',').map(Number).includes(p.serial_num)));
    const byStreet = /SitAddrs LIKE '([^%]*)%'/.exec(where);
    if (byStreet) return features(PARCELS.filter((p) => p.SitAddrs.startsWith(byStreet[1].replace(/''/g, "'"))));
  }
  if (u.includes('/LandRecords/MapServer/0/query')) { const m = /prop_id IN \(([\d,]+)\)/.exec(where); return features(SALES.filter((s) => m && m[1].split(',').map(Number).includes(s.prop_id))); }
  if (u.includes('data.wa.gov')) return { ok: true, json: async () => LICENSES };
  throw new Error(`unexpected request ${u}`);
};

{
  // only well-formed county case numbers are ever sent, in chunks, upper-cased, and quotes cannot break out
  for (const ok of ['NHC-2026-00873', 'RES-391023', 'RES2005-00197', 'cmi-370091'.toUpperCase()]) assert.ok(CASE_NUMBER.test(ok), ok);
  for (const no of ["x' OR 1=1 --", '', 'NHC-2026', 'RES-39', 'DROP TABLE permits', "NHC-2026-0001')", 'PRT-2026-1 ; --']) assert.ok(!CASE_NUMBER.test(no), no);
  const calls = [];
  const many = Array.from({ length: 85 }, (_, i) => `RES-${String(100000 + i)}`);
  const found = await fetchCasePermits(makeFetch(calls), ["x' OR 1=1 --", 'nhc-2026-90001', ...many, 'NHC-2026-90001']);
  assert.equal(found.size, 1, 'case numbers are matched upper-case and a repeat counts once');
  assert.equal(found.get('NHC-2026-90001').sn, 1001);
  const permitCalls = calls.filter((c) => c.url.includes('/Permitting/'));
  assert.equal(permitCalls.length, 6, 'two layers, three chunks of at most 40');
  assert.ok(permitCalls.every((c) => /^caseno IN \(('[A-Z0-9-]+',?)+\)$/.test(c.where)), 'every where clause is a list of plain case numbers');
  assert.ok(permitCalls.every((c) => !c.where.includes('OR 1=1')), 'an injected value is dropped, not escaped and sent');
  assert.ok(permitCalls.every((c) => c.where.split(',').length <= 40));
  assert.ok(calls.every((c) => c.method === 'POST'), 'queries are POSTed so long lists never hit a URL limit');

  assert.equal(likeLiteral("O'BRIEN_%ST"), "O''BRIENST", 'quotes doubled, wildcards removed');
  calls.length = 0;
  const cands = await fetchParcelCandidates(makeFetch(calls), ['100 NE TESTING ST', '100 NE TESTING ST', '', 'No Address Given', '300 NE TESTING ST', "7 O'NEIL WAY"]);
  assert.deepEqual([...cands.keys()], ['100 NE TESTING ST', '300 NE TESTING ST', "7 O'NEIL WAY"], 'a street is looked up once, and only if it starts with a number');
  assert.equal(cands.get('100 NE TESTING ST')[0].serial_num, 1001);
  assert.ok(calls.some((c) => c.where === "SitAddrs LIKE '100 NE TESTING ST%'"));
  assert.ok(calls.some((c) => c.where === "SitAddrs LIKE '7 O''NEIL WAY%'"), 'an apostrophe in a street cannot end the string early');

  calls.length = 0;
  await fetchSupplierParcels(makeFetch(calls), [1001, 1001, 2001]);
  assert.equal(calls[0].outFields, SUPPLIER_PARCEL_FIELDS);
  assert.ok(/LandVal/.test(calls[0].outFields) && /zn_abrev/.test(calls[0].outFields));
  calls.length = 0;
  await fetchParcels(makeFetch(calls), [1001]);
  assert.ok(!/LandVal|zn_abrev/.test(calls[0].outFields), 'the permit-leads parcel query is unchanged');
  calls.length = 0;
  const licenses = await fetchSupplierLicenses(makeFetch(calls));
  assert.equal(licenses.length, 2);
  assert.ok(decodeURIComponent(calls[0].url).includes(SUPPLIER_LICENSE_FIELDS), 'the license type and specialty are requested');
  assert.ok(/statuscode='A'/.test(decodeURIComponent(calls[0].url)), 'only active licenses');
  pass('the county and L&I queries are built safely, chunked, and never sent anything that is not a plain case number or street');
}

// ---------- the whole join on the fake sources ----------
const prospects = [{ id: 'RES-390001', situs_address: '300 NE TESTING ST' }];
const mailPilotRows = [{ ref: 'CV-0001', street: '200 NE TESTING ST', permit_case: '' }];
const built = await buildSupplierRows({ input: report(), fetchImpl: makeFetch(), prospects, builders: tracked, mailPilotRows, now: NOW });
const byId = Object.fromEntries(built.rows.map((r) => [r.id, r]));
assert.equal(built.rows.length, 6);
assert.deepEqual(Object.keys(byId), ['NHC-2026-90001', 'NHC-2026-90002', 'RES-390001', 'RES-390002', 'CMI-390003', 'RES-390004']);
{
  const a = byId['NHC-2026-90001'];
  assert.equal(a.parcel_match, 'permit case', 'a permit found in the county layer uses its own property id');
  assert.equal(a.property_id, 1001);
  assert.equal(a.zoning, 'R-6', 'the county pads zoning with spaces');
  assert.equal(a.subdivision, 'TESTING ESTATES');
  assert.equal(a.owner_absentee, 1, 'a PO box is not the site');
  assert.equal(a.owner_matches_assessor, 1);
  assert.equal(a.year_built, null, 'a year built of 0 is unknown, not 0');
  assert.equal(a.assessed_cents, 10000000);
  assert.equal(a.li_license, 'TESTCHL123');
  assert.equal(a.li_match, 'business name exact', 'the contractor business name equals the state record, ignoring punctuation and LLC/INC');
  assert.equal(a.li_phone, '5035550123');
  assert.equal(a.li_type, 'CONSTRUCTION CONTRACTOR');
  assert.equal(a.builder_key, 'TESTCO HOMES');
  assert.equal(a.tracked_builder, 'TESTCO HOMES LLC');
  assert.deepEqual(a.signals, []);
  assert.equal(a.score, 0);
  assert.equal(a.edition, '2026-W40');
  assert.equal(a.valuation_cents, 40000000);

  const b = byId['NHC-2026-90002'];
  assert.equal(b.parcel_match, 'address exact');
  assert.equal(b.property_id, 3001);
  assert.equal(b.last_sale_date, '', 'a $0 transfer is not a sale');
  assert.equal(b.last_sale_cents, null);
  assert.equal(b.tracked_builder, '');
  assert.equal(b.tracked_related, 'HSR 121 LLC');
  assert.equal(b.mail_pilot_ref, 'CV-0001', 'found in the mail pilot by address');
  assert.equal(b.li_license, '', 'no license is claimed without an exact name match');

  const c = byId['RES-390001'];
  assert.equal(c.parcel_match, 'address exact');
  assert.equal(c.last_sale_date, '2025-06-01');
  assert.equal(c.last_sale_cents, 40000000, 'the latest priced sale wins');
  assert.equal(c.owner_absentee, 1);
  assert.equal(c.owner_matches_assessor, 1);
  assert.equal(c.county_prospect_id, 'RES-390001');
  assert.equal(c.county_prospect_how, 'same permit');
  assert.equal(c.li_license, 'ACMEBBL999');
  assert.equal(c.builder_license, 'ACMEBBL999');
  assert.deepEqual(c.signals, ['single_family', 'addition', 'recent_permit', 'recent_sale']);
  assert.equal(c.score, 4);
  assert.equal(c.no_contractor, 0);

  const d = byId['RES-390002'];
  assert.equal(d.parcel_match, 'ambiguous', 'two owners at one address: no parcel is chosen');
  assert.equal(d.property_id, null);
  assert.equal(d.owner_matches_assessor, null);
  assert.equal(d.owner_absentee, null);
  assert.deepEqual(d.signals, ['no_contractor', 'recent_permit']);
  assert.equal(d.section, 'Pending');

  const e = byId['CMI-390003'];
  assert.equal(e.parcel_match, 'none');
  assert.equal(e.site_address, '');
  assert.equal(e.grp, 'commercial');
  assert.deepEqual(e.signals, []);
  assert.equal(e.builder_key, 'BIG BOX CONSTRUCTION');

  const g = byId['RES-390004'];
  assert.equal(g.parcel_match, 'none');
  assert.equal(g.owner_name, "ROE O'RICHARD");
  assert.deepEqual(g.signals, ['no_contractor', 'addition', 'recent_permit']);
  assert.equal(g.county_prospect_id, '');

  for (const row of built.rows) {
    for (const column of SUPPLIER_COLUMNS) {
      if (['first_seen', 'last_seen', 'imported_at'].includes(column)) continue;
      assert.ok(column in row, `${row.id} is missing ${column}`);
    }
  }
  const t = tally(built.rows);
  assert.equal(t.permits, 6);
  assert.deepEqual(t.parcel, { 'permit case': 1, 'address exact': 2, ambiguous: 1, none: 2 });
  assert.equal(t.withOwnerPhone, 2);
  assert.equal(t.knownPermitLeads, 1);
  assert.equal(t.knownMailPilot, 1);
  assert.equal(t.trackedBuilder, 1);
  assert.equal(t.licenseMatched, 2);
  assert.ok(!JSON.stringify(t).includes('SMITH'), 'the printed summary carries counts, never names');
  await assert.rejects(buildSupplierRows({ input: report(), fetchImpl: makeFetch(), now: 'today' }), /YYYY-MM-DD/);
  pass('every permit is joined to its parcel, sale, license and the other lists, and an unclear match is left empty');
}

// ---------- the merge SQL on a real SQL engine ----------
const meta = { imported_at: '2026-10-09T20:00:00.000Z', edition: '2026-W40', edition_start: '2026-10-01', edition_end: '2026-10-07', source: 'test source', xref_asof: '2026-10-08T23:11:51.821Z', ranking_json: JSON.stringify(built.ranking), report_json: JSON.stringify(built.report), license_note: 'internal only' };
const sql1 = toSql({ rows: built.rows, meta, importedAt: meta.imported_at, pulledOn: '2026-10-09' });
assert.ok(sql1.includes("ROE O''RICHARD"), 'single quotes are escaped');
assert.ok(!/DROP |DELETE FROM/i.test(sql1), 'a load never deletes');
const db = createD1();
const ask = async (query = '', env = { QUOTES_DB: db }, method = 'GET') => api.onRequest({ request: new Request(`https://example.test/internal/api/supplier-permits${query}`, { method }), env });

assert.deepEqual(await (await ask()).json(), { status: 'empty' }, 'a database that was never loaded reports no data yet');
assert.equal((await ask('?view=list')).status, 200);
await db.exec(sql1);
await db.exec(sql1);
const count = () => db.raw.prepare('SELECT COUNT(*) AS n FROM supplier_permits').get().n;
assert.equal(count(), 6, 'loading the same file twice leaves the same rows');
assert.deepEqual(db.raw.prepare('PRAGMA table_info(supplier_permits)').all().map((c) => c.name), SUPPLIER_COLUMNS, 'the table and the column list cannot drift apart');
assert.equal(SUPPLIER_DDL.length, 4);
assert.equal(db.raw.prepare("SELECT owner_name FROM supplier_permits WHERE id = 'RES-390004'").get().owner_name, "ROE O'RICHARD", 'the quote survives the round trip');

// next week: one permit changed, one new, the rest absent from the report
const later = report();
later.edition = { week: 41, year: 2026, start: '2026-10-08', end: '2026-10-14', region: 'Portland/Vancouver/Salem' };
later.entries = [
  { ...later.entries[0], valuation: 410000 },
  entry({ pmt: 'NHC-2026-90077', street: '100 NE TESTING ST', contacts: [contact('Owner', ['NEWCO HOMES LLC'])] }),
];
const laterBuilt = await buildSupplierRows({ input: later, fetchImpl: makeFetch(), prospects, builders: tracked, mailPilotRows, now: '2026-10-16' });
await db.exec(toSql({ rows: laterBuilt.rows, meta: { ...meta, imported_at: '2026-10-16T20:00:00.000Z', edition: '2026-W41' }, importedAt: '2026-10-16T20:00:00.000Z', pulledOn: '2026-10-16' }));
assert.equal(count(), 7, 'a new permit is added; permits missing from the new edition stay');
const refreshed = db.raw.prepare("SELECT valuation_cents, first_seen, last_seen, edition FROM supplier_permits WHERE id = 'NHC-2026-90001'").get();
assert.deepEqual({ ...refreshed }, { valuation_cents: 41000000, first_seen: '2026-10-09', last_seen: '2026-10-16', edition: '2026-W41' }, 'a permit seen again is refreshed in place and keeps its first_seen');
assert.equal(db.raw.prepare("SELECT last_seen FROM supplier_permits WHERE id = 'RES-390001'").get().last_seen, '2026-10-09', 'a permit not in the new edition is left as it was');
assert.equal(db.raw.prepare("SELECT value FROM supplier_import_meta WHERE key = 'edition'").get().value, '2026-W41');
await db.exec(sql1); // loading last week's file again must not put old values over newer ones
assert.equal(count(), 7);
assert.deepEqual({ ...db.raw.prepare("SELECT valuation_cents, last_seen, edition FROM supplier_permits WHERE id = 'NHC-2026-90001'").get() }, { valuation_cents: 41000000, last_seen: '2026-10-16', edition: '2026-W41' }, 'an older file does not overwrite a newer row');
assert.equal(db.raw.prepare("SELECT value FROM supplier_import_meta WHERE key = 'edition'").get().value, '2026-W41', 'nor the newer edition label');
pass('the load is a merge: idempotent, first_seen kept, nothing deleted, an older file never wins, quotes safe');

// restore a clean database for the endpoint checks below
const fresh = createD1();
await fresh.exec(sql1);
const askFresh = async (query = '', env = { QUOTES_DB: fresh }, method = 'GET') => api.onRequest({ request: new Request(`https://example.test/internal/api/supplier-permits${query}`, { method }), env });

// ---------- endpoint: summary ----------
{
  const summary = await (await askFresh()).json();
  assert.equal(summary.status, 'ok');
  assert.equal(summary.meta.edition, '2026-W40');
  assert.equal(summary.meta.xref_asof, '2026-10-08T23:11:51.821Z');
  assert.deepEqual(summary.totals, { permits: 6, pending: 1, withOwnerPhone: 2, known: 2, inPermitLeads: 1, inMailPilot: 1, newToLists: 4, parcelMatched: 3 });
  assert.deepEqual(summary.window, { from: '2026-09-01', to: '2026-10-08' });
  assert.deepEqual(Object.fromEntries(summary.groups.map((g) => [g.key, g.value])), { new_home: 2, remodel: 2, adu: 1, commercial: 1 }, 'empty groups are left out');
  assert.deepEqual(summary.newHomes, { permits: 2, trackedPermits: 1 });
  assert.equal(summary.scored.total, 3);
  assert.equal(summary.scored.withPhone, 1);
  assert.equal(summary.scored.absentee, 1);
  const signals = Object.fromEntries(summary.scored.signals.map((s) => [s.key, s.value]));
  assert.deepEqual(signals, { single_family: 1, no_contractor: 2, addition: 2, recent_permit: 3, recent_sale: 1 });
  assert.deepEqual(summary.scored.scoreHistogram.map((h) => h.value), [0, 0, 1, 1, 1, 0], 'one permit each at 2, 3 and 4 of 5');
  assert.deepEqual(summary.editions, [{ edition: '2026-W40', permits: 6 }]);
  assert.equal(summary.builders.length, 2);
  const [first, second] = summary.builders;
  assert.equal(first.name, 'TESTCO HOMES LLC');
  assert.equal(first.tracked, 'TESTCO HOMES LLC');
  assert.deepEqual(first.metro, { rank: 3, homes: 40, rows: 1 });
  assert.equal(first.license.number, 'TESTCHL123');
  assert.equal(first.valueCents, 40000000);
  assert.equal(second.related, 'HSR 121 LLC');
  assert.equal(second.license, null);
  assert.equal(second.metro, null, 'a one-word ranking row ("HSR") never claims a longer name ("HSR 124"): too easy to be a different company');
  const text = JSON.stringify(summary);
  for (const secret of ['SMITH', 'DOE JANE', 'RICHARD', '360-555-0101', 'ELSEWHERE', '300 NE', 'PO BOX', 'TESTING ST']) assert.ok(!text.includes(secret), `the summary must not carry "${secret}"`);
  assert.equal((await askFresh('?view=summary&limit=2')).status, 200);
  pass('the summary has counts, charts and builder business names, and none of the personal data');
}

// ---------- endpoint: list and csv ----------
{
  const list = await (await askFresh('?view=list')).json();
  assert.equal(list.status, 'ok');
  assert.equal(list.total, 6);
  assert.deepEqual(list.rows.map((r) => r.id), ['RES-390001', 'RES-390004', 'RES-390002', 'NHC-2026-90001', 'NHC-2026-90002', 'CMI-390003'], 'best fit first, then newest permit');
  const top = list.rows[0];
  assert.equal(top.owner, 'SMITH JOHN');
  assert.equal(top.ownerPhone, '360-555-0101');
  assert.equal(top.builder, 'ACME BUILDERS LLC');
  assert.equal(top.stateLicense.number, 'ACMEBBL999');
  assert.equal(top.absentee, true);
  assert.equal(top.ownerDiffers, false);
  assert.equal(top.inPermitLeads, 'RES-390001');
  assert.deepEqual(top.signals, ['single_family', 'addition', 'recent_permit', 'recent_sale']);
  assert.equal(list.rows.find((r) => r.id === 'RES-390002').pending, true);
  assert.equal((await (await askFresh('?view=list&group=remodel')).json()).total, 2);
  assert.deepEqual((await (await askFresh('?view=list&group=remodel')).json()).rows.map((r) => r.group), ['remodel', 'remodel']);
  assert.equal((await (await askFresh('?view=list&limit=2')).json()).rows.length, 2, 'limit is honoured');
  assert.equal((await (await askFresh('?view=list&limit=2&offset=2')).json()).rows[0].id, 'RES-390002', 'offset pages on');
  assert.equal((await (await askFresh('?view=list&limit=99999')).json()).rows.length, 6, 'an oversized limit is clamped, not an error');
  assert.equal((await (await askFresh('?view=list&limit=-5&offset=abc')).json()).rows.length, 1, 'junk numbers fall back to safe values (limit at least 1)');
  assert.equal((await (await askFresh("?view=list&group=remodel'--")).json()).total, 6, 'an unknown group is no filter at all, never SQL');
  const page = await askFresh('?view=list');
  assert.equal(page.headers.get('cache-control'), 'private, no-store');
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');

  const csv = await askFresh('?view=csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /^text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /^attachment; filename="clearview-supplier-permits-all-\d{4}-\d{2}-\d{2}\.csv"$/);
  assert.equal(csv.headers.get('cache-control'), 'private, no-store');
  const lines = (await csv.text()).trimEnd().split('\r\n');
  assert.equal(lines.length, 7, 'a header and one line per permit');
  assert.equal(lines[0], CSV_HEADER.join(','));
  const remodelCsv = await askFresh('?view=csv&group=remodel');
  assert.match(remodelCsv.headers.get('content-disposition'), /supplier-permits-remodel-/);
  assert.equal((await remodelCsv.text()).trimEnd().split('\r\n').length, 3);
  const none = await askFresh('?view=csv&group=reroof');
  assert.equal(none.status, 404, 'a file with no rows is "empty", not a header-only download');
  assert.deepEqual(await none.json(), { status: 'empty' });
  assert.equal((await readSupplierCsv(fresh, { group: 'adu' })).count, 1);

  // a spreadsheet cell that starts like a formula must not run
  const hostile = listRow({ id: 'X-1', grp: 'remodel', owner_name: '=HYPERLINK("http://evil.example","click")', owner_phone: '+15035550100', site_address: '@SUM(A1)', permit_type: '-2+3', signals: '[]', score: 0 });
  const hostileCsv = toSupplierCsv([hostile]);
  assert.ok(hostileCsv.includes(`"'=HYPERLINK(""http://evil.example"",""click"")"`), 'a leading = is defused and the quotes kept');
  assert.ok(hostileCsv.includes(",'+15035550100,"), 'a leading + is defused');
  assert.ok(hostileCsv.includes(",'@SUM(A1),") && hostileCsv.includes(",'-2+3,"));

  assert.equal((await askFresh('?view=nope')).status, 400);
  assert.equal((await askFresh('', {})).status, 200);
  assert.deepEqual(await (await askFresh('', {})).json(), { status: 'unavailable' }, 'no database binding is reported, not thrown');
  const broken = { prepare() { throw new Error('D1 is locked'); } };
  assert.deepEqual(await (await askFresh('', { QUOTES_DB: broken })).json(), { status: 'unavailable' }, 'a failing database never breaks the Analytics page');
  assert.deepEqual(await (await askFresh('?view=list', { QUOTES_DB: broken })).json(), { status: 'unavailable' });
  const post = await askFresh('', { QUOTES_DB: fresh }, 'POST');
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  assert.equal((await askFresh('', { QUOTES_DB: fresh }, 'HEAD')).status, 200);
  assert.equal((await readSupplierList(fresh, { group: 'remodel' })).group, 'remodel');
  assert.ok((await readSupplierSummary(fresh)).status === 'ok');
  pass('the list and the file are sorted, filtered, clamped and uncached, and formula cells are defused');
}

// ---------- privacy: session gate, private output, git ----------
{
  const redirects = [];
  for (const path of ['/internal/api/supplier-permits', '/internal/api/supplier-permits?view=csv', '/internal/api/supplier-permits?view=list&group=remodel', '/internal/analytics']) {
    let reached = false;
    const response = await gate({ request: new Request(`https://example.test${path}`), env: { INTERNAL_SESSION_SECRET: 'test-secret' }, next: async () => { reached = true; return new Response('secret'); } });
    assert.equal(response.status, 302, `${path} without a session is sent to the login page`);
    assert.ok(!reached, `${path} never reaches the handler without a session`);
    redirects.push(path);
  }
  assert.equal(redirects.length, 4);
  assert.throws(() => assertPrivateOutput('public/data', root), /Refusing to write addresses/);
  assert.throws(() => assertPrivateOutput('src', root), /Refusing/);
  assert.throws(() => assertPrivateOutput('data/../public', root), /Refusing/);
  assert.doesNotThrow(() => assertPrivateOutput('data/supplier-permits', root));
  assert.doesNotThrow(() => assertPrivateOutput('/tmp/somewhere-else', root));
  assert.match(fs.readFileSync(`${root}.gitignore`, 'utf8'), /^data\/supplier-permits\/$/m, 'the load files hold owner names and phone numbers: git-ignored, this repository is public');
  const middleware = fs.readFileSync(`${root}functions/internal/_middleware.js`, 'utf8');
  assert.ok(!/supplier-permits/.test(middleware), 'the endpoint is not on a public path list');

  const parser = fs.readFileSync(`${root}scripts/supplier-permits/parse-construction-monitor.py`, 'utf8');
  assert.match(parser, /refuse_public_output/, 'the parser refuses to write inside the repository outside data/');
  for (const file of ['lib.mjs', 'fetch.mjs', 'pipeline.mjs', 'parse-construction-monitor.py']) {
    assert.ok(!/\b\d{3}-\d{3}-\d{4}\b/.test(fs.readFileSync(`${root}scripts/supplier-permits/${file}`, 'utf8')), `no phone number is written into ${file}`);
  }
  pass('the endpoint and page sit behind the session gate, and nothing with owner data can be committed');
}

// ---------- page, docs and wiring ----------
{
  const page = fs.readFileSync(`${root}src/pages/internal/analytics.astro`, 'utf8');
  const readme = fs.readFileSync(`${root}internal/README.md`, 'utf8');
  const pkg = JSON.parse(fs.readFileSync(`${root}package.json`, 'utf8'));
  const workflow = fs.readFileSync(`${root}.github/workflows/build.yml`, 'utf8');
  const pwa = fs.readFileSync(`${root}scripts/test-internal-pwa.mjs`, 'utf8');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(page), 'supplier data is written with textContent only');
  assert.ok(/\/internal\/api\/supplier-permits/.test(page), 'the page reads the endpoint');
  assert.ok(/view=list/.test(page) && /view=csv/.test(page), 'rows and the file are fetched only on request');
  const calls = [...page.matchAll(/['"`](\/internal\/api\/supplier-permits[^'"`]*)['"`]/g)].map((m) => m[1].split('?')[0]);
  assert.ok(calls.length > 0 && calls.every((c) => c === '/internal/api/supplier-permits'), 'the page only calls its own endpoint');
  assert.ok(/No supplier list loaded yet/.test(page), 'an empty database is a plain message, not an error');
  assert.ok(/licensed/i.test(page) && /telephone|solicit/i.test(page), 'the page says the list is licensed and warns about unsolicited calls and texts');
  assert.equal(pkg.scripts['build:supplier-permits'], 'node scripts/build-supplier-permits.mjs');
  assert.equal(pkg.scripts['test:supplier-permits'], 'node --disable-warning=ExperimentalWarning scripts/test-supplier-permits.mjs');
  assert.ok(/npm run test:supplier-permits/.test(workflow), 'CI runs this test');
  assert.ok(/\/internal\/api\/supplier-permits/.test(pwa), 'the service worker is tested to leave the endpoint alone');
  assert.ok(/build:supplier-permits/.test(readme) && /Construction Monitor/.test(readme) && /wrangler d1 execute QUOTES_DB --remote/.test(readme), 'the load steps are documented');
  assert.ok(fs.existsSync(`${root}.ai/workflows/supplier-permits/CONTEXT.md`), 'the workflow contract exists');
  const contract = fs.readFileSync(`${root}.ai/workflows/supplier-permits/CONTEXT.md`, 'utf8');
  for (const heading of ['## Input', '## Process', '## Output', '## Stop conditions', '## Completion']) assert.ok(contract.includes(heading), `contract has ${heading}`);
  pass('the page is textContent-only and calls only its own endpoint; docs, scripts and CI are wired up');
}

console.log('Supplier-permits checks passed.');
