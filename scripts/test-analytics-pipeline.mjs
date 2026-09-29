import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createD1 } from './_lib/d1-sqlite.mjs';
import { summarizePipeline } from '../functions/internal/_lib/pipeline-summary.mjs';
import * as analytics from '../functions/internal/api/analytics.js';

const pass = (message) => console.log(`PASS: ${message}`);
const DAY = 86400000;
const now = Date.UTC(2026, 8, 28, 12, 0, 0);
const iso = (daysAgo) => new Date(now - daysAgo * DAY).toISOString();

{
  const summary = summarizePipeline(
    {
      leads: [{ created_at: iso(1) }, { created_at: iso(10) }, { created_at: iso(20) }, { created_at: iso(30) }, { created_at: iso(200) }],
      quotes: [
        { created_at: iso(25), status: 'finalized', total_cents: 500000, signed_at: iso(21) },
        { created_at: iso(12), status: 'finalized', total_cents: 300000, signed_at: iso(10) },
        { created_at: iso(30), status: 'draft', total_cents: 120000 },
        { created_at: iso(3), status: 'draft', total_cents: 99999 },
        { created_at: iso(300), status: 'draft', total_cents: 70000 },
        { created_at: iso(5), status: 'draft', total_cents: -50 },
      ],
      jobs: [
        { created_at: iso(20), status: 'completed', completed_at: iso(5), paid_cents: 500000 },
        { created_at: iso(8), status: 'ready', completed_at: null, paid_cents: 100000 },
        { created_at: iso(4), status: 'cancelled', completed_at: null, paid_cents: 999999 },
      ],
      awaitingJob: 1,
    },
    { now },
  );
  assert.equal(summary.leads, 4, 'only requests inside the 90-day window count');
  assert.equal(summary.quotes.created, 5);
  assert.equal(summary.quotes.quotedCents, 500000 + 300000 + 120000 + 99999, 'negative totals are never summed');
  assert.equal(summary.quotes.signed, 2);
  assert.equal(summary.quotes.signedCents, 800000);
  assert.equal(summary.quotes.medianDaysToSign, 3, 'median of 4 and 2 days');
  assert.equal(summary.quotes.staleDrafts, 2, 'drafts older than 14 days are a backlog, including ones outside the window');
  assert.equal(summary.quotes.staleDraftCents, 190000);
  assert.equal(summary.jobs.created, 2, 'cancelled jobs are excluded');
  assert.equal(summary.jobs.completed, 1);
  assert.equal(summary.jobs.collectedCents, 600000);
  assert.equal(summary.awaitingJob, 1);
  assert.deepEqual(summary.rates, { quotesPerLead: 125, signedPerQuote: 40 });
  pass('the pipeline is counted in integer cents over a fixed window, excluding cancelled jobs and invalid money');
}

{
  const empty = summarizePipeline({ leads: [], quotes: [], jobs: [] }, { now });
  assert.deepEqual(empty.rates, { quotesPerLead: null, signedPerQuote: null }, 'no rate is invented from a zero denominator');
  assert.equal(empty.quotes.medianDaysToSign, null);
  const missing = summarizePipeline({ leads: null, quotes: null, jobs: [{ created_at: iso(1), status: 'ready' }], awaitingJob: 'x' }, { now });
  assert.equal(missing.leads, null);
  assert.equal(missing.quotes, null);
  assert.equal(missing.jobs.collectedCents, null, 'collected is unknown, not $0, when payments could not be read');
  assert.equal(missing.awaitingJob, null);
  pass('missing sources and zero denominators report unknown rather than a fabricated number');
}

function freshEnv() {
  return { QUOTES_DB: createD1({ schemaFiles: ['functions/api/_data/schema.sql', 'internal/db/schema.sql'] }) };
}

async function get(env) {
  const response = await analytics.onRequest({ request: new Request('https://x.test/internal/api/analytics'), env });
  return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
}

{
  const env = freshEnv();
  const db = env.QUOTES_DB.raw;
  const recent = new Date(Date.now() - 5 * DAY).toISOString();
  const old = new Date(Date.now() - 40 * DAY).toISOString();
  db.prepare(`INSERT INTO leads (created_at, name, first_referrer, landing_path) VALUES (?, 'Pat Doe', 'https://www.google.com/', '/')`).run(recent);
  db.prepare(`INSERT INTO quotes (id, created_at, updated_at, status, customer_name, total_cents, signed_at) VALUES ('Q-1', ?, ?, 'finalized', 'Pat Doe', 250000, ?)`).run(old, old, recent);
  db.prepare(`INSERT INTO quotes (id, created_at, updated_at, status, customer_name, total_cents) VALUES ('Q-2', ?, ?, 'draft', 'Lee Roe', 80000)`).run(old, old);

  const before = await get(env);
  assert.equal(before.status, 200);
  assert.equal(before.cache, 'private, no-store');
  assert.equal(before.body.pipeline.status, 'ok');
  assert.equal(before.body.pipeline.jobs, null, 'no jobs table yet: jobs are unknown, the rest still renders');
  assert.equal(before.body.pipeline.awaitingJob, null);
  assert.equal(before.body.pipeline.leads, 1);
  assert.equal(before.body.pipeline.quotes.signedCents, 250000);
  assert.equal(before.body.pipeline.quotes.staleDrafts, 1);

  db.exec(`CREATE TABLE jobs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, quote_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'ready', customer_name TEXT NOT NULL, completed_at TEXT)`);
  const withJobs = await get(env);
  assert.equal(withJobs.body.pipeline.awaitingJob, 1, 'the finalized quote has no job yet');
  assert.equal(withJobs.body.pipeline.jobs.created, 0);
  assert.equal(withJobs.body.pipeline.jobs.collectedCents, 0, 'zero jobs collected zero');

  db.prepare(`INSERT INTO jobs (id, created_at, updated_at, quote_id, status, customer_name) VALUES ('J-1', ?, ?, 'Q-1', 'ready', 'Pat Doe')`).run(recent, recent);
  db.exec(`CREATE TABLE job_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, amount_paid_cents INTEGER NOT NULL DEFAULT 0)`);
  db.prepare(`INSERT INTO job_payments (job_id, created_at, updated_at, amount_paid_cents) VALUES ('J-1', ?, ?, 125000)`).run(recent, recent);
  const full = await get(env);
  assert.equal(full.body.pipeline.awaitingJob, 0);
  assert.equal(full.body.pipeline.jobs.created, 1);
  assert.equal(full.body.pipeline.jobs.collectedCents, 125000);
  const text = JSON.stringify(full.body.pipeline);
  assert.ok(!/Pat Doe|Lee Roe|Q-1|J-1/.test(text), 'the pipeline block carries aggregates only, no names or record ids');
  pass('the endpoint runs against real SQL, degrades per missing table, and returns aggregates only');
}

{
  const page = fs.readFileSync('src/pages/internal/analytics.astro', 'utf8');
  assert.ok(/renderPipeline/.test(page) && /data-pipe="collected"/.test(page));
  assert.ok(/not the same customers followed through/.test(page), 'the page says stage totals are not a traced cohort');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(page));
  pass('the page renders the pipeline with textContent and states its counting limits');
}

console.log('Analytics pipeline checks passed.');
