import { ensureLeadIntentColumn, intentSummary } from '../../_lib/intent.mjs';
import { ensureQuoteLeadColumn } from '../_lib/lead-links.mjs';
import { ensureLeadServiceColumn } from '../../_lib/lead-service.mjs';
import { ensureQuoteWorkTypeColumn } from '../_lib/work-types.mjs';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Recent inbound leads with their visit journeys, for /internal/leads —
 *  only reachable through the /internal/* auth middleware. Summary + journey
 *  together, unlike quotes' list/detail split: a lead has no line items or
 *  signature to defer loading, so one round trip is enough. */
export async function onRequestGet(context) {
  const { env } = context;
  // Attach the most recent quote linked to each lead (quotes.lead_id). Fails
  // soft to the plain list if the quotes table is not there yet.
  const hasIntent = await ensureLeadIntentColumn(env.QUOTES_DB);
  const hasService = await ensureLeadServiceColumn(env.QUOTES_DB);
  const linked = await ensureQuoteLeadColumn(env.QUOTES_DB)
    .then(() => ensureQuoteWorkTypeColumn(env.QUOTES_DB))
    .then(() => env.QUOTES_DB.prepare(
      `SELECT lead_id, id, status, work_type, total_cents, created_at FROM quotes
       WHERE lead_id IN (SELECT id FROM leads ORDER BY created_at DESC LIMIT 200)
       ORDER BY created_at DESC`,
    ).all())
    .then((r) => r.results || [])
    .catch(() => []);
  const quoteByLead = new Map();
  for (const q of linked) {
    const entry = quoteByLead.get(q.lead_id) || { quote_count: 0, quote_id: q.id, quote_status: q.status, quote_total_cents: q.total_cents, quote_work_type: q.work_type };
    entry.quote_count += 1;
    quoteByLead.set(q.lead_id, entry);
  }
  const { results } = await env.QUOTES_DB.prepare(
    `SELECT id, created_at, name, phone, email, city, role, notes, ${hasService ? 'service, ' : ''}visitor_id,
            first_seen_at, first_referrer, first_utm_source, first_utm_medium, first_utm_campaign, landing_path,
            visit_count, page_views_json${hasIntent ? ", intent_json" : ""}
     FROM leads ORDER BY created_at DESC LIMIT 200`,
  ).all();
  return json({ leads: (results || []).map((lead) => ({ ...lead, intent: (() => { try { return intentSummary(JSON.parse(lead.intent_json || "null"), Date.parse(lead.created_at)); } catch { return null; } })(), ...(quoteByLead.get(lead.id) || { quote_count: 0 }) })) });
}
