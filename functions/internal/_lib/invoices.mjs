import { clean, json } from './quotes.mjs';

const FROM = 'Clearview Windows <estimates@windowsbyclearveiw.com>';
const REPLY_TO = 'owner@windowsbyclearveiw.com';

export async function ensureInvoiceSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      invoice_number TEXT NOT NULL UNIQUE,
      quote_id TEXT NOT NULL UNIQUE REFERENCES quotes(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      customer_email TEXT,
      customer_address TEXT,
      customer_city TEXT,
      subtotal_cents INTEGER NOT NULL DEFAULT 0,
      discount_cents INTEGER NOT NULL DEFAULT 0,
      discount_reason TEXT,
      total_cents INTEGER NOT NULL DEFAULT 0,
      sent_at TEXT,
      paid_at TEXT,
      voided_at TEXT
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price_cents INTEGER NOT NULL,
      line_total_cents INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id)`),
  ]);
}

function invoiceIdForQuote(quoteId) {
  return `INV-${quoteId.replace(/^Q-/, '')}`;
}

function invoiceNumberForQuote(quoteId) {
  return `INV-${quoteId.replace(/^Q-/, '')}`;
}

function money(cents) {
  return `$${(Number(cents || 0) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function getInvoice(db, invoiceId) {
  await ensureInvoiceSchema(db);
  const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?').bind(invoiceId).first();
  if (!invoice) return null;
  const { results: items } = await db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC').bind(invoiceId).all();
  return { invoice, items };
}

/**
 * Creates the first invoice snapshot from a quote, or refreshes a draft invoice
 * while its quote is still editable. Once the quote is finalized the invoice is
 * locked to that snapshot and will not be silently changed by later code.
 */
export async function ensureInvoiceForQuote(db, quoteId, { finalize = false } = {}) {
  await ensureInvoiceSchema(db);
  const quote = await db.prepare('SELECT * FROM quotes WHERE id = ?').bind(quoteId).first();
  if (!quote) throw new Error('Quote not found.');

  let invoice = await db.prepare('SELECT * FROM invoices WHERE quote_id = ?').bind(quoteId).first();
  const now = new Date().toISOString();
  const id = invoice?.id || invoiceIdForQuote(quoteId);
  const invoiceNumber = invoice?.invoice_number || invoiceNumberForQuote(quoteId);
  const nextStatus = finalize ? 'open' : (invoice?.status || 'draft');

  if (invoice && invoice.status !== 'draft' && !finalize) {
    return getInvoice(db, invoice.id);
  }

  const { results: quoteItems } = await db.prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order ASC').bind(quoteId).all();

  await db.batch([
    invoice
      ? db.prepare(`UPDATE invoices SET updated_at = ?, status = ?, customer_name = ?, customer_phone = ?, customer_email = ?, customer_address = ?, customer_city = ?, subtotal_cents = ?, discount_cents = ?, discount_reason = ?, total_cents = ? WHERE id = ?`)
          .bind(now, nextStatus, quote.customer_name, quote.customer_phone, quote.customer_email, quote.customer_address, quote.customer_city, quote.subtotal_cents, quote.discount_cents, quote.discount_reason, quote.total_cents, id)
      : db.prepare(`INSERT INTO invoices (id, invoice_number, quote_id, created_at, updated_at, status, customer_name, customer_phone, customer_email, customer_address, customer_city, subtotal_cents, discount_cents, discount_reason, total_cents) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(id, invoiceNumber, quoteId, now, now, nextStatus, quote.customer_name, quote.customer_phone, quote.customer_email, quote.customer_address, quote.customer_city, quote.subtotal_cents, quote.discount_cents, quote.discount_reason, quote.total_cents),
    db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').bind(id),
    ...quoteItems.map((item, index) => db.prepare(`INSERT INTO invoice_items (invoice_id, sort_order, label, description, quantity, unit_price_cents, line_total_cents) VALUES (?,?,?,?,?,?,?)`)
      .bind(id, index, item.label, item.description, item.quantity, item.unit_price_cents, item.line_total_cents)),
  ]);

  return getInvoice(db, id);
}

function renderEmail(invoice, items) {
  const itemRows = items.map((item) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;">${esc(item.label)}${item.description ? `<div style="margin-top:3px;color:#6b7280;font-size:12px;">${esc(item.description)}</div>` : ''}</td>
      <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#374151;">${Number(item.quantity) || 0}</td>
      <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#374151;">${money(item.unit_price_cents)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#111827;">${money(item.line_total_cents)}</td>
    </tr>`).join('');

  const address = [invoice.customer_address, invoice.customer_city].filter(Boolean).map(esc).join(', ');
  const discount = Number(invoice.discount_cents || 0) > 0
    ? `<tr><td colspan="3" style="padding:7px 0;text-align:right;font-family:Arial,Helvetica,sans-serif;color:#6b7280;">${esc(invoice.discount_reason ? `Discount — ${invoice.discount_reason}` : 'Discount')}</td><td style="padding:7px 0;text-align:right;font-family:Arial,Helvetica,sans-serif;color:#111827;">-${money(invoice.discount_cents)}</td></tr>`
    : '';

  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;padding:28px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #e5e7eb;">
      <tr><td style="padding:28px 30px;border-bottom:2px solid #111827;font-family:Arial,Helvetica,sans-serif;"><div style="font-size:22px;font-weight:700;color:#111827;">Clearview Windows</div><div style="margin-top:4px;font-size:12px;color:#6b7280;">Clear View Windows &amp; Trim LLC · (564) 208-0801</div></td></tr>
      <tr><td style="padding:26px 30px;font-family:Arial,Helvetica,sans-serif;"><div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">Invoice</div><div style="margin-top:4px;font-size:26px;font-weight:700;color:#111827;">${esc(invoice.invoice_number)}</div><div style="margin-top:6px;font-size:13px;color:#6b7280;">Issued ${new Date(invoice.created_at).toLocaleDateString('en-US')}</div></td></tr>
      <tr><td style="padding:0 30px 24px;font-family:Arial,Helvetica,sans-serif;"><div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">Bill to</div><div style="margin-top:6px;font-size:16px;font-weight:700;color:#111827;">${esc(invoice.customer_name)}</div><div style="margin-top:4px;font-size:13px;color:#4b5563;">${address || 'Address on file'}</div><div style="margin-top:3px;font-size:13px;color:#4b5563;">${esc(invoice.customer_email || '')}</div></td></tr>
      <tr><td style="padding:0 30px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><thead><tr><th align="left" style="padding-bottom:8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;text-transform:uppercase;color:#6b7280;">Description</th><th align="center" style="padding-bottom:8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;text-transform:uppercase;color:#6b7280;">Qty</th><th align="right" style="padding-bottom:8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;text-transform:uppercase;color:#6b7280;">Unit</th><th align="right" style="padding-bottom:8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;text-transform:uppercase;color:#6b7280;">Amount</th></tr></thead><tbody>${itemRows}</tbody></table></td></tr>
      <tr><td style="padding:14px 30px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td colspan="3" style="padding:5px 0;text-align:right;font-family:Arial,Helvetica,sans-serif;color:#6b7280;">Subtotal</td><td style="padding:5px 0;text-align:right;font-family:Arial,Helvetica,sans-serif;color:#111827;">${money(invoice.subtotal_cents)}</td></tr>${discount}<tr><td colspan="3" style="padding:12px 0 0;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#111827;border-top:2px solid #111827;">Amount due</td><td style="padding:12px 0 0;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#111827;border-top:2px solid #111827;">${money(invoice.total_cents)}</td></tr></table></td></tr>
      <tr><td style="padding:22px 30px;background:#f9fafb;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#4b5563;">This invoice was generated from your finalized Clearview quote. Payment terms and project terms remain those shown on the signed agreement. Questions? Reply to this email or call (564) 208-0801.</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

export async function emailInvoice(context, invoiceId) {
  const { env } = context;
  const record = await getInvoice(env.QUOTES_DB, invoiceId);
  if (!record) return { error: 'Invoice not found.', status: 404 };
  const { invoice, items } = record;

  if (invoice.status === 'draft') return { error: 'Finalize the quote before emailing the invoice.', status: 409 };
  if (invoice.status === 'void') return { error: 'A void invoice cannot be emailed.', status: 409 };
  if (!invoice.customer_email) return { error: 'This customer does not have an email address on the invoice.', status: 400 };

  const key = env?.RESEND_API_KEY;
  if (!key) return { error: 'RESEND_API_KEY is not configured.', status: 503 };

  const from = env?.RESEND_FROM || FROM;
  const replyTo = env?.INVOICE_REPLY_TO || env?.NOTIFY_EMAIL || REPLY_TO;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [invoice.customer_email],
      reply_to: replyTo,
      subject: `${invoice.invoice_number} from Clearview Windows`,
      html: renderEmail(invoice, items),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('invoice-resend-failed', response.status, payload?.message || payload?.name || '');
    return { error: 'Resend could not deliver the invoice email.', status: 502 };
  }

  const now = new Date().toISOString();
  await env.QUOTES_DB.prepare(`UPDATE invoices SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, invoiceId).run();
  return { ok: true, sentAt: now };
}

export { renderEmail, money };
