// Bot and abuse protection for the public endpoints (/api/estimate, /ask/api/*).
//
// Two independent layers, both safe to deploy before anything is configured:
//
//   1. Cloudflare Turnstile. Active only when TURNSTILE_SECRET_KEY is set. A valid token is
//      required; a missing or rejected one is refused. If Cloudflare's verification service
//      itself is unreachable we let the request through, because a lost lead costs more than
//      one bot message, and the rate limit below still applies.
//   2. A per-visitor rate limit kept in D1 (fixed window, atomic upsert). It fails open: if D1
//      errors, the request proceeds. Visitors are keyed by a hash of their IP, never the IP.
//
// Deterministic code only: no model is involved in deciding who is let through.

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function clientIp(request) {
  return (request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Counts one request against `bucket` for this visitor and says whether it is over the limit.
 * Returns { limited, count, retryAfterSeconds }. Never throws: storage trouble means "not limited".
 */
export async function takeRateLimit(env, request, { bucket, limit, windowSeconds }, now = Date.now()) {
  const db = env?.QUOTES_DB;
  if (!db) return { limited: false, count: 0, retryAfterSeconds: 0 };
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (key, window_start)
    )`).run();
    const windowMs = windowSeconds * 1000;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const key = `${bucket}:${(await sha256Hex(clientIp(request))).slice(0, 32)}`;
    const row = await db
      .prepare(`INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
        ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
        RETURNING count`)
      .bind(key, windowStart)
      .first();
    // Old windows are useless; sweep them now and then so the table stays tiny.
    if (Math.random() < 0.02) {
      await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now - 2 * 86_400_000).run().catch(() => {});
    }
    const count = Number(row?.count) || 0;
    return { limited: count > limit, count, retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)) };
  } catch (error) {
    console.error('rate-limit-unavailable', error?.message || error);
    return { limited: false, count: 0, retryAfterSeconds: 0 };
  }
}

/**
 * Turnstile check. Results:
 *   { ok: true, skipped: true }          not configured (or verifier unreachable): let through
 *   { ok: true }                         token verified
 *   { ok: false, reason: 'missing' }     configured, but the form sent no token
 *   { ok: false, reason: 'rejected' }    Cloudflare says the token is invalid, expired or reused
 */
export async function verifyTurnstile(env, token, request, fetchImpl = fetch) {
  const secret = String(env?.TURNSTILE_SECRET_KEY || '').trim();
  if (!secret) return { ok: true, skipped: true };
  const value = typeof token === 'string' ? token.trim() : '';
  if (!value || value.length > 2048) return { ok: false, reason: 'missing' };
  try {
    const body = new FormData();
    body.set('secret', secret);
    body.set('response', value);
    const ip = clientIp(request);
    if (ip !== 'unknown') body.set('remoteip', ip);
    const response = await fetchImpl(TURNSTILE_VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`siteverify ${response.status}`);
    const result = await response.json();
    return result?.success === true ? { ok: true } : { ok: false, reason: 'rejected' };
  } catch (error) {
    console.error('turnstile-unreachable', error?.message || error);
    return { ok: true, skipped: true };
  }
}
