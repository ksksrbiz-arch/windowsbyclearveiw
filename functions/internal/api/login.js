import { createSessionToken, sessionCookie } from '../_lib/session.mjs';

const encoder = new TextEncoder();

/**
 * Compare password material without a direct length-mismatch branch.
 *
 * Hashing both values to fixed-size SHA-256 digests means the comparison
 * always walks the same 32-byte digest length. The submitted password's
 * hashing cost naturally depends on its own length, which is already known
 * to the caller; the comparison itself does not stop early based on the
 * secret's length or expose a length mismatch before comparing the digest.
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
