// Post-job Google review request. One ask per job, only after the project
// closeout is finalized. Email goes through Resend; "sms" returns a prefilled
// sms: link so Mark texts from his own phone (no SMS provider, no A2P
// registration) and records that he did. D1 is the record of who was asked.
import { reviewEmail, reviewUrl, smsBody } from '../../_lib/review-request.mjs';

const FROM = 'Clearview Windows <estimates@windowsbyclearveiw.com>';
const EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}

async function ensureSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS review_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL UNIQUE,
    channel TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    sent_by TEXT NOT NULL DEFAULT 'mark',
    provider_id TEXT
  )`).run();
}

function smsHref(phone, body) {
  const digits = String(phone || '').replace(/\D/g, '');
  const number = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : '';
  return number ? `sms:${number}?&body=${encodeURIComponent(body)}` : '';
}

async function loadState(env, jobId) {
  const db = env.QUOTES_DB;
  await ensureSchema(db);
  const job = await db.prepare('SELECT id, status, customer_name, customer_phone, customer_email FROM jobs WHERE id = ?').bind(jobId).first();
  if (!job) return { error: 'Job not found.', status: 404 };
  let closeout = null;
  try {
    closeout = await db.prepare('SELECT finalized_at FROM job_closeouts WHERE job_id = ?').bind(jobId).first();
  } catch {}
  const sent = await db.prepare('SELECT channel, sent_at FROM review_requests WHERE job_id = ?').bind(jobId).first();
  const url = reviewUrl(env);
  const email = EMAIL_PATTERN.test(String(job.customer_email || '')) ? job.customer_email : '';
  const sms = smsHref(job.customer_phone, smsBody(job.customer_name, url));
  let reason = '';
  if (String(job.status).toLowerCase() === 'cancelled') reason = 'Cancelled jobs are not asked for reviews.';
  else if (!closeout?.finalized_at) reason = 'Finalize the project closeout first. Ask only after the customer has signed off.';
  else if (sent) reason = 'A review request was already sent for this job.';
  return {
    job,
    eligible: !reason,
    reason,
    sent: sent ? { channel: sent.channel, sentAt: sent.sent_at } : null,
    channels: { email: Boolean(email), sms: Boolean(sms) },
    email,
    smsHref: sms,
    reviewUrl: url,
  };
}

export async function onRequestGet({ env, request }) {
  const jobId = new URL(request.url).searchParams.get('jobId');
  if (!jobId) return json({ error: 'jobId is required.' }, 400);
  const state = await loadState(env, jobId);
  if (state.error) return json({ error: state.error }, state.status);
  const { job, ...rest } = state;
  return json({ jobId, customerName: job.customer_name, ...rest });
}

export async function onRequestPost({ env, request }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
  const channel = body.channel === 'email' || body.channel === 'sms' ? body.channel : '';
  if (!jobId || !channel) return json({ error: 'jobId and a channel of email or sms are required.' }, 400);

  const state = await loadState(env, jobId);
  if (state.error) return json({ error: state.error }, state.status);
  if (!state.eligible) return json({ error: state.reason, code: state.sent ? 'REVIEW_ALREADY_REQUESTED' : 'REVIEW_NOT_ELIGIBLE', sent: state.sent }, 409);
  if (!state.channels[channel]) return json({ error: channel === 'email' ? 'This job has no valid customer email.' : 'This job has no valid customer phone number.', code: 'CHANNEL_UNAVAILABLE' }, 409);

  // Reserve the one-per-job slot before sending, so a double tap can never
  // email the customer twice. Released again if the email fails.
  const now = new Date().toISOString();
  try {
    await env.QUOTES_DB.prepare('INSERT INTO review_requests (job_id, channel, sent_at, sent_by) VALUES (?,?,?,?)')
      .bind(jobId, channel, now, 'mark').run();
  } catch {
    return json({ error: 'A review request was already sent for this job.', code: 'REVIEW_ALREADY_REQUESTED' }, 409);
  }

  if (channel === 'email') {
    const release = () => env.QUOTES_DB.prepare('DELETE FROM review_requests WHERE job_id = ?').bind(jobId).run();
    const key = env?.RESEND_API_KEY;
    if (!key) {
      await release();
      return json({ error: 'Mail is not configured.' }, 503);
    }
    const message = reviewEmail(state.job.customer_name, state.reviewUrl);
    let response;
    let result = {};
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: env?.RESEND_FROM || FROM,
          to: [state.email],
          reply_to: env?.NOTIFY_EMAIL || 'owner@windowsbyclearveiw.com',
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
      result = await response.json().catch(() => ({}));
    } catch {}
    if (!response?.ok) {
      console.error('review-request-failed', response?.status || 'network', result?.name || '');
      await release();
      return json({ error: 'Could not send the review request email.' }, 502);
    }
    const providerId = typeof result?.id === 'string' ? result.id.slice(0, 100) : null;
    await env.QUOTES_DB.prepare('UPDATE review_requests SET provider_id = ? WHERE job_id = ?').bind(providerId, jobId).run();
  }

  return json({ ok: true, channel, sentAt: now, smsHref: channel === 'sms' ? state.smsHref : undefined });
}
