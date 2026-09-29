// Minimal Cloudflare D1 stand-in backed by Node's built-in SQLite, so tests
// can execute the real Pages Function handlers against a real SQL engine
// (constraints, triggers, ON CONFLICT) instead of regex-matching their source.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

function bindable(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

export function createD1({ schemaFiles = [] } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const file of schemaFiles) db.exec(fs.readFileSync(file, 'utf8'));

  function statement(sql, args = []) {
    return {
      bind: (...next) => statement(sql, next.map(bindable)),
      async first(column) {
        const row = db.prepare(sql).get(...args);
        if (!row) return null;
        return column ? row[column] : { ...row };
      },
      async all() {
        return { results: db.prepare(sql).all(...args).map((row) => ({ ...row })), success: true };
      },
      async run() {
        const info = db.prepare(sql).run(...args);
        return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
      },
      _exec() {
        return db.prepare(sql).run(...args);
      },
    };
  }

  return {
    raw: db,
    prepare: (sql) => statement(sql),
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const out = statements.map((s) => s._exec());
        db.exec('COMMIT');
        // Like D1: one result per statement, with its affected-row count.
        return out.map((info) => ({ success: true, meta: { changes: Number(info?.changes ?? 0), last_row_id: Number(info?.lastInsertRowid ?? 0) } }));
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    async exec(sql) {
      db.exec(sql);
    },
  };
}
