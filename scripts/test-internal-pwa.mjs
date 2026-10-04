// Command Center PWA guard (run `npm run build` first; it also checks the built pages).
// Part 1 runs public/ops-sw.js in a sandbox with a fake Cache API and drives its fetch/message
// handlers: what is saved, what is never saved, what is served when offline, what is wiped.
// Part 2 checks the manifest, headers, and that every built internal page is wired up.
// Contract: .ai/references/internal-pwa.md
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
if (!existsSync(dist)) {
  console.error('dist/ not found. Run `npm run build` before `npm run test:internal-pwa`.');
  process.exit(1);
}

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (error) { failures += 1; console.error(`FAIL ${name}\n     ${error && error.stack ? error.stack.split('\n').slice(0, 8).join('\n     ') : error}`); }
}

// ---- sandbox ---------------------------------------------------------------------------------

const ORIGIN = 'https://test.local';
const swSource = readFileSync(join(root, 'public/ops-sw.js'), 'utf8');

class FakeCache {
  constructor() { this.map = new Map(); }
  static key(request) { return typeof request === 'string' ? new URL(request, ORIGIN).href : request.url; }
  async put(request, response) { this.map.set(FakeCache.key(request), response); }
  async match(request) { const hit = this.map.get(FakeCache.key(request)); return hit ? hit.clone() : undefined; }
  async delete(request) { return this.map.delete(FakeCache.key(request)); }
  async keys() { return [...this.map.keys()].map((url) => ({ url })); }
}

function makeWorld({ fetchImpl, setTimeoutImpl } = {}) {
  const stores = new Map();
  const listeners = {};
  const posted = [];
  const calls = { skipWaiting: 0, claim: 0, fetches: [], inits: [] };
  const caches = {
    async open(name) { if (!stores.has(name)) stores.set(name, new FakeCache()); return stores.get(name); },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match(request) { for (const cache of stores.values()) { const hit = await cache.match(request); if (hit) return hit; } return undefined; },
  };
  const world = {
    routes: new Map(),
    stores,
    posted,
    calls,
    async fetch(request, init) {
      const url = typeof request === 'string' ? new URL(request, ORIGIN).href : request.url;
      calls.fetches.push(url);
      calls.inits.push({ url, init });
      if (fetchImpl) return fetchImpl(url, request, world);
      const route = world.routes.get(new URL(url).pathname + new URL(url).search) || world.routes.get(new URL(url).pathname);
      if (!route) return new Response('not found', { status: 404 });
      return typeof route === 'function' ? route() : route.clone();
    },
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener(type, fn) { listeners[type] = fn; },
    skipWaiting: async () => { calls.skipWaiting += 1; },
    clients: {
      claim: async () => { calls.claim += 1; },
      matchAll: async () => [{ postMessage: (m) => posted.push(m) }],
    },
  };
  const context = vm.createContext({
    self, caches, fetch: (...a) => world.fetch(...a), Response, Request, Headers, URL, Date, Promise, Set, Map, Math, Number, Array, JSON, console,
    setTimeout: setTimeoutImpl || setTimeout, clearTimeout,
  });
  vm.runInContext(swSource, context, { filename: 'ops-sw.js' });
  world.read = (expr) => vm.runInContext(expr, context);
  world.install = async () => { let p; await listeners.install({ waitUntil: (x) => { p = x; } }); await p; };
  world.activate = async () => { let p; await listeners.activate({ waitUntil: (x) => { p = x; } }); await p; };
  world.request = async (path, { method = 'GET', mode = 'cors', origin = ORIGIN } = {}) => {
    const request = { url: new URL(path, origin).href, method, mode, headers: new Headers() };
    let responded = null;
    listeners.fetch({ request, respondWith: (p) => { responded = Promise.resolve(p); } });
    return responded; // null => the worker did not touch the request
  };
  world.message = async (data) => {
    const replies = [];
    let p;
    await listeners.message({ data, source: { postMessage: (m) => replies.push(m) }, waitUntil: (x) => { p = x; } });
    await p;
    return replies;
  };
  return world;
}

const html = (body = '<html></html>', init = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });
const json = (obj, init = {}) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
function flagged(response, props) { for (const [k, v] of Object.entries(props)) Object.defineProperty(response, k, { value: v }); return response; }
const loginBounce = () => flagged(html('<html>login</html>'), { redirected: true, url: `${ORIGIN}/internal/login?next=%2Finternal%2Ftoday` });
const offline = () => { throw new TypeError('Failed to fetch'); };
// What fetch(..., { redirect: 'manual' }) returns when the server redirects: our login page, or Cloudflare Access on another origin.
const dataSize = (w) => (w.stores.get('cv-data-v1') ? w.stores.get('cv-data-v1').map.size : 0);
const accessRedirect = () => flagged(new Response(null, { status: 200 }), { type: 'opaqueredirect' });
const routeWarmData = (w) => { for (const path of w.read('WARM_DATA')) if (!w.routes.has(path)) w.routes.set(path, () => json({})); };

async function ready(world) {
  world.routes.set('/ops-offline.html', html('<html>offline page</html>'));
  await world.install();
  await world.activate();
  return world;
}

// ---- part 1: worker behaviour ----------------------------------------------------------------

await test('install saves the offline page as a plain 200 and activates immediately', async () => {
  const w = makeWorld();
  w.routes.set('/ops-offline.html', () => flagged(html('<html>offline page</html>'), { redirected: true, url: `${ORIGIN}/ops-offline` }));
  await w.install();
  const saved = await (await w.stores.get('cv-shell-v1')).match('/ops-offline.html');
  assert.equal(saved.status, 200);
  assert.equal(saved.redirected, false, 'a redirected response cannot answer a navigation');
  assert.match(await saved.text(), /offline page/);
  assert.equal(w.calls.skipWaiting, 1);
});

await test('activate deletes old cv-* caches, keeps current ones and other caches, and claims clients', async () => {
  const w = await ready(makeWorld());
  for (const name of ['cv-shell-v0', 'cv-data-v0', 'unrelated']) w.stores.set(name, new FakeCache());
  const claimed = w.calls.claim;
  await w.activate();
  assert.deepEqual([...w.stores.keys()].sort(), ['cv-shell-v1', 'unrelated']);
  assert.equal(w.calls.claim, claimed + 1);
});

await test('updates: activate tells open pages which build is now running; status reports it', async () => {
  const w = await ready(makeWorld());
  const activated = w.posted.find((m) => m.type === 'cv:activated');
  assert.ok(activated, 'cv:activated broadcast on activate');
  assert.equal(activated.build, w.read('BUILD_ID'));
  const [status] = await w.message({ type: 'cv:status' });
  assert.equal(status.build, w.read('BUILD_ID'));
  assert.equal(w.calls.skipWaiting, 1, 'a new worker takes over without waiting for every tab to close');
});

await test('only the allowlisted read endpoints are intercepted; writes, other origins and sensitive APIs never are', async () => {
  const w = await ready(makeWorld());
  const intercepted = ['/internal/api/dashboard', '/internal/api/tasks', '/internal/api/jobs?id=J1', '/internal/api/job-checklist?jobId=J1', '/internal/api/job-evidence?jobId=J1'];
  for (const path of intercepted) assert.notEqual(await w.request(path), null, `${path} should be handled`);
  const untouched = [
    '/internal/api/quote-share', '/internal/api/quotes', '/internal/api/quotes/Q1', '/internal/api/invoices', '/internal/api/payments',
    '/internal/api/leads', '/internal/api/analytics', '/internal/api/copilot', '/internal/api/copilot-summary', '/internal/api/ask-logs',
    '/internal/api/lead-analyzer', '/internal/api/permit-leads', '/internal/api/mail-test', '/internal/api/login', '/internal/api/logout',
    '/internal/api/job-photos?id=P1', '/internal/api/review-request', '/internal/api/job-closeout', '/internal/api/build-plan', '/internal/api/dashboard/extra',
    '/api/estimate', '/api/quote-sign', '/ask/api/chat',
  ];
  for (const path of untouched) assert.equal(await w.request(path), null, `${path} must pass straight through`);
  // Writes to the allowlisted endpoints are handled only to word a dead connection; writes anywhere else are untouched.
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    assert.notEqual(await w.request('/internal/api/jobs?id=J1', { method }), null, `${method} wording wrapper`);
    for (const path of ['/internal/api/quotes/Q1', '/internal/api/invoices/I1', '/internal/api/job-photos?jobId=J1', '/internal/api/quote-share', '/internal/api/payments', '/internal/api/logout', '/internal/api/login']) {
      assert.equal(await w.request(path, { method }), null, `${method} ${path} must pass straight through`);
    }
  }
  assert.equal(await w.request('/internal/api/dashboard', { origin: 'https://evil.example' }), null);
});

await test('writes: a real answer passes through untouched and nothing is saved or queued', async () => {
  const w = await ready(makeWorld());
  w.routes.set('/internal/api/job-checklist?id=7', () => json({ error: 'locked' }, { status: 409 }));
  const response = await w.request('/internal/api/job-checklist?id=7', { method: 'PATCH' });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'locked');
  assert.ok(!w.stores.has('cv-data-v1') || (await w.stores.get('cv-data-v1')).map.size === 0);
  assert.equal(w.calls.fetches.filter((u) => u.includes('job-checklist')).length, 1, 'sent once, never replayed');
});

await test('writes: a dead connection becomes a readable 503 that says it was not confirmed saved', async () => {
  const w = await ready(makeWorld());
  w.routes.set('/internal/api/job-checklist?id=7', offline);
  const response = await w.request('/internal/api/job-checklist?id=7', { method: 'PATCH' });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.offline, true);
  assert.match(body.error, /could not be confirmed as saved/);
  assert.match(body.error, /Nothing was queued/);
  assert.equal(w.calls.fetches.filter((u) => u.includes('job-checklist')).length, 1, 'not retried');
});

await test('data: network answer is returned and saved with a timestamp', async () => {
  const w = await ready(makeWorld());
  w.routes.set('/internal/api/dashboard', () => json({ counts: { open_tasks: 3 } }));
  const response = await (await w.request('/internal/api/dashboard'));
  assert.deepEqual(await response.json(), { counts: { open_tasks: 3 } });
  const saved = await (await w.stores.get('cv-data-v1')).match('/internal/api/dashboard');
  assert.ok(Number(saved.headers.get('x-cv-cached-at')) > 0);
});

await test('data: offline serves the saved copy, marks it, and tells the page', async () => {
  const w = await ready(makeWorld());
  w.routes.set('/internal/api/jobs?id=J1', () => json({ job: { id: 'J1' } }));
  await w.request('/internal/api/jobs?id=J1').then((r) => r.json());
  w.routes.set('/internal/api/jobs?id=J1', offline);
  const response = await w.request('/internal/api/jobs?id=J1');
  assert.deepEqual(await response.json(), { job: { id: 'J1' } });
  assert.equal(response.headers.get('x-cv-from-cache'), '1');
  assert.ok(w.posted.some((m) => m.type === 'cv:stale-data' && m.cachedAt > 0));
});

await test('data: copies are per URL, so one job never answers for another', async () => {
  const w = await ready(makeWorld());
  w.routes.set('/internal/api/jobs?id=J1', () => json({ job: { id: 'J1' } }));
  await w.request('/internal/api/jobs?id=J1').then((r) => r.json());
  w.routes.set('/internal/api/jobs?id=J2', offline);
  const response = await w.request('/internal/api/jobs?id=J2');
  assert.equal(response.status, 503);
  assert.equal((await response.json()).offline, true);
});

await test('data: offline with nothing saved answers a readable 503 JSON, not a network error', async () => {
  const w = await ready(makeWorld());
  w.routes.set('/internal/api/tasks', offline);
  const response = await w.request('/internal/api/tasks');
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /offline/i);
  assert.equal(body.offline, true);
});

await test('data: a copy older than three days is never served', async () => {
  const w = await ready(makeWorld());
  const store = w.stores.get('cv-data-v1') || (w.stores.set('cv-data-v1', new FakeCache()), w.stores.get('cv-data-v1'));
  const old = Date.now() - 3 * 24 * 60 * 60 * 1000 - 60_000;
  await store.put('/internal/api/dashboard', json({ stale: true }, { headers: { 'content-type': 'application/json', 'x-cv-cached-at': String(old) } }));
  w.routes.set('/internal/api/dashboard', offline);
  const response = await w.request('/internal/api/dashboard');
  assert.equal(response.status, 503);
  assert.equal(store.map.size, 0, 'expired copy is removed');
});

await test('data: a 5xx with a saved copy serves the copy; a 5xx with none passes through', async () => {
  const w = await ready(makeWorld());
  w.routes.set('/internal/api/dashboard', () => json({ ok: 1 }));
  await w.request('/internal/api/dashboard').then((r) => r.json());
  w.routes.set('/internal/api/dashboard', () => new Response('boom', { status: 502 }));
  assert.deepEqual(await (await w.request('/internal/api/dashboard')).json(), { ok: 1 });
  w.routes.set('/internal/api/tasks', () => new Response('boom', { status: 500 }));
  assert.equal((await w.request('/internal/api/tasks')).status, 500);
});

await test('data: 401/403/404 are real answers and delete the saved copy', async () => {
  for (const status of [401, 403, 404]) {
    const w = await ready(makeWorld());
    w.routes.set('/internal/api/jobs?id=J1', () => json({ job: 1 }));
    await w.request('/internal/api/jobs?id=J1').then((r) => r.json());
    w.routes.set('/internal/api/jobs?id=J1', () => json({ error: 'gone' }, { status }));
    const response = await w.request('/internal/api/jobs?id=J1');
    assert.equal(response.status, status);
    assert.equal((await w.stores.get('cv-data-v1')).map.size, 0, `${status} drops the copy`);
  }
});

await test('data: an ended session (login bounce) is passed through, saved data is dropped, the page is told', async () => {
  const w = await ready(makeWorld());
  w.routes.set('/internal/api/dashboard', () => json({ secret: 'customer list' }));
  await w.request('/internal/api/dashboard').then((r) => r.json());
  w.routes.set('/internal/api/dashboard', loginBounce);
  const response = await w.request('/internal/api/dashboard');
  assert.match(await response.text(), /login/);
  assert.equal(dataSize(w), 0);
  assert.ok(w.posted.some((m) => m.type === 'cv:auth-expired'));
  assert.ok(!w.posted.some((m) => m.type === 'cv:stale-data'), 'no saved copy is shown after the session ended');
});

await test('data: any redirect (login or Cloudflare Access) is "session ended", not "offline"; saved copy dropped', async () => {
  const w = await ready(makeWorld());
  w.routes.set('/internal/api/dashboard', () => json({ secret: 'customer list' }));
  await w.request('/internal/api/dashboard').then((r) => r.json());
  w.routes.set('/internal/api/dashboard', accessRedirect);
  const response = await w.request('/internal/api/dashboard');
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.code, 'SESSION_ENDED');
  assert.match(body.error, /session ended/i);
  assert.equal(dataSize(w), 0);
  assert.ok(w.posted.some((m) => m.type === 'cv:auth-expired'));
  assert.ok(!w.posted.some((m) => m.type === 'cv:stale-data'), 'no saved copy after the session ended');
  assert.ok(w.calls.inits.filter((c) => c.url.includes('/api/dashboard')).every((c) => c.init && c.init.redirect === 'manual'), 'data fetches must not follow redirects');
});

await test('writes: a redirect is "session ended" (401), not "not saved"; writes do not follow redirects', async () => {
  const w = await ready(makeWorld());
  w.routes.set('/internal/api/tasks?id=1', accessRedirect);
  const response = await w.request('/internal/api/tasks?id=1', { method: 'PATCH' });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'SESSION_ENDED');
  assert.ok(w.posted.some((m) => m.type === 'cv:auth-expired'));
  assert.equal(w.calls.inits.find((c) => c.url.includes('tasks?id=1')).init.redirect, 'manual');
  assert.equal(w.calls.fetches.filter((u) => u.includes('tasks?id=1')).length, 1, 'never replayed');
});

await test('session end wipes ALL saved data, not only the endpoint that noticed', async () => {
  for (const trigger of ['data', 'write', 'warm']) {
    const w = await ready(makeWorld());
    routeWarmData(w);
    w.routes.set('/internal/api/jobs?id=J1', () => json({ job: 'J1' }));
    w.routes.set('/internal/api/tasks', () => json({ tasks: ['call Pat'] }));
    await w.request('/internal/api/jobs?id=J1').then((r) => r.json());
    await w.request('/internal/api/tasks').then((r) => r.json());
    assert.equal(dataSize(w), 2);
    if (trigger === 'data') { w.routes.set('/internal/api/dashboard', accessRedirect); await w.request('/internal/api/dashboard'); }
    if (trigger === 'write') { w.routes.set('/internal/api/job-checklist?id=1', accessRedirect); await w.request('/internal/api/job-checklist?id=1', { method: 'PATCH' }); }
    if (trigger === 'warm') { w.routes.set('/internal/api/dashboard', accessRedirect); await w.message({ type: 'cv:warm' }); }
    assert.equal(dataSize(w), 0, `${trigger}: every saved record is gone`);
    assert.ok(w.posted.some((m) => m.type === 'cv:auth-expired'), `${trigger}: page told`);
  }
});

await test('data: non-JSON 200s and redirects are never saved', async () => {
  const w = await ready(makeWorld());
  w.routes.set('/internal/api/tasks', () => html('<html>not json</html>'));
  await w.request('/internal/api/tasks').then((r) => r.text());
  w.routes.set('/internal/api/jobs', () => flagged(json({ x: 1 }), { redirected: true, url: `${ORIGIN}/elsewhere` }));
  await w.request('/internal/api/jobs').then((r) => r.text());
  assert.equal((await w.stores.get('cv-data-v1')).map.size, 0);
});

await test('data: a slow network gets the saved copy after the timeout', async () => {
  const w = await ready(makeWorld({ setTimeoutImpl: (fn, ms) => setTimeout(fn, ms / 1000) }));
  w.routes.set('/internal/api/dashboard', () => json({ v: 1 }));
  await w.request('/internal/api/dashboard').then((r) => r.json());
  w.routes.set('/internal/api/dashboard', () => new Promise((resolve) => setTimeout(() => resolve(json({ v: 2 })), 400)));
  const response = await w.request('/internal/api/dashboard');
  assert.deepEqual(await response.json(), { v: 1 });
  assert.equal(response.headers.get('x-cv-from-cache'), '1');
});

await test('data: saved entries are capped', async () => {
  const w = await ready(makeWorld());
  const max = w.read('DATA_MAX_ENTRIES');
  w.routes.set('/internal/api/jobs', () => json({ ok: 1 }));
  for (let i = 0; i < max + 5; i++) await w.request(`/internal/api/jobs?id=J${i}`).then((r) => r.json());
  assert.equal((await w.stores.get('cv-data-v1')).map.size, max);
});

await test('pages: network first; saved under a query-free, slash-free key; served when offline', async () => {
  const w = await ready(makeWorld());
  w.routes.set('/internal/jobs/view', () => html('<html>job page</html>'));
  await (await w.request('/internal/jobs/view?id=J1', { mode: 'navigate' })).text();
  assert.deepEqual([...(await w.stores.get('cv-shell-v1')).map.keys()].filter((k) => k.includes('/jobs')), [`${ORIGIN}/internal/jobs/view`]);
  w.routes.set('/internal/jobs/view', offline);
  assert.match(await (await w.request('/internal/jobs/view?id=J2', { mode: 'navigate' })).text(), /job page/);
  w.routes.set('/internal', () => html('<html>dashboard</html>'));
  await (await w.request('/internal', { mode: 'navigate' })).text();
  w.routes.set('/internal', offline);
  w.routes.set('/internal/', offline);
  assert.match(await (await w.request('/internal/', { mode: 'navigate' })).text(), /dashboard/, '/internal/ and /internal are the same saved page');
});

await test('pages: the offline page answers an unsaved page; nothing is invented', async () => {
  const w = await ready(makeWorld());
  w.routes.set('/internal/payments', offline);
  const response = await w.request('/internal/payments', { mode: 'navigate' });
  assert.match(await response.text(), /offline page/);
});

await test('pages: redirects, the login page and API paths are never saved', async () => {
  const w = await ready(makeWorld());
  w.routes.set('/internal/today', () => flagged(html('<html>login</html>'), { redirected: true, url: `${ORIGIN}/internal/login` }));
  await (await w.request('/internal/today', { mode: 'navigate' })).text();
  w.routes.set('/internal/today', () => flagged(new Response(null, { status: 200 }), { type: 'opaqueredirect' }));
  await w.request('/internal/today', { mode: 'navigate' });
  w.routes.set('/internal/login', () => html('<html>login form</html>'));
  await (await w.request('/internal/login', { mode: 'navigate' })).text();
  assert.equal(await w.request('/internal/api/quotes', { mode: 'navigate' }), null, 'API paths are not handled as pages');
  const keys = [...(await w.stores.get('cv-shell-v1')).map.keys()];
  assert.deepEqual(keys, [`${ORIGIN}/ops-offline.html`]);
});

await test('pages: a 5xx falls back to the saved page when there is one', async () => {
  const w = await ready(makeWorld());
  w.routes.set('/internal/leads', () => html('<html>leads</html>'));
  await (await w.request('/internal/leads', { mode: 'navigate' })).text();
  w.routes.set('/internal/leads', () => new Response('bad gateway', { status: 502 }));
  assert.match(await (await w.request('/internal/leads', { mode: 'navigate' })).text(), /leads/);
});

await test('assets: cache first, saved on first use, only for /_astro, /fonts, /logo and icons', async () => {
  const w = await ready(makeWorld());
  w.routes.set('/_astro/app.abc123.js', () => new Response('console.log(1)', { status: 200, headers: { 'content-type': 'text/javascript' } }));
  await (await w.request('/_astro/app.abc123.js')).text();
  w.routes.set('/_astro/app.abc123.js', offline);
  assert.equal(await (await w.request('/_astro/app.abc123.js')).text(), 'console.log(1)');
  for (const path of ['/fonts/x.woff2', '/logo/mark.png', '/icon-192.png', '/apple-touch-icon.png', '/favicon-32.png']) assert.notEqual(await w.request(path), null, path);
  for (const path of ['/gallery.html', '/video/hero.mp4', '/api/estimate']) assert.equal(await w.request(path), null, path);
});

await test('warm: saves every page and the assets they pull in, and reports', async () => {
  const w = await ready(makeWorld());
  const pages = w.read('WARM_PAGES');
  routeWarmData(w);
  for (const path of pages) w.routes.set(path, () => html(`<html><link rel="stylesheet" href="/_astro/page.css"><script type="module" src="/_astro/page.js"></script>${path}</html>`));
  w.routes.set('/_astro/page.css', () => new Response('a{background:url(/_astro/pic.png)}', { status: 200, headers: { 'content-type': 'text/css' } }));
  w.routes.set('/_astro/pic.png', () => new Response('png', { status: 200, headers: { 'content-type': 'image/png' } }));
  w.routes.set('/_astro/page.js', () => new Response('import"./chunk.js";', { status: 200, headers: { 'content-type': 'text/javascript' } }));
  w.routes.set('/_astro/chunk.js', () => new Response('export{}', { status: 200, headers: { 'content-type': 'text/javascript' } }));
  const [reply] = await w.message({ type: 'cv:warm' });
  assert.equal(reply.type, 'cv:warm-done');
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.equal(reply.saved, pages.length);
  const assets = [...(await w.stores.get('cv-pinned-v1')).map.keys()].map((k) => new URL(k).pathname).sort();
  assert.deepEqual(assets, ['/_astro/chunk.js', '/_astro/page.css', '/_astro/page.js', '/_astro/pic.png']);
  const saved = await (await w.stores.get('cv-shell-v1')).match('/internal/today');
  assert.equal(saved.redirected, false);
});

await test('warm: saves the list data and Field mode reads for each active job, under the URLs the pages request', async () => {
  const w = await ready(makeWorld());
  for (const path of w.read('WARM_PAGES')) w.routes.set(path, () => html('<html></html>'));
  w.routes.set('/internal/api/dashboard', () => json({ recentJobs: [{ id: 'J-1', status: 'scheduled' }, { id: 'J 2', status: 'in-progress' }, { id: 'J-3', status: 'completed' }, { id: 'J-4', status: 'cancelled' }] }));
  for (const path of w.read('WARM_DATA')) if (!w.routes.has(path)) w.routes.set(path, () => json({ ok: true }));
  for (const id of ['J-1', 'J%202']) {
    w.routes.set(`/internal/api/jobs?id=${id}`, () => json({ job: { id } }));
    w.routes.set(`/internal/api/job-checklist?jobId=${id}`, () => json({ items: [] }));
    w.routes.set(`/internal/api/job-evidence?jobId=${id}`, () => json({ evidence: [] }));
  }
  const [reply] = await w.message({ type: 'cv:warm' });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  const keys = [...(await w.stores.get('cv-data-v1')).map.keys()].map((k) => k.replace(ORIGIN, '')).sort();
  assert.deepEqual(keys, [
    '/internal/api/dashboard', '/internal/api/job-checklist?jobId=J%202', '/internal/api/job-checklist?jobId=J-1',
    '/internal/api/job-evidence?jobId=J%202', '/internal/api/job-evidence?jobId=J-1', '/internal/api/jobs', '/internal/api/jobs?id=J%202',
    '/internal/api/jobs?id=J-1', '/internal/api/jobs?page=1', '/internal/api/tasks', '/internal/api/tasks?page=1',
  ].sort(), 'finished jobs are not saved');
  // A saved job opens offline exactly as the Field page asks for it.
  for (const path of w.read('WARM_DATA')) w.routes.set(path, offline);
  w.routes.set('/internal/api/jobs?id=J-1', offline);
  const response = await w.request('/internal/api/jobs?id=J-1');
  assert.deepEqual(await response.json(), { job: { id: 'J-1' } });
});

await test('warm: no more than the job limit are saved, and a signed-out data fetch stops cleanly', async () => {
  const w = await ready(makeWorld());
  for (const path of w.read('WARM_PAGES')) w.routes.set(path, () => html('<html></html>'));
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `J${i}`, status: 'scheduled' }));
  w.routes.set('/internal/api/dashboard', () => json({ recentJobs: many }));
  for (const path of w.read('WARM_DATA')) if (!w.routes.has(path)) w.routes.set(path, () => json({}));
  const originalFetch = w.fetch;
  w.fetch = async (request) => {
    const url = typeof request === 'string' ? request : request.url;
    if (/job-checklist|job-evidence|jobs\?id=/.test(url)) return json({ ok: 1 });
    return originalFetch(request);
  };
  const [reply] = await w.message({ type: 'cv:warm' });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  const jobKeys = [...(await w.stores.get('cv-data-v1')).map.keys()].filter((k) => k.includes('jobs?id='));
  assert.equal(jobKeys.length, w.read('WARM_JOB_LIMIT'));
  const w2 = await ready(makeWorld());
  for (const path of w2.read('WARM_PAGES')) w2.routes.set(path, () => html('<html></html>'));
  w2.routes.set('/internal/api/dashboard', loginBounce);
  const [signedOut] = await w2.message({ type: 'cv:warm' });
  assert.equal(signedOut.signedOut, true);
  assert.equal(signedOut.ok, false);
});

await test('warm: overlapping requests share one run', async () => {
  const w = await ready(makeWorld());
  routeWarmData(w);
  for (const path of w.read('WARM_PAGES')) w.routes.set(path, () => html('<html></html>'));
  const [a, b] = await Promise.all([w.message({ type: 'cv:warm' }), w.message({ type: 'cv:warm' })]);
  assert.equal(a[0].ok, true);
  assert.equal(b[0].ok, true);
  const today = w.calls.fetches.filter((u) => u.endsWith('/internal/today')).length;
  assert.equal(today, 1, 'each page fetched once, not once per request');
});

await test('warm: the pinned asset set is swept to exactly what the pages need, and only after a clean run', async () => {
  const w = await ready(makeWorld());
  routeWarmData(w);
  const page = (asset) => () => html(`<html><script type="module" src="${asset}"></script></html>`);
  const js = (body) => () => new Response(body, { status: 200, headers: { 'content-type': 'text/javascript' } });
  for (const path of w.read('WARM_PAGES')) w.routes.set(path, page('/_astro/v1.js'));
  w.routes.set('/_astro/v1.js', js('1'));
  await w.message({ type: 'cv:warm' });
  const pinned = async () => [...(await w.stores.get('cv-pinned-v1')).map.keys()].map((k) => new URL(k).pathname);
  assert.deepEqual(await pinned(), ['/_astro/v1.js']);
  // A run with a failing page must not sweep: nothing the saved pages still need is lost.
  for (const path of w.read('WARM_PAGES')) w.routes.set(path, page('/_astro/v2.js'));
  w.routes.set('/_astro/v2.js', js('2'));
  w.routes.set(w.read('WARM_PAGES')[1], offline);
  await w.message({ type: 'cv:warm' });
  assert.deepEqual((await pinned()).sort(), ['/_astro/v1.js', '/_astro/v2.js']);
  // A clean run keeps only the current set.
  w.routes.set(w.read('WARM_PAGES')[1], page('/_astro/v2.js'));
  await w.message({ type: 'cv:warm' });
  assert.deepEqual(await pinned(), ['/_astro/v2.js']);
  // Runtime-capped assets are a separate cache: the cap cannot evict a pinned file.
  w.routes.set('/_astro/other.js', js('x'));
  await w.request('/_astro/other.js').then((r) => r.text());
  assert.ok((await w.stores.get('cv-assets-v1')).map.has(`${ORIGIN}/_astro/other.js`));
  for (const path of w.read('WARM_PAGES')) w.routes.set(path, offline);
  w.routes.set('/_astro/v2.js', offline);
  assert.equal(await (await w.request('/_astro/v2.js')).text(), '2', 'served from the pinned set');
  await w.message({ type: 'cv:clear', scope: 'all' });
  assert.ok(![...w.stores.keys()].some((k) => k.startsWith('cv-')));
});

await test('warm state lives in the worker: clean run recorded, failed run backs off, running is visible, clear resets', async () => {
  const w = await ready(makeWorld());
  routeWarmData(w);
  for (const path of w.read('WARM_PAGES')) w.routes.set(path, () => html('<html></html>'));
  const status = async () => (await w.message({ type: 'cv:status' }))[0];
  assert.equal(JSON.stringify((await status()).warm), JSON.stringify({ running: false }), 'nothing yet');
  // A page asking for a warm-up can disappear before it finishes; the result is still recorded for the next page.
  const run = w.message({ type: 'cv:warm' });
  const during = await status();
  assert.equal(during.warm.running, true, 'a second page can see a run is in progress');
  await run;
  const done = (await status()).warm;
  assert.equal(done.running, false);
  assert.equal(done.okBuild, w.read('BUILD_ID'));
  assert.ok(done.okAt > 0);
  assert.equal(done.attemptAt, 0, 'back-off marker cleared by a clean run');
  // A failing run records the attempt (the page backs off) but not a success.
  w.routes.set(w.read('WARM_PAGES')[0], offline);
  await w.message({ type: 'cv:warm' });
  const failed = (await status()).warm;
  assert.ok(failed.attemptAt > 0);
  assert.equal(failed.okBuild, w.read('BUILD_ID'), 'the earlier clean run is still the last success');
  await w.message({ type: 'cv:clear', scope: 'all' });
  assert.equal(JSON.stringify((await status()).warm), JSON.stringify({ running: false }), 'reset with the saved pages');
});

await test('warm: an asset that cannot be fetched is a failed run, so nothing is swept; look-alike paths inside scripts are ignored', async () => {
  const w = await ready(makeWorld());
  routeWarmData(w);
  const js = (body) => () => new Response(body, { status: 200, headers: { 'content-type': 'text/javascript' } });
  const page = (assets) => () => html(`<html>${assets.map((a) => `<script type="module" src="${a}"></script>`).join('')}</html>`);
  for (const path of w.read('WARM_PAGES')) w.routes.set(path, page(['/_astro/keep.js']));
  w.routes.set('/_astro/keep.js', js('export{}'));
  await w.message({ type: 'cv:warm' });
  const pinned = async () => [...(await w.stores.get('cv-pinned-v1')).map.keys()].map((k) => new URL(k).pathname).sort();
  assert.deepEqual(await pinned(), ['/_astro/keep.js']);
  // A page's own asset answers 404: the run fails and the pinned set (which an older saved page may still use) is kept.
  for (const path of w.read('WARM_PAGES')) w.routes.set(path, page(['/_astro/new.js', '/_astro/gone.js']));
  w.routes.set('/_astro/new.js', js('export{}'));
  const [failedRun] = await w.message({ type: 'cv:warm' });
  assert.equal(failedRun.ok, false);
  assert.ok(failedRun.failed.some((f) => f.includes('gone.js')));
  assert.ok((await pinned()).includes('/_astro/keep.js'), 'no sweep after a failed asset fetch');
  // A server error on a page asset fails the run too.
  w.routes.set('/_astro/gone.js', () => new Response('boom', { status: 503 }));
  assert.equal((await w.message({ type: 'cv:warm' }))[0].ok, false);
  // A look-alike path inside a script is not a missing asset.
  for (const path of w.read('WARM_PAGES')) w.routes.set(path, page(['/_astro/new.js']));
  w.routes.set('/_astro/new.js', js('const x="./not-a-real-file.js";export{}'));
  const [cleanRun] = await w.message({ type: 'cv:warm' });
  assert.equal(cleanRun.ok, true, JSON.stringify(cleanRun));
  assert.deepEqual(await pinned(), ['/_astro/new.js'], 'clean run sweeps down to exactly the current set');
});

await test('warm: signed out (login bounce) stops and saves nothing', async () => {
  const w = await ready(makeWorld());
  for (const path of w.read('WARM_PAGES')) w.routes.set(path, loginBounce);
  const [reply] = await w.message({ type: 'cv:warm' });
  assert.equal(reply.signedOut, true);
  assert.equal(reply.ok, false);
  assert.equal((await w.stores.get('cv-shell-v1')).map.size, 1, 'only the offline page');
});

await test('warm: a sign-in redirect on the first data probe stops everything before any page is fetched', async () => {
  const w = await ready(makeWorld());
  for (const path of w.read('WARM_PAGES')) w.routes.set(path, () => html('<html></html>'));
  w.routes.set('/internal/api/dashboard', accessRedirect);
  const [reply] = await w.message({ type: 'cv:warm' });
  assert.equal(reply.signedOut, true);
  assert.equal(reply.ok, false);
  assert.equal(w.calls.fetches.filter((u) => /\/internal\/(today|jobs|tools)/.test(u) && !u.includes('/api/')).length, 0);
  assert.equal((await w.stores.get('cv-shell-v1')).map.size, 1, 'only the offline page');
});

await test('warm: a page that fails is reported, the rest still save', async () => {
  const w = await ready(makeWorld());
  const pages = w.read('WARM_PAGES');
  routeWarmData(w);
  pages.forEach((path, i) => w.routes.set(path, i === 2 ? offline : () => html('<html></html>')));
  const [reply] = await w.message({ type: 'cv:warm' });
  assert.equal(reply.ok, false);
  assert.equal(reply.failed.length, 1);
  assert.equal(reply.saved, pages.length - 1);
});

await test('clear: data scope wipes customer data only; all scope also drops pages and assets', async () => {
  const w = await ready(makeWorld());
  w.routes.set('/internal/api/dashboard', () => json({ a: 1 }));
  await w.request('/internal/api/dashboard').then((r) => r.json());
  w.routes.set('/internal/leads', () => html('<html></html>'));
  await w.request('/internal/leads', { mode: 'navigate' }).then((r) => r.text());
  let [reply] = await w.message({ type: 'cv:clear', scope: 'data' });
  assert.equal(JSON.stringify(reply), JSON.stringify({ type: 'cv:cleared', scope: 'data' }));
  assert.ok(!w.stores.has('cv-data-v1'));
  assert.ok(w.stores.has('cv-shell-v1'));
  [reply] = await w.message({ type: 'cv:clear', scope: 'all' });
  assert.equal(reply.scope, 'all');
  assert.ok(![...w.stores.keys()].some((k) => k.startsWith('cv-')));
});

await test('status: reports counts and the newest saved-data time', async () => {
  const w = await ready(makeWorld());
  w.routes.set('/internal/api/dashboard', () => json({ a: 1 }));
  await w.request('/internal/api/dashboard').then((r) => r.json());
  const [reply] = await w.message({ type: 'cv:status' });
  assert.equal(reply.version, 'v1');
  assert.equal(reply.data, 1);
  assert.equal(reply.pages, 0);
  assert.ok(reply.newestDataAt > 0);
});

await test('the worker never queues or replays writes', async () => {
  assert.doesNotMatch(swSource, /BackgroundSync|SyncManager|addEventListener\(\s*['"]sync['"]|indexedDB|periodicsync/i);
  assert.doesNotMatch(swSource, /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)/);
});

// ---- client logic ------------------------------------------------------------------------------

const logic = await import(new URL('../src/lib/pwa-logic.ts', import.meta.url).href);

await test('client: warm-up runs when online and due, backs off after any attempt, never offline', () => {
  const now = 1_000_000_000_000;
  const base = { now, online: true, lastOk: 0, lastAttempt: 0 };
  assert.equal(logic.shouldWarm(base), true, 'first run');
  assert.equal(logic.shouldWarm({ ...base, online: false }), false, 'offline');
  assert.equal(logic.shouldWarm({ ...base, lastOk: now - 60_000 }), false, 'just saved');
  assert.equal(logic.shouldWarm({ ...base, lastOk: now - logic.WARM_EVERY_MS - 1 }), true, 'a clean run is stale after 6 h');
  assert.equal(logic.shouldWarm({ ...base, lastAttempt: now - 60_000 }), false, 'a failed attempt is not retried on every page load');
  assert.equal(logic.shouldWarm({ ...base, lastAttempt: now - logic.WARM_RETRY_MS - 1 }), true, 'retried after the back-off');
});

await test('client: banner priority and wording', () => {
  const now = 1_000_000_000_000;
  const path = '/internal/jobs/field?id=J 1';
  assert.equal(logic.bannerFor({ sessionExpired: false, online: true, staleSince: null, path, now }), null);
  const offlineBanner = logic.bannerFor({ sessionExpired: false, online: false, staleSince: null, path, now });
  assert.equal(offlineBanner.kind, 'offline');
  assert.match(offlineBanner.text, /approvals, quotes and payments need a connection/);
  const stale = logic.bannerFor({ sessionExpired: false, online: true, staleSince: now - 20 * 60_000, path, now });
  assert.equal(stale.kind, 'stale');
  assert.match(stale.text, /20 min ago/);
  assert.equal(stale.actionLabel, 'Reload');
  assert.ok(!/refreshes/i.test(stale.text), 'does not promise an automatic refresh the pages do not do');
  const session = logic.bannerFor({ sessionExpired: true, online: false, staleSince: now, path, now });
  assert.equal(session.kind, 'session', 'session ended outranks offline and saved copy');
  assert.equal(session.actionHref, `/internal/login?next=${encodeURIComponent(path)}`);
  assert.equal(logic.formatAge(now - 3 * 24 * 3_600_000, now), '3 days ago');
  assert.equal(logic.formatAge(now - 90 * 60_000, now), '2 h ago');
});

await test('client: update detection compares build times, ignores dev builds, and never loops or loses work', () => {
  const older = '1790000000000-aaaaaaa';
  const newer = '1791000000000-bbbbbbb';
  assert.equal(logic.pageIsStale(older, newer), true, 'worker newer than page: page is out of date');
  assert.equal(logic.pageIsStale(newer, older), false, 'worker older than page: the worker will update itself, the page is fine');
  assert.equal(logic.pageIsStale(newer, newer), false);
  for (const odd of ['dev', '', null, undefined, '__BUILD_ID__']) {
    assert.equal(logic.pageIsStale(odd, newer), false, `unparseable page id ${odd}`);
    assert.equal(logic.pageIsStale(older, odd), false, `unparseable worker id ${odd}`);
  }
  assert.equal(logic.pageIsStale('0000000000000-local', '0000000000000-abc'), false, 'no-git fallback never judges pages stale');
  assert.equal(logic.buildLabel(newer), 'bbbbbbb');
  assert.equal(logic.buildLabel('dev'), 'dev');

  const now = 2_000_000_000_000;
  const base = { stale: true, online: true, hidden: false, dirty: false, lastReloadAt: 0, now };
  assert.equal(logic.updateAction({ ...base, stale: false }), 'none');
  assert.equal(logic.updateAction(base), 'reload-now', 'visible and clean: reload now');
  assert.equal(logic.updateAction({ ...base, hidden: true }), 'reload-on-resume', 'in the background: reload when the app is next opened');
  assert.equal(logic.updateAction({ ...base, dirty: true }), 'banner', 'unsaved input is never thrown away');
  assert.equal(logic.updateAction({ ...base, online: false }), 'banner', 'offline a reload would serve the saved copy again');
  assert.equal(logic.updateAction({ ...base, lastReloadAt: now - 60_000 }), 'banner', 'reloaded for an update a minute ago: no loop');
  assert.equal(logic.updateAction({ ...base, lastReloadAt: now - logic.UPDATE_RELOAD_COOLDOWN_MS - 1 }), 'reload-now');

  assert.equal(logic.shouldCheckForUpdate({ now, online: true, lastCheck: 0 }), true);
  assert.equal(logic.shouldCheckForUpdate({ now, online: true, lastCheck: now - 60_000 }), false, 'checked a minute ago');
  assert.equal(logic.shouldCheckForUpdate({ now, online: false, lastCheck: 0 }), false);
  const warm = { now, online: true, lastOk: now - 60_000, lastAttempt: 0 };
  assert.equal(logic.shouldWarm(warm), false, 'saved a minute ago');
  assert.equal(logic.shouldWarm({ ...warm, buildChanged: true }), true, 'a new deploy refreshes the saved pages and assets right away');
  assert.equal(logic.shouldWarm({ ...warm, buildChanged: true, online: false }), false);
  assert.equal(logic.shouldWarm({ ...warm, buildChanged: true, lastAttempt: now - 60_000 }), false, 'still backs off after a failed attempt');
  assert.equal(logic.shouldWarm({ ...warm, buildChanged: true, running: true }), false, 'a run is already in progress');
  const ready = logic.bannerFor({ sessionExpired: false, online: true, staleSince: now - 60_000, updateReady: true, path: '/internal/today', now });
  assert.equal(ready.kind, 'update');
  assert.equal(ready.actionLabel, 'Reload');
  assert.equal(logic.bannerFor({ sessionExpired: false, online: false, staleSince: null, updateReady: true, path: '/x', now }).kind, 'offline');
  assert.equal(logic.bannerFor({ sessionExpired: true, online: true, staleSince: null, updateReady: true, path: '/x', now }).kind, 'session');
});

// ---- part 2: manifest, headers, built pages --------------------------------------------------

const manifest = JSON.parse(readFileSync(join(root, 'public/ops.webmanifest'), 'utf8'));

function builtFile(path) {
  const clean = path.replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (clean === '/internal') return join(dist, 'internal.html');
  const candidates = [join(dist, `${clean}.html`), join(dist, clean, 'index.html'), join(dist, clean)];
  return candidates.find((f) => existsSync(f) && statSync(f).isFile());
}

await test('manifest: installable fields, scope covers every start/shortcut URL, icons exist', () => {
  for (const field of ['id', 'name', 'short_name', 'start_url', 'scope', 'display', 'background_color', 'theme_color']) assert.ok(manifest[field], `missing ${field}`);
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.short_name.length <= 14);
  const inScope = (u) => new URL(u, ORIGIN).pathname.startsWith(manifest.scope);
  assert.equal(manifest.scope, '/internal', 'Pages redirects /internal/ to /internal, so the scope must not end in a slash');
  assert.ok(inScope(manifest.start_url), 'start_url inside scope');
  assert.ok(builtFile(manifest.start_url), 'start_url exists in the build');
  for (const s of manifest.shortcuts) { assert.ok(inScope(s.url), `${s.url} inside scope`); assert.ok(builtFile(s.url), `${s.url} exists in the build`); }
  const purposes = new Set(manifest.icons.map((i) => `${i.sizes}:${i.purpose}`));
  for (const need of ['192x192:any', '512x512:any', '512x512:maskable']) assert.ok(purposes.has(need), `icon ${need}`);
  for (const icon of manifest.icons) assert.ok(existsSync(join(dist, icon.src)), `${icon.src} exists in the build`);
  assert.ok(!/\.(?:com|net|org)\b/.test(JSON.stringify(manifest)), 'no absolute URLs: it must work on previews and production alike');
});

await test('naming: public PWA files must not start with "internal" (Cloudflare Access gates /internal* by prefix)', () => {
  // 2026-10-04: production Access started matching /internal* as a prefix, so /internal-sw.js, /internal.webmanifest and
  // /internal-offline.html were redirected to the Access sign-in. A service worker script and a manifest cannot follow a
  // redirect, so install, offline and updates all broke. Anything that must stay public lives outside that prefix.
  for (const file of ['ops-sw.js', 'ops.webmanifest', 'ops-offline.html']) {
    assert.ok(existsSync(join(root, 'public', file)), `public/${file} exists`);
    assert.ok(!file.startsWith('internal'), `${file} must not start with "internal"`);
  }
  for (const stale of ['internal-sw.js', 'internal.webmanifest', 'internal-offline.html']) assert.ok(!existsSync(join(root, 'public', stale)), `public/${stale} is gone`);
  const reg = readFileSync(join(root, 'src/scripts/internal-pwa.ts'), 'utf8');
  assert.match(reg, /SW_URL = '\/ops-sw\.js'/);
  assert.match(readFileSync(join(root, 'src/layouts/InternalLayout.astro'), 'utf8'), /rel="manifest" href="\/ops\.webmanifest"/);
  assert.match(swSource, /const OFFLINE_URL = '\/ops-offline\.html'/);
  const headers = readFileSync(join(root, 'public/_headers'), 'utf8');
  assert.doesNotMatch(headers, /^\/internal[-.]/m, '_headers has no rule for an /internal-* public file');
});

await test('headers: worker is always revalidated; manifest and offline page are not served from the private area', () => {
  const headers = readFileSync(join(root, 'public/_headers'), 'utf8');
  const rule = (path) => { const m = headers.match(new RegExp(`^${path.replace(/[.]/g, '\\.')}\\n((?:  .*\\n?)+)`, 'm')); return m ? m[1] : ''; };
  assert.match(rule('/ops-sw.js'), /Cache-Control: no-cache/);
  assert.match(rule('/ops-offline.html'), /Cache-Control: no-cache/);
  assert.match(rule('/ops.webmanifest'), /Cache-Control: public/);
});

await test('build: worker, manifest and offline page ship at public paths outside /internal/', () => {
  for (const file of ['ops-sw.js', 'ops.webmanifest', 'ops-offline.html']) assert.ok(existsSync(join(dist, file)), `${file} missing from the build`);
  assert.equal(readFileSync(join(dist, 'ops-sw.js'), 'utf8').replace(/const BUILD_ID = '[^']+';/, "const BUILD_ID = '__BUILD_ID__';"), swSource, 'shipped worker is the source plus the build id');
  assert.match(readFileSync(join(dist, 'ops-offline.html'), 'utf8'), /noindex/);
  const sitemap = readdirSync(dist).filter((f) => f.startsWith('sitemap')).map((f) => readFileSync(join(dist, f), 'utf8')).join('');
  assert.doesNotMatch(sitemap, /internal/);
});

await test('build: every warm page exists, and every worker scope assumption holds', () => {
  const pages = vm.runInNewContext(swSource.match(/const WARM_PAGES = (\[[\s\S]*?\]);/)[1]);
  assert.ok(pages.length >= 8);
  for (const path of pages) assert.ok(builtFile(path), `warm page ${path} is not in the build`);
  assert.ok(pages.includes('/internal/today') && pages.includes('/internal/jobs/field') && pages.includes('/internal/tools/photos'));
  assert.ok(!pages.some((p) => /login|api|quote|invoice|payment/.test(p)), 'no sensitive or auth pages in the warm list');
  const reg = readFileSync(join(root, 'src/scripts/internal-pwa.ts'), 'utf8');
  assert.match(reg, /SW_SCOPE = '\/internal'/);
  assert.match(reg, /SW_URL = '\/ops-sw\.js'/);
});

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (path.endsWith('.html')) yield path;
  }
}

await test('build: every internal page links the manifest, iOS app tags and the shared PWA script', () => {
  const pages = [join(dist, 'internal.html'), ...walk(join(dist, 'internal'))];
  assert.ok(pages.length >= 20, `expected the internal pages, found ${pages.length}`);
  const problems = [];
  for (const file of pages) {
    const page = readFileSync(file, 'utf8');
    const name = relative(dist, file);
    if (!page.includes('<link rel="manifest" href="/ops.webmanifest"')) problems.push(`${name}: manifest link`);
    if (!page.includes('name="apple-mobile-web-app-capable"')) problems.push(`${name}: apple-mobile-web-app-capable`);
    if (!page.includes('rel="apple-touch-icon"')) problems.push(`${name}: apple-touch-icon`);
    if (!page.includes('data-pwa-banner')) problems.push(`${name}: banner`);
    if (!/noindex/.test(page)) problems.push(`${name}: noindex`);
    const authed = /data-internal-authed="(true|false)"/.exec(page);
    if (!authed) problems.push(`${name}: data-internal-authed`);
    else if ((authed[1] === 'false') !== name.endsWith('login.html')) problems.push(`${name}: only the login page may be unauthenticated`);
  }
  assert.deepEqual(problems, []);
});

await test('build: the Dashboard tab is highlighted on /internal and only there', () => {
  const active = (file) => /class="active"[^>]*>Dashboard|href="\/internal\/"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/internal\/"/.test(readFileSync(file, 'utf8'));
  assert.ok(active(join(dist, 'internal.html')), 'Dashboard active on /internal');
  assert.ok(!active(join(dist, 'internal/today.html')), 'Dashboard not active on /internal/today');
});

await test('build: every deploy stamps one build id into the worker and every internal page', () => {
  assert.match(swSource, /const BUILD_ID = '__BUILD_ID__';/, 'source keeps the placeholder the build stamps');
  const stamped = readFileSync(join(dist, 'ops-sw.js'), 'utf8');
  const id = /const BUILD_ID = '([^']+)';/.exec(stamped);
  assert.ok(id, 'worker has a BUILD_ID');
  assert.doesNotMatch(stamped, /__BUILD_ID__/, 'placeholder was stamped');
  assert.match(id[1], /^\d{10,}-\S+$/, 'format "<time ms>-<commit>"');
  const pages = [join(dist, 'internal.html'), ...walk(join(dist, 'internal'))];
  for (const file of pages) {
    const page = readFileSync(file, 'utf8');
    const meta = /<meta name="cv-build" content="([^"]*)"/.exec(page);
    assert.ok(meta, `${relative(dist, file)}: cv-build meta`);
    assert.equal(meta[1], id[1], `${relative(dist, file)}: page and worker must carry the same build id`);
  }
  assert.equal(stamped.replace(`'${id[1]}'`, "'__BUILD_ID__'"), swSource, 'stamping changes nothing but the id');
});

await test('build: the public site does not link or register the internal manifest or worker', () => {
  const home = readFileSync(join(dist, 'index.html'), 'utf8');
  assert.ok(!home.includes('ops.webmanifest') && !home.includes('ops-sw'));
});

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll Command Center PWA checks passed.');
