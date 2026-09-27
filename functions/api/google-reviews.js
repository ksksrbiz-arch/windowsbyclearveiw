// GET /api/google-reviews
//
// Public, read-only JSON feed of the pinned Google Business Profile's reviews
// for the /reviews page. Configuration lives in the Cloudflare Pages dashboard
// (Settings -> Variables and Secrets), never in the repo:
//
//   GOOGLE_PLACES_API_KEY         secret. Restrict to "Places API (New)" only.
//   GOOGLE_PLACE_ID               Place ID of Clearview windows and trim LLC.
//   GOOGLE_PLACE_EXPECTED_NAME    optional; defaults to the profile's exact name.
//                                 A mismatch fails closed (shows nothing).
//   GOOGLE_REVIEWS_TTL_SECONDS    optional; edge cache for good responses.
//                                 Default 21600 (6h), clamped 300..86400.
//
// If any of that is missing or Google errors, the response is
// { status: 'unconfigured' | 'unavailable' | 'name-mismatch', reviews: [] } and
// the page falls back to its existing honest empty state. It never invents
// content and never returns the API key.

import { loadGoogleReviews } from '../_lib/google-reviews.mjs';

const DEFAULT_TTL = 21600;
const FAILURE_TTL = 300;

function ttlFrom(env) {
  const raw = Number.parseInt(env?.GOOGLE_REVIEWS_TTL_SECONDS ?? '', 10);
  if (!Number.isFinite(raw)) return DEFAULT_TTL;
  return Math.min(86400, Math.max(300, raw));
}

function jsonResponse(body, { status = 200, ttl = FAILURE_TTL } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=300, s-maxage=${ttl}`,
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function onRequestGet(context) {
  const { request, env = {}, waitUntil } = context;

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheKey = new Request(new URL('/api/google-reviews', request.url).toString(), { method: 'GET' });

  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const result = await loadGoogleReviews(env);
  const good = result.status === 'ok';
  const response = jsonResponse(result, { ttl: good ? ttlFrom(env) : FAILURE_TTL });

  if (cache) {
    const store = cache.put(cacheKey, response.clone());
    if (typeof waitUntil === 'function') waitUntil(store);
    else await store;
  }
  return response;
}

export async function onRequest(context) {
  if (context.request.method === 'GET' || context.request.method === 'HEAD') {
    return onRequestGet(context);
  }
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: {
      allow: 'GET, HEAD',
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
