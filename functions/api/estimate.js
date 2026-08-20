const MAX = {
  name: 120,
  phone: 40,
  email: 160,
  city: 80,
  notes: 2000,
};

const FROM = 'Clearveiw Windows <estimates@windowsbyclearveiw.com>';
const TO = 'mark.rotar1000@gmail.com';
const LEAD_TEMPLATE = 'estimate-request';
const RECEIPT_TEMPLATE = 'estimate-received';

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

function receivedAt() {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function sendTemplate(key, payload) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('resend-failed', body);
    throw new Error('Could not deliver the request.');
  }
  return body;
}

export async function onRequestPost(context) {
  let form;
  try {
    form = await context.request.formData();
  } catch {
    return json({ error: 'Send the form as multipart data.' }, 400);
  }

  if (clean(form.get('company'), 80)) return json({ ok: true });

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

  try {
    await sendTemplate(key, {
      from,
      to: [to],
      ...(lead.email ? { reply_to: lead.email } : {}),
      template: {
        id: LEAD_TEMPLATE,
        variables: {
          CUSTOMER_NAME: lead.name,
          CUSTOMER_PHONE: lead.phone,
          CUSTOMER_EMAIL: lead.email || 'Not given',
          CITY: lead.city,
          NOTES: lead.notes || 'No notes.',
          RECEIVED_AT: receivedAt(),
        },
      },
    });

    if (lead.email) {
      await sendTemplate(key, {
        from,
        to: [lead.email],
        template: {
          id: RECEIPT_TEMPLATE,
          variables: {
            CUSTOMER_NAME: lead.name,
            CITY: lead.city,
          },
        },
      }).catch((error) => {
        console.error('receipt-failed', error);
      });
    }
  } catch {
    return json({ error: 'Could not deliver the request.' }, 502);
  }

  return json({ ok: true });
}

export async function onRequestGet() {
  return json({ error: 'POST a request from the estimate form.' }, 405);
}
