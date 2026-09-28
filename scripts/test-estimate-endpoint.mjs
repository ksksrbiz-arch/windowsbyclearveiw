// Behavioural tests for functions/api/estimate.js. Unlike the source-regex
// guards elsewhere, these execute the real handler against an in-memory D1
// stand-in and a stubbed Resend, so they catch wiring mistakes, not just
// missing strings.
import { onRequestPost } from '../functions/api/estimate.js';

const assert = (condition, message) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
};

function fakeDb({ failReads = false } = {}) {
  const leads = [];
  return {
    leads,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (/^\s*INSERT INTO leads/i.test(sql)) {
                leads.push({ created_at: args[0], email: args[3], notes: args[6] });
              }
            },
            async first() {
              if (failReads) throw new Error('d1 down');
              const [email, since] = args;
              const n = leads.filter(
                (l) => l.email && l.email.toLowerCase() === String(email).toLowerCase() && l.created_at > since,
              ).length;
              return { n };
            },
          };
        },
      };
    },
  };
}

const sent = [];
const pushes = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://ntfy.sh/')) {
    pushes.push({ url: String(url), headers: init.headers, body: init.body });
    return new Response('{}', { status: 200 });
  }
  sent.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ id: `msg_${sent.length}` }), { status: 200 });
};

async function submit(env, fields) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const request = new Request('https://windowsbyclearview.com/api/estimate', {
    method: 'POST',
    headers: { accept: 'application/json', origin: 'https://windowsbyclearview.com' },
    body: form,
  });
  const pending = [];
  const response = await onRequestPost({ request, env, waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  return { status: response.status, body: await response.json() };
}

const base = { name: 'Pat Doe', phone: '(360) 555-0100', city: 'Camas', email: 'pat@example.com' };

// 1. Line breaks from the calculator/quiz pre-fill survive into D1 and the lead email.
{
  sent.length = 0;
  const env = { QUOTES_DB: fakeDb(), RESEND_API_KEY: 'test' };
  const notes = 'Home type: Two-story\r\nApproximate openings:   8\n\n\n\nMain concern: drafts\u0007';
  const { status, body } = await submit(env, { ...base, notes });
  assert(status === 200 && body.ok === true, 'valid submission succeeds');
  const stored = env.QUOTES_DB.leads[0].notes;
  assert(stored === 'Home type: Two-story\nApproximate openings: 8\n\nMain concern: drafts', 'notes keep one detail per line, collapse runs, strip control chars');
  assert(sent[0].template.variables.NOTES.startsWith('Home type: Two-story\nApproximate openings: 8'), 'lead email NOTES preserves line breaks');
  assert(sent.length === 2 && sent[1].to[0] === 'pat@example.com', 'first submission sends Mark notification and customer receipt');
}

// 2. A repeat submission for the same address within 24h still notifies Mark
//    but does not mail the address again.
{
  sent.length = 0;
  const env = { QUOTES_DB: fakeDb(), RESEND_API_KEY: 'test' };
  await submit(env, base);
  await submit(env, { ...base, email: 'PAT@example.com' });
  const toMark = sent.filter((m) => m.template.id === 'estimate-request');
  const receipts = sent.filter((m) => m.template.id === 'estimate-received');
  assert(toMark.length === 2, 'every submission notifies Mark');
  assert(receipts.length === 1, 'receipt is sent once per address per day (case-insensitive)');
  assert(env.QUOTES_DB.leads.length === 2, 'every submission is still logged');
}

// 3. A different address is unaffected, and a D1 read failure fails open.
{
  sent.length = 0;
  const env = { QUOTES_DB: fakeDb(), RESEND_API_KEY: 'test' };
  await submit(env, base);
  await submit(env, { ...base, email: 'other@example.com' });
  assert(sent.filter((m) => m.template.id === 'estimate-received').length === 2, 'distinct addresses each get a receipt');

  sent.length = 0;
  const original = console.error;
  console.error = () => {};
  const { status } = await submit({ QUOTES_DB: fakeDb({ failReads: true }), RESEND_API_KEY: 'test' }, base);
  console.error = original;
  assert(status === 200 && sent.some((m) => m.template.id === 'estimate-received'), 'receipt still sends when the dedupe lookup fails');
}

// 4. Existing validation contract is unchanged.
{
  const { status, body } = await submit({ RESEND_API_KEY: 'test' }, { ...base, phone: '555' });
  assert(status === 400 && typeof body.fields?.phone === 'string', 'short phone numbers are rejected with a field error');
}

// 5. Speed-to-lead push: fires once per valid lead, carries no customer data,
//    stays off without a long topic, and never fires for honeypot or invalid posts.
{
  const TOPIC = 'cv-leads-3f9a1c7e2b8d4a60';
  pushes.length = 0;
  await submit({ QUOTES_DB: fakeDb(), RESEND_API_KEY: 'test', LEAD_ALERT_NTFY_TOPIC: TOPIC }, { ...base, notes: 'Two sliders' });
  assert(pushes.length === 1 && pushes[0].url === `https://ntfy.sh/${TOPIC}`, 'a valid lead sends one push to the configured topic');
  const payload = JSON.stringify(pushes[0]);
  assert(!/Pat|Camas|555|example\.com|sliders/i.test(payload), 'push carries no submitted customer fields');
  assert(pushes[0].headers.Click === 'https://windowsbyclearview.com/internal/leads', 'push opens the authenticated leads view');

  pushes.length = 0;
  await submit({ QUOTES_DB: fakeDb(), RESEND_API_KEY: 'test', LEAD_ALERT_NTFY_TOPIC: 'short' }, base);
  await submit({ QUOTES_DB: fakeDb(), RESEND_API_KEY: 'test' }, base);
  await submit({ RESEND_API_KEY: 'test', LEAD_ALERT_NTFY_TOPIC: TOPIC }, { ...base, company: 'bot' });
  await submit({ RESEND_API_KEY: 'test', LEAD_ALERT_NTFY_TOPIC: TOPIC }, { ...base, phone: '1' });
  assert(pushes.length === 0, 'no push when unconfigured, topic too short, honeypot tripped, or validation fails');

  pushes.length = 0;
  const { status } = await submit({ QUOTES_DB: fakeDb(), LEAD_ALERT_NTFY_TOPIC: TOPIC }, base);
  assert(status === 503 && pushes.length === 1, 'push still fires when mail is not configured');
}

console.log('estimate endpoint tests passed');
