import { BUILD_PLAN_STATES, transitionPlanState, assertJobEligible } from '../../_lib/build-plan-state.mjs';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}

function clean(value, max = 100) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function ensureSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS quote_build_plans (quote_id TEXT PRIMARY KEY REFERENCES quotes(id) ON DELETE CASCADE, version INTEGER NOT NULL DEFAULT 1, plan_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT 'mark')`).run();
  for (const sql of [
    `ALTER TABLE quote_build_plans ADD COLUMN state TEXT NOT NULL DEFAULT 'draft'`,
    `ALTER TABLE quote_build_plans ADD COLUMN state_history_json TEXT`,
    `ALTER TABLE quote_build_plans ADD COLUMN approved_at TEXT`,
    `ALTER TABLE quote_build_plans ADD COLUMN approved_by TEXT`,
  ]) { try { await db.prepare(sql).run(); } catch {} }
}

async function loadPlan(db, quoteId) {
  const row = await db.prepare('SELECT * FROM quote_build_plans WHERE quote_id = ?').bind(quoteId).first();
  if (!row) return null;
  let plan;
  try { plan = JSON.parse(row.plan_json); } catch { plan = {}; }
  plan.status = row.state || plan.status || BUILD_PLAN_STATES.DRAFT;
  try { plan.stateHistory = row.state_history_json ? JSON.parse(row.state_history_json) : (plan.stateHistory || []); } catch { plan.stateHistory = plan.stateHistory || []; }
  plan.approvedAt = row.approved_at || plan.approvedAt || null;
  plan.approvedBy = row.approved_by || plan.approvedBy || null;
  plan.version = Number(row.version || plan.version || 1);
  return { row, plan };
}

export async function onRequestGet({ env, request }) {
  await ensureSchema(env.QUOTES_DB);
  const quoteId = clean(new URL(request.url).searchParams.get('quoteId'));
  if (!quoteId) return json({ error: 'Quote id is required.' }, 400);
  const loaded = await loadPlan(env.QUOTES_DB, quoteId);
  if (!loaded) return json({ error: 'Build Plan not found.' }, 404);
  return json({ quoteId, status: loaded.plan.status, version: loaded.plan.version, approvedAt: loaded.plan.approvedAt, approvedBy: loaded.plan.approvedBy, stateHistory: loaded.plan.stateHistory });
}

export async function onRequestPost({ env, request }) {
  await ensureSchema(env.QUOTES_DB);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Body must be JSON.' }, 400); }
  const quoteId = clean(body.quoteId);
  const action = clean(body.action);
  const actor = clean(body.actor || 'mark', 120) || 'mark';
  if (!quoteId || !action) return json({ error: 'quoteId and action are required.' }, 400);
  const loaded = await loadPlan(env.QUOTES_DB, quoteId);
  if (!loaded) return json({ error: 'Build Plan not found.' }, 404);

  const targets = {
    'submit-review': BUILD_PLAN_STATES.REVIEW,
    approve: BUILD_PLAN_STATES.APPROVED,
    reopen: BUILD_PLAN_STATES.REOPENED,
    'return-to-draft': BUILD_PLAN_STATES.DRAFT,
  };
  const target = targets[action];
  if (!target) return json({ error: 'Unknown Build Plan action.' }, 400);

  const quote = await env.QUOTES_DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(quoteId).first();
  if (!quote) return json({ error: 'Quote not found.' }, 404);
  if (action === 'approve' && quote.status !== 'draft') return json({ error: 'Only a draft quote can receive a new Build Plan approval.' }, 409);

  let next;
  try { next = transitionPlanState(loaded.plan, target, actor); }
  catch (error) { return json({ error: error.message }, 409); }

  const now = new Date().toISOString();
  await env.QUOTES_DB.prepare(`UPDATE quote_build_plans SET state = ?, state_history_json = ?, approved_at = ?, approved_by = ?, updated_at = ?, updated_by = ? WHERE quote_id = ?`)
    .bind(next.status, JSON.stringify(next.stateHistory), next.approvedAt, next.approvedBy, now, actor, quoteId).run();
  return json({ ok: true, quoteId, status: next.status, version: loaded.plan.version, approvedAt: next.approvedAt, approvedBy: next.approvedBy, stateHistory: next.stateHistory });
}

export async function onRequestPut({ env, request }) {
  return onRequestPost({ env, request });
}

export { assertJobEligible };
