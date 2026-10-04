// Post-deploy check for the Command Center PWA's public files, against the live site.
// Usage: npm run check:pwa-live            (https://windowsbyclearview.com)
//        npm run check:pwa-live -- https://<preview>.pages.dev
// Not part of test:all: it needs the network and a finished deploy. Run it after every deploy that touches the PWA, and any time
// Cloudflare Access settings change. A service worker script and a web app manifest cannot follow a redirect, so if Cloudflare
// Access (or anything else) answers these with a 302 to a sign-in page, install, offline and updates silently stop working.
// That happened on 2026-10-04 when Access began gating /internal* by prefix and the files were still named /internal-*.
import assert from 'node:assert/strict';

const origin = (process.argv[2] || 'https://windowsbyclearview.com').replace(/\/+$/, '');
let failures = 0;

// `sameSiteRedirectOk`: Cloudflare Pages answers /x.html with a 308 to /x. That is fine for the offline page (the worker fetches it with
// redirects followed and stores a clean copy) but never for the worker script or the manifest, which must answer directly.
async function check(name, path, verify, { sameSiteRedirectOk = false } = {}) {
  try {
    let response = await fetch(origin + path, { redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      const target = new URL(response.headers.get('location') || '', origin + path);
      if (sameSiteRedirectOk && target.origin === origin && !/cloudflareaccess/.test(target.host)) {
        response = await fetch(target, { redirect: 'manual' });
      } else {
        throw new Error(`${response.status} redirect to ${target.href.slice(0, 70)}... A worker or manifest cannot follow a redirect. Is Cloudflare Access (or a redirect rule) covering ${path}?`);
      }
    }
    if (response.status >= 300 && response.status < 400) throw new Error(`${response.status} redirect again from ${path}`);
    assert.equal(response.status, 200, `expected 200, got ${response.status}`);
    await verify(response, await response.text());
    console.log(`ok   ${name}  ${path}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}  ${path}\n     ${error.message}`);
  }
}

await check('worker', '/ops-sw.js', (res, body) => {
  assert.match(res.headers.get('content-type') || '', /javascript/, 'content-type must be JavaScript');
  const id = /const BUILD_ID = '([^']+)'/.exec(body);
  assert.ok(id, 'worker has no BUILD_ID');
  assert.notEqual(id[1], '__BUILD_ID__', 'worker was never stamped with a build id (astro.config.mjs hook)');
  assert.match(id[1], /^\d{10,}-\S+$/, `unexpected build id ${id[1]}`);
  console.log(`     build ${id[1]}`);
});

await check('manifest', '/ops.webmanifest', (res, body) => {
  assert.match(res.headers.get('content-type') || '', /json/, 'content-type must be JSON');
  const manifest = JSON.parse(body);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, '/internal');
  assert.ok(new URL(manifest.start_url, origin).pathname.startsWith(manifest.scope), 'start_url inside scope');
  assert.ok(manifest.icons?.length >= 3, 'icons');
});

await check('offline page', '/ops-offline.html', (res, body) => {
  assert.match(res.headers.get('content-type') || '', /html/);
  assert.match(body, /You're offline/);
}, { sameSiteRedirectOk: true });

await check('icons are public', '/icon-192.png', (res) => {
  assert.match(res.headers.get('content-type') || '', /image\/png/);
});

// The app itself must stay behind its sign-in: a 302 from /internal is the expected, healthy answer.
try {
  const gate = await fetch(`${origin}/internal/today`, { redirect: 'manual' });
  assert.ok(gate.status >= 300 && gate.status < 400, `/internal/today answered ${gate.status} to an anonymous visitor; it must redirect to a sign-in`);
  console.log(`ok   app is gated  /internal/today -> ${gate.status}`);
} catch (error) {
  failures += 1;
  console.error(`FAIL app is gated\n     ${error.message}`);
}

if (failures) {
  console.error(`\n${failures} check(s) failed against ${origin}.`);
  process.exit(1);
}
console.log(`\nCommand Center PWA files are public and healthy on ${origin}.`);
