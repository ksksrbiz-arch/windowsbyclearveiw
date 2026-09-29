// The Ask assistant's price table (functions/ask/_lib/pricing.mjs) is a hand-kept
// copy of src/data/pricing.ts (Pages Functions never import from src/). This fails
// when the two drift, so Ask can never quote a range that disagrees with the site
// calculator. Node loads the .ts file directly (type stripping).
import assert from 'node:assert/strict';
import { pricing } from '../src/data/pricing.ts';
import { PRICING, estimatePrice, estimateFromToolArgs, estimatePriceToolDeclaration } from '../functions/ask/_lib/pricing.mjs';

const pick = (rows, keys) => rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])));

assert.equal(PRICING.reviewedAt, pricing.basis.reviewedAt, 'reviewedAt matches the site');
assert.equal(PRICING.rounding, pricing.displayRounding, 'rounding matches the site');
assert.deepEqual(pick(PRICING.openings, ['id', 'label', 'low', 'high', 'isDoor']), pick(pricing.openings, ['id', 'label', 'low', 'high', 'isDoor']), 'openings match the site');
assert.deepEqual(pick(PRICING.materials, ['id', 'label', 'multiplier']), pick(pricing.materials, ['id', 'label', 'multiplier']), 'materials match the site');
assert.deepEqual(pick(PRICING.brands, ['id', 'label', 'low', 'high']), pick(pricing.brands, ['id', 'label', 'low', 'high']), 'brands match the site');
assert.deepEqual(PRICING.fullFrame, { low: pricing.fullFrame.low, high: pricing.fullFrame.high }, 'frame-work add-on matches the site');
assert.deepEqual(pick(PRICING.modifiers, ['id', 'label', 'perOpening', 'low', 'high']), pick(pricing.modifiers, ['id', 'label', 'perOpening', 'low', 'high']), 'modifiers match the site');

// Independent restatement of the calculator formula (CostEstimator.astro render()).
const SHARE = 0.34;
function siteRange({ lines, materialId = 'vinyl', brandId = 'cascade', modifierIds = [] }) {
  const material = pricing.materials.find((m) => m.id === materialId);
  const brand = pricing.brands.find((b) => b.id === brandId);
  let low = 0, high = 0, total = 0, windows = 0;
  for (const { openingId, quantity } of lines) {
    const o = pricing.openings.find((x) => x.id === openingId);
    low += o.low * quantity * material.multiplier;
    high += o.high * quantity * material.multiplier;
    total += quantity;
    if (!o.isDoor) windows += quantity;
  }
  low += brand.low * windows; high += brand.high * windows;
  low += pricing.fullFrame.low * total * SHARE; high += pricing.fullFrame.high * total * SHARE;
  for (const id of modifierIds) {
    const m = pricing.modifiers.find((x) => x.id === id);
    const units = m.perOpening ? total : 1;
    low += m.low * units; high += m.high * units;
  }
  const step = pricing.displayRounding;
  return { lowCents: Math.round(low / step) * step * 100, highCents: Math.round(high / step) * step * 100 };
}

const scenarios = [
  { lines: [{ openingId: 'double-hung', quantity: 5 }] },
  { lines: [{ openingId: 'slider', quantity: 2 }, { openingId: 'sliding-door', quantity: 1 }], materialId: 'fiberglass', brandId: 'milgard' },
  { lines: [{ openingId: 'picture', quantity: 3 }, { openingId: 'casement', quantity: 4 }], modifierIds: ['third-story-plus', 'trim', 'triple-pane', 'rot-repair'] },
  { lines: [{ openingId: 'bay-bow', quantity: 1 }, { openingId: 'french-door', quantity: 2 }], modifierIds: ['oversize', 'metal-removal'] },
];
for (const s of scenarios) {
  const got = estimatePrice(s);
  const want = siteRange(s);
  assert.equal(got.lowCents, want.lowCents, `low mismatch for ${JSON.stringify(s)}`);
  assert.equal(got.highCents, want.highCents, `high mismatch for ${JSON.stringify(s)}`);
}
// Known value, worked by hand: 5 double-hung vinyl = 700*5 + 800*5*.34 .. 1400*5 + 2000*5*.34 = 4,860..10,400 -> $4,850..$10,400.
const five = estimatePrice({ lines: [{ openingId: 'double-hung', quantity: 5 }] });
assert.equal(five.lowCents, 485000);
assert.equal(five.highCents, 1040000);
assert.equal(estimatePrice({ lines: [{ openingId: 'double-hung', quantity: 1 }], modifierIds: ['nope'] }).error, 'Unknown modifier "nope".');

// The estimate_price tool: what the model is told it can send must actually work.
const decl = estimatePriceToolDeclaration();
assert.equal(decl.function.name, 'estimate_price');
const props = decl.function.parameters.properties;
assert.deepEqual(props.openings.items.properties.kind.enum, pricing.openings.map((o) => o.id), 'tool opening enum = site openings');
assert.deepEqual(props.modifiers.items.enum, pricing.modifiers.map((m) => m.id), 'tool modifier enum = site modifiers');
assert.deepEqual(decl.function.parameters.required, ['openings']);
const viaTool = estimateFromToolArgs({ openings: [{ kind: 'double-hung', quantity: 5 }] });
assert.equal(viaTool.range, '$4,850 to $10,400');
assert.ok(!/insert|full[- ]frame/i.test(JSON.stringify(viaTool)), 'tool output does not name install methods');
const multi = estimateFromToolArgs({ openings: [{ kind: 'slider', quantity: 2 }, { kind: 'sliding-door', quantity: 1 }], material: 'fiberglass', brand: 'milgard', modifiers: ['trim'] });
assert.equal(multi.lowCents, siteRange({ lines: [{ openingId: 'slider', quantity: 2 }, { openingId: 'sliding-door', quantity: 1 }], materialId: 'fiberglass', brandId: 'milgard', modifierIds: ['trim'] }).lowCents);
// Bad or missing input returns an error with a hint, never a made-up price.
for (const bad of [{}, { openings: [] }, { openings: [{ kind: 'gazebo', quantity: 2 }] }, { openings: [{ kind: 'slider', quantity: 0 }] }, { openings: [{ kind: 'slider', quantity: 1 }], modifiers: ['nope'] }, { openings: [{ kind: 'slider', quantity: 1 }], material: 'wood' }]) {
  const r = estimateFromToolArgs(bad);
  assert.ok(r.error && r.hint && !r.range, `expected an error for ${JSON.stringify(bad)}`);
}

console.log('ask pricing sync: ok');
