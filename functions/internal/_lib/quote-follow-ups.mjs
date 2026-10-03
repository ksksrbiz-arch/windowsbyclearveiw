// Quote follow-up cadence: when a draft quote goes quiet, put a reminder in
// Mark's follow-up queue on day 2, 7 and 14 after it was written.
//
// Deterministic and internal only. It creates follow_up_tasks rows for Mark;
// it never contacts the customer. Pages Functions have no cron here, so the
// cadence is synced whenever the Today / Follow-up queues are read, which is
// exactly when Mark would see the reminder anyway.
//
// Rules:
//   * Only draft quotes get reminders; signing or deleting a quote closes its
//     open reminders automatically.
//   * At most one open reminder per quote. If Mark leaves one open, it simply
//     goes overdue; later steps are not stacked on top of it.
//   * Each step is created at most once per quote (unique index), so marking
//     a reminder done never makes it come back.
//   * Only the latest step that is due is created, so an old draft gets one
//     reminder, not three.

import { formatCents } from './money.mjs';

export const CADENCE_DAYS = [2, 7, 14];
const DAY = 24 * 60 * 60 * 1000;

const migrated = new WeakSet();

export async function ensureFollowUpSchema(db) {
  if (!db || migrated.has(db)) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS follow_up_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    lead_id INTEGER,
    title TEXT NOT NULL,
    due_at TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    notes TEXT,
    created_by TEXT NOT NULL DEFAULT 'mark'
  )`).run();
  for (const sql of [
    `ALTER TABLE follow_up_tasks ADD COLUMN quote_id TEXT`,
    `ALTER TABLE follow_up_tasks ADD COLUMN cadence_step INTEGER`,
  ]) {
    try { await db.prepare(sql).run(); } catch { /* already added */ }
  }
  await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_follow_up_tasks_quote_step
    ON follow_up_tasks(quote_id, cadence_step) WHERE quote_id IS NOT NULL AND cadence_step IS NOT NULL`).run();
  migrated.add(db);
}

const money = formatCents;

/**
 * Pure planner. quotes: draft quotes {id, created_at, customer_name, total_cents, lead_id}.
 * tasks: cadence rows {id, quote_id, cadence_step, status, quote_status} where quote_status
 * is null when the quote no longer exists.
 */
export function planQuoteFollowUps({ quotes = [], tasks = [] } = {}, now = Date.now()) {
  const byQuote = new Map();
  for (const task of tasks) {
    if (!byQuote.has(task.quote_id)) byQuote.set(task.quote_id, []);
    byQuote.get(task.quote_id).push(task);
  }

  const close = tasks
    .filter((t) => t.status === 'open' && t.quote_status !== 'draft')
    .map((t) => t.id);

  const create = [];
  for (const quote of quotes) {
    const created = Date.parse(quote?.created_at);
    if (!Number.isFinite(created)) continue;
    const due = CADENCE_DAYS.filter((days) => created + days * DAY <= now);
    if (!due.length) continue;
    const step = due[due.length - 1];
    const existing = byQuote.get(quote.id) || [];
    if (existing.some((t) => t.status === 'open')) continue;
    if (existing.some((t) => Number(t.cadence_step) >= step)) continue;
    create.push({
      quoteId: quote.id,
      leadId: Number.isInteger(quote.lead_id) ? quote.lead_id : null,
      step,
      dueAt: new Date(created + step * DAY).toISOString(),
      title: `Follow up on quote ${quote.id} (day ${step})`,
      notes: `Automatic reminder: ${quote.customer_name || 'customer'}, ${money(quote.total_cents)}, still unsigned ${step} days after it was written. Nothing was sent to the customer.`,
    });
  }
  return { create, close };
}

export async function syncQuoteFollowUps(db, now = Date.now()) {
  await ensureFollowUpSchema(db);
  const [{ results: quotes }, { results: tasks }] = await Promise.all([
    db.prepare(`SELECT id, created_at, customer_name, total_cents, lead_id FROM quotes WHERE status = 'draft'`).all(),
    db.prepare(
      `SELECT t.id, t.quote_id, t.cadence_step, t.status, q.status AS quote_status
       FROM follow_up_tasks t LEFT JOIN quotes q ON q.id = t.quote_id
       WHERE t.quote_id IS NOT NULL AND t.cadence_step IS NOT NULL`,
    ).all(),
  ]);
  const plan = planQuoteFollowUps({ quotes: quotes || [], tasks: tasks || [] }, now);
  const stamp = new Date(now).toISOString();
  const writes = [
    ...plan.create.map((t) => db.prepare(
      `INSERT OR IGNORE INTO follow_up_tasks (created_at, updated_at, lead_id, title, due_at, notes, created_by, quote_id, cadence_step)
       VALUES (?, ?, ?, ?, ?, ?, 'system', ?, ?)`,
    ).bind(stamp, stamp, t.leadId, t.title, t.dueAt, t.notes, t.quoteId, t.step)),
    ...plan.close.map((id) => db.prepare(
      `UPDATE follow_up_tasks SET status = 'done', updated_at = ? WHERE id = ? AND status = 'open'`,
    ).bind(stamp, id)),
  ];
  if (writes.length) await db.batch(writes);
  return { created: plan.create.length, closed: plan.close.length };
}
