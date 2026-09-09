import { generatePlan } from './build-plan.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}

async function ensureSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      quote_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'ready',
      scheduled_date TEXT,
      scheduled_window TEXT,
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      customer_email TEXT,
      customer_address TEXT,
      customer_city TEXT,
      notes TEXT,
      install_notes TEXT,
      closeout_notes TEXT,
      completed_at TEXT,
      created_by TEXT NOT NULL DEFAULT 'mark'
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_date ON jobs(scheduled_date)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_quote_id ON jobs(quote_id)`),
  ]);
  for (const sql of [
    `ALTER TABLE jobs ADD COLUMN build_plan_json TEXT`,
    `ALTER TABLE jobs ADD COLUMN build_plan_version INTEGER`,
    `ALTER TABLE jobs ADD COLUMN build_plan_knowledge_version TEXT`,
  ]) { try { await db.prepare(sql).run(); } catch {} }
}

function makeId() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `J-${stamp}-${random}`;
}

function parsePlan(row) {
  if (!row?.build_plan_json) return null;
  try { return JSON.parse(row.build_plan_json); } catch { return null; }
}

export async function onRequestGet(context) {
  const { env } = context;
  await ensureSchema(env.QUOTES_DB);
  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');

  if (id) {
    const job = await env.QUOTES_DB.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(id).first();
    if (!job) return json({ error: 'Job not found.' }, 404);
    let quote = null;
    let items = [];
    if (job.quote_id) {
      quote = await env.QUOTES_DB.prepare(`SELECT * FROM quotes WHERE id = ?`).bind(job.quote_id).first();
      if (quote) {
        const result = await env.QUOTES_DB.prepare(`SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order ASC, id ASC`).bind(job.quote_id).all();
        items = result.results || [];
      }
    }
    return json({ job, quote, items, buildPlan: parsePlan(job), buildPlanVersion: Number(job.build_plan_version || 0), buildPlanKnowledgeVersion: job.build_plan_knowledge_version || null });
  }

  const result = await env.QUOTES_DB.prepare(`
    SELECT j.*, q.total_cents
    FROM jobs j
    LEFT JOIN quotes q ON q.id = j.quote_id
    ORDER BY
      CASE j.status
        WHEN 'scheduled' THEN 0
        WHEN 'ready' THEN 1
        WHEN 'in-progress' THEN 2
        WHEN 'completed' THEN 3
        ELSE 4
      END,
      COALESCE(j.scheduled_date, '9999-12-31') ASC,
      j.created_at DESC
    LIMIT 200
  `).all();

  return json({ jobs: result.results || [] });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  await ensureSchema(env.QUOTES_DB);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const quoteId = typeof body.quoteId === 'string' ? body.quoteId.trim() : '';
  if (!quoteId) return json({ error: 'A finalized quote is required.' }, 400);

  const quote = await env.QUOTES_DB.prepare(`SELECT * FROM quotes WHERE id = ?`).bind(quoteId).first();
  if (!quote) return json({ error: 'Quote not found.' }, 404);
  if (quote.status !== 'finalized') return json({ error: 'Only finalized quotes can become jobs.' }, 409);

  const existing = await env.QUOTES_DB.prepare(`SELECT id FROM jobs WHERE quote_id = ?`).bind(quoteId).first();
  if (existing) return json({ id: existing.id, existing: true }, 200);

  const { results: items } = await env.QUOTES_DB.prepare(`SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order ASC, id ASC`).bind(quoteId).all();
  const savedPlanRow = await env.QUOTES_DB.prepare(`SELECT * FROM quote_build_plans WHERE quote_id = ?`).bind(quoteId).first();
  let plan = null;
  let planVersion = 0;
  let knowledgeVersion = null;
  if (savedPlanRow?.plan_json) {
    try { plan = JSON.parse(savedPlanRow.plan_json); } catch { plan = null; }
    planVersion = Number(savedPlanRow.version || 0);
    knowledgeVersion = savedPlanRow.knowledge_version || plan?.knowledgeVersion || null;
  }
  if (!plan) {
    plan = generatePlan(quote, items);
    planVersion = 1;
    knowledgeVersion = plan.knowledgeVersion || null;
  }
  plan = { ...plan, finalizedSnapshot: true, finalizedAt: new Date().toISOString() };

  const now = new Date().toISOString();
  const id = makeId();
  await env.QUOTES_DB.prepare(`
    INSERT INTO jobs (
      id, created_at, updated_at, quote_id, status,
      customer_name, customer_phone, customer_email, customer_address,
      customer_city, notes, build_plan_json, build_plan_version,
      build_plan_knowledge_version, created_by
    ) VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mark')
  `).bind(
    id, now, now, quoteId,
    quote.customer_name, quote.customer_phone || null, quote.customer_email || null,
    quote.customer_address || null, quote.customer_city || null, quote.notes || null,
    JSON.stringify(plan).slice(0, 150000), planVersion, knowledgeVersion,
  ).run();

  return json({ id, created: true, buildPlanVersion: planVersion, buildPlanKnowledgeVersion: knowledgeVersion }, 201);
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  await ensureSchema(env.QUOTES_DB);
  const id = new URL(context.request.url).searchParams.get('id');
  if (!id) return json({ error: 'Job id is required.' }, 400);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const job = await env.QUOTES_DB.prepare(`SELECT * FROM jobs WHERE id = ?`).bind(id).first();
  if (!job) return json({ error: 'Job not found.' }, 404);
  const allowedStatuses = new Set(['ready', 'scheduled', 'in-progress', 'completed', 'cancelled']);
  const status = typeof body.status === 'string' && allowedStatuses.has(body.status) ? body.status : job.status;
  const scheduledDate = typeof body.scheduledDate === 'string' ? body.scheduledDate.trim().slice(0, 10) || null : job.scheduled_date;
  const scheduledWindow = typeof body.scheduledWindow === 'string' ? body.scheduledWindow.trim().slice(0, 120) || null : job.scheduled_window;
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 8000) : job.notes;
  const installNotes = typeof body.installNotes === 'string' ? body.installNotes.slice(0, 8000) : job.install_notes;
  const closeoutNotes = typeof body.closeoutNotes === 'string' ? body.closeoutNotes.slice(0, 8000) : job.closeout_notes;
  const now = new Date().toISOString();
  const completedAt = status === 'completed' ? (job.completed_at || now) : null;
  await env.QUOTES_DB.prepare(`
    UPDATE jobs SET updated_at = ?, status = ?, scheduled_date = ?, scheduled_window = ?, notes = ?, install_notes = ?, closeout_notes = ?, completed_at = ? WHERE id = ?
  `).bind(now, status, scheduledDate, scheduledWindow, notes, installNotes, closeoutNotes, completedAt, id).run();
  return json({ ok: true });
}
