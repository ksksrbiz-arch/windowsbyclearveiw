import { TERMS_VERSION, json, parseQuoteBody } from '../../_lib/quotes.mjs';

function newQuoteId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const bytes = crypto.getRandomValues(new Uint8Array(2));
  const suffix = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `Q-${date}-${suffix}`;
}

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

  const parsed = parseQuoteBody(body);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const { name, phone, email, address, city, role, notes, discountReason, cleanItems, subtotalCents, discountCents, totalCents } = parsed;

  const signatureMethod = body.signatureMethod === 'digital' ? 'digital' : 'pen';
  // Both paths start as a draft: nothing is actually signed yet the moment
  // this row is created, and a draft can still be edited (PUT) to fix a
  // typo before anyone signs anything. A digital quote is finalized when
  // the drawn signature is PATCHed in; a pen quote is finalized when Mark
  // confirms the printed copy actually got signed.
  const status = 'draft';
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
      name, phone, email, address, city,
      role, notes,
      subtotalCents, discountCents, discountReason, totalCents,
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
