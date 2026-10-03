/*
 * Clearview Command Center service worker. Registered by src/scripts/internal-pwa.ts with scope
 * /internal (no trailing slash: Cloudflare Pages redirects /internal/ to /internal, so the Dashboard
 * page lives at the bare path), so it never sees the public marketing site. It lives at a public path on purpose:
 * functions/internal/_middleware.js redirects every unauthenticated /internal/* request to the
 * login page, and a service worker script is not allowed to redirect, so under /internal/ it
 * could not install or update once a session expired.
 *
 * What it does (full contract: .ai/references/internal-pwa.md):
 *  - Pages (/internal/* HTML): network first, saved copy when offline. The pages are static Astro
 *    output and contain no customer data, so a saved copy is safe. Redirects (the login bounce)
 *    are passed through and never saved.
 *  - Assets (/_astro, /fonts, icons, logos): cache first.
 *  - Data: GET only, and only the routes in DATA_ROUTES (the Today -> Jobs -> Field loop).
 *    Network first, saved copy for up to DATA_MAX_AGE_MS, marked with x-cv-cached-at, and the page
 *    is told so it can say "saved copy". Anything else under /internal/api is never touched.
 *  - Writes are never queued or replayed. A POST/PATCH/PUT/DELETE goes straight to the network
 *    and fails visibly offline: approval, price and state changes stay deterministic and online.
 *    For the DATA_ROUTES endpoints only, a connection failure is turned into a readable 503 JSON
 *    ("not saved") instead of the browser's "Failed to fetch"; a real response is never altered.
 *  - Logout and the login page clear saved data (message cv:clear).
 *
 * Bump VERSION when this file's caching behaviour changes; old caches are deleted on activate.
 * BUILD_ID changes on every deploy; that is what makes installed copies update (see src/lib/pwa-logic.ts).
 */
const VERSION = 'v1';
// Stamped at build time (astro.config.mjs) so every deploy changes this file's bytes: the browser then
// installs the new worker by itself and the open pages learn about it (cv:activated). Format
// "<epoch ms>-<commit>". Left as the placeholder in `astro dev`.
const BUILD_ID = '__BUILD_ID__';
const SHELL_CACHE = `cv-shell-${VERSION}`;
const ASSET_CACHE = `cv-assets-${VERSION}`; // assets seen at runtime; capped, oldest dropped first
const PINNED_CACHE = `cv-pinned-${VERSION}`; // exactly what the warmed pages need; swept, never capped
const DATA_CACHE = `cv-data-${VERSION}`;
const META_CACHE = `cv-meta-${VERSION}`; // small bookkeeping (warm-up state); no customer data
const ALL_CACHES = [SHELL_CACHE, ASSET_CACHE, PINNED_CACHE, DATA_CACHE, META_CACHE];
const WARM_STATE_KEY = '/__cv/warm-state';

const OFFLINE_URL = '/internal-offline.html';
const LOGIN_PATH = '/internal/login';

// Read-only endpoints worth having in a crawlspace. Customer PII lives in these responses, so the
// list is an allowlist: quote-share (signing tokens), quotes, invoices, payments, leads, analytics,
// copilot, ask-logs and every write are deliberately absent. test:internal-pwa pins this list.
const DATA_ROUTES = [
  /^\/internal\/api\/dashboard$/,
  /^\/internal\/api\/tasks$/,
  /^\/internal\/api\/jobs$/,
  /^\/internal\/api\/job-checklist$/,
  /^\/internal\/api\/job-evidence$/,
];
const DATA_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const DATA_MAX_ENTRIES = 80;
const ASSET_MAX_ENTRIES = 250;
const NETWORK_TIMEOUT_MS = 5000;

// Pages saved ahead of time (cv:warm) so they open with no signal. Must be real routes;
// test:internal-pwa checks each one exists in the build.
const WARM_PAGES = [
  '/internal',
  '/internal/today',
  '/internal/follow-up',
  '/internal/leads',
  '/internal/jobs',
  '/internal/jobs/view',
  '/internal/jobs/field',
  '/internal/tools',
  '/internal/tools/photos',
  '/internal/tools/measurements',
  '/internal/schedule',
];

// Data saved by warm-up under the exact URLs the pages request, so Today, Follow-up, Jobs and Schedule
// open with no signal, plus Field mode's three reads for each active job on the dashboard.
const WARM_DATA = [
  '/internal/api/dashboard',
  '/internal/api/tasks',
  '/internal/api/tasks?page=1',
  '/internal/api/jobs',
  '/internal/api/jobs?page=1',
];
const WARM_JOB_LIMIT = 8;
const FINISHED_JOB = new Set(['completed', 'cancelled']);

const ASSET_PREFIXES = ['/_astro/', '/fonts/', '/logo/'];
const ASSET_FILES = /^\/(?:favicon[\w.-]*|icon-[\w.-]+\.png|apple-touch-icon\.png)$/;

function shellKey(url) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  return `${url.origin}${path}`;
}

function isAsset(url) {
  return ASSET_PREFIXES.some((p) => url.pathname.startsWith(p)) || ASSET_FILES.test(url.pathname);
}

function isDataRoute(url) {
  return DATA_ROUTES.some((re) => re.test(url.pathname));
}

function isShellPath(url) {
  return url.pathname.startsWith('/internal/') || url.pathname === '/internal';
}

function isCacheable(response) {
  return (
    response.status === 200 &&
    !response.redirected &&
    response.type !== 'opaque' &&
    response.type !== 'opaqueredirect' &&
    response.type !== 'error'
  );
}

function contentType(response) {
  return (response.headers.get('content-type') || '').toLowerCase();
}

function wentToLogin(response) {
  if (!response.redirected || !response.url) return false;
  try { return new URL(response.url).pathname.replace(/\/+$/, '') === LOGIN_PATH; } catch { return false; }
}

async function broadcast(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

// A full disk or a quota error must not turn a good network response into a failure.
async function safePut(cache, key, response) {
  try { await cache.put(key, response); } catch { /* best effort */ }
}

// Browsers refuse to answer a navigation with a response that was itself redirected (Pages
// 308-redirects /x.html to /x), so anything saved for navigations is rebuilt as a plain 200.
async function plainCopy(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  return new Response(await response.arrayBuffer(), { status: 200, statusText: 'OK', headers });
}

// Any redirect on a JSON endpoint means the session ended: our own login bounce, or Cloudflare Access
// sending the browser to its sign-in on another origin (a fetch that follows that fails CORS and would
// look exactly like being offline). Data and write fetches use redirect: 'manual' to see it.
function sessionEndedJson() {
  return new Response(JSON.stringify({ error: 'Your session ended. Sign in again to continue.', code: 'SESSION_ENDED', sessionEnded: true }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

// The session ended (login bounce or Cloudflare Access): drop every saved customer record, not just
// the one that noticed, and tell the page.
async function endSession() {
  await caches.delete(DATA_CACHE);
  await broadcast({ type: 'cv:auth-expired' });
}

function offlineJson(message) {
  return new Response(JSON.stringify({ error: message, offline: true }), {
    status: 503,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

// ---- lifecycle -------------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const response = await fetch(OFFLINE_URL, { cache: 'reload' });
      if (!response.ok) throw new Error(`offline page ${response.status}`);
      await cache.put(OFFLINE_URL, await plainCopy(response));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('cv-') && !ALL_CACHES.includes(name)) await caches.delete(name);
      }
      await self.clients.claim();
      await broadcast({ type: 'cv:activated', build: BUILD_ID });
    })(),
  );
});

// ---- fetch -----------------------------------------------------------------------------------

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method !== 'GET') {
    // Writes always go straight to the network, never saved or replayed. Only the wording of a
    // dead connection changes, and only for the same endpoints the pages already read.
    if (WRITE_METHODS.has(request.method) && isDataRoute(url)) event.respondWith(handleWrite(request));
    return;
  }

  if (request.mode === 'navigate' && isShellPath(url)) {
    if (url.pathname.startsWith('/internal/api/')) return;
    event.respondWith(handleNavigation(request, url));
  } else if (isDataRoute(url)) {
    event.respondWith(handleData(request, url));
  } else if (isAsset(url)) {
    event.respondWith(handleAsset(request, url));
  }
});

async function handleWrite(request) {
  let response;
  try {
    response = await fetch(request, { redirect: 'manual' });
  } catch {
    return offlineJson('No connection, so this could not be confirmed as saved. Nothing was queued. Check it and try again when you have signal.');
  }
  if (response.type === 'opaqueredirect') {
    await endSession();
    return sessionEndedJson();
  }
  return response;
}

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

async function handleNavigation(request, url) {
  const cache = await caches.open(SHELL_CACHE);
  const key = shellKey(url);
  const saveable = url.pathname.replace(/\/+$/, '') !== LOGIN_PATH;

  const network = fetch(request).then(async (response) => {
    if (saveable && isCacheable(response) && contentType(response).includes('text/html')) {
      await safePut(cache, key, response.clone());
    }
    return response;
  });

  const saved = await cache.match(key);
  let response;
  try {
    // With a saved copy, a dead-slow connection gets it after the timeout; the network request
    // keeps going and refreshes the copy for next time.
    response = saved ? await withTimeout(network, NETWORK_TIMEOUT_MS) : await network;
  } catch {
    response = null;
  }
  if (response && !(saved && response.status >= 500)) return response;
  if (saved) return saved;
  if (response) return response;
  return (await caches.match(OFFLINE_URL)) || Response.error();
}

async function readFresh(cache, key) {
  const hit = await cache.match(key);
  if (!hit) return null;
  const at = Number(hit.headers.get('x-cv-cached-at'));
  if (!Number.isFinite(at) || Date.now() - at > DATA_MAX_AGE_MS) {
    await cache.delete(key);
    return null;
  }
  return hit;
}

async function saveData(cache, key, response) {
  const headers = new Headers(response.headers);
  headers.set('x-cv-cached-at', String(Date.now()));
  const body = await response.arrayBuffer();
  await safePut(cache, key, new Response(body, { status: 200, statusText: response.statusText, headers }));
  await trim(cache, DATA_MAX_ENTRIES);
}

async function serveSaved(saved) {
  const cachedAt = Number(saved.headers.get('x-cv-cached-at'));
  await broadcast({ type: 'cv:stale-data', cachedAt });
  const headers = new Headers(saved.headers);
  headers.set('x-cv-from-cache', '1');
  return new Response(await saved.arrayBuffer(), { status: 200, statusText: saved.statusText, headers });
}

async function handleData(request, url) {
  const cache = await caches.open(DATA_CACHE);
  const key = `${url.origin}${url.pathname}${url.search}`;

  const network = fetch(request, { redirect: 'manual' }).then(async (response) => {
    if (response.type === 'opaqueredirect') {
      await endSession();
      return sessionEndedJson();
    }
    if (response.ok && isCacheable(response) && contentType(response).includes('json')) {
      await saveData(cache, key, response.clone());
    } else if (wentToLogin(response) || (response.ok && !contentType(response).includes('json'))) {
      // Session ended: never show a saved copy of someone's data after that.
      await endSession();
    } else if (response.status === 401 || response.status === 403 || response.status === 404) {
      await cache.delete(key); // the server answered: the record is gone or off limits
    }
    return response;
  });

  const saved = await readFresh(cache, key);
  let response;
  try {
    response = saved ? await withTimeout(network, NETWORK_TIMEOUT_MS) : await network;
  } catch {
    response = null; // offline / connection failed
  }

  if (response && !(saved && response.status >= 500)) return response;
  if (saved) return serveSaved(saved);
  if (response) return response;
  return offlineJson('You are offline and this has not been saved on this phone yet.');
}

async function handleAsset(request, url) {
  const cache = await caches.open(ASSET_CACHE);
  const key = `${url.origin}${url.pathname}`;
  const hit = (await (await caches.open(PINNED_CACHE)).match(key)) || (await cache.match(key));
  if (hit) return hit;
  const response = await fetch(request);
  if (isCacheable(response)) {
    await safePut(cache, key, response.clone());
    await trim(cache, ASSET_MAX_ENTRIES);
  }
  return response;
}

// ---- warm-up: save the main pages and what they load ------------------------------------------

const ASSET_REF = /["'(](\/_astro\/[^"'()\s>\\]+)/g;
const IMPORT_REF = /["'`](\.{1,2}\/[\w./-]+\.(?:js|css|woff2?))["'`]/g;
const URL_REF = /url\(\s*["']?([^"')\s]+)["']?\s*\)/g;

async function ensureAsset(cache, url, seen, depth) {
  const key = `${url.origin}${url.pathname}`;
  if (seen.has(key) || depth > 3 || !isAsset(url)) return;
  seen.add(key);
  let response = await cache.match(key);
  if (!response) {
    // Reuse a copy already saved at runtime rather than downloading it again.
    const runtime = await (await caches.open(ASSET_CACHE)).match(key);
    response = runtime || (await fetch(key, { credentials: 'same-origin' }));
    if (!isCacheable(response)) {
      // A reference found inside a script or stylesheet may just be text that looks like a path: a 404 there is not
      // a missing asset. Anything else (a page's own asset, a server error) is a failed warm-up, so the pinned set is
      // not swept while a saved page may still need what could not be fetched.
      if (depth > 0 && (response.status === 404 || response.status === 410)) return;
      throw new Error(`asset ${key} answered ${response.status}`);
    }
    await safePut(cache, key, response.clone());
  }
  if (!/\.(?:js|css)$/.test(url.pathname)) return;
  const text = await response.clone().text();
  const refs = new Set();
  for (const m of text.matchAll(IMPORT_REF)) refs.add(m[1]);
  if (url.pathname.endsWith('.css')) for (const m of text.matchAll(URL_REF)) refs.add(m[1]);
  for (const ref of refs) {
    let next;
    try { next = new URL(ref, url); } catch { continue; }
    if (next.origin === url.origin) await ensureAsset(cache, next, seen, depth + 1);
  }
}

// Fetch one read-only endpoint and save it the way handleData would. Returns the parsed body, 'auth'
// when the session has ended, or null.
async function warmOne(cache, path, failed) {
  try {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-cache', redirect: 'manual' });
    if (response.type === 'opaqueredirect' || wentToLogin(response)) return 'auth';
    if (response.ok && isCacheable(response) && contentType(response).includes('json')) {
      const body = await response.clone().json();
      await saveData(cache, `${self.location.origin}${path}`, response);
      return body;
    }
  } catch { /* fall through */ }
  failed.push(path);
  return null;
}

async function warmData(failed) {
  const cache = await caches.open(DATA_CACHE);
  let saved = 0;
  let dashboard = null;
  for (const path of WARM_DATA) {
    const body = await warmOne(cache, path, failed);
    if (body === 'auth') return { signedOut: true, saved };
    if (body) saved += 1;
    if (path === '/internal/api/dashboard') dashboard = body;
  }
  const jobs = Array.isArray(dashboard && dashboard.recentJobs) ? dashboard.recentJobs : [];
  const active = jobs.filter((j) => j && typeof j.id === 'string' && !FINISHED_JOB.has(j.status)).slice(0, WARM_JOB_LIMIT);
  for (const job of active) {
    const id = encodeURIComponent(job.id);
    for (const path of [`/internal/api/jobs?id=${id}`, `/internal/api/job-checklist?jobId=${id}`, `/internal/api/job-evidence?jobId=${id}`]) {
      const body = await warmOne(cache, path, failed);
      if (body === 'auth') return { signedOut: true, saved };
      if (body) saved += 1;
    }
  }
  return { signedOut: false, saved };
}

// Warm-up state lives here, with the worker that does the work, not in the page: a page that asks for a
// warm-up is usually navigated away from before it finishes (this is a multi-page app), so it could never be
// trusted to record the result. okAt/okBuild: last clean run. attemptAt/attemptBuild: last run that has not
// finished cleanly (cleared on success), used by the page for its retry back-off.
async function readWarmState() {
  try {
    const hit = await (await caches.open(META_CACHE)).match(WARM_STATE_KEY);
    return hit ? await hit.json() : {};
  } catch {
    return {};
  }
}

async function writeWarmState(patch) {
  const next = { ...(await readWarmState()), ...patch };
  await safePut(await caches.open(META_CACHE), WARM_STATE_KEY, new Response(JSON.stringify(next), { headers: { 'content-type': 'application/json' } }));
}

// One warm-up at a time: several tabs or quick reloads share the run in progress.
let warming = null;
function warmOnce() {
  if (!warming) {
    warming = (async () => {
      await writeWarmState({ attemptAt: Date.now(), attemptBuild: BUILD_ID });
      const result = await warm();
      if (result.ok) await writeWarmState({ okAt: Date.now(), okBuild: BUILD_ID, attemptAt: 0 });
      return result;
    })().finally(() => { warming = null; });
  }
  return warming;
}

async function warm() {
  // Data first: it is also the sign-in probe. A redirect here (login or Cloudflare Access) means signed
  // out, so no page is fetched at all.
  const failed = [];
  const data = await warmData(failed);
  if (data.signedOut) {
    await endSession();
    return { ok: false, signedOut: true, saved: 0, failed };
  }
  const shell = await caches.open(SHELL_CACHE);
  const assets = await caches.open(PINNED_CACHE);
  const seen = new Set();
  let saved = 0;
  for (const path of WARM_PAGES) {
    const url = new URL(path, self.location.origin);
    let response;
    try {
      response = await fetch(url.href, { credentials: 'same-origin', cache: 'no-cache' });
    } catch {
      failed.push(path);
      continue;
    }
    // Signed out: the middleware bounced this to the login page. Stop; nothing is saved.
    if (wentToLogin(response)) {
      await endSession();
      return { ok: false, signedOut: true, saved, failed };
    }
    const okPage = response.status === 200 && response.type !== 'opaque' && response.type !== 'opaqueredirect';
    if (!okPage || !contentType(response).includes('text/html')) {
      failed.push(path);
      continue;
    }
    const html = await response.clone().text();
    await safePut(shell, shellKey(url), await plainCopy(response));
    saved += 1;
    const refs = new Set([...html.matchAll(ASSET_REF)].map((m) => m[1]));
    for (const ref of refs) {
      try { await ensureAsset(assets, new URL(ref, url), seen, 0); } catch { failed.push(ref); }
    }
  }
  // A clean run knows exactly which assets the saved pages need; drop the rest of the pinned set so
  // an unchanged chunk is never evicted by newer deploys and a replaced one does not pile up.
  if (failed.length === 0) {
    for (const request of await assets.keys()) {
      if (!seen.has(request.url)) await assets.delete(request);
    }
  }
  return { ok: failed.length === 0, signedOut: false, saved, dataSaved: data.saved, failed };
}

// ---- page <-> worker messages ----------------------------------------------------------------

async function clearData(scope) {
  await caches.delete(DATA_CACHE);
  if (scope === 'all') {
    await caches.delete(SHELL_CACHE);
    await caches.delete(ASSET_CACHE);
    await caches.delete(PINNED_CACHE);
    await caches.delete(META_CACHE);
  }
}

async function status() {
  const running = warming !== null; // read before any await: it must describe the moment of the request
  const count = async (name) => (await (await caches.open(name)).keys()).length;
  const data = await caches.open(DATA_CACHE);
  let newest = 0;
  for (const req of await data.keys()) {
    const hit = await data.match(req);
    const at = Number(hit && hit.headers.get('x-cv-cached-at'));
    if (at > newest) newest = at;
  }
  return {
    version: VERSION,
    build: BUILD_ID,
    warm: { ...(await readWarmState()), running },
    pages: Math.max(0, (await count(SHELL_CACHE)) - 1), // minus the offline fallback page
    assets: (await count(ASSET_CACHE)) + (await count(PINNED_CACHE)),
    data: await count(DATA_CACHE),
    newestDataAt: newest || null,
  };
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  const reply = (message) => { if (event.source && event.source.postMessage) event.source.postMessage(message); };
  if (data.type === 'cv:warm') {
    event.waitUntil(warmOnce().then((result) => reply({ type: 'cv:warm-done', ...result }), () => reply({ type: 'cv:warm-done', ok: false, failed: ['warm'] })));
  } else if (data.type === 'cv:clear') {
    event.waitUntil(clearData(data.scope === 'all' ? 'all' : 'data').then(() => reply({ type: 'cv:cleared', scope: data.scope === 'all' ? 'all' : 'data' })));
  } else if (data.type === 'cv:status') {
    event.waitUntil(status().then((s) => reply({ type: 'cv:status', ...s })));
  }
});
