import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createD1 } from './_lib/d1-sqlite.mjs';
import { planQuoteFollowUps, syncQuoteFollowUps, ensureFollowUpSchema, CADENCE_DAYS } from '../functions/internal/_lib/quote-follow-ups.mjs';
import * as tasksApi from '../functions/internal/api/tasks.js';
import * as dashboard from '../functions/internal/api/dashboard.js';

const pass = (message) => console.log(`PASS: ${message}`);
const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 29, 18, 0, 0);
const ago = (days) => new Date(NOW - days * DAY).toISOString();

{
  assert.deepEqual(CADENCE_DAYS, [2, 7, 14]);
  const plan = planQuoteFollowUps({
    quotes: [
      { id: 'Q-NEW', created_at: ago(1), customer_name: 'A', total_cents: 100000 },
      { id: 'Q-D3', created_at: ago(3), customer_name: 'B', total_cents: 250000, lead_id: 7 },
      { id: 'Q-D10', created_at: ago(10), customer_name: 'C', total_cents: 0 },
      { id: 'Q-OLD', created_at: ago(90), customer_name: 'D', total_cents: 0 },
      { id: 'Q-BAD', created_at: 'nope' },
    ],
    tasks: [],
  }, NOW);
  assert.deepEqual(plan.create.map((t) => [t.quoteId, t.step]), [['Q-D3', 2], ['Q-D10', 7], ['Q-OLD', 14]], 'only the latest due step, nothing before day 2');
  const d3 = plan.create[0];
  assert.equal(d3.leadId, 7);
  assert.equal(d3.dueAt, new Date(Date.parse(ago(3)) + 2 * DAY).toISOString());
  assert.match(d3.notes, /\$2,500/);
  assert.match(d3.notes, /Nothing was sent to the customer/);
  assert.deepEqual(plan.close, []);
  pass('the planner creates one reminder at the latest due step (2/7/14 days) per draft');
}

{
  const quotes = [{ id: 'Q-1', created_at: ago(8), total_cents: 1 }];
  const openStep2 = planQuoteFollowUps({ quotes, tasks: [{ id: 1, quote_id: 'Q-1', cadence_step: 2, status: 'open', quote_status: 'draft' }] }, NOW);
  assert.deepEqual(openStep2.create, [], 'an open reminder is not stacked on');
  const doneStep2 = planQuoteFollowUps({ quotes, tasks: [{ id: 1, quote_id: 'Q-1', cadence_step: 2, status: 'done', quote_status: 'draft' }] }, NOW);
  assert.deepEqual(doneStep2.create.map((t) => t.step), [7], 'after the day-2 reminder is done, day 7 follows');
  const doneStep7 = planQuoteFollowUps({ quotes, tasks: [{ id: 2, quote_id: 'Q-1', cadence_step: 7, status: 'done', quote_status: 'draft' }] }, NOW);
  assert.deepEqual(doneStep7.create, [], 'a completed step never comes back');
  const closing = planQuoteFollowUps({
    quotes: [],
    tasks: [
      { id: 5, quote_id: 'Q-S', cadence_step: 2, status: 'open', quote_status: 'finalized' },
      { id: 6, quote_id: 'Q-X', cadence_step: 7, status: 'open', quote_status: null },
      { id: 7, quote_id: 'Q-S', cadence_step: 7, status: 'done', quote_status: 'finalized' },
    ],
  }, NOW);
  assert.deepEqual(closing.close, [5, 6], 'signed or deleted quotes close their open reminders');
  pass('reminders never stack, never repeat, and close when the quote is signed or deleted');
}

const freshEnv = () => ({ QUOTES_DB: createD1({ schemaFiles: ['functions/api/_data/schema.sql', 'internal/db/schema.sql'] }) });
const addQuote = (env, id, createdAt, status = 'draft', extra = {}) => env.QUOTES_DB.raw.prepare(
  `INSERT INTO quotes (id, created_at, updated_at, status, customer_name, customer_phone, total_cents) VALUES (?, ?, ?, ?, ?, ?, ?)`,
).run(id, createdAt, createdAt, status, extra.name || 'Pat Doe', extra.phone || '5035550100', extra.total || 180000);

{
  const db = createD1();
  db.raw.exec(`CREATE TABLE follow_up_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, lead_id INTEGER, title TEXT NOT NULL, due_at TEXT, status TEXT NOT NULL DEFAULT 'open', notes TEXT, created_by TEXT NOT NULL DEFAULT 'mark')`);
  db.raw.exec(`INSERT INTO follow_up_tasks (created_at, updated_at, title) VALUES ('x', 'x', 'Call Pat')`);
  await ensureFollowUpSchema(db);
  await ensureFollowUpSchema(db);
  const cols = db.raw.prepare(`PRAGMA table_info(follow_up_tasks)`).all().map((c) => c.name);
  assert.ok(cols.includes('quote_id') && cols.includes('cadence_step'));
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM follow_up_tasks`).get().n, 1, 'manual tasks are untouched');
  pass('the lazy migration adds the cadence columns to an existing production table idempotently');
}

{
  const env = freshEnv();
  addQuote(env, 'Q-A', ago(3));
  addQuote(env, 'Q-B', ago(1));
  addQuote(env, 'Q-C', ago(20), 'finalized');
  const db = env.QUOTES_DB;
  assert.deepEqual(await syncQuoteFollowUps(db, NOW), { created: 1, closed: 0 });
  assert.deepEqual(await syncQuoteFollowUps(db, NOW), { created: 0, closed: 0 }, 'syncing again is a no-op');
  const row = db.raw.prepare(`SELECT * FROM follow_up_tasks WHERE quote_id = 'Q-A'`).get();
  assert.equal(row.cadence_step, 2);
  assert.equal(row.status, 'open');
  assert.equal(row.created_by, 'system');

  db.raw.prepare(`UPDATE follow_up_tasks SET status = 'done' WHERE id = ?`).run(row.id);
  assert.deepEqual(await syncQuoteFollowUps(db, NOW + 5 * DAY), { created: 2, closed: 0 }, 'Q-A reaches day 7 and Q-B reaches day 2 (it was written 1 day ago)');
  const steps = db.raw.prepare(`SELECT quote_id, cadence_step FROM follow_up_tasks WHERE quote_id IS NOT NULL ORDER BY quote_id, cadence_step`).all().map((r) => `${r.quote_id}:${r.cadence_step}`);
  assert.deepEqual(steps, ['Q-A:2', 'Q-A:7', 'Q-B:2']);

  db.raw.prepare(`UPDATE quotes SET status = 'finalized' WHERE id = 'Q-A'`).run();
  db.raw.prepare(`DELETE FROM quotes WHERE id = 'Q-B'`).run();
  assert.deepEqual(await syncQuoteFollowUps(db, NOW + 6 * DAY), { created: 0, closed: 2 });
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM follow_up_tasks WHERE status = 'open'`).get().n, 0);
  assert.throws(() => db.raw.prepare(`INSERT INTO follow_up_tasks (created_at, updated_at, title, quote_id, cadence_step) VALUES ('x','x','dup','Q-A',2)`).run(), /UNIQUE/, 'the database itself refuses a duplicate step');
  pass('sync on real SQL creates, advances, and closes reminders exactly once');
}

{
  const env = freshEnv();
  addQuote(env, 'Q-T', new Date(Date.now() - 3 * DAY).toISOString(), 'draft', { name: 'Lee Roe', phone: '(503) 555-0111' });
  const call = async (handler) => {
    const r = await handler({ request: new Request('https://x.test/internal/api/tasks'), env, params: {}, waitUntil() {} });
    return { status: r.status, body: await r.json() };
  };
  const tasks = await call(tasksApi.onRequestGet);
  assert.equal(tasks.status, 200);
  const reminder = tasks.body.tasks.find((t) => t.quote_id === 'Q-T');
  assert.ok(reminder, 'reading the Follow-up queue creates the due reminder');
  assert.equal(reminder.lead_name, 'Lee Roe', 'an unlinked quote reminder still shows the customer');
  assert.equal(reminder.lead_phone, '(503) 555-0111');

  env.QUOTES_DB.raw.exec(`CREATE TABLE jobs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, quote_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'ready', scheduled_date TEXT, scheduled_window TEXT, customer_name TEXT NOT NULL, customer_city TEXT, completed_at TEXT)`);
  const snap = await call(dashboard.onRequestGet);
  assert.equal(snap.status, 200);
  const listed = JSON.stringify(snap.body);
  assert.ok(/Q-T/.test(listed), 'the Today/dashboard queue shows the reminder');

  const original = env.QUOTES_DB.prepare;
  env.QUOTES_DB.prepare = (sql) => (/FROM quotes WHERE status = 'draft'/.test(sql)
    ? { bind() { return this; }, all: async () => { throw new Error('boom'); } }
    : original(sql));
  const quiet = console.error;
  console.error = () => {};
  const stillWorks = await call(tasksApi.onRequestGet);
  console.error = quiet;
  env.QUOTES_DB.prepare = original;
  assert.equal(stillWorks.status, 200, 'a failed sync never hides the queue');
  assert.ok(stillWorks.body.tasks.length >= 1);
  pass('the Follow-up and Today queues sync reminders on read, show the customer, and fail soft');
}

{
  const today = fs.readFileSync('src/pages/internal/today.astro', 'utf8');
  const followUp = fs.readFileSync('src/pages/internal/follow-up.astro', 'utf8');
  assert.ok(/encodeURIComponent\(t\.quote_id\)/.test(today) && /encodeURIComponent\(t\.quote_id\)/.test(followUp), 'reminders link to the quote');
  const lib = fs.readFileSync('functions/internal/_lib/quote-follow-ups.mjs', 'utf8');
  assert.ok(!/fetch\(|resend|sendEmail|ntfy/i.test(lib), 'the cadence never contacts anyone');
  pass('reminders link to their quote and the cadence has no outbound channel');
}

console.log('Quote follow-up checks passed.');
