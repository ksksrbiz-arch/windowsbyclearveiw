// Nightly D1 backup to a private R2 bucket. Pure functions over a D1-shaped `db` and an R2-shaped
// `bucket`, so scripts/test-ops-cron.mjs runs them on real SQLite.
//
// A backup is one gzip-compressed JSON file: for every table, its CREATE statement and all rows.
// That is enough to rebuild the database with scripts/restore-from-backup.mjs. D1's own Time
// Travel still exists; this is the copy we control and can read without Cloudflare.

export const BACKUP_PREFIX = 'd1/';
export const KEEP_DAILY = 30;
const PAGE = 500;
const SKIP = /^(sqlite_|_cf_|d1_)/;

export const backupKey = (now = new Date()) => `${BACKUP_PREFIX}${now.toISOString().slice(0, 10)}.json.gz`;

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

/** Every user table with its CREATE statement and rows. Blobs are base64 so the file stays JSON. */
export async function dumpDatabase(db, now = new Date()) {
  const { results: tables } = await db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL ORDER BY name")
    .all();
  const { results: extras } = await db
    .prepare("SELECT sql FROM sqlite_master WHERE type IN ('index', 'trigger', 'view') AND sql IS NOT NULL ORDER BY name")
    .all();
  const dump = { version: 1, createdAt: now.toISOString(), tables: {}, extras: extras.map((row) => row.sql) };
  for (const { name, sql } of tables) {
    if (SKIP.test(name)) continue;
    const rows = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await db.prepare(`SELECT * FROM ${quoteIdent(name)} LIMIT ${PAGE} OFFSET ${offset}`).all();
      rows.push(...page.results.map(encodeRow));
      if (page.results.length < PAGE) break;
    }
    dump.tables[name] = { sql, rows };
  }
  return dump;
}

function encodeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      out[key] = { $base64: btoa(String.fromCharCode(...bytes)) };
    } else if (Array.isArray(value)) {
      out[key] = { $base64: btoa(String.fromCharCode(...value)) };
    } else out[key] = value;
  }
  return out;
}

export async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** Dump, compress, store. Verifies the stored object by reading its size back; throws on any doubt. */
export async function runBackup(db, bucket, now = new Date()) {
  const dump = await dumpDatabase(db, now);
  const tableCount = Object.keys(dump.tables).length;
  if (!tableCount) throw new Error('Backup refused: the database has no tables.');
  const body = await gzip(JSON.stringify(dump));
  const key = backupKey(now);
  await bucket.put(key, body, { httpMetadata: { contentType: 'application/gzip' }, customMetadata: { tables: String(tableCount) } });
  const head = await bucket.head(key);
  if (!head || head.size !== body.byteLength) throw new Error('Backup refused: the stored file does not match what was written.');
  const rows = Object.values(dump.tables).reduce((sum, table) => sum + table.rows.length, 0);
  return { key, bytes: body.byteLength, tables: tableCount, rows };
}

/** Keeps the newest `keep` daily backups and deletes the rest. Never deletes today's. */
export async function pruneBackups(bucket, now = new Date(), keep = KEEP_DAILY) {
  const listed = await bucket.list({ prefix: BACKUP_PREFIX });
  const keys = listed.objects.map((object) => object.key).filter((key) => /^d1\/\d{4}-\d{2}-\d{2}\.json\.gz$/.test(key)).sort().reverse();
  const doomed = keys.slice(keep).filter((key) => key !== backupKey(now));
  for (const key of doomed) await bucket.delete(key);
  return doomed;
}
