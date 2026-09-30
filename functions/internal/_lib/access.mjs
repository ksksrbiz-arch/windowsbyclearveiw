// Cloudflare Access sign-in for the Command Center (optional, off until configured).
//
// When an Access application protects /internal*, Cloudflare puts a signed JWT in the
// Cf-Access-Jwt-Assertion header of every request that passed its login (email code, Google, MFA).
// We never trust the header's presence: the signature is checked against Cloudflare's published
// keys and the token must be for this team and this application.
//
//   ACCESS_TEAM_DOMAIN   e.g. "clearview" for https://clearview.cloudflareaccess.com
//   ACCESS_AUD           the application's Audience (AUD) tag
//   ACCESS_REQUIRED      "1" = the shared password is no longer accepted (set only once Access works)
//
// Everything fails closed: any problem verifying means "no Access identity", which falls back to
// the password session exactly as before (unless ACCESS_REQUIRED is on).

const JWKS_TTL_MS = 60 * 60 * 1000;
const cache = new Map(); // team -> { keys, fetchedAt }

export function accessConfig(env) {
  const team = String(env?.ACCESS_TEAM_DOMAIN || '').trim().toLowerCase().replace(/\.cloudflareaccess\.com$/, '');
  const aud = String(env?.ACCESS_AUD || '').trim();
  if (!/^[a-z0-9-]{1,63}$/.test(team) || !/^[A-Za-z0-9]{16,128}$/.test(aud)) return null;
  return { team, aud, issuer: `https://${team}.cloudflareaccess.com`, required: String(env?.ACCESS_REQUIRED || '') === '1' };
}

const b64urlToBytes = (text) => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};
const parseJson = (text) => JSON.parse(new TextDecoder().decode(b64urlToBytes(text)));

async function loadKeys(config, fetchImpl, now, force) {
  const hit = cache.get(config.team);
  if (hit && !force && now - hit.fetchedAt < JWKS_TTL_MS) return hit.keys;
  const response = await fetchImpl(`${config.issuer}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw new Error(`certs ${response.status}`);
  const body = await response.json();
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  cache.set(config.team, { keys, fetchedAt: now });
  return keys;
}

export function clearAccessKeyCache() { cache.clear(); }

/** Returns { email } for a valid Access token, otherwise null. Never throws. */
export async function verifyAccessJwt(token, config, fetchImpl = fetch, now = Date.now()) {
  try {
    if (!config || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = parseJson(parts[0]);
    const claims = parseJson(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;

    let keys = await loadKeys(config, fetchImpl, now, false);
    let jwk = keys.find((key) => key.kid === header.kid);
    if (!jwk) {
      keys = await loadKeys(config, fetchImpl, now, true); // keys rotate; one refresh, then give up
      jwk = keys.find((key) => key.kid === header.kid);
    }
    if (!jwk || jwk.kty !== 'RSA') return null;
    const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;

    const seconds = Math.floor(now / 1000);
    if (claims.iss !== config.issuer) return null;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(config.aud)) return null;
    if (typeof claims.exp !== 'number' || claims.exp <= seconds) return null;
    if (typeof claims.nbf === 'number' && claims.nbf > seconds + 30) return null;
    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    return email ? { email } : null;
  } catch {
    return null;
  }
}
