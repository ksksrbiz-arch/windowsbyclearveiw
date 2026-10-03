// Cents to display money, for the Command Center.
//
// Money is stored and summed in integer cents (quote lines can have fractional quantities, discounts
// and General-job amounts take cents), so a figure on screen must never round a cent away: "$1,234"
// for whole dollars, "$1,234.50" otherwise. The emailed invoice uses the same rule (a hand-kept copy
// in functions/internal/_lib/money.mjs; npm run test:command-center fails if they drift), and the customer
// signing page always shows cents.

const WHOLE = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const EXACT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatCents(cents: unknown): string {
  const value = Math.round(Number(cents));
  const safe = Number.isFinite(value) ? value : 0;
  return (safe % 100 === 0 ? WHOLE : EXACT).format(safe / 100);
}

/** Dollars typed into a field ("4,800.50", "$12") to integer cents; NaN when not a non-negative amount. */
export function dollarsToCents(input: unknown): number {
  const text = String(input ?? '').replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(text)) return NaN;
  return Math.round(Number(text) * 100);
}
