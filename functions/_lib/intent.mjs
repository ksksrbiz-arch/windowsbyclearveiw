// Behavioral context is browser-reported, never evidence of a purchase or identity.
export const INTENT_EVENTS = ['return_visit', 'pricing_view', 'service_view', 'reviews_view', 'calculator_start', 'calculator_result', 'calculator_handoff', 'estimate_form_start', 'estimate_form_attempt', 'estimate_form_error', 'callback_form_start', 'callback_form_attempt', 'callback_form_error', 'consultant_start', 'faq_open', 'review_click', 'email_click', 'gallery_open', 'download_click', 'outbound_click', 'page_engaged', 'phone_interest', 'estimate_interest', 'guide_read', 'studio_start'];
export const INTENT_LABELS = { return_visit: 'Returned to the site', pricing_view: 'Read pricing', service_view: 'Viewed a service', reviews_view: 'Read reviews', calculator_start: 'Used the calculator', calculator_result: 'Built a calculator result', calculator_handoff: 'Continued from calculator', estimate_form_start: 'Started estimate form', estimate_form_attempt: 'Tried to send estimate form', estimate_form_error: 'Estimate form needed attention', callback_form_start: 'Started callback form', callback_form_attempt: 'Tried to send callback form', callback_form_error: 'Callback form needed attention', consultant_start: 'Started the website consultant', faq_open: 'Opened a common question', review_click: 'Opened a review link', email_click: 'Clicked email', gallery_open: 'Opened a work photo', download_click: 'Opened a download', outbound_click: 'Opened an external link', page_engaged: 'Spent 30 active seconds on a page', phone_interest: 'Clicked phone', estimate_interest: 'Clicked estimate link', guide_read: 'Read most of a guide', studio_start: 'Opened the window studio' };
export function normalizeIntent(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || !Number.isFinite(value.startedAt) || value.startedAt < now - 90 * 86400000 || value.startedAt > now + 60000) return null;
  const counts = {};
  for (const name of INTENT_EVENTS) if (Number.isFinite(value.counts?.[name]) && value.counts[name] > 0) counts[name] = Math.min(100, Math.floor(value.counts[name]));
  return { version: 1, startedAt: value.startedAt, sessions: Math.max(1, Math.min(100, Math.floor(Number(value.sessions) || 1))), counts };
}
export function intentSummary(value, now = Date.now()) {
  const data = normalizeIntent(value, Number.isFinite(now) ? now : Date.now());
  if (!data) return null;
  const weights = { return_visit: 10, pricing_view: 10, reviews_view: 5, calculator_start: 15, calculator_result: 10, calculator_handoff: 15, estimate_form_start: 15, callback_form_start: 15, phone_interest: 15, estimate_interest: 5, guide_read: 5 };
  const score = Math.min(100, Object.entries(weights).reduce((n, [event, points]) => n + (data.counts[event] ? points : 0), 0));
  return { ...data, score, signals: INTENT_EVENTS.filter(name => data.counts[name]).map(name => INTENT_LABELS[name]) };
}
export async function ensureLeadIntentColumn(db) {
  if (!db) return false;
  try {
    const columns = await db.prepare('PRAGMA table_info(leads)').all();
    if (columns.results?.some(column => column.name === 'intent_json')) return true;
    try { await db.prepare("ALTER TABLE leads ADD COLUMN intent_json TEXT").run(); } catch {
      const again = await db.prepare('PRAGMA table_info(leads)').all();
      return !!again.results?.some(column => column.name === 'intent_json');
    }
    return true;
  } catch { return false; }
}
