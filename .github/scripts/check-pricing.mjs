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

const PAGE = 'dist/tools/window-replacement-cost-calculator/index.html';

if (!fs.existsSync(PAGE)) {
  console.log(`::error::${PAGE} not found — did the build run?`);
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
  fullFrame: model.fullFrame,
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
