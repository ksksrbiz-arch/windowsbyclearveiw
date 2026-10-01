// Calls to Groq and Gemini, optionally routed through Cloudflare AI Gateway.
//
// Off until AI_GATEWAY_URL is set (the gateway's base URL, e.g.
// https://gateway.ai.cloudflare.com/v1/<account id>/<gateway id>). When on, the gateway adds
// request counts, token and cost totals, latency, errors and rate limits in the Cloudflare
// dashboard. Rules this module enforces:
//
//   * Privacy: customers' questions and our answers are NOT stored by the gateway
//     (cf-aig-collect-log-payload: false). Only metadata is kept, matching the Ask log, which
//     deliberately stores no question text.
//   * Never a single point of failure: if the gateway is unreachable, misconfigured (401/403/404)
//     or down (502/503/504), the same request is sent straight to the provider.
//   * No answer caching here: Ask answers depend on conversation, photos and live pricing.
//   * Provider keys travel in headers (never in the URL), so they cannot end up in a URL log.
//
//   AI_GATEWAY_URL     optional; the base URL above
//   AI_GATEWAY_TOKEN   optional; only if "Authenticated Gateway" is turned on for the gateway

const GATEWAY_URL = /^https:\/\/gateway\.ai\.cloudflare\.com\/v1\/[a-f0-9]{32}\/[A-Za-z0-9_-]{1,64}\/?$/;
const GROQ_DIRECT = 'https://api.groq.com/openai/v1';
const GEMINI_DIRECT = 'https://generativelanguage.googleapis.com';
const FALL_BACK_ON = new Set([401, 403, 404, 502, 503, 504]);

export function gatewayBase(env) {
  const value = String(env?.AI_GATEWAY_URL || '').trim();
  return GATEWAY_URL.test(value) ? value.replace(/\/$/, '') : null;
}

function gatewayHeaders(env, feature) {
  const headers = { 'cf-aig-collect-log-payload': 'false', 'cf-aig-metadata': JSON.stringify({ feature }) };
  const token = String(env?.AI_GATEWAY_TOKEN || '').trim();
  if (token) headers['cf-aig-authorization'] = `Bearer ${token}`;
  return headers;
}

async function send(env, { feature, providerSegment, directUrl, gatewayPath, headers, body, signal }, fetchImpl) {
  const init = (extra) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers, ...extra }, body: JSON.stringify(body), signal });
  const base = gatewayBase(env);
  if (base) {
    try {
      const response = await fetchImpl(`${base}/${providerSegment}${gatewayPath}`, init(gatewayHeaders(env, feature)));
      if (!FALL_BACK_ON.has(response.status)) return response;
      console.error('ai-gateway-fallback', response.status);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.error('ai-gateway-unreachable', error?.message || error);
    }
  }
  return fetchImpl(directUrl, init({}));
}

/** Groq chat completions (OpenAI format). `body` is the request JSON. */
export function groqChat(env, body, { feature = 'ask', signal, fetchImpl = fetch } = {}) {
  return send(env, {
    feature, providerSegment: 'groq', directUrl: `${GROQ_DIRECT}/chat/completions`, gatewayPath: '/chat/completions',
    headers: { authorization: `Bearer ${env.GROQ_API_KEY}` }, body, signal,
  }, fetchImpl);
}

/** Gemini generateContent. `model` is the model id; `body` is the request JSON. */
export function geminiGenerate(env, model, body, { feature = 'ask', signal, fetchImpl = fetch } = {}) {
  const path = `/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return send(env, {
    feature, providerSegment: 'google-ai-studio', directUrl: `${GEMINI_DIRECT}${path}`, gatewayPath: path,
    headers: { 'x-goog-api-key': String(env.GEMINI_API_KEY || '') }, body, signal,
  }, fetchImpl);
}
