import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createD1 } from './_lib/d1-sqlite.mjs';
import { parseLeadId, suggestLeads, phoneKey, emailKey, ensureQuoteLeadColumn } from '../functions/internal/_lib/lead-links.mjs';
import { summarizeSourceRevenue } from '../functions/internal/_lib/pipeline-summary.mjs';
import * as quotesIndex from '../functions/internal/api/quotes/index.js';
import * as quoteLead from '../functions/internal/api/quote-lead.js';
import * as leadsApi from '../functions/internal/api/leads.js';
import * as analytics from '../functions/internal/api/analytics.js';

const pass = (message) => console.log(`PASS: ${message}`);
const ORIGIN = 'https://x.test';

async function call(handler, env, { method = 'GET', path = '/', body } = {}) {
  const request = new Request(`${ORIGIN}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handler({ request, env, params: {}, waitUntil() {} });
  return { status: response.status, body: await response.json() };
}

const freshEnv = () => ({ QUOTES_DB: createD1({ schemaFiles: ['functions/api/_data/schema.sql', 'internal/db/schema.sql'] }) });
const items = [{ label: 'Vinyl slider, full-frame', quantity: 1, unitPriceCents: 90000 }];

function addLead(env, { name = 'Pat Doe', phone = '(503) 555-0100', email = 'pat@example.com', referrer = 'https://www.google.com/', utm = null, daysAgo = 3 } = {}) {
  const created = new Date(Date.now() - daysAgo * 86400000).toISOString();
  return Number(env.QUOTES_DB.raw.prepare(
    `INSERT INTO leads (created_at, name, phone, email, first_referrer, first_utm_source) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(created, name, phone, email, referrer, utm).lastInsertRowid);
}

{
  assert.deepEqual(parseLeadId(undefined), { leadId: null });
  assert.deepEqual(parseLeadId(''), { leadId: null });
  assert.deepEqual(parseLeadId('42'), { leadId: 42 });
  assert.ok(parseLeadId('0').error && parseLeadId('4x').error && parseLeadId('-3').error && parseLeadId('1e3').error);
  assert.equal(phoneKey('+1 (503) 555-0100'), '5035550100');
  assert.equal(phoneKey('555-0100'), '', 'a partial phone number never matches');
  assert.equal(emailKey(' Pat@Example.COM '), 'pat@example.com');
  assert.equal(emailKey('not-an-email'), '');
  const leads = [
    { id: 1, name: 'A', phone: '503.555.0100', email: 'x@y.co', created_at: '2026-09-01' },
    { id: 2, name: 'B', phone: '5035550100', email: 'pat@example.com', created_at: '2026-08-01' },
    { id: 3, name: 'C', phone: '5035550199', email: 'other@y.co', created_at: '2026-09-10' },
  ];
  const s = suggestLeads({ customer_phone: '(503) 555-0100', customer_email: 'PAT@example.com' }, leads);
  assert.deepEqual(s.map((x) => x.id), [2, 1], 'phone+email beats phone-only; non-matches are excluded');
  assert.deepEqual(s[0].matchedOn, ['phone', 'email']);
  assert.deepEqual(suggestLeads({ customer_phone: '', customer_email: '' }, leads), []);
  pass('lead ids are strictly validated and suggestions are exact phone/email matches only');
}

{
  const db = createD1();
  db.raw.exec(`CREATE TABLE quotes (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft')`);
  db.raw.exec(`INSERT INTO quotes (id, created_at) VALUES ('Q-OLD', '2026-01-01')`);
  await ensureQuoteLeadColumn(db);
  await ensureQuoteLeadColumn(db);
  const cols = db.raw.prepare(`PRAGMA table_info(quotes)`).all().map((c) => c.name);
  assert.ok(cols.includes('lead_id') && cols.includes('lead_linked_at'), 'a production table from before this change gains the columns');
  assert.equal(db.raw.prepare(`SELECT lead_id FROM quotes WHERE id = 'Q-OLD'`).get().lead_id, null, 'existing quotes stay unlinked');
  pass('the lazy migration adds lead_id to an existing quotes table, idempotently, without touching old rows');
}

{
  const env = freshEnv();
  const leadId = addLead(env);
  const created = await call(quotesIndex.onRequestPost, env, {
    method: 'POST',
    body: { customer: { name: 'Pat Doe', phone: '5035550100' }, items, signatureMethod: 'pen', leadId: String(leadId) },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.leadId, leadId);
  const row = env.QUOTES_DB.raw.prepare(`SELECT lead_id, lead_linked_at FROM quotes WHERE id = ?`).get(created.body.id);
  assert.equal(row.lead_id, leadId);
  assert.ok(row.lead_linked_at);

  const plain = await call(quotesIndex.onRequestPost, env, { method: 'POST', body: { customer: { name: 'Lee', phone: '5035550111' }, items } });
  assert.equal(plain.status, 201);
  assert.equal(env.QUOTES_DB.raw.prepare(`SELECT lead_id FROM quotes WHERE id = ?`).get(plain.body.id).lead_id, null);

  const bad = await call(quotesIndex.onRequestPost, env, { method: 'POST', body: { customer: { name: 'X', phone: '1' }, items, leadId: 'abc' } });
  assert.equal(bad.status, 400);
  const missing = await call(quotesIndex.onRequestPost, env, { method: 'POST', body: { customer: { name: 'X', phone: '1' }, items, leadId: 99999 } });
  assert.equal(missing.status, 400, 'a quote is never linked to an inquiry that does not exist');
  assert.equal(env.QUOTES_DB.raw.prepare(`SELECT COUNT(*) AS n FROM quotes`).get().n, 2, 'rejected creates write nothing');

  const leads = await call(leadsApi.onRequestGet, env);
  const listed = leads.body.leads.find((l) => l.id === leadId);
  assert.equal(listed.quote_id, created.body.id);
  assert.equal(listed.quote_count, 1);
  assert.equal(listed.quote_status, 'draft');
  pass('"Start quote" saves the inquiry link; invalid or unknown inquiries are rejected; the leads list shows the linked quote');
}

{
  const env = freshEnv();
  const matchId = addLead(env, { name: 'Pat Doe', phone: '503-555-0100', email: 'pat@example.com' });
  addLead(env, { name: 'Someone Else', phone: '503-555-0199', email: 'else@example.com' });
  const q = await call(quotesIndex.onRequestPost, env, {
    method: 'POST',
    body: { customer: { name: 'Pat Doe', phone: '(503) 555-0100', email: 'pat@example.com' }, items },
  });
  env.QUOTES_DB.raw.prepare(`UPDATE quotes SET status = 'finalized', signed_at = ? WHERE id = ?`).run(new Date().toISOString(), q.body.id);

  const before = await call(quoteLead.onRequest, env, { path: `/internal/api/quote-lead?quoteId=${q.body.id}` });
  assert.equal(before.status, 200);
  assert.equal(before.body.lead, null);
  assert.deepEqual(before.body.suggestions.map((s) => s.id), [matchId], 'only the exact match is suggested');
  assert.equal(env.QUOTES_DB.raw.prepare(`SELECT lead_id FROM quotes WHERE id = ?`).get(q.body.id).lead_id, null, 'suggesting never links');

  const linked = await call(quoteLead.onRequest, env, { method: 'POST', body: { quoteId: q.body.id, leadId: matchId } });
  assert.equal(linked.status, 200, 'attribution can be set on a finalized quote');
  const after = await call(quoteLead.onRequest, env, { path: `/internal/api/quote-lead?quoteId=${q.body.id}` });
  assert.equal(after.body.lead.id, matchId);
  assert.deepEqual(after.body.suggestions, []);
  const contract = env.QUOTES_DB.raw.prepare(`SELECT status, total_cents, customer_name FROM quotes WHERE id = ?`).get(q.body.id);
  assert.deepEqual({ ...contract }, { status: 'finalized', total_cents: 90000, customer_name: 'Pat Doe' }, 'linking never changes the contract');

  assert.equal((await call(quoteLead.onRequest, env, { method: 'POST', body: { quoteId: q.body.id, leadId: 424242 } })).status, 404);
  assert.equal((await call(quoteLead.onRequest, env, { method: 'POST', body: { quoteId: 'Q-NOPE', leadId: matchId } })).status, 404);
  assert.equal((await call(quoteLead.onRequest, env, { method: 'POST', body: { quoteId: q.body.id, leadId: 'x' } })).status, 400);
  assert.equal((await call(quoteLead.onRequest, env, { method: 'DELETE' })).status, 405);

  const unlinked = await call(quoteLead.onRequest, env, { method: 'POST', body: { quoteId: q.body.id, leadId: null } });
  assert.equal(unlinked.status, 200);
  const row = env.QUOTES_DB.raw.prepare(`SELECT lead_id, lead_linked_at FROM quotes WHERE id = ?`).get(q.body.id);
  assert.deepEqual({ ...row }, { lead_id: null, lead_linked_at: null });
  pass('quotes can be linked and unlinked only by explicit request, with suggestions that never auto-apply');
}

{
  const now = Date.UTC(2026, 8, 28);
  const iso = (d) => new Date(now - d * 86400000).toISOString();
  const r = summarizeSourceRevenue({
    leads: [
      { created_at: iso(2), first_referrer: 'https://www.google.com/' },
      { created_at: iso(3), first_referrer: 'https://google.com/' },
      { created_at: iso(4), first_utm_source: 'nextdoor' },
    ],
    quotes: [
      { created_at: iso(2), signed_at: iso(1), total_cents: 400000, lead_id: 1, first_referrer: 'https://google.com/', paid_cents: 200000 },
      { created_at: iso(3), total_cents: 50000, lead_id: 3, first_utm_source: 'nextdoor', paid_cents: 0 },
      { created_at: iso(5), total_cents: 70000, lead_id: null, paid_cents: 0 },
      { created_at: iso(400), total_cents: 70000, lead_id: 9, first_utm_source: 'old', paid_cents: 0 },
    ],
  }, { now });
  assert.equal(r.linkedQuotes, 2);
  assert.equal(r.unlinkedQuotes, 1);
  assert.deepEqual(r.sources[0], { label: 'google.com', leads: 2, quotes: 1, signed: 1, signedCents: 400000, collectedCents: 200000 });
  assert.deepEqual(r.sources[1], { label: 'nextdoor', leads: 1, quotes: 1, signed: 0, signedCents: 0, collectedCents: 0 });
  assert.ok(!r.sources.some((s) => s.label === 'old'), 'quotes outside the window are not credited');
  const noPay = summarizeSourceRevenue({ leads: [], quotes: [{ created_at: iso(1), lead_id: 1, first_utm_source: 'x', total_cents: 1 }] }, { now });
  assert.equal(noPay.sources[0].collectedCents, null, 'collected is unknown, not $0, when payments are unreadable');
  assert.equal(summarizeSourceRevenue({ leads: [], quotes: null }), null);
  pass('source attribution credits only linked quotes, reports coverage, and never fabricates collected money');
}

{
  const env = freshEnv();
  const leadId = addLead(env, { utm: 'nextdoor', referrer: null });
  const q = await call(quotesIndex.onRequestPost, env, { method: 'POST', body: { customer: { name: 'Pat', phone: '5035550100' }, items, leadId } });
  const signed = new Date().toISOString();
  env.QUOTES_DB.raw.prepare(`UPDATE quotes SET status = 'finalized', signed_at = ? WHERE id = ?`).run(signed, q.body.id);
  const first = await call(analytics.onRequest, env);
  assert.deepEqual(first.body.pipeline.bySource.sources[0], { label: 'nextdoor', leads: 1, quotes: 1, signed: 1, signedCents: 90000, collectedCents: null }, 'before jobs exist, collected is unknown');

  env.QUOTES_DB.raw.exec(`CREATE TABLE jobs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, quote_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'ready', customer_name TEXT NOT NULL, completed_at TEXT)`);
  env.QUOTES_DB.raw.exec(`CREATE TABLE job_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, amount_paid_cents INTEGER NOT NULL DEFAULT 0)`);
  env.QUOTES_DB.raw.prepare(`INSERT INTO jobs (id, created_at, updated_at, quote_id, customer_name) VALUES ('J-1', ?, ?, ?, 'Pat')`).run(signed, signed, q.body.id);
  env.QUOTES_DB.raw.prepare(`INSERT INTO job_payments (job_id, created_at, updated_at, amount_paid_cents) VALUES ('J-1', ?, ?, 45000)`).run(signed, signed);
  const second = await call(analytics.onRequest, env);
  assert.equal(second.body.pipeline.bySource.sources[0].collectedCents, 45000);
  assert.equal(second.body.pipeline.bySource.linkedQuotes, 1);
  assert.ok(!/Pat|Q-|J-1|5035550100/.test(JSON.stringify(second.body.pipeline)), 'aggregates only: no names, phones or record ids');
  pass('the Analytics endpoint traces request source through quote, job and payment on real SQL');
}

{
  const view = fs.readFileSync('src/pages/internal/quotes/view.astro', 'utf8');
  const builder = fs.readFileSync('src/pages/internal/quotes/new.astro', 'utf8');
  const leadsPage = fs.readFileSync('src/pages/internal/leads.astro', 'utf8');
  const page = fs.readFileSync('src/pages/internal/analytics.astro', 'utf8');
  const middleware = fs.readFileSync('functions/internal/_middleware.js', 'utf8');
  assert.ok(/\/internal\/api\/quote-lead/.test(view) && /loadLeadLink/.test(view), 'the quote page shows and edits the inquiry link');
  const panel = view.slice(view.indexOf('async function loadLeadLink'), view.indexOf('async function load()'));
  assert.ok(!/innerHTML/.test(panel), 'the inquiry panel is built with textContent');
  assert.ok(/leadId \}/.test(builder) && /!editId && leadId/.test(builder), 'only a new quote from an inquiry sends leadId');
  assert.ok(/lead\.quote_id/.test(leadsPage), 'the leads list links to an existing quote');
  assert.ok(/data-source-rows/.test(page) && /renderSources/.test(page));
  assert.ok(!/quote-lead/.test(middleware.match(/PUBLIC_PATHS[^;]*/)?.[0] || ''), 'the link endpoint is not public');
  pass('the builder, quote page, leads list and Analytics page are wired to the link');
}

console.log('Lead link checks passed.');
