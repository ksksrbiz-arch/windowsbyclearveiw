function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Recent /ask activity, for /internal/ask-logs — this route is only
 *  reachable at all through the /internal/* auth middleware. */
export async function onRequestGet(context) {
  const { env } = context;
  const { results } = await env.QUOTES_DB.prepare(
    `SELECT id, created_at, question, answer, model_used, tools_used, sources, match_count, refused
     FROM ask_logs ORDER BY created_at DESC LIMIT 200`,
  ).all();
  return json({ logs: results });
}
