import { routeAsk } from '../../ask/_lib/icm-router.mjs';
import { specialistPrompt } from '../../ask/_lib/icm-specialists.mjs';
import { BUSINESS_FACTS } from '../../ask/_lib/facts.mjs';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_LEADS = 25;
const MAX_TEXT = 500;
const MAX_OUTPUT_TOKENS = 800;

function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } }); }
function clean(value, max = MAX_TEXT) { return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max); }
function sameOrigin(request) { const origin = request.headers.get('origin'); if (!origin) return true; try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; } }
function leadSnapshot(row) {
  let pageViews = [];
  try { const parsed = JSON.parse(row.page_views_json || '[]'); if (Array.isArray(parsed)) pageViews = parsed.slice(0, 20).map((p) => ({ title: clean(p?.title, 160), path: clean(p?.path, 160) })); } catch {}
  return { id: row.id, created_at: row.created_at, name: clean(row.name), city: clean(row.city), role: clean(row.role), notes: clean(row.notes, 800), first_referrer: clean(row.first_referrer, 300), first_utm_source: clean(row.first_utm_source, 100), first_utm_medium: clean(row.first_utm_medium, 100), first_utm_campaign: clean(row.first_utm_campaign, 160), landing_path: clean(row.landing_path, 160), visit_count: Number(row.visit_count) || 0, page_views: pageViews };
}
async function readLeads(env, ids) {
  if (!env.QUOTES_DB) throw new Error('database unavailable');
  if (!ids?.length) { const { results } = await env.QUOTES_DB.prepare(`SELECT id, created_at, name, city, role, notes, first_referrer, first_utm_source, first_utm_medium, first_utm_campaign, landing_path, visit_count, page_views_json FROM leads ORDER BY created_at DESC LIMIT ?`).bind(MAX_LEADS).all(); return results || []; }
  const safeIds = ids.slice(0, MAX_LEADS).map((id) => Number(id)).filter(Number.isInteger); if (!safeIds.length) return [];
  const placeholders = safeIds.map(() => '?').join(',');
  const { results } = await env.QUOTES_DB.prepare(`SELECT id, created_at, name, city, role, notes, first_referrer, first_utm_source, first_utm_medium, first_utm_campaign, landing_path, visit_count, page_views_json FROM leads WHERE id IN (${placeholders}) ORDER BY created_at DESC`).bind(...safeIds).all(); return results || [];
}
async function callGroq(env, system, user) {
  if (!env.GROQ_API_KEY) return null; const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
  try { const response = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${env.GROQ_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'openai/gpt-oss-120b', temperature: 0.2, max_tokens: MAX_OUTPUT_TOKENS, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }), signal: controller.signal }); if (!response.ok) return null; const data = await response.json(); return data?.choices?.[0]?.message?.content?.trim() || null; } catch { return null; } finally { clearTimeout(timer); }
}
async function callGemini(env, system, user) {
  if (!env.GEMINI_API_KEY) return null; const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
  try { const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`; const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS } }), signal: controller.signal }); if (!response.ok) return null; const data = await response.json(); return data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim() || null; } catch { return null; } finally { clearTimeout(timer); }
}
export async function onRequestPost(context) {
  const { request, env } = context; if (!sameOrigin(request)) return json({ error: 'Cross-origin requests are not allowed.' }, 403);
  const length = Number(request.headers.get('content-length') || 0); if (length > MAX_BODY_BYTES) return json({ error: 'Request is too large.' }, 413);
  let body; try { const raw = await request.arrayBuffer(); if (raw.byteLength > MAX_BODY_BYTES) return json({ error: 'Request is too large.' }, 413); body = JSON.parse(new TextDecoder().decode(raw)); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const requestedIds = Array.isArray(body?.leadIds) ? body.leadIds : []; const message = clean(body?.message, 700); let leads;
  try { leads = await readLeads(env, requestedIds); } catch { return json({ error: 'Lead data is temporarily unavailable.' }, 503); }
  if (!leads.length) return json({ error: 'No leads were available to analyze.' }, 404);
  const route = routeAsk({ message: message || 'Analyze the selected leads.', project: null, surface: 'internal' }); if (route.id !== 'lead-analyzer') return json({ error: 'This request is not a lead-analysis operation.', route: route.id }, 400);
  const system = `${specialistPrompt('lead-analyzer')}\n\n${BUSINESS_FACTS}\n\nOperational rules: deterministic lead data is authoritative. Do not invent measurements, pricing, credentials, legal status, insurance status, customer intent, or facts not present in the supplied records. Treat page-view behavior as context, not proof of intent. Separate KNOWN, INFERRED, and VERIFY. Recommend a next action only; do not mutate records.`;
  const user = `${message || 'Analyze these leads and identify what needs attention.'}\n\nLEAD RECORDS (read-only):\n${JSON.stringify(leads.map(leadSnapshot))}`;
  let answer = null; let provider = 'degraded'; if (env.GROQ_API_KEY) { answer = await callGroq(env, system, user); if (answer) provider = 'groq'; } if (!answer && env.GEMINI_API_KEY) { answer = await callGemini(env, system, user); if (answer) provider = 'gemini'; }
  if (!answer) return json({ answer: 'AI analysis is currently unavailable. Review the underlying lead records directly.', route: route.id, routeReason: route.reason, provider: 'degraded', degraded: true, readOnly: true, verify: true, leadCount: leads.length });
  return json({ answer, route: route.id, routeReason: route.reason, provider, degraded: false, readOnly: true, verify: true, leadCount: leads.length });
}
export async function onRequest(context) { if (context.request.method === 'OPTIONS') return new Response(null, { status: 204 }); if (context.request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405); return onRequestPost(context); }
