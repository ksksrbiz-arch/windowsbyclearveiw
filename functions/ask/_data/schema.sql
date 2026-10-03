-- Lives in the same D1 database as the internal quoting tool (QUOTES_DB) —
-- reusing that binding rather than provisioning a second database and a
-- second dashboard binding for one small table. One row per answered turn:
-- activity metadata (model, tools, guide sources, match count, refused) plus
-- the question and answer, scrubbed of contact details by
-- functions/ask/_lib/log-scrub.mjs and kept for 30 days only. Rows older than
-- that are deleted on insert, hidden on read and purged nightly by
-- workers/ops-cron; the nightly backup leaves question/answer out.
-- Rows written before 2026-10-03 hold "[redacted]" instead of words.
CREATE TABLE IF NOT EXISTS ask_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  model_used TEXT NOT NULL,
  tools_used TEXT NOT NULL DEFAULT '[]',
  sources TEXT NOT NULL DEFAULT '[]',
  match_count INTEGER NOT NULL DEFAULT 0,
  refused INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ask_logs_created_at ON ask_logs (created_at DESC);


-- Where /ask conversations lead (estimate page, phone, call-back form). A kind
-- and a timestamp only; created on demand by functions/ask/api/handoff.js, so
-- applying this file is optional.
CREATE TABLE IF NOT EXISTS ask_handoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ask_handoffs_created_at ON ask_handoffs (created_at DESC);
