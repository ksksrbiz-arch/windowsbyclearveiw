/**
 * Pricing for the cost estimator.
 *
 * ── What these numbers are ──────────────────────────────────────────────────
 * Mark's own installed pricing, as of `basis.reviewedAt` below. The one
 * exception is the "oversize or custom shapes" modifier, which is still the
 * regional average — Mark hasn't priced that one himself yet, and its own
 * blurb says so. Everything else on this page is his real number.
 *
 * ── Keeping them current ─────────────────────────────────────────────────────
 * Change the figures below and update `basis.reviewedAt`. That is the whole
 * job — nothing else in the codebase knows about money. If the numbers ever
 * go back to being someone else's averages instead of Mark's, set
 * `basis.source` back to 'averages' and the estimator copy switches itself.
 *
 * Every opening figure is INSTALLED cost per opening: unit, labour, and a
 * block install (no trim, just re-caulk), for a standard-size ground-floor
 * opening, in vinyl, as an insert. Fiberglass, full-frame, upper-floor access,
 * custom shapes, and trim are modifiers further down — never bake them into
 * the baseline or they double-count.
 */

export type PricingBasis = {
  /** 'averages' = regional published data. 'clearview' = Mark's own numbers. */
  source: 'averages' | 'clearview';
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
  /** True for door-type openings (patio, French). The window-brand choice
   *  below does not apply to these — Cascade/Milgard is a window line. */
  isDoor?: boolean;
};

export type WindowBrand = {
  id: string;
  label: string;
  blurb: string;
  /** Added per WINDOW opening (not doors) on top of everything else. */
  low: number;
  high: number;
};

export const pricing = {
  basis: {
    source: 'clearview',
    region: 'Washington / Portland metro',
    reviewedAt: '2026-08-21',
    maxAgeDays: 180,
    notes:
      "Mark's own installed pricing, given directly for this site. The oversize/custom-shape " +
      'modifier is still the regional average until he has a firm number for it — see that line.',
  } satisfies PricingBasis,

  /** Rounded on the way out so a range never reads as a promise. */
  displayRounding: 50,

  openings: [
    {
      id: 'slider',
      label: 'Slider',
      blurb: 'Two sashes, one slides sideways past the other.',
      low: 1000,
      high: 2500,
    },
    {
      id: 'double-hung',
      label: 'Double-hung',
      blurb: 'Top and bottom sash both move. Usually tilts in to clean.',
      low: 900,
      high: 1500,
    },
    {
      id: 'single-hung',
      label: 'Single-hung',
      blurb: 'Only the bottom sash moves. The top half is fixed.',
      low: 850,
      high: 1500,
    },
    {
      id: 'picture',
      label: 'Picture / fixed',
      blurb: 'Does not open. Just glass in a frame.',
      low: 700,
      high: 2000,
    },
    {
      id: 'casement',
      label: 'Casement',
      blurb: 'Hinged at the side, cranks outward.',
      low: 1000,
      high: 1500,
    },
    {
      id: 'awning',
      label: 'Awning',
      blurb: 'Hinged at the top, cranks out from the bottom.',
      low: 1000,
      high: 2000,
    },
    {
      id: 'bay-bow',
      label: 'Bay or bow',
      blurb: 'Projects out from the wall. Its own framing and roof work.',
      low: 2000,
      high: 8000,
    },
    {
      id: 'sliding-door',
      label: 'Sliding patio door',
      blurb: 'Glass door, one or more panels slide past a fixed one. Its own opening, not a window.',
      low: 3000,
      high: 7000,
      isDoor: true,
    },
    {
      id: 'french-door',
      label: 'French door',
      blurb: 'Hinged pair of glass doors, swings open from the center.',
      low: 3000,
      high: 5000,
      isDoor: true,
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
      multiplier: 1.4,
    },
  ],

  /** Which window line, on top of material. Doors are not brand-specific —
   *  the choice below only ever applies to window openings. */
  brands: [
    {
      id: 'cascade',
      label: 'Cascade',
      blurb: 'The standard window Clearview installs on most jobs.',
      low: 0,
      high: 0,
    },
    {
      id: 'milgard',
      label: 'Milgard',
      blurb: 'A step up in the window itself, same install — runs more per opening than Cascade.',
      low: 100,
      high: 200,
    },
  ] satisfies WindowBrand[],

  /** Added per opening that has to come out to the rough framing. */
  fullFrame: {
    label: 'Full-frame replacement',
    blurb:
      'Frame and all comes out. Needed when the frame is rotten or out of square — how bad the ' +
      'damage is moves the price.',
    low: 800,
    high: 2000,
  },

  modifiers: [
    {
      id: 'third-story-plus',
      label: 'Third story or higher',
      blurb: 'Second-story access is already priced in. Third floor and up needs more staging.',
      perOpening: true,
      low: 100,
      high: 200,
    },
    {
      id: 'oversize',
      label: 'Oversize or custom shapes',
      blurb:
        'Arches, transoms, and anything past standard sizing. Still the regional average here — ' +
        "not yet Mark's own figure.",
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
      blurb: 'Wrapping, casing, or matching an existing profile — a flat rate on top of a block install.',
      perOpening: true,
      low: 250,
      high: 250,
    },
    {
      id: 'metal-removal',
      label: 'Removing old metal-frame windows',
      blurb: 'Cutting back the siding or stucco to pull an old aluminum or steel frame first.',
      perOpening: true,
      low: 150,
      high: 150,
    },
  ],
} as const;

export type PricingModifier = (typeof pricing.modifiers)[number];
export type PricingMaterial = (typeof pricing.materials)[number];
export type PricingBrand = (typeof pricing.brands)[number];

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
