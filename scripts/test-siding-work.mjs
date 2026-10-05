// Siding vs window work in the Command Center, executed against the real handlers on real SQLite
// (no network). Owner decisions, 2026-10-04:
//   - a siding quote is approved by its signature alone: the window Build Plan does not apply;
//   - window quotes keep every gate exactly as before;
//   - a quote, its invoice and its job all carry the same type, which is fixed at creation;
//   - requests from the siding page are filed as siding leads without ever risking the lead itself.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1 } from './_lib/d1-sqlite.mjs';
import * as quotesIndex from '../functions/internal/api/quotes/index.js';
import * as quoteById from '../functions/internal/api/quotes/[id].js';
import * as invoicesIndex from '../functions/internal/api/invoices/index.js';
import * as buildPlan from '../functions/internal/api/build-plan.js';
import * as planState from '../functions/internal/api/build-plan-state.js';
import * as share from '../functions/internal/api/quote-share.js';
import * as customerSign from '../functions/api/quote-sign.js';
import * as jobsApi from '../functions/internal/api/jobs.js';
import * as checklistApi from '../functions/internal/api/job-checklist.js';
import * as closeoutApi from '../functions/internal/api/job-closeout.js';
import * as paymentsApi from '../functions/internal/api/payments.js';
import * as dashboardApi from '../functions/internal/api/dashboard.js';
import * as leadsApi from '../functions/internal/api/leads.js';
import { onRequestPost as submitEstimate } from '../functions/api/estimate.js';
import { leadServiceFromForm } from '../functions/_lib/lead-service.mjs';
import { parseWorkType } from '../functions/internal/_lib/work-types.mjs';

process.removeAllListeners('warning');
const pass = (message) => console.log(`PASS: ${message}`);
const ORIGIN = 'https://windowsbyclearview.com';

async function call(handler, env, { method = 'GET', path = '/', body, params = {} } = {}) {
  const request = new Request(`${ORIGIN}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const response = await handler({ request, env, params, waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
const freshEnv = () => ({ QUOTES_DB: createD1({ schemaFiles: ['functions/api/_data/schema.sql', 'internal/db/schema.sql'] }) });
const customer = { name: 'Sam Siding', phone: '(360) 555-0142', email: 'sam@example.com', address: '9 Cedar Ln', city: 'Battle Ground' };
const sidingItems = [
  { label: 'Siding labor, existing home (per sq ft of wall)', quantity: 1800, unitPriceCents: 300 },
  { label: 'Fiber cement material', quantity: 1, unitPriceCents: 450000 },
];
const windowItems = [{ label: 'Double-hung vinyl window', quantity: 3, unitPriceCents: 85000 }];
const newQuote = (env, body) => call(quotesIndex.onRequestPost, env, { method: 'POST', body: { customer, signatureMethod: 'pen', ...body } });
const signPen = (env, id) => call(quoteById.onRequestPatch, env, { method: 'PATCH', params: { id }, body: { confirmPen: true, signatureName: 'Sam Siding' } });

// ── Parsing ────────────────────────────────────────────────────────────────
{
  assert.deepEqual(parseWorkType(undefined), { workType: 'windows' });
  assert.deepEqual(parseWorkType(''), { workType: 'windows' });
  assert.deepEqual(parseWorkType('Siding'), { workType: 'siding' });
  assert.ok(parseWorkType('roofing').error, 'an unknown type is refused, not guessed');
  const env = freshEnv();
  assert.equal((await newQuote(env, { workType: 'roofing', items: sidingItems })).status, 400);
  pass('work type: missing means windows, siding is accepted, anything else is a 400');
}

// ── Window quotes keep the Build Plan gate ─────────────────────────────────
{
  const env = freshEnv();
  const created = await newQuote(env, { items: windowItems });
  assert.equal(created.status, 201);
  assert.equal(created.body.workType, 'windows');
  const refused = await signPen(env, created.body.id);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'BUILD_PLAN_REQUIRED', 'a window quote still cannot be signed without an approved Build Plan');
  const shareTry = await call(share.onRequestPost, env, { method: 'POST', body: { quoteId: created.body.id } });
  assert.equal(shareTry.status, 409, 'and cannot be sent to the customer for signing either');
  pass('window quotes: signing and sharing are still gated on an approved Build Plan');
}

// ── Siding quotes: signature only ──────────────────────────────────────────
const env = freshEnv();
let sidingQuoteId;
{
  const created = await newQuote(env, { workType: 'siding', items: sidingItems });
  assert.equal(created.status, 201);
  assert.equal(created.body.workType, 'siding');
  sidingQuoteId = created.body.id;
  assert.equal(created.body.totalCents, 1800 * 300 + 450000, 'square feet times the labor rate, plus material, in whole cents');

  for (const [name, handler, opts] of [
    ['generate', buildPlan.onRequestGet, { path: `/p?quoteId=${sidingQuoteId}` }],
    ['save', buildPlan.onRequestPost, { method: 'POST', body: { quoteId: sidingQuoteId, plan: {} } }],
    ['state', planState.onRequestPost, { method: 'POST', body: { quoteId: sidingQuoteId, action: 'submit-review' } }],
    ['state read', planState.onRequestGet, { path: `/p?quoteId=${sidingQuoteId}` }],
  ]) {
    const result = await call(handler, env, opts);
    assert.equal(result.status, 409, `Build Plan ${name} is refused for siding`);
    assert.equal(result.body.code, 'SIDING_NO_BUILD_PLAN');
  }

  // No bogus "openings" are generated from 1,800 square feet.
  assert.equal(env.QUOTES_DB.raw.prepare('SELECT COUNT(*) AS n FROM quote_build_plans').get().n, 0, 'no window plan row is created for a siding quote');

  // Sending a customer link switches a quote to the on-device signing path, so use a second siding quote for it.
  const forLink = await newQuote(env, { workType: 'siding', items: sidingItems });
  const link = await call(share.onRequestPost, env, { method: 'POST', body: { quoteId: forLink.body.id } });
  assert.equal(link.status, 201, 'a customer signing link can be created for a siding quote without a Build Plan');

  const signed = await signPen(env, sidingQuoteId);
  assert.equal(signed.status, 200, 'the signature alone approves a siding quote');
  const detail = await call(quoteById.onRequestGet, env, { params: { id: sidingQuoteId } });
  assert.equal(detail.body.quote.status, 'finalized');
  assert.equal(detail.body.quote.work_type, 'siding');
  pass('siding quotes: no Build Plan, signing link and signature work, totals are exact');
}

// ── The customer's own signing link works for a siding quote ────────────────
{
  const draft = await newQuote(env, { workType: 'siding', items: sidingItems });
  const id = draft.body.id;
  const link = await call(share.onRequestPost, env, { method: 'POST', body: { quoteId: id } });
  const token = link.body.url.split('#')[1];
  const request = (init) => new Request(`${ORIGIN}/api/quote-sign`, { headers: { 'content-type': 'application/json', ...(init.headers || {}) }, method: init.method || 'GET', body: init.body });
  const opened = await customerSign.onRequest({ request: request({ headers: { 'x-sign-token': token } }), env, params: {}, waitUntil() {} });
  assert.equal(opened.status, 200, 'the customer can open a siding quote');
  const strokes = [[[10, 10], [60, 40], [120, 30]], [[200, 90], [260, 120]]];
  const signedByCustomer = await customerSign.onRequest({ request: request({ method: 'POST', body: JSON.stringify({ t: token, name: 'Sam Siding', strokes, consent: true }) }), env, params: {}, waitUntil() {} });
  assert.equal(signedByCustomer.status, 200, 'and sign it on their own device with no Build Plan');
  const row = env.QUOTES_DB.raw.prepare('SELECT status, work_type FROM quotes WHERE id = ?').get(id);
  assert.deepEqual({ ...row }, { status: 'finalized', work_type: 'siding' });
  assert.equal(env.QUOTES_DB.raw.prepare('SELECT work_type FROM invoices WHERE quote_id = ?').get(id).work_type, 'siding');
  pass('customer signing link: a siding quote can be opened and signed with no Build Plan, and its invoice is siding');
}

// ── The type is fixed once a quote exists ──────────────────────────────────
{
  const draft = await newQuote(env, { workType: 'siding', items: sidingItems });
  const id = draft.body.id;
  const relabel = await call(quoteById.onRequestPut, env, { method: 'PUT', params: { id }, body: { customer, workType: 'windows', items: windowItems, signatureMethod: 'pen' } });
  assert.equal(relabel.status, 409);
  assert.equal(relabel.body.code, 'WORK_TYPE_FIXED', 'a siding draft cannot be turned into a window quote');
  const edit = await call(quoteById.onRequestPut, env, { method: 'PUT', params: { id }, body: { customer, items: [...sidingItems, { label: 'Tear-off and new plywood', quantity: 400, unitPriceCents: 200 }], signatureMethod: 'pen' } });
  assert.equal(edit.status, 200, 'an ordinary edit of a siding draft still works');
  assert.equal((await call(quoteById.onRequestGet, env, { params: { id } })).body.quote.work_type, 'siding', 'and the type survives the edit');

  const windows = await newQuote(env, { items: windowItems });
  const relabelWindows = await call(quoteById.onRequestPut, env, { method: 'PUT', params: { id: windows.body.id }, body: { customer, workType: 'siding', items: windowItems, signatureMethod: 'pen' } });
  assert.equal(relabelWindows.status, 409, 'and a window draft cannot dodge its gate by becoming siding');
  pass('type is fixed at creation: relabelling a draft either way is refused');
}

// ── Invoices inherit the type ──────────────────────────────────────────────
{
  const windowsQuote = await newQuote(env, { items: windowItems });
  const all = await call(invoicesIndex.onRequestGet, env);
  const byQuote = new Map(all.body.invoices.map((i) => [i.quote_id, i]));
  assert.equal(byQuote.get(sidingQuoteId).work_type, 'siding', 'the signed siding quote has a siding invoice');
  assert.equal(byQuote.get(windowsQuote.body.id).work_type, 'windows', 'the window quote has a window invoice');
  const sidingOnly = await call(invoicesIndex.onRequestGet, env, { path: '/p?workType=siding' });
  assert.ok(sidingOnly.body.invoices.length >= 1 && sidingOnly.body.invoices.every((i) => i.work_type === 'siding'), 'invoice filter returns only siding');
  const invoice = (await call(quoteById.onRequestGet, env, { params: { id: sidingQuoteId } })).body.invoice;
  assert.equal(invoice.status, 'open', 'signing a siding quote opens its invoice');
  assert.equal(invoice.total_cents, 1800 * 300 + 450000);
  assert.equal((await call(invoicesIndex.onRequestGet, env, { path: '/p?workType=roofing' })).status, 400);
  pass('invoices: each carries its quote\'s type, can be filtered, and opens on signature');
}

// ── Quote list filter and badge data ───────────────────────────────────────
{
  const sidingList = await call(quotesIndex.onRequestGet, env, { path: '/p?workType=siding' });
  assert.ok(sidingList.body.quotes.length >= 2 && sidingList.body.quotes.every((q) => q.work_type === 'siding'));
  const windowList = await call(quotesIndex.onRequestGet, env, { path: '/p?workType=windows' });
  assert.ok(windowList.body.quotes.length >= 2 && windowList.body.quotes.every((q) => q.work_type === 'windows'));
  const everything = await call(quotesIndex.onRequestGet, env);
  assert.equal(everything.body.total, sidingList.body.total + windowList.body.total, 'every quote is exactly one of the two types');
  assert.equal((await call(quotesIndex.onRequestGet, env, { path: '/p?workType=roofing' })).status, 400);
  const both = await call(quotesIndex.onRequestGet, env, { path: '/p?workType=siding&status=finalized' });
  assert.ok(both.body.quotes.some((q) => q.id === sidingQuoteId) && both.body.quotes.every((q) => q.work_type === 'siding' && q.status === 'finalized'), 'the type filter combines with the status filter');
  pass('quote list: filter by type (alone or with status), every row carries its type');
}

// ── Jobs: siding jobs come from a signed siding quote, with no window gates ─
let sidingJobId;
{
  const created = await call(jobsApi.onRequestPost, env, { method: 'POST', body: { quoteId: sidingQuoteId } });
  assert.equal(created.status, 201, 'a signed siding quote becomes a job without a Build Plan snapshot');
  assert.equal(created.body.workType, 'siding');
  sidingJobId = created.body.id;
  const again = await call(jobsApi.onRequestPost, env, { method: 'POST', body: { quoteId: sidingQuoteId } });
  assert.equal(again.body.existing, true, 'creating it twice returns the same job');

  const detail = await call(jobsApi.onRequestGet, env, { path: `/p?id=${sidingJobId}` });
  assert.equal(detail.body.job.work_type, 'siding');
  assert.equal(detail.body.buildPlan, null, 'no Build Plan snapshot is attached');
  assert.equal(detail.body.quote.id, sidingQuoteId);
  assert.equal(detail.body.items.length, 2, 'the signed quote items are the scope');

  const windowsQuote = await newQuote(env, { items: windowItems });
  await signPen(env, windowsQuote.body.id).catch(() => {});
  const windowJob = await call(jobsApi.onRequestPost, env, { method: 'POST', body: { quoteId: windowsQuote.body.id } });
  assert.equal(windowJob.status, 409, 'a window quote still cannot become a job without a signed, approved plan');

  const list = await call(jobsApi.onRequestGet, env, { path: '/p?workType=siding' });
  assert.deepEqual(list.body.jobs.map((j) => j.id), [sidingJobId]);
  assert.equal(list.body.jobs[0].total_cents, 1800 * 300 + 450000, 'the job total is the signed quote total');
  assert.equal((await call(jobsApi.onRequestGet, env, { path: '/p?workType=roofing' })).status, 400);
  assert.equal((await call(jobsApi.onRequestGet, env, { path: '/p?workType=windows' })).body.jobs.some((j) => j.id === sidingJobId), false, 'a siding job is not in the window list');
  pass('jobs: siding job from a signed siding quote, no plan, filterable, window path unchanged');
}

{
  const checklist = await call(checklistApi.onRequestGet, env, { path: `/p?jobId=${sidingJobId}` });
  assert.equal(checklist.status, 409);
  assert.equal(checklist.body.code, 'SIDING_JOB', 'the window field checklist is not seeded for a siding job');
  assert.equal(env.QUOTES_DB.raw.prepare('SELECT COUNT(*) AS n FROM job_checklist_items WHERE job_id = ?').get(sidingJobId).n, 0);
  const closeout = await call(closeoutApi.onRequestGet, env, { path: `/p?jobId=${sidingJobId}` });
  assert.equal(closeout.status, 409, 'the opening-by-opening closeout does not apply');
  const reconcile = await call(jobsApi.onRequestPatch, env, { method: 'PATCH', path: `/p?id=${sidingJobId}`, body: { action: 'reconcileBuildPlan' } });
  assert.equal(reconcile.body.code, 'SIDING_JOB', 'there is no plan to attach');

  const scheduled = await call(jobsApi.onRequestPatch, env, { method: 'PATCH', path: `/p?id=${sidingJobId}`, body: { status: 'scheduled', scheduledDate: '2026-10-20', notes: 'Back wall first' } });
  assert.equal(scheduled.status, 200);
  const done = await call(jobsApi.onRequestPatch, env, { method: 'PATCH', path: `/p?id=${sidingJobId}`, body: { status: 'completed' } });
  assert.equal(done.status, 200, 'a siding job can be completed without the window checklist or closeout');
  pass('siding jobs: no window checklist or closeout, schedule and complete normally');
}

// ── Payments work for siding jobs and show the type ────────────────────────
{
  const list = await call(paymentsApi.onRequestGet, env);
  const row = list.body.jobs.find((j) => j.id === sidingJobId);
  assert.ok(row, 'the siding job is on the payments list');
  assert.equal(row.work_type, 'siding');
  const paid = await call(paymentsApi.onRequestPatch, env, { method: 'PATCH', path: `/p?jobId=${sidingJobId}`, body: { amountPaidCents: 100000, paymentMethod: 'check' } });
  assert.equal(paid.status, 200, 'a deposit can be recorded against a siding job');
  pass('payments: siding jobs are listed with their type and take payments');
}

// ── Dashboard rows carry the type ──────────────────────────────────────────
{
  const { body } = await call(dashboardApi.onRequestGet, env);
  assert.ok(body.recentQuotes.every((q) => q.work_type === 'windows' || q.work_type === 'siding'), 'recent quotes carry a type');
  assert.ok(body.recentQuotes.some((q) => q.work_type === 'siding'));
  pass('dashboard: recent quotes carry their type');
}

// ── Leads: the siding page files a siding inquiry, and never loses one ─────
{
  assert.equal(leadServiceFromForm('siding', ''), 'siding');
  assert.equal(leadServiceFromForm('SIDING', 'x'), 'siding');
  assert.equal(leadServiceFromForm('', 'House siding\nWhole house'), 'siding', "the page's own prefill counts");
  assert.equal(leadServiceFromForm('roofing', 'Replace 6 windows'), null, 'anything else is untagged, never guessed');
  assert.equal(leadServiceFromForm(undefined, 'We want new house siding someday'), null, 'a mention mid-sentence is not a tag');

  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (!String(url).startsWith('https://ntfy.sh/')) sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 'm' }), { status: 200 }); };
  try {
    const leadEnv = { QUOTES_DB: createD1({ schemaFiles: ['functions/api/_data/schema.sql', 'internal/db/schema.sql'] }), RESEND_API_KEY: 'k' };
    const submit = async (fields) => {
      const form = new FormData();
      for (const [k, v] of Object.entries({ name: 'Lee Lead', phone: '(360) 555-0188', city: 'Camas', ...fields })) form.set(k, v);
      const request = new Request(`${ORIGIN}/api/estimate`, { method: 'POST', headers: { accept: 'application/json', origin: ORIGIN }, body: form });
      const pending = [];
      const response = await submitEstimate({ request, env: leadEnv, waitUntil: (p) => pending.push(p) });
      await Promise.all(pending);
      return response.status;
    };
    assert.equal(await submit({ service: 'siding', notes: 'House siding\nBack and east wall' }), 200);
    assert.equal(await submit({ notes: 'Six windows, upstairs' }), 200);
    assert.equal(await submit({ service: 'bogus', notes: 'Patio door' }), 200);
    const rows = leadEnv.QUOTES_DB.raw.prepare('SELECT notes, service FROM leads ORDER BY id').all();
    assert.deepEqual(rows.map((r) => r.service), ['siding', null, null], 'only the siding request is tagged');
    assert.match(sent[0].template.variables.NOTES, /\[Siding\]/, "Mark's email says it is a siding request");
    assert.doesNotMatch(sent[1].template.variables.NOTES, /Siding/, 'a window request email is unchanged');

    const listed = await call(leadsApi.onRequestGet, leadEnv);
    assert.deepEqual(listed.body.leads.map((l) => l.service ?? null).reverse(), ['siding', null, null], 'the internal leads list carries the tag');

    // A database where the column cannot be added still saves the lead (the original column list).
    const stubborn = { QUOTES_DB: createD1({ schemaFiles: ['functions/api/_data/schema.sql'] }), RESEND_API_KEY: 'k' };
    const realPrepare = stubborn.QUOTES_DB.prepare;
    stubborn.QUOTES_DB.prepare = (sql) => (/ALTER TABLE leads ADD COLUMN service/.test(sql) ? { run: async () => { throw new Error('read-only'); } } : realPrepare(sql));
    const form = new FormData();
    for (const [k, v] of Object.entries({ name: 'Kim', phone: '(360) 555-0199', city: 'Camas', service: 'siding' })) form.set(k, v);
    const request = new Request(`${ORIGIN}/api/estimate`, { method: 'POST', headers: { accept: 'application/json', origin: ORIGIN }, body: form });
    const pending = [];
    const response = await submitEstimate({ request, env: stubborn, waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
    assert.equal(response.status, 200);
    assert.equal(stubborn.QUOTES_DB.raw.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 1, 'the lead is saved even when it cannot be tagged');
  } finally { globalThis.fetch = realFetch; }
  pass('leads: the siding page files a siding inquiry; untagged otherwise; a tagging failure never loses the lead');
}

// ── Older databases get the columns lazily ─────────────────────────────────
{
  const old = freshEnv();
  old.QUOTES_DB.raw.exec('ALTER TABLE quotes DROP COLUMN work_type');
  const windowsQuote = await newQuote(old, { items: windowItems });
  assert.equal(windowsQuote.status, 201, 'creating a quote on a database without the column adds it');
  const detail = await call(quoteById.onRequestGet, old, { params: { id: windowsQuote.body.id } });
  assert.equal(detail.body.quote.work_type, 'windows');
  const legacy = freshEnv();
  legacy.QUOTES_DB.raw.exec("INSERT INTO quotes (id, created_at, updated_at, status, customer_name, total_cents) VALUES ('Q-20260101-AAAA','2026-01-01','2026-01-01','draft','Old Quote',1000)");
  legacy.QUOTES_DB.raw.exec('ALTER TABLE quotes DROP COLUMN work_type');
  const list = await call(quotesIndex.onRequestGet, legacy);
  assert.equal(list.body.quotes[0].work_type, 'windows', 'a quote that predates the column reads as windows');
  const dash = await call(dashboardApi.onRequestGet, legacy);
  assert.equal(dash.status, 200, 'the dashboard opens on a database that has not been migrated yet');
  pass('older databases: columns are added on first use and old rows read as windows');
}

// ── The phone screens carry the type (markup contracts; the behaviour is checked in a real browser) ──
{
  const page = (path) => readFileSync(new URL(`../src/pages/internal/${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const builder = page('quotes/new.astro');
  assert.match(builder, /name="workType" value="siding"/, 'the builder can start a siding quote');
  assert.match(builder, /data-wt-panel="siding"[^>]*hidden/, 'the siding rates are hidden until Siding is chosen');
  assert.match(builder, /\n\s+workType,\n/, 'the builder sends the chosen type to the server');
  assert.match(builder, /typeRadios\.forEach\(\(radio\) => \{ radio\.disabled = true; \}\)/, 'editing a saved quote locks the type');
  for (const path of ['quotes/index.astro', 'invoices/index.astro', 'jobs/index.astro', 'leads.astro']) {
    const source = page(path);
    assert.match(source, /<WorkTypeFilter \/>/, `${path} has the All / Windows / Siding filter`);
    assert.match(source, /bindWorkTypeFilter/, `${path} wires it`);
  }
  for (const path of ['quotes/index.astro', 'invoices/index.astro']) assert.match(page(path), /params?\.set\('workType'|workType\?`\?workType=/, `${path} asks the server for the chosen type`);
  assert.match(page('quotes/index.astro'), /x\.work_type!=='siding'/, 'the quote list never asks for a Build Plan on a siding quote');
  assert.match(page('jobs/view.astro'), /data-quote-scope/, 'a siding job keeps its quoted scope on the job page');
  assert.match(page('leads.astro'), /type=siding/, 'a siding inquiry starts a siding quote');
  pass('phone screens: type chooser, filters, siding rates and job page are wired');
}

console.log('siding work: ok');
