/**
 * Stateless session tokens for the internal tool's single shared password.
 *
 * There is one password (INTERNAL_PASSWORD) and one signing secret
 * (INTERNAL_SESSION_SECRET), both Pages secrets. A session is just
 * `${expiry}.${hmac}` — the expiry timestamp, and an HMAC-SHA256 over that
 * timestamp keyed by the secret. Nothing is stored server-side, so there is
 * no session table to expire, clean up, or leak. Forging a token means
 * forging the HMAC, which requires the secret.
 */

const encoder = new TextEncoder();

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string compare so the HMAC cannot be probed byte by byte. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — Mark keeps this on his phone

export async function createSessionToken(secret) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const mac = await hmacHex(secret, String(expires));
  return `${expires}.${mac}`;
}

export async function verifySessionToken(token, secret) {
  if (!token || !secret) return false;
  const [expiresRaw, mac] = token.split('.');
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || !mac) return false;
  if (Math.floor(Date.now() / 1000) > expires) return false;
  const expected = await hmacHex(secret, String(expires));
  return timingSafeEqual(mac, expected);
}

export function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(header);
  return match ? decodeURIComponent(match[1]) : '';
}

export function sessionCookie(token) {
  // HttpOnly: not readable by page JS. Secure: HTTPS only, which Pages always
  // is. SameSite=Lax: sent on normal navigation, not on cross-site POSTs —
  // enough for a single-operator internal tool with no third-party embeds.
  return `cv_session=${encodeURIComponent(token)}; Path=/internal; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
  return 'cv_session=; Path=/internal; Max-Age=0; HttpOnly; Secure; SameSite=Lax';
}
