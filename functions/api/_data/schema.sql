-- Inbound estimate-form leads, together with the visit history a visitor
-- built up on this site before submitting — see EstimateForm.astro (client
-- capture), src/layouts/BaseLayout.astro (trackVisitJourney), and
-- functions/api/estimate.js (this table's writer).
--
-- Lives in the same D1 database as the internal quoting tool (QUOTES_DB),
-- same reasoning as functions/ask/_data/schema.sql: one small table doesn't
-- earn a second database. This is deliberately separate from `quotes` —
-- `quotes` is what Mark builds by hand once he has decided to bid the job;
-- `leads` is the raw inbound record of the request itself, kept so nothing
-- is lost if Resend hiccups and so Mark has one place to see a visitor's
-- browsing history, not just what they typed. There is no relationship
-- enforced between the two tables: matching a lead to the quote it became
-- is left to Mark reading names, same as today.
CREATE TABLE IF NOT EXISTS leads (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at          TEXT NOT NULL,

  name                TEXT NOT NULL,
  phone               TEXT,
  email               TEXT,
  city                TEXT,
  role                TEXT,                  -- 'Homeowner' | 'Builder / GC'
  notes               TEXT,

  -- Random id set in the visitor's own localStorage (clearveiw:vid), not
  -- derived from anything identifying — lets Mark notice "this is the same
  -- person who submitted before" if it ever comes up. Null whenever
  -- localStorage was unavailable at submit time.
  visitor_id          TEXT,

  -- First-touch attribution, captured once per browser the first time
  -- trackVisitJourney() ever runs, read back at submit time.
  first_seen_at       TEXT,                  -- ISO 8601
  first_referrer      TEXT,
  first_utm_source    TEXT,
  first_utm_medium    TEXT,
  first_utm_campaign  TEXT,
  landing_path        TEXT,

  -- This visit's session only (sessionStorage, capped at 25 entries client
  -- side) — not the visitor's whole history, just what led to this
  -- submission. page_views_json is the full list; visit_count is it's
  -- length, kept denormalized so the list view doesn't have to parse JSON
  -- for every row just to show a count.
  visit_count         INTEGER NOT NULL DEFAULT 0,
  page_views_json     TEXT NOT NULL DEFAULT '[]'  -- [{path, title, ts}, ...]
);

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_name ON leads(name);
CREATE INDEX IF NOT EXISTS idx_leads_visitor_id ON leads(visitor_id);
