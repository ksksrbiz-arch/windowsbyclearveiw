import { TERMS_VERSION, json, parseQuoteBody } from '../../_lib/quotes.mjs';
import { ensureInvoiceForQuote } from '../../_lib/invoices.mjs';

function newQuoteId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const bytes = crypto.getRandomValues(new Uint8Array(2));
  const suffix = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `Q-${date}-${suffix}`;
}

export async function onRequestGet(context) {
  const { env } = context;
  const { results } = await env.QUOTES_DB.prepare(
    `SELECT q.id, q.created_at, q.status, q.customer_name, q.customer_city, q.total_cents, q.signature_method,
            i.id AS invoice_id, i.invoice_number, i.status AS invoice_status, i.sent_at AS invoice_sent_at
     FROM quotes q
     LEFT JOIN invoices i ON i.quote_id = q.id
     ORDER BY q.created_at DESC LIMIT 200`,
  ).all();
  return json({ quotes: results });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Body must be JSON.' }, 400); }

  const parsed = parseQuoteBody(body);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const { name, phone, email, address, city, role, notes, discountReason, cleanItems, subtotalCents, discountCents, totalCents } = parsed;
  const signatureMethod = body.signatureMethod === 'digital' ? 'digital' : 'pen';
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

  const record = await ensureInvoiceForQuote(env.QUOTES_DB, id);
  return json({ id, status, totalCents, invoiceId: record?.invoice?.id || `INV-${id.replace(/^Q-/, '')}` }, 201);
}
