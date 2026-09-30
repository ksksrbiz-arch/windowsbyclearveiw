// Companion Worker: nightly D1 backup to R2 (and restore), retention, and the weekday follow-up
// nudge. Real SQLite for D1, an in-memory R2, and a restore into a second database to prove the
// backup is actually usable, not just written.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createD1 } from './_lib/d1-sqlite.mjs';
import { backupKey, dumpDatabase, gunzip, pruneBackups, runBackup, KEEP_DAILY } from '../workers/ops-cron/src/backup.mjs';
import { countFollowUps, digestMessage, pacificDayBounds } from '../workers/ops-cron/src/digest.mjs';
import worker, { BACKUP_CRON, DIGEST_CRON, handleScheduled } from '../workers/ops-cron/src/index.js';
import { backupToSql } from './restore-from-backup.mjs';
import { pacificDayRange } from '../functions/internal/api/dashboard.js';
import { ensureFollowUpSchema } from '../functions/internal/_lib/quote-follow-ups.mjs';
import { ensureJobsSchema } from '../functions/internal/_lib/jobs-schema.mjs';
import { ensurePhotoSchema } from '../functions/internal/_lib/job-photos.mjs';

process.removeAllListeners('warning');
let groups = 0;
const ok = async (fn) => { await fn(); groups++; };

function memoryR2() {
  const objects = new Map();
  return {
    objects,
    async put(key, body, options = {}) { objects.set(key, { body: new Uint8Array(body), size: body.byteLength, ...options }); },
    async head(key) { const o = objects.get(key); return o ? { size: o.size } : null; },
    async get(key) { const o = objects.get(key); return o ? { body: o.body, arrayBuffer: async () => o.body.buffer } : null; },
    async delete(key) { objects.delete(key); },
    async list({ prefix = '' } = {}) { return { objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
  };
}

async function seededDb() {
  const db = createD1({ schemaFiles: ['functions/api/_data/schema.sql'] });
  await ensureFollowUpSchema(db);
  await ensureJobsSchema(db);
  await ensurePhotoSchema(db);
  db.raw.exec(`INSERT INTO leads (name, phone, city, created_at) VALUES ('Zoë O''Brien "Z"', '(360) 555-0100', 'Camas', '2026-09-01T10:00:00Z'), ('Pat', '(360) 555-0101', NULL, '2026-09-02T10:00:00Z')`);
  db.raw.exec(`CREATE TABLE IF NOT EXISTS blobs (id INTEGER PRIMARY KEY, data BLOB, note TEXT)`);
  db.raw.prepare('INSERT INTO blobs (data, note) VALUES (?, ?)').run(new Uint8Array([0, 1, 2, 250, 255]), 'line one\nline two');
  return db;
}

const tableNames = (raw) => raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const rowsOf = (raw, name) => raw.prepare(`SELECT * FROM "${name}"`).all().map((r) => JSON.parse(JSON.stringify(r, (k, v) => (v instanceof Uint8Array ? [...v] : v))));

await ok(async () => {
  const db = await seededDb();
  const bucket = memoryR2();
  const now = new Date('2026-09-30T10:15:00Z');
  const result = await runBackup(db, bucket, now);
  assert.equal(result.key, 'd1/2026-09-30.json.gz');
  assert.ok(result.tables >= 5 && result.rows >= 3);
  assert.equal(bucket.objects.get(result.key).body[0], 0x1f, 'the stored file is gzip');

  // Restore into a brand-new database and compare every table row for row.
  const stored = await bucket.get(result.key);
  const sql = backupToSql(JSON.parse(await gunzip(stored.body)));
  const fresh = new DatabaseSync(':memory:');
  fresh.exec(sql);
  assert.deepEqual(tableNames(fresh), tableNames(db.raw), 'same tables');
  for (const name of tableNames(db.raw)) assert.deepEqual(rowsOf(fresh, name), rowsOf(db.raw, name), `table ${name} restores identically`);
  const indexes = (raw) => raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(indexes(fresh), indexes(db.raw), 'indexes come back too');
  assert.equal(fresh.prepare("SELECT name FROM leads WHERE city = 'Camas'").get().name, 'Zoë O\'Brien "Z"', 'quotes and accents survive');
  assert.deepEqual([...fresh.prepare('SELECT data FROM blobs').get().data], [0, 1, 2, 250, 255], 'binary survives');
});

await ok(async () => {
  const db = createD1();
  db.raw.exec('CREATE TABLE big (id INTEGER PRIMARY KEY, v TEXT)');
  const insert = db.raw.prepare('INSERT INTO big (v) VALUES (?)');
  for (let i = 0; i < 1234; i++) insert.run(`row ${i}`);
  const dump = await dumpDatabase(db);
  assert.equal(dump.tables.big.rows.length, 1234, 'paging loses and duplicates nothing');
  assert.equal(new Set(dump.tables.big.rows.map((r) => r.id)).size, 1234);
  await assert.rejects(runBackup(createD1(), memoryR2()), /no tables/, 'an empty database is never reported as a good backup');
  const lying = memoryR2();
  lying.head = async () => ({ size: 1 });
  await assert.rejects(runBackup(db, lying), /does not match/, 'a short write is caught');
});

await ok(async () => {
  const bucket = memoryR2();
  for (let d = 1; d <= 40; d++) bucket.objects.set(`d1/2026-08-${String(d).padStart(2, '0')}.json.gz`.replace('2026-08-3', '2026-09-0').replace('2026-08-4', '2026-09-1'), { size: 1 });
  bucket.objects.set('photos/keep-me.jpg', { size: 1 });
  bucket.objects.set('d1/notes.txt', { size: 1 });
  const before = [...bucket.objects.keys()].filter((k) => /^d1\/\d{4}/.test(k)).length;
  const removed = await pruneBackups(bucket, new Date('2026-09-30T10:15:00Z'));
  assert.equal(removed.length, before - KEEP_DAILY);
  const left = [...bucket.objects.keys()].filter((k) => /^d1\/\d{4}/.test(k));
  assert.equal(left.length, KEEP_DAILY);
  assert.ok(bucket.objects.has('photos/keep-me.jpg') && bucket.objects.has('d1/notes.txt'), 'only dated backups are ever deleted');
  assert.ok(!removed.some((k) => left.includes(k)) && removed.every((k) => k < left.sort()[0]), 'the oldest go first');
});

await ok(async () => {
  // The Pacific day used by the nudge matches the one the dashboard shows, across both DST changes.
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 6 * 3_600_000 + 1_234_000) {
    const mine = pacificDayBounds(new Date(t));
    const theirs = pacificDayRange(new Date(t));
    assert.equal(mine.start.toISOString(), theirs.start, `day start at ${new Date(t).toISOString()}`);
    assert.equal(mine.end.toISOString(), theirs.end);
  }
});

await ok(async () => {
  const db = createD1();
  assert.deepEqual(await countFollowUps(db), { overdue: 0, today: 0 }, 'a database with no follow-up table is quiet');
  await ensureFollowUpSchema(db);
  const now = new Date('2026-09-30T15:30:00Z'); // 8:30 AM Pacific
  const add = (due, status = 'open') => db.raw.prepare("INSERT INTO follow_up_tasks (created_at, updated_at, title, due_at, status) VALUES ('x', 'x', 't', ?, ?)").run(due, status);
  add('2026-09-29T20:00:00.000Z');          // yesterday: overdue
  add('2026-09-30T08:00:00.000Z');          // 1 AM today Pacific: earlier today, not yesterday -> today
  add('2026-09-30T23:00:00.000Z');          // 4 PM today Pacific: today
  add('2026-10-01T12:00:00.000Z');          // tomorrow: not counted
  add(null);                                // no date: not counted
  add('2026-09-20T00:00:00.000Z', 'done');  // finished: not counted
  assert.deepEqual(await countFollowUps(db, now), { overdue: 1, today: 2 });
  assert.equal(digestMessage({ overdue: 0, today: 0 }), null, 'no message on a quiet morning');
  assert.deepEqual(digestMessage({ overdue: 1, today: 2 }), { title: '3 follow-ups to do', body: '1 overdue, 2 due today. Tap to open the list.' });
  assert.equal(digestMessage({ overdue: 0, today: 1 }).title, '1 follow-up to do');
  assert.ok(!/[A-Z][a-z]+ [A-Z][a-z]+/.test(digestMessage({ overdue: 1, today: 2 }).body.replace('Tap to open the list.', '')), 'no names in the push');
});

await ok(async () => {
  const alerts = [];
  const alert = async (env, message) => { alerts.push(message); return { status: 'sent' }; };
  const db = await seededDb();
  const env = { QUOTES_DB: db, DB_BACKUPS: memoryR2() };
  const good = await handleScheduled(BACKUP_CRON, env, new Date('2026-09-30T10:15:00Z'), alert);
  assert.equal(good.ok, true);
  assert.equal(alerts.length, 0, 'a good backup is silent');
  assert.ok(env.DB_BACKUPS.objects.has('d1/2026-09-30.json.gz'));

  const quiet = console.error; console.error = () => {};
  const bad = await handleScheduled(BACKUP_CRON, { QUOTES_DB: db, DB_BACKUPS: { ...memoryR2(), put: async () => { throw new Error('r2 down'); } } }, new Date(), alert);
  console.error = quiet;
  assert.equal(bad.ok, false);
  assert.equal(alerts.length, 1, 'a failed backup is never silent');
  assert.match(alerts[0].title, /backup FAILED/);
  assert.ok(!/r2 down/.test(alerts[0].body), 'internal error text stays out of the push');

  alerts.length = 0;
  const empty = await handleScheduled(DIGEST_CRON, { QUOTES_DB: createD1() }, new Date('2026-09-30T15:30:00Z'), alert);
  assert.deepEqual([empty.ok, empty.sent, alerts.length], [true, false, 0], 'no push when nothing is due');
  const unknown = await handleScheduled('0 0 * * *', env, new Date(), alert);
  assert.equal(unknown.ok, false);

  const res = await worker.fetch();
  assert.equal(res.status, 404, 'the Worker has no public surface');
});

await ok(() => {
  const toml = readFileSync(new URL('../workers/ops-cron/wrangler.toml', import.meta.url), 'utf8');
  assert.ok(toml.includes(`"${BACKUP_CRON}"`) && toml.includes(`"${DIGEST_CRON}"`), 'wrangler crons match the handler');
  assert.ok(toml.includes('binding = "DB_BACKUPS"') && toml.includes('binding = "QUOTES_DB"'));
  assert.ok(toml.includes('workers_dev = false'), 'no public URL');
  assert.ok(!/secret|password|token\s*=/i.test(toml.replace(/^#.*$/gm, '')), 'no secrets in the config');
  assert.equal(backupKey(new Date('2026-01-02T03:04:05Z')), 'd1/2026-01-02.json.gz');
});

console.log(`ops cron: ok (${groups} groups)`);
