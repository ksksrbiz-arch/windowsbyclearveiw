// Quote builder line rules that the page and its test share.
//
// A quantity on the quote builder is a whole number of 1 or more: the inputs say so (min 1, step 1,
// numeric keypad). The server would accept a fraction (quote lines are stored as quantity x cents, see
// functions/internal/_lib/quotes.mjs), but the page never offered one, and a fraction that reached a line
// made the whole form fail its own step check with no explanation on a phone. So the page now refuses a
// bad quantity where it is typed and says why, instead of clamping it, rounding it or storing it.

export const QUANTITY_MESSAGE = 'Quantity must be a whole number, 1 or more.';

/** The whole number a quantity field holds, or null when it is empty, fractional, zero, negative or not a number. */
export function wholeQuantity(raw: unknown): number | null {
  const text = String(raw ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}
