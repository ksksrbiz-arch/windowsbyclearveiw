function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}

/**
 * One compact read model for /internal/.
 *
 * The individual leads/quotes endpoints remain the source for their full
 * list/detail screens. This endpoint exists so the command center does not
 * download 200 rows from each table just to calculate a handful of counts.
 */
export async function onRequestGet(context) {
  const { env } = context;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [counts, recentLeads, recentQuotes, sources, cities] = await Promise.all([
    env.QUOTES_DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM leads WHERE created_at >= ?) AS new_leads,
        (SELECT COUNT(*) FROM quotes WHERE status = 'draft') AS draft_quotes,
        (SELECT COUNT(*) FROM quotes WHERE status = 'finalized') AS finalized_quotes,
        (SELECT COALESCE(SUM(total_cents), 0) FROM quotes WHERE status = 'draft') AS draft_value_cents,
        (SELECT COALESCE(SUM(total_cents), 0) FROM quotes WHERE status = 'finalized') AS finalized_value_cents,
        (SELECT COUNT(*) FROM quotes) AS total_quotes
    `).bind(weekAgo).first(),
    env.QUOTES_DB.prepare(`
      SELECT id, created_at, name, phone, email, city, role
      FROM leads ORDER BY created_at DESC LIMIT 6
    `).all(),
    env.QUOTES_DB.prepare(`
      SELECT id, created_at, status, customer_name, customer_city, total_cents
      FROM quotes ORDER BY created_at DESC LIMIT 6
    `).all(),
    env.QUOTES_DB.prepare(`
      SELECT
        CASE
          WHEN first_utm_source IS NOT NULL AND first_utm_source <> '' THEN first_utm_source
          WHEN first_referrer IS NOT NULL AND first_referrer <> '' THEN first_referrer
          ELSE 'Direct / unknown'
        END AS source,
        COUNT(*) AS count
      FROM leads
      GROUP BY source
      ORDER BY count DESC, source ASC
      LIMIT 6
    `).all(),
    env.QUOTES_DB.prepare(`
      SELECT COALESCE(NULLIF(city, ''), 'City not provided') AS city, COUNT(*) AS count
      FROM leads
      GROUP BY city
      ORDER BY count DESC, city ASC
      LIMIT 6
    `).all(),
  ]);

  return json({
    counts: counts || {},
    recentLeads: recentLeads.results,
    recentQuotes: recentQuotes.results,
    sources: sources.results,
    cities: cities.results,
  });
}
