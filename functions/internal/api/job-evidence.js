function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}

async function ensureSchema(db) {
  await db.batch([
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
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_job_opening_evidence_job ON job_opening_evidence(job_id, opening_index)`),
  ]);
}

function parseObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch { return fallback; }
}

function cleanMeasurements(value) {
  const source = parseObject(value);
  const out = {};
  for (const key of ['width', 'height', 'depth', 'left', 'right', 'top', 'bottom', 'sill', 'notes']) {
    if (source[key] === undefined || source[key] === null) continue;
    if (key === 'notes') out[key] = String(source[key]).slice(0, 1000);
    else {
      const n = Number(source[key]);
      if (Number.isFinite(n) && n >= 0 && n <= 9999) out[key] = n;
    }
  }
  return out;
}

function cleanMaterialUsage(value) {
  const source = parseObject(value);
  const out = {};
  for (const [key, raw] of Object.entries(source)) {
    const quantity = Number(raw);
    if (!key || key.length > 80 || !Number.isFinite(quantity) || quantity < 0 || quantity > 100000) continue;
    out[key.slice(0, 80)] = quantity;
  }
  return out;
}

function cleanPhotoSummary(value) {
  const source = parseObject(value);
  const out = {};
  for (const key of ['before', 'during', 'after', 'issue']) {
    const n = Number(source[key] || 0);
    out[key] = Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 999) : 0;
  }
  return out;
}

function cleanExceptionStatus(value) {
  return ['none', 'open', 'punchlist', 'resolved'].includes(value) ? value : 'none';
}

async function ensureJob(db, jobId) {
  return db.prepare(`SELECT id, build_plan_json, status FROM jobs WHERE id = ?`).bind(jobId).first();
}

export async function onRequestGet(context) {
  const { env } = context;
  await ensureSchema(env.QUOTES_DB);
  const url = new URL(context.request.url);
  const jobId = url.searchParams.get('jobId');
  if (!jobId) return json({ error: 'jobId is required.' }, 400);
  const job = await ensureJob(env.QUOTES_DB, jobId);
  if (!job) return json({ error: 'Job not found.' }, 404);
  const result = await env.QUOTES_DB.prepare(`SELECT id, job_id, opening_index, measurements_json, notes, exception_status, exception_notes, material_usage_json, photo_summary_json, created_at, updated_at, updated_by FROM job_opening_evidence WHERE job_id = ? ORDER BY opening_index`).bind(jobId).all();
  const evidence = (result.results || []).map((row) => ({
    ...row,
    measurements: parseObject(row.measurements_json),
    materialUsage: parseObject(row.material_usage_json),
    photoSummary: cleanPhotoSummary(row.photo_summary_json),
  }));
  return json({ jobId, evidence });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  await ensureSchema(env.QUOTES_DB);
  const url = new URL(request.url);
  const jobId = url.searchParams.get('jobId');
  if (!jobId) return json({ error: 'jobId is required.' }, 400);
  const job = await ensureJob(env.QUOTES_DB, jobId);
  if (!job) return json({ error: 'Job not found.' }, 404);
  if (String(job.status).toLowerCase() === 'cancelled') return json({ error: 'Cancelled jobs cannot receive field evidence.', code: 'JOB_CANCELLED' }, 409);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const openingIndex = Number(body.openingIndex);
  if (!Number.isInteger(openingIndex) || openingIndex < 0 || openingIndex > 999) return json({ error: 'openingIndex must be a non-negative integer.' }, 400);

  let openings = [];
  try { openings = Array.isArray(JSON.parse(job.build_plan_json || '{}')?.openings) ? JSON.parse(job.build_plan_json || '{}').openings : []; } catch { openings = []; }
  if (openings.length && openingIndex >= openings.length) return json({ error: 'Opening is outside the attached Build Plan snapshot.', code: 'OPENING_NOT_IN_SNAPSHOT' }, 409);

  const existing = await env.QUOTES_DB.prepare(`SELECT * FROM job_opening_evidence WHERE job_id = ? AND opening_index = ?`).bind(jobId, openingIndex).first();
  const measurements = body.measurements === undefined ? parseObject(existing?.measurements_json) : cleanMeasurements(body.measurements);
  const materialUsage = body.materialUsage === undefined ? parseObject(existing?.material_usage_json) : cleanMaterialUsage(body.materialUsage);
  const photoSummary = body.photoSummary === undefined ? cleanPhotoSummary(existing?.photo_summary_json) : cleanPhotoSummary(body.photoSummary);
  const notes = body.notes === undefined ? String(existing?.notes || '') : String(body.notes || '').slice(0, 5000);
  const exceptionStatus = body.exceptionStatus === undefined ? String(existing?.exception_status || 'none') : cleanExceptionStatus(body.exceptionStatus);
  const exceptionNotes = body.exceptionNotes === undefined ? String(existing?.exception_notes || '') : String(body.exceptionNotes || '').slice(0, 5000);
  if (exceptionStatus !== 'none' && !exceptionNotes.trim()) return json({ error: 'Add exception details before setting an exception status.', code: 'EXCEPTION_DETAILS_REQUIRED' }, 400);
  if (exceptionStatus === 'none' && exceptionNotes.trim()) return json({ error: 'Clear the exception details or choose an exception status.', code: 'EXCEPTION_STATUS_REQUIRED' }, 400);

  const now = new Date().toISOString();
  await env.QUOTES_DB.prepare(`INSERT INTO job_opening_evidence (job_id, opening_index, measurements_json, notes, exception_status, exception_notes, material_usage_json, photo_summary_json, created_at, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mark')
    ON CONFLICT(job_id, opening_index) DO UPDATE SET measurements_json=excluded.measurements_json, notes=excluded.notes, exception_status=excluded.exception_status, exception_notes=excluded.exception_notes, material_usage_json=excluded.material_usage_json, photo_summary_json=excluded.photo_summary_json, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
    .bind(jobId, openingIndex, JSON.stringify(measurements), notes, exceptionStatus, exceptionNotes, JSON.stringify(materialUsage), JSON.stringify(photoSummary), existing?.created_at || now, now).run();

  const saved = await env.QUOTES_DB.prepare(`SELECT * FROM job_opening_evidence WHERE job_id = ? AND opening_index = ?`).bind(jobId, openingIndex).first();
  return json({ ok: true, evidence: { ...saved, measurements, materialUsage, photoSummary } });
}
