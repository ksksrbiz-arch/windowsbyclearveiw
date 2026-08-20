/**
 * Everything the cost estimator needs to talk about money lives here.
 *
 * ── For Mark ────────────────────────────────────────────────────────────────
 * Set `ready: true` and fill in the ranges below with your own installed
 * per-opening pricing. Until then the estimator still works — it sizes the job
 * and sends you the scope — it just does not show dollars, so nobody is ever
 * quoted a number you did not set.
 *
 * Ranges are INSTALLED cost per opening: unit, labour, and normal finish work,
 * for a standard-size opening on the ground floor in vinyl. Everything else
 * (fiberglass, full-frame, upstairs, oversize) is a modifier further down, so
 * you only have to think about one clean baseline number per window type.
 */

export type OpeningType = {
  id: string;
  label: string;
  blurb: string;
  /** Installed range per opening, vinyl, insert, ground floor. */
  low: number;
  high: number;
};

export const pricing = {
  /** Flip to true once every range below is Mark's real number. */
  ready: false,

  /** Widened on the way out so a range never reads as a promise. */
  displayRounding: 50,

  openings: [
    {
      id: 'slider',
      label: 'Slider',
      blurb: 'Two sashes, one slides sideways past the other.',
      low: 0,
      high: 0,
    },
    {
      id: 'double-hung',
      label: 'Double-hung',
      blurb: 'Top and bottom sash both move. Usually tilts in to clean.',
      low: 0,
      high: 0,
    },
    {
      id: 'single-hung',
      label: 'Single-hung',
      blurb: 'Only the bottom sash moves. The top half is fixed.',
      low: 0,
      high: 0,
    },
    {
      id: 'picture',
      label: 'Picture / fixed',
      blurb: 'Does not open. Just glass in a frame.',
      low: 0,
      high: 0,
    },
    {
      id: 'casement',
      label: 'Casement',
      blurb: 'Hinged at the side, cranks outward.',
      low: 0,
      high: 0,
    },
    {
      id: 'awning',
      label: 'Awning',
      blurb: 'Hinged at the top, cranks out from the bottom.',
      low: 0,
      high: 0,
    },
    {
      id: 'bay-bow',
      label: 'Bay or bow',
      blurb: 'Projects out from the wall. Its own framing and roof work.',
      low: 0,
      high: 0,
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
      multiplier: 1,
    },
  ],

  /** Added per opening that has to come out to the rough framing. */
  fullFrame: {
    label: 'Full-frame replacement',
    blurb: 'Frame and all comes out. Needed when the frame is rotten or out of square.',
    low: 0,
    high: 0,
  },

  /** Flat adders, applied once per job unless noted. */
  modifiers: [
    {
      id: 'second-story',
      label: 'Second-story openings',
      blurb: 'Ladders, staging, and a slower set.',
      perOpening: true,
      low: 0,
      high: 0,
    },
    {
      id: 'oversize',
      label: 'Oversize or custom shapes',
      blurb: 'Arches, transoms, and anything past standard sizing.',
      perOpening: true,
      low: 0,
      high: 0,
    },
    {
      id: 'rot-repair',
      label: 'Suspected rot at the sills',
      blurb: 'Soft wood means opening the wall. Priced properly once we see it.',
      perOpening: false,
      low: 0,
      high: 0,
    },
    {
      id: 'trim',
      label: 'New interior or exterior trim',
      blurb: 'Wrapping, casing, or matching an existing profile.',
      perOpening: true,
      low: 0,
      high: 0,
    },
  ],
} as const;

export type PricingModifier = (typeof pricing.modifiers)[number];
export type PricingMaterial = (typeof pricing.materials)[number];

/** True only when every number that feeds a quote has been filled in. */
export function pricingIsUsable() {
  if (!pricing.ready) return false;
  return pricing.openings.some((opening) => opening.high > 0);
}
