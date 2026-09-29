// GET /internal/api/analytics
//
// Read model for the Analytics page (behind the internal session middleware).
// Combines two deterministic sources:
//   * ga4: live GA4 numbers via functions/internal/_lib/ga4.mjs (fail-soft)
//   * leads: where estimate requests actually came from, counted from D1
//   * pipeline: requests -> quotes -> signed -> jobs -> collected, from D1
//     (functions/internal/_lib/pipeline-summary.mjs; aggregate only, no PII)
// Ahrefs has no entry here on purpose: the free Webmaster Tools plan has no
// API, so the page only links to it.

import { fetchGa4Summary } from '../_lib/ga4.mjs';
import { summarizeLeadSources } from '../_lib/lead-sources.mjs';
import { summarizePipeline, summarizeSourceRevenue } from '../_lib/pipeline-summary.mjs';
import { ensureQuoteLeadColumn } from '../_lib/lead-links.mjs';

const MAX_LEAD_ROWS = 2000;
const MAX_PIPELINE_ROWS = 2000;

// Each read fails soft to null so one missing table (e.g. jobs before the
// first job exists) never blanks the whole page.
const rows = (statement) => statement.all().then((result) => result.results || []).catch(() => null);

async function pipelineRows(db, since) {
  if (!db) return { quotes: null, jobs: null, awaitingJob: null };
  await ensureQuoteLeadColumn(db).catch(() => {});
  const quoteWindow = `WHERE q.created_at >= ? OR q.signed_at >= ? OR q.status = 'draft' ORDER BY q.created_at DESC LIMIT ?`;
  const [quotesTraced, jobsWithPayments, awaiting] = await Promise.all([
    // Traced: the linked inquiry's first-touch source and money collected on
    // the quote's job. Aggregated in code; names and ids never leave this file.
    rows(db.prepare(
      `SELECT q.created_at, q.status, q.total_cents, q.signed_at, q.lead_id,
              l.first_referrer, l.first_utm_source,
              (SELECT COALESCE(SUM(p.amount_paid_cents), 0) FROM jobs j JOIN job_payments p ON p.job_id = j.id
               WHERE j.quote_id = q.id AND j.status != 'cancelled') AS paid_cents
       FROM quotes q LEFT JOIN leads l ON l.id = q.lead_id ${quoteWindow}`,
    ).bind(since, since, MAX_PIPELINE_ROWS)),
    rows(db.prepare(
      `SELECT j.created_at, j.status, j.completed_at, COALESCE(p.amount_paid_cents, 0) AS paid_cents
       FROM jobs j LEFT JOIN job_payments p ON p.job_id = j.id
       WHERE j.created_at >= ? OR j.completed_at >= ?
       ORDER BY j.created_at DESC LIMIT ?`,
    ).bind(since, since, MAX_PIPELINE_ROWS)),
    rows(db.prepare(
      `SELECT COUNT(*) AS n FROM quotes q
       WHERE q.status = 'finalized' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.quote_id = q.id)`,
    )),
  ]);
  // jobs / job_payments are created lazily; without them, drop only the money column.
  const quotes = quotesTraced ?? await rows(db.prepare(
    `SELECT q.created_at, q.status, q.total_cents, q.signed_at, q.lead_id, l.first_referrer, l.first_utm_source
     FROM quotes q LEFT JOIN leads l ON l.id = q.lead_id ${quoteWindow}`,
  ).bind(since, since, MAX_PIPELINE_ROWS)) ?? await rows(db.prepare(
    `SELECT q.created_at, q.status, q.total_cents, q.signed_at FROM quotes q ${quoteWindow}`,
  ).bind(since, since, MAX_PIPELINE_ROWS));
  // job_payments is created lazily by the Payments page; without it, still count jobs.
  const jobs = jobsWithPayments ?? await rows(db.prepare(
    `SELECT created_at, status, completed_at FROM jobs
     WHERE created_at >= ? OR completed_at >= ? ORDER BY created_at DESC LIMIT ?`,
  ).bind(since, since, MAX_PIPELINE_ROWS));
  return { quotes, jobs, awaitingJob: awaiting ? Number(awaiting[0]?.n) || 0 : null };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function onRequestGet(context) {
  const { env = {} } = context;
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [ga4, leadRows, pipeline] = await Promise.all([
    fetchGa4Summary(env),
    env.QUOTES_DB
      ? env.QUOTES_DB.prepare(
          `SELECT created_at, first_referrer, first_utm_source, landing_path
           FROM leads WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?`,
        )
          .bind(since, MAX_LEAD_ROWS)
          .all()
          .then((result) => result.results || [])
          .catch(() => null)
      : Promise.resolve(null),
    pipelineRows(env.QUOTES_DB, since),
  ]);
  const pipelineAvailable = leadRows || pipeline.quotes || pipeline.jobs;

  return json({
    ga4,
    pipeline: pipelineAvailable
      ? {
          status: 'ok',
          ...summarizePipeline({ leads: leadRows, ...pipeline }),
          bySource: summarizeSourceRevenue({ leads: leadRows, quotes: pipeline.quotes }),
        }
      : { status: 'unavailable' },
    leads: leadRows ? { status: 'ok', ...summarizeLeadSources(leadRows) } : { status: 'unavailable' },
    links: {
      ga4: ga4.propertyId
        ? `https://analytics.google.com/analytics/web/#/p${ga4.propertyId}/reports/intelligenthome`
        : 'https://analytics.google.com/',
      tagManager: 'https://tagmanager.google.com/',
      searchConsole: 'https://search.google.com/search-console',
      ahrefsWebmasterTools: 'https://ahrefs.com/webmaster-tools',
    },
  });
}

export async function onRequest(context) {
  if (context.request.method === 'GET' || context.request.method === 'HEAD') return onRequestGet(context);
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { allow: 'GET, HEAD', 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
