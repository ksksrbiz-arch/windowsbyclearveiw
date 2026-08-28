import { readCookie, verifySessionToken } from './_lib/session.mjs';

// Paths under /internal/ that must stay reachable without a session, or
// nobody could ever log in (and the login form itself would redirect to
// itself forever).
const PUBLIC_PATHS = new Set(['/internal/login', '/internal/api/login']);

function withPrivacyHeaders(response) {
  // Defense in depth alongside the sitemap exclusion and noindex meta tag on
  // every internal page: tell any crawler that somehow reaches this far to
  // stay out, and stop an upstream or browser cache from storing a page that
  // was built from someone's own session or holds a customer's data.
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  // Cloudflare's static asset server 308s every directory-style page (e.g.
  // /internal/login) to add a trailing slash before it can serve the
  // index.html inside it -- true for every page on this site, not something
  // specific to /internal. Comparing the un-slashed form means the public
  // paths stay public after that redirect instead of looping.
  const path = url.pathname.replace(/\/$/, '') || '/';

  if (PUBLIC_PATHS.has(path)) {
    return withPrivacyHeaders(await next());
  }

  const token = readCookie(request, 'cv_session');
  const valid = await verifySessionToken(token, env.INTERNAL_SESSION_SECRET);

  if (!valid) {
    const redirect = new URL('/internal/login', url);
    redirect.searchParams.set('next', url.pathname + url.search);
    return Response.redirect(redirect.toString(), 302);
  }

  return withPrivacyHeaders(await next());
}
