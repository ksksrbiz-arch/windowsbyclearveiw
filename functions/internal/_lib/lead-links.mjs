// Links a quote to the website inquiry (leads row) it came from.
//
// quotes.lead_id is attribution metadata only: it never changes a quote's
// customer fields, items, totals or signature, so it may be set or cleared on
// a finalized quote. Linking is always an explicit human action (the "Start
// quote" button, or confirming a suggestion on the quote page). Suggestions
// are exact phone/email matches and are never applied automatically.

const migrated = new WeakSet();

export async function ensureQuoteLeadColumn(db) {
  if (!db || migrated.has(db)) return;
  for (const sql of [
    `ALTER TABLE quotes ADD COLUMN lead_id INTEGER`,
    `ALTER TABLE quotes ADD COLUMN lead_linked_at TEXT`,
  ]) {
    try { await db.prepare(sql).run(); } catch { /* column already exists */ }
  }
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_quotes_lead_id ON quotes(lead_id)`).run();
  migrated.add(db);
}

/** Returns { leadId: number|null } or { error }. Empty means "no lead". */
export function parseLeadId(value) {
  if (value === undefined || value === null || value === '') return { leadId: null };
  const text = String(value).trim();
  if (!/^\d{1,12}$/.test(text) || Number(text) < 1) return { error: 'Invalid inquiry id.' };
  return { leadId: Number(text) };
}

export async function leadExists(db, leadId) {
  const row = await db.prepare(`SELECT id FROM leads WHERE id = ?`).bind(leadId).first().catch(() => null);
  return Boolean(row);
}

export const phoneKey = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return ten.length === 10 ? ten : '';
};

export const emailKey = (value) => {
  const text = String(value ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : '';
};

/** Exact-match candidates for a quote. Pure; the caller supplies lead rows. */
export function suggestLeads(quote, leads, limit = 5) {
  const phone = phoneKey(quote?.customer_phone);
  const email = emailKey(quote?.customer_email);
  if (!phone && !email) return [];
  const out = [];
  for (const lead of leads || []) {
    const reasons = [];
    if (phone && phoneKey(lead?.phone) === phone) reasons.push('phone');
    if (email && emailKey(lead?.email) === email) reasons.push('email');
    if (reasons.length) {
      out.push({ id: Number(lead.id), name: String(lead.name || ''), city: lead.city || null, created_at: lead.created_at, matchedOn: reasons });
    }
  }
  return out
    .sort((a, b) => b.matchedOn.length - a.matchedOn.length || String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);
}
