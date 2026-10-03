// A scheduled job stores a calendar date, not an instant at UTC midnight.
// Format in UTC deliberately so travelling or changing the phone's timezone cannot move it a day.
export function formatScheduledDay(value: string | null | undefined): string {
  if (!value) return 'Unscheduled';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return value;
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}
