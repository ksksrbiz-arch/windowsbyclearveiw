const MAX = {
  name: 120,
  phone: 40,
  email: 160,
  city: 80,
  notes: 2000,
};

const FROM = 'Clearveiw Windows <estimates@windowsbyclearveiw.com>';
const TO = 'mark.rotar1000@gmail.com';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function clean(value, max) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function onRequestPost(context) {
  let form;
  try {
    form = await context.request.formData();
  } catch {
    return json({ error: 'Send the form as multipart data.' }, 400);
  }

  const honey = clean(form.get('company'), 80);
  if (honey) return json({ ok: true });

  const lead = {
    name: clean(form.get('name'), MAX.name),
    phone: clean(form.get('phone'), MAX.phone),
    email: clean(form.get('email'), MAX.email),
    city: clean(form.get('city'), MAX.city),
    notes: clean(form.get('notes'), MAX.notes),
  };

  if (!lead.name || !lead.phone || !lead.city) {
    return json({ error: 'Name, phone, and city are required.' }, 400);
  }

  const key = context.env?.RESEND_API_KEY;
  if (!key) {
    console.error('estimate-request missing RESEND_API_KEY', lead);
    return json({ error: 'Mail is not configured yet.' }, 503);
  }

  const from = context.env?.RESEND_FROM || FROM;
  const to = context.env?.NOTIFY_EMAIL || TO;
  const lines = [
    `Name: ${lead.name}`,
    `Phone: ${lead.phone}`,
    `Email: ${lead.email || '—'}`,
    `City: ${lead.city}`,
    '',
    lead.notes || 'No notes.',
  ];

  const resend = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      ...(lead.email ? { reply_to: lead.email } : {}),
      subject: `Estimate request from ${lead.name} in ${lead.city}`,
      text: lines.join('\n'),
      html: `<p>${lines.map(escapeHtml).join('<br>')}</p>`,
    }),
  });

  const payload = await resend.json().catch(() => ({}));
  if (!resend.ok) {
    console.error('resend-failed', payload);
    return json({ error: 'Could not deliver the request.' }, 502);
  }

  return json({ ok: true, id: payload.id || null });
}

export async function onRequestGet() {
  return json({ error: 'POST a request from the estimate form.' }, 405);
}
