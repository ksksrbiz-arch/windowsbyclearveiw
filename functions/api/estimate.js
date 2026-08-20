const MAX = {
  name: 120,
  phone: 40,
  email: 160,
  city: 80,
  notes: 2000,
};

const DEFAULT_NOTIFY = 'mark.rotar1000@gmail.com';

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

function readLead(form) {
  return {
    name: clean(form.get('name'), MAX.name),
    phone: clean(form.get('phone'), MAX.phone),
    email: clean(form.get('email'), MAX.email),
    city: clean(form.get('city'), MAX.city),
    notes: clean(form.get('notes'), MAX.notes),
    company: clean(form.get('company'), 80),
  };
}

export async function onRequestPost(context) {
  let form;
  try {
    form = await context.request.formData();
  } catch {
    return json({ error: 'Send the form as multipart data.' }, 400);
  }

  const lead = readLead(form);
  if (lead.company) return json({ ok: true });
  if (!lead.name || !lead.phone || !lead.city) {
    return json({ error: 'Name, phone, and city are required.' }, 400);
  }

  const record = {
    ...lead,
    receivedAt: new Date().toISOString(),
  };
  delete record.company;

  console.log('estimate-request', record);

  const webhook = context.env?.LEADS_WEBHOOK;
  const notify =
    (typeof context.env?.NOTIFY_EMAIL === 'string' && context.env.NOTIFY_EMAIL.includes('@')
      ? context.env.NOTIFY_EMAIL
      : DEFAULT_NOTIFY);
  let delivered = false;

  if (typeof webhook === 'string' && webhook.startsWith('https://')) {
    const hook = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(record),
    });
    delivered = hook.ok;
  }

  if (!delivered) {
    const mail = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(notify)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        _subject: `Estimate request from ${record.name} in ${record.city}`,
        name: record.name,
        phone: record.phone,
        email: record.email,
        city: record.city,
        notes: record.notes,
      }),
    });
    delivered = mail.ok;
  }

  if (!delivered) {
    return json({ error: 'Could not deliver the request. Call (564) 208-0801.' }, 502);
  }

  return json({ ok: true });
}

export async function onRequestGet() {
  return json({ error: 'POST a request from the estimate form.' }, 405);
}
