import { json } from '../../_lib/quotes.mjs';
import { emailInvoice, getInvoice } from '../../_lib/invoices.mjs';

export async function onRequestGet(context) {
  const { env, params } = context;
  const id = String(params.id || '');
  const record = await getInvoice(env.QUOTES_DB, id);
  if (!record) return json({ error: 'Invoice not found.' }, 404);
  return json(record);
}

export async function onRequestPost(context) {
  const { request, params } = context;
  const id = String(params.id || '');
  let body;
  try { body = await request.json(); } catch { body = {}; }

  if (body?.action !== 'email') return json({ error: 'Unsupported invoice action.' }, 400);

  try {
    const result = await emailInvoice(context, id);
    return json(result, result.status || 200);
  } catch (error) {
    console.error('invoice-action-failed', error);
    return json({ error: 'Could not send the invoice.' }, 500);
  }
}
