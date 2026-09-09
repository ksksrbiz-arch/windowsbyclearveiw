const MAX_BODY_BYTES = 96 * 1024;
const ALLOWED_METHODS = new Set(['POST', 'OPTIONS']);

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'vary': 'Origin',
      ...extra,
    },
  });
}

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function onRequest(context) {
  const { request, next } = context;

  if (!ALLOWED_METHODS.has(request.method)) {
    return json({ error: 'Method not allowed.' }, 405, { allow: 'POST, OPTIONS' });
  }

  if (request.method === 'OPTIONS') {
    if (!sameOrigin(request)) return json({ error: 'Invalid request origin.' }, 403);
    return new Response(null, {
      status: 204,
      headers: {
        'cache-control': 'no-store',
        'access-control-allow-origin': new URL(request.url).origin,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'vary': 'Origin',
      },
    });
  }

  if (!sameOrigin(request)) {
    return json({ error: 'Invalid request origin.' }, 403);
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ error: 'Request is too large.' }, 413);
  }

  const contentType = (request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    return json({ error: 'Send the request as JSON.' }, 415);
  }

  return next();
}
