// Behaviour of the post-job Google review request, executed against the real
// handler and a real SQLite engine.
import { createD1 } from './_lib/d1-sqlite.mjs';
import * as jobs from '../functions/internal/api/jobs.js';
import * as review from '../functions/internal/api/review-request.js';
import { reviewEmail, reviewUrl, smsBody } from '../functions/_lib/review-request.mjs';

const assert = (condition, message) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
};

const emails = [];
let failMail = false;
globalThis.fetch = async (url, init) => {
  if (failMail) return new Response(JSON.stringify({ name: 'boom' }), { status: 500 });
  emails.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ id: `re_${emails.length}` }), { status: 200 });
};

const ORIGIN = 'https://windowsbyclearview.com';
async function call(handler, env, { method = 'GET', path = '/', body } = {}) {
  const request = new Request(`${ORIGIN}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const r = await handler({ request, env, params: {}, waitUntil() {} });
  return { status: r.status, body: await r.json() };
}

async function setup({ finalized = true, status = 'completed', email = 'pat@example.com', phone = '(360) 555-0100' } = {}) {
  const env = { QUOTES_DB: createD1({ schemaFiles: ['internal/db/schema.sql'] }), RESEND_API_KEY: 'test' };
  await call(jobs.onRequestGet, env, { path: '/internal/api/jobs' }); // creates jobs + job_closeouts tables
  const now = new Date().toISOString();
  await env.QUOTES_DB.prepare('INSERT INTO jobs (id, created_at, updated_at, status, customer_name, customer_phone, customer_email) VALUES (?,?,?,?,?,?,?)')
    .bind('J-1', now, now, status, 'Pat Doe', phone, email).run();
  await env.QUOTES_DB.prepare('INSERT INTO job_closeouts (job_id, finalized_at, updated_at) VALUES (?,?,?)')
    .bind('J-1', finalized ? now : null, now).run();
  return env;
}

const get = (env) => call(review.onRequestGet, env, { path: '/internal/api/review-request?jobId=J-1' });
const ask = (env, channel) => call(review.onRequestPost, env, { method: 'POST', body: { jobId: 'J-1', channel } });

// Link selection and content rules.
assert(reviewUrl({}) === 'https://share.google/cdPgOCHSjkwMazSOC', 'falls back to the Google profile share link');
assert(reviewUrl({ GOOGLE_PLACE_ID: 'ChIJabc123XYZ_-' }) === 'https://search.google.com/local/writereview?placeid=ChIJabc123XYZ_-', 'uses the direct write-review form when a Place ID is configured');
assert(reviewUrl({ GOOGLE_REVIEW_URL: 'javascript:alert(1)' }) === 'https://share.google/cdPgOCHSjkwMazSOC', 'rejects a non-https override');
const mail = reviewEmail('<b>Pat</b> Doe', 'https://example.com/r');
assert(!mail.html.includes('<b>Pat</b>') && mail.html.includes('&lt;b&gt;Pat&lt;/b&gt;'), 'customer name is HTML-escaped in the email');
assert(!/5 stars|five stars|write something like|example review/i.test(mail.text + smsBody('Pat', 'u')), 'message never suggests review content or a rating');

// Not eligible before the closeout is finalized.
{
  const env = await setup({ finalized: false });
  const state = await get(env);
  assert(state.body.eligible === false && /Finalize/.test(state.body.reason), 'not eligible until the closeout is finalized');
  const r = await ask(env, 'email');
  assert(r.status === 409 && r.body.code === 'REVIEW_NOT_ELIGIBLE' && emails.length === 0, 'POST refuses before finalization and sends nothing');
}

// Cancelled jobs are never asked.
{
  const env = await setup({ status: 'cancelled' });
  assert((await get(env)).body.eligible === false, 'cancelled jobs are not eligible');
}

// Email path: one ask per job, recorded, idempotent.
{
  emails.length = 0;
  const env = await setup();
  const state = await get(env);
  assert(state.body.eligible && state.body.channels.email && state.body.channels.sms, 'finalized job with email and phone offers both channels');
  assert(state.body.smsHref.startsWith('sms:+13605550100?&body='), 'sms link targets the customer number in E.164');
  const first = await ask(env, 'email');
  assert(first.status === 200 && emails.length === 1 && emails[0].to[0] === 'pat@example.com', 'email is sent to the customer');
  assert(emails[0].html.includes('https://share.google/cdPgOCHSjkwMazSOC'), 'email links to the Google profile');
  const second = await ask(env, 'email');
  const smsAfter = await ask(env, 'sms');
  assert(second.status === 409 && smsAfter.status === 409 && emails.length === 1, 'a job is asked at most once across channels');
  const after = await get(env);
  assert(after.body.sent?.channel === 'email' && after.body.eligible === false, 'the ask is recorded and shown as sent');
  const row = await env.QUOTES_DB.prepare('SELECT provider_id FROM review_requests WHERE job_id = ?').bind('J-1').first();
  assert(row.provider_id === 're_1', 'Resend message id is stored for traceability');
}

// A failed email releases the slot so Mark can retry.
{
  emails.length = 0;
  const env = await setup();
  failMail = true;
  const original = console.error;
  console.error = () => {};
  const failed = await ask(env, 'email');
  console.error = original;
  failMail = false;
  assert(failed.status === 502 && (await get(env)).body.eligible === true, 'failed email is not recorded as an ask');
  assert((await ask(env, 'email')).status === 200, 'retry after a failure succeeds');
}

// SMS path records the ask without any provider; missing email hides that channel.
{
  emails.length = 0;
  const env = await setup({ email: '' });
  const state = await get(env);
  assert(state.body.channels.email === false && state.body.channels.sms === true, 'no email on file hides the email channel');
  assert((await ask(env, 'email')).body.code === 'CHANNEL_UNAVAILABLE', 'email ask is refused without an address');
  const sms = await ask(env, 'sms');
  assert(sms.status === 200 && sms.body.smsHref && emails.length === 0, 'text ask is recorded and returns the sms link without sending mail');
}

console.log('review request tests passed');
