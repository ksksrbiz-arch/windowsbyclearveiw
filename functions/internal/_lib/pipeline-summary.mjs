// Pure aggregation of the sales pipeline for the internal Analytics page:
// estimate requests -> quotes -> signed quotes -> jobs -> money collected.
// Deterministic: it counts rows and sums integer cents. No network, no AI.
//
// The stage totals are independent windowed counts (a quote counts even when
// it has no linked inquiry). summarizeSourceRevenue() is the traced view: it
// only credits quotes whose quotes.lead_id points at an inquiry, and reports
// how many quotes in the window are still unlinked so coverage is visible.

import { sourceLabel } from './lead-sources.mjs';

const DAY = 24 * 60 * 60 * 1000;
const STALE_DRAFT_DAYS = 14;

const cents = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

const inWindow = (value, cutoff, now) => {
  const t = Date.parse(value);
  return Number.isFinite(t) && t >= cutoff && t <= now + DAY ? t : null;
};

const rate = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(m * 10) / 10;
}

export function summarizePipeline({ leads, quotes, jobs, awaitingJob = null } = {}, { now = Date.now(), days = 90 } = {}) {
  const cutoff = now - days * DAY;
  const staleBefore = now - STALE_DRAFT_DAYS * DAY;

  const leadCount = Array.isArray(leads)
    ? leads.filter((row) => inWindow(row?.created_at, cutoff, now) !== null).length
    : null;

  let quoteStats = null;
  if (Array.isArray(quotes)) {
    quoteStats = { created: 0, quotedCents: 0, signed: 0, signedCents: 0, staleDrafts: 0, staleDraftCents: 0 };
    const daysToSign = [];
    for (const row of quotes) {
      const created = Date.parse(row?.created_at);
      const status = String(row?.status || '');
      // Open drafts are an all-time backlog, not a windowed count.
      if (status === 'draft' && Number.isFinite(created) && created < staleBefore) {
        quoteStats.staleDrafts += 1;
        quoteStats.staleDraftCents += cents(row?.total_cents);
      }
      if (inWindow(row?.created_at, cutoff, now) !== null) {
        quoteStats.created += 1;
        quoteStats.quotedCents += cents(row?.total_cents);
      }
      const signedAt = inWindow(row?.signed_at, cutoff, now);
      if (signedAt !== null) {
        quoteStats.signed += 1;
        quoteStats.signedCents += cents(row?.total_cents);
        if (Number.isFinite(created) && signedAt >= created) daysToSign.push((signedAt - created) / DAY);
      }
    }
    quoteStats.medianDaysToSign = median(daysToSign);
  }

  let jobStats = null;
  if (Array.isArray(jobs)) {
    jobStats = { created: 0, completed: 0, collectedCents: 0, paymentsKnown: jobs.every((row) => row?.paid_cents !== undefined) };
    for (const row of jobs) {
      if (String(row?.status || '') === 'cancelled') continue;
      if (inWindow(row?.created_at, cutoff, now) !== null) {
        jobStats.created += 1;
        jobStats.collectedCents += cents(row?.paid_cents);
      }
      if (inWindow(row?.completed_at, cutoff, now) !== null) jobStats.completed += 1;
    }
    if (!jobStats.paymentsKnown) jobStats.collectedCents = null;
  }

  return {
    days,
    staleDraftDays: STALE_DRAFT_DAYS,
    leads: leadCount,
    quotes: quoteStats,
    jobs: jobStats,
    // All-time count of finalized quotes with no job yet (exact, from SQL).
    awaitingJob: Number.isInteger(awaitingJob) && awaitingJob >= 0 ? awaitingJob : null,
    rates: {
      quotesPerLead: quoteStats && leadCount !== null ? rate(quoteStats.created, leadCount) : null,
      signedPerQuote: quoteStats ? rate(quoteStats.signed, quoteStats.created) : null,
    },
  };
}

export function summarizeSourceRevenue({ leads, quotes } = {}, { now = Date.now(), days = 90, limit = 8 } = {}) {
  if (!Array.isArray(quotes)) return null;
  const cutoff = now - days * DAY;
  const bySource = new Map();
  const row = (label) => {
    if (!bySource.has(label)) bySource.set(label, { label, leads: 0, quotes: 0, signed: 0, signedCents: 0, collectedCents: 0 });
    return bySource.get(label);
  };
  for (const lead of Array.isArray(leads) ? leads : []) {
    if (inWindow(lead?.created_at, cutoff, now) !== null) row(sourceLabel(lead)).leads += 1;
  }
  let linked = 0;
  let unlinked = 0;
  let paymentsKnown = true;
  for (const quote of quotes) {
    const created = inWindow(quote?.created_at, cutoff, now) !== null;
    const signed = inWindow(quote?.signed_at, cutoff, now) !== null;
    if (!created && !signed) continue;
    if (!quote?.lead_id) {
      if (created) unlinked += 1;
      continue;
    }
    if (created) linked += 1;
    const entry = row(sourceLabel(quote));
    if (created) entry.quotes += 1;
    if (signed) {
      entry.signed += 1;
      entry.signedCents += cents(quote?.total_cents);
    }
    if (quote?.paid_cents === undefined) paymentsKnown = false;
    else entry.collectedCents += cents(quote.paid_cents);
  }
  const sources = [...bySource.values()]
    .sort((a, b) => b.signedCents - a.signedCents || b.quotes - a.quotes || b.leads - a.leads || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((entry) => ({ ...entry, collectedCents: paymentsKnown ? entry.collectedCents : null }));
  return { linkedQuotes: linked, unlinkedQuotes: unlinked, sources };
}
