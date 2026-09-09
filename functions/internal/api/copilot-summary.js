import { specialistPrompt } from '../../ask/_lib/icm-specialists.mjs';
import { BUSINESS_FACTS } from '../../ask/_lib/facts.mjs';

const MAX_BODY_BYTES = 32 * 1024;
const MAX_OUTPUT_TOKENS = 700;
const MAX_OUTPUT_CHARS = 7000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
}
function sameOrigin(request) { const origin=request.headers.get('origin'); if(!origin)return true; try{return new URL(origin).origin===new URL(request.url).origin}catch{return false} }
function cleanText(value) { return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, MAX_OUTPUT_CHARS); }
async function provider(env, system, user) {
  if (env.GROQ_API_KEY) {
    try { const r=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{authorization:`Bearer ${env.GROQ_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model:'openai/gpt-oss-120b',temperature:.2,max_tokens:MAX_OUTPUT_TOKENS,messages:[{role:'system',content:system},{role:'user',content:user}]}),signal:AbortSignal.timeout(15000)}); if(r.ok){const d=await r.json();const text=cleanText(d?.choices?.[0]?.message?.content);if(text)return {text,provider:'groq'}} } catch {}
  }
  if (env.GEMINI_API_KEY) {
    try { const url=`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:user}]}],generationConfig:{temperature:.2,maxOutputTokens:MAX_OUTPUT_TOKENS}}),signal:AbortSignal.timeout(15000)});if(r.ok){const d=await r.json();const text=cleanText(d?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join(' '));if(text)return {text,provider:'gemini'}} } catch {}
  }
  return null;
}
export async function onRequestPost({request,env}) {
  if(!sameOrigin(request))return json({error:'Cross-origin requests are not allowed.'},403);
  const raw=await request.arrayBuffer();if(raw.byteLength>MAX_BODY_BYTES)return json({error:'Request is too large.'},413);
  let body;try{body=JSON.parse(new TextDecoder().decode(raw))}catch{return json({error:'Invalid JSON.'},400)}
  const db=env.QUOTES_DB;if(!db)return json({error:'Dashboard data is temporarily unavailable.'},503);
  const snapshot=await db.prepare(`SELECT (SELECT COUNT(*) FROM leads WHERE created_at >= datetime('now','-7 day')) AS new_leads,(SELECT COUNT(*) FROM quotes WHERE status='draft') AS draft_quotes,(SELECT COUNT(*) FROM quotes WHERE status='finalized') AS finalized_quotes,(SELECT COUNT(*) FROM follow_up_tasks WHERE status='open') AS open_tasks,(SELECT COUNT(*) FROM follow_up_tasks WHERE status='open' AND due_at < datetime('now')) AS overdue_tasks,(SELECT COUNT(*) FROM jobs WHERE status NOT IN ('completed','cancelled')) AS active_jobs`).first();
  const [tasks,leads,jobs]=await Promise.all([db.prepare(`SELECT t.title,t.due_at,l.name AS lead_name,l.city AS lead_city FROM follow_up_tasks t LEFT JOIN leads l ON l.id=t.lead_id WHERE t.status='open' ORDER BY CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END,t.due_at LIMIT 8`).all(),db.prepare(`SELECT id,name,city,role,created_at FROM leads ORDER BY created_at DESC LIMIT 8`).all(),db.prepare(`SELECT id,status,scheduled_date,customer_name,customer_city FROM jobs WHERE status NOT IN ('completed','cancelled') ORDER BY CASE WHEN scheduled_date IS NULL THEN 1 ELSE 0 END,scheduled_date LIMIT 8`).all()]);
  const data={snapshot:snapshot||{},open_tasks:tasks.results||[],recent_leads:leads.results||[],active_jobs:jobs.results||[]};
  const system=`${specialistPrompt('operations-copilot')}\n\n${BUSINESS_FACTS}\n\nThe supplied dashboard snapshot is authoritative for this response. Summarize only what it supports. Identify the most important operational priorities, blockers, and next human actions. Do not invent causes, customer intent, revenue, staffing, or commitments. Do not mutate anything.`;
  const result=await provider(env,system,`Summarize today's operational state from this read-only snapshot:\n${JSON.stringify(data)}`);
  if(!result)return json({answer:'AI analysis is currently unavailable. Review the Command Center directly.',provider:'degraded',degraded:true,readOnly:true,verify:true});
  return json({answer:result.text,provider:result.provider,degraded:false,readOnly:true,verify:true});
}
export async function onRequest(context){if(context.request.method==='OPTIONS')return new Response(null,{status:204,headers:{'cache-control':'no-store'}});if(context.request.method!=='POST')return json({error:'Method not allowed.'},405);return onRequestPost(context)}
