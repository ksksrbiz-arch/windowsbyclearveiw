// Counts where /ask conversations lead: the estimate page, the phone number, or
// the call-back form. Stores a kind and a timestamp only. No visitor id, no
// text, no IP, so this stays a count and never becomes a profile. The call-back
// form itself is a normal lead through /api/estimate (role "Ask assistant"),
// which is counted from the leads table instead.
//
// _middleware.js in this directory already enforces same-origin, POST and a
// JSON body, so this file only validates the one field it accepts.

const KINDS = new Set(['estimate', 'call', 'callback_open']);
const MAX_BODY_CHARS = 512;

const SCHEMA = `CREATE TABLE IF NOT EXISTS ask_handoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL
)`;
const INDEX = 'CREATE INDEX IF NOT EXISTS ask_handoffs_created_at ON ask_handoffs (created_at DESC)';

// Remembered per database binding, so the DDL runs once per cold start rather
// than on every click. A failed attempt is forgotten so the next click retries.
const schemaReady = new WeakMap();

function ensureSchema(db) {
  let pending = schemaReady.get(db);
  if (!pending) {
    pending = db.batch([db.prepare(SCHEMA), db.prepare(INDEX)]).catch((error) => {
      schemaReady.delete(db);
      throw error;
    });
    schemaReady.set(db, pending);
  }
  return pending;
}

function reply(status, body) {
  return new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...(body ? { 'content-type': 'application/json; charset=utf-8' } : {}),
    },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const text = await request.text().catch(() => '');
  if (text.length > MAX_BODY_CHARS) return reply(413, { error: 'Request is too large.' });

  let kind;
  try {
    kind = JSON.parse(text)?.kind;
  } catch {
    return reply(400, { error: 'Send a JSON body.' });
  }
  if (typeof kind !== 'string' || !KINDS.has(kind)) return reply(400, { error: 'Unknown handoff kind.' });

  // Measurement must never get in the way of the visitor: a missing or failing
  // database is logged and answered with success.
  const db = env?.QUOTES_DB;
  if (!db) return reply(204);
  try {
    await ensureSchema(db);
    await db
      .prepare('INSERT INTO ask_handoffs (created_at, kind) VALUES (?, ?)')
      .bind(new Date().toISOString(), kind)
      .run();
  } catch (error) {
    console.error('ask-handoff-log-failed', error?.message || error);
  }
  return reply(204);
}
