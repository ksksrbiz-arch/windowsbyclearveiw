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
    db.prepare(`CREATE TABLE IF NOT EXISTS job_opening_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      opening_index INTEGER NOT NULL,
      measurements_json TEXT NOT NULL DEFAULT '{}',
      notes TEXT NOT NULL DEFAULT '',
      exception_status TEXT NOT NULL DEFAULT 'none',
      exception_notes TEXT NOT NULL DEFAULT '',
      material_usage_json TEXT NOT NULL DEFAULT '{}',
      photo_summary_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT 'mark',
      UNIQUE(job_id, opening_index)
    )`),
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

const OPENING_GATES = [
  ['Verify', 10],
  ['Remove', 20],
  ['Prep', 30],
  ['Install', 40],
  ['Flash / Seal', 50],
  ['Operate', 60],
  ['Photograph', 70],
  ['Complete', 80],
];

async function seed(db, jobId) {
  const now = new Date().toISOString();
  for (const [section, label, position] of DEFAULTS) {
    await db.prepare(`INSERT OR IGNORE INTO job_checklist_items (job_id, section, label, checked, position, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)`)
      .bind(jobId, section, label, position, now, now).run();
  }
  const row = await db.prepare(`SELECT build_plan_json FROM jobs WHERE id = ?`).bind(jobId).first();
  if (!row?.build_plan_json) return;
  let plan;
  try { plan = JSON.parse(row.build_plan_json); } catch { return; }
  const openings = Array.isArray(plan?.openings) ? plan.openings : [];
  for (let index = 0; index < openings.length; index += 1) {
    const section = `Opening ${String(index + 1).padStart(2, '0')}`;
    for (const [label, offset] of OPENING_GATES) {
      await db.prepare(`INSERT OR IGNORE INTO job_checklist_items (job_id, section, label, checked, position, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)`)
        .bind(jobId, section, label, index * 100 + offset, now, now).run();
    }
  }
}

async function buildPlanSnapshot(db, jobId) {
  const row = await db.prepare(`SELECT build_plan_json, build_plan_version, build_plan_knowledge_version FROM jobs WHERE id = ?`).bind(jobId).first();
  if (!row?.build_plan_json) return null;
  let plan;
  try { plan = JSON.parse(row.build_plan_json); } catch { return null; }
  return { version: row.build_plan_version || 1, knowledgeVersion: row.build_plan_knowledge_version || null, plan };
}

function parsePhotoSummary(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return { before: Number(parsed?.before || 0), during: Number(parsed?.during || 0), after: Number(parsed?.after || 0), issue: Number(parsed?.issue || 0) };
  } catch { return { before: 0, during: 0, after: 0, issue: 0 }; }
}

function parseMeasurements(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

export async function onRequestGet(context) {
  const { env } = context;
  await ensureSchema(env.QUOTES_DB);
  const jobId = new URL(context.request.url).searchParams.get('jobId');
  if (!jobId) return json({ error: 'jobId is required.' }, 400);
  const job = await env.QUOTES_DB.prepare(`SELECT id FROM jobs WHERE id = ?`).bind(jobId).first();
  if (!job) return json({ error: 'Job not found.' }, 404);
  await seed(env.QUOTES_DB, jobId);
  const result = await env.QUOTES_DB.prepare(`SELECT id, section, label, checked, notes, position, updated_at FROM job_checklist_items WHERE job_id = ? ORDER BY position, id`).bind(jobId).all();
  const snapshot = await buildPlanSnapshot(env.QUOTES_DB, jobId);
  return json({ items: result.results || [], buildPlan: snapshot ? { version: snapshot.version, knowledgeVersion: snapshot.knowledgeVersion, openingCount: Array.isArray(snapshot.plan?.openings) ? snapshot.plan.openings.length : 0, buyCount: Array.isArray(snapshot.plan?.buy) ? snapshot.plan.buy.length : 0, verifyCount: Array.isArray(snapshot.plan?.verify) ? snapshot.plan.verify.length : 0 } : null });
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
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 3000) : current.notes;

  if (checked && String(current.section).startsWith('Opening ')) {
    const gates = await env.QUOTES_DB.prepare(`SELECT label, checked, position FROM job_checklist_items WHERE job_id = ? AND section = ? ORDER BY position ASC`).bind(current.job_id, current.section).all();
    const rows = gates.results || [];
    const currentIndex = rows.findIndex((row) => Number(row.position) === Number(current.position) && row.label === current.label);
    if (current.label !== 'Verify' && current.label !== 'Complete') {
      const previous = rows[currentIndex - 1];
      if (!previous || Number(previous.checked) !== 1) return json({ error: `Complete the previous field gate before marking ${current.label} complete.`, code: 'FIELD_GATE_SEQUENCE' }, 409);
    }
    if (current.label === 'Verify') {
      const openingIndex = Number(String(current.section).replace(/\D/g, '')) - 1;
      const evidence = await env.QUOTES_DB.prepare(`SELECT measurements_json FROM job_opening_evidence WHERE job_id = ? AND opening_index = ?`).bind(current.job_id, openingIndex).first();
      const measurements = parseMeasurements(evidence?.measurements_json);
      const width = Number(measurements.width);
      const height = Number(measurements.height);
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        return json({ error: 'Record the actual opening width and height before completing Verify.', code: 'FIELD_MEASUREMENTS_REQUIRED' }, 409);
      }
    }
    if (current.label === 'Photograph') {
      const openingIndex = Number(String(current.section).replace(/\D/g, '')) - 1;
      const evidence = await env.QUOTES_DB.prepare(`SELECT photo_summary_json, exception_status, exception_notes FROM job_opening_evidence WHERE job_id = ? AND opening_index = ?`).bind(current.job_id, openingIndex).first();
      const photos = parsePhotoSummary(evidence?.photo_summary_json);
      const completeSet = photos.before > 0 && photos.during > 0 && photos.after > 0;
      const documentedException = evidence && ['open', 'punchlist', 'resolved'].includes(String(evidence.exception_status)) && String(evidence.exception_notes || '').trim();
      if (!completeSet && !documentedException) return json({ error: 'Capture before, during, and after evidence, or document an explicit field exception before completing Photograph.', code: 'PHOTO_EVIDENCE_REQUIRED', photos }, 409);
    }
    if (current.label === 'Complete') {
      const pending = rows.filter((row) => row.label !== 'Complete' && Number(row.checked) !== 1);
      if (pending.length) return json({ error: 'Complete every prior field gate before closing this opening.', code: 'OPENING_INCOMPLETE', remaining: pending.length }, 409);
      const openingIndex = Number(String(current.section).replace(/\D/g, '')) - 1;
      const evidence = await env.QUOTES_DB.prepare(`SELECT exception_status FROM job_opening_evidence WHERE job_id = ? AND opening_index = ?`).bind(current.job_id, openingIndex).first();
      if (String(evidence?.exception_status || 'none') === 'open') return json({ error: 'Resolve the open exception or explicitly move it to the punch list before closing this opening.', code: 'OPEN_EXCEPTION' }, 409);
    }
  }

  const now = new Date().toISOString();
  await env.QUOTES_DB.prepare(`UPDATE job_checklist_items SET checked = ?, notes = ?, updated_at = ? WHERE id = ?`).bind(checked, notes, now, id).run();
  return json({ ok: true, item: { ...current, checked, notes, updated_at: now } });
}
