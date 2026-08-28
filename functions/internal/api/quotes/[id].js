function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

const clean = (v, max = 500) => String(v ?? '').trim().slice(0, max);

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
 * The only mutation a saved quote ever gets: attaching a digital signature.
 * Everything else about a quote is fixed once it is created — there is no
 * "edit a finalized quote" endpoint, because a contract that can be quietly
 * rewritten after signing is not a contract. Building the wrong number is a
 * new quote, not an edit to this one.
 */
export async function onRequestPatch(context) {
  const { request, env, params } = context;
  const id = String(params.id || '');

  const quote = await env.QUOTES_DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first();
  if (!quote) return json({ error: 'Not found.' }, 404);

  if (quote.status !== 'draft' || quote.signature_method !== 'digital') {
    return json({ error: 'This quote is not awaiting a digital signature.' }, 409);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be JSON.' }, 400);
  }

  const signatureSvg = clean(body.signatureSvg, 20000);
  const signatureName = clean(body.signatureName, 200);
  if (!signatureSvg || !signatureName) {
    return json({ error: 'A drawn signature and a printed name are both required.' }, 400);
  }

  const now = new Date().toISOString();
  await env.QUOTES_DB.prepare(
    `UPDATE quotes SET signature_svg = ?, signature_name = ?, signed_at = ?, status = 'finalized', updated_at = ?
     WHERE id = ?`,
  ).bind(signatureSvg, signatureName, now, now, id).run();

  return json({ ok: true, signedAt: now });
}
