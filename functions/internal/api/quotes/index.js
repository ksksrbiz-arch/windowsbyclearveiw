import { TERMS_VERSION, json, parseQuoteBody } from '../../_lib/quotes.mjs';
import { ensureInvoiceForQuote, ensureInvoiceSchema } from '../../_lib/invoices.mjs';

function newQuoteId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const bytes = crypto.getRandomValues(new Uint8Array(2));
  const suffix = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `Q-${date}-${suffix}`;
}

async function ensureBuildPlanSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS quote_build_plans (quote_id TEXT PRIMARY KEY REFERENCES quotes(id) ON DELETE CASCADE, version INTEGER NOT NULL DEFAULT 1, plan_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT 'mark')`).run();
  for (const sql of [
    `ALTER TABLE quote_build_plans ADD COLUMN state TEXT NOT NULL DEFAULT 'draft'`,
    `ALTER TABLE quote_build_plans ADD COLUMN source_json TEXT`,
    `ALTER TABLE quote_build_plans ADD COLUMN approved_at TEXT`,
    `ALTER TABLE quote_build_plans ADD COLUMN approved_by TEXT`,
  ]) { try { await db.prepare(sql).run(); } catch {} }
}

export async function onRequestGet(context) {
  const { env } = context;
  await ensureInvoiceSchema(env.QUOTES_DB);
  await ensureBuildPlanSchema(env.QUOTES_DB);
  const { results } = await env.QUOTES_DB.prepare(
    `SELECT q.id, q.created_at, q.status, q.customer_name, q.customer_city, q.total_cents, q.signature_method,
            i.id AS invoice_id, i.invoice_number, i.status AS invoice_status, i.sent_at AS invoice_sent_at,
            bp.state AS build_plan_state, bp.version AS build_plan_version, bp.approved_at AS build_plan_approved_at,
            bp.source_json AS build_plan_source_json, bp.plan_json AS build_plan_json
     FROM quotes q
     LEFT JOIN invoices i ON i.quote_id = q.id
     LEFT JOIN quote_build_plans bp ON bp.quote_id = q.id
     ORDER BY q.created_at DESC LIMIT 200`,
  ).all();
  const quotes = (results || []).map((quote) => {
    let source = [];
    try { source = quote.build_plan_source_json ? JSON.parse(quote.build_plan_source_json) : []; } catch {}
    let plan = {};
    try { plan = quote.build_plan_json ? JSON.parse(quote.build_plan_json) : {}; } catch {}
    const sourceKey = JSON.stringify(source || []);
    const currentKey = JSON.stringify((plan.sourceItems || []).map((item) => ({ label: item.label, quantity: item.quantity, description: item.description, line_total_cents: item.line_total_cents })));
    const hasPlan = Boolean(quote.build_plan_json);
    const planState = quote.build_plan_state || plan.status || null;
    const stale = hasPlan && source.length > 0 && sourceKey !== currentKey;
    return {
      id: quote.id, created_at: quote.created_at, status: quote.status, customer_name: quote.customer_name,
      customer_city: quote.customer_city, total_cents: quote.total_cents, signature_method: quote.signature_method,
      invoice_id: quote.invoice_id, invoice_number: quote.invoice_number, invoice_status: quote.invoice_status, invoice_sent_at: quote.invoice_sent_at,
      build_plan_state: planState, build_plan_version: Number(quote.build_plan_version || plan.version || 1), build_plan_approved_at: quote.build_plan_approved_at,
      build_plan_stale: stale,
    };
  });
  return json({ quotes });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Body must be JSON.' }, 400); }
  const parsed = parseQuoteBody(body);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const { name, phone, email, address, city, role, notes, discountReason, cleanItems, subtotalCents, discountCents, totalCents } = parsed;
  const signatureMethod = body.signatureMethod === 'digital' ? 'digital' : 'pen';
  const status = 'draft';
  const now = new Date().toISOString();
  const id = newQuoteId();

  await env.QUOTES_DB.batch([
    env.QUOTES_DB.prepare(
      `INSERT INTO quotes (
        id, created_at, updated_at, status,
        customer_name, customer_phone, customer_email, customer_address, customer_city, customer_role, notes,
        subtotal_cents, discount_cents, discount_reason, total_cents,
        terms_version, signature_method, created_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(id, now, now, status, name, phone, email, address, city, role, notes, subtotalCents, discountCents, discountReason, totalCents, TERMS_VERSION, signatureMethod, 'mark'),
    ...cleanItems.map((item, index) => env.QUOTES_DB.prepare(
      `INSERT INTO quote_items (quote_id, sort_order, label, description, quantity, unit_price_cents, line_total_cents)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(id, index, item.label, item.description, item.quantity, item.unitPriceCents, item.lineTotalCents)),
  ]);

  const record = await ensureInvoiceForQuote(env.QUOTES_DB, id);
  return json({ id, status, totalCents, invoiceId: record?.invoice?.id || `INV-${id.replace(/^Q-/, '')}` }, 201);
}
