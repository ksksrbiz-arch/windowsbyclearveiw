// Guards the /siding page against invented business facts and broken wiring. Runs against the built
// site (`npm run build` first). Owner direction 2026-10-04: fiber cement lap and board and batten,
// primarily James Hardie, plus LP products such as SmartSide board and other wood siding products.
// The page states no price, warranty, certification, timeline or crew claim, and shows no siding
// gallery until real siding-job photos exist.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
assert.ok(existsSync(dist), 'dist/ not found. Run `npm run build` before `npm run test:siding`.');

const read = (rel) => readFileSync(join(dist, rel), 'utf8');
const visible = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/\s+/g, ' ');

const html = read('siding.html');
const text = visible(html);

// The owner's materials are all named.
for (const phrase of ['James Hardie', 'fiber cement', 'board and batten', 'LP SmartSide', 'wood siding']) {
  assert.ok(text.includes(phrase), `siding page names "${phrase}"`);
}

// Nothing the owner has not supplied.
const invented = [
  [/\$\s?\d/, 'a price'],
  [/warrant/i, 'a warranty'],
  [/guarantee/i, 'a guarantee'],
  [/lifetime/i, 'a lifetime claim'],
  [/certified|certification|authorized|preferred (?:installer|contractor)/i, 'a certification claim'],
  [/colorplus|hardie ?zone|hardie ?plank/i, 'a product line the owner did not name'],
  [/\b\d+\s*(?:years?|decades?)\b/i, 'a years claim'],
  [/\bMark\b/, 'a personal name'],
  [/\b(?:our|the) (?:crew|team|installers)\b/i, 'a crew or team claim'],
];
for (const [re, label] of invented) assert.ok(!re.test(text), `siding page must not state ${label}`);

// No siding gallery: the only photo is the hero, and it is labelled as a window job.
assert.ok(!/work-grid/.test(html), 'no gallery grid until real siding photos exist');
assert.ok(text.includes('a window install on lap siding'), 'hero photo credit says it is a window job');

// Permit claims are limited to the four departments whose published pages say so.
for (const place of ['Clark County', 'Camas', 'Battle Ground', 'Ridgefield']) {
  assert.ok(text.includes(place), `permit section covers ${place}`);
}
assert.ok(/Vancouver, Washougal, Woodland and La Center, have their own rules/.test(text), 'unverified cities are deferred to the building department');

// The CTA tags the request so siding leads can be counted for the 90-day review.
assert.ok(html.includes('/estimate?scope=House%20siding'), 'estimate link carries the House siding scope');
assert.ok(readFileSync(join(root, 'src/components/EstimateForm.astro'), 'utf8').includes("params.get('scope')") || readFileSync(join(root, 'src/components/EstimateForm.astro'), 'utf8').includes("params.has('scope')"), 'estimate form reads the scope param');

// Structured data: a Service with the eight areas, and the FAQ.
const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const nodes = ld.flatMap((doc) => doc['@graph'] || [doc]);
const service = nodes.find((n) => n['@type'] === 'Service' && n.serviceType === 'Siding installation');
assert.ok(service, 'Service JSON-LD present');
assert.equal(service.areaServed.length, 8, 'service lists all eight areas');
assert.ok(!('offers' in service), 'no price/offer in the Service schema');
assert.ok(nodes.some((n) => n['@type'] === 'FAQPage'), 'FAQPage JSON-LD present');

// Discoverability: footer on every page, home page, replacement page, all city pages, sitemap.
assert.ok(/href="\/siding"/.test(read('index.html')), 'home page links to /siding');
assert.ok(/href="\/siding"/.test(read('replacement.html')), 'replacement page links to /siding');
const cities = readdirSync(join(dist, 'areas')).filter((f) => f.endsWith('.html'));
assert.equal(cities.length, 8, 'eight city pages built');
for (const f of cities) assert.ok(/href="\/siding"/.test(read(`areas/${f}`)), `areas/${f} links to /siding`);
assert.ok(/href="\/siding"/.test(read('about.html')), 'footer links to /siding');
const sitemap = readFileSync(join(dist, readdirSync(dist).find((f) => /^sitemap-\d+\.xml$/.test(f))), 'utf8');
assert.ok(sitemap.includes('https://windowsbyclearview.com/siding<'), 'sitemap lists /siding');

// The city links on the page resolve to built city pages.
for (const href of [...html.matchAll(/href="(\/areas\/[a-z-]+)"/g)].map((m) => m[1])) {
  assert.ok(existsSync(join(dist, `${href}.html`)), `${href} exists`);
}

console.log('siding page: ok');
