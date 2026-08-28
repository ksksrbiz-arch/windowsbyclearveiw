// Kept in sync with src/data/contractTerms.ts by hand, not by import.
// Pages Functions in this repo never import from src/ — functions/api/estimate.js
// sets this precedent, duplicating its FROM address rather than reaching into
// src/data/site.ts — because the Functions bundler's handling of a cross-boundary
// TypeScript import was untested and not worth risking on something this central.
const TERMS_VERSION = '2026-08-28';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function newQuoteId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const bytes = crypto.getRandomValues(new Uint8Array(2));
  const suffix = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `Q-${date}-${suffix}`;
}

const clean = (v, max = 500) => String(v ?? '').trim().slice(0, max);

/** List recent quotes. Summary fields only — line items and signatures load
 *  on the individual quote page, not in the list. */
export async function onRequestGet(context) {
  const { env } = context;
  const { results } = await env.QUOTES_DB.prepare(
    `SELECT id, created_at, status, customer_name, customer_city, total_cents, signature_method
     FROM quotes ORDER BY created_at DESC LIMIT 200`,
  ).all();
  return json({ quotes: results });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be JSON.' }, 400);
  }

  const customer = body.customer || {};
  const name = clean(customer.name, 200);
  const phone = clean(customer.phone, 40);
  if (!name || !phone) {
    return json({ error: 'Customer name and phone are required.' }, 400);
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return json({ error: 'At least one line item is required.' }, 400);
  }

  const cleanItems = [];
  for (const [index, raw] of items.entries()) {
    const label = clean(raw?.label, 300);
    const quantity = Number(raw?.quantity);
    const unitPriceCents = Math.round(Number(raw?.unitPriceCents));
    if (!label || !Number.isFinite(quantity) || quantity <= 0) {
      return json({ error: `Line ${index + 1}: label and a positive quantity are required.` }, 400);
    }
    if (!Number.isFinite(unitPriceCents) || unitPriceCents < 0) {
      return json({ error: `Line ${index + 1}: unit price is invalid.` }, 400);
    }
    cleanItems.push({
      label,
      description: clean(raw?.description, 500),
      quantity,
      unitPriceCents,
      lineTotalCents: quantity * unitPriceCents,
    });
  }

  // The total is computed here from the line items, never trusted from the
  // client — a stray transcription bug in the browser should never become
  // the number printed on a signed contract.
  const subtotalCents = cleanItems.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const discountCents = Math.max(0, Math.min(subtotalCents, Math.round(Number(body.discountCents) || 0)));
  const totalCents = subtotalCents - discountCents;

  const signatureMethod = body.signatureMethod === 'digital' ? 'digital' : 'pen';
  // A pen-signed quote has nothing left to capture, so it is finalized on
  // creation. A digital-signature quote stays a draft until the signature
  // is actually drawn and PATCHed in.
  const status = signatureMethod === 'pen' ? 'finalized' : 'draft';
  const now = new Date().toISOString();
  const id = newQuoteId();

  await env.QUOTES_DB.batch([
    env.QUOTES_DB.prepare(
      `INSERT INTO quotes (
        id, created_at, updated_at, status,
        customer_name, customer_phone, customer_email, customer_address, customer_city, customer_role, notes,
        subtotal_cents, discount_cents, discount_reason, total_cents,
        terms_version, signature_method, created_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      id, now, now, status,
      name, phone, clean(customer.email, 200), clean(customer.address, 300), clean(customer.city, 120),
      clean(customer.role, 40), clean(body.notes, 4000),
      subtotalCents, discountCents, clean(body.discountReason, 200), totalCents,
      TERMS_VERSION, signatureMethod, 'mark',
    ),
    ...cleanItems.map((item, index) =>
      env.QUOTES_DB.prepare(
        `INSERT INTO quote_items (quote_id, sort_order, label, description, quantity, unit_price_cents, line_total_cents)
         VALUES (?,?,?,?,?,?,?)`,
      ).bind(id, index, item.label, item.description, item.quantity, item.unitPriceCents, item.lineTotalCents),
    ),
  ]);

  return json({ id, status, totalCents }, 201);
}
