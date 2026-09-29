// Customer signing links, managed by Mark (behind the internal session middleware).
//
// GET    /internal/api/quote-share?quoteId=Q-...  -> status of the current link (never the token)
// POST   /internal/api/quote-share {quoteId}      -> new link; the URL is returned once, here only
// DELETE /internal/api/quote-share?quoteId=Q-...  -> revoke the active link
//
// See functions/internal/_lib/quote-signing.mjs for the security model.

import { json, clean } from '../_lib/quotes.mjs';
import { requireApprovedBuildPlan } from '../_lib/quote-gates.mjs';
import { ensureSigningSchema, newToken, hashToken, linkStatus, LINK_TTL_DAYS } from '../_lib/quote-signing.mjs';

const SITE = 'https://windowsbyclearview.com';

async function latestLink(db, quoteId) {
  return db.prepare(`SELECT * FROM quote_sign_links WHERE quote_id = ? ORDER BY created_at DESC LIMIT 1`).bind(quoteId).first();
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const db = env.QUOTES_DB;
  await ensureSigningSchema(db);
  const quoteId = clean(new URL(request.url).searchParams.get('quoteId'), 64);
  if (!quoteId) return json({ error: 'quoteId is required.' }, 400);
  const quote = await db.prepare(`SELECT id, status FROM quotes WHERE id = ?`).bind(quoteId).first();
  if (!quote) return json({ error: 'Not found.' }, 404);
  const gate = quote.status === 'draft' ? await requireApprovedBuildPlan(db, quoteId) : null;
  return json({ quoteId, quoteStatus: quote.status, link: linkStatus(await latestLink(db, quoteId)), canCreate: quote.status === 'draft' && !gate, blockedBy: gate });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const db = env.QUOTES_DB;
  await ensureSigningSchema(db);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Body must be JSON.' }, 400); }
  const quoteId = clean(body?.quoteId, 64);
  if (!quoteId) return json({ error: 'quoteId is required.' }, 400);
  const quote = await db.prepare(`SELECT id, status, customer_name, customer_phone, customer_email FROM quotes WHERE id = ?`).bind(quoteId).first();
  if (!quote) return json({ error: 'Not found.' }, 404);
  if (quote.status !== 'draft') return json({ error: 'This quote is already signed.' }, 409);
  // Never send a customer a quote that could not be signed.
  const gate = await requireApprovedBuildPlan(db, quoteId);
  if (gate) return json({ error: gate.error, code: gate.code }, 409);

  const token = newToken();
  const now = new Date();
  const expires = new Date(now.getTime() + LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.batch([
    db.prepare(`UPDATE quote_sign_links SET revoked_at = ? WHERE quote_id = ? AND revoked_at IS NULL AND signed_at IS NULL`).bind(now.toISOString(), quoteId),
    db.prepare(`INSERT INTO quote_sign_links (token_hash, quote_id, created_at, expires_at) VALUES (?, ?, ?, ?)`).bind(await hashToken(token), quoteId, now.toISOString(), expires.toISOString()),
    // The customer signs on screen, so the quote is on the digital path from here.
    db.prepare(`UPDATE quotes SET signature_method = 'digital', updated_at = ? WHERE id = ? AND status = 'draft'`).bind(now.toISOString(), quoteId),
  ]);
  // Token rides in the fragment: never sent to servers, logs, GA4 page_location or referrers.
  const url = `${SITE}/sign#${token}`;
  const firstName = String(quote.customer_name || '').trim().split(/\s+/)[0] || '';
  const message = `Hi${firstName ? ` ${firstName}` : ''}, here is your Clearview Windows & Trim quote to review and sign: ${url}`;
  const phone = String(quote.customer_phone || '').replace(/[^\d+]/g, '');
  return json({
    url,
    message,
    smsHref: phone ? `sms:${phone}?&body=${encodeURIComponent(message)}` : null,
    mailHref: quote.customer_email
      ? `mailto:${encodeURIComponent(quote.customer_email)}?subject=${encodeURIComponent(`Your quote ${quoteId}`)}&body=${encodeURIComponent(message)}`
      : null,
    link: linkStatus(await latestLink(db, quoteId)),
  }, 201);
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  const db = env.QUOTES_DB;
  await ensureSigningSchema(db);
  const quoteId = clean(new URL(request.url).searchParams.get('quoteId'), 64);
  if (!quoteId) return json({ error: 'quoteId is required.' }, 400);
  await db.prepare(`UPDATE quote_sign_links SET revoked_at = ? WHERE quote_id = ? AND revoked_at IS NULL AND signed_at IS NULL`)
    .bind(new Date().toISOString(), quoteId).run();
  return json({ ok: true, link: linkStatus(await latestLink(db, quoteId)) });
}
