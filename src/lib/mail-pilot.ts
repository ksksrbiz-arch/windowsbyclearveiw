/**
 * Arithmetic and link helpers for the Mail pilot page. Pure functions so `scripts/test-mail-pilot.mjs`
 * can import this file directly under Node (only erasable TypeScript is used, like charts.ts).
 *
 * Nothing here knows Clearview's prices, margins or close rates: every figure comes from the person
 * typing it in, and an empty or nonsensical input returns null so the page shows nothing instead of a
 * made-up answer.
 */

export type BreakEvenInput = {
  /** Pieces of mail sent. */
  pieces: number;
  /** All-in cost of one piece in dollars: printing, postage, any mailing fee. */
  costPerPiece: number;
  /** Average value of a signed job in dollars. */
  jobValue: number;
  /** Gross margin on a job, as a percent (1 to 100). */
  marginPct: number;
  /** Optional: percent of estimate requests that end in a signed job (1 to 100). */
  closePct?: number | null;
};

export type BreakEven = {
  spend: number;
  profitPerJob: number;
  /** Signed jobs needed for the profit to cover the spend. */
  jobsNeeded: number;
  /** The same, per 1,000 pieces mailed. */
  jobsPer1000: number;
  /** Estimate requests needed to get those jobs at the given close rate, or null without one. */
  requestsNeeded: number | null;
};

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function breakEven(input: Partial<BreakEvenInput> | null | undefined): BreakEven | null {
  if (!input) return null;
  const { pieces, costPerPiece, jobValue, marginPct, closePct } = input;
  if (!positive(pieces) || !positive(costPerPiece) || !positive(jobValue) || !positive(marginPct) || marginPct > 100) return null;
  const spend = pieces * costPerPiece;
  const profitPerJob = jobValue * (marginPct / 100);
  const jobsNeeded = Math.ceil(spend / profitPerJob - 1e-9);
  const close = positive(closePct) && closePct <= 100 ? closePct / 100 : null;
  return {
    spend: Math.round(spend * 100) / 100,
    profitPerJob: Math.round(profitPerJob * 100) / 100,
    jobsNeeded,
    jobsPer1000: Math.round((jobsNeeded / pieces) * 1000 * 10) / 10,
    requestsNeeded: close === null ? null : Math.ceil(jobsNeeded / close - 1e-9),
  };
}

const REF = /^CV-\d{4,}$/;

/**
 * The estimate link to print on (or encode in the QR code of) one piece of mail. The site already records
 * utm_source, utm_medium and utm_campaign from the first visit on every estimate request, so putting the
 * reference code in utm_campaign shows which mailed address a request came from, with no new code.
 */
export function trackingLink(ref: string, origin = 'https://windowsbyclearview.com'): string | null {
  if (!REF.test(String(ref ?? ''))) return null;
  return `${origin.replace(/\/+$/, '')}/estimate?utm_source=mailer&utm_medium=print&utm_campaign=${encodeURIComponent(ref)}`;
}
