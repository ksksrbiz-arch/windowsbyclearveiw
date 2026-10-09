/**
 * Validate the pricing the built site actually serves, and warn when it is
 * overdue for a human look.
 *
 * The calculator serialises its whole pricing model into a data attribute, so
 * the built page carries exactly the document the estimator prices from. That
 * makes this a check on shipped behaviour rather than on source that might not
 * reach the page.
 *
 * Exit codes: 0 pass (possibly with warnings), 1 the shipped pricing is wrong.
 */
import fs from 'node:fs';
import { validatePricing } from '../../shared/pricing-schema.mjs';

// astro.config.mjs builds with `format: 'file'`, so the page is `<route>.html`; the
// directory form is kept as a fallback in case that setting ever changes.
const CANDIDATES = [
  'dist/tools/window-replacement-cost-calculator.html',
  'dist/tools/window-replacement-cost-calculator/index.html',
];
const PAGE = CANDIDATES.find((path) => fs.existsSync(path));

if (!PAGE) {
  console.log(`::error::Calculator page not found (looked for ${CANDIDATES.join(' or ')}) — did the build run?`);
  process.exit(1);
}

const html = fs.readFileSync(PAGE, 'utf8');
const match = /data-model="([^"]+)"/.exec(html);
if (!match) {
  console.log('::error::No pricing model found in the built calculator page.');
  process.exit(1);
}

const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

let model;
try {
  model = JSON.parse(decode(match[1]));
} catch (error) {
  console.log(`::error::Pricing model is not valid JSON: ${error.message}`);
  process.exit(1);
}

if (model.showMoney === false) {
  // Owner direction 2026-10-09: no public prices. The page must ship none; the figures live only in
  // src/data/pricing.ts as the internal reference (the Command Center quote builder), so check those.
  const leak = JSON.stringify(model).match(/"(low|high|multiplier)"/g);
  if (leak) {
    console.log('::error::Public pricing is off but the calculator page still carries price fields.');
    process.exit(1);
  }
  const { pricing } = await import('../../src/data/pricing.ts');
  const internal = validatePricing({
    basis: pricing.basis,
    displayRounding: pricing.displayRounding,
    openings: pricing.openings,
    materials: pricing.materials,
    brands: pricing.brands,
    fullFrame: pricing.fullFrame,
    modifiers: pricing.modifiers,
  });
  console.log('public pricing off  calculator ships no price fields');
  console.log(`internal reviewed   ${pricing.basis.reviewedAt} (${internal.ageDays} days ago)`);
  for (const warning of internal.warnings) console.log(`::warning::${warning}`);
  if (!internal.ok) {
    for (const problem of internal.problems) console.log(`::error::${problem}`);
    process.exit(1);
  }
  console.log('Internal reference pricing is structurally valid.');
  process.exit(0);
}

const doc = {
  basis: {
    source: model.isAverage ? 'averages' : 'clearview',
    reviewedAt: model.reviewedAt,
    maxAgeDays: 180,
  },
  displayRounding: model.rounding,
  openings: model.openings,
  materials: model.materials,
  brands: model.brands,
  fullFrame: model.fullFrame, // absent from the shipped model since 2026-10-02; optional in the schema
  modifiers: model.modifiers,
};

const result = validatePricing(doc);

console.log(`source     ${doc.basis.source}`);
console.log(`reviewed   ${doc.basis.reviewedAt} (${result.ageDays} days ago)`);
console.log(`openings   ${model.openings.length}`);
console.log(`materials  ${model.materials.map((m) => m.id).join(', ')}`);

for (const warning of result.warnings) console.log(`::warning::${warning}`);

if (!result.ok) {
  for (const problem of result.problems) console.log(`::error::${problem}`);
  process.exit(1);
}

console.log('Shipped pricing is structurally valid.');
