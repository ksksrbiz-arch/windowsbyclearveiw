-- Clearveiw internal quoting tool — D1 schema.
--
-- Money is stored in integer cents throughout, never as a float, so rounding
-- can never silently drift a real contract total.
--
-- There is deliberately no sessions table: the login gate is a stateless
-- HMAC-signed cookie (see functions/internal/_middleware.js), so there is
-- nothing here to expire or clean up for a single shared-password login.

CREATE TABLE IF NOT EXISTS quotes (
  id                 TEXT PRIMARY KEY,       -- short readable id, e.g. Q-20260828-4F2A
  created_at         TEXT NOT NULL,          -- ISO 8601
  updated_at         TEXT NOT NULL,

  -- 'draft' while Mark is still building it; 'finalized' once it is printed
  -- or signed and should no longer change.
  status             TEXT NOT NULL DEFAULT 'draft',

  customer_name      TEXT NOT NULL,
  customer_phone     TEXT,
  customer_email     TEXT,
  customer_address   TEXT,
  customer_city      TEXT,
  customer_role      TEXT,                   -- 'Homeowner' | 'Builder / GC'
  notes              TEXT,

  subtotal_cents     INTEGER NOT NULL DEFAULT 0,
  discount_cents     INTEGER NOT NULL DEFAULT 0,
  discount_reason    TEXT,
  total_cents        INTEGER NOT NULL DEFAULT 0,

  -- Which copy of the contract terms this quote actually showed the customer.
  -- If the wording changes later, an old quote's printed record stays
  -- honest about what was agreed to at the time.
  terms_version      TEXT,

  -- 'digital' (drawn on screen) | 'pen' (printed blank, signed by hand) | NULL (not yet signed)
  signature_method   TEXT,
  -- Captured as an inline SVG path, not a rasterized image: a signature is a
  -- handful of strokes, and storing it as vector data keeps it a few hundred
  -- bytes instead of tens of kilobytes, and prints at full sharpness at any size.
  signature_svg      TEXT,
  signature_name     TEXT,                   -- printed name alongside the signature
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
