const MAX = {
  name: 120,
  phone: 40,
  email: 160,
  city: 80,
  role: 40,
  notes: 2000,
};

const FROM = 'Clearveiw Windows <estimates@windowsbyclearveiw.com>';
const TO = 'mark.rotar1000@gmail.com';

const TEMPLATES = {
  lead: {
    id: 'estimate-request',
    preview: 'https://resend.com/templates/f8b73ea1-867e-48b8-8ccf-926b1a825913',
  },
  receipt: {
    id: 'estimate-received',
    preview: 'https://resend.com/templates/68555c62-cbc3-4061-8dfe-ea1b02a59c75',
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/** Browsers without JS post the form directly; send them to a real page. */
function redirect(request, path) {
  const target = new URL(path, request.url);
  return new Response(null, {
    status: 303,
    headers: { location: target.toString(), 'cache-control': 'no-store' },
  });
}

function wantsJson(request) {
  return (request.headers.get('accept') || '').includes('application/json');
}

function clean(value, max) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * A tel: URI has to be a dialable string, not a formatted one. The lead email
 * previously built `tel:(564) 208-0801` straight from the display value, which
 * several mail clients refuse to linkify — breaking the single most important
 * action in the whole message.
 */
function telUri(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  // Anything else is already unusual; hand over the bare digits rather than a
  // guessed country code.
  return digits;
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
    console.error('resend-failed', response.status, body?.name || body?.message || '');
    throw new Error('Could not deliver the request.');
  }
  return body;
}

export async function onRequestPost(context) {
  const { request } = context;
  const asJson = wantsJson(request);

  let form;
  try {
    form = await request.formData();
  } catch {
    return asJson
      ? json({ error: 'Send the form as multipart data.' }, 400)
      : redirect(request, '/estimate/problem');
  }

  // Honeypot. Bots fill every field they see; people never see this one.
  if (clean(form.get('company'), 80)) {
    return asJson ? json({ ok: true }) : redirect(request, '/estimate/sent');
  }

  const lead = {
    name: clean(form.get('name'), MAX.name),
    phone: clean(form.get('phone'), MAX.phone),
    email: clean(form.get('email'), MAX.email),
    city: clean(form.get('city'), MAX.city),
    role: clean(form.get('role'), MAX.role),
    notes: clean(form.get('notes'), MAX.notes),
  };

  if (!lead.name || !lead.phone || !lead.city) {
    return asJson
      ? json({ error: 'Name, phone, and city are required.' }, 400)
      : redirect(request, '/estimate/problem');
  }

  // A phone number with no digits is a typo or a bot, either way not callable.
  const phoneDigits = lead.phone.replace(/\D/g, '');
  if (phoneDigits.length < 7) {
    return asJson
      ? json({ error: 'That phone number looks incomplete.' }, 400)
      : redirect(request, '/estimate/problem');
  }

  const emailLooksReal = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(lead.email);
  if (lead.email && !emailLooksReal) {
    return asJson
      ? json({ error: 'That email address looks incomplete.' }, 400)
      : redirect(request, '/estimate/problem');
  }

  const key = context.env?.RESEND_API_KEY;
  if (!key) {
    console.error('estimate-request missing RESEND_API_KEY');
    return asJson ? json({ error: 'Mail is not configured yet.' }, 503) : redirect(request, '/estimate/problem');
  }

  const from = context.env?.RESEND_FROM || FROM;
  const to = context.env?.NOTIFY_EMAIL || TO;

  try {
    await sendTemplate(key, {
      from,
      to: [to],
      ...(lead.email ? { reply_to: lead.email } : {}),
      template: {
        id: TEMPLATES.lead.id,
        variables: {
          CUSTOMER_NAME: lead.name,
          CUSTOMER_PHONE: lead.phone,
          CUSTOMER_PHONE_HREF: telUri(lead.phone),
          CUSTOMER_EMAIL: lead.email || 'Not given',
          CITY: lead.city,
          NOTES: [lead.role && `[${lead.role}]`, lead.notes || 'No notes.']
            .filter(Boolean)
            .join(' '),
          RECEIVED_AT: receivedAt(),
        },
      },
    });
  } catch {
    return asJson
      ? json({ error: 'Could not deliver the request.' }, 502)
      : redirect(request, '/estimate/problem');
  }

  // The customer receipt is a courtesy. Mark already has the lead, so never
  // fail the request because the confirmation bounced.
  if (lead.email && emailLooksReal) {
    context.waitUntil(
      sendTemplate(key, {
        from,
        to: [lead.email],
        template: {
          id: TEMPLATES.receipt.id,
          variables: {
            CUSTOMER_NAME: lead.name,
            CITY: lead.city,
          },
        },
      }).catch((error) => {
        console.error('receipt-failed', error);
      }),
    );
  }

  return asJson ? json({ ok: true }) : redirect(request, '/estimate/sent');
}

export async function onRequestGet() {
  return json(
    {
      error: 'POST a request from the estimate form.',
      templates: TEMPLATES,
    },
    405,
  );
}
