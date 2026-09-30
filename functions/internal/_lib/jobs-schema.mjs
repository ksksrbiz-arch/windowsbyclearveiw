// The jobs table is created lazily, like the rest of this app's schema, and several endpoints
// read it (the jobs API, the dashboard, Payments, the copilot summary). Every one of them calls
// ensureJobsSchema first so the order in which pages are opened on a new database cannot matter.
// Statements here are the original jobs definitions, moved out of api/jobs.js unchanged.
import { ensureGeneralJobColumns } from './general-jobs.mjs';

const ready = new WeakSet();

export async function ensureJobsSchema(db) {
  if (ready.has(db)) return;
  await db.batch([
  db.prepare(`CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,quote_id TEXT UNIQUE,status TEXT NOT NULL DEFAULT 'ready',scheduled_date TEXT,scheduled_window TEXT,customer_name TEXT NOT NULL,customer_phone TEXT,customer_email TEXT,customer_address TEXT,customer_city TEXT,notes TEXT,install_notes TEXT,closeout_notes TEXT,completed_at TEXT,created_by TEXT NOT NULL DEFAULT 'mark')`),
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`),
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_date ON jobs(scheduled_date)`),
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC)`),
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_jobs_quote_id ON jobs(quote_id)`),
  ]);
  for (const sql of [`ALTER TABLE jobs ADD COLUMN build_plan_json TEXT`,`ALTER TABLE jobs ADD COLUMN build_plan_version INTEGER`,`ALTER TABLE jobs ADD COLUMN build_plan_knowledge_version TEXT`,`ALTER TABLE jobs ADD COLUMN build_plan_attached_at TEXT`,`ALTER TABLE jobs ADD COLUMN build_plan_attached_by TEXT`]) {
    try { await db.prepare(sql).run(); } catch {}
  }
  await ensureGeneralJobColumns(db);
  ready.add(db);
}
