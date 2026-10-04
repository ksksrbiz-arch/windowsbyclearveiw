// Which service an inbound inquiry is about: 'siding' when it came from the siding page, otherwise
// untagged (window work, the original business). Set by the public estimate form; read by the
// internal lists so siding clients can be told apart from window clients.
//
// The leads table is created by hand from functions/api/_data/schema.sql, so the column is added
// lazily, like the other columns added after the first release. A failure here must never stop
// a lead from being saved: callers fall back to the original column list.

export const LEAD_SERVICES = Object.freeze(['windows', 'siding']);

const ready = new WeakSet();

/** Returns true when leads.service exists (adding it if needed), false when it cannot be used. */
export async function ensureLeadServiceColumn(db) {
  if (!db) return false;
  if (ready.has(db)) return true;
  try {
    await db.prepare('ALTER TABLE leads ADD COLUMN service TEXT').run();
  } catch (error) {
    if (!/duplicate column/i.test(String(error?.message))) return false;
  }
  ready.add(db);
  return true;
}

/**
 * The service to record for a submitted inquiry. The siding page sends service=siding; as a
 * fallback, a request whose notes start with the page's own prefill ("House siding") counts too.
 * Anything else is untagged (null), never guessed.
 */
export function leadServiceFromForm(service, notes) {
  if (String(service ?? '').trim().toLowerCase() === 'siding') return 'siding';
  if (/^\s*house siding\b/i.test(String(notes ?? ''))) return 'siding';
  return null;
}
