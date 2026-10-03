// Cents to display money for emails and messages. Hand-kept copy of src/lib/money.ts (Functions never
// import from src/); npm run test:command-center fails if the two disagree. Whole dollars stay "$1,234", anything
// with cents shows both digits, so no figure on an invoice or reminder rounds a cent away.

const WHOLE = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const EXACT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatCents(cents) {
  const value = Math.round(Number(cents));
  const safe = Number.isFinite(value) ? value : 0;
  return (safe % 100 === 0 ? WHOLE : EXACT).format(safe / 100);
}
