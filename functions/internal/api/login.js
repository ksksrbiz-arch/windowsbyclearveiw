import { createSessionToken, sessionCookie } from '../_lib/session.mjs';

/** Constant-time compare so the password cannot be probed byte by byte. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.INTERNAL_PASSWORD || !env.INTERNAL_SESSION_SECRET) {
    return redirectToLogin(request, 'not-configured');
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return redirectToLogin(request, 'bad-request');
  }

  const password = String(form.get('password') || '');
  const next = String(form.get('next') || '/internal/quotes');

  if (!password || !timingSafeEqual(password, env.INTERNAL_PASSWORD)) {
    return redirectToLogin(request, 'wrong-password', next);
  }

  const token = await createSessionToken(env.INTERNAL_SESSION_SECRET);
  const target = next.startsWith('/internal') ? next : '/internal/quotes';

  return new Response(null, {
    status: 303,
    headers: {
      location: new URL(target, request.url).toString(),
      'set-cookie': sessionCookie(token),
      'cache-control': 'no-store',
    },
  });
}

function redirectToLogin(request, reason, next) {
  const url = new URL('/internal/login', request.url);
  url.searchParams.set('error', reason);
  if (next) url.searchParams.set('next', next);
  return new Response(null, {
    status: 303,
    headers: { location: url.toString(), 'cache-control': 'no-store' },
  });
}

export async function onRequestGet() {
  return new Response(JSON.stringify({ error: 'POST a password from the login form.' }), {
    status: 405,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
