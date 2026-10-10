// GET /internal/api/supplier-permits                        counts, charts and the builder table (no personal data)
// GET /internal/api/supplier-permits?view=list[&group=remodel][&limit=100][&offset=0]
//                                                           permit rows with owner names, mailing addresses and phones
// GET /internal/api/supplier-permits?view=csv[&group=remodel]
//                                                           the same rows as a spreadsheet download
//
// Read model for the "Supplier permit list" section of the Analytics page, behind the internal session middleware
// like every /internal route. The data is the latest merge of `npm run build:supplier-permits`; this endpoint only
// reads it. The list and the file carry owner names, mailing addresses and phone numbers from a licensed report,
// so they are separate requests the page makes only when asked, and neither is ever cached (no-store here, and the
// service worker does not intercept this path).

import { cleanGroup, readSupplierCsv, readSupplierList, readSupplierSummary } from '../_lib/supplier-permits.mjs';

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
  const group = cleanGroup(url.searchParams.get('group'));
  try {
    if (view === 'summary') return json(await readSupplierSummary(db));
    if (view === 'list') {
      return json({ status: 'ok', ...(await readSupplierList(db, { group, limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset') })) });
    }
    if (view === 'csv') {
      const file = await readSupplierCsv(db, { group });
      if (file.count === 0) return json({ status: 'empty' }, 404);
      const stamp = new Date().toISOString().slice(0, 10);
      return new Response(file.csv, {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="clearview-supplier-permits-${file.group || 'all'}-${stamp}.csv"`,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    }
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
