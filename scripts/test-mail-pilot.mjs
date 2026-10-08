// Mail pilot: segment rules, the loader's validation and SQL, the endpoint, and the privacy guards.
// No network: the SQL runs on a real SQL engine (node:sqlite) and the endpoint is called directly.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createD1 } from './_lib/d1-sqlite.mjs';
import * as api from '../functions/internal/api/mail-pilot.js';
import { onRequest as gate } from '../functions/internal/_middleware.js';
import {
  AGE_BANDS, CSV_HEADER, DEFAULT_RULES, SEGMENTS, WAVE1_SEGMENTS, ageBand, cleanSegments, isLikelyMarketSale, priceBand, segmentFor, toMailMergeCsv,
} from '../functions/internal/_lib/mail-pilot.mjs';
import { assertPrivateOutput, normalizeAll, normalizeRow, rowsOf, tallySegments, toSql } from './mail-pilot/lib.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { breakEven, trackingLink } = await import(pathToFileURL(`${root}src/lib/mail-pilot.ts`).href);
const pass = (message) => console.log(`PASS: ${message}`);

// ---------- segment rules ----------
const sale = (over = {}) => ({ permitType: null, salePrice: 450000, deed: 'D-SWD', yearBuilt: 1978, ...over });
assert.equal(segmentFor(sale({ permitType: 'REROOF' })), 'A');
assert.equal(segmentFor(sale({ permitType: 'reroof' })), 'A', 'permit type is not case sensitive');
assert.equal(segmentFor(sale({ permitType: 'REMODEL' })), 'B');
assert.equal(segmentFor(sale({ permitType: 'ADDITION' })), 'B');
assert.equal(segmentFor(sale({ permitType: 'REROOF', salePrice: 600000 })), 'A', 'a permit outranks a sale');
assert.equal(segmentFor(sale()), 'C');
assert.equal(segmentFor(sale({ yearBuilt: 1995 })), 'C', 'built in the cutoff year is older');
assert.equal(segmentFor(sale({ yearBuilt: 1996 })), 'D');
assert.equal(segmentFor(sale({ yearBuilt: null })), 'D', 'an unknown year is never assumed old');
assert.equal(segmentFor(sale({ salePrice: 49999 })), 'E', 'below the price floor is not a market sale');
assert.equal(segmentFor(sale({ salePrice: 50000 })), 'C', 'the price floor itself counts');
assert.equal(segmentFor(sale({ salePrice: null })), 'E');
assert.equal(segmentFor(sale({ deed: 'D-QCD' })), 'E', 'a quitclaim is not a market sale');
assert.equal(segmentFor(sale({ deed: 'LPROB' })), 'E');
assert.equal(segmentFor(sale({ deed: 'D-B&S' })), 'C');
assert.equal(segmentFor(sale({ deed: null })), 'E');
assert.equal(segmentFor(sale({ yearBuilt: 2001 }), { ...DEFAULT_RULES, cutoffYear: 2005 }), 'C', 'the cutoff year is a rule, not a constant');
assert.equal(segmentFor(sale({ salePrice: 120000 }), { ...DEFAULT_RULES, minPrice: 100000 }), 'C');
assert.ok(isLikelyMarketSale({ salePrice: 500000, deed: 'D-WARR' }) && !isLikelyMarketSale({ salePrice: 500000, deed: 'D' }));
assert.deepEqual(WAVE1_SEGMENTS, ['A', 'B', 'C']);
assert.deepEqual(SEGMENTS.map((s) => s.key), ['A', 'B', 'C', 'D', 'E']);
assert.ok(SEGMENTS.every((s) => s.name && s.rule && ['wave1', 'compare', 'hold'].includes(s.wave)));
assert.equal(ageBand(1979), '1979 or earlier');
assert.equal(ageBand(1980), '1980 to 1995');
assert.equal(ageBand(2016), '2016 or later');
assert.equal(ageBand(null), 'Unknown');
assert.equal(ageBand(0), 'Unknown');
assert.equal(AGE_BANDS.length, 6);
assert.equal(priceBand(29999900), 'Under $300k');
assert.equal(priceBand(30000000), '$300k to $399k');
assert.equal(priceBand(95000000), '$800k and up');
assert.deepEqual(cleanSegments('c, a,a,Z,'), ['A', 'C'], 'segments are letters from the list, in order, once');
assert.deepEqual(cleanSegments(undefined), []);
pass('segment rules are deterministic and the permit outranks the sale');

// ---------- loader validation ----------
const base = (over = {}) => ({
  pid: 1001, street: '123 N MAIN ST', city: 'Vancouver', state: 'WA', zip: 98660, addr_points: 1, jur: 'Vancouver', source: 'Sale',
  sale_date: '2026-08-24', sale_price: 515000, deed: 'D-SWD', yr: 1972, area: 1920, lot_sqft: 5200, ...over,
});
const row = normalizeRow(base());
assert.equal(row.segment, 'C');
assert.equal(row.sale_cents, 51500000, 'money is stored in integer cents');
assert.equal(row.zip, '98660');
assert.equal(normalizeRow(base({ zip: 8540 })).zip, '08540', 'a ZIP that lost its leading zero is restored');
assert.equal(normalizeRow(base({ source: 'Permit', permit_wt: 'ADD/REM', permit_issued: '2026-09-01', sale_date: null, sale_price: null, deed: null })).permit_type, 'ADDITION');
assert.equal(normalizeRow(base({ source: 'Sale + permit', permit_wt: 'REROOF', permit_issued: '2026-09-01' })).segment, 'A');
assert.equal(normalizeRow(base({ sale_price: 0 })).segment, 'E');
assert.equal(normalizeRow(base({ notes: '  verify  ', subdivision: '' })).notes, 'verify');
assert.equal(normalizeRow(base({ subdivision: '' })).subdivision, null, 'empty text is null, not an empty string');
assert.equal(normalizeRow(base({ segment: 'C' })).segment, 'C', 'a pipeline that agrees with the rules passes');
const bad = (over, pattern) => assert.throws(() => normalizeRow(base(over)), pattern);
bad({ pid: 'x' }, /pid must be a positive/);
bad({ pid: 0 }, /pid must be a positive/);
bad({ street: '' }, /street is required/);
bad({ city: null }, /city is required/);
bad({ zip: '986601' }, /not 5 digits/);
bad({ zip: '9866A' }, /not 5 digits/);
bad({ source: 'Mailer' }, /source "Mailer"/);
bad({ sale_date: '08/24/2026' }, /YYYY-MM-DD/);
bad({ source: 'Permit', sale_date: null }, /needs a permit type/);
bad({ permit_wt: 'ROOFING', source: 'Sale + permit' }, /permit type "ROOFING"/);
bad({ sale_price: -5 }, /dollar amount/);
bad({ sale_price: 'lots' }, /dollar amount/);
bad({ ref: 'XX-1' }, /must look like CV-0001/);
bad({ sale_date: null }, /needs a sale date/);
bad({ segment: 'A' }, /file says segment A but the rules give C/);
assert.throws(() => rowsOf({ rows: [] }), /no rows/);
assert.throws(() => rowsOf('nope'), /no rows/);
assert.equal(rowsOf([base()]).length, 1);
assert.equal(rowsOf({ rows: [base()] }).length, 1);
assert.throws(() => normalizeAll([base(), base()]), /appears twice/);
assert.throws(() => normalizeAll([base({ ref: 'CV-0001' }), base({ pid: 1002, ref: 'CV-0001' })]), /already used/);
const ordered = normalizeAll([base({ pid: 1 }), base({ pid: 2, ref: 'CV-0007' })]);
assert.deepEqual(ordered.map((r) => r.pid), [2, 1], 'rows that already have a code are inserted first');
pass('every input row is validated and normalized before any SQL is written');

// ---------- SQL on a real engine: merge, stable codes ----------
const first = normalizeAll([
  base({ pid: 11, ref: 'CV-0001', street: "5 O'BRIEN WAY", notes: 'He said "hi", ok' }),
  base({ pid: 12, ref: 'CV-0002', source: 'Permit', permit_wt: 'REROOF', permit_issued: '2026-09-10', sale_date: null, sale_price: null, deed: null, yr: 1960, addr_points: 2 }),
  base({ pid: 13, ref: 'CV-0003', yr: 2010 }),
  base({ pid: 14, ref: 'CV-0004', deed: 'D-QCD' }),
]);
const META = { min_price: '50000', cutoff_year: '1995', likely_deeds: 'D-SWD,D-WARR,D-B&S' };
const db = createD1();
const sql1 = toSql({ rows: first, meta: META, importedAt: '2026-10-08T12:00:00.000Z', pulledOn: '2026-10-08' });
assert.ok(sql1.includes("5 O''BRIEN WAY"), 'single quotes are escaped');
await db.exec(sql1);
await db.exec(sql1); // loading the same file twice changes nothing
const count = async () => (await db.prepare('SELECT COUNT(*) AS n FROM mail_pilot_properties').first('n'));
assert.equal(await count(), 4);
const refOf = async (pid) => db.prepare('SELECT ref FROM mail_pilot_properties WHERE pid = ?').bind(pid).first('ref');
assert.equal(await refOf(11), 'CV-0001');

// A later pull: one property is new, one is gone from the file, one changed segment (a permit appeared).
const second = normalizeAll([
  base({ pid: 11, street: "5 O'BRIEN WAY", source: 'Sale + permit', permit_wt: 'REMODEL', permit_issued: '2026-10-20' }),
  base({ pid: 15, street: '9 NEW ST' }),
  base({ pid: 16, street: '10 NEW ST', yr: 2012 }),
]);
await db.exec(toSql({ rows: second, meta: META, importedAt: '2026-11-20T12:00:00.000Z', pulledOn: '2026-11-20' }));
assert.equal(await count(), 6, 'a reload adds and updates; it never deletes');
assert.equal(await refOf(11), 'CV-0001', 'a property keeps the code that was printed on its mail');
assert.equal(await refOf(15), 'CV-0005', 'new properties continue the sequence');
assert.equal(await refOf(16), 'CV-0006');
assert.equal(await refOf(14), 'CV-0004', 'a property missing from the later pull is left alone');
assert.equal(await db.prepare('SELECT segment FROM mail_pilot_properties WHERE pid = 11').first('segment'), 'B', 'facts and segment are refreshed');
assert.equal(await db.prepare('SELECT first_seen FROM mail_pilot_properties WHERE pid = 11').first('first_seen'), '2026-10-08', 'first_seen is kept');
assert.equal(await db.prepare('SELECT last_seen FROM mail_pilot_properties WHERE pid = 11').first('last_seen'), '2026-11-20');
assert.equal(await db.prepare('SELECT value FROM mail_pilot_meta WHERE key = ?').bind('pulled_on').first('value'), '2026-11-20');
// A fresh database gets automatic codes from 0001 when the file has none.
const fresh = createD1();
await fresh.exec(toSql({ rows: normalizeAll([base({ pid: 5 }), base({ pid: 6 })]), meta: META, importedAt: 'x', pulledOn: '2026-10-08' }));
assert.deepEqual((await fresh.prepare('SELECT ref FROM mail_pilot_properties ORDER BY ref').all()).results.map((r) => r.ref), ['CV-0001', 'CV-0002']);
assert.deepEqual(tallySegments(first), { A: 1, B: 0, C: 1, D: 1, E: 1 });
pass('the SQL merges: codes printed on mail never change and are never reused');

// ---------- endpoint ----------
const ask = async (query = '', env = { QUOTES_DB: db }, method = 'GET') => api.onRequest({ request: new Request(`https://example.test/internal/api/mail-pilot${query}`, { method }), env });
const empty = createD1();
assert.deepEqual(await (await ask('', { QUOTES_DB: empty })).json(), { status: 'empty' }, 'a database that was never loaded reports no data yet');
assert.equal((await ask('?view=csv', { QUOTES_DB: empty })).status, 404, 'there is no file to download before a load');
assert.deepEqual(await (await ask('', {})).json(), { status: 'unavailable' }, 'no database binding is reported, not thrown');

const summary = await (await ask()).json();
assert.equal(summary.status, 'ok');
assert.equal(summary.totals.addresses, 6);
assert.deepEqual(summary.segments.map((s) => [s.key, s.addresses]), [['A', 1], ['B', 1], ['C', 1], ['D', 2], ['E', 1]]);
assert.equal(summary.totals.wave1, 3);
assert.equal(summary.totals.permits, 2);
assert.equal(summary.totals.verify, 1);
assert.equal(summary.totals.likelySales, 4, 'sales with a real price on a standard deed');
assert.equal(summary.window.salesFrom, '2026-08-24');
assert.equal(summary.window.permitsTo, '2026-10-20');
assert.ok(summary.cities.every((c) => c.label === 'Vancouver') && summary.cities[0].value === 3, 'cities count wave 1 only');
assert.equal(summary.weeklySales.reduce((n, w) => n + w.value, 0), 5, 'every property with a sale date lands in a week');
assert.equal(summary.weeklySales[0].label, '2026-08-24', 'weeks start on Monday');
assert.equal(summary.rules.minPrice, 50000);
assert.ok(!JSON.stringify(summary).includes('NEW ST'), 'the summary carries no street addresses');
pass('the summary counts what was loaded and carries no street addresses');

const list = await (await ask('?view=list&segments=D,C,A&limit=2')).json();
assert.equal(list.total, 4);
assert.equal(list.rows.length, 2, 'limit is honoured');
assert.deepEqual(list.rows.map((r) => r.segment), ['A', 'C'], 'ordered by group');
const page2 = await (await ask('?view=list&segments=D,C,A&limit=2&offset=2')).json();
assert.deepEqual(page2.rows.map((r) => r.segment), ['D', 'D']);
assert.ok(!list.rows.some((r) => page2.rows.some((p) => p.ref === r.ref)), 'pages do not overlap');
assert.equal((await (await ask('?view=list&limit=99999')).json()).rows.length, 6, 'an oversized limit is clamped, not an error');
assert.equal((await (await ask('?view=list&segments=Z')).json()).total, 6, 'unknown segment letters are ignored');
assert.equal(list.rows[0].verify, true);
assert.equal((await ask('?view=nope')).status, 400);
assert.equal((await ask('', { QUOTES_DB: db }, 'POST')).status, 405);
pass('the list pages, filters and clamps');

const csvRes = await ask('?view=csv');
assert.equal(csvRes.status, 200);
assert.match(csvRes.headers.get('content-type'), /^text\/csv/);
assert.match(csvRes.headers.get('content-disposition'), /^attachment; filename="clearview-mail-merge-ABC-\d{4}-\d{2}-\d{2}\.csv"$/);
assert.equal(csvRes.headers.get('cache-control'), 'private, no-store');
const csv = (await csvRes.text()).split('\r\n').filter(Boolean);
assert.equal(csv[0], CSV_HEADER.join(','));
assert.equal(csv.length, 1 + 3, 'the default file is wave 1');
assert.ok(csv.slice(1).every((line) => line.split(',').includes('CURRENT RESIDENT')), 'no person is named');
assert.ok(csv.some((line) => line.startsWith('CV-0002,CURRENT RESIDENT,123 N MAIN ST,VANCOUVER,WA,98660,A,Re-roof permit,Permit,Y')), 'street and city in capitals, flag set');
assert.equal((await (await ask('?view=csv&segments=D,E')).text()).split('\r\n').filter(Boolean).length, 1 + 3);
// Big files are paged internally; the mail house gets every row.
const big = createD1();
const many = Array.from({ length: 650 }, (_, i) => base({ pid: 100000 + i, street: `${i + 1} LONG RD` }));
await big.exec(toSql({ rows: normalizeAll(many), meta: META, importedAt: 'x', pulledOn: '2026-10-08' }));
assert.equal((await (await ask('?view=csv&segments=C', { QUOTES_DB: big })).text()).split('\r\n').filter(Boolean).length, 651);
// Cells that look like spreadsheet formulas are neutralized; commas and quotes are quoted.
const nasty = toMailMergeCsv([{ ref: 'CV-0009', street: '=CMD() "x", y', city: '-1', state: 'WA', zip: '98660', segment: 'C', source: 'Sale', verify: false }]);
assert.ok(nasty.includes(`"'=CMD() ""X"", Y"`), 'formula prefix and quotes are escaped');
assert.ok(nasty.includes(",'-1,"), 'a leading minus is neutralized');
pass('the mail-merge file is complete, wave 1 by default, and safe to open in a spreadsheet');

// ---------- privacy guards ----------
const redirects = [];
for (const path of ['/internal/api/mail-pilot', '/internal/api/mail-pilot?view=csv', '/internal/mail-pilot']) {
  let reached = false;
  const response = await gate({ request: new Request(`https://example.test${path}`), env: { INTERNAL_SESSION_SECRET: 'test-secret' }, next: async () => { reached = true; return new Response('secret'); } });
  assert.equal(reached, false, `${path} must not be served without a session`);
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location'), /\/internal\/login/);
  redirects.push(path);
}
assert.equal(redirects.length, 3);
assert.throws(() => assertPrivateOutput('public/data', root), /Refusing to write addresses/);
assert.throws(() => assertPrivateOutput('src', root), /Refusing/);
assert.throws(() => assertPrivateOutput('functions/x', root), /Refusing/);
assert.throws(() => assertPrivateOutput('data/../public', root), /Refusing/);
assert.doesNotThrow(() => assertPrivateOutput('data/mail-pilot', root));
assert.doesNotThrow(() => assertPrivateOutput('/tmp/somewhere-else', root));
assert.match(fs.readFileSync(`${root}.gitignore`, 'utf8'), /^data\/mail-pilot\/$/m, 'load files are git-ignored: this repository is public');
try {
  const tracked = execFileSync('git', ['ls-files', 'data', 'public', 'src', 'functions'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.deepEqual(tracked.filter((f) => /mail-pilot.*\.(sql|csv|json)$/i.test(f) && !/package|tsconfig/.test(f)), [], 'no mail-pilot data file is tracked');
} catch (error) {
  if (error.code !== 'ENOENT' && error.name === 'AssertionError') throw error; // git missing (e.g. a source export): nothing to check
}
const pageSource = fs.readFileSync(`${root}src/pages/internal/mail-pilot.astro`, 'utf8');
assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(pageSource), 'rows are built with textContent, never HTML');
assert.deepEqual([...new Set([...pageSource.matchAll(/['"`](\/internal\/[\w/-]+(?:\?[^'"`]*)?)/g)].map((m) => m[1].split('?')[0]))].sort(), ['/internal/api/mail-pilot', '/internal/login'], 'the page talks to its one endpoint and the login page');
assert.match(fs.readFileSync(`${root}src/pages/internal/tools/index.astro`, 'utf8'), /href="\/internal\/mail-pilot"/, 'Tools links to the page');
pass('the address endpoint is behind the session gate, and nothing with addresses can be committed');

// ---------- break-even and tracking link ----------
const be = breakEven({ pieces: 193, costPerPiece: 0.85, jobValue: 9000, marginPct: 30 });
assert.equal(be.spend, 164.05);
assert.equal(be.profitPerJob, 2700);
assert.equal(be.jobsNeeded, 1, 'rounds up: a fraction of a job is still a job');
assert.equal(be.requestsNeeded, null, 'no close rate typed, no estimate-request figure');
const be2 = breakEven({ pieces: 1000, costPerPiece: 1, jobValue: 10000, marginPct: 25, closePct: 20 });
assert.equal(be2.jobsNeeded, 1);
assert.equal(be2.requestsNeeded, 5);
assert.equal(breakEven({ pieces: 1000, costPerPiece: 2.5, jobValue: 1000, marginPct: 20 }).jobsNeeded, 13, '2500 / 200 = 12.5, rounded up');
assert.equal(breakEven({ pieces: 1000, costPerPiece: 2, jobValue: 1000, marginPct: 20 }).jobsNeeded, 10, 'an exact result is not rounded up');
assert.equal(breakEven({ pieces: 1000, costPerPiece: 2, jobValue: 1000, marginPct: 20 }).jobsPer1000, 10);
for (const input of [null, undefined, {}, { pieces: 0, costPerPiece: 1, jobValue: 1, marginPct: 1 }, { pieces: 10, costPerPiece: 0, jobValue: 1, marginPct: 1 }, { pieces: 10, costPerPiece: 1, jobValue: -1, marginPct: 1 },
  { pieces: 10, costPerPiece: 1, jobValue: 1, marginPct: 0 }, { pieces: 10, costPerPiece: 1, jobValue: 1, marginPct: 101 }, { pieces: NaN, costPerPiece: 1, jobValue: 1, marginPct: 1 }]) {
  assert.equal(breakEven(input), null, `no answer for ${JSON.stringify(input)}`);
}
assert.equal(breakEven({ pieces: 10, costPerPiece: 1, jobValue: 100, marginPct: 50, closePct: 0 }).requestsNeeded, null, 'a zero close rate is ignored, not divided by');
assert.equal(breakEven({ pieces: 10, costPerPiece: 1, jobValue: 100, marginPct: 50, closePct: 150 }).requestsNeeded, null);
assert.equal(trackingLink('CV-0042'), 'https://windowsbyclearview.com/estimate?utm_source=mailer&utm_medium=print&utm_campaign=CV-0042');
assert.equal(trackingLink('CV-0042', 'http://localhost:4321/'), 'http://localhost:4321/estimate?utm_source=mailer&utm_medium=print&utm_campaign=CV-0042');
assert.equal(trackingLink('nope'), null);
assert.equal(trackingLink('CV-1&x=1'), null, 'only a real code can end up in a link');
pass('break-even math uses only typed numbers and tracking links only carry real codes');
