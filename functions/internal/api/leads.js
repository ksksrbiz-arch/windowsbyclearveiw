function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Recent inbound leads with their visit journeys, for /internal/leads —
 *  only reachable through the /internal/* auth middleware. Summary + journey
 *  together, unlike quotes' list/detail split: a lead has no line items or
 *  signature to defer loading, so one round trip is enough. */
export async function onRequestGet(context) {
  const { env } = context;
  const { results } = await env.QUOTES_DB.prepare(
    `SELECT id, created_at, name, phone, email, city, role, notes, visitor_id,
            first_seen_at, first_referrer, first_utm_source, first_utm_medium, first_utm_campaign, landing_path,
            visit_count, page_views_json
     FROM leads ORDER BY created_at DESC LIMIT 200`,
  ).all();
  return json({ leads: results });
}
