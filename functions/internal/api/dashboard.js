import { syncQuoteFollowUps } from '../_lib/quote-follow-ups.mjs';
import { ensureJobsSchema } from '../_lib/jobs-schema.mjs';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}

async function ensureTaskSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS follow_up_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      lead_id INTEGER,
      title TEXT NOT NULL,
      due_at TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      notes TEXT,
      created_by TEXT NOT NULL DEFAULT 'mark'
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_status_due ON follow_up_tasks(status, due_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_lead ON follow_up_tasks(lead_id)`),
  ]);
}

export function pacificDayRange(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map(({ type, value }) => [type, value]));
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  const utcMidnight = (y, m, d) => {
    const target = Date.UTC(y, m - 1, d);
    let guess = target;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const shown = Object.fromEntries(formatter.formatToParts(new Date(guess)).map(({ type, value }) => [type, value]));
      const shownAsUtc = Date.UTC(Number(shown.year), Number(shown.month) - 1, Number(shown.day), Number(shown.hour), Number(shown.minute), Number(shown.second));
      const adjusted = guess + target - shownAsUtc;
      if (adjusted === guess) break;
      guess = adjusted;
    }
    return new Date(guess).toISOString();
  };
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    start: utcMidnight(year, month, day),
    end: utcMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()),
  };
}

/** Compact read model for the Command Center. */
export async function onRequestGet(context) {
  const { env } = context;
  await ensureTaskSchema(env.QUOTES_DB);
  await ensureJobsSchema(env.QUOTES_DB);
  await syncQuoteFollowUps(env.QUOTES_DB).catch((error) => console.error('quote-follow-up-sync-failed', error));
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const today = pacificDayRange(new Date(now));

  const [counts, recentLeads, recentQuotes, sources, cities, tasks, recentJobs] = await Promise.all([
    env.QUOTES_DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM leads WHERE created_at >= ?) AS new_leads,
        (SELECT COUNT(*) FROM quotes WHERE status = 'draft') AS draft_quotes,
        (SELECT COUNT(*) FROM quotes WHERE status = 'finalized') AS finalized_quotes,
        (SELECT COALESCE(SUM(total_cents), 0) FROM quotes WHERE status = 'draft') AS draft_value_cents,
        (SELECT COALESCE(SUM(total_cents), 0) FROM quotes WHERE status = 'finalized') AS finalized_value_cents,
        (SELECT COUNT(*) FROM quotes) AS total_quotes,
        (SELECT COUNT(*) FROM follow_up_tasks WHERE status = 'open') AS open_tasks,
        (SELECT COUNT(*) FROM follow_up_tasks WHERE status = 'open' AND due_at >= ? AND due_at < ?) AS tasks_today,
        (SELECT COUNT(*) FROM follow_up_tasks WHERE status = 'open' AND due_at IS NOT NULL AND due_at < ?) AS tasks_overdue,
        (SELECT COUNT(*) FROM jobs WHERE status NOT IN ('completed','cancelled')) AS active_jobs,
        (SELECT COALESCE(SUM(CASE WHEN j.status NOT IN ('completed','cancelled') THEN COALESCE(q.total_cents,j.agreed_cents,0) ELSE 0 END),0) FROM jobs j LEFT JOIN quotes q ON q.id = j.quote_id) AS active_job_value_cents
    `).bind(weekAgo, today.start, today.end, now).first(),
    env.QUOTES_DB.prepare(`SELECT id, created_at, name, phone, email, city, role FROM leads ORDER BY created_at DESC LIMIT 6`).all(),
    env.QUOTES_DB.prepare(`SELECT id, created_at, status, customer_name, customer_city, total_cents FROM quotes ORDER BY created_at DESC LIMIT 6`).all(),
    env.QUOTES_DB.prepare(`
      SELECT CASE
        WHEN first_utm_source IS NOT NULL AND first_utm_source <> '' THEN first_utm_source
        WHEN first_referrer IS NOT NULL AND first_referrer <> '' THEN first_referrer
        ELSE 'Direct / unknown'
      END AS source, COUNT(*) AS count
      FROM leads GROUP BY source ORDER BY count DESC, source ASC LIMIT 6
    `).all(),
    env.QUOTES_DB.prepare(`SELECT COALESCE(NULLIF(city, ''), 'City not provided') AS city, COUNT(*) AS count FROM leads GROUP BY city ORDER BY count DESC, city ASC LIMIT 6`).all(),
    env.QUOTES_DB.prepare(`
      SELECT t.id, t.title, t.due_at, t.status, t.lead_id, t.quote_id,
             COALESCE(l.name, q.customer_name) AS lead_name, COALESCE(l.phone, q.customer_phone) AS lead_phone,
             COALESCE(l.city, q.customer_city) AS lead_city
      FROM follow_up_tasks t LEFT JOIN leads l ON l.id = t.lead_id LEFT JOIN quotes q ON q.id = t.quote_id
      WHERE t.status = 'open'
      ORDER BY CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END, t.due_at ASC, t.created_at ASC
      LIMIT 8
    `).all(),
    env.QUOTES_DB.prepare(`
      SELECT j.id, j.status, j.scheduled_date, j.scheduled_window, j.customer_name, j.customer_city, COALESCE(q.total_cents, j.agreed_cents) AS total_cents
      FROM jobs j LEFT JOIN quotes q ON q.id = j.quote_id
      WHERE j.status <> 'completed' AND j.status <> 'cancelled'
      ORDER BY CASE WHEN j.scheduled_date IS NULL THEN 1 ELSE 0 END, j.scheduled_date ASC, j.created_at DESC
      LIMIT 8
    `).all(),
  ]);

  return json({
    counts: counts || {},
    recentLeads: recentLeads.results || [],
    recentQuotes: recentQuotes.results || [],
    sources: sources.results || [],
    cities: cities.results || [],
    tasks: tasks.results || [],
    recentJobs: recentJobs.results || [],
  });
}
