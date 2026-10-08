// GET /internal/api/mail-pilot                        counts for the page (no street addresses)
// GET /internal/api/mail-pilot?view=list[&segments=A,B,C][&limit=100][&offset=0]
//                                                      addresses for the on-screen table
// GET /internal/api/mail-pilot?view=csv[&segments=A,B,C]
//                                                      the mail-merge file (default: wave 1), as a download
//
// Read model for the Mail pilot page, behind the internal session middleware like every /internal route.
// The data is the latest load of `npm run build:mail-pilot`; this endpoint only reads it. The list and
// the file carry street addresses of public record, so they are separate requests the page makes only
// when asked, and neither is ever cached (the middleware adds no-store; the service worker does not
// intercept this path).

import { cleanSegments, readMailPilotCsv, readMailPilotList, readMailPilotSummary } from '../_lib/mail-pilot.mjs';

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
  const segments = cleanSegments(url.searchParams.get('segments'));
  try {
    if (view === 'summary') return json(await readMailPilotSummary(db));
    if (view === 'list') {
      return json({ status: 'ok', ...(await readMailPilotList(db, { segments, limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset') })) });
    }
    if (view === 'csv') {
      const file = await readMailPilotCsv(db, segments.length ? { segments } : undefined);
      if (file.count === 0) return json({ status: 'empty' }, 404);
      const stamp = new Date().toISOString().slice(0, 10);
      return new Response(file.csv, {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="clearview-mail-merge-${file.segments.join('')}-${stamp}.csv"`,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    }
    return json({ error: 'Unknown view.' }, 400);
  } catch {
    // A missing or locked database must not break the page.
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
