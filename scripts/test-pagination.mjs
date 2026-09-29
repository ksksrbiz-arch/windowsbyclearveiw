import { createD1 } from './_lib/d1-sqlite.mjs';
import * as jobs from '../functions/internal/api/jobs.js';
import * as quotes from '../functions/internal/api/quotes/index.js';
import * as tasks from '../functions/internal/api/tasks.js';

const assert = (condition, message) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
};
async function get(handler, db, path) {
  const response = await handler({ request: new Request(`https://windowsbyclearview.com${path}`), env: { QUOTES_DB: db } });
  return { status: response.status, body: await response.json() };
}
function seed(db, table, create, rows) {
  db.raw.exec(create);
  const insert = db.raw.prepare(`INSERT INTO ${table} VALUES (${rows[0].map(() => '?').join(',')})`);
  for (const row of rows) insert.run(...row);
}

const db = createD1({ schemaFiles: ['internal/db/schema.sql'] });
seed(db, 'jobs', `CREATE TABLE jobs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, quote_id TEXT, status TEXT NOT NULL, scheduled_date TEXT, customer_name TEXT NOT NULL);`,
  Array.from({ length: 205 }, (_, i) => [`J-${String(i + 1).padStart(3, '0')}`, `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`, '2026-01-01T00:00:00.000Z', null, 'ready', null, `Customer ${i + 1}`]));
const jobFirst = await get(jobs.onRequestGet, db, '/internal/api/jobs?page=1');
const jobSecond = await get(jobs.onRequestGet, db, '/internal/api/jobs?page=2');
assert(jobFirst.status === 200 && jobFirst.body.jobs.length === 200 && jobFirst.body.total === 205 && jobFirst.body.totalPages === 2, 'jobs page 1 returns bounded rows and accurate totals');
assert(jobSecond.body.jobs.length === 5 && jobSecond.body.page === 2 && jobSecond.body.jobs.every((item) => !jobFirst.body.jobs.some((first) => first.id === item.id)), 'jobs page 2 returns remaining non-duplicate rows');

const quoteInsert = db.raw.prepare(`INSERT INTO quotes (id,created_at,updated_at,status,customer_name,customer_city,total_cents,signature_method) VALUES (?,?,?,'draft',?,'Vancouver',10000,NULL)`);
for (let i = 0; i < 205; i++) quoteInsert.run(`Q-${String(i + 1).padStart(3, '0')}`, `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`, '2026-01-01T00:00:00.000Z', `Customer ${i + 1}`);
const quoteFirst = await get(quotes.onRequestGet, db, '/internal/api/quotes?page=1');
const quoteSecond = await get(quotes.onRequestGet, db, '/internal/api/quotes?page=2');
assert(quoteFirst.status === 200 && quoteFirst.body.quotes.length === 200 && quoteFirst.body.total === 205 && quoteFirst.body.totalPages === 2, 'quotes page 1 returns bounded rows and accurate totals');
assert(quoteSecond.body.quotes.length === 5 && quoteSecond.body.page === 2 && quoteSecond.body.quotes.every((item) => !quoteFirst.body.quotes.some((first) => first.id === item.id)), 'quotes page 2 returns remaining non-duplicate rows');

seed(db, 'follow_up_tasks', `CREATE TABLE follow_up_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, lead_id INTEGER, title TEXT NOT NULL, due_at TEXT, status TEXT NOT NULL DEFAULT 'open', notes TEXT, created_by TEXT NOT NULL DEFAULT 'mark');`,
  Array.from({ length: 205 }, (_, i) => [i + 1, `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`, '2026-01-01T00:00:00.000Z', null, `Task ${i + 1}`, null, 'open', null, 'mark']));
db.raw.exec(`CREATE TABLE leads (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, email TEXT, city TEXT);`);
const taskFirst = await get(tasks.onRequestGet, db, '/internal/api/tasks?page=1');
const taskSecond = await get(tasks.onRequestGet, db, '/internal/api/tasks?page=2');
assert(taskFirst.status === 200 && taskFirst.body.tasks.length === 200 && taskFirst.body.total === 205 && taskFirst.body.totalPages === 2, 'tasks page 1 returns bounded rows and accurate totals');
assert(taskSecond.body.tasks.length === 5 && taskSecond.body.page === 2 && taskSecond.body.tasks.every((item) => !taskFirst.body.tasks.some((first) => first.id === item.id)), 'tasks page 2 returns remaining non-duplicate rows');

console.log('Pagination handler tests passed.');
