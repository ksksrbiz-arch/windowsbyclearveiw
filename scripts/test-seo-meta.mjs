// SEO guard, run against the built site (`npm run build` first).
// - every indexable page has a title, description, and a canonical equal to its own URL
// - titles and descriptions are unique across the site
// - the area pages, /areas, /about and /gallery hit the target lengths
//   (title 50-60, description 130-155) and area H1s carry the city + "window replacement"
// - the sitemap lists only canonical, trailing-slash-free URLs that exist in the build
// - _redirects has no self-redirects or slash loops
// Other pages only need to stay at or under the SERP limits (60 / 155); KNOWN_OVER
// is the (currently empty) allowlist for any page that cannot.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
if (!existsSync(dist)) {
  console.error('dist/ not found. Run `npm run build` before `npm run test:seo`.');
  process.exit(1);
}
const ORIGIN = 'https://windowsbyclearview.com';
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// Pages allowed to exceed the SERP limits. Empty on purpose: the four that did were shortened
// 2026-10-02, so a new offender should fail rather than be added here.
const KNOWN_OVER = new Set([]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (path.endsWith('.html')) yield path;
  }
}

const pages = [];
for (const file of walk(dist)) {
  const html = readFileSync(file, 'utf8');
  let path = '/' + relative(dist, file).replace(/\\/g, '/').replace(/\.html$/, '');
  if (path === '/index') path = '/';
  if (path.startsWith('/internal') || path === '/404' || /noindex/i.test(html)) continue;
  const pick = (re) => { const m = html.match(re); return m ? decode(m[1]).trim() : ''; };
  pages.push({
    path,
    title: pick(/<title>([\s\S]*?)<\/title>/),
    description: pick(/<meta name="description" content="([^"]*)"/),
    canonical: pick(/<link rel="canonical" href="([^"]*)"/),
    ogUrl: pick(/<meta property="og:url" content="([^"]*)"/),
    ogImage: pick(/<meta property="og:image" content="([^"]*)"/),
    twitterImage: pick(/<meta name="twitter:image" content="([^"]*)"/),
    h1: pick(/<h1[^>]*>([\s\S]*?)<\/h1>/).replace(/<[^>]+>/g, '').replace(/\s+/g, ' '),
  });
}
assert.ok(pages.length > 20, `expected a full build, found ${pages.length} indexable pages`);

const problems = [];
const seenTitle = new Map();
const seenDesc = new Map();
for (const p of pages) {
  const want = ORIGIN + p.path;
  if (!p.title) problems.push(`${p.path}: missing title`);
  if (!p.description) problems.push(`${p.path}: missing description`);
  if (p.canonical !== want) problems.push(`${p.path}: canonical is "${p.canonical}", expected "${want}"`);
  if (p.ogUrl !== p.canonical) problems.push(`${p.path}: og:url differs from canonical`);
  if (!p.ogImage.startsWith('https://ogcdn.net/7d857713-e4f8-4b02-8a8e-5ecb68ada8c5/v1/')) problems.push(`${p.path}: og:image is not using the published OpenGraph.xyz Clearview template`);
  if (p.twitterImage !== p.ogImage) problems.push(`${p.path}: twitter:image differs from og:image`);
  if (seenTitle.has(p.title)) problems.push(`${p.path}: title duplicates ${seenTitle.get(p.title)}`);
  if (seenDesc.has(p.description)) problems.push(`${p.path}: description duplicates ${seenDesc.get(p.description)}`);
  seenTitle.set(p.title, p.path);
  seenDesc.set(p.description, p.path);
}

const targeted = pages.filter((p) => p.path.startsWith('/areas') || p.path === '/about' || p.path === '/gallery');
assert.ok(targeted.length >= 10, 'area pages, /areas, /about and /gallery should all be present');
for (const p of targeted) {
  if (p.title.length < 50 || p.title.length > 60) problems.push(`${p.path}: title is ${p.title.length} chars (want 50-60): ${p.title}`);
  if (p.description.length < 130 || p.description.length > 155) problems.push(`${p.path}: description is ${p.description.length} chars (want 130-155)`);
  if (/^\/areas\/.+/.test(p.path)) {
    // Vancouver is the one exception to the "in {City}" pattern: the home page already
    // owns "Window Replacement in Vancouver, WA", and two pages must not compete for it.
    const city = p.title.match(/^Window Replacement in (.+?), WA \| Clearview Windows$/) || (p.path === '/areas/vancouver' && p.title.match(/^(Vancouver), WA Window Replacement \| Clearview Windows$/));
    if (!city) problems.push(`${p.path}: title does not follow "Window Replacement in {City}, WA | Clearview Windows": ${p.title}`);
    else if (!p.h1.toLowerCase().includes(city[1].toLowerCase()) || !/window replacement/i.test(p.h1)) problems.push(`${p.path}: H1 "${p.h1}" does not carry the title's city and "window replacement"`);
    if (!/free in-home measure/i.test(p.description) || !/written estimate/i.test(p.description)) problems.push(`${p.path}: description should mention a free in-home measure and a written estimate`);
  }
}
for (const p of pages) {
  if (targeted.includes(p) || KNOWN_OVER.has(p.path)) continue;
  if (p.title.length > 60) problems.push(`${p.path}: title is ${p.title.length} chars (max 60)`);
  if (p.description.length > 155) problems.push(`${p.path}: description is ${p.description.length} chars (max 155)`);
}

// Sitemap: canonical URLs only, all of which exist.
const sitemapFile = readdirSync(dist).find((f) => /^sitemap-\d+\.xml$/.test(f));
assert.ok(sitemapFile, 'sitemap-0.xml is built');
const locs = [...readFileSync(join(dist, sitemapFile), 'utf8').matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
const canonicals = new Set(pages.map((p) => p.canonical));
for (const loc of locs) {
  if (loc !== ORIGIN + '/' && loc.endsWith('/')) problems.push(`sitemap: trailing slash on ${loc}`);
  if (!canonicals.has(loc)) problems.push(`sitemap: ${loc} is not the canonical URL of a built page`);
}
for (const c of canonicals) if (!locs.includes(c)) problems.push(`sitemap: missing ${c}`);

// _redirects: no self-redirects, no slash-only loops.
const redirects = readFileSync(join(root, 'public/_redirects'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
for (const line of redirects) {
  const [from, to] = line.split(/\s+/);
  if (from === to || from.replace(/\/$/, '') === to.replace(/\/$/, '')) problems.push(`_redirects: loop or self-redirect: ${line}`);
}
const dests = new Set(redirects.map((l) => l.split(/\s+/)[1]));
for (const line of redirects) if (dests.has(line.split(/\s+/)[0])) problems.push(`_redirects: chained redirect through ${line.split(/\s+/)[0]}`);

assert.equal(problems.length, 0, `SEO problems:\n${problems.join('\n')}`);
console.log(`seo meta: ok (${pages.length} pages, ${locs.length} sitemap URLs)`);
