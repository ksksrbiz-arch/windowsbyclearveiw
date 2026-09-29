// Kept in sync with src/data/pricing.ts BY HAND (npm run test:ask-pricing fails on drift) — Pages Functions in this
// repo never import from src/ (see functions/api/estimate.js). This is the
// same numbers, same formula, as the public cost calculator
// (src/components/CostEstimator.astro) — the chatbot's price tool must
// never produce a number that disagrees with the page a visitor can see
// right next to it.
export const PRICING = {
  reviewedAt: '2026-09-26',
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
  fullFrame: { low: 800, high: 2000 },
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
 * a fixed share of openings (0.34) assumed to need extra frame-level work,
 * then flat modifiers. Returns null on unrecognized ids rather than
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

  // Same single-range assumption as CostEstimator.astro (FRAME_WORK_SHARE).
  const FRAME_WORK_SHARE = 0.34;
  low += PRICING.fullFrame.low * totalOpenings * FRAME_WORK_SHARE;
  high += PRICING.fullFrame.high * totalOpenings * FRAME_WORK_SHARE;

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
