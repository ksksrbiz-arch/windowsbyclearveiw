// End-to-end behaviour of the quote → Build Plan → approval → signature → job
// pipeline, executed against the real handlers and a real SQLite engine.
import { createD1 } from './_lib/d1-sqlite.mjs';
import * as quotesIndex from '../functions/internal/api/quotes/index.js';
import * as quoteById from '../functions/internal/api/quotes/[id].js';
import * as buildPlan from '../functions/internal/api/build-plan.js';
import * as planState from '../functions/internal/api/build-plan-state.js';
import * as jobs from '../functions/internal/api/jobs.js';

process.removeAllListeners('warning');
const assert = (condition, message) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
};

const ORIGIN = 'https://windowsbyclearview.com';
function call(handler, env, { method = 'GET', path = '/', body, params } = {}) {
  const request = new Request(`${ORIGIN}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handler({ request, env, params: params || {}, waitUntil() {} }).then(async (r) => ({ status: r.status, body: await r.json() }));
}

function freshEnv() {
  return { QUOTES_DB: createD1({ schemaFiles: ['internal/db/schema.sql'] }) };
}

const items = [
  { label: 'Milgard vinyl slider, full-frame', quantity: 2, unitPriceCents: 90000 },
  { label: 'Double-hung, full-frame', quantity: 1, unitPriceCents: 85000 },
];
const customer = { name: 'Pat Doe', phone: '3605550100', city: 'Camas' };

async function createQuote(env, overrides = {}) {
  const r = await call(quotesIndex.onRequestPost, env, { method: 'POST', body: { customer, items, signatureMethod: 'pen', ...overrides } });
  if (r.status !== 201) throw new Error(`quote create failed: ${JSON.stringify(r.body)}`);
  return r.body.id;
}

async function saveGeneratedPlan(env, quoteId) {
  const gen = await call(buildPlan.onRequestGet, env, { path: `/internal/api/build-plan?quoteId=${quoteId}` });
  const save = await call(buildPlan.onRequestPost, env, { method: 'POST', body: { quoteId, plan: gen.body.plan } });
  if (save.status !== 200) throw new Error(`plan save failed: ${JSON.stringify(save.body)}`);
}

const transition = (env, quoteId, action) => call(planState.onRequestPost, env, { method: 'POST', body: { quoteId, action } });
const editQuote = (env, id, nextItems) => call(quoteById.onRequestPut, env, { method: 'PUT', params: { id }, body: { customer, items: nextItems, signatureMethod: 'pen' } });
const sign = (env, id) => call(quoteById.onRequestPatch, env, { method: 'PATCH', params: { id }, body: { confirmPen: true, signatureName: 'Pat Doe' } });
const makeJob = (env, quoteId) => call(jobs.onRequestPost, env, { method: 'POST', body: { quoteId } });

// 1. Happy path: every gate passes in order and the job carries the snapshot.
{
  const env = freshEnv();
  const id = await createQuote(env);
  await saveGeneratedPlan(env, id);
  assert((await sign(env, id)).body.code === 'BUILD_PLAN_REQUIRED' || (await sign(env, id)).status === 409, 'quote cannot be signed before plan approval');
  assert((await transition(env, id, 'submit-review')).status === 200, 'plan moves to review');
  assert((await transition(env, id, 'approve')).status === 200, 'plan is approved');
  assert((await sign(env, id)).status === 200, 'quote is signed after approval');
  const job = await makeJob(env, id);
  assert(job.status === 201 && job.body.buildPlanVersion >= 1, 'finalized quote becomes a job with a Build Plan snapshot');
  const again = await makeJob(env, id);
  assert(again.status === 200 && again.body.existing === true && again.body.id === job.body.id, 'job creation is idempotent per quote');
}

// 1b. Digital signature on Mark's device binds every placeholder and finalizes once.
{
  const env = freshEnv();
  const id = await createQuote(env);
  env.QUOTES_DB.raw.prepare(`UPDATE quotes SET signature_method = 'digital' WHERE id = ?`).run(id);
  await saveGeneratedPlan(env, id);
  await transition(env, id, 'submit-review');
  await transition(env, id, 'approve');
  const digital = () => call(quoteById.onRequestPatch, env, { method: 'PATCH', params: { id }, body: { signatureSvg: '<svg/>', signatureName: 'Pat Doe' } });
  assert((await digital()).status === 200, 'digital signature finalizes the quote');
  const row = env.QUOTES_DB.raw.prepare('SELECT status, signature_name, signed_at, updated_at FROM quotes WHERE id = ?').get(id);
  assert(row.status === 'finalized' && row.signature_name === 'Pat Doe' && row.signed_at && row.updated_at, 'digital signature columns are all written');
  assert((await digital()).status === 409, 'a second signature is refused');
}

// 2. Quote list must not flag a freshly approved, unchanged plan as stale.
{
  const env = freshEnv();
  const id = await createQuote(env);
  await saveGeneratedPlan(env, id);
  await transition(env, id, 'submit-review');
  await transition(env, id, 'approve');
  const list = await call(quotesIndex.onRequestGet, env);
  const row = list.body.quotes.find((q) => q.id === id);
  assert(row.build_plan_stale === false, 'quote list shows an unchanged approved plan as current');

  await editQuote(env, id, [...items, { label: 'Picture window', quantity: 1, unitPriceCents: 50000 }]);
  const after = (await call(quotesIndex.onRequestGet, env)).body.quotes.find((q) => q.id === id);
  assert(after.build_plan_stale === true, 'quote list flags the plan as stale once the quote items change');
}

// 3. A state transition must not launder a stale plan into an approvable one.
//    Plan saved for items A; quote edited to items B; plan sent to review.
{
  const env = freshEnv();
  const id = await createQuote(env);
  await saveGeneratedPlan(env, id);
  await editQuote(env, id, [{ label: 'Casement, full-frame', quantity: 5, unitPriceCents: 70000 }]);
  await transition(env, id, 'submit-review');
  const approve = await transition(env, id, 'approve');
  assert(approve.status === 409 && approve.body.code === 'BUILD_PLAN_STALE', 'approval is refused when the plan was built for different quote items');
  const signed = await sign(env, id);
  assert(signed.status === 409, 'the customer cannot sign a quote whose plan does not match it');
}

// 4. Money stays in whole cents even for fractional quantities (e.g. linear feet of trim).
{
  const env = freshEnv();
  const id = await createQuote(env, { items: [{ label: 'Interior trim, per linear foot', quantity: 12.5, unitPriceCents: 333 }] });
  const { body } = await call(quoteById.onRequestGet, env, { params: { id } });
  const line = body.items[0];
  assert(Number.isInteger(line.line_total_cents), `line total is whole cents (got ${line.line_total_cents})`);
  assert(Number.isInteger(body.quote.total_cents) && body.quote.total_cents === line.line_total_cents, 'quote total is whole cents and equals the line');
}

console.log('quote-to-job flow tests passed');
