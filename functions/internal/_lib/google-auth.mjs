// Server-only Google credentials. Each operation selects its own minimum scope.
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export async function googleJson(url, init = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Google service unavailable');
  return response.json();
}
export function accountConfig(raw) {
  try {
    const a = JSON.parse(raw || 'null');
    return a?.client_email && a?.private_key?.includes('BEGIN PRIVATE KEY') ? a : null;
  } catch { return null; }
}
export function ownerConfig(raw) {
  try {
    const a = JSON.parse(raw || 'null');
    return a?.client_id && a?.client_secret && a?.refresh_token ? a : null;
  } catch { return null; }
}
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encode = value => b64(new TextEncoder().encode(JSON.stringify(value)));
export async function googleToken(account, scope, fetchImpl = fetch) {
  const now = Math.floor(Date.now() / 1000);
  const payload = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: account.client_email, scope, aud: TOKEN_URL, iat: now, exp: now + 3600 })}`;
  const der = Uint8Array.from(atob(account.private_key.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(payload)));
  const data = await googleJson(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${payload}.${signature}` }) }, fetchImpl);
  if (!data.access_token) throw new Error('Google service unavailable');
  return data.access_token;
}
export async function ownerToken(owner, fetchImpl = fetch) {
  const data = await googleJson(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: owner.client_id, client_secret: owner.client_secret, refresh_token: owner.refresh_token }) }, fetchImpl);
  if (!data.access_token) throw new Error('Google service unavailable');
  return data.access_token;
}
