// Kept in sync with src/data/pricing.ts BY HAND (npm run test:ask-pricing fails on drift) — Pages Functions in this
// repo never import from src/ (see functions/api/estimate.js). This is the
// same numbers, same formula, as the public cost calculator
// (src/components/CostEstimator.astro) — the chatbot's price tool must
// never produce a number that disagrees with the page a visitor can see
// right next to it.
export const PRICING = {
  reviewedAt: '2026-10-02',
  rounding: 50,
  openings: [
    { id: 'slider', label: 'Slider', low: 600, high: 1400 },
    { id: 'double-hung', label: 'Double-hung', low: 700, high: 1400 },
    { id: 'single-hung', label: 'Single-hung', low: 700, high: 1400 },
    { id: 'picture', label: 'Picture / fixed', low: 600, high: 1500 },
    { id: 'casement', label: 'Casement', low: 700, high: 1500 },
    { id: 'awning', label: 'Awning', low: 800, high: 1500 },
    { id: 'bay-bow', label: 'Bay or bow', low: 800, high: 1500 },
    { id: 'sliding-door', label: 'Sliding patio door', low: 1800, high: 2800, isDoor: true },
    { id: 'french-door', label: 'French door', low: 3000, high: 5000, isDoor: true },
  ],
  materials: [
    { id: 'vinyl', label: 'Vinyl', multiplier: 1 },
    { id: 'fiberglass', label: 'Fiberglass', multiplier: 1.4 },
  ],
  brands: [
    { id: 'cascade', label: 'Cascade', low: 0, high: 0 },
    { id: 'milgard', label: 'Milgard', low: 100, high: 100 },
  ],
  modifiers: [
    { id: 'third-story-plus', label: 'Third story or higher', perOpening: true, low: 100, high: 200 },
    { id: 'oversize', label: 'Oversize or custom shapes', perOpening: true, low: 150, high: 450 },
    { id: 'rot-repair', label: 'Suspected rot at the sills', perOpening: false, low: 0, high: 0 },
    { id: 'trim', label: 'New interior or exterior trim', perOpening: true, low: 150, high: 150 },
    { id: 'triple-pane', label: 'Triple-pane glass', perOpening: true, low: 200, high: 200 },
    { id: 'metal-removal', label: 'Removing old metal-frame windows', perOpening: true, low: 150, high: 150 },
  ],
};

function round(value, step) {
  return Math.round(value / step) * step;
}

/**
 * Same formula as CostEstimator.astro's render(): per-opening range times
 * material multiplier, brand adder on window (not door) openings only,
 * then flat modifiers. No allowance for extra work is added (owner direction,
 * 2026-10-02): the range is the base opening prices plus the chosen modifiers. Returns null on unrecognized ids rather than
 * silently pricing at zero — a wrong id undercounting a job is worse than
 * a tool call that visibly failed.
 */
export function estimatePrice({ lines, materialId = 'vinyl', brandId = 'cascade', modifierIds = [] }) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { error: 'At least one opening with a type and quantity is required.' };
  }

  const material = PRICING.materials.find((m) => m.id === materialId);
  if (!material) return { error: `Unknown material "${materialId}".` };
  const brand = PRICING.brands.find((b) => b.id === brandId) || PRICING.brands[0];

  let low = 0;
  let high = 0;
  let totalOpenings = 0;
  let windowOpenings = 0;
  const scopeParts = [];

  for (const line of lines) {
    const opening = PRICING.openings.find((o) => o.id === line.openingId);
    const qty = Math.max(0, Math.round(Number(line.quantity) || 0));
    if (!opening) return { error: `Unknown opening type "${line.openingId}".` };
    if (qty <= 0) continue;

    low += opening.low * qty * material.multiplier;
    high += opening.high * qty * material.multiplier;
    totalOpenings += qty;
    if (!opening.isDoor) windowOpenings += qty;
    scopeParts.push(`${qty}× ${opening.label}`);
  }

  if (totalOpenings === 0) return { error: 'Every line had a quantity of zero.' };

  low += brand.low * windowOpenings;
  high += brand.high * windowOpenings;

  const appliedModifiers = [];
  for (const id of modifierIds) {
    const modifier = PRICING.modifiers.find((m) => m.id === id);
    if (!modifier) return { error: `Unknown modifier "${id}".` };
    const units = modifier.perOpening ? totalOpenings : 1;
    low += modifier.low * units;
    high += modifier.high * units;
    appliedModifiers.push(modifier.label);
  }

  return {
    lowCents: round(low, PRICING.rounding) * 100,
    highCents: round(high, PRICING.rounding) * 100,
    scope: `${scopeParts.join(', ')} — ${material.label.toLowerCase()}${brand.id !== PRICING.brands[0].id ? `, ${brand.label}` : ''}`,
    appliedModifiers,
    basedOn: 'Clearview\'s own published pricing model (same as /tools/window-replacement-cost-calculator), reviewed ' + PRICING.reviewedAt,
  };
}

// ---------------------------------------------------------------------------
// The `estimate_price` tool the Ask model calls. The tool declaration and the
// adapter live here, next to PRICING, so the enums the model sees can never
// drift from the table. (The declaration used to describe a coarse
// openings/home_type/complexity input that estimatePrice() no longer accepts,
// so every call returned "At least one opening ... is required".)

const dollars = (cents) => `$${(cents / 100).toLocaleString('en-US')}`;

export function estimatePriceToolDeclaration() {
  return {
    type: 'function',
    function: {
      name: 'estimate_price',
      description:
        'Calculate a planning-level Clearview price RANGE from the same model as the site cost calculator. ' +
        'Use only when the visitor asks what it would cost AND has said what is being replaced (window or door types and how many of each). ' +
        'If counts are missing, ask for them instead of guessing. The result is a range, never a quote or an exact total.',
      parameters: {
        type: 'object',
        properties: {
          openings: {
            type: 'array',
            description: 'One entry per opening type, with how many of that type.',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: PRICING.openings.map((o) => o.id), description: PRICING.openings.map((o) => `${o.id} = ${o.label}`).join('; ') },
                quantity: { type: 'integer', minimum: 1, maximum: 100 },
              },
              required: ['kind', 'quantity'],
            },
          },
          material: { type: 'string', enum: PRICING.materials.map((m) => m.id), description: 'Defaults to vinyl.' },
          brand: { type: 'string', enum: PRICING.brands.map((b) => b.id), description: 'Window line. Defaults to cascade.' },
          modifiers: {
            type: 'array',
            description: 'Only conditions the visitor actually mentioned.',
            items: { type: 'string', enum: PRICING.modifiers.map((m) => m.id), description: PRICING.modifiers.map((m) => `${m.id} = ${m.label}`).join('; ') },
          },
        },
        required: ['openings'],
      },
    },
  };
}

/** Maps the model's tool arguments onto estimatePrice() and shapes a reply the model can quote. */
export function estimateFromToolArgs(args = {}) {
  const openings = Array.isArray(args?.openings) ? args.openings : [];
  const result = estimatePrice({
    lines: openings.map((o) => ({ openingId: o?.kind, quantity: o?.quantity })),
    materialId: args?.material || 'vinyl',
    brandId: args?.brand || 'cascade',
    modifierIds: Array.isArray(args?.modifiers) ? args.modifiers : [],
  });
  if (result.error) {
    return { error: result.error, hint: 'Ask the visitor for the missing detail (opening types and counts); do not guess a price.' };
  }
  return {
    range: `${dollars(result.lowCents)} to ${dollars(result.highCents)}`,
    lowCents: result.lowCents,
    highCents: result.highCents,
    scope: result.scope,
    appliedModifiers: result.appliedModifiers,
    basedOn: result.basedOn,
    note: 'Planning range only, not a quote. The written estimate after a free in-home measure sets the real number. Do not describe install methods.',
  };
}
