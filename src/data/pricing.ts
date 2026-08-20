/**
 * Pricing for the cost estimator.
 *
 * ── What these numbers currently are ────────────────────────────────────────
 * Published Washington / Portland-metro averages from industry cost guides —
 * NOT Mark's own pricing. The site says so plainly wherever a figure appears,
 * because quoting somebody else's average as if it were ours would be the same
 * dishonesty as inventing reviews.
 *
 * ── Replacing them with Mark's real numbers ─────────────────────────────────
 * Change the figures below, set `basis.source` to 'clearveiw', and update
 * `basis.reviewedAt`. That is the whole job — nothing else in the codebase
 * knows about money. The estimator copy switches automatically.
 *
 * Every opening figure is INSTALLED cost per opening: unit, labour, and normal
 * finish work, for a standard-size ground-floor opening, in vinyl, as an insert.
 * Fiberglass, full-frame, upstairs access, and custom shapes are modifiers
 * further down — never bake them into the baseline or they double-count.
 */

export type PricingBasis = {
  /** 'averages' = regional published data. 'clearveiw' = Mark's own numbers. */
  source: 'averages' | 'clearveiw';
  region: string;
  /** ISO date the figures were last checked against reality. */
  reviewedAt: string;
  /** Flagged as stale past this age; the pricing worker emails a reminder. */
  maxAgeDays: number;
  notes: string;
};

export type OpeningType = {
  id: string;
  label: string;
  blurb: string;
  low: number;
  high: number;
};

export const pricing = {
  basis: {
    source: 'averages',
    region: 'Washington / Portland metro',
    reviewedAt: '2026-08-20',
    maxAgeDays: 180,
    notes:
      'Compiled from published 2026 Washington and Portland-metro window cost guides. ' +
      'Replace with Clearveiw pricing when available.',
  } satisfies PricingBasis,

  /** Rounded on the way out so a range never reads as a promise. */
  displayRounding: 50,

  openings: [
    {
      id: 'slider',
      label: 'Slider',
      blurb: 'Two sashes, one slides sideways past the other.',
      low: 525,
      high: 950,
    },
    {
      id: 'double-hung',
      label: 'Double-hung',
      blurb: 'Top and bottom sash both move. Usually tilts in to clean.',
      low: 575,
      high: 1050,
    },
    {
      id: 'single-hung',
      label: 'Single-hung',
      blurb: 'Only the bottom sash moves. The top half is fixed.',
      low: 475,
      high: 875,
    },
    {
      id: 'picture',
      label: 'Picture / fixed',
      blurb: 'Does not open. Just glass in a frame.',
      low: 525,
      high: 1000,
    },
    {
      id: 'casement',
      label: 'Casement',
      blurb: 'Hinged at the side, cranks outward.',
      low: 650,
      high: 1200,
    },
    {
      id: 'awning',
      label: 'Awning',
      blurb: 'Hinged at the top, cranks out from the bottom.',
      low: 600,
      high: 1125,
    },
    {
      id: 'bay-bow',
      label: 'Bay or bow',
      blurb: 'Projects out from the wall. Its own framing and roof work.',
      low: 2200,
      high: 5500,
    },
  ] satisfies OpeningType[],

  /** Multiplied against the baseline. Vinyl is the baseline, so it is 1. */
  materials: [
    {
      id: 'vinyl',
      label: 'Vinyl',
      blurb: 'The usual choice in Clark County. Good value, low upkeep.',
      multiplier: 1,
    },
    {
      id: 'fiberglass',
      label: 'Fiberglass',
      blurb: 'Stiffer, holds paint, costs more. Worth it on big openings.',
      multiplier: 1.3,
    },
  ],

  /** Added per opening that has to come out to the rough framing. */
  fullFrame: {
    label: 'Full-frame replacement',
    blurb: 'Frame and all comes out. Needed when the frame is rotten or out of square.',
    low: 300,
    high: 650,
  },

  modifiers: [
    {
      id: 'second-story',
      label: 'Second-story openings',
      blurb: 'Ladders, staging, and a slower set.',
      perOpening: true,
      low: 75,
      high: 175,
    },
    {
      id: 'oversize',
      label: 'Oversize or custom shapes',
      blurb: 'Arches, transoms, and anything past standard sizing.',
      perOpening: true,
      low: 150,
      high: 450,
    },
    {
      id: 'rot-repair',
      label: 'Suspected rot at the sills',
      blurb: 'Soft wood means opening the wall. Priced properly once we see it.',
      perOpening: false,
      // Deliberately zero. Rot cannot be priced from a checkbox, so this is a
      // flag on the lead rather than a number in the range.
      low: 0,
      high: 0,
    },
    {
      id: 'trim',
      label: 'New interior or exterior trim',
      blurb: 'Wrapping, casing, or matching an existing profile.',
      perOpening: true,
      low: 75,
      high: 250,
    },
  ],
} as const;

export type PricingModifier = (typeof pricing.modifiers)[number];
export type PricingMaterial = (typeof pricing.materials)[number];

/** Opening types we can actually price. Anything unpriced is hidden, never
 *  silently counted as $0 — that would quietly under-quote a whole job. */
export function pricedOpenings() {
  return pricing.openings.filter((opening) => opening.low > 0 && opening.high >= opening.low);
}

export function pricingIsUsable() {
  return pricedOpenings().length > 0 && pricing.fullFrame.high > 0;
}

/** True while the figures are somebody else's averages rather than Mark's. */
export function pricingIsRegionalAverage() {
  return pricing.basis.source === 'averages';
}

export function pricingAgeDays(now = new Date()) {
  const reviewed = new Date(`${pricing.basis.reviewedAt}T00:00:00Z`);
  if (Number.isNaN(reviewed.getTime())) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - reviewed.getTime()) / 86_400_000);
}

export function pricingIsStale(now = new Date()) {
  return pricingAgeDays(now) > pricing.basis.maxAgeDays;
}
