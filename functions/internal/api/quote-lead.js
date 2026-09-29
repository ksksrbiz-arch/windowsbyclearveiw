// GET  /internal/api/quote-lead?quoteId=Q-...  -> linked inquiry + exact-match suggestions
// POST /internal/api/quote-lead {quoteId, leadId|null} -> link or unlink
//
// Behind the internal session middleware. Attribution only: see
// functions/internal/_lib/lead-links.mjs for why this may touch finalized quotes.

import { json, clean } from '../_lib/quotes.mjs';
import { ensureQuoteLeadColumn, parseLeadId, leadExists, suggestLeads, phoneKey, emailKey } from '../_lib/lead-links.mjs';

async function loadQuote(db, quoteId) {
  return db.prepare(`SELECT id, customer_phone, customer_email, lead_id, lead_linked_at FROM quotes WHERE id = ?`).bind(quoteId).first();
}

async function linkedLead(db, leadId) {
  if (!leadId) return null;
  return db.prepare(`SELECT id, created_at, name, city, first_referrer, first_utm_source FROM leads WHERE id = ?`).bind(leadId).first();
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const db = env.QUOTES_DB;
  await ensureQuoteLeadColumn(db);
  const quoteId = clean(new URL(request.url).searchParams.get('quoteId'), 64);
  if (!quoteId) return json({ error: 'quoteId is required.' }, 400);
  const quote = await loadQuote(db, quoteId);
  if (!quote) return json({ error: 'Not found.' }, 404);

  let suggestions = [];
  if (!quote.lead_id && (phoneKey(quote.customer_phone) || emailKey(quote.customer_email))) {
    // Leads are low-volume; match exactly in code over the most recent ones.
    const { results } = await db.prepare(
      `SELECT id, created_at, name, city, phone, email FROM leads ORDER BY created_at DESC LIMIT 1000`,
    ).all();
    suggestions = suggestLeads(quote, results);
  }
  return json({ quoteId, lead: await linkedLead(db, quote.lead_id), linkedAt: quote.lead_linked_at || null, suggestions });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const db = env.QUOTES_DB;
  await ensureQuoteLeadColumn(db);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Body must be JSON.' }, 400); }
  const quoteId = clean(body?.quoteId, 64);
  if (!quoteId) return json({ error: 'quoteId is required.' }, 400);
  const parsed = parseLeadId(body?.leadId);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const quote = await loadQuote(db, quoteId);
  if (!quote) return json({ error: 'Not found.' }, 404);
  if (parsed.leadId && !(await leadExists(db, parsed.leadId))) return json({ error: 'That inquiry does not exist.' }, 404);
  const linkedAt = parsed.leadId ? new Date().toISOString() : null;
  await db.prepare(`UPDATE quotes SET lead_id = ?, lead_linked_at = ? WHERE id = ?`).bind(parsed.leadId, linkedAt, quoteId).run();
  return json({ ok: true, quoteId, leadId: parsed.leadId, lead: await linkedLead(db, parsed.leadId) });
}

export async function onRequest(context) {
  const method = context.request.method;
  if (method === 'GET') return onRequestGet(context);
  if (method === 'POST') return onRequestPost(context);
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { allow: 'GET, POST', 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
