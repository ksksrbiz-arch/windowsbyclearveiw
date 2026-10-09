// Authenticated by /internal/_middleware; private responses and same-origin writes.
import { connectionStatus, OPERATIONS, runGoogleOperation, validateOperation, validateExpense } from '../_lib/google-operations.mjs';
const json = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff'}});
const LIMITS = {receipt:10,ocr:10,calendar_create:10};
async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new TypeError('Provide a request.');
  const chunks=[];let size=0;
  while (true) {const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>3000000){await reader.cancel();throw new TypeError('Upload a document no larger than 2 MB.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new TypeError('Provide valid tool details.');}
}
async function claim(db,action) {
  await db.prepare('CREATE TABLE IF NOT EXISTS google_tool_usage (day TEXT NOT NULL, action TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day,action))').run();
  const row=await db.prepare('INSERT INTO google_tool_usage(day,action,count) VALUES(?,?,1) ON CONFLICT(day,action) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count').bind(new Date().toISOString().slice(0,10),action,LIMITS[action]||50).first();
  return !!row;
}
async function expenses(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS google_expenses (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, vendor TEXT NOT NULL, amount_cents INTEGER NOT NULL, spent_date TEXT NOT NULL, job_id TEXT, currency TEXT NOT NULL DEFAULT \'USD\', reviewed INTEGER NOT NULL DEFAULT 1)').run();
}
export async function onRequestGet({env}) {
  let rows=[];
  if(env.QUOTES_DB){await expenses(env.QUOTES_DB);rows=(await env.QUOTES_DB.prepare('SELECT * FROM google_expenses ORDER BY created_at DESC LIMIT 30').all()).results || [];}
  return json({configured:connectionStatus(env),expenses:rows});
}
export async function onRequestPost({env,request}) {
  const origin=request.headers.get('origin');
  if(origin!==new URL(request.url).origin) return json({error:'Open this tool from the Command Center.'},403);
  let body;
  try{body=await readBody(request);}catch(error){return json({error:error.message},400);}
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({error:'Provide valid tool details.'},400);
  if(!env.QUOTES_DB)return json({status:'unavailable',error:'The operations database is unavailable.'},503);
  try {
    if(body.action==='save_expense'){
      const v=validateExpense(body);
      if(v.jobId && !(await env.QUOTES_DB.prepare('SELECT id FROM jobs WHERE id=?').bind(v.jobId).first()))return json({error:'Choose an existing job reference or leave it blank.'},400);
      await expenses(env.QUOTES_DB);
      await env.QUOTES_DB.prepare('INSERT INTO google_expenses(id,created_at,vendor,amount_cents,spent_date,job_id) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(v.requestId,new Date().toISOString(),v.vendor,v.cents,v.date,v.jobId||null).run();
      const existing=await env.QUOTES_DB.prepare('SELECT * FROM google_expenses WHERE id=?').bind(v.requestId).first();
      if(existing && (existing.vendor!==v.vendor || existing.amount_cents!==v.cents || existing.spent_date!==v.date || (existing.job_id||'')!==v.jobId)) return json({error:'This request reference already belongs to a different expense. Edit the form before retrying.'},409);
      return json({status:'ok',saved:true});
    }
    if(!OPERATIONS.includes(body.action))return json({error:'Choose a supported tool.'},400);
    validateOperation(body.action,body);
    if(!connectionStatus(env)[body.action])return json({status:'unconfigured',error:'This Google connection needs account setup.'},503);
    if(!(await claim(env.QUOTES_DB,body.action)))return json({error:'The daily limit for this tool has been reached.'},429);
    return json(await runGoogleOperation(body.action,body,env));
  } catch(error){return error instanceof TypeError ? json({error:error.message},400) : json({status:'unavailable',error:'The Google service could not complete this request. Check its connection and quota; no result was saved.'},503);}
}
