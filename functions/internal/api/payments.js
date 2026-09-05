function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}

async function ensureSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS job_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      amount_paid_cents INTEGER NOT NULL DEFAULT 0,
      payment_method TEXT,
      notes TEXT
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_job_payments_job ON job_payments(job_id)`),
  ]);
}

async function ensurePayment(db, jobId) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT OR IGNORE INTO job_payments (job_id, created_at, updated_at, amount_paid_cents) VALUES (?, ?, ?, 0)`).bind(jobId, now, now).run();
  return db.prepare(`SELECT * FROM job_payments WHERE job_id = ?`).bind(jobId).first();
}

function buildRecord(job, payment) {
  const total = Math.max(0, Number(job?.total_cents) || 0);
  const paid = Math.max(0, Number(payment?.amount_paid_cents) || 0);
  const balance = Math.max(0, total - paid);
  const status = paid <= 0 ? 'unpaid' : balance <= 0 ? 'paid' : 'partial';
  return { ...payment, status, total_cents: total, balance_cents: balance };
}

export async function onRequestGet(context) {
  const { env } = context;
  await ensureSchema(env.QUOTES_DB);
  const url = new URL(context.request.url);
  const jobId = url.searchParams.get('jobId');

  if (jobId) {
    const job = await env.QUOTES_DB.prepare(`SELECT j.*, q.total_cents FROM jobs j LEFT JOIN quotes q ON q.id = j.quote_id WHERE j.id = ?`).bind(jobId).first();
    if (!job) return json({ error: 'Job not found.' }, 404);
    const payment = await ensurePayment(env.QUOTES_DB, jobId);
    return json({ job, payment: buildRecord(job, payment) });
  }

  const result = await env.QUOTES_DB.prepare(`
    SELECT j.id, j.status AS job_status, j.scheduled_date, j.customer_name, j.customer_city,
           q.total_cents, p.id AS payment_id, p.amount_paid_cents, p.payment_method, p.notes, p.updated_at AS payment_updated_at
    FROM jobs j
    LEFT JOIN quotes q ON q.id = j.quote_id
    LEFT JOIN job_payments p ON p.job_id = j.id
    WHERE j.status <> 'cancelled'
    ORDER BY CASE WHEN j.status = 'completed' THEN 1 ELSE 0 END, COALESCE(j.scheduled_date, '9999-12-31') ASC, j.created_at DESC
    LIMIT 200
  `).all();

  const jobs = (result.results || []).map((row) => {
    const total = Math.max(0, Number(row.total_cents) || 0);
    const paid = Math.max(0, Number(row.amount_paid_cents) || 0);
    return { ...row, amount_paid_cents: paid, balance_cents: Math.max(0, total - paid), payment_status: paid <= 0 ? 'unpaid' : paid >= total ? 'paid' : 'partial' };
  });
  return json({ jobs });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  await ensureSchema(env.QUOTES_DB);
  const jobId = new URL(context.request.url).searchParams.get('jobId');
  if (!jobId) return json({ error: 'jobId is required.' }, 400);

  const job = await env.QUOTES_DB.prepare(`SELECT j.*, q.total_cents FROM jobs j LEFT JOIN quotes q ON q.id = j.quote_id WHERE j.id = ?`).bind(jobId).first();
  if (!job) return json({ error: 'Job not found.' }, 404);
  if (job.status === 'cancelled') return json({ error: 'Cancelled jobs cannot receive payment records.' }, 409);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }

  const total = Math.max(0, Number(job.total_cents) || 0);
  const current = await ensurePayment(env.QUOTES_DB, jobId);
  let amountPaid = current.amount_paid_cents;
  if (body.amountPaidCents !== undefined) {
    amountPaid = Number(body.amountPaidCents);
    if (!Number.isFinite(amountPaid) || amountPaid < 0 || amountPaid > total) {
      return json({ error: `Amount paid must be between $0 and ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(total / 100)}.` }, 400);
    }
    amountPaid = Math.round(amountPaid);
  }
  const method = typeof body.paymentMethod === 'string' ? body.paymentMethod.trim().slice(0, 80) || null : current.payment_method;
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 4000) : current.notes;
  const now = new Date().toISOString();

  await env.QUOTES_DB.prepare(`UPDATE job_payments SET updated_at = ?, amount_paid_cents = ?, payment_method = ?, notes = ? WHERE job_id = ?`)
    .bind(now, amountPaid, method, notes, jobId).run();

  const payment = await env.QUOTES_DB.prepare(`SELECT * FROM job_payments WHERE job_id = ?`).bind(jobId).first();
  return json({ ok: true, payment: buildRecord(job, payment) });
}
