// Read-only Google Analytics 4 summary for the internal Analytics page.
//
// Deterministic and fail-soft: it reports what the GA4 Data API returns and
// nothing else. Configuration lives in the Cloudflare Pages dashboard, never
// in the repo:
//
//   GA4_PROPERTY_ID            numeric GA4 property ID (not the G-XXXX measurement ID)
//   GA4_SERVICE_ACCOUNT_JSON   secret: the service account's JSON key, with that
//                              account added to the property as a Viewer
//
// Missing or invalid configuration returns { status: 'unconfigured' }; any API,
// network or parsing failure returns { status: 'unavailable' }. Neither ever
// echoes an upstream error body, the key, or the token.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const DATA_API = 'https://analyticsdata.googleapis.com/v1beta/properties';
const LEAD_EVENT = 'generate_lead';
const MAX_ROWS = 8;
const MAX_DAYS = 31;
const MAX_TEXT = 120;

let tokenCache = { key: '', token: '', expiresAt: 0 };

export function ga4Config(env) {
  const propertyId = String(env?.GA4_PROPERTY_ID || '').trim();
  if (!/^\d{5,15}$/.test(propertyId)) return null;
  let account;
  try {
    account = JSON.parse(String(env?.GA4_SERVICE_ACCOUNT_JSON || ''));
  } catch {
    return null;
  }
  const email = typeof account?.client_email === 'string' ? account.client_email : '';
  const privateKey = typeof account?.private_key === 'string' ? account.private_key : '';
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || !privateKey.includes('BEGIN PRIVATE KEY')) return null;
  return { propertyId, email, privateKey };
}

function base64url(bytes) {
  let binary = '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const textBytes = (value) => new TextEncoder().encode(value);

async function signJwt(config, nowSeconds) {
  const header = base64url(textBytes(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = base64url(textBytes(JSON.stringify({
    iss: config.email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  })));
  const pem = config.privateKey
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, textBytes(`${header}.${claims}`));
  return `${header}.${claims}.${base64url(signature)}`;
}

async function accessToken(config, fetchImpl, now) {
  const cacheKey = `${config.email}:${config.propertyId}`;
  if (tokenCache.key === cacheKey && tokenCache.expiresAt > now + 60_000) return tokenCache.token;
  const assertion = await signJwt(config, Math.floor(now / 1000));
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) throw new Error('token');
  const data = await response.json();
  if (typeof data?.access_token !== 'string' || !data.access_token) throw new Error('token');
  const ttlMs = Math.min(3600, Math.max(60, Number(data.expires_in) || 3600)) * 1000;
  tokenCache = { key: cacheKey, token: data.access_token, expiresAt: now + ttlMs };
  return tokenCache.token;
}

import { INTENT_EVENTS, INTENT_LABELS } from '../../_lib/intent.mjs';

const RANGES = [
  { startDate: '7daysAgo', endDate: 'today', name: 'last7' },
  { startDate: '28daysAgo', endDate: 'today', name: 'last28' },
];

export function buildRequests() {
  return [
    {
      dateRanges: RANGES,
      metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
    },
    {
      dateRanges: RANGES,
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: LEAD_EVENT } },
      },
    },
    {
      dateRanges: [RANGES[1]],
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'screenPageViews' }],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: MAX_ROWS,
    },
    {
      dateRanges: [RANGES[1]],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: MAX_ROWS,
    },
    // Day by day, for the trend chart. GA4 allows five requests per batch; this is the fifth.
    {
      dateRanges: [RANGES[1]],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
      limit: MAX_DAYS,
    },
  ];
}

const cleanNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};

const cleanText = (value) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);

function totalsByRange(report, metricCount) {
  const out = { last7: new Array(metricCount).fill(0), last28: new Array(metricCount).fill(0) };
  for (const row of report?.rows || []) {
    const range = row?.dimensionValues?.find((d) => d?.value === 'last7' || d?.value === 'last28')?.value
      || row?.dimensionValues?.[0]?.value;
    if (range !== 'last7' && range !== 'last28') continue;
    row.metricValues?.forEach((metric, index) => {
      if (index < metricCount) out[range][index] = cleanNumber(metric?.value);
    });
  }
  return out;
}

// GA4 reports a day as YYYYMMDD; the page wants ISO dates.
function dailyRows(report) {
  const out = [];
  for (const row of (report?.rows || []).slice(0, MAX_DAYS)) {
    const raw = String(row?.dimensionValues?.[0]?.value ?? '');
    if (!/^\d{8}$/.test(raw)) continue;
    out.push({
      date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`,
      sessions: cleanNumber(row?.metricValues?.[0]?.value),
      users: cleanNumber(row?.metricValues?.[1]?.value),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function topRows(report) {
  return (report?.rows || []).slice(0, MAX_ROWS).map((row) => ({
    label: cleanText(row?.dimensionValues?.[0]?.value) || '(not set)',
    value: cleanNumber(row?.metricValues?.[0]?.value),
  }));
}

export function normalizeReports(payload) {
  const reports = Array.isArray(payload?.reports) ? payload.reports : [];
  if (reports.length < 4) throw new Error('shape');
  const overview = totalsByRange(reports[0], 3);
  const leads = totalsByRange(reports[1], 1);
  return {
    last7: {
      users: overview.last7[0],
      sessions: overview.last7[1],
      pageViews: overview.last7[2],
      leadEvents: leads.last7[0],
    },
    last28: {
      users: overview.last28[0],
      sessions: overview.last28[1],
      pageViews: overview.last28[2],
      leadEvents: leads.last28[0],
    },
    topPages: topRows(reports[2]),
    channels: topRows(reports[3]),
    // Older payloads without the daily report still normalize; the page just skips the trend chart.
    daily: dailyRows(reports[4]),
  };
}

export async function fetchGa4Summary(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const config = ga4Config(env);
  if (!config) return { status: 'unconfigured' };
  try {
    const token = await accessToken(config, fetchImpl, now);
    const response = await fetchImpl(`${DATA_API}/${config.propertyId}:batchRunReports`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ requests: buildRequests() }),
    });
    if (!response.ok) return { status: 'unavailable' };
    const summary = normalizeReports(await response.json());
    let intentEvents = null;
    try {
      const eventsResponse = await fetchImpl(`${DATA_API}/${config.propertyId}:runReport`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ dateRanges: [RANGES[1]], dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }], dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: INTENT_EVENTS } } }, orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }], limit: 31 }),
      });
      if (eventsResponse.ok) intentEvents = topRows(await eventsResponse.json()).filter(row => INTENT_EVENTS.includes(row.label)).map(row => ({ ...row, label: INTENT_LABELS[row.label] }));
    } catch { /* Optional behavior report must not blank traffic or pipeline. */ }
    return { status: 'ok', propertyId: config.propertyId, ...summary, intentEvents };
  } catch {
    return { status: 'unavailable' };
  }
}

export function resetGa4TokenCacheForTests() {
  tokenCache = { key: '', token: '', expiresAt: 0 };
}
