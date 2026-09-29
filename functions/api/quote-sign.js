// Public customer signing endpoint for the /sign#<token> page.
//
// GET  /api/quote-sign  (x-sign-token header)            -> customer-safe quote view
// POST /api/quote-sign {t, name, strokes, consent: true} -> sign and finalize
// The page reads the token from /sign#<token>; see quote-share.js.
//
// No session: possession of the 256-bit link token is the authorization, and
// it only ever grants view + sign of that one quote. Security model and
// validation live in functions/internal/_lib/quote-signing.mjs.

import { ensureSigningSchema, resolveLink, publicQuote, renderSignatureSvg } from '../internal/_lib/quote-signing.mjs';
import { requireApprovedBuildPlan } from '../internal/_lib/quote-gates.mjs';
import { ensureInvoiceForQuote } from '../internal/_lib/invoices.mjs';
import { sendOpsAlert } from '../_lib/lead-alert.mjs';
import { TERMS_VERSION } from '../internal/_lib/quotes.mjs';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex',
      'referrer-policy': 'no-referrer',
    },
  });
}

async function loadQuote(db, quoteId) {
  const quote = await db.prepare(`SELECT * FROM quotes WHERE id = ?`).bind(quoteId).first();
  if (!quote) return null;
  const { results } = await db.prepare(`SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order ASC, id ASC`).bind(quoteId).all();
  return { quote, items: results || [] };
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const db = env.QUOTES_DB;
  if (!db) return json({ error: 'Signing is temporarily unavailable.' }, 503);
  await ensureSigningSchema(db);
  // Header, not query string: the token never appears in a URL or access log.
  const resolved = await resolveLink(db, request.headers.get('x-sign-token'));
  if (resolved.error) return json({ error: resolved.error }, resolved.status);
  const loaded = await loadQuote(db, resolved.row.quote_id);
  if (!loaded) return json({ error: 'This quote is no longer available.' }, 410);
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE quote_sign_links SET view_count = view_count + 1, last_viewed_at = ?, first_viewed_at = COALESCE(first_viewed_at, ?) WHERE token_hash = ?`,
  ).bind(now, now, resolved.row.token_hash).run();
  return json({ quote: publicQuote(loaded.quote, loaded.items) });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const db = env.QUOTES_DB;
  if (!db) return json({ error: 'Signing is temporarily unavailable.' }, 503);
  await ensureSigningSchema(db);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const resolved = await resolveLink(db, body?.t);
  if (resolved.error) return json({ error: resolved.error }, resolved.status);
  if (resolved.row.signed_at) return json({ error: 'This quote has already been signed.' }, 409);
  if (body?.consent !== true) return json({ error: 'Please confirm you agree to sign electronically.', field: 'consent' }, 400);
  const name = String(body?.name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (name.length < 2) return json({ error: 'Please type your full name.', field: 'name' }, 400);
  const signature = renderSignatureSvg(body?.strokes);
  if (signature.error) return json({ error: signature.error, field: 'signature' }, 400);

  const quoteId = resolved.row.quote_id;
  const loaded = await loadQuote(db, quoteId);
  if (!loaded) return json({ error: 'This quote is no longer available.' }, 410);
  if (loaded.quote.status !== 'draft') return json({ error: 'This quote has already been signed.' }, 409);
  // The page shows the current terms; never let a customer sign different terms than their quote records.
  if (loaded.quote.terms_version !== TERMS_VERSION) {
    return json({ error: 'The contract terms for this quote have been updated. Please wait for a new link from Clearview.', code: 'TERMS_CHANGED' }, 409);
  }
  const gate = await requireApprovedBuildPlan(db, quoteId);
  if (gate) {
    // The quote changed after the link was sent. Mark has to re-approve and resend.
    return json({ error: 'This quote is being updated. Please wait for a new link from Clearview.', code: gate.code }, 409);
  }

  const now = new Date().toISOString();
  const result = await db.prepare(
    `UPDATE quotes SET signature_method = 'digital', signature_svg = ?, signature_name = ?, signed_at = ?, status = 'finalized', updated_at = ?
     WHERE id = ? AND status = 'draft'`,
  ).bind(signature.svg, name, now, now, quoteId).run();
  if (!result?.meta?.changes) return json({ error: 'This quote has already been signed.' }, 409);

  const userAgent = String(request.headers.get('user-agent') || '').slice(0, 300) || null;
  await db.prepare(`UPDATE quote_sign_links SET signed_at = ?, signer_user_agent = ? WHERE token_hash = ?`)
    .bind(now, userAgent, resolved.row.token_hash).run();
  await ensureInvoiceForQuote(db, quoteId, { finalize: true });
  context.waitUntil?.(sendOpsAlert(env, {
    title: 'Quote signed',
    body: 'A customer just signed a quote from their signing link. Tap to open it.',
    click: `https://windowsbyclearview.com/internal/quotes/view?id=${encodeURIComponent(quoteId)}`,
    tags: 'white_check_mark,house',
  }));
  return json({ ok: true, signedAt: now });
}

export async function onRequest(context) {
  const method = context.request.method;
  if (method === 'GET') return onRequestGet(context);
  if (method === 'POST') return onRequestPost(context);
  return json({ error: 'Method not allowed' }, 405);
}
