const MAX = {
  name: 120,
  phone: 40,
  email: 160,
  city: 80,
  role: 40,
  notes: 2000,
};

const FROM = 'Clearveiw Windows <estimates@windowsbyclearveiw.com>';
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

/**
 * Parses the hidden visit_journey field EstimateForm.astro attaches at
 * submit time (see BaseLayout.astro's trackVisitJourney). Always returns a
 * safe shape even if the field is missing, malformed, or was stripped by a
 * browser with storage disabled — a lead with no journey is just a lead.
 */
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

/** Short, human-readable block folded into the lead email's NOTES variable —
 *  see the comment on TEMPLATES.lead below for why this rides in NOTES
 *  rather than a new template variable. */
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

/**
 * Best-effort record of the inbound lead plus its visit history, so it
 * survives even if Resend has a bad day and so Mark can browse it later at
 * /internal/leads. Never allowed to fail the actual estimate request — see
 * functions/api/_data/schema.sql for the table this writes to.
 */
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

  const visitorId = clean(form.get('visitor_id'), 100);
  const journey = parseJourney(clean(form.get('visit_journey'), 8000));
  const journeySummary = summarizeJourney(journey);

  // Kicked off as soon as we know the lead is real, independent of whether
  // the email below succeeds — a database row is a fallback record, not a
  // reward for the email working.
  context.waitUntil(logLead(context.env, lead, journey, visitorId));

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
