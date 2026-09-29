// Customer signing links, executed against the real handlers on real SQLite:
// token handling, the public whitelist, stroke-only signatures, the Build Plan
// and terms gates, one-time finalization, revoke/replace and expiry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createD1 } from './_lib/d1-sqlite.mjs';
import { newToken, isToken, hashToken, renderSignatureSvg, publicQuote, linkStatus } from '../functions/internal/_lib/quote-signing.mjs';
import * as quotesIndex from '../functions/internal/api/quotes/index.js';
import * as buildPlan from '../functions/internal/api/build-plan.js';
import * as planState from '../functions/internal/api/build-plan-state.js';
import * as share from '../functions/internal/api/quote-share.js';
import * as sign from '../functions/api/quote-sign.js';

process.removeAllListeners('warning');
const pass = (message) => console.log(`PASS: ${message}`);
const ORIGIN = 'https://windowsbyclearview.com';

async function call(handler, env, { method = 'GET', path = '/', body, headers = {} } = {}) {
  const request = new Request(`${ORIGIN}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const waits = [];
  const response = await handler({ request, env, params: {}, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return { status: response.status, headers: response.headers, body: await response.json() };
}

const freshEnv = () => ({ QUOTES_DB: createD1({ schemaFiles: ['functions/api/_data/schema.sql', 'internal/db/schema.sql'] }) });
const items = [{ label: 'Milgard vinyl slider, full-frame', quantity: 2, unitPriceCents: 90000 }];
const customer = { name: 'Pat Doe', phone: '(360) 555-0100', email: 'pat@example.com', address: '1 Main St', city: 'Camas' };
const strokes = [[[10, 10], [60, 40], [120, 30]], [[200, 90], [260, 120]]];

async function approvedQuote(env) {
  const created = await call(quotesIndex.onRequestPost, env, { method: 'POST', body: { customer, items, signatureMethod: 'pen', notes: 'INTERNAL NOTE: gate code 4411' } });
  const id = created.body.id;
  const gen = await call(buildPlan.onRequestGet, env, { path: `/internal/api/build-plan?quoteId=${id}` });
  await call(buildPlan.onRequestPost, env, { method: 'POST', body: { quoteId: id, plan: gen.body.plan } });
  await call(planState.onRequestPost, env, { method: 'POST', body: { quoteId: id, action: 'submit-review' } });
  const ok = await call(planState.onRequestPost, env, { method: 'POST', body: { quoteId: id, action: 'approve' } });
  assert.equal(ok.status, 200);
  return id;
}

const tokenOf = (url) => url.split('#')[1];
const view = (env, t) => call(sign.onRequest, env, { path: '/api/quote-sign', headers: { 'x-sign-token': t } });
const submit = (env, body) => call(sign.onRequest, env, { method: 'POST', path: '/api/quote-sign', body });

{
  const t = newToken();
  assert.ok(isToken(t) && t.length === 43, '256-bit base64url token');
  assert.notEqual(newToken(), t);
  assert.equal((await hashToken(t)).length, 64);
  assert.ok(!isToken('short') && !isToken(`${t}=`) && !isToken(null));

  const good = renderSignatureSvg(strokes);
  assert.ok(good.svg.startsWith('<svg viewBox="0 0 600 180"') && good.svg.includes('M10.0 10.0 L60.0 40.0'));
  for (const bad of [
    undefined, [], [[]], [[[1, 1]]], 'abc',
    [[[0, 0], ['<script>', 1]]],
    [[[0, 0], [601, 5]]], [[[-1, 0], [5, 5]]], [[[0, 0], [5, 181]]],
    [[[0, 0, 0], [1, 1]]],
    Array.from({ length: 61 }, () => [[1, 1], [2, 2]]),
    [Array.from({ length: 4001 }, (_, i) => [i % 600, 5])],
  ]) {
    assert.ok(renderSignatureSvg(bad).error, `rejects ${JSON.stringify(bad)?.slice(0, 40)}`);
  }
  pass('tokens are 256-bit and stored hashed; signatures are only range-checked strokes rendered by the server');
}

{
  const q = publicQuote(
    { id: 'Q-1', created_at: 'x', status: 'draft', customer_name: 'Pat', customer_phone: '555', customer_email: 'e@x', customer_address: 'A', customer_city: 'C', notes: 'secret', lead_id: 9, subtotal_cents: 100, discount_cents: 0, total_cents: 100, terms_version: 'v', signature_name: 'N' },
    [{ id: 3, quote_id: 'Q-1', label: 'L', description: 'D', quantity: 1, unit_price_cents: 100, line_total_cents: 100 }],
  );
  const text = JSON.stringify(q);
  assert.ok(!/secret|555|e@x|lead|"id"|quote_id/.test(text), 'no notes, phone, email, lead or row ids');
  assert.equal(q.signedName, '', 'no signature details before signing');
  assert.equal(linkStatus(null).state, 'none');
  assert.equal(linkStatus({ created_at: 'a', expires_at: '2000-01-01T00:00:00Z', view_count: 0 }).state, 'expired');
  pass('the public view is a whitelist and link status never exposes the token');
}

{
  const env = freshEnv();
  const plain = await call(quotesIndex.onRequestPost, env, { method: 'POST', body: { customer, items } });
  const blocked = await call(share.onRequestPost, env, { method: 'POST', body: { quoteId: plain.body.id } });
  assert.equal(blocked.status, 409, 'no link for a quote without an approved Build Plan');
  const status = await call(share.onRequestGet, env, { path: `/?quoteId=${plain.body.id}` });
  assert.equal(status.body.canCreate, false);
  assert.equal((await call(share.onRequestPost, env, { method: 'POST', body: { quoteId: 'Q-NOPE' } })).status, 404);
  pass('a signing link can only be created for an existing draft with an approved Build Plan');
}

{
  const env = freshEnv();
  const id = await approvedQuote(env);
  const created = await call(share.onRequestPost, env, { method: 'POST', body: { quoteId: id } });
  assert.equal(created.status, 201);
  assert.match(created.body.url, /^https:\/\/windowsbyclearview\.com\/sign#[A-Za-z0-9_-]{43}$/, 'token rides in the URL fragment');
  assert.match(created.body.smsHref, /^sms:3605550100\?&body=/);
  assert.match(created.body.mailHref, /^mailto:pat%40example\.com\?/);
  const t = tokenOf(created.body.url);
  const stored = env.QUOTES_DB.raw.prepare(`SELECT token_hash FROM quote_sign_links`).all();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].token_hash, await hashToken(t));
  assert.ok(!JSON.stringify(env.QUOTES_DB.raw.prepare(`SELECT * FROM quote_sign_links`).all()).includes(t), 'the raw token is never stored');
  assert.equal(env.QUOTES_DB.raw.prepare(`SELECT signature_method FROM quotes WHERE id = ?`).get(id).signature_method, 'digital');

  const status = await call(share.onRequestGet, env, { path: `/?quoteId=${id}` });
  assert.equal(status.body.link.state, 'sent');
  assert.ok(!JSON.stringify(status.body).includes(t), 'status never returns the token');

  const v = await view(env, t);
  assert.equal(v.status, 200);
  assert.equal(v.headers.get('cache-control'), 'private, no-store');
  assert.equal(v.headers.get('x-robots-tag'), 'noindex');
  assert.equal(v.body.quote.number, id);
  assert.equal(v.body.quote.totalCents, 180000);
  assert.ok(!/INTERNAL NOTE|4411|555-0100|pat@example/.test(JSON.stringify(v.body)), 'notes and contact details stay private');
  await view(env, t);
  const viewed = await call(share.onRequestGet, env, { path: `/?quoteId=${id}` });
  assert.equal(viewed.body.link.state, 'viewed');
  assert.equal(viewed.body.link.viewCount, 2);

  assert.equal((await view(env, 'x'.repeat(43))).status, 404);
  assert.equal((await view(env, '')).status, 404);
  assert.equal((await submit(env, { t, name: 'Pat Doe', strokes })).status, 400, 'consent is required');
  assert.equal((await submit(env, { t, name: 'P', strokes, consent: true })).status, 400, 'a name is required');
  assert.equal((await submit(env, { t, name: 'Pat Doe', strokes: '<svg onload=alert(1)>', consent: true })).status, 400, 'markup is never accepted');
  assert.equal((await submit(env, { t, name: 'Pat Doe', signatureSvg: '<svg/>', consent: true })).status, 400);
  assert.equal(env.QUOTES_DB.raw.prepare(`SELECT status FROM quotes WHERE id = ?`).get(id).status, 'draft', 'rejected attempts change nothing');

  const signed = await submit(env, { t, name: '  Pat   Doe ', strokes, consent: true });
  assert.equal(signed.status, 200);
  const row = env.QUOTES_DB.raw.prepare(`SELECT status, signature_name, signature_svg, signed_at FROM quotes WHERE id = ?`).get(id);
  assert.equal(row.status, 'finalized');
  assert.equal(row.signature_name, 'Pat Doe');
  assert.ok(row.signature_svg.startsWith('<svg viewBox') && !/script|on\w+=/i.test(row.signature_svg));
  const invoice = env.QUOTES_DB.raw.prepare(`SELECT status FROM invoices WHERE quote_id = ?`).get(id);
  assert.ok(invoice && invoice.status !== 'draft', 'the invoice is finalized with the quote');
  assert.equal((await submit(env, { t, name: 'Someone Else', strokes, consent: true })).status, 409, 'a quote is signed exactly once');
  const after = await view(env, t);
  assert.equal(after.status, 200, 'the customer can still open their signed quote');
  assert.equal(after.body.quote.status, 'signed');
  assert.equal(after.body.quote.signedName, 'Pat Doe');
  assert.equal((await call(share.onRequestGet, env, { path: `/?quoteId=${id}` })).body.link.state, 'signed');
  assert.equal((await call(share.onRequestPost, env, { method: 'POST', body: { quoteId: id } })).status, 409, 'no new link for a signed quote');
  pass('the customer views and signs once; the quote and invoice finalize and private fields never leak');
}

{
  const env = freshEnv();
  const id = await approvedQuote(env);
  const first = tokenOf((await call(share.onRequestPost, env, { method: 'POST', body: { quoteId: id } })).body.url);
  const second = tokenOf((await call(share.onRequestPost, env, { method: 'POST', body: { quoteId: id } })).body.url);
  assert.equal((await view(env, first)).status, 410, 'a new link replaces the old one');
  assert.equal((await view(env, second)).status, 200);
  await call(share.onRequestDelete, env, { method: 'DELETE', path: `/?quoteId=${id}` });
  assert.equal((await view(env, second)).status, 410, 'a revoked link stops working');
  assert.equal((await submit(env, { t: second, name: 'Pat Doe', strokes, consent: true })).status, 410);

  const third = tokenOf((await call(share.onRequestPost, env, { method: 'POST', body: { quoteId: id } })).body.url);
  env.QUOTES_DB.raw.prepare(`UPDATE quote_sign_links SET expires_at = '2000-01-01T00:00:00.000Z' WHERE token_hash = ?`).run(await hashToken(third));
  assert.equal((await view(env, third)).status, 410, 'an expired link stops working');
  pass('only the newest link works, and revoked or expired links are refused');
}

{
  const env = freshEnv();
  const id = await approvedQuote(env);
  const t = tokenOf((await call(share.onRequestPost, env, { method: 'POST', body: { quoteId: id } })).body.url);
  env.QUOTES_DB.raw.prepare(`UPDATE quote_items SET quantity = 3, line_total_cents = 270000 WHERE quote_id = ?`).run(id);
  const stale = await submit(env, { t, name: 'Pat Doe', strokes, consent: true });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'BUILD_PLAN_STALE', 'a quote changed after approval cannot be signed from an old link');

  const env2 = freshEnv();
  const id2 = await approvedQuote(env2);
  const t2 = tokenOf((await call(share.onRequestPost, env2, { method: 'POST', body: { quoteId: id2 } })).body.url);
  env2.QUOTES_DB.raw.prepare(`UPDATE quotes SET terms_version = '1999-01-01' WHERE id = ?`).run(id2);
  const terms = await submit(env2, { t: t2, name: 'Pat Doe', strokes, consent: true });
  assert.equal(terms.body.code, 'TERMS_CHANGED', 'a customer never signs terms other than the ones their quote recorded');
  assert.equal(env2.QUOTES_DB.raw.prepare(`SELECT status FROM quotes WHERE id = ?`).get(id2).status, 'draft');
  pass('the Build Plan and terms gates apply to customer signing exactly as they do on Mark\'s device');
}

{
  // Race: the link is revoked (Mark sends a new one) after the request passed its checks.
  const env = freshEnv();
  const id = await approvedQuote(env);
  const t = tokenOf((await call(share.onRequestPost, env, { method: 'POST', body: { quoteId: id } })).body.url);
  const db = env.QUOTES_DB;
  const original = db.prepare;
  db.prepare = (sql) => {
    if (/^\s*UPDATE quotes SET signature_method = 'digital', signature_svg/.test(sql)) {
      db.raw.prepare(`UPDATE quote_sign_links SET revoked_at = '2026-01-01T00:00:00.000Z'`).run();
    }
    return original(sql);
  };
  const raced = await submit(env, { t, name: 'Pat Doe', strokes, consent: true });
  db.prepare = original;
  assert.equal(raced.status, 410, 'a link revoked mid-request cannot finalize the quote');
  assert.equal(db.raw.prepare(`SELECT status FROM quotes WHERE id = ?`).get(id).status, 'draft');
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM quote_sign_links WHERE signed_at IS NOT NULL`).get().n, 0);

  // Invariant: if the quote update affects zero rows after the link was stamped,
  // the same transaction clears the stamp, so neither half of the signature lands.
  const env3 = freshEnv();
  const id3 = await approvedQuote(env3);
  const t3 = tokenOf((await call(share.onRequestPost, env3, { method: 'POST', body: { quoteId: id3 } })).body.url);
  const db3 = env3.QUOTES_DB;
  const orig3 = db3.prepare;
  db3.prepare = (sql) => orig3(/^\s*UPDATE quotes SET signature_method = 'digital', signature_svg/.test(sql) ? sql.replace('WHERE id = ?', 'WHERE 0 AND id = ?') : sql);
  const zero = await submit(env3, { t: t3, name: 'Pat Doe', strokes, consent: true });
  db3.prepare = orig3;
  assert.notEqual(zero.status, 200, 'a zero-row quote update is reported as a failure');
  assert.equal(db3.raw.prepare(`SELECT status FROM quotes WHERE id = ?`).get(id3).status, 'draft', 'the quote remains a draft');
  assert.equal(db3.raw.prepare(`SELECT COUNT(*) AS n FROM quote_sign_links WHERE signed_at IS NOT NULL`).get().n, 0, 'the link stamp is rolled back in the same transaction');
  assert.equal((await submit(env3, { t: t3, name: 'Pat Doe', strokes, consent: true })).status, 200, 'the customer can simply sign again');

  // Invoice failure after the signature is saved: the customer still sees success,
  // quote and link evidence are both recorded, and the invoice is finalized later.
  const env2 = freshEnv();
  const id2 = await approvedQuote(env2);
  const t2 = tokenOf((await call(share.onRequestPost, env2, { method: 'POST', body: { quoteId: id2 } })).body.url);
  const db2 = env2.QUOTES_DB;
  const orig2 = db2.prepare;
  db2.prepare = (sql) => (/FROM invoices WHERE quote_id/.test(sql) ? { bind() { return this; }, first: async () => { throw new Error('invoice down'); }, all: async () => { throw new Error('invoice down'); }, run: async () => { throw new Error('invoice down'); } } : orig2(sql));
  const quiet = console.error;
  console.error = () => {};
  const ok = await submit(env2, { t: t2, name: 'Pat Doe', strokes, consent: true });
  console.error = quiet;
  db2.prepare = orig2;
  assert.equal(ok.status, 200, 'an invoice hiccup never reports a saved signature as failed');
  assert.equal(db2.raw.prepare(`SELECT status FROM quotes WHERE id = ?`).get(id2).status, 'finalized');
  assert.equal(db2.raw.prepare(`SELECT COUNT(*) AS n FROM quote_sign_links WHERE signed_at IS NOT NULL`).get().n, 1, 'link evidence lands with the signature');
  pass('finalization is atomic with the live link; invoice failures are recovered separately');
}

{
  const page = fs.readFileSync('src/pages/sign.astro', 'utf8');
  const view = fs.readFileSync('src/pages/internal/quotes/view.astro', 'utf8');
  const config = fs.readFileSync('astro.config.mjs', 'utf8');
  const middleware = fs.readFileSync('functions/internal/_middleware.js', 'utf8');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(page), 'the public page writes data with textContent only');
  assert.ok(/noindex/.test(page) && /path !== '\/sign'/.test(config), 'kept out of search and the sitemap');
  assert.ok(/location\.hash/.test(page) && /x-sign-token/.test(page) && /history\.replaceState/.test(page), 'token read from the fragment, sent in a header, cleared from the address bar');
  assert.ok(!/\?t=/.test(page), 'the token is never put in a query string');
  const panel = view.slice(view.indexOf('async function loadShareLink'), view.indexOf('async function load()'));
  assert.ok(panel.length > 0 && !/innerHTML/.test(panel), 'the internal panel uses textContent');
  assert.ok(!/quote-share/.test(middleware.match(/PUBLIC_PATHS[^;]*/)?.[0] || ''), 'link management stays behind the login');
  pass('the public page and internal panel are wired safely');
}

console.log('Quote signing checks passed.');
