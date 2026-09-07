import { json } from '../_lib/quotes.mjs';

const DEFAULT_FROM = 'Clearview Windows <estimates@windowsbyclearveiw.com>';
const DEFAULT_TO = 'owner@windowsbyclearveiw.com';

async function resendRequest(key, path, options = {}) {
  const response = await fetch(`https://api.resend.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function redactEmail(value) {
  const raw = String(value || '');
  const at = raw.indexOf('@');
  if (at <= 1) return raw ? 'configured' : '';
  return `${raw.slice(0, 1)}***${raw.slice(at)}`;
}

export async function onRequestPost(context) {
  const { env } = context;
  const key = env?.RESEND_API_KEY;
  if (!key) return json({ error: 'RESEND_API_KEY is not configured in this environment.' }, 503);

  const from = env.RESEND_FROM || DEFAULT_FROM;
  const to = env.NOTIFY_EMAIL || DEFAULT_TO;
  const now = new Date().toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const { response, body } = await resendRequest(key, '/emails', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Clearview production mail test',
      html: `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="620" style="width:100%;max-width:620px;background:#fff;border:1px solid #e5e7eb" cellpadding="0" cellspacing="0"><tr><td style="padding:28px;border-bottom:2px solid #111827"><div style="font-size:22px;font-weight:700">Clearview Windows</div><div style="margin-top:4px;color:#6b7280;font-size:12px">Production mail test</div></td></tr><tr><td style="padding:28px;font-size:15px;line-height:1.6"><p style="margin:0 0 12px"><strong>This is a controlled production email test.</strong></p><p style="margin:0 0 12px">If this message reached the configured Clearview notification inbox, the Resend send path is working in the production environment.</p><p style="margin:0;color:#6b7280">Sent at ${now} (Pacific time).</p></td></tr></table></td></tr></table></body></html>`,
      text: `Clearview production mail test\n\nThis is a controlled production email test. If this message reached the configured Clearview notification inbox, the Resend send path is working in the production environment.\n\nSent at ${now} (Pacific time).`,
    }),
  });

  if (!response.ok) {
    console.error('mail-test-resend-failed', response.status, body?.name || body?.message || '');
    return json({
      ok: false,
      provider: 'resend',
      resendStatus: response.status,
      error: body?.message || 'Resend rejected the production mail test.',
      from: redactEmail(from),
      to: redactEmail(to),
    }, 502);
  }

  return json({
    ok: true,
    provider: 'resend',
    resendStatus: response.status,
    messageId: body?.id || null,
    recipient: redactEmail(to),
    sentAt: now,
  });
}

export async function onRequestGet(context) {
  const key = context.env?.RESEND_API_KEY;
  if (!key) return json({ error: 'RESEND_API_KEY is not configured in this environment.' }, 503);

  const emails = await resendRequest(key, '/emails?limit=10');
  const domains = await resendRequest(key, '/domains?limit=20');

  if (!emails.response.ok) {
    return json({
      ok: false,
      provider: 'resend',
      emailsStatus: emails.response.status,
      domainsStatus: domains.response.status,
      error: emails.body?.message || 'Resend did not return recent email activity.',
      domains: Array.isArray(domains.body?.data) ? domains.body.data.map((domain) => ({
        id: domain.id || null,
        name: domain.name || null,
        status: domain.status || null,
        region: domain.region || null,
      })) : [],
    }, 502);
  }

  return json({
    ok: true,
    provider: 'resend',
    emailsStatus: emails.response.status,
    domainsStatus: domains.response.status,
    emails: Array.isArray(emails.body?.data) ? emails.body.data.map((email) => ({
      id: email.id || null,
      to: Array.isArray(email.to) ? email.to.map(redactEmail) : [],
      from: redactEmail(email.from),
      subject: email.subject || '',
      created_at: email.created_at || null,
      last_event: email.last_event || null,
    })) : [],
    domains: Array.isArray(domains.body?.data) ? domains.body.data.map((domain) => ({
      id: domain.id || null,
      name: domain.name || null,
      status: domain.status || null,
      region: domain.region || null,
    })) : [],
  });
}
