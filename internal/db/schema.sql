-- Clearview internal quoting tool — D1 schema.
--
-- Money is stored in integer cents throughout, never as a float, so rounding
-- can never silently drift a real contract total.
--
-- There is deliberately no sessions table: the login gate is a stateless
-- HMAC-signed cookie (see functions/internal/_middleware.js), so there is
-- nothing here to expire or clean up for a single shared-password login.

CREATE TABLE IF NOT EXISTS quotes (
  id                 TEXT PRIMARY KEY,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'draft',
  customer_name      TEXT NOT NULL,
  customer_phone     TEXT,
  customer_email     TEXT,
  customer_address   TEXT,
  customer_city      TEXT,
  customer_role      TEXT,
  notes              TEXT,
  subtotal_cents     INTEGER NOT NULL DEFAULT 0,
  discount_cents     INTEGER NOT NULL DEFAULT 0,
  discount_reason    TEXT,
  total_cents        INTEGER NOT NULL DEFAULT 0,
  terms_version      TEXT,
  signature_method   TEXT,
  signature_svg      TEXT,
  signature_name     TEXT,
  signed_at          TEXT,
  created_by         TEXT NOT NULL DEFAULT 'mark'
);

CREATE INDEX IF NOT EXISTS idx_quotes_created_at ON quotes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_customer_name ON quotes(customer_name);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);

CREATE TABLE IF NOT EXISTS quote_items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id           TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  sort_order         INTEGER NOT NULL,
  label              TEXT NOT NULL,
  description        TEXT,
  quantity           INTEGER NOT NULL DEFAULT 1,
  unit_price_cents   INTEGER NOT NULL,
  line_total_cents   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quote_items_quote_id ON quote_items(quote_id);

CREATE TABLE IF NOT EXISTS invoices (
  id                 TEXT PRIMARY KEY,
  invoice_number     TEXT NOT NULL UNIQUE,
  quote_id           TEXT NOT NULL UNIQUE REFERENCES quotes(id),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'draft',
  customer_name      TEXT NOT NULL,
  customer_phone     TEXT,
  customer_email     TEXT,
  customer_address   TEXT,
  customer_city      TEXT,
  subtotal_cents     INTEGER NOT NULL DEFAULT 0,
  discount_cents     INTEGER NOT NULL DEFAULT 0,
  discount_reason    TEXT,
  total_cents        INTEGER NOT NULL DEFAULT 0,
  sent_at            TEXT,
  paid_at            TEXT,
  voided_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

CREATE TABLE IF NOT EXISTS invoice_items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id         TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  sort_order         INTEGER NOT NULL,
  label              TEXT NOT NULL,
  description        TEXT,
  quantity           INTEGER NOT NULL DEFAULT 1,
  unit_price_cents   INTEGER NOT NULL,
  line_total_cents   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);

-- Opening-level field evidence is intentionally separate from the checklist.
-- The checklist answers "was the gate completed?"; this record answers
-- "what did the crew actually observe, use, and document at that opening?".
CREATE TABLE IF NOT EXISTS job_opening_evidence (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id               TEXT NOT NULL,
  opening_index        INTEGER NOT NULL,
  measurements_json    TEXT NOT NULL DEFAULT '{}',
  notes                TEXT NOT NULL DEFAULT '',
  exception_status     TEXT NOT NULL DEFAULT 'none',
  exception_notes      TEXT NOT NULL DEFAULT '',
  material_usage_json  TEXT NOT NULL DEFAULT '{}',
  photo_summary_json   TEXT NOT NULL DEFAULT '{}',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  updated_by           TEXT NOT NULL DEFAULT 'mark',
  UNIQUE(job_id, opening_index)
);

CREATE INDEX IF NOT EXISTS idx_job_opening_evidence_job
  ON job_opening_evidence(job_id, opening_index);
