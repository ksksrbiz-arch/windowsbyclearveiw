// General (non-window) jobs: Mark adds the customer and the job directly, no quote and no
// Build Plan. Real SQLite through the same handlers the app uses; no network.
import assert from 'node:assert/strict';
import { createD1 } from './_lib/d1-sqlite.mjs';
import {
  dollarsToCents,
  ensureGeneralJobColumns,
  validateGeneralJobUpdate,
  validateNewGeneralJob,
} from '../functions/internal/_lib/general-jobs.mjs';
import { summarizePipeline } from '../functions/internal/_lib/pipeline-summary.mjs';
import * as jobsApi from '../functions/internal/api/jobs.js';
import * as paymentsApi from '../functions/internal/api/payments.js';
import * as tasksApi from '../functions/internal/api/tasks.js';
import * as dashboardApi from '../functions/internal/api/dashboard.js';
import * as analyticsApi from '../functions/internal/api/analytics.js';

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
const newJob = (env, extra = {}) =>
  call(jobsApi.onRequestPost, env, {
    method: 'POST',
    path: '/internal/api/jobs',
    body: { workType: 'general', customerName: 'Pat Rivera', customerPhone: '(360) 555-0123', workDescription: 'Deck rebuild', agreedAmount: '4,800', ...extra },
  });

// ── Pure validation ────────────────────────────────────────────────────────
{
  assert.equal(dollarsToCents('4,800'), 480000);
  assert.equal(dollarsToCents('$4800.50'), 480050);
  assert.equal(dollarsToCents(1200), 120000);
  assert.equal(dollarsToCents('12.345'), null, 'sub-cent precision is refused, not rounded');
  for (const bad of ['', '0', '-5', 'abc', '1e3', '12,34,56.', null, undefined, NaN, Infinity, {}]) assert.equal(dollarsToCents(bad), null, `refuses ${String(bad)}`);

  const ok = validateNewGeneralJob({ customerName: '  Pat   Rivera ', workDescription: ' Deck  rebuild', agreedAmount: '4800', scheduledDate: '2026-10-12' });
  assert.equal(ok.value.customer_name, 'Pat Rivera', 'whitespace is collapsed');
  assert.equal(ok.value.work_description, 'Deck rebuild');
  assert.equal(ok.value.agreed_cents, 480000);
  assert.equal(ok.value.status, 'scheduled', 'a date on the calendar means scheduled');
  assert.equal(validateNewGeneralJob({ customerName: 'A', workDescription: 'B', agreedAmount: 10 }).value.status, 'ready');

  const empty = validateNewGeneralJob({});
  assert.ok(empty.errors.length >= 3 && empty.errors.some((e) => /name/i.test(e)) && empty.errors.some((e) => /type of work/i.test(e)) && empty.errors.some((e) => /agreed amount/i.test(e)));
  assert.ok(validateNewGeneralJob(null).errors.length >= 3, 'a non-object body is handled');
  const base = { customerName: 'A', workDescription: 'B', agreedAmount: 10 };
  assert.ok(validateNewGeneralJob({ ...base, customerEmail: 'nope' }).errors[0].includes('email'));
  assert.ok(validateNewGeneralJob({ ...base, scheduledDate: '2026-02-31' }).errors[0].includes('date'), 'an impossible date is refused');
  assert.ok(validateNewGeneralJob({ ...base, contractDate: 'tomorrow' }).errors[0].includes('date'));
  assert.ok(validateNewGeneralJob({ ...base, agreedAmount: '99999999999' }).errors[0].includes('too large'));
  assert.equal(validateNewGeneralJob({ ...base, customerName: 'x'.repeat(500) }).value.customer_name.length, 120, 'fields are capped');

  assert.deepEqual(validateGeneralJobUpdate({}).value, {}, 'an empty edit changes nothing');
  assert.equal(validateGeneralJobUpdate({ workDescription: '   ' }).errors[0], 'Type of work cannot be blank.');
  assert.equal(validateGeneralJobUpdate({ customerName: '' }).errors[0], 'Customer name is required.');
  assert.deepEqual(validateGeneralJobUpdate({ customerPhone: '' }).value, { customer_phone: null }, 'a cleared field becomes null');
  pass('validation: amounts, dates, emails, caps, blank guards');
}

// ── Create, list, read ─────────────────────────────────────────────────────
const env = freshEnv();
let jobId;
{
  const missing = await call(jobsApi.onRequestPost, env, { method: 'POST', body: { workType: 'general', customerName: 'Pat' } });
  assert.equal(missing.status, 400);
  assert.ok(missing.body.errors.length >= 2, 'all problems are reported at once');

  const created = await newJob(env, { customerCity: 'Canby', scheduledDate: '2026-10-12', scheduledWindow: '8-10 AM', contractDate: '2026-09-28', notes: 'Gate code 1234' });
  assert.equal(created.status, 201);
  jobId = created.body.id;
  assert.match(jobId, /^J-\d{8}-[A-Z0-9]{4}$/);
  const row = env.QUOTES_DB.raw.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  assert.equal(row.work_type, 'general');
  assert.equal(row.quote_id, null, 'no quote');
  assert.equal(row.build_plan_json, null, 'no Build Plan');
  assert.equal(row.status, 'scheduled');
  assert.equal(row.agreed_cents, 480000);
  assert.equal(row.contract_date, '2026-09-28');
  assert.equal(row.customer_city, 'Canby');

  const again = await newJob(env, { customerCity: 'Canby' });
  assert.equal(again.status, 200);
  assert.equal(again.body.id, jobId, 'a double tap returns the same job');
  assert.equal(env.QUOTES_DB.raw.prepare('SELECT COUNT(*) AS n FROM jobs').get().n, 1);

  const other = await newJob(env, { customerName: 'Dana Lee', workDescription: 'Fence', agreedAmount: '2000' });
  assert.equal(other.status, 201);
  assert.equal(env.QUOTES_DB.raw.prepare('SELECT COUNT(*) AS n FROM jobs').get().n, 2);

  const list = await call(jobsApi.onRequestGet, env, { path: '/internal/api/jobs' });
  const listed = list.body.jobs.find((j) => j.id === jobId);
  assert.equal(listed.total_cents, 480000, 'the list shows the agreed amount as the total');
  assert.equal(listed.work_description, 'Deck rebuild');

  const one = await call(jobsApi.onRequestGet, env, { path: `/internal/api/jobs?id=${jobId}` });
  assert.equal(one.body.job.work_type, 'general');
  assert.equal(one.body.quote, null);
  assert.deepEqual(one.body.items, []);
  assert.equal(one.body.buildPlan, null);

  // The window path is exactly as before: it still demands a quote.
  const windows = await call(jobsApi.onRequestPost, env, { method: 'POST', body: { customerName: 'Pat' } });
  assert.equal(windows.status, 400);
  assert.equal(windows.body.error, 'A finalized quote is required.');
  pass('create: validated, no quote/plan, double tap is one job, list/read show the agreed amount, window path untouched');
}

// ── Edit, status, completion ───────────────────────────────────────────────
{
  const patch = (body, id = jobId) => call(jobsApi.onRequestPatch, env, { method: 'PATCH', path: `/internal/api/jobs?id=${id}`, body });
  const edited = await patch({ workDescription: 'Deck rebuild and stairs', agreedAmount: '5,200', customerPhone: '(360) 555-0199' });
  assert.equal(edited.status, 200);
  let row = env.QUOTES_DB.raw.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  assert.equal(row.work_description, 'Deck rebuild and stairs');
  assert.equal(row.agreed_cents, 520000);
  assert.equal(row.customer_phone, '(360) 555-0199');

  assert.equal((await patch({ customerEmail: 'bad' })).status, 400, 'an invalid edit changes nothing');
  assert.equal(env.QUOTES_DB.raw.prepare('SELECT customer_email FROM jobs WHERE id = ?').get(jobId).customer_email, null);

  const reconcile = await patch({ action: 'reconcileBuildPlan' });
  assert.equal(reconcile.status, 409);
  assert.equal(reconcile.body.code, 'GENERAL_JOB');

  const done = await patch({ status: 'completed', closeoutNotes: 'Final walkthrough done' });
  assert.equal(done.status, 200, 'a general job closes without a window checklist');
  row = env.QUOTES_DB.raw.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  assert.equal(row.status, 'completed');
  assert.ok(row.completed_at);
  assert.equal(row.closeout_notes, 'Final walkthrough done');

  // A window job is still held to the checklist and closeout.
  const now = new Date().toISOString();
  env.QUOTES_DB.raw.prepare(`INSERT INTO jobs (id,created_at,updated_at,quote_id,status,customer_name) VALUES ('J-WIN','${now}','${now}','Q-1','ready','Window Customer')`).run();
  const win = await patch({ status: 'completed' }, 'J-WIN');
  assert.equal(win.status, 409);
  assert.equal(win.body.code, 'CLOSEOUT_CHECKLIST_INCOMPLETE');
  assert.equal(env.QUOTES_DB.raw.prepare(`SELECT work_type FROM jobs WHERE id = 'J-WIN'`).get().work_type, 'windows', 'existing rows default to windows');
  const ignored = await patch({ workDescription: 'Sneaky', agreedAmount: '1' }, 'J-WIN');
  assert.equal(ignored.status, 200);
  assert.equal(env.QUOTES_DB.raw.prepare(`SELECT work_description, agreed_cents FROM jobs WHERE id = 'J-WIN'`).get().agreed_cents, null, 'window jobs cannot take general edits');
  pass('edit: validated, reconcile refused, general completes without a checklist, window jobs still gated and unaffected');
}

// ── Payments ───────────────────────────────────────────────────────────────
{
  const id = env.QUOTES_DB.raw.prepare(`SELECT id FROM jobs WHERE customer_name = 'Dana Lee'`).get().id;
  const get = await call(paymentsApi.onRequestGet, env, { path: `/internal/api/payments?jobId=${id}` });
  assert.equal(get.body.payment.total_cents, 200000, 'total comes from the agreed amount');
  assert.equal(get.body.payment.status, 'unpaid');

  const pay = (amountPaidCents) => call(paymentsApi.onRequestPatch, env, { method: 'PATCH', path: `/internal/api/payments?jobId=${id}`, body: { amountPaidCents, paymentMethod: 'check' } });
  const half = await pay(100000);
  assert.equal(half.status, 200);
  assert.equal(half.body.payment.status, 'partial');
  assert.equal(half.body.payment.balance_cents, 100000);
  assert.equal((await pay(200001)).status, 400, 'cannot record more than was agreed');
  assert.equal((await pay(200000)).body.payment.status, 'paid');

  const list = await call(paymentsApi.onRequestGet, env, { path: '/internal/api/payments' });
  const row = list.body.jobs.find((j) => j.id === id);
  assert.equal(row.total_cents, 200000);
  assert.equal(row.payment_status, 'paid');

  // The agreed amount cannot be edited below what was already paid.
  const low = await call(jobsApi.onRequestPatch, env, { method: 'PATCH', path: `/internal/api/jobs?id=${id}`, body: { agreedAmount: '1500' } });
  assert.equal(low.status, 409);
  assert.equal(low.body.code, 'AGREED_BELOW_PAID');
  const raise = await call(jobsApi.onRequestPatch, env, { method: 'PATCH', path: `/internal/api/jobs?id=${id}`, body: { agreedAmount: '2500' } });
  assert.equal(raise.status, 200);
  assert.equal((await call(paymentsApi.onRequestGet, env, { path: `/internal/api/payments?jobId=${id}` })).body.payment.status, 'partial', 'raising the price reopens the balance');
  // Non-numeric amounts must not coerce to 0/1 and silently rewrite the payment record.
  const before = (await call(paymentsApi.onRequestGet, env, { path: `/internal/api/payments?jobId=${id}` })).body.payment.amount_paid_cents;
  for (const bad of ['', '  ', null, true, [], {}]) assert.equal((await pay(bad)).status, 400, `amountPaidCents ${JSON.stringify(bad)} is refused`);
  assert.equal((await call(paymentsApi.onRequestGet, env, { path: `/internal/api/payments?jobId=${id}` })).body.payment.amount_paid_cents, before, 'refused amounts leave the record untouched');
  // A schedule date must be a real date, not free text.
  const badDate = await call(jobsApi.onRequestPatch, env, { method: 'PATCH', path: `/internal/api/jobs?id=${id}`, body: { scheduledDate: 'tomorrow' } });
  assert.equal(badDate.status, 400);
  assert.equal((await call(jobsApi.onRequestPatch, env, { method: 'PATCH', path: `/internal/api/jobs?id=${id}`, body: { scheduledDate: '2026-02-31' } })).status, 400);
  assert.equal((await call(jobsApi.onRequestPatch, env, { method: 'PATCH', path: `/internal/api/jobs?id=${id}`, body: { scheduledDate: '2026-11-03' } })).status, 200);
  // A task with no lead stores NULL, not lead 0.
  const task = await call(tasksApi.onRequestPost, env, { method: 'POST', path: '/internal/api/tasks', body: { title: 'Call back', leadId: null } });
  assert.equal(task.status, 201);
  assert.equal(env.QUOTES_DB.raw.prepare('SELECT lead_id FROM follow_up_tasks WHERE id = ?').get(task.body.id).lead_id, null);
  pass('payments: total is the agreed amount, overpayment refused, agreed amount cannot drop below paid');
}

// ── Dashboard and analytics ────────────────────────────────────────────────
{
  const dash = await call(dashboardApi.onRequestGet, env, { path: '/internal/api/dashboard' });
  assert.equal(dash.status, 200);
  assert.equal(dash.body.counts.active_job_value_cents, 250000, 'active value counts general jobs that are not completed (Dana Lee only)');
  const recent = dash.body.recentJobs.find((j) => j.customer_name === 'Dana Lee');
  assert.equal(recent.total_cents, 250000);

  const now = new Date().toISOString();
  const summary = summarizePipeline({
    jobs: [
      { created_at: now, completed_at: now, status: 'completed', quote_id: 'Q-1', paid_cents: 100000 },
      { created_at: now, completed_at: now, status: 'completed', quote_id: null, paid_cents: 50000 },
      { created_at: now, completed_at: null, status: 'ready', quote_id: null, paid_cents: 0 },
      { created_at: now, completed_at: null, status: 'cancelled', quote_id: null, paid_cents: 0 },
      { created_at: now, completed_at: null, status: 'ready', paid_cents: 7000 },
    ],
  });
  assert.equal(summary.jobs.created, 2, 'only quote-linked jobs count in the funnel (legacy rows without quote_id count as before)');
  assert.equal(summary.jobs.completed, 1);
  assert.equal(summary.jobs.collectedCents, 157000, 'all collected money counts');
  assert.deepEqual(summary.jobs.otherWork, { created: 2, collectedCents: 50000 });

  const analytics = await call(analyticsApi.onRequestGet, env, { path: '/internal/api/analytics' });
  assert.equal(analytics.status, 200);
  assert.ok(analytics.body.pipeline.jobs.otherWork.created >= 2, 'the endpoint reports other work');
  pass('dashboard value and analytics: general jobs counted as money, kept out of the quote funnel');
}

// ── Deploy order: an older jobs table without the new columns ──────────────
{
  const old = freshEnv();
  old.QUOTES_DB.raw.exec(`CREATE TABLE jobs (id TEXT PRIMARY KEY,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,quote_id TEXT UNIQUE,status TEXT NOT NULL DEFAULT 'ready',scheduled_date TEXT,scheduled_window TEXT,customer_name TEXT NOT NULL,customer_phone TEXT,customer_email TEXT,customer_address TEXT,customer_city TEXT,notes TEXT,install_notes TEXT,closeout_notes TEXT,completed_at TEXT,created_by TEXT NOT NULL DEFAULT 'mark')`);
  const now = new Date().toISOString();
  old.QUOTES_DB.raw.exec(`INSERT INTO jobs (id,created_at,updated_at,quote_id,customer_name) VALUES ('J-OLD','${now}','${now}','Q-9','Old Customer')`);
  // Opening Payments or the dashboard first must work, in either order.
  assert.equal((await call(paymentsApi.onRequestGet, old, { path: '/internal/api/payments' })).status, 200);
  assert.equal((await call(dashboardApi.onRequestGet, old, { path: '/internal/api/dashboard' })).status, 200);
  const cols = old.QUOTES_DB.raw.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name);
  for (const c of ['work_type', 'work_description', 'agreed_cents', 'contract_date']) assert.ok(cols.includes(c), `adds ${c}`);
  assert.equal(old.QUOTES_DB.raw.prepare(`SELECT work_type FROM jobs WHERE id = 'J-OLD'`).get().work_type, 'windows');

  // No jobs table yet: nothing breaks and nothing is recorded as done.
  const none = freshEnv();
  await ensureGeneralJobColumns(none.QUOTES_DB);
  assert.equal((await newJob(none)).status, 201, 'the jobs API creates the table and the columns');
  pass('deploy order: old jobs table gains the columns from any entry point; missing table handled');
}

// ── Day one: a brand-new database has no jobs table until something creates it ──
{
  const fresh = freshEnv();
  assert.equal(fresh.QUOTES_DB.raw.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'jobs'`).get().n, 0, 'precondition: no jobs table');
  // Whichever page Mark opens first must work, not just the jobs page.
  const dash = await call(dashboardApi.onRequestGet, fresh, { path: '/internal/api/dashboard' });
  assert.equal(dash.status, 200, 'the dashboard loads on a brand-new database');
  assert.deepEqual([dash.body.recentJobs, dash.body.recentLeads, dash.body.recentQuotes, dash.body.tasks], [[], [], [], []]);
  assert.equal(Number(dash.body.counts.active_jobs), 0);
  const other = freshEnv();
  assert.equal((await call(paymentsApi.onRequestGet, other, { path: '/internal/api/payments' })).status, 200, 'Payments loads on a brand-new database');
  const third = freshEnv();
  assert.equal((await call(jobsApi.onRequestGet, third, { path: '/internal/api/jobs' })).status, 200, 'the jobs list loads on a brand-new database');
  pass('day one: dashboard, Payments and Jobs all load on a brand-new database in any order');
}

console.log('General jobs checks passed.');
