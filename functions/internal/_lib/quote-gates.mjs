// Signing gate shared by every path that finalizes a quote: Mark's device
// (functions/internal/api/quotes/[id].js) and the customer's signing link
// (functions/api/quote-sign.js). A quote can only be signed against an
// explicitly approved Build Plan that still matches the quote's items.

import { sourceSnapshot } from '../../_lib/build-plan-rules.mjs';
import { isSidingQuoteId } from './work-types.mjs';

function sameSource(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

export async function requireApprovedBuildPlan(db, quoteId) {
  // The Build Plan describes window openings and does not apply to siding. A siding quote is
  // approved by its signature alone (owner decision, 2026-10-04); window quotes are unchanged.
  if (await isSidingQuoteId(db, quoteId)) return null;
  await db.prepare(`CREATE TABLE IF NOT EXISTS quote_build_plans (quote_id TEXT PRIMARY KEY REFERENCES quotes(id) ON DELETE CASCADE, version INTEGER NOT NULL DEFAULT 1, plan_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT 'mark')`).run();
  for (const sql of [
    `ALTER TABLE quote_build_plans ADD COLUMN state TEXT NOT NULL DEFAULT 'draft'`,
    `ALTER TABLE quote_build_plans ADD COLUMN approved_at TEXT`,
    `ALTER TABLE quote_build_plans ADD COLUMN source_json TEXT`,
  ]) { try { await db.prepare(sql).run(); } catch {} }
  const plan = await db.prepare('SELECT plan_json, state, approved_at, source_json FROM quote_build_plans WHERE quote_id = ?').bind(quoteId).first();
  if (!plan?.plan_json) return { error: 'Approve the Build Plan before finalizing this quote.', code: 'BUILD_PLAN_REQUIRED' };
  if (plan.state !== 'approved' || !plan.approved_at) return { error: 'The Build Plan must be explicitly approved before finalizing this quote.', code: 'BUILD_PLAN_NOT_APPROVED' };
  const { results: items } = await db.prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order ASC, id ASC').bind(quoteId).all();
  let savedSource = [];
  try { savedSource = plan.source_json ? JSON.parse(plan.source_json) : []; } catch { savedSource = []; }
  if (!sameSource(savedSource, sourceSnapshot(items || []))) return { error: 'This quote changed after the Build Plan was approved. Reconcile and re-approve the Build Plan before finalizing.', code: 'BUILD_PLAN_STALE' };
  return null;
}

