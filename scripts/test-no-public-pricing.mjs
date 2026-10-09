// Owner direction 2026-10-09: no dollar figures anywhere on the public site. Scans the built HTML
// (run after `npm run build`) for dollar amounts and price-like per-unit/percentage claims, and
// checks the calculator's serialised model carries no prices. Internal pages are out of scope.
// Skipped with a notice if public pricing is deliberately switched back on in src/data/pricing.ts.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
assert.ok(existsSync(dist), 'dist/ not found. Run `npm run build` before `npm run test:no-public-pricing`.');

if (/export const publicPricing = true/.test(readFileSync(join(root, 'src/data/pricing.ts'), 'utf8'))) {
  console.log('publicPricing is on: nothing to check.');
  process.exit(0);
}

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'internal') continue;
      yield* htmlFiles(path);
    } else if (name.endsWith('.html')) yield path;
  }
}

const visible = (html) =>
  html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, (m) => (/ld\+json/.test(m) ? m : ' '))
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#36;|&dollar;/g, '$')
    .replace(/\s+/g, ' ');

// The terms of use cap liability at "one hundred dollars ($100)": a legal limit, not a price.
const allowed = (rel, snippet) => rel.endsWith('legal/terms.html') && /\$100\b/.test(snippet);

const moneyRe = /\$\s?\d[\d,]*(?:\.\d+)?/g;
const claimRe = /\b\d+\s?(?:-|to|–)\s?\d+\s?%\s+more\b|\bfive-figure\b|\bper square foot\b[^.]{0,20}\$/gi;
const problems = [];
let pages = 0;
for (const file of htmlFiles(dist)) {
  const rel = relative(dist, file).replace(/\\/g, '/');
  const html = readFileSync(file, 'utf8');
  pages++;
  const text = visible(html);
  for (const m of text.matchAll(moneyRe)) {
    const snippet = text.slice(Math.max(0, m.index - 30), m.index + 30);
    if (!allowed(rel, snippet)) problems.push(`${rel}: "${snippet.trim()}"`);
  }
  for (const m of text.matchAll(claimRe)) problems.push(`${rel}: price-like claim "${m[0]}"`);
  if (/"priceRange"|"minPrice"|"maxPrice"/.test(html)) problems.push(`${rel}: price in structured data`);
}
assert.ok(pages > 20, `scanned ${pages} pages`);
assert.deepEqual(problems, [], `public pages print pricing:\n${problems.join('\n')}`);

// The calculator's data-model must not leak prices through view-source.
const calc = readFileSync(join(dist, 'tools/window-replacement-cost-calculator.html'), 'utf8');
const model = /data-model="([^"]+)"/.exec(calc);
assert.ok(model, 'calculator carries its model');
const parsed = JSON.parse(model[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
assert.equal(parsed.showMoney, false, 'calculator is in funnel mode');
const leaks = JSON.stringify(parsed).match(/"(low|high|multiplier)"/g);
assert.equal(leaks, null, 'calculator model carries no price fields');
assert.ok(!/data-range-block|data-range\b/.test(calc), 'no estimated-range block is rendered');
assert.ok(calc.includes('Get my free quote'), 'funnel button points at the quote request');

console.log(`No pricing on ${pages} public pages; calculator model is price-free.`);
