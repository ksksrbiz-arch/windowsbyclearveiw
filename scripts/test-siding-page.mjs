// Guards the /siding page against invented business facts and broken wiring. Runs against the built
// site (`npm run build` first). Owner direction 2026-10-04: fiber cement lap and board and batten,
// primarily James Hardie, plus LP products such as SmartSide board and other wood siding products.
// Owner-provided 2026-10-04: labor starts at $2/sq ft (new construction), $3/sq ft (existing home),
// board and batten $3/sq ft new construction and $4/sq ft existing home, cedar $4/sq ft, all per
// square foot of total wall area (height times width); tear-off and new plywood $2/sq ft; significant suspected
// dry rot adds $1,500 to $3,000 in labor depending on severity; siding material is separate; the warranty is the manufacturer's: 30 years
// for James Hardie siding (its own product pages say "a 30-year non-prorated limited ... warranty"; the owner
// said to use the sheet's number), and no term stated for any other manufacturer.
// The page states no certification, Clearview workmanship warranty, timeline or crew claim, and
// shows only the owner's real siding-job photos (captions describe what is visible).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

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
  [/guarantee/i, 'a guarantee'],
  [/lifetime/i, 'a lifetime claim'],
  [/\bour (?:own )?(?:workmanship )?warranty|we warrant/i, 'a Clearview warranty'],
  [/certified|certification|authorized|preferred (?:installer|contractor)/i, 'a certification claim'],
  [/colorplus|hardie ?zone|hardie ?plank/i, 'a product line the owner did not name'],
  [/\bMark\b/, 'a personal name'],
  [/\b(?:our|the) (?:crew|team|installers)\b/i, 'a crew or team claim'],
];
for (const [re, label] of invented) assert.ok(!re.test(text), `siding page must not state ${label}`);

// Prices: exactly the owner's three labor rates, labelled as labor, material separate, starting rates.
const ratesSource = stripTypeScriptTypes(readFileSync(join(root, 'src/data/siding.ts'), 'utf8'));
const rates = (await import(`data:text/javascript,${encodeURIComponent(ratesSource)}`)).sidingLabor;
assert.deepEqual(rates, { newConstruction: 2, existingHome: 3, boardAndBattenNewConstruction: 3, boardAndBattenExistingHome: 4, cedar: 4, tearOffPlywood: 2 }, "rates match the owner's figures");
const dryRotSource = stripTypeScriptTypes(readFileSync(join(root, 'src/data/siding.ts'), 'utf8'));
const dryRot = (await import(`data:text/javascript,${encodeURIComponent(dryRotSource)}`)).sidingDryRot;
assert.deepEqual(dryRot, { low: 1500, high: 3000 }, "dry-rot range matches the owner's figures");
assert.deepEqual([...new Set([...text.matchAll(/\$\s?(\d+(?:,\d{3})*(?:\.\d+)?)/g)].map((m) => m[1]))].sort(), ['1,500', '2', '3', '3,000', '4'], 'only the owner figures appear');
for (const [label, line] of [
  ['New construction', 'Labor starts at $2 per square foot'],
  ['Existing home', 'Labor starts at $3 per square foot'],
  ['Board and batten, new construction', 'Labor starts at $3 per square foot'],
  ['Board and batten, existing home', 'Labor starts at $4 per square foot'],
  ['Cedar siding', 'Labor starts at $4 per square foot on any job'],
  ['Tear-off and new plywood', 'Labor is $2 per square foot'],
  ['Dry rot', 'Adds $1,500 to $3,000 in labor, depending on severity'],
]) {
  assert.ok(text.includes(`${label} ${line}`), `${label}: "${line}"`);
}
assert.ok(/A square foot is total wall area: height times width/.test(text), 'square foot is defined as total wall area');
assert.ok(/siding itself is a separate cost/.test(text) && /not a quote/.test(text), 'material is separate and the rates are starting rates, not a quote');
assert.ok(!/\$\d+[^.]*\binstalled\b/i.test(text.replace(/installed to the manufacturer/g, '')), 'rates are never called installed prices');

// Warranty: the manufacturer's. The only length on the page is James Hardie's own 30 years (a year count
// anywhere else, or a different one, is an invented claim); other manufacturers' terms are theirs.
const yearClaims = [...text.matchAll(/\b\d+[\s-]*(?:years?|yrs?|decades?)\b/gi)];
assert.ok(yearClaims.length >= 2, 'the 30 years appears (warranty section and FAQ)');
for (const match of yearClaims) {
  assert.match(match[0].replace(/\s+/g, '-'), /^30-years?$/i, `the only year count on the page is James Hardie's 30: "${match[0]}"`);
  assert.ok(/James Hardie/.test(text.slice(Math.max(0, match.index - 70), match.index + 70)), 'and it is always attributed to James Hardie');
}
assert.ok(/30-year limited (?:manufacturer's )?warranty when the product is bought, as long as it is installed to the manufacturer's specifications/.test(text), "James Hardie's warranty and its installation condition are stated as given");
assert.ok(/Most other siding products come with a manufacturer's warranty on the same condition/.test(text), 'other products: a manufacturer warranty on the same condition, no length');
assert.ok(/Other manufacturers set their own length and terms/.test(text), "other manufacturers' terms are left to them");

// Windows on a siding job are offered only on request.
assert.ok(/We can, if you ask/.test(text) && /Can you replace windows during a siding job\?/.test(text), 'windows-on-request stated');

// Photos: the four owner-supplied siding jobs, in the page and in the gallery. No metadata, and the
// blurred street number / cropped person are guarded by the source files' dimensions and EXIF.
const sidingPhotos = ['siding-brick-wall-panels', 'siding-garage-house-wrap', 'siding-garage-vertical-wood', 'siding-two-story-panels'];
for (const alt of ['Two-story house with large tan wall panels', 'Single-story brick building with new black-framed windows', 'Long garage-style building wrapped in white house wrap', 'The same building with vertical wood siding panels']) {
  assert.ok(html.includes(alt), `siding page renders the photo "${alt}"`);
}
const gallery = visible(read('gallery.html'));
assert.ok(/Siding jobs, some photographed mid-job/.test(gallery), 'gallery has a siding group');
for (const id of sidingPhotos) {
  const file = join(root, `src/assets/work/${id}.jpg`);
  assert.ok(existsSync(file), `${id}.jpg exists`);
  const bytes = readFileSync(file);
  assert.ok(!bytes.includes(Buffer.from('Exif\0\0')), `${id}.jpg carries no EXIF (dates, GPS, device)`);
}
assert.ok(text.includes('Clearview job photo — siding and black-framed windows'), 'hero credit describes the siding photo');

// Permit claims are limited to the four departments whose published pages say so.
for (const place of ['Clark County', 'Camas', 'Battle Ground', 'Ridgefield']) {
  assert.ok(text.includes(place), `permit section covers ${place}`);
}
assert.ok(/Vancouver, Washougal, Woodland and La Center, have their own rules/.test(text), 'unverified cities are deferred to the building department');

// The CTA tags the request so siding leads can be counted for the 90-day review.
assert.ok(html.includes('/estimate?service=siding&amp;scope=House%20siding') || html.includes('/estimate?service=siding&scope=House%20siding'), 'estimate link carries the siding service and the House siding scope');
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
for (const page of ['index.html', 'about.html', 'replacement.html', 'siding.html']) {
  assert.match(read(page), /<nav class="nav"[^>]*>[\s\S]*?<a href="\/siding"[^>]*>Siding<\/a>/, `the primary nav links to /siding on ${page}`);
}
// (The current-page highlight is applied in the browser; it was checked there, not in the static HTML.)
const sitemap = readFileSync(join(dist, readdirSync(dist).find((f) => /^sitemap-\d+\.xml$/.test(f))), 'utf8');
assert.ok(sitemap.includes('https://windowsbyclearview.com/siding<'), 'sitemap lists /siding');

// The city links on the page resolve to built city pages.
for (const href of [...html.matchAll(/href="(\/areas\/[a-z-]+)"/g)].map((m) => m[1])) {
  assert.ok(existsSync(join(dist, `${href}.html`)), `${href} exists`);
}

console.log('siding page: ok');
