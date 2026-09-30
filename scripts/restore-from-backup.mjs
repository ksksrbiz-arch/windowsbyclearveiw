// Turns a nightly backup (d1/YYYY-MM-DD.json.gz from the clearview-db-backups R2 bucket) into SQL.
//
//   node scripts/restore-from-backup.mjs backup.json.gz > restore.sql
//   npx wrangler d1 execute clearveiw-quotes --remote --file restore.sql     # into a NEW/empty database
//
// It only prints SQL; it never touches a database. Restore into an empty database (create one with
// `wrangler d1 create`), check it, then point the Pages binding at it. Do not run it over live data.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;
function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'object' && typeof value.$base64 === 'string') return `X'${Buffer.from(value.$base64, 'base64').toString('hex')}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function backupToSql(dump) {
  if (dump?.version !== 1 || typeof dump.tables !== 'object') throw new Error('Not a Clearview backup file.');
  const lines = ['-- Restored from a Clearview backup taken ' + dump.createdAt, 'PRAGMA foreign_keys = OFF;'];
  for (const [name, table] of Object.entries(dump.tables)) {
    lines.push(`${table.sql};`);
    for (const row of table.rows) {
      const cols = Object.keys(row);
      lines.push(`INSERT INTO ${ident(name)} (${cols.map(ident).join(', ')}) VALUES (${cols.map((c) => literal(row[c])).join(', ')});`);
    }
  }
  for (const sql of dump.extras || []) lines.push(`${sql};`);
  lines.push('PRAGMA foreign_keys = ON;');
  return lines.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/restore-from-backup.mjs <backup.json.gz> > restore.sql'); process.exit(2); }
  const raw = readFileSync(file);
  const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  process.stdout.write(backupToSql(JSON.parse(text)));
}
