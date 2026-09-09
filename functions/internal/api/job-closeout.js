function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'}});}
async function ensureSchema(db){await db.prepare(`CREATE TABLE IF NOT EXISTS job_closeouts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 job_id TEXT NOT NULL UNIQUE,
 walkthrough_confirmed INTEGER NOT NULL DEFAULT 0,
 warranty_handoff_confirmed INTEGER NOT NULL DEFAULT 0,
 balance_confirmed INTEGER NOT NULL DEFAULT 0,
 signoff_name TEXT NOT NULL DEFAULT '',
 signoff_notes TEXT NOT NULL DEFAULT '',
 finalized_at TEXT,
 updated_at TEXT NOT NULL,
 updated_by TEXT NOT NULL DEFAULT 'mark'
)`).run();}
async function load(db,jobId){return db.prepare(`SELECT * FROM job_closeouts WHERE job_id = ?`).bind(jobId).first();}
async function readiness(db,jobId){
 const job=await db.prepare(`SELECT id,status,build_plan_json FROM jobs WHERE id=?`).bind(jobId).first();
 if(!job)return {error:'Job not found.',status:404};
 let openingCount=0;try{const plan=JSON.parse(job.build_plan_json||'{}');openingCount=Array.isArray(plan?.openings)?plan.openings.length:0;}catch{}
 const checklist=await db.prepare(`SELECT section,label,checked FROM job_checklist_items WHERE job_id=?`).bind(jobId).all();
 const items=checklist.results||[];const openings=Array.from({length:openingCount},(_,i)=>{const section=`Opening ${String(i+1).padStart(2,'0')}`;return {index:i,complete:items.some(x=>x.section===section&&x.label==='Complete'&&Number(x.checked)===1)};});
 const evidence=await db.prepare(`SELECT opening_index,exception_status,exception_notes,photo_summary_json FROM job_opening_evidence WHERE job_id=? ORDER BY opening_index`).bind(jobId).all();
 const exceptions=(evidence.results||[]).filter(x=>String(x.exception_status)==='open').map(x=>({openingIndex:Number(x.opening_index),notes:x.exception_notes||''}));
 const closeoutItems=items.filter(x=>x.section==='Closeout');
 return {job,openingCount,openings,evidence:evidence.results||[],exceptions,closeoutItems,readyForFinalize:openingCount>0&&openings.every(x=>x.complete)&&exceptions.length===0&&closeoutItems.length>0&&closeoutItems.every(x=>Number(x.checked)===1)};
}
export async function onRequestGet(context){const db=context.env.QUOTES_DB;await ensureSchema(db);const jobId=new URL(context.request.url).searchParams.get('jobId');if(!jobId)return json({error:'jobId is required.'},400);const r=await readiness(db,jobId);if(r.error)return json({error:r.error},r.status);return json({...r,closeout:await load(db,jobId)});}
export async function onRequestPatch(context){const db=context.env.QUOTES_DB;await ensureSchema(db);const jobId=new URL(context.request.url).searchParams.get('jobId');if(!jobId)return json({error:'jobId is required.'},400);const r=await readiness(db,jobId);if(r.error)return json({error:r.error},r.status);if(String(r.job.status).toLowerCase()==='cancelled')return json({error:'Cancelled jobs cannot be closed out.',code:'JOB_CANCELLED'},409);let body;try{body=await context.request.json();}catch{return json({error:'Invalid JSON.'},400);}
 const existing=await load(db,jobId);const walkthrough=body.walkthroughConfirmed===undefined?Number(existing?.walkthrough_confirmed||0):body.walkthroughConfirmed?1:0;const warranty=body.warrantyHandoffConfirmed===undefined?Number(existing?.warranty_handoff_confirmed||0):body.warrantyHandoffConfirmed?1:0;const balance=body.balanceConfirmed===undefined?Number(existing?.balance_confirmed||0):body.balanceConfirmed?1:0;const name=body.signoffName===undefined?String(existing?.signoff_name||''):String(body.signoffName||'').slice(0,160);const notes=body.signoffNotes===undefined?String(existing?.signoff_notes||''):String(body.signoffNotes||'').slice(0,5000);const finalize=body.finalize===true;
 if(finalize){if(!r.readyForFinalize)return json({error:'The project is not ready to finalize. Complete every opening, resolve open exceptions, and complete every project closeout checklist item.',code:'CLOSEOUT_NOT_READY',openings:r.openings,exceptions:r.exceptions,closeoutItems:r.closeoutItems},409);if(!walkthrough||!warranty||!balance||!name.trim())return json({error:'Confirm customer walkthrough, warranty/care handoff, final balance status, and enter the signoff name before finalizing.',code:'CLOSEOUT_SIGNOFF_REQUIRED'},400);}
 const now=new Date().toISOString();const finalizedAt=finalize?(existing?.finalized_at||now):existing?.finalized_at||null;await db.prepare(`INSERT INTO job_closeouts (job_id,walkthrough_confirmed,warranty_handoff_confirmed,balance_confirmed,signoff_name,signoff_notes,finalized_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?, 'mark') ON CONFLICT(job_id) DO UPDATE SET walkthrough_confirmed=excluded.walkthrough_confirmed,warranty_handoff_confirmed=excluded.warranty_handoff_confirmed,balance_confirmed=excluded.balance_confirmed,signoff_name=excluded.signoff_name,signoff_notes=excluded.signoff_notes,finalized_at=excluded.finalized_at,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).bind(jobId,walkthrough,warranty,balance,name,notes,finalizedAt,now).run();return json({ok:true,closeout:await load(db,jobId),readyForFinalize:r.readyForFinalize});}
