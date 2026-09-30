// Non-window ("general work") jobs. Mark adds the customer and the job directly:
// no quote, no Build Plan, no in-app contract. The agreement is on his own paper;
// the app records who, what, how much, when, and what has been paid.
//
// Everything here is deterministic validation. Window jobs keep their existing
// quote -> approved Build Plan -> job path untouched.

export const WORK_TYPES = Object.freeze(['windows', 'general']);

export const GENERAL_LIMITS = Object.freeze({
  name: 120,
  phone: 40,
  email: 160,
  address: 200,
  city: 80,
  description: 200,
  window: 120,
  notes: 8000,
  maxAgreedCents: 500_000_000, // $5,000,000: a typo guard, not a business rule
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function validDate(value) {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Whole dollars or dollars and cents ("4,800" / "$4800.50") to integer cents; null when not a positive amount. */
export function dollarsToCents(input) {
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? Math.round(input * 100) : null;
  if (typeof input !== 'string') return null;
  const text = input.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return cents > 0 ? cents : null;
}

function optionalDate(value, label, errors) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !validDate(value.trim())) {
    errors.push(`${label} must be a real date (YYYY-MM-DD).`);
    return null;
  }
  return value.trim();
}

function contact(body, errors, { requireName }) {
  const out = {};
  if (body.customerName !== undefined || requireName) {
    const name = clean(body.customerName, GENERAL_LIMITS.name);
    if (!name) errors.push('Customer name is required.');
    out.customer_name = name;
  }
  if (body.customerPhone !== undefined) out.customer_phone = clean(body.customerPhone, GENERAL_LIMITS.phone) || null;
  if (body.customerEmail !== undefined) {
    const email = clean(body.customerEmail, GENERAL_LIMITS.email);
    if (email && !EMAIL.test(email)) errors.push('That email address does not look right.');
    out.customer_email = email || null;
  }
  if (body.customerAddress !== undefined) out.customer_address = clean(body.customerAddress, GENERAL_LIMITS.address) || null;
  if (body.customerCity !== undefined) out.customer_city = clean(body.customerCity, GENERAL_LIMITS.city) || null;
  return out;
}

function agreed(body, errors, { required }) {
  const given = body.agreedAmount ?? body.agreedDollars;
  if (given === undefined || given === null || given === '') {
    if (required) errors.push('Agreed amount is required. Enter the total in dollars.');
    return undefined;
  }
  const cents = dollarsToCents(given);
  if (cents === null) errors.push('Agreed amount must be a positive dollar amount, for example 4800 or 4,800.50.');
  else if (cents > GENERAL_LIMITS.maxAgreedCents) errors.push('Agreed amount looks too large. Check the digits.');
  return cents ?? undefined;
}

/** A new general job. Returns { value } (DB-ready columns) or { errors }. */
export function validateNewGeneralJob(body) {
  const input = body && typeof body === 'object' ? body : {};
  const errors = [];
  const value = { work_type: 'general', ...contact(input, errors, { requireName: true }) };

  const description = clean(input.workDescription, GENERAL_LIMITS.description);
  if (!description) errors.push('Type of work is required, for example "deck rebuild".');
  value.work_description = description;

  value.agreed_cents = agreed(input, errors, { required: true });
  value.contract_date = optionalDate(input.contractDate, 'Contract date', errors);
  value.scheduled_date = optionalDate(input.scheduledDate, 'Scheduled date', errors);
  value.scheduled_window = clean(input.scheduledWindow, GENERAL_LIMITS.window) || null;
  value.notes = typeof input.notes === 'string' ? input.notes.trim().slice(0, GENERAL_LIMITS.notes) || null : null;
  value.status = value.scheduled_date ? 'scheduled' : 'ready';

  return errors.length ? { errors } : { value };
}

/** Edits to an existing general job. Only the fields that were sent are returned. */
export function validateGeneralJobUpdate(body) {
  const input = body && typeof body === 'object' ? body : {};
  const errors = [];
  const value = contact(input, errors, { requireName: false });
  if (input.workDescription !== undefined) {
    const description = clean(input.workDescription, GENERAL_LIMITS.description);
    if (!description) errors.push('Type of work cannot be blank.');
    value.work_description = description;
  }
  const cents = agreed(input, errors, { required: false });
  if (cents !== undefined) value.agreed_cents = cents;
  if (input.contractDate !== undefined) value.contract_date = optionalDate(input.contractDate, 'Contract date', errors);
  return errors.length ? { errors } : { value };
}

export const isGeneralJob = (job) => job?.work_type === 'general';

// Columns are added lazily, like the rest of this app's schema. Every endpoint that
// reads them calls this first, so the order in which pages are opened after a deploy
// cannot matter. If the jobs table does not exist yet, nothing is recorded as done:
// the jobs API creates the table and calls this again.
const GENERAL_JOB_COLUMNS = [
  ['work_type', `ALTER TABLE jobs ADD COLUMN work_type TEXT NOT NULL DEFAULT 'windows'`],
  ['work_description', 'ALTER TABLE jobs ADD COLUMN work_description TEXT'],
  ['agreed_cents', 'ALTER TABLE jobs ADD COLUMN agreed_cents INTEGER'],
  ['contract_date', 'ALTER TABLE jobs ADD COLUMN contract_date TEXT'],
];
const columnsReady = new WeakSet();

export async function ensureGeneralJobColumns(db) {
  if (columnsReady.has(db)) return;
  const info = await db.prepare('PRAGMA table_info(jobs)').all();
  const have = new Set((info?.results || []).map((row) => row.name));
  if (!have.size) return;
  for (const [column, sql] of GENERAL_JOB_COLUMNS) {
    if (have.has(column)) continue;
    try { await db.prepare(sql).run(); } catch (error) { if (!/duplicate column/i.test(String(error?.message))) throw error; }
  }
  columnsReady.add(db);
}
