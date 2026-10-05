// Command Center bug fixes, executed against the real handlers on real SQLite (no network):
//   money shown to the cent (invoice email, reminders, client/server formatter parity),
//   dashboard "cities" grouping, deleting a draft quote leaves nothing behind, follow-up due-date
//   validation, field-checklist seeding in batches, the signature the device submits (strokes, never
//   client markup, never cut off), and the markup/CSS contracts behind the phone fixes in the quote
//   builder and signature pad (focus kept while typing, no sideways scroll).
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createD1 } from './_lib/d1-sqlite.mjs';
import { formatCents as serverMoney } from '../functions/internal/_lib/money.mjs';
import { emailInvoice } from '../functions/internal/_lib/invoices.mjs';
import { planQuoteFollowUps } from '../functions/internal/_lib/quote-follow-ups.mjs';
import * as quotesIndex from '../functions/internal/api/quotes/index.js';
import * as quoteById from '../functions/internal/api/quotes/[id].js';
import * as buildPlan from '../functions/internal/api/build-plan.js';
import * as planState from '../functions/internal/api/build-plan-state.js';
import * as share from '../functions/internal/api/quote-share.js';
import * as tasksApi from '../functions/internal/api/tasks.js';
import * as dashboardApi from '../functions/internal/api/dashboard.js';
import * as checklistApi from '../functions/internal/api/job-checklist.js';
import * as jobsApi from '../functions/internal/api/jobs.js';
import * as paymentsApi from '../functions/internal/api/payments.js';

process.removeAllListeners('warning');
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(`${root}${path}`, 'utf8').replace(/\r\n/g, '\n');
const clientMoney = (await import(pathToFileURL(`${root}src/lib/money.ts`).href)).formatCents;
const pass = (message) => console.log(`PASS: ${message}`);
const ORIGIN = 'https://windowsbyclearview.com';

async function call(handler, env, { method = 'GET', path = '/', body, params = {} } = {}) {
  const request = new Request(`${ORIGIN}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const response = await handler({ request, env, params, waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
const freshEnv = () => ({ QUOTES_DB: createD1({ schemaFiles: ['functions/api/_data/schema.sql', 'internal/db/schema.sql'] }) });
const customer = { name: 'Pat Doe', phone: '(360) 555-0100', email: 'pat@example.com', address: '1 Main St', city: 'Camas' };

async function approvedQuote(env, body) {
  const created = await call(quotesIndex.onRequestPost, env, { method: 'POST', body: { customer, signatureMethod: 'digital', ...body } });
  assert.equal(created.status, 201);
  const id = created.body.id;
  const gen = await call(buildPlan.onRequestGet, env, { path: `/p?quoteId=${id}` });
  await call(buildPlan.onRequestPost, env, { method: 'POST', body: { quoteId: id, plan: gen.body.plan } });
  await call(planState.onRequestPost, env, { method: 'POST', body: { quoteId: id, action: 'submit-review' } });
  assert.equal((await call(planState.onRequestPost, env, { method: 'POST', body: { quoteId: id, action: 'approve' } })).status, 200);
  return id;
}

// ── Money: never round a cent away ─────────────────────────────────────────
{
  const table = [[0, '$0'], [100, '$1'], [123400, '$1,234'], [123450, '$1,234.50'], [123405, '$1,234.05'], [50, '$0.50'], [480050, '$4,800.50'], [12487.5, '$124.88'], [null, '$0'], ['x', '$0'], [undefined, '$0']];
  for (const [cents, shown] of table) {
    assert.equal(clientMoney(cents), shown, `client ${String(cents)}`);
    assert.equal(serverMoney(cents), shown, `server ${String(cents)} matches the client`);
  }
  pass('money: whole dollars stay short, cents are shown, client and server formatters agree');
}

{
  // The invoice a customer is emailed must carry the exact amounts: $1,234.50 subtotal, $0.50 discount.
  const env = freshEnv();
  const id = await approvedQuote(env, { signatureMethod: 'pen', items: [{ label: 'Slider', quantity: 1, unitPriceCents: 123450 }], discountCents: 50 });
  assert.equal((await call(quoteById.onRequestPatch, env, { method: 'PATCH', params: { id }, body: { confirmPen: true, signatureName: 'Pat Doe' } })).status, 200);
  let sent;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ id: 'x' }), { status: 200 }); };
  try {
    const result = await emailInvoice({ env: { ...env, RESEND_API_KEY: 'k' } }, `INV-${id.replace(/^Q-/, '')}`);
    assert.equal(result.ok, true);
  } finally { globalThis.fetch = realFetch; }
  const html = sent.html;
  assert.match(html, /Subtotal<\/td><td[^>]*>\$1,234\.50</, 'subtotal keeps its 50 cents');
  assert.match(html, /-\$0\.50</, 'the 50-cent discount is not shown as $1');
  assert.match(html, /Amount due<\/td><td[^>]*>\$1,234</, 'a whole-dollar total stays short');
  assert.match(html, /Issued \d{1,2}\/\d{1,2}\/\d{4}/);
  pass('invoice email shows exact subtotal, discount and total');
}

{
  const plan = planQuoteFollowUps({ quotes: [{ id: 'Q-1', created_at: '2026-09-01T00:00:00Z', customer_name: 'Pat', total_cents: 123450 }], tasks: [] }, Date.parse('2026-09-10T00:00:00Z'));
  assert.match(plan.create[0].notes, /\$1,234\.50/, 'the reminder quotes the exact amount');
  pass('follow-up reminder shows the exact quote amount');
}

{
  const env = freshEnv();
  const job = await call(jobsApi.onRequestPost, env, { method: 'POST', body: { workType: 'general', customerName: 'Gale', workDescription: 'Deck', agreedAmount: '4800.50' } });
  assert.equal(job.status, 201);
  const bad = await call(paymentsApi.onRequestPatch, env, { method: 'PATCH', path: `/p?jobId=${job.body.id}`, body: { amountPaidCents: 999999999 } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /\$4,800\.50/, 'the limit message shows the exact job total');
  pass('payment limit message shows the exact total');
}

// ── Dashboard cities ───────────────────────────────────────────────────────
{
  const env = freshEnv();
  const insert = env.QUOTES_DB.raw.prepare("INSERT INTO leads (created_at, name, city) VALUES ('2026-10-01T00:00:00Z', 'x', ?)");
  for (const city of [null, '', '  ', 'Camas', 'camas', ' Camas ', 'Camas', 'Vancouver']) insert.run(city);
  const { body } = await call(dashboardApi.onRequestGet, env);
  const labels = body.cities.map((c) => c.city);
  assert.equal(new Set(labels).size, labels.length, 'no label appears twice');
  assert.deepEqual(body.cities.find((c) => c.city === 'City not provided'), { city: 'City not provided', count: 3 });
  assert.equal(body.cities.find((c) => c.city === 'Camas').count, 4, 'Camas, camas and " Camas " are one city');
  assert.equal(body.cities.reduce((n, c) => n + c.count, 0), 8, 'every lead is counted once');
  pass('dashboard cities: NULL, empty and spacing/case variants are one row each');
}

// ── Deleting a draft leaves nothing behind ─────────────────────────────────
{
  const env = freshEnv();
  const id = await approvedQuote(env, { items: [{ label: 'Slider', quantity: 1, unitPriceCents: 100000 }] });
  assert.equal((await call(share.onRequestPost, env, { method: 'POST', body: { quoteId: id } })).status, 201);
  await call(tasksApi.onRequestGet, env); // creates the reminder table
  env.QUOTES_DB.raw.prepare("INSERT INTO follow_up_tasks (created_at, updated_at, title, quote_id, cadence_step) VALUES ('x','x','t',?,2)").run(id);
  assert.equal((await call(quoteById.onRequestDelete, env, { method: 'DELETE', params: { id } })).status, 200);
  const count = (table) => env.QUOTES_DB.raw.prepare(`SELECT COUNT(*) n FROM ${table} WHERE quote_id = ?`).get(id).n;
  for (const table of ['quote_items', 'quote_build_plans', 'quote_sign_links', 'follow_up_tasks']) assert.equal(count(table), 0, `${table} is cleaned up`);
  assert.equal(env.QUOTES_DB.raw.prepare('SELECT COUNT(*) n FROM invoices WHERE quote_id = ?').get(id).n, 0);

  // A database that never created those tables yet must still delete cleanly.
  const bare = freshEnv();
  const q = await call(quotesIndex.onRequestPost, bare, { method: 'POST', body: { customer, items: [{ label: 'x', quantity: 1, unitPriceCents: 100 }] } });
  assert.equal((await call(quoteById.onRequestDelete, bare, { method: 'DELETE', params: { id: q.body.id } })).status, 200);
  pass('deleting a draft removes its signing links and reminders, even on a fresh database');
}

// ── Follow-up due dates ────────────────────────────────────────────────────
{
  const env = freshEnv();
  const post = (body) => call(tasksApi.onRequestPost, env, { method: 'POST', body: { title: 'Call', ...body } });
  assert.equal((await post({ dueAt: 'tomorrow' })).status, 400, 'text that is not a date is refused');
  assert.equal((await post({ dueAt: '2026-13-45' })).status, 400);
  const ok = await post({ dueAt: '2026-10-05T16:30:00-07:00' });
  assert.equal(ok.status, 201);
  assert.equal(env.QUOTES_DB.raw.prepare('SELECT due_at FROM follow_up_tasks WHERE id = ?').get(ok.body.id).due_at, '2026-10-05T23:30:00.000Z', 'stored as UTC ISO');
  assert.equal((await post({})).status, 201, 'no due date is still fine');
  assert.equal((await post({ dueAt: '' })).status, 201);
  const patch = (body) => call(tasksApi.onRequestPatch, env, { method: 'PATCH', path: `/p?id=${ok.body.id}`, body });
  assert.equal((await patch({ dueAt: 'soon' })).status, 400);
  assert.equal((await patch({ status: 'done' })).status, 200, 'other edits leave the date alone');
  assert.equal(env.QUOTES_DB.raw.prepare('SELECT due_at FROM follow_up_tasks WHERE id = ?').get(ok.body.id).due_at, '2026-10-05T23:30:00.000Z');
  assert.equal((await patch({ dueAt: '' })).status, 200);
  assert.equal(env.QUOTES_DB.raw.prepare('SELECT due_at FROM follow_up_tasks WHERE id = ?').get(ok.body.id).due_at, null, 'an empty date clears it');
  pass('follow-up due dates are validated and stored as UTC');
}

// ── Field checklist seeding ────────────────────────────────────────────────
{
  const env = freshEnv();
  const id = await approvedQuote(env, { items: [{ label: 'Slider', quantity: 12, unitPriceCents: 50000 }] });
  await env.QUOTES_DB.prepare(`UPDATE quotes SET status='finalized', signed_at='x', signature_name='x' WHERE id = ?`).bind(id).run();
  const job = await call(jobsApi.onRequestPost, env, { method: 'POST', body: { quoteId: id } });
  assert.equal(job.status, 201);
  const openings = JSON.parse(env.QUOTES_DB.raw.prepare('SELECT build_plan_json FROM jobs WHERE id = ?').get(job.body.id).build_plan_json).openings.length;
  assert.ok(openings >= 2);
  let queries = 0;
  const db = env.QUOTES_DB;
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => { if (/INSERT OR IGNORE INTO job_checklist_items/.test(sql)) queries++; const st = prepare(sql); return st; };
  let batches = 0;
  const batch = db.batch.bind(db);
  db.batch = (list) => { batches++; return batch(list); };
  const first = await call(checklistApi.onRequestGet, env, { path: `/p?jobId=${job.body.id}` });
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 14 + 8 * openings, 'every default and every opening gate is seeded');
  assert.ok(queries >= 14 + 8 * openings && batches <= 3, `seeded in ${batches} batch(es), not ${queries} separate queries`);
  const again = await call(checklistApi.onRequestGet, env, { path: `/p?jobId=${job.body.id}` });
  assert.equal(again.body.items.length, first.body.items.length, 're-opening never duplicates rows');
  pass('field checklist seeds in a single batch and stays idempotent');
}

// ── The signature Mark's device submits ────────────────────────────────────
{
  const env = freshEnv();
  const id = await approvedQuote(env, { items: [{ label: 'Slider', quantity: 1, unitPriceCents: 100000 }] });
  const patch = (body) => call(quoteById.onRequestPatch, env, { method: 'PATCH', params: { id }, body });
  const stroke = (n) => Array.from({ length: n }, (_, i) => [(i * 0.17) % 600, 20 + ((i * 7) % 140)]);

  assert.equal((await patch({ signatureName: 'Pat Doe' })).status, 400, 'a name alone is not a signature');
  assert.equal((await patch({ signatureSvg: '<svg onload="x()"/>', signatureName: 'Pat Doe' })).status, 400, 'client markup is no longer accepted');
  assert.equal((await patch({ signatureStrokes: [[[10, 10], [700, 20]]], signatureName: 'Pat Doe' })).status, 400, 'points outside the pad are refused');
  assert.equal((await patch({ signatureStrokes: [[[1, 1]]], signatureName: 'Pat Doe' })).status, 400, 'a single dot is not a signature');
  assert.equal(env.QUOTES_DB.raw.prepare('SELECT status FROM quotes WHERE id = ?').get(id).status, 'draft', 'nothing was finalized by the refused attempts');

  // A long, fluid signature: before, anything over 20,000 characters was cut off mid-tag.
  const long = [stroke(1500), stroke(1500)];
  const result = await patch({ signatureStrokes: long, signatureName: 'Pat Doe' });
  assert.equal(result.status, 200);
  const row = env.QUOTES_DB.raw.prepare('SELECT status, signature_svg, signature_name FROM quotes WHERE id = ?').get(id);
  assert.equal(row.status, 'finalized');
  assert.equal(row.signature_name, 'Pat Doe');
  assert.ok(row.signature_svg.length > 20000, `a ${row.signature_svg.length}-character signature is stored whole`);
  assert.ok(row.signature_svg.startsWith('<svg viewBox="0 0 600 180"') && row.signature_svg.endsWith('</svg>'), 'the stored SVG is complete');
  assert.equal((row.signature_svg.match(/<path /g) || []).length, 2);
  assert.ok(!/script|on\w+=/i.test(row.signature_svg));
  pass('Mark\'s signature is rendered by the server from strokes and never cut off');
}

// ── Phone contracts in the pages ───────────────────────────────────────────
{
  const builder = read('src/pages/internal/quotes/new.astro');
  const pad = read('src/pages/internal/quotes/view.astro');

  // Typing must not rebuild the rows (that replaced the field being typed in).
  for (const [field, handler] of [['qtyInputEl', 'quantity'], ['priceInputEl', 'unitPrice']]) {
    const block = new RegExp(`${field}\\.addEventListener\\('input', \\(\\) => \\{([\\s\\S]*?)\\}\\);`).exec(builder)?.[1] || '';
    assert.ok(block.includes(`items[index].${handler}`), `${field} updates the item`);
    assert.ok(block.includes('updateTotals();') && !/\brender\(\)/.test(block), `${field} only refreshes totals`);
  }
  assert.match(builder, /discountInput\.addEventListener\('input', updateTotals\)/);
  assert.match(builder, /import \{ formatCents \} from '..\/..\/..\/lib\/money'/);
  assert.match(builder, /\.qb-block \{\s*min-width: 0;/, 'the fieldset can shrink below its widest child');
  assert.match(builder, /\.qb-items thead \{\s*display: none;/, 'line items stack as cards on a phone');

  // The signature pad scales to the screen and converts pointer positions into its own units.
  assert.match(pad, /\[data-sig-canvas\] \{\s*width: 100%;\s*max-width: 600px;/);
  assert.ok(!/canvas\.style\.width/.test(pad), 'the pad is no longer forced to 600px wide');
  assert.match(pad, /\* PAD_W\) \/ \(rect\.width \|\| PAD_W\)/, 'pointer x is scaled to the 600-unit pad');
  assert.match(pad, /signatureStrokes: strokes/, 'the page sends strokes, not markup');
  assert.ok(!/signatureSvg/.test(pad));
  assert.match(read('src/pages/internal/login.astro'), /Back to windowsbyclearview\.com/);
  pass('quote builder and signature pad phone contracts hold');
}

console.log('command center fixes: ok');

// Calendar-only job dates must not inherit the phone's timezone.
{
  const { formatScheduledDay } = await import(pathToFileURL(`${root}src/lib/scheduled-day.ts`).href);
  const originalZone = process.env.TZ;
  try {
    for (const zone of ['America/Los_Angeles', 'UTC', 'Pacific/Kiritimati', 'Pacific/Honolulu']) {
      process.env.TZ = zone;
      assert.equal(formatScheduledDay('2026-10-03'), 'Oct 3', zone);
      assert.equal(formatScheduledDay('2026-03-08'), 'Mar 8', `${zone}: DST start`);
      assert.equal(formatScheduledDay('2026-11-01'), 'Nov 1', `${zone}: DST end`);
      assert.equal(formatScheduledDay('2028-02-29'), 'Feb 29', `${zone}: leap day`);
    }
    assert.equal(formatScheduledDay(null), 'Unscheduled');
    assert.equal(formatScheduledDay('2026-02-30'), '2026-02-30');
    assert.equal(formatScheduledDay('invalid'), 'invalid');
  } finally {
    if (originalZone === undefined) delete process.env.TZ; else process.env.TZ = originalZone;
  }
  pass('dashboard job dates stay on the scheduled calendar day across timezones and DST');
}

// Execute the dashboard's real click handler: a second tap while the save is pending makes no write.
{
  const source = read('src/pages/internal/index.astro');
  const handler = source.slice(source.indexOf('    async function completeTask('), source.indexOf('    async function load('));
  assert.ok(handler.includes('async function completeTask'), 'dashboard completion handler exists');
  let resolveSave, writes = 0, reloads = 0;
  const status = { textContent: '' };
  const button = { disabled: false, textContent: 'Done' };
  const context = createContext({
    fetch: () => { writes++; return new Promise((resolve) => { resolveSave = resolve; }); },
    load: async () => { reloads++; },
    $: () => status,
    Error,
  });
  runInContext(stripTypeScriptTypes(handler), context);
  const first = context.completeTask(1, button);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Saving…');
  await context.completeTask(1, button);
  assert.equal(writes, 1);
  resolveSave(new Response(JSON.stringify({ ok: true })));
  await first;
  assert.equal(reloads, 1);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Done');
  const failed = context.completeTask(1, button);
  resolveSave(new Response(JSON.stringify({ error: 'Your session ended. Sign in again.' }), { status: 401 }));
  await failed;
  assert.equal(reloads, 1);
  assert.equal(status.textContent, 'Your session ended. Sign in again.');
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Done');
  pass('dashboard completion prevents duplicate saves and restores the button with the server error on failure');
}

// Filters are applied before pagination; summaries count the whole queue.
{
  const env = freshEnv();
  await call(jobsApi.onRequestGet, env);
  const insert = env.QUOTES_DB.raw.prepare(`INSERT INTO jobs (id,created_at,updated_at,status,customer_name) VALUES (?,'2026-10-01','2026-10-01',?,'Queue test')`);
  for (let i=0;i<205;i++) insert.run(`J-ready-${i}`, 'ready');
  for (let i=0;i<3;i++) insert.run(`J-completed-${i}`, 'completed');
  const completed = await call(jobsApi.onRequestGet, env, { path: '/internal/api/jobs?status=completed' });
  assert.equal(completed.body.jobs.length, 3);
  assert.equal(completed.body.total, 3);
  assert.equal(completed.body.activeTotal, 205);
  assert.ok(completed.body.jobs.every(job => job.status === 'completed'));
  const second = await call(jobsApi.onRequestGet, env, { path: '/internal/api/jobs?status=ready&page=2' });
  assert.equal(second.body.jobs.length, 5);
  assert.equal(second.body.total, 205);
  assert.equal((await call(jobsApi.onRequestGet, env, { path: '/internal/api/jobs?status=invalid' })).status, 400);
  pass('job filters find records beyond the first page; totals and active counts cover the whole queue');
}
{
  const env = freshEnv();
  await call(tasksApi.onRequestGet, env);
  const { start, end } = dashboardApi.pacificDayRange();
  const insert = env.QUOTES_DB.raw.prepare(`INSERT INTO follow_up_tasks (created_at,updated_at,title,status,due_at) VALUES ('2026-10-01','2026-10-01','Queue test',?,?)`);
  for (let i=0;i<205;i++) insert.run('open', null);
  insert.run('open', start);
  insert.run('open', new Date(Date.parse(start)-1).toISOString());
  insert.run('open', end);
  insert.run('done', start);
  const first = await call(tasksApi.onRequestGet, env, { path: '/internal/api/tasks?status=open' });
  const second = await call(tasksApi.onRequestGet, env, { path: '/internal/api/tasks?status=open&page=2' });
  assert.equal(first.body.total, 208);
  assert.equal(first.body.tasks.length, 200);
  assert.equal(second.body.tasks.length, 8);
  assert.ok(first.body.tasks.every(task => task.status === 'open'));
  assert.equal(first.body.summary.open, 208);
  assert.equal(first.body.summary.today, 1, 'Pacific midnight included; next midnight excluded; completed tasks excluded');
  assert.deepEqual(first.body.summary, second.body.summary, 'summary does not change between pages');
  assert.equal((await call(tasksApi.onRequestGet, env, { path: '/internal/api/tasks?status=invalid' })).status, 400);
  const id = first.body.tasks.find(task => task.due_at === start).id;
  const cleared = await call(tasksApi.onRequestPatch, env, { method: 'PATCH', path: `/internal/api/tasks?id=${id}`, body: { dueAt: null } });
  assert.equal(cleared.status, 200);
  assert.equal(env.QUOTES_DB.raw.prepare('SELECT due_at FROM follow_up_tasks WHERE id=?').get(id).due_at, null);
  pass('open follow-up pagination and summaries cover the full queue in Pacific time; null explicitly clears a due date');
}

// Run the real queue loader with responses finishing out of order.
{
  const source = read('src/pages/internal/jobs/index.astro');
  const handler = source.slice(source.indexOf('    async function loadJobs()'), source.indexOf('    async function loadQuotes()'));
  const requests = [];
  const output = { textContent: '' };
  const context = createContext({
    AbortController, URLSearchParams, Error,
    pending: null, jobs: [], activeFilter: 'ready', workType: '', page: 1, totalPages: 1, total: 0,
    prev: { disabled: true }, next: { disabled: true }, filters: [],
    count: output, updated: { textContent: '' }, pageLabel: { textContent: '' },
    list: { innerHTML: '', querySelector: () => null }, render: () => {},
    label: value => value, esc: value => String(value),
    fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })),
  });
  runInContext(stripTypeScriptTypes(handler), context);
  const oldRequest = context.loadJobs();
  context.activeFilter = 'completed';
  const newRequest = context.loadJobs();
  assert.equal(requests[0].options.signal.aborted, true);
  assert.match(requests[1].url, /status=completed/);
  requests[1].resolve(new Response(JSON.stringify({ jobs: [{ id:'new' }], page:1, total:1, totalPages:1, activeTotal:205 })));
  await newRequest;
  requests[0].resolve(new Response(JSON.stringify({ jobs: [{ id:'old' }], page:1, total:200, totalPages:1, activeTotal:999 })));
  await oldRequest;
  assert.equal(context.jobs[0].id, 'new');
  assert.equal(output.textContent, '205');
  pass('rapid job filter changes cannot replace the latest result with a late response');
}
{
  const source = read('src/pages/internal/follow-up.astro');
  const start = source.indexOf("      list.querySelectorAll('[data-done]')");
  const handler = source.slice(start, source.indexOf('\n    }\n    async function load()', start));
  class Element { hidden = true; textContent = ''; }
  class Button extends Element { disabled = false; dataset = { done:'1' }; addEventListener(_, callback) { this.callback=callback; } }
  const button = new Button(), error = new Element();
  const context = createContext({
    HTMLButtonElement: Button, HTMLElement: Element, Error,
    list: { querySelectorAll: () => [button] },
    document: { querySelector: selector => selector==='[data-queue-error]' ? error : null },
    fetch: async () => new Response(JSON.stringify({error:'Not saved. Sign in again.'}), {status:401}),
    load: async () => { throw new Error('failed write must not reload'); },
  });
  runInContext(stripTypeScriptTypes(handler), context);
  await button.callback();
  assert.equal(error.hidden, false);
  assert.equal(error.textContent, 'Not saved. Sign in again.');
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Done');
  assert.match(source, /<section class="task-panel">[\s\S]*?data-queue-error/, 'queue error lives outside the hidden Add form');
  pass('a failed follow-up completion shows a visible queue error and restores Done');
}

// The schedule selects the week in SQL, before the global 200-job page boundary.
{
  const env=freshEnv();await call(jobsApi.onRequestGet,env);
  const insert=env.QUOTES_DB.raw.prepare(`INSERT INTO jobs (id,created_at,updated_at,status,customer_name,scheduled_date) VALUES (?,'2026-10-01','2026-10-01',?,'Schedule test',?)`);
  for(let i=0;i<205;i++)insert.run(`J-ready-${i}`,'ready',null);
  insert.run('J-week-start','completed','2026-09-28');
  insert.run('J-week-end','scheduled','2026-10-04');
  insert.run('J-next-week','scheduled','2026-10-05');
  insert.run('J-cancelled','cancelled','2026-10-03');
  const result=await call(jobsApi.onRequestGet,env,{path:'/internal/api/jobs?from=2026-09-28&to=2026-10-05'});
  assert.equal(result.body.total,2);
  assert.deepEqual(result.body.jobs.map(job=>job.id).sort(),['J-week-end','J-week-start']);
  for(const range of ['from=2026-02-30&to=2026-03-05','from=2026-10-05','from=2026-10-05&to=2026-10-05','from=2026-01-01&to=2026-12-31'])assert.equal((await call(jobsApi.onRequestGet,env,{path:`/internal/api/jobs?${range}`})).status,400);
  pass('weekly schedule finds older jobs before pagination, excludes cancelled/out-of-range work and validates ranges');
}
{
  const env=freshEnv();
  const name="Archive O'Neil %_";
  const id=await approvedQuote(env,{customer:{...customer,name},items:[{label:'Slider',quantity:1,unitPriceCents:10000}]});
  env.QUOTES_DB.raw.prepare("UPDATE quotes SET created_at='2020-01-01T00:00:00Z' WHERE id=?").run(id);
  const insert=env.QUOTES_DB.raw.prepare(`INSERT INTO quotes (id,created_at,updated_at,status,customer_name,total_cents) VALUES (?,'2026-10-01','2026-10-01',?,'Recent customer',10000)`);
  for(let i=0;i<205;i++)insert.run(`Q-recent-${i}`,'draft');
  insert.run('Q-old-final','finalized');
  const search=await call(quotesIndex.onRequestGet,env,{path:`/internal/api/quotes?search=${encodeURIComponent(name)}`});
  assert.equal(search.body.total,1);assert.equal(search.body.quotes[0].id,id);assert.equal(search.body.quotes[0].build_plan_stale,false);
  env.QUOTES_DB.raw.prepare('UPDATE quote_items SET quantity=quantity+1 WHERE quote_id=?').run(id);
  const changed=await call(quotesIndex.onRequestGet,env,{path:`/internal/api/quotes?search=${encodeURIComponent(name)}`});
  assert.equal(changed.body.quotes[0].build_plan_stale,true,'filtered source items still detect quote drift');
  const final=await call(quotesIndex.onRequestGet,env,{path:'/internal/api/quotes?status=finalized'});
  assert.equal(final.body.total,1);assert.equal(final.body.quotes[0].id,'Q-old-final');
  assert.equal((await call(quotesIndex.onRequestGet,env,{path:'/internal/api/quotes?status=invalid'})).status,400);
  pass('quote search and finalized filters find older records and keep correct Build Plan freshness');
}
{
  const {businessCalendarDate,scheduleWeek}=await import(pathToFileURL(`${root}src/lib/schedule-week.ts`).href);
  const beforeMidnight=new Date('2026-10-05T06:30:00Z');
  assert.equal(businessCalendarDate(beforeMidnight).toISOString().slice(0,10),'2026-10-04');
  const expected=['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-03','2026-10-04'];
  assert.deepEqual(scheduleWeek(businessCalendarDate(beforeMidnight)).map(d=>d.toISOString().slice(0,10)),expected);
  for(const instant of ['2026-03-08T18:00:00Z','2026-11-01T18:00:00Z']){
    const days=scheduleWeek(businessCalendarDate(new Date(instant)));
    assert.equal(days[0].getUTCDay(),1);assert.equal(days[6].getUTCDay(),0);
    assert.equal(days[6].getTime()-days[0].getTime(),6*86400000);
  }
  pass('calendar weeks use the Pacific business date and stay contiguous across DST');
}
// Execute the dropdown loader: it requests finalized quotes and keeps every page.
{
  const source=read('src/pages/internal/jobs/index.astro');
  const handler=source.slice(source.indexOf('    async function loadQuotes()'),source.indexOf("    create?.addEventListener"));
  const select={innerHTML:''},urls=[];
  const context=createContext({select,esc:v=>String(v),money:serverMoney,Error,fetch:async url=>{
    urls.push(url);const page=new URL(url,ORIGIN).searchParams.get('page');
    return new Response(JSON.stringify({quotes:page==='1'?[{id:'Q-first',customer_name:'First',total_cents:10000}]:[{id:'Q-last',customer_name:'Last',total_cents:20000}],totalPages:2}));
  }});
  runInContext(stripTypeScriptTypes(handler),context);await context.loadQuotes();
  assert.equal(urls.length,2);assert.ok(urls.every(url=>url.includes('status=finalized')));
  assert.match(select.innerHTML,/Q-first/);assert.match(select.innerHTML,/Q-last/);
  pass('job-creation dropdown keeps finalized quotes from every page');
}

{
  const {scheduleWeek}=await import(pathToFileURL(`${root}src/lib/schedule-week.ts`).href);
  const source=read('src/pages/internal/schedule.astro');
  const start=source.indexOf('    async function load()');
  const handler=source.slice(start,source.indexOf("    document.querySelector('[data-prev]')",start));
  class Element {hidden=false;innerHTML='';textContent='';}
  class Button extends Element {disabled=false;}
  const refresh=new Button(),empty=new Element(),grid=new Element(),status=new Element(),urls=[];
  let renders=0;
  const context=createContext({
    HTMLElement:Element,HTMLButtonElement:Button,AbortController,URLSearchParams,Error,
    grid,empty,status,range:new Element(),pending:null,jobs:[],anchor:new Date('2026-10-03T12:00:00Z'),scheduleWeek,
    dayKey:d=>d.toISOString().slice(0,10),label:d=>d.toISOString().slice(0,10),render:()=>{renders++;},
    document:{querySelector:()=>refresh},fetch:async url=>{
      urls.push(url);const page=new URL(url,ORIGIN).searchParams.get('page');
      return new Response(JSON.stringify({jobs:[{id:page==='1'?'J-first':'J-last'}],totalPages:2}));
    },
  });
  runInContext(stripTypeScriptTypes(handler),context);await context.load();
  assert.equal(urls.length,2);assert.ok(urls.every(url=>url.includes('from=2026-09-28')&&url.includes('to=2026-10-05')));
  assert.equal(context.jobs.length,2);assert.equal(renders,1);assert.equal(refresh.disabled,false);
  context.fetch=async()=>new Response(JSON.stringify({error:'Your session ended.'}),{status:401});
  await context.load();
  assert.equal(status.textContent,'Your session ended.');assert.equal(empty.hidden,true);assert.equal(grid.innerHTML,'');assert.equal(renders,1);assert.equal(refresh.disabled,false);
  pass('schedule loads every weekly result page; failed loads show an error rather than a false empty week');
}
