function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } });
}

async function ensureSchema(db) {
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

export async function onRequestGet(context) {
  const { env } = context;
  await ensureSchema(env.QUOTES_DB);
  const url = new URL(context.request.url);
  const leadId = url.searchParams.get('leadId');
  const where = leadId ? 'WHERE t.lead_id = ?' : '';
  const statement = env.QUOTES_DB.prepare(`
    SELECT t.*, l.name AS lead_name, l.phone AS lead_phone, l.email AS lead_email, l.city AS lead_city
    FROM follow_up_tasks t
    LEFT JOIN leads l ON l.id = t.lead_id
    ${where}
    ORDER BY CASE WHEN t.status = 'open' THEN 0 ELSE 1 END, COALESCE(t.due_at, '9999-12-31T23:59:59Z') ASC, t.created_at DESC
    LIMIT 200
  `);
  const result = leadId ? await statement.bind(leadId).all() : await statement.all();
  return json({ tasks: result.results || [] });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  await ensureSchema(env.QUOTES_DB);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 240) : '';
  if (!title) return json({ error: 'Task title is required.' }, 400);
  const leadId = Number.isInteger(Number(body.leadId)) ? Number(body.leadId) : null;
  const dueAt = typeof body.dueAt === 'string' ? body.dueAt.trim().slice(0, 40) || null : null;
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 4000) : null;
  const now = new Date().toISOString();
  const result = await env.QUOTES_DB.prepare(`INSERT INTO follow_up_tasks (created_at, updated_at, lead_id, title, due_at, notes) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(now, now, leadId, title, dueAt, notes).run();
  return json({ id: result.meta?.last_row_id || null }, 201);
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  await ensureSchema(env.QUOTES_DB);
  const id = new URL(context.request.url).searchParams.get('id');
  if (!id) return json({ error: 'Task id is required.' }, 400);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const current = await env.QUOTES_DB.prepare(`SELECT * FROM follow_up_tasks WHERE id = ?`).bind(id).first();
  if (!current) return json({ error: 'Task not found.' }, 404);
  const status = ['open', 'done'].includes(body.status) ? body.status : current.status;
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 240) || current.title : current.title;
  const dueAt = typeof body.dueAt === 'string' ? body.dueAt.trim().slice(0, 40) || null : current.due_at;
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 4000) : current.notes;
  await env.QUOTES_DB.prepare(`UPDATE follow_up_tasks SET updated_at = ?, title = ?, due_at = ?, notes = ?, status = ? WHERE id = ?`)
    .bind(new Date().toISOString(), title, dueAt, notes, status, id).run();
  return json({ ok: true });
}
