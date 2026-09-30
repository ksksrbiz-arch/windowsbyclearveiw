// Cloudflare Access sign-in: real RS256 signatures from a generated key pair, a fake certs
// endpoint, and the real middleware. The property that matters: an Access token is accepted only
// when it is genuinely signed for this team and application, and every failure falls back to the
// password session (so turning Access on can never lock Mark out, until ACCESS_REQUIRED=1).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accessConfig, clearAccessKeyCache, verifyAccessJwt } from '../functions/internal/_lib/access.mjs';
import { onRequest as middleware } from '../functions/internal/_middleware.js';
import { createSessionToken } from '../functions/internal/_lib/session.mjs';

process.removeAllListeners('warning');
let groups = 0;
const ok = async (fn) => { await fn(); groups++; };

const b64url = (input) => Buffer.from(input).toString('base64url');
async function makeKey(kid) {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { kid, privateKey: pair.privateKey, jwk: { kty: jwk.kty, n: jwk.n, e: jwk.e, kid, alg: 'RS256', use: 'sig' } };
}
async function sign(key, claims, header = {}) {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header }));
  const body = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${Buffer.from(sig).toString('base64url')}`;
}

const env = { ACCESS_TEAM_DOMAIN: 'clearview', ACCESS_AUD: 'a'.repeat(64), INTERNAL_SESSION_SECRET: 'test-secret-test-secret' };
const config = accessConfig(env);
const now = Date.UTC(2026, 8, 30, 18, 0, 0);
const seconds = Math.floor(now / 1000);
const good = { iss: 'https://clearview.cloudflareaccess.com', aud: [env.ACCESS_AUD], email: 'Mark@Example.com', exp: seconds + 3600, nbf: seconds - 10 };

const keyA = await makeKey('kid-a');
const keyB = await makeKey('kid-b');
let published = [keyA.jwk];
let certCalls = 0;
let certsDown = false;
const certsFetch = async (url) => {
  assert.equal(String(url), 'https://clearview.cloudflareaccess.com/cdn-cgi/access/certs');
  certCalls++;
  return certsDown ? new Response('no', { status: 503 }) : new Response(JSON.stringify({ keys: published }), { status: 200 });
};

await ok(() => {
  assert.equal(accessConfig({}), null, 'unconfigured');
  assert.equal(accessConfig({ ACCESS_TEAM_DOMAIN: 'clearview' }), null, 'needs the AUD too');
  assert.equal(accessConfig({ ACCESS_TEAM_DOMAIN: 'bad host!', ACCESS_AUD: 'a'.repeat(64) }), null);
  assert.equal(accessConfig({ ACCESS_TEAM_DOMAIN: 'clearview.cloudflareaccess.com', ACCESS_AUD: 'a'.repeat(64) }).team, 'clearview', 'the full domain is accepted');
  assert.equal(accessConfig({ ...env, ACCESS_REQUIRED: '1' }).required, true);
  assert.equal(config.required, false);
});

await ok(async () => {
  clearAccessKeyCache();
  assert.deepEqual(await verifyAccessJwt(await sign(keyA, good), config, certsFetch, now), { email: 'mark@example.com' }, 'valid token; email lower-cased');
  const calls = certCalls;
  await verifyAccessJwt(await sign(keyA, good), config, certsFetch, now);
  assert.equal(certCalls, calls, 'keys are cached');

  const no = async (token, label) => assert.equal(await verifyAccessJwt(token, config, certsFetch, now), null, label);
  await no(await sign(keyA, { ...good, aud: ['b'.repeat(64)] }), 'another application');
  await no(await sign(keyA, { ...good, aud: 'x' }), 'string aud that does not match');
  await no(await sign(keyA, { ...good, iss: 'https://evil.cloudflareaccess.com' }), 'another team');
  await no(await sign(keyA, { ...good, exp: seconds - 1 }), 'expired');
  await no(await sign(keyA, { ...good, exp: undefined }), 'no expiry');
  await no(await sign(keyA, { ...good, nbf: seconds + 600 }), 'not yet valid');
  await no(await sign(keyA, { ...good, email: undefined }), 'no identity');
  await no(await sign({ ...keyB, kid: 'kid-a' }, good), 'signed by a different key under a known kid');
  await no(await sign(keyA, good, { alg: 'none' }), 'alg none');
  await no(await sign(keyA, good, { alg: 'HS256' }), 'alg confusion');
  const token = await sign(keyA, good);
  const [h, , s] = token.split('.');
  await no(`${h}.${b64url(JSON.stringify({ ...good, email: 'attacker@example.com' }))}.${s}`, 'tampered payload');
  await no('not-a-jwt', 'garbage');
  await no('', 'empty');
  await no(undefined, 'missing header');
  assert.equal(await verifyAccessJwt(token, null, certsFetch, now), null, 'no config');
});

await ok(async () => {
  clearAccessKeyCache();
  published = [keyA.jwk];
  const tokenB = await sign(keyB, good);
  assert.equal(await verifyAccessJwt(tokenB, config, certsFetch, now), null, 'unknown kid is refused after one refresh');
  published = [keyA.jwk, keyB.jwk];
  assert.deepEqual(await verifyAccessJwt(tokenB, config, certsFetch, now), { email: 'mark@example.com' }, 'a rotated-in key is picked up');
  clearAccessKeyCache();
  certsDown = true;
  const quiet = console.error; console.error = () => {};
  assert.equal(await verifyAccessJwt(await sign(keyA, good), config, certsFetch, now), null, 'certs endpoint down: fails closed');
  assert.equal(await verifyAccessJwt(await sign(keyA, good), config, async () => { throw new Error('offline'); }, now), null);
  console.error = quiet;
  certsDown = false;
  published = [keyA.jwk];
  clearAccessKeyCache();
});

// The real middleware.
const real = globalThis.fetch;
globalThis.fetch = certsFetch;
const call = (path, headers = {}, e = env) => middleware({ request: new Request(`https://windowsbyclearview.com${path}`, { headers }), env: e, next: async () => new Response('page') });
const cookie = `cv_session=${await createSessionToken(env.INTERNAL_SESSION_SECRET)}`;

await ok(async () => {
  clearAccessKeyCache();
  const token = await sign(keyA, { ...good, exp: Math.floor(Date.now() / 1000) + 3600, nbf: 0 });
  assert.equal((await call('/internal/today', { 'cf-access-jwt-assertion': token })).status, 200, 'valid Access identity: signed in, no password needed');
  const forged = await call('/internal/today', { 'cf-access-jwt-assertion': await sign(keyB, { ...good, exp: Math.floor(Date.now() / 1000) + 3600 }) });
  assert.equal(forged.status, 302, 'a forged token is just "not signed in"');
  assert.match(forged.headers.get('location'), /\/internal\/login/);
  assert.equal((await call('/internal/today', { 'cf-access-jwt-assertion': 'junk', cookie })).status, 200, 'bad token + good password session: still in (no lockout)');
  assert.equal((await call('/internal/today', { cookie })).status, 200, 'password session works while Access is optional');
  assert.equal((await call('/internal/today')).status, 302);
  assert.equal((await call('/internal/login')).status, 200, 'login page stays reachable');
});

await ok(async () => {
  clearAccessKeyCache();
  const token = await sign(keyA, { ...good, exp: Math.floor(Date.now() / 1000) + 3600, nbf: 0 });
  const strict = { ...env, ACCESS_REQUIRED: '1' };
  assert.equal((await call('/internal/today', { cookie }, strict)).status, 302, 'ACCESS_REQUIRED retires the shared password');
  assert.equal((await call('/internal/today', { 'cf-access-jwt-assertion': token }, strict)).status, 200, 'and Access still gets in');
  const off = { INTERNAL_SESSION_SECRET: env.INTERNAL_SESSION_SECRET };
  assert.equal((await call('/internal/today', { 'cf-access-jwt-assertion': token }, off)).status, 302, 'not configured: the header means nothing');
  assert.equal((await call('/internal/today', { cookie }, off)).status, 200, 'not configured: exactly the old behavior');
  // ACCESS_REQUIRED without a usable Access config must not lock everyone out.
  assert.equal((await call('/internal/today', { cookie }, { ...off, ACCESS_REQUIRED: '1' })).status, 200, 'REQUIRED alone (no team/AUD) is ignored');
});

globalThis.fetch = real;
await ok(() => {
  const mw = readFileSync(new URL('../functions/internal/_middleware.js', import.meta.url), 'utf8');
  assert.ok(mw.includes("'/internal/login', '/internal/api/login'"), 'public login paths unchanged');
  const pages = readFileSync(new URL('../src/pages/sign.astro', import.meta.url), 'utf8');
  assert.ok(pages.length > 0, 'the customer signing page lives at /sign, outside /internal, so Access never gates customers');
});
console.log(`access: ok (${groups} groups)`);
