import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { ga4Config, fetchGa4Summary, buildRequests, resetGa4TokenCacheForTests } from '../functions/internal/_lib/ga4.mjs';
import { summarizeLeadSources, sourceLabel } from '../functions/internal/_lib/lead-sources.mjs';

const pass = (message) => console.log(`PASS: ${message}`);
const subtle = webcrypto.subtle;

const pair = await subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const pkcs8 = Buffer.from(await subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
const EMAIL = 'analytics-reader@clearview-test.iam.gserviceaccount.com';
const PROPERTY = '123456789';
const env = {
  GA4_PROPERTY_ID: PROPERTY,
  GA4_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: EMAIL, private_key: PRIVATE_KEY }),
};

const b64urlToBuffer = (value) => Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const row = (dims, metrics) => ({
  dimensionValues: dims.map((value) => ({ value })),
  metricValues: metrics.map((value) => ({ value: String(value) })),
});
const goodReports = {
  reports: [
    { rows: [row(['last7'], [40, 55, 130]), row(['last28'], [150, 210, 520])] },
    { rows: [row(['last7'], [2]), row(['last28'], [7])] },
    { rows: [row(['/replacement'], [90]), row(['/'], [70]), row(['/x\u0000\n' + 'y'.repeat(500)], [3])] },
    { rows: [row(['Organic Search'], [120]), row(['Direct'], [60])] },
    // Out of order on purpose, with one malformed date and one junk number.
    { rows: [row(['20260903'], [5, 4]), row(['20260901'], [3, 2]), row(['not-a-date'], [9, 9]), row(['20260902'], ['junk', 1])] },
  ],
};

function mockFetch({ tokenOk = true, reportsOk = true, reports = goodReports } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      return tokenOk
        ? new Response(JSON.stringify({ access_token: 'tok-abc', expires_in: 3600 }), { status: 200 })
        : new Response(JSON.stringify({ error: 'invalid_grant', detail: PRIVATE_KEY }), { status: 400 });
    }
    return reportsOk
      ? new Response(JSON.stringify(reports), { status: 200 })
      : new Response(JSON.stringify({ error: { message: `secret ${EMAIL}` } }), { status: 403 });
  };
  return { impl, calls };
}

{
  resetGa4TokenCacheForTests();
  assert.equal(ga4Config({}), null);
  assert.equal(ga4Config({ GA4_PROPERTY_ID: 'G-YE96XMJSWJ', GA4_SERVICE_ACCOUNT_JSON: env.GA4_SERVICE_ACCOUNT_JSON }), null, 'a G- measurement ID is not a property ID');
  assert.equal(ga4Config({ GA4_PROPERTY_ID: PROPERTY, GA4_SERVICE_ACCOUNT_JSON: 'not json' }), null);
  assert.equal(ga4Config({ GA4_PROPERTY_ID: PROPERTY, GA4_SERVICE_ACCOUNT_JSON: '{"client_email":"a@b.c"}' }), null);
  assert.deepEqual(await fetchGa4Summary({}), { status: 'unconfigured' });
  pass('missing or malformed GA4 configuration reports "unconfigured" and never calls out');
}

{
  resetGa4TokenCacheForTests();
  const { impl, calls } = mockFetch();
  const now = Date.UTC(2026, 8, 28, 12, 0, 0);
  const result = await fetchGa4Summary(env, { fetchImpl: impl, now });
  assert.equal(result.status, 'ok');
  const tokenCall = calls[0];
  const assertion = new URLSearchParams(tokenCall.init.body).get('assertion');
  const [header, claims, signature] = assertion.split('.');
  assert.deepEqual(JSON.parse(b64urlToBuffer(header)), { alg: 'RS256', typ: 'JWT' });
  const parsed = JSON.parse(b64urlToBuffer(claims));
  assert.equal(parsed.iss, EMAIL);
  assert.equal(parsed.scope, 'https://www.googleapis.com/auth/analytics.readonly');
  assert.equal(parsed.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(parsed.iat, Math.floor(now / 1000));
  assert.equal(parsed.exp - parsed.iat, 3600);
  const valid = await subtle.verify(
    'RSASSA-PKCS1-v1_5',
    pair.publicKey,
    b64urlToBuffer(signature),
    new TextEncoder().encode(`${header}.${claims}`),
  );
  assert.ok(valid, 'the JWT assertion verifies against the service account public key');
  pass('the service-account JWT is RS256-signed, read-only scoped, and short-lived');
}

{
  resetGa4TokenCacheForTests();
  const { impl, calls } = mockFetch();
  const result = await fetchGa4Summary(env, { fetchImpl: impl, now: 1_000_000 });
  const reportCall = calls[1];
  assert.equal(reportCall.url, `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}:batchRunReports`);
  assert.equal(reportCall.init.headers.authorization, 'Bearer tok-abc');
  const body = JSON.parse(reportCall.init.body);
  assert.equal(body.requests.length, 5);
  assert.ok(body.requests.length <= 5, 'GA4 allows at most five reports per batch');
  assert.equal(body.requests[1].dimensionFilter.filter.stringFilter.value, 'generate_lead');
  assert.deepEqual(result.last7, { users: 40, sessions: 55, pageViews: 130, leadEvents: 2 });
  assert.deepEqual(result.last28, { users: 150, sessions: 210, pageViews: 520, leadEvents: 7 });
  assert.equal(result.topPages[0].label, '/replacement');
  assert.equal(result.channels[0].value, 120);
  assert.ok(result.topPages.every((p) => p.label.length <= 120 && !/[\u0000-\u001f]/.test(p.label)), 'labels are bounded and control-free');
  assert.ok(buildRequests().every((r) => !r.limit || r.limit <= 31), 'row counts are bounded');
  assert.deepEqual(result.daily, [
    { date: '2026-09-01', sessions: 3, users: 2 },
    { date: '2026-09-02', sessions: 0, users: 1 },
    { date: '2026-09-03', sessions: 5, users: 4 },
  ]);
  pass('GA4 reports are requested for the right property and normalized to bounded, clean numbers and labels');
}

{
  resetGa4TokenCacheForTests();
  const bad = mockFetch({ reportsOk: false });
  const a = await fetchGa4Summary(env, { fetchImpl: bad.impl, now: 2_000_000 });
  resetGa4TokenCacheForTests();
  const badToken = mockFetch({ tokenOk: false });
  const b = await fetchGa4Summary(env, { fetchImpl: badToken.impl, now: 3_000_000 });
  resetGa4TokenCacheForTests();
  const c = await fetchGa4Summary(env, { fetchImpl: async () => { throw new Error(PRIVATE_KEY); }, now: 4_000_000 });
  resetGa4TokenCacheForTests();
  const d = await fetchGa4Summary(env, { fetchImpl: mockFetch({ reports: { reports: [] } }).impl, now: 5_000_000 });
  for (const result of [a, b, c, d]) {
    assert.deepEqual(result, { status: 'unavailable' });
    assert.ok(!JSON.stringify(result).includes(EMAIL) && !JSON.stringify(result).includes('PRIVATE KEY'));
  }
  pass('API, token, network and shape failures degrade to "unavailable" without echoing keys or upstream bodies');
}

{
  // A payload from before the daily report existed still works; the page just has no trend chart.
  resetGa4TokenCacheForTests();
  const legacy = { reports: goodReports.reports.slice(0, 4) };
  const result = await fetchGa4Summary(env, { fetchImpl: mockFetch({ reports: legacy }).impl, now: 6_000_000 });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.daily, []);
  pass('a GA4 response without the daily report still normalizes (empty trend)');
}

{
  resetGa4TokenCacheForTests();
  const { impl, calls } = mockFetch();
  await fetchGa4Summary(env, { fetchImpl: impl, now: 10_000_000 });
  await fetchGa4Summary(env, { fetchImpl: impl, now: 10_000_500 });
  assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 1, 'the access token is reused while valid');
  pass('the access token is cached between requests');
}

{
  assert.equal(sourceLabel({ first_utm_source: ' Nextdoor ' }), 'nextdoor');
  assert.equal(sourceLabel({ first_referrer: 'https://www.google.com/search?q=windows' }), 'google.com');
  assert.equal(sourceLabel({ first_referrer: 'https://windowsbyclearview.com/guides/x' }), 'Direct / unknown');
  assert.equal(sourceLabel({ first_utm_source: 'fb', first_referrer: 'https://l.facebook.com/' }), 'fb', 'utm source wins over referrer');
  assert.equal(sourceLabel({}), 'Direct / unknown');
  const now = Date.UTC(2026, 8, 28, 12, 0, 0);
  const iso = (offsetDays) => new Date(now - offsetDays * 86400000).toISOString();
  const summary = summarizeLeadSources(
    [
      { created_at: iso(1), first_referrer: 'https://www.google.com/', landing_path: '/replacement?utm=x' },
      { created_at: iso(2), first_referrer: 'https://google.com/', landing_path: '/replacement' },
      { created_at: iso(3), first_utm_source: 'nextdoor', landing_path: '/' },
      { created_at: iso(400), first_referrer: 'https://old.example/', landing_path: '/old' },
      { created_at: 'not a date', landing_path: '/bad' },
    ],
    { now },
  );
  assert.equal(summary.total, 3, 'rows outside the window or without a valid date are ignored');
  assert.deepEqual(summary.sources[0], { label: 'google.com', value: 2 });
  assert.deepEqual(summary.landingPages[0], { label: '/replacement', value: 2 });
  assert.equal(summary.weekly.length, 8);
  assert.equal(summary.weekly.reduce((sum, w) => sum + w.value, 0), 3);
  pass('lead sources are counted from first-touch attribution, windowed, deduplicated by label, and bucketed by week');
}

{
  const page = fs.readFileSync('src/pages/internal/analytics.astro', 'utf8');
  const endpoint = fs.readFileSync('functions/internal/api/analytics.js', 'utf8');
  const layout = fs.readFileSync('src/layouts/InternalLayout.astro', 'utf8');
  const readme = fs.readFileSync('internal/README.md', 'utf8');
  const middleware = fs.readFileSync('functions/internal/_middleware.js', 'utf8');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(page), 'analytics data is written with textContent only');
  assert.ok(/textContent/.test(page));
  assert.ok(/\/internal\/analytics/.test(layout), 'the page is in the internal navigation');
  assert.ok(/GA4_PROPERTY_ID/.test(readme) && /GA4_SERVICE_ACCOUNT_JSON/.test(readme), 'the GA4 variables are documented');
  assert.ok(!/api\.ahrefs\.com/.test(endpoint + page), 'Ahrefs is a link only; the free plan has no API');
  assert.ok(!/PUBLIC_PATHS = new Set\([^)]*analytics/.test(middleware), 'the endpoint is not on the public path list');
  assert.ok(/private, no-store/.test(endpoint), 'the endpoint is never cached');
  pass('the Analytics page is internal-only, uncached, textContent-only, and documented');
}

console.log('Analytics checks passed.');
