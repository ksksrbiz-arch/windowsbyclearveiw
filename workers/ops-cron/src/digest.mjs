// Morning phone nudge: how many follow-ups are due and overdue. Counts only, no customer data,
// same rule as the new-lead push (functions/_lib/lead-alert.mjs).
export const FOLLOW_UPS_URL = 'https://windowsbyclearview.com/internal/follow-up';

/** Start of the current day in Pacific time (Mark's day), as a UTC instant, and the next day's start. */
export function pacificDayBounds(now = new Date()) {
  const offsetAt = (instant) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(instant);
    const get = (type) => Number(parts.find((part) => part.type === type).value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - instant.getTime();
  };
  const local = new Date(now.getTime() + offsetAt(now));
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const start = new Date(midnightLocal - offsetAt(new Date(midnightLocal - offsetAt(now))));
  const nextLocal = midnightLocal + 86_400_000;
  const end = new Date(nextLocal - offsetAt(new Date(nextLocal - offsetAt(now))));
  return { start, end };
}

export async function countFollowUps(db, now = new Date()) {
  const exists = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'follow_up_tasks'").first();
  if (!exists) return { overdue: 0, today: 0 };
  const { start, end } = pacificDayBounds(now);
  const row = await db
    .prepare(`SELECT
        COALESCE(SUM(CASE WHEN due_at IS NOT NULL AND due_at < ? THEN 1 ELSE 0 END), 0) AS overdue,
        COALESCE(SUM(CASE WHEN due_at IS NOT NULL AND due_at >= ? AND due_at < ? THEN 1 ELSE 0 END), 0) AS today
      FROM follow_up_tasks WHERE status = 'open'`)
    .bind(start.toISOString(), start.toISOString(), end.toISOString())
    .first();
  return { overdue: Number(row?.overdue) || 0, today: Number(row?.today) || 0 };
}

/** Null when there is nothing to say: no push on a quiet morning. */
export function digestMessage({ overdue, today }) {
  const total = overdue + today;
  if (!total) return null;
  const parts = [];
  if (overdue) parts.push(`${overdue} overdue`);
  if (today) parts.push(`${today} due today`);
  return { title: `${total} follow-up${total === 1 ? '' : 's'} to do`, body: parts.join(', ') + '. Tap to open the list.' };
}
