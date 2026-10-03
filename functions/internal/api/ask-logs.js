import { askLogCutoff } from '../../ask/_lib/log-scrub.mjs';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Where /ask conversations ended up, over the last `days` days. Every query
 *  is best effort: a table that does not exist yet (nobody has clicked, or no
 *  call-back lead has arrived) reads as zero rather than failing the page. */
async function funnel(db, days) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const count = async (sql) => {
    try {
      const row = await db.prepare(sql).bind(since).first();
      return Number(row?.n) || 0;
    } catch {
      return 0;
    }
  };
  const [conversations, estimate, call, callbackOpen, callbackLeads] = await Promise.all([
    count('SELECT COUNT(*) AS n FROM ask_logs WHERE created_at >= ?'),
    count("SELECT COUNT(*) AS n FROM ask_handoffs WHERE kind = 'estimate' AND created_at >= ?"),
    count("SELECT COUNT(*) AS n FROM ask_handoffs WHERE kind = 'call' AND created_at >= ?"),
    count("SELECT COUNT(*) AS n FROM ask_handoffs WHERE kind = 'callback_open' AND created_at >= ?"),
    count("SELECT COUNT(*) AS n FROM leads WHERE role = 'Ask assistant' AND created_at >= ?"),
  ]);
  return { days, conversations, estimate, call, callbackOpen, callbackLeads };
}

/** Recent /ask activity, for /internal/ask-logs — this route is only
 *  reachable at all through the /internal/* auth middleware. Rows older than
 *  the 30-day retention window are never returned (and are deleted here too,
 *  best effort), whether or not the nightly purge has run. */
export async function onRequestGet(context) {
  const { env } = context;
  const cutoff = askLogCutoff();
  try {
    await env.QUOTES_DB.prepare('DELETE FROM ask_logs WHERE created_at < ?').bind(cutoff).run();
  } catch {
    // The read below still filters by date.
  }
  const { results } = await env.QUOTES_DB.prepare(
    `SELECT id, created_at, question, answer, model_used, tools_used, sources, match_count, refused
     FROM ask_logs WHERE created_at >= ? ORDER BY created_at DESC LIMIT 200`,
  ).bind(cutoff).all();
  return json({ logs: results, funnel: await funnel(env.QUOTES_DB, 30) });
}
