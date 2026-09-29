// Customer signing links for quotes.
//
// Mark creates a link for a draft quote; the customer opens it on their own
// device, reviews the quote and terms, and signs. Security model:
//
//   * The link carries a 256-bit random token. Only its SHA-256 is stored, so
//     a database read never yields a working link.
//   * One active link per quote. Creating a new one revokes the old one; links
//     expire after LINK_TTL_DAYS and stop working once the quote is signed.
//   * The customer never sends markup. They send stroke coordinates, which are
//     range-checked here and turned into SVG by the server, so nothing a
//     customer submits can run as script in Mark's authenticated admin.
//   * The public view is a whitelist of fields (no ids, notes, Build Plan,
//     internal status or other customers).
//   * Signing goes through the same approved-Build-Plan gate as signing on
//     Mark's device, and finalizes with a conditional UPDATE so two
//     submissions can never both win.

export const LINK_TTL_DAYS = 30;
export const PAD = { width: 600, height: 180 };
const MAX_STROKES = 60;
const MAX_POINTS = 4000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const migrated = new WeakSet();

export async function ensureSigningSchema(db) {
  if (!db || migrated.has(db)) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS quote_sign_links (
      token_hash     TEXT PRIMARY KEY,
      quote_id       TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      created_by     TEXT NOT NULL DEFAULT 'mark',
      expires_at     TEXT NOT NULL,
      revoked_at     TEXT,
      first_viewed_at TEXT,
      last_viewed_at TEXT,
      view_count     INTEGER NOT NULL DEFAULT 0,
      signed_at      TEXT,
      signer_user_agent TEXT
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_quote_sign_links_quote ON quote_sign_links(quote_id, created_at DESC)`),
  ]);
  migrated.add(db);
}

function base64url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function newToken() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export const isToken = (value) => typeof value === 'string' && TOKEN_PATTERN.test(value);

export async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Returns { svg } built by the server from validated strokes, or { error }. */
export function renderSignatureSvg(strokes) {
  if (!Array.isArray(strokes) || strokes.length === 0) return { error: 'Please sign in the box.' };
  if (strokes.length > MAX_STROKES) return { error: 'That signature has too many strokes. Clear it and sign again.' };
  let points = 0;
  let longest = 0;
  const paths = [];
  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || stroke.length === 0) return { error: 'Invalid signature.' };
    points += stroke.length;
    if (points > MAX_POINTS) return { error: 'That signature is too detailed. Clear it and sign again.' };
    longest = Math.max(longest, stroke.length);
    const parts = [];
    for (let i = 0; i < stroke.length; i += 1) {
      const point = stroke[i];
      if (!Array.isArray(point) || point.length !== 2) return { error: 'Invalid signature.' };
      const [x, y] = point.map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > PAD.width || y > PAD.height) {
        return { error: 'Invalid signature.' };
      }
      parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    paths.push(`<path d="${parts.join(' ')}" fill="none" stroke="#111214" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`);
  }
  if (points < 3 || longest < 2) return { error: 'Please sign in the box.' };
  return { svg: `<svg viewBox="0 0 ${PAD.width} ${PAD.height}" xmlns="http://www.w3.org/2000/svg">${paths.join('')}</svg>` };
}

/** Whitelisted, customer-safe view of a quote. */
export function publicQuote(quote, items) {
  return {
    number: quote.id,
    createdAt: quote.created_at,
    status: quote.status === 'finalized' ? 'signed' : 'awaiting-signature',
    customer: {
      name: quote.customer_name || '',
      address: quote.customer_address || '',
      city: quote.customer_city || '',
    },
    items: (items || []).map((item) => ({
      label: item.label,
      description: item.description || '',
      quantity: Number(item.quantity) || 0,
      unitPriceCents: Number(item.unit_price_cents) || 0,
      lineTotalCents: Number(item.line_total_cents) || 0,
    })),
    subtotalCents: Number(quote.subtotal_cents) || 0,
    discountCents: Number(quote.discount_cents) || 0,
    discountReason: quote.discount_reason || '',
    totalCents: Number(quote.total_cents) || 0,
    termsVersion: quote.terms_version || null,
    signedName: quote.status === 'finalized' ? quote.signature_name || '' : '',
    signedAt: quote.status === 'finalized' ? quote.signed_at || null : null,
  };
}

/** Link state for Mark's quote page. Never includes the token itself. */
export function linkStatus(row, now = Date.now()) {
  if (!row) return { state: 'none' };
  const base = {
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    viewCount: Number(row.view_count) || 0,
    firstViewedAt: row.first_viewed_at || null,
    lastViewedAt: row.last_viewed_at || null,
    signedAt: row.signed_at || null,
  };
  if (row.signed_at) return { state: 'signed', ...base };
  if (row.revoked_at) return { state: 'revoked', ...base };
  if (Date.parse(row.expires_at) <= now) return { state: 'expired', ...base };
  return { state: base.viewCount ? 'viewed' : 'sent', ...base };
}

/** Resolves a token to its live link row, or { error, status }. */
export async function resolveLink(db, token, now = Date.now()) {
  if (!isToken(token)) return { error: 'This signing link is not valid.', status: 404 };
  const row = await db.prepare(`SELECT * FROM quote_sign_links WHERE token_hash = ?`).bind(await hashToken(token)).first();
  if (!row) return { error: 'This signing link is not valid.', status: 404 };
  if (row.revoked_at) return { error: 'This signing link has been replaced. Please use the newest link you were sent.', status: 410 };
  if (!row.signed_at && Date.parse(row.expires_at) <= now) {
    return { error: 'This signing link has expired. Please ask for a new one.', status: 410 };
  }
  return { row };
}
