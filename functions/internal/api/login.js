import { createSessionToken, sessionCookie } from '../_lib/session.mjs';

const encoder = new TextEncoder();

/**
 * Constant-time password check, so the password cannot be probed by timing.
 *
 * Both sides are reduced to a SHA-256 digest first, so the comparison always
 * walks exactly 32 bytes. That keeps the work independent of the real
 * password's length: an early return on a length mismatch would leak it
 * outright, and bounding the loop by the longer input (Math.max) still leaks
 * it, because the runtime would stop growing once the submitted value passed
 * the secret's length — an attacker can binary-search that inflection point.
 * Digest time varies only with the submitted value's own length, which the
 * attacker already knows.
 */
async function timingSafeEqual(a, b) {
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) diff |= bytesA[i] ^ bytesB[i];
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

  if (!password || !(await timingSafeEqual(password, env.INTERNAL_PASSWORD))) {
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
