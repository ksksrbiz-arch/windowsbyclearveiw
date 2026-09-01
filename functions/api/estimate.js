const MAX = {
  name: 120,
  phone: 40,
  email: 160,
  city: 80,
  role: 40,
  notes: 2000,
};

const FROM = 'Clearview Windows <estimates@windowsbyclearveiw.com>';
// Where estimate requests land. Overridable by NOTIFY_EMAIL in the Pages
// environment, which takes precedence over this default.
const TO = 'owner@windowsbyclearveiw.com';

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

function telUri(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits;
}

function emailButtonHtml(name, email) {
  if (!email) return '';
  const safeName = String(name || 'them').replace(/"/g, '&quot;');
  const safeEmail = String(email).replace(/"/g, '&quot;');
  return `<tr>
                    <td style="padding-bottom:12px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td bgcolor="#0f2a54" style="background-color:#0f2a54;border-radius:8px;text-align:center;">
                            <a href="mailto:${safeEmail}" style="display:block;padding-top:16px;padding-bottom:16px;padding-left:20px;padding-right:20px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;line-height:20px;color:#ffffff;text-decoration:none;">&#9993; Email ${safeName}</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>`;
}

function vcardEscape(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function buildVCard(lead) {
  const name = vcardEscape(lead.name || 'Unknown lead');
  const phone = telUri(lead.phone);
  const noteBits = [
    lead.role && `Role: ${lead.role}`,
    lead.city && `City: ${lead.city}`,
    lead.notes && `Notes: ${lead.notes}`,
  ].filter(Boolean);
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${name};;;;`,
    `FN:${name}`,
    'ORG:Windows by Clearview lead',
    phone ? `TEL;TYPE=CELL,VOICE:+${phone.replace(/^\+/, '')}` : '',
    lead.email ? `EMAIL;TYPE=INTERNET:${vcardEscape(lead.email)}` : '',
    lead.city ? `ADR;TYPE=HOME:;;${vcardEscape(lead.city)};;;;` : '',
    noteBits.length ? `NOTE:${vcardEscape(noteBits.join(' | '))}` : '',
    'END:VCARD',
  ].filter(Boolean);
  return lines.join('\r\n');
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
function parseJourney(raw) {
  const empty = { visits: [], firstTouch: null };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw);
    return {
      visits: Array.isArray(parsed?.visits) ? parsed.visits.slice(0, 25) : [],
      firstTouch: parsed?.firstTouch && typeof parsed.firstTouch === 'object' ? parsed.firstTouch : null,
    };
  } catch {
    return empty;
  }
}

function summarizeJourney(journey) {
  const visits = journey.visits;
  if (!visits.length) return '';

  const pageLines = visits
    .slice(-10)
    .map((v) => `  - ${clean(v?.title, 160) || clean(v?.path, 200) || 'Untitled page'}`)
    .join('\n');

  const first = journey.firstTouch || {};
  const arrival = first.utm_source
    ? `arrived via ${clean(first.utm_source, 80)}${first.utm_medium ? `/${clean(first.utm_medium, 80)}` : ''}`
    : first.referrer
      ? `arrived from ${clean(first.referrer, 200)}`
      : 'arrived directly (no referrer)';

  const shown = Math.min(visits.length, 10);
  const omitted = visits.length - shown;
  return [
    `Visitor journey (${visits.length} page${visits.length === 1 ? '' : 's'} viewed this visit, ${arrival}):`,
    pageLines,
    omitted > 0 ? `  …and ${omitted} more (full list in the internal leads view).` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function logLead(env, lead, journey, visitorId) {
  if (!env?.QUOTES_DB) return;
  try {
    const first = journey.firstTouch || {};
    await env.QUOTES_DB.prepare(
      `INSERT INTO leads (
        created_at, name, phone, email, city, role, notes, visitor_id,
        first_seen_at, first_referrer, first_utm_source, first_utm_medium, first_utm_campaign, landing_path,
        visit_count, page_views_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        new Date().toISOString(),
        lead.name,
        lead.phone,
        lead.email || null,
        lead.city,
        lead.role || null,
        lead.notes || null,
        visitorId || null,
        first.ts ? new Date(first.ts).toISOString() : null,
        first.referrer || null,
        first.utm_source || null,
        first.utm_medium || null,
        first.utm_campaign || null,
        first.path || null,
        journey.visits.length,
        JSON.stringify(journey.visits),
      )
      .run();
  } catch (error) {
    console.error('lead-log-failed', error);
  }
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

  const visitorId = clean(form.get('visitor_id'), 100);
  const journey = parseJourney(clean(form.get('visit_journey'), 8000));
  const journeySummary = summarizeJourney(journey);

  context.waitUntil(logLead(context.env, lead, journey, visitorId));

  const key = context.env?.RESEND_API_KEY;
  if (!key) {
    console.error('estimate-request missing RESEND_API_KEY');
    return asJson ? json({ error: 'Mail is not configured yet.' }, 503) : redirect(request, '/estimate/problem');
  }

  const from = context.env?.RESEND_FROM || FROM;
  const to = context.env?.NOTIFY_EMAIL || TO;

  const vcardFilename = `${(lead.name || 'lead').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'lead'}.vcf`;

  try {
    await sendTemplate(key, {
      from,
      to: [to],
      ...(lead.email ? { reply_to: lead.email } : {}),
      attachments: [
        {
          filename: vcardFilename,
          content: toBase64(buildVCard(lead)),
          contentType: 'text/vcard',
        },
      ],
      template: {
        id: TEMPLATES.lead.id,
        variables: {
          CUSTOMER_NAME: lead.name,
          CUSTOMER_PHONE: lead.phone,
          CUSTOMER_PHONE_HREF: telUri(lead.phone),
          CUSTOMER_EMAIL: lead.email || 'Not given',
          EMAIL_BUTTON_HTML: emailButtonHtml(lead.name, lead.email),
          CITY: lead.city,
          NOTES: [lead.role && `[${lead.role}]`, lead.notes || 'No notes.', journeySummary]
            .filter(Boolean)
            .join('\n\n'),
          RECEIVED_AT: receivedAt(),
        },
      },
    });
  } catch {
    return asJson
      ? json({ error: 'Could not deliver the request.' }, 502)
      : redirect(request, '/estimate/problem');
  }

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