import { json, clean, parseQuoteBody } from '../../_lib/quotes.mjs';
import { ensureInvoiceForQuote, ensureInvoiceSchema } from '../../_lib/invoices.mjs';
import { requireApprovedBuildPlan } from '../../_lib/quote-gates.mjs';
import { ensureSigningSchema, renderSignatureSvg } from '../../_lib/quote-signing.mjs';
import { ensureFollowUpSchema } from '../../_lib/quote-follow-ups.mjs';
import { ensureQuoteWorkTypeColumn, workTypeOf } from '../../_lib/work-types.mjs';

export async function onRequestGet(context) {
  const { env, params } = context;
  const id = String(params.id || '');
  await ensureInvoiceSchema(env.QUOTES_DB);
  await ensureQuoteWorkTypeColumn(env.QUOTES_DB);

  const quote = await env.QUOTES_DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first();
  if (!quote) return json({ error: 'Not found.' }, 404);
  quote.work_type = workTypeOf(quote);

  const { results: items } = await env.QUOTES_DB.prepare(
    'SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order ASC',
  ).bind(id).all();

  const invoice = quote.status === 'finalized'
    ? await ensureInvoiceForQuote(env.QUOTES_DB, id, { finalize: true })
    : await env.QUOTES_DB.prepare('SELECT * FROM invoices WHERE quote_id = ?').bind(id).first();

  return json({ quote, items, invoice: invoice?.invoice || invoice || null });
}

export async function onRequestPut(context) {
  const { request, env, params } = context;
  const id = String(params.id || '');
  await ensureQuoteWorkTypeColumn(env.QUOTES_DB);
  const quote = await env.QUOTES_DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first();
  if (!quote) return json({ error: 'Not found.' }, 404);
  if (quote.status !== 'draft') return json({ error: 'This quote is already finalized and can no longer be edited.' }, 409);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Body must be JSON.' }, 400); }
  const parsed = parseQuoteBody(body);
  if (parsed.error) return json({ error: parsed.error }, 400);
  // The type is fixed when the quote is created. A window quote must not lose its Build Plan gate
  // (and a siding quote must not pick one up) by being relabelled; delete the draft and start again.
  if (body.workType !== undefined && parsed.workType !== workTypeOf(quote)) {
    return json({ error: 'The type of work cannot be changed once a quote is created. Start a new quote instead.', code: 'WORK_TYPE_FIXED' }, 409);
  }
  const { name, phone, email, address, city, role, notes, discountReason, cleanItems, subtotalCents, discountCents, totalCents } = parsed;
  const signatureMethod = body.signatureMethod === 'digital' ? 'digital' : 'pen';
  const now = new Date().toISOString();

  // A customer link is only valid for the numbers it was sent with: any edit to the draft
  // revokes unsigned links in the same batch, so nobody can sign totals they never saw.
  await ensureSigningSchema(env.QUOTES_DB);
  const activeLinks = await env.QUOTES_DB.prepare(
    'SELECT COUNT(*) AS n FROM quote_sign_links WHERE quote_id = ? AND revoked_at IS NULL AND signed_at IS NULL',
  ).bind(id).first();

  await env.QUOTES_DB.batch([
    env.QUOTES_DB.prepare(
      `UPDATE quote_sign_links SET revoked_at = ? WHERE quote_id = ? AND revoked_at IS NULL AND signed_at IS NULL`,
    ).bind(now, id),
    env.QUOTES_DB.prepare(
      `UPDATE quotes SET updated_at = ?, customer_name = ?, customer_phone = ?, customer_email = ?, customer_address = ?,
        customer_city = ?, customer_role = ?, notes = ?, subtotal_cents = ?, discount_cents = ?,
        discount_reason = ?, total_cents = ?, signature_method = ? WHERE id = ?`,
    ).bind(now, name, phone, email, address, city, role, notes, subtotalCents, discountCents, discountReason, totalCents, signatureMethod, id),
    env.QUOTES_DB.prepare('DELETE FROM quote_items WHERE quote_id = ?').bind(id),
    ...cleanItems.map((item, index) => env.QUOTES_DB.prepare(
      `INSERT INTO quote_items (quote_id, sort_order, label, description, quantity, unit_price_cents, line_total_cents)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(id, index, item.label, item.description, item.quantity, item.unitPriceCents, item.lineTotalCents)),
  ]);

  await ensureInvoiceForQuote(env.QUOTES_DB, id);
  return json({ id, totalCents, signLinkRevoked: Number(activeLinks?.n || 0) > 0 });
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  const id = String(params.id || '');
  const quote = await env.QUOTES_DB.prepare('SELECT status FROM quotes WHERE id = ?').bind(id).first();
  if (!quote) return json({ error: 'Not found.' }, 404);
  if (quote.status !== 'draft') return json({ error: 'Only a draft can be deleted — a finalized quote is a record, not a scratch file.' }, 409);
  // A deleted draft leaves nothing behind: its customer signing links (which would otherwise stay
  // live for 30 days pointing at nothing) and its automatic follow-up reminders go with it.
  await ensureSigningSchema(env.QUOTES_DB);
  await ensureFollowUpSchema(env.QUOTES_DB);
  await env.QUOTES_DB.batch([
    env.QUOTES_DB.prepare('DELETE FROM quote_sign_links WHERE quote_id = ?').bind(id),
    env.QUOTES_DB.prepare('DELETE FROM follow_up_tasks WHERE quote_id = ?').bind(id),
    env.QUOTES_DB.prepare('DELETE FROM quote_items WHERE quote_id = ?').bind(id),
    env.QUOTES_DB.prepare('DELETE FROM invoices WHERE quote_id = ?').bind(id),
    env.QUOTES_DB.prepare('DELETE FROM quotes WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

export async function onRequestPatch(context) {
  const { request, env, params } = context;
  const id = String(params.id || '');
  const quote = await env.QUOTES_DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first();
  if (!quote) return json({ error: 'Not found.' }, 404);
  if (quote.status !== 'draft') return json({ error: 'This quote is not awaiting a signature.' }, 409);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Body must be JSON.' }, 400); }
  const now = new Date().toISOString();

  if (body.confirmPen) {
    if (quote.signature_method !== 'pen') return json({ error: 'This quote is not on the print-and-sign path.' }, 409);
    const signatureName = clean(body.signatureName, 200);
    if (!signatureName) return json({ error: 'Enter the name of the person who signed.' }, 400);
    const gate = await requireApprovedBuildPlan(env.QUOTES_DB, id);
    if (gate) return json({ error: gate.error, code: gate.code }, 409);
    // Conditional on still being a draft so two taps/devices can never both "win" the signature.
    const signed = await env.QUOTES_DB.prepare(
      `UPDATE quotes SET signature_name = ?, signed_at = ?, status = 'finalized', updated_at = ? WHERE id = ? AND status = 'draft'`,
    ).bind(signatureName, now, now, id).run();
    if (signed?.meta?.changes === 0) return json({ error: 'This quote is not awaiting a signature.' }, 409);
    await ensureInvoiceForQuote(env.QUOTES_DB, id, { finalize: true });
    return json({ ok: true, signedAt: now });
  }

  if (quote.signature_method !== 'digital') return json({ error: 'This quote is not awaiting a digital signature.' }, 409);
  const signatureName = clean(body.signatureName, 200);
  if (!Array.isArray(body.signatureStrokes) || !signatureName) return json({ error: 'A drawn signature and a printed name are both required.' }, 400);
  // The device sends pen strokes and the server builds the SVG, exactly as for the customer's own link.
  // Storing client-built markup let a long signature be cut mid-tag at a character limit and left raw
  // markup to be rendered in this admin.
  const rendered = renderSignatureSvg(body.signatureStrokes);
  if (rendered.error) return json({ error: rendered.error }, 400);
  const signatureSvg = rendered.svg;
  const gate = await requireApprovedBuildPlan(env.QUOTES_DB, id);
  if (gate) return json({ error: gate.error, code: gate.code }, 409);

  const signed = await env.QUOTES_DB.prepare(
    `UPDATE quotes SET signature_svg = ?, signature_name = ?, signed_at = ?, status = 'finalized', updated_at = ? WHERE id = ? AND status = 'draft'`,
  ).bind(signatureSvg, signatureName, now, now, id).run();
  if (signed?.meta?.changes === 0) return json({ error: 'This quote is not awaiting a signature.' }, 409);
  await ensureInvoiceForQuote(env.QUOTES_DB, id, { finalize: true });
  return json({ ok: true, signedAt: now });
}
