// What kind of work a quote (and so its invoice and job) is: window work or siding.
//
// Window quotes keep the full path: approved Build Plan -> signature -> invoice -> job snapshot.
// The Build Plan describes window openings, so it does not apply to siding: a siding quote is
// approved by its signature alone (owner decision, 2026-10-04) and its job has no plan snapshot,
// no window field checklist and no opening-by-opening closeout. Everything else (quote items,
// totals, signing links, invoices, payments, schedule, photos, notes) is shared.
//
// Deterministic only. The type is chosen by a person when the quote is created and cannot be
// changed afterwards, so a window quote can never lose its gate by being relabelled.

export const WORK_TYPES = Object.freeze(['windows', 'siding']);

/** Parses the type on a create request. Missing means windows; anything unknown is an error. */
export function parseWorkType(value) {
  if (value === undefined || value === null || value === '') return { workType: 'windows' };
  const text = String(value).trim().toLowerCase();
  return WORK_TYPES.includes(text) ? { workType: text } : { error: 'Choose Windows or Siding as the type of work.' };
}

/** Rows written before the column existed read as windows. */
export const workTypeOf = (row) => (row?.work_type === 'siding' ? 'siding' : 'windows');
export const isSidingRow = (row) => workTypeOf(row) === 'siding';

const migrated = new WeakSet();

// Added lazily like the rest of this app's schema (see lead-links.mjs), so the order in which
// endpoints are hit after a deploy cannot matter.
export async function ensureQuoteWorkTypeColumn(db) {
  if (!db || migrated.has(db)) return;
  try {
    await db.prepare(`ALTER TABLE quotes ADD COLUMN work_type TEXT NOT NULL DEFAULT 'windows'`).run();
  } catch (error) {
    const message = String(error?.message);
    if (/no such table/i.test(message)) return; // nothing recorded as done; the next call tries again
    if (!/duplicate column/i.test(message)) throw error;
  }
  migrated.add(db);
}

export async function isSidingQuoteId(db, quoteId) {
  await ensureQuoteWorkTypeColumn(db);
  const row = await db.prepare('SELECT work_type FROM quotes WHERE id = ?').bind(quoteId).first();
  return isSidingRow(row);
}

export const SIDING_NO_PLAN = Object.freeze({
  error: 'Siding quotes do not use the window Build Plan.',
  code: 'SIDING_NO_BUILD_PLAN',
});
