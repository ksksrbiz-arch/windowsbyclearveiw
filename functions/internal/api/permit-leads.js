// GET /internal/api/permit-leads            summary + builder table (aggregates and business data)
// GET /internal/api/permit-leads?view=homeowners[&limit=100]
//                                           homeowner remodel/addition rows, best fit first
//
// Read model for the "Permit leads" section of the Analytics page, behind the
// internal session middleware like every /internal route. Data is the latest
// snapshot of public records loaded by `npm run build:permit-leads`; this endpoint
// only reads it. The homeowner view carries owner names and mailing addresses, so it
// is a separate request the page makes only when the list is opened.

import { readHomeownerLeads, readPermitSummary } from '../_lib/permit-leads.mjs';

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
  const db = context.env?.QUOTES_DB;
  if (!db) return json({ status: 'unavailable' });
  const url = new URL(context.request.url);
  const view = url.searchParams.get('view') || 'summary';
  try {
    if (view === 'homeowners') {
      return json({ status: 'ok', rows: await readHomeownerLeads(db, { limit: url.searchParams.get('limit') }) });
    }
    if (view === 'summary') return json(await readPermitSummary(db));
    return json({ error: 'Unknown view.' }, 400);
  } catch {
    // A missing or locked database must not break the Analytics page.
    return json({ status: 'unavailable' });
  }
}

export async function onRequest(context) {
  if (context.request.method === 'GET' || context.request.method === 'HEAD') return onRequestGet(context);
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { allow: 'GET, HEAD', 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
