// Pure aggregation of where estimate requests came from, built from the
// first-touch attribution the site already stores on every lead. No network,
// no AI: it counts rows.

const DAY = 24 * 60 * 60 * 1000;

const clean = (value, max = 120) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

function referrerHost(referrer) {
  const raw = clean(referrer, 300);
  if (!raw) return '';
  try {
    return new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return clean(raw, 60).toLowerCase();
  }
}

const SELF_HOSTS = /(^|\.)windowsbyclearview\.com$|(^|\.)windowsbyclearveiw\.pages\.dev$/;

export function sourceLabel(lead) {
  const utm = clean(lead?.first_utm_source, 60).toLowerCase();
  if (utm) return utm;
  const host = referrerHost(lead?.first_referrer);
  if (host && !SELF_HOSTS.test(host)) return host;
  return 'Direct / unknown';
}

function pathLabel(value) {
  const path = clean(value, 160);
  if (!path) return '(unknown)';
  return path.split(/[?#]/)[0] || '/';
}

function weekStart(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

function tally(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function ranked(map, limit) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }));
}

export function summarizeLeadSources(rows, { now = Date.now(), days = 90, weeks = 8, limit = 8 } = {}) {
  const cutoff = now - days * DAY;
  const sources = new Map();
  const landing = new Map();
  const perWeek = new Map();
  for (let i = weeks - 1; i >= 0; i -= 1) perWeek.set(weekStart(now - i * 7 * DAY), 0);
  let total = 0;
  for (const row of rows || []) {
    const created = Date.parse(row?.created_at);
    if (!Number.isFinite(created) || created < cutoff || created > now + DAY) continue;
    total += 1;
    tally(sources, sourceLabel(row));
    tally(landing, pathLabel(row?.landing_path));
    const week = weekStart(created);
    if (perWeek.has(week)) perWeek.set(week, perWeek.get(week) + 1);
  }
  return {
    days,
    total,
    sources: ranked(sources, limit),
    landingPages: ranked(landing, limit),
    weekly: [...perWeek.entries()].map(([weekOf, value]) => ({ weekOf, value })),
  };
}
