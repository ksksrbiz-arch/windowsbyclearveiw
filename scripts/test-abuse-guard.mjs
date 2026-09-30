// Turnstile verification and per-visitor rate limiting, run against the real handlers and a real
// SQLite-backed D1 stand-in. Covers the safety property that matters most: protection must never
// cost a real lead (unconfigured = off, verifier down = open, storage down = open).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { takeRateLimit, verifyTurnstile, TURNSTILE_VERIFY_URL } from '../functions/_lib/abuse-guard.mjs';
import { onRequestPost as estimate, ESTIMATE_RATE_LIMIT } from '../functions/api/estimate.js';
import { onRequest as askMiddleware } from '../functions/ask/api/_middleware.js';
import { createD1 } from './_lib/d1-sqlite.mjs';

process.removeAllListeners('warning');
let groups = 0;
const ok = async (fn) => { await fn(); groups++; };

const req = (ip = '203.0.113.7', extra = {}) => new Request('https://windowsbyclearview.com/api/estimate', { method: 'POST', headers: { 'cf-connecting-ip': ip, ...extra } });
const rule = { bucket: 't', limit: 3, windowSeconds: 60 };
const freshDb = () => createD1({ schemaFiles: ['functions/api/_data/schema.sql'] });

await ok(async () => {
  const env = { QUOTES_DB: freshDb() };
  const t0 = 1_800_000_000_000;
  const results = [];
  for (let i = 0; i < 5; i++) results.push((await takeRateLimit(env, req(), rule, t0)).limited);
  assert.deepEqual(results, [false, false, false, true, true], 'the 4th request in a window is limited');
  assert.equal((await takeRateLimit(env, req('198.51.100.2'), rule, t0)).limited, false, 'another visitor is unaffected');
  assert.equal((await takeRateLimit(env, req(), { ...rule, bucket: 'other' }, t0)).limited, false, 'buckets are independent');
  const next = await takeRateLimit(env, req(), rule, t0 + 61_000);
  assert.equal(next.limited, false, 'a new window starts fresh');
  const blocked = await takeRateLimit(env, req(), rule, t0);
  assert.ok(blocked.retryAfterSeconds >= 1 && blocked.retryAfterSeconds <= 60, 'retry-after is within the window');
  const stored = env.QUOTES_DB.raw.prepare('SELECT key FROM rate_limits').all().map((r) => r.key).join(' ');
  assert.ok(!stored.includes('203.0.113.7'), 'the visitor IP is never stored, only a hash');
});

await ok(async () => {
  assert.equal((await takeRateLimit({}, req(), rule)).limited, false, 'no database: not limited');
  const broken = { QUOTES_DB: { prepare: () => { throw new Error('d1 down'); } } };
  const quiet = console.error; console.error = () => {};
  assert.equal((await takeRateLimit(broken, req(), rule)).limited, false, 'database error: fails open');
  console.error = quiet;
});

await ok(async () => {
  const calls = [];
  const verifier = (success, status = 200) => async (url, init) => { calls.push({ url, body: init.body }); return new Response(JSON.stringify({ success }), { status }); };
  assert.deepEqual(await verifyTurnstile({}, '', req(), verifier(false)), { ok: true, skipped: true }, 'unconfigured: off');
  assert.equal(calls.length, 0, 'unconfigured: no network call');
  const env = { TURNSTILE_SECRET_KEY: 'sekret' };
  assert.deepEqual(await verifyTurnstile(env, '', req(), verifier(true)), { ok: false, reason: 'missing' });
  assert.deepEqual(await verifyTurnstile(env, 'x'.repeat(3000), req(), verifier(true)), { ok: false, reason: 'missing' }, 'oversized token is refused unsent');
  assert.equal(calls.length, 0, 'missing token never reaches Cloudflare');
  assert.deepEqual(await verifyTurnstile(env, 'tok', req(), verifier(true)), { ok: true });
  assert.equal(calls[0].url, TURNSTILE_VERIFY_URL);
  assert.equal(calls[0].body.get('secret'), 'sekret');
  assert.equal(calls[0].body.get('response'), 'tok');
  assert.equal(calls[0].body.get('remoteip'), '203.0.113.7');
  assert.deepEqual(await verifyTurnstile(env, 'tok', req(), verifier(false)), { ok: false, reason: 'rejected' });
  const quiet = console.error; console.error = () => {};
  assert.deepEqual(await verifyTurnstile(env, 'tok', req(), verifier(true, 500)), { ok: true, skipped: true }, 'Cloudflare 500: a lead is not lost');
  assert.deepEqual(await verifyTurnstile(env, 'tok', req(), async () => { throw new Error('offline'); }), { ok: true, skipped: true }, 'verifier unreachable: a lead is not lost');
  console.error = quiet;
});

// The estimate endpoint, end to end.
const mail = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) === TURNSTILE_VERIFY_URL) return new Response(JSON.stringify({ success: init.body.get('response') === 'good' }), { status: 200 });
  return new Response(JSON.stringify({ id: 'm1' }), { status: 200 });
};
async function submit(env, fields, ip = '203.0.113.9') {
  const form = new FormData();
  for (const [k, v] of Object.entries({ name: 'Pat Doe', phone: '(360) 555-0100', city: 'Camas', ...fields })) form.set(k, v);
  const request = new Request('https://windowsbyclearview.com/api/estimate', { method: 'POST', headers: { accept: 'application/json', origin: 'https://windowsbyclearview.com', 'cf-connecting-ip': ip }, body: form });
  const pending = [];
  const response = await estimate({ request, env, waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  return { status: response.status, body: await response.json(), headers: response.headers };
}
const leads = (env) => env.QUOTES_DB.raw.prepare('SELECT COUNT(*) AS n FROM leads').get().n;

await ok(async () => {
  const env = { QUOTES_DB: freshDb(), RESEND_API_KEY: 'k' };
  for (let i = 0; i < ESTIMATE_RATE_LIMIT.limit; i++) assert.equal((await submit(env, {})).status, 200, `request ${i + 1} is accepted`);
  const over = await submit(env, {});
  assert.equal(over.status, 429);
  assert.match(over.body.error, /call us/i, 'the refusal points at the phone');
  assert.ok(Number(over.headers.get('retry-after')) >= 1);
  assert.equal(leads(env), ESTIMATE_RATE_LIMIT.limit, 'the limited request saved nothing');
  assert.equal((await submit(env, {}, '198.51.100.5')).status, 200, 'a different visitor still gets through');
});

await ok(async () => {
  const env = { QUOTES_DB: freshDb(), RESEND_API_KEY: 'k', TURNSTILE_SECRET_KEY: 's' };
  const missing = await submit(env, {});
  assert.equal(missing.status, 403);
  assert.match(missing.body.error, /security check/i);
  assert.equal((await submit(env, { 'cf-turnstile-response': 'bad' })).status, 403);
  assert.equal(leads(env), 0, 'refused requests are not saved');
  assert.equal((await submit(env, { 'cf-turnstile-response': 'good' })).status, 200);
  assert.equal(leads(env), 1, 'a verified request is saved');
  // The honeypot still answers like success and saves nothing, before any check.
  const trap = await submit(env, { company: 'Spam Inc' });
  assert.deepEqual(trap.body, { ok: true });
  assert.equal(leads(env), 1);
  // Not configured: the form works exactly as before.
  const plain = { QUOTES_DB: freshDb(), RESEND_API_KEY: 'k' };
  assert.equal((await submit(plain, {})).status, 200);
});

// Ask middleware: only chat and handoff are limited; preflight and health are not.
await ok(async () => {
  const env = { QUOTES_DB: freshDb() };
  const call = (path, method = 'POST', ip = '203.0.113.20') => askMiddleware({
    request: new Request(`https://windowsbyclearview.com/ask/api/${path}`, { method, headers: { 'content-type': 'application/json', origin: 'https://windowsbyclearview.com', 'cf-connecting-ip': ip }, ...(method === 'POST' ? { body: '{}' } : {}) }),
    env,
    next: async () => new Response('next'),
  });
  for (let i = 0; i < 10; i++) assert.equal((await call('handoff')).status, 200, `handoff ${i + 1} passes`);
  const blocked = await call('handoff');
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get('retry-after'));
  assert.equal((await call('chat')).status, 200, 'chat has its own allowance');
  assert.equal((await call('chat', 'OPTIONS')).status, 204, 'preflight is never counted');
  assert.equal((await call('handoff', 'POST', '198.51.100.44')).status, 200, 'other visitors are unaffected');
  const noDb = await askMiddleware({ request: new Request('https://windowsbyclearview.com/ask/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), env: {}, next: async () => new Response('next') });
  assert.equal(noDb.status, 200, 'no database: chat still works');
});

// The form only shows the widget when a site key exists, and always offers the phone as a way out.
await ok(() => {
  const form = readFileSync(new URL('../src/components/EstimateForm.astro', import.meta.url), 'utf8');
  assert.ok(form.includes('site.turnstileSiteKey &&'), 'widget is rendered only when configured');
  assert.ok(form.includes('turnstile.reset'), 'tokens are single use, so the widget resets after a failed send');
  assert.ok(/call ' \+ phoneDisplay/.test(form), 'a widget that fails to load tells the visitor to call');
  const site = readFileSync(new URL('../src/data/site.ts', import.meta.url), 'utf8');
  assert.match(site, /turnstileSiteKey: '[^']*'/);
  assert.ok(!/TURNSTILE_SECRET/.test(form), 'the secret key is never referenced by the form');
});

globalThis.fetch = mail;
console.log(`abuse guard: ok (${groups} groups)`);
