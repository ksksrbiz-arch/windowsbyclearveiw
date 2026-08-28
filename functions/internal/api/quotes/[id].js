import { json, clean, parseQuoteBody } from '../../_lib/quotes.mjs';

export async function onRequestGet(context) {
  const { env, params } = context;
  const id = String(params.id || '');

  const quote = await env.QUOTES_DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first();
  if (!quote) return json({ error: 'Not found.' }, 404);

  const { results: items } = await env.QUOTES_DB.prepare(
    'SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order ASC',
  ).bind(id).all();

  return json({ quote, items });
}

/**
 * Replaces the customer info and line items on a quote — only while it is
 * still a draft. Once a quote is finalized (digitally signed, or confirmed
 * signed on paper) this always 409s: a contract that can be quietly
 * rewritten after signing is not a contract. Fixing a mistake on a signed
 * quote means starting a new one.
 */
export async function onRequestPut(context) {
  const { request, env, params } = context;
  const id = String(params.id || '');

  const quote = await env.QUOTES_DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first();
  if (!quote) return json({ error: 'Not found.' }, 404);
  if (quote.status !== 'draft') {
    return json({ error: 'This quote is already finalized and can no longer be edited.' }, 409);
  }

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
  const now = new Date().toISOString();

  await env.QUOTES_DB.batch([
    env.QUOTES_DB.prepare(
      `UPDATE quotes SET
        updated_at = ?, customer_name = ?, customer_phone = ?, customer_email = ?, customer_address = ?,
        customer_city = ?, customer_role = ?, notes = ?, subtotal_cents = ?, discount_cents = ?,
        discount_reason = ?, total_cents = ?, signature_method = ?
       WHERE id = ?`,
    ).bind(
      now, name, phone, email, address, city, role, notes,
      subtotalCents, discountCents, discountReason, totalCents, signatureMethod, id,
    ),
    env.QUOTES_DB.prepare('DELETE FROM quote_items WHERE quote_id = ?').bind(id),
    ...cleanItems.map((item, index) =>
      env.QUOTES_DB.prepare(
        `INSERT INTO quote_items (quote_id, sort_order, label, description, quantity, unit_price_cents, line_total_cents)
         VALUES (?,?,?,?,?,?,?)`,
      ).bind(id, index, item.label, item.description, item.quantity, item.unitPriceCents, item.lineTotalCents),
    ),
  ]);

  return json({ id, totalCents });
}

/**
 * Voids an abandoned draft — a customer who walks away mid-quote, a wrong
 * customer picked from muscle memory, a duplicate started by accident.
 * Only ever a draft: a finalized quote is a record of what was agreed to,
 * not a scratch file, so this always 409s once a quote is signed.
 */
export async function onRequestDelete(context) {
  const { env, params } = context;
  const id = String(params.id || '');

  const quote = await env.QUOTES_DB.prepare('SELECT status FROM quotes WHERE id = ?').bind(id).first();
  if (!quote) return json({ error: 'Not found.' }, 404);
  if (quote.status !== 'draft') {
    return json({ error: 'Only a draft can be deleted — a finalized quote is a record, not a scratch file.' }, 409);
  }

  await env.QUOTES_DB.batch([
    env.QUOTES_DB.prepare('DELETE FROM quote_items WHERE quote_id = ?').bind(id),
    env.QUOTES_DB.prepare('DELETE FROM quotes WHERE id = ?').bind(id),
  ]);

  return json({ ok: true });
}

/**
 * The only two mutations a draft quote gets on the way to being signed:
 * attaching a drawn digital signature, or confirming that a printed copy
 * actually got signed by hand. Either one finalizes the quote. There is no
 * "edit a finalized quote" — see the PUT handler's note above.
 */
export async function onRequestPatch(context) {
  const { request, env, params } = context;
  const id = String(params.id || '');

  const quote = await env.QUOTES_DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first();
  if (!quote) return json({ error: 'Not found.' }, 404);
  if (quote.status !== 'draft') {
    return json({ error: 'This quote is not awaiting a signature.' }, 409);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be JSON.' }, 400);
  }

  const now = new Date().toISOString();

  if (body.confirmPen) {
    if (quote.signature_method !== 'pen') {
      return json({ error: 'This quote is not on the print-and-sign path.' }, 409);
    }
    const signatureName = clean(body.signatureName, 200);
    if (!signatureName) {
      return json({ error: 'Enter the name of the person who signed.' }, 400);
    }
    await env.QUOTES_DB.prepare(
      `UPDATE quotes SET signature_name = ?, signed_at = ?, status = 'finalized', updated_at = ? WHERE id = ?`,
    ).bind(signatureName, now, now, id).run();
    return json({ ok: true, signedAt: now });
  }

  if (quote.signature_method !== 'digital') {
    return json({ error: 'This quote is not awaiting a digital signature.' }, 409);
  }

  const signatureSvg = clean(body.signatureSvg, 20000);
  const signatureName = clean(body.signatureName, 200);
  if (!signatureSvg || !signatureName) {
    return json({ error: 'A drawn signature and a printed name are both required.' }, 400);
  }

  await env.QUOTES_DB.prepare(
    `UPDATE quotes SET signature_svg = ?, signature_name = ?, signed_at = ?, status = 'finalized', updated_at = ?
     WHERE id = ?`,
  ).bind(signatureSvg, signatureName, now, now, id).run();

  return json({ ok: true, signedAt: now });
}
