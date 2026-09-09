function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } });
}

async function ensureSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS quote_build_plans (
    quote_id TEXT PRIMARY KEY REFERENCES quotes(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    plan_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT 'mark'
  )`).run();
}

function clean(value, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function inferPlanItem(item, index) {
  const label = clean(item.label, 300);
  const lower = label.toLowerCase();
  const method = /full[- ]?frame|full frame/.test(lower) ? 'full-frame' : 'insert';
  const type = /slider|sliding/.test(lower) ? 'slider' : /casement/.test(lower) ? 'casement' : /picture|fixed/.test(lower) ? 'picture/fixed' : /awning/.test(lower) ? 'awning' : /door/.test(lower) ? 'sliding door' : 'double-hung';
  return {
    id: `opening-${index + 1}`,
    opening: index + 1,
    product: label || 'Quoted opening',
    quantity: Math.max(1, Number(item.quantity) || 1),
    openingType: type,
    installationMethod: method,
    existingCondition: 'VERIFY at site',
    dimensions: 'VERIFY at site',
    flashing: 'VERIFY sill and perimeter flashing sequence before installation',
    notes: '',
    qc: ['Plumb', 'Level', 'Square', 'Fasteners verified', 'Flashing complete', 'Insulation complete', 'Seal complete', 'Operation tested', 'Photos captured'],
  };
}

function generatePlan(quote, items) {
  const openings = items.flatMap((item) => {
    const base = inferPlanItem(item, 0);
    return Array.from({ length: Math.min(50, Math.max(1, Number(item.quantity) || 1)) }, (_, n) => ({
      ...base,
      id: `opening-${n + 1}-${item.id || Math.random().toString(36).slice(2, 7)}`,
      opening: n + 1,
      quantity: 1,
    }));
  });
  return {
    schemaVersion: 1,
    project: {
      customer: clean(quote.customer_name, 200),
      address: clean(quote.customer_address, 300),
      city: clean(quote.customer_city, 120),
      projectType: 'VERIFY: replacement vs new construction',
      totalQuotedCents: Number(quote.total_cents) || 0,
    },
    buy: [
      'Quoted windows / doors — verify every unit against order confirmation',
      'Flashing / sill protection appropriate to the installation',
      'Shims and approved fasteners',
      'Low-expansion window/door insulation',
      'Exterior-grade sealant and compatible backer rod as required',
      'Interior/exterior trim and finish materials from quote/site conditions',
    ],
    load: [
      'All quoted units and accessories',
      'Flashing and sill protection',
      'Shims, fasteners and installation tools',
      'Insulation and sealants',
      'Trim/finish materials',
      'Protection, cleanup and photo equipment',
    ],
    install: [
      'Confirm products, sizes and opening assignments before removal',
      'Protect interior/exterior work areas',
      'Remove existing unit where applicable',
      'Inspect rough opening, sill, framing and water-management details',
      'Correct deficiencies before setting the new unit',
      'Install sill/perimeter flashing appropriate to the installation path',
      'Set, shim, plumb, level and square the unit',
      'Fasten according to the selected product installation requirements',
      'Complete perimeter flashing and sealant transitions',
      'Insulate perimeter gap appropriately',
      'Install interior/exterior trim and finish',
      'Operate/test the completed unit and inspect water-management details',
    ],
    verify: [
      'Exact unit sizes and handing verified before installation',
      'Existing opening condition verified before removal',
      'Installation method confirmed for each opening',
      'Manufacturer-specific fastening/flashing requirements verified',
      'Any rot, framing repair or unexpected condition documented before proceeding',
    ],
    qc: ['All units operate correctly', 'Units are plumb, level and square', 'Fasteners and shims checked', 'Flashing/seal transitions checked', 'Interior/exterior finish checked', 'Final photos captured', 'Customer walkthrough completed'],
    openings,
    notes: clean(quote.notes, 4000),
  };
}

export async function onRequestGet(context) {
  const { env } = context;
  await ensureSchema(env.QUOTES_DB);
  const quoteId = clean(new URL(context.request.url).searchParams.get('quoteId'), 100);
  if (!quoteId) return json({ error: 'Quote id is required.' }, 400);
  const quote = await env.QUOTES_DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(quoteId).first();
  if (!quote) return json({ error: 'Quote not found.' }, 404);
  const { results: items } = await env.QUOTES_DB.prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order ASC, id ASC').bind(quoteId).all();
  const saved = await env.QUOTES_DB.prepare('SELECT * FROM quote_build_plans WHERE quote_id = ?').bind(quoteId).first();
  if (!saved) return json({ quote, items, plan: generatePlan(quote, items), generated: true, version: 1 });
  let plan;
  try { plan = JSON.parse(saved.plan_json); } catch { plan = generatePlan(quote, items); }
  return json({ quote, items, plan, generated: false, version: Number(saved.version) || 1, updatedAt: saved.updated_at });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  await ensureSchema(env.QUOTES_DB);
  let body; try { body = await request.json(); } catch { return json({ error: 'Body must be JSON.' }, 400); }
  const quoteId = clean(body.quoteId, 100);
  if (!quoteId) return json({ error: 'Quote id is required.' }, 400);
  const quote = await env.QUOTES_DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(quoteId).first();
  if (!quote) return json({ error: 'Quote not found.' }, 404);
  if (quote.status !== 'draft') return json({ error: 'Only draft quotes can be changed through the build-plan editor.' }, 409);
  const plan = body.plan && typeof body.plan === 'object' ? body.plan : null;
  if (!plan) return json({ error: 'A build plan is required.' }, 400);
  const safe = JSON.stringify(plan).slice(0, 100000);
  const now = new Date().toISOString();
  const existing = await env.QUOTES_DB.prepare('SELECT version FROM quote_build_plans WHERE quote_id = ?').bind(quoteId).first();
  const version = Number(existing?.version || 0) + 1;
  await env.QUOTES_DB.prepare(`INSERT INTO quote_build_plans (quote_id, version, plan_json, created_at, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, 'mark')
    ON CONFLICT(quote_id) DO UPDATE SET version = excluded.version, plan_json = excluded.plan_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(quoteId, version, safe, now, now).run();
  return json({ ok: true, version, updatedAt: now });
}

export async function onRequestPatch(context) {
  const { env, request } = context;
  await ensureSchema(env.QUOTES_DB);
  let body; try { body = await request.json(); } catch { return json({ error: 'Body must be JSON.' }, 400); }
  const quoteId = clean(body.quoteId, 100);
  if (!quoteId) return json({ error: 'Quote id is required.' }, 400);
  const quote = await env.QUOTES_DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(quoteId).first();
  if (!quote) return json({ error: 'Quote not found.' }, 404);
  if (quote.status !== 'draft') return json({ error: 'This quote is finalized. Its build plan is read-only.' }, 409);
  return onRequestPost(context);
}
