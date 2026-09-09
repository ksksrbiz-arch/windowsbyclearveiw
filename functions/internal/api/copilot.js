import { routeAsk, routeSummary } from '../../ask/_lib/icm-router.mjs';
import { specialistPrompt } from '../../ask/_lib/icm-specialists.mjs';
import { BUSINESS_FACTS } from '../../ask/_lib/facts.mjs';

const MAX_BODY_BYTES = 96 * 1024;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_MESSAGE_LENGTH = 1000;
const MAX_OUTPUT_TOKENS = 900;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function cleanText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

function normalizeHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_HISTORY_MESSAGES).map((item) => ({
    role: item?.role === 'assistant' ? 'assistant' : 'user',
    content: cleanText(item?.content, MAX_HISTORY_MESSAGE_LENGTH),
  })).filter((item) => item.content);
}

async function boundedJson(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_BODY_BYTES) throw new Error('body-too-large');
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) throw new Error('body-too-large');
  return JSON.parse(new TextDecoder().decode(body));
}

async function callGroq(env, messages) {
  if (!env.GROQ_API_KEY) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.GROQ_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'openai/gpt-oss-120b', messages, temperature: 0.2, max_tokens: MAX_OUTPUT_TOKENS }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    return cleanText(data?.choices?.[0]?.message?.content, 7000) || null;
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemini(env, messages) {
  if (!env.GEMINI_API_KEY) return null;
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const system = messages.find((m) => m.role === 'system')?.content || '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS } }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    return cleanText(data?.candidates?.[0]?.content?.parts?.map((p) => p?.text || '').join(' '), 7000) || null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!sameOrigin(request)) return json({ error: 'Forbidden' }, 403);

  let body;
  try {
    body = await boundedJson(request);
  } catch (error) {
    return json({ error: error?.message === 'body-too-large' ? 'Request too large.' : 'Invalid request.' }, 400);
  }

  const message = cleanText(body?.message, MAX_MESSAGE_LENGTH);
  if (!message) return json({ error: 'Message is required.' }, 400);

  const history = normalizeHistory(body?.history);
  const project = body?.project && typeof body.project === 'object' ? body.project : {};
  const route = routeAsk({ message, project, surface: 'internal' });
  const system = [
    'You are Clearview Windows internal operations copilot.',
    'Follow the AI Operating Contract: deterministic application state is authoritative; AI proposes, code validates and commits.',
    'Do not invent measurements, quantities, pricing, credentials, legal status, product specifications, or site conditions.',
    'Use KNOWN, INFERRED, and VERIFY labels when material uncertainty exists. Never approve or complete a business gate.',
    specialistPrompt(route),
    'Controlled business facts:',
    BUSINESS_FACTS,
    routeSummary(route),
    'This v1 endpoint is read-only. Do not claim that you changed any business record.',
  ].join('\n\n');

  const messages = [
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: message },
  ];

  // One primary attempt plus one bounded fallback. Never fan out to multiple models.
  let answer = null;
  let provider = 'degraded';
  answer = await callGroq(env, messages).catch(() => null);
  if (answer) provider = 'groq';
  else {
    answer = await callGemini(env, messages).catch(() => null);
    if (answer) provider = 'gemini';
  }

  if (!answer) {
    answer = `I couldn't complete the AI response right now. Route: ${route.id}. Please verify the relevant records directly in the Command Center.`;
  }

  return json({
    answer,
    route: route.id,
    routeReason: route.reason,
    provider,
    degraded: provider === 'degraded',
    readOnly: true,
    verify: provider === 'degraded' ? ['AI provider unavailable; verify against the underlying application records.'] : [],
  });
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  if (context.request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  return onRequestPost(context);
}
