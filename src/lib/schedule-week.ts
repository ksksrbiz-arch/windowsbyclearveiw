// Keep the installation calendar on Clearview's business date even when the phone is travelling.
export function businessCalendarDate(now = new Date()): Date {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(({type, value}) => [type, value]));
  return new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
}
export function scheduleWeek(anchor: Date): Date[] {
  const monday = new Date(anchor);
  const day = monday.getUTCDay();
  monday.setUTCDate(monday.getUTCDate() + (day === 0 ? -6 : 1-day));
  return Array.from({length: 7}, (_, i) => { const date = new Date(monday); date.setUTCDate(monday.getUTCDate()+i); return date; });
}
