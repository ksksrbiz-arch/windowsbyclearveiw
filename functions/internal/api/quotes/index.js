import { TERMS_VERSION, json, parseQuoteBody } from '../../_lib/quotes.mjs';
import { ensureInvoiceForQuote, ensureInvoiceSchema } from '../../_lib/invoices.mjs';
import { ensureQuoteLeadColumn, parseLeadId, leadExists } from '../../_lib/lead-links.mjs';
import { sourceSnapshot } from '../../../_lib/build-plan-rules.mjs';
import { WORK_TYPES, ensureQuoteWorkTypeColumn, workTypeOf } from '../../_lib/work-types.mjs';

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
  const url = new URL(context.request.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const status = url.searchParams.get('status');
  if (status && !['draft', 'finalized'].includes(status)) return json({ error: 'Choose a valid quote status.' }, 400);
  const workType = url.searchParams.get('workType');
  if (workType && !WORK_TYPES.includes(workType)) return json({ error: 'Choose Windows or Siding.' }, 400);
  const search = (url.searchParams.get('search') || '').trim().slice(0, 120);
  await ensureQuoteWorkTypeColumn(env.QUOTES_DB);
  const conditions = [], bindings = [];
  if (status) { conditions.push('q.status = ?'); bindings.push(status); }
  if (workType) { conditions.push('q.work_type = ?'); bindings.push(workType); }
  // Literal substring matching: %, _ and quotes in a customer name are not SQL wildcards.
  if (search) { conditions.push("INSTR(LOWER(COALESCE(q.customer_name,'') || ' ' || COALESCE(q.customer_city,'')), LOWER(?)) > 0"); bindings.push(search); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const pageSize = 200;
  const offset = (page - 1) * pageSize;
  await ensureInvoiceSchema(env.QUOTES_DB);
  await ensureBuildPlanSchema(env.QUOTES_DB);
  const [{ results }, countRow] = await Promise.all([env.QUOTES_DB.prepare(
    `SELECT q.id, q.created_at, q.status, q.customer_name, q.customer_city, q.total_cents, q.signature_method, q.work_type,
            i.id AS invoice_id, i.invoice_number, i.status AS invoice_status, i.sent_at AS invoice_sent_at,
            bp.state AS build_plan_state, bp.version AS build_plan_version, bp.approved_at AS build_plan_approved_at,
            bp.source_json AS build_plan_source_json, bp.plan_json AS build_plan_json
     FROM quotes q
     LEFT JOIN invoices i ON i.quote_id = q.id
     LEFT JOIN quote_build_plans bp ON bp.quote_id = q.id
     ${where}
     ORDER BY q.created_at DESC, q.id ASC LIMIT ? OFFSET ?`,
  ).bind(...bindings, pageSize, offset).all(), env.QUOTES_DB.prepare(`SELECT COUNT(*) AS total FROM quotes q ${where}`).bind(...bindings).first()]);
  // Stale = the quote's current items differ from the snapshot the plan was
  // saved against. Uses the same sourceSnapshot() as the approval, signing
  // and job gates so the list badge can never disagree with them.
  const { results: itemRows } = await env.QUOTES_DB.prepare(
    `SELECT * FROM quote_items WHERE quote_id IN (SELECT q.id FROM quotes q ${where} ORDER BY q.created_at DESC, q.id ASC LIMIT ? OFFSET ?)
     ORDER BY quote_id, sort_order ASC, id ASC`,
  ).bind(...bindings, pageSize, offset).all();
  const itemsByQuote = new Map();
  for (const item of itemRows || []) {
    if (!itemsByQuote.has(item.quote_id)) itemsByQuote.set(item.quote_id, []);
    itemsByQuote.get(item.quote_id).push(item);
  }
  const quotes = (results || []).map((quote) => {
    let plan = {};
    try { plan = quote.build_plan_json ? JSON.parse(quote.build_plan_json) : {}; } catch {}
    let source = plan.sourceItems || [];
    try { if (quote.build_plan_source_json) source = JSON.parse(quote.build_plan_source_json); } catch {}
    const currentKey = JSON.stringify(sourceSnapshot(itemsByQuote.get(quote.id) || []));
    const hasPlan = Boolean(quote.build_plan_json);
    const planState = quote.build_plan_state || plan.status || null;
    const stale = hasPlan && JSON.stringify(source || []) !== currentKey;
    return {
      id: quote.id, created_at: quote.created_at, status: quote.status, work_type: workTypeOf(quote), customer_name: quote.customer_name,
      customer_city: quote.customer_city, total_cents: quote.total_cents, signature_method: quote.signature_method,
      invoice_id: quote.invoice_id, invoice_number: quote.invoice_number, invoice_status: quote.invoice_status, invoice_sent_at: quote.invoice_sent_at,
      build_plan_state: planState, build_plan_version: Number(quote.build_plan_version || plan.version || 1), build_plan_approved_at: quote.build_plan_approved_at,
      build_plan_stale: stale,
    };
  });
  const total = Number(countRow?.total || 0);
  return json({ quotes, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Body must be JSON.' }, 400); }
  const parsed = parseQuoteBody(body);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const { name, phone, email, address, city, role, notes, discountReason, cleanItems, subtotalCents, discountCents, totalCents, workType } = parsed;
  const signatureMethod = body.signatureMethod === 'digital' ? 'digital' : 'pen';
  await ensureQuoteWorkTypeColumn(env.QUOTES_DB);
  const lead = parseLeadId(body.leadId);
  if (lead.error) return json({ error: lead.error }, 400);
  await ensureQuoteLeadColumn(env.QUOTES_DB);
  if (lead.leadId && !(await leadExists(env.QUOTES_DB, lead.leadId))) {
    return json({ error: 'The inquiry this quote was started from no longer exists.' }, 400);
  }
  const status = 'draft';
  const now = new Date().toISOString();
  const id = newQuoteId();

  await env.QUOTES_DB.batch([
    env.QUOTES_DB.prepare(
      `INSERT INTO quotes (
        id, created_at, updated_at, status,
        customer_name, customer_phone, customer_email, customer_address, customer_city, customer_role, notes,
        subtotal_cents, discount_cents, discount_reason, total_cents,
        terms_version, signature_method, created_by, lead_id, lead_linked_at, work_type
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(id, now, now, status, name, phone, email, address, city, role, notes, subtotalCents, discountCents, discountReason, totalCents, TERMS_VERSION, signatureMethod, 'mark', lead.leadId, lead.leadId ? now : null, workType),
    ...cleanItems.map((item, index) => env.QUOTES_DB.prepare(
      `INSERT INTO quote_items (quote_id, sort_order, label, description, quantity, unit_price_cents, line_total_cents)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(id, index, item.label, item.description, item.quantity, item.unitPriceCents, item.lineTotalCents)),
  ]);

  const record = await ensureInvoiceForQuote(env.QUOTES_DB, id);
  return json({ id, status, workType, totalCents, leadId: lead.leadId, invoiceId: record?.invoice?.id || `INV-${id.replace(/^Q-/, '')}` }, 201);
}
