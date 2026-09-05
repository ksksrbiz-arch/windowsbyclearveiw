function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}

async function ensureSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS job_checklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      section TEXT NOT NULL,
      label TEXT NOT NULL,
      checked INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(job_id, section, label)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_job_checklist_job ON job_checklist_items(job_id, section, position)`),
  ]);
}

const DEFAULTS = [
  ['Before install', 'Schedule confirmed', 10],
  ['Before install', 'Customer access / site notes reviewed', 20],
  ['Before install', 'Materials staged and counted', 30],
  ['Before install', 'Crew / installation window confirmed', 40],
  ['Installation', 'Arrival and site condition documented', 10],
  ['Installation', 'Removal and opening prep complete', 20],
  ['Installation', 'New units installed and secured', 30],
  ['Installation', 'Insulation, flashing / sealing, and trim complete', 40],
  ['Installation', 'Operation and fit checked', 50],
  ['Closeout', 'Before / during / after photos captured', 10],
  ['Closeout', 'Punch-list items resolved or documented', 20],
  ['Closeout', 'Customer walkthrough completed', 30],
  ['Closeout', 'Warranty / care information handed off', 40],
  ['Closeout', 'Final balance / payment status confirmed', 50],
];

async function seed(db, jobId) {
  const now = new Date().toISOString();
  for (const [section, label, position] of DEFAULTS) {
    await db.prepare(`INSERT OR IGNORE INTO job_checklist_items (job_id, section, label, checked, position, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)`)
      .bind(jobId, section, label, position, now, now).run();
  }
}

export async function onRequestGet(context) {
  const { env } = context;
  await ensureSchema(env.QUOTES_DB);
  const jobId = new URL(context.request.url).searchParams.get('jobId');
  if (!jobId) return json({ error: 'jobId is required.' }, 400);
  const job = await env.QUOTES_DB.prepare(`SELECT id FROM jobs WHERE id = ?`).bind(jobId).first();
  if (!job) return json({ error: 'Job not found.' }, 404);
  await seed(env.QUOTES_DB, jobId);
  const result = await env.QUOTES_DB.prepare(`SELECT id, section, label, checked, notes, position, updated_at FROM job_checklist_items WHERE job_id = ? ORDER BY section, position, id`).bind(jobId).all();
  return json({ items: result.results || [] });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  await ensureSchema(env.QUOTES_DB);
  const id = new URL(context.request.url).searchParams.get('id');
  if (!id) return json({ error: 'Checklist item id is required.' }, 400);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const current = await env.QUOTES_DB.prepare(`SELECT * FROM job_checklist_items WHERE id = ?`).bind(id).first();
  if (!current) return json({ error: 'Checklist item not found.' }, 404);
  const checked = body.checked === true || body.checked === 1 ? 1 : 0;
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 2000) : current.notes;
  await env.QUOTES_DB.prepare(`UPDATE job_checklist_items SET checked = ?, notes = ?, updated_at = ? WHERE id = ?`).bind(checked, notes, new Date().toISOString(), id).run();
  return json({ ok: true });
}
