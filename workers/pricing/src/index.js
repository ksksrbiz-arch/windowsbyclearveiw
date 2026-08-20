/**
 * Clearveiw pricing worker.
 *
 * What this does NOT do: go and find out what windows cost. There is no
 * authoritative feed for Clark County window pricing, and a worker that
 * scraped lead-gen cost guides or asked a model to guess would drift silently
 * while looking authoritative — worse than no worker at all.
 *
 * What it actually does, all of which is checkable:
 *   GET  /            serve the current pricing document
 *   GET  /health      validation state, age, and whether a review is overdue
 *   PUT  /            replace the pricing document (bearer token, validated)
 *   cron              re-validate and email Mark when it is stale or broken
 *
 * The site ships its own copy of the numbers and only *upgrades* from this
 * worker, so an outage here can never blank out the estimator.
 */

import { validatePricing } from '../../../shared/pricing-schema.mjs';

const KEY = 'pricing:current';

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Short cache: the estimator wants current numbers, but this must not be
      // a per-visitor origin hit either.
      'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
      ...extra,
    },
  });

function corsHeaders(env, request) {
  const allowed = env.ALLOWED_ORIGIN || '*';
  const origin = request.headers.get('origin') || '';
  const ok = allowed === '*' || origin === allowed;
  return {
    'access-control-allow-origin': ok ? origin || allowed : allowed,
    'access-control-allow-methods': 'GET, PUT, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    vary: 'origin',
  };
}

async function readPricing(env) {
  const raw = await env.PRICING.get(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Constant-time-ish compare so the token cannot be probed byte by byte. */
function tokenMatches(provided, expected) {
  if (!provided || !expected || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

async function sendAlert(env, subject, lines) {
  if (!env.RESEND_API_KEY) {
    console.error('pricing-alert skipped: no RESEND_API_KEY');
    return;
  }
  const body = lines.join('\n');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM || 'Clearveiw Windows <estimates@windowsbyclearveiw.com>',
      to: [env.NOTIFY_EMAIL],
      subject,
      text: body,
    }),
  });
  if (!response.ok) {
    console.error('pricing-alert send failed', response.status);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(env, request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      const doc = await readPricing(env);
      if (!doc) return json({ ok: false, stored: false }, 200, cors);
      const result = validatePricing(doc);
      return json(
        {
          ok: result.ok,
          stored: true,
          source: doc.basis?.source ?? null,
          reviewedAt: doc.basis?.reviewedAt ?? null,
          ageDays: result.ageDays,
          problems: result.problems,
          warnings: result.warnings,
        },
        200,
        cors,
      );
    }

    if (request.method === 'GET') {
      const doc = await readPricing(env);
      if (!doc) {
        // Nothing stored yet is a normal state — the site falls back to the
        // numbers it shipped with.
        return json({ error: 'no pricing stored' }, 404, cors);
      }
      const result = validatePricing(doc);
      if (!result.ok) {
        // Never serve numbers that would produce a wrong quote.
        console.error('pricing invalid, refusing to serve', result.problems);
        return json({ error: 'stored pricing failed validation' }, 409, cors);
      }
      return json(doc, 200, cors);
    }

    if (request.method === 'PUT') {
      const auth = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (!tokenMatches(auth, env.ADMIN_TOKEN || '')) {
        return json({ error: 'unauthorized' }, 401, cors);
      }

      let doc;
      try {
        doc = await request.json();
      } catch {
        return json({ error: 'body must be JSON' }, 400, cors);
      }

      const result = validatePricing(doc);
      if (!result.ok) {
        return json({ error: 'validation failed', problems: result.problems }, 422, cors);
      }

      await env.PRICING.put(KEY, JSON.stringify(doc));
      await sendAlert(env, 'Clearveiw pricing updated', [
        'The window pricing used by the cost estimator was just replaced.',
        '',
        `Source:      ${doc.basis?.source}`,
        `Reviewed:    ${doc.basis?.reviewedAt}`,
        `Openings:    ${doc.openings?.length ?? 0}`,
        result.warnings.length ? `\nWarnings:\n- ${result.warnings.join('\n- ')}` : '',
        '',
        `Live at ${env.SITE_URL}/tools/window-replacement-cost-calculator`,
      ]);

      return json({ ok: true, warnings: result.warnings }, 200, cors);
    }

    return json({ error: 'method not allowed' }, 405, { ...cors, allow: 'GET, PUT, OPTIONS' });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const doc = await readPricing(env);

        if (!doc) {
          // Nothing stored means the site is running on its bundled numbers.
          // That is fine, but Mark should still be reminded to confirm them.
          await sendAlert(env, 'Clearveiw pricing: still using the numbers in the repo', [
            'The pricing worker has nothing stored, so the cost estimator is running on the',
            'figures committed in src/data/pricing.ts — currently published Washington',
            'averages rather than your own pricing.',
            '',
            'That is safe: the site labels them as regional averages. But your real numbers',
            'will convert better, and they are a one-file change.',
            '',
            `Tool: ${env.SITE_URL}/tools/window-replacement-cost-calculator`,
          ]);
          return;
        }

        const result = validatePricing(doc);

        if (!result.ok) {
          await sendAlert(env, 'Clearveiw pricing: FAILED validation — estimator fell back', [
            'The stored pricing document is not valid, so the worker is refusing to serve it.',
            'The estimator has fallen back to the numbers committed in the repo, so the site',
            'is still working — but the stored copy needs fixing.',
            '',
            'Problems:',
            ...result.problems.map((p) => `- ${p}`),
          ]);
          return;
        }

        if (result.warnings.length > 0) {
          await sendAlert(env, 'Clearveiw pricing: time to re-confirm the numbers', [
            `The window pricing behind the cost estimator was last reviewed ${result.ageDays} days ago.`,
            '',
            ...result.warnings.map((w) => `- ${w}`),
            '',
            doc.basis?.source === 'averages'
              ? 'These are still published regional averages, not your own pricing. Swapping in'
              : 'These are your own numbers. Worth a look to see if they still hold.',
            doc.basis?.source === 'averages' ? 'your real ranges is the single biggest upgrade to this tool.' : '',
            '',
            'Nothing is broken and no action is urgent — the site keeps working either way.',
          ]);
        }
      })(),
    );
  },
};
