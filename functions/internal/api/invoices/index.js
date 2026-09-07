import { json } from '../../_lib/quotes.mjs';
import { ensureInvoiceForQuote, ensureInvoiceSchema } from '../../_lib/invoices.mjs';

export async function onRequestGet(context) {
  const { env } = context;
  await ensureInvoiceSchema(env.QUOTES_DB);
  const url = new URL(context.request.url);
  const quoteId = url.searchParams.get('quoteId');

  if (quoteId) {
    const quote = await env.QUOTES_DB.prepare('SELECT id, status FROM quotes WHERE id = ?').bind(quoteId).first();
    if (!quote) return json({ error: 'Quote not found.' }, 404);
    if (quote.status !== 'finalized') {
      const draftInvoice = await env.QUOTES_DB.prepare('SELECT * FROM invoices WHERE quote_id = ?').bind(quoteId).first();
      return json({ invoice: draftInvoice || null, finalized: false });
    }
    const record = await ensureInvoiceForQuote(env.QUOTES_DB, quoteId, { finalize: true });
    return json({ ...record, finalized: true });
  }

  const { results } = await env.QUOTES_DB.prepare(
    `SELECT id, invoice_number, quote_id, created_at, status, customer_name, customer_city, total_cents, sent_at
     FROM invoices ORDER BY created_at DESC LIMIT 200`,
  ).all();
  return json({ invoices: results });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Body must be JSON.' }, 400); }
  const quoteId = String(body?.quoteId || '').trim();
  if (!quoteId) return json({ error: 'quoteId is required.' }, 400);

  const quote = await env.QUOTES_DB.prepare('SELECT status FROM quotes WHERE id = ?').bind(quoteId).first();
  if (!quote) return json({ error: 'Quote not found.' }, 404);

  try {
    const record = await ensureInvoiceForQuote(env.QUOTES_DB, quoteId, { finalize: quote.status === 'finalized' });
    return json(record, 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Could not create the invoice.' }, 400);
  }
}
