// GET /internal/api/analytics
//
// Read model for the Analytics page (behind the internal session middleware).
// Combines two deterministic sources:
//   * ga4: live GA4 numbers via functions/internal/_lib/ga4.mjs (fail-soft)
//   * leads: where estimate requests actually came from, counted from D1
// Ahrefs has no entry here on purpose: the free Webmaster Tools plan has no
// API, so the page only links to it.

import { fetchGa4Summary } from '../_lib/ga4.mjs';
import { summarizeLeadSources } from '../_lib/lead-sources.mjs';

const MAX_LEAD_ROWS = 2000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function onRequestGet(context) {
  const { env = {} } = context;
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [ga4, leadRows] = await Promise.all([
    fetchGa4Summary(env),
    env.QUOTES_DB
      ? env.QUOTES_DB.prepare(
          `SELECT created_at, first_referrer, first_utm_source, landing_path
           FROM leads WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?`,
        )
          .bind(since, MAX_LEAD_ROWS)
          .all()
          .then((result) => result.results || [])
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  return json({
    ga4,
    leads: leadRows ? { status: 'ok', ...summarizeLeadSources(leadRows) } : { status: 'unavailable' },
    links: {
      ga4: ga4.propertyId
        ? `https://analytics.google.com/analytics/web/#/p${ga4.propertyId}/reports/intelligenthome`
        : 'https://analytics.google.com/',
      tagManager: 'https://tagmanager.google.com/',
      searchConsole: 'https://search.google.com/search-console',
      ahrefsWebmasterTools: 'https://ahrefs.com/webmaster-tools',
    },
  });
}

export async function onRequest(context) {
  if (context.request.method === 'GET' || context.request.method === 'HEAD') return onRequestGet(context);
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { allow: 'GET, HEAD', 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
