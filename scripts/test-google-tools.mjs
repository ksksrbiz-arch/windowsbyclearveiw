import assert from 'node:assert/strict';
import { createD1 } from './_lib/d1-sqlite.mjs';
import { onRequestPost, onRequestGet } from '../functions/internal/api/google-tools.js';
import { onRequest as middleware } from '../functions/internal/_middleware.js';
import { validateOperation, validateExpense, runGoogleOperation, connectionStatus } from '../functions/internal/_lib/google-operations.mjs';
import { googleToken } from '../functions/internal/_lib/google-auth.mjs';

const id='12345678-1234-1234-1234-123456789abc';
const origin='https://windowsbyclearview.com';
const db=createD1();
const env={QUOTES_DB:db,GOOGLE_MAPS_OPERATIONS_KEY:'private-test-key'};
const request=(body,site=origin)=>new Request(`${origin}/internal/api/google-tools`,{method:'POST',headers:{origin:site,'content-type':'application/json'},body:JSON.stringify(body)});
const post=(body,e=env,site=origin)=>onRequestPost({request:request(body,site),env:e});
const response=data=>new Response(JSON.stringify(data));
const expense={action:'save_expense',vendor:'Synthetic supplier',amount:'12.34',date:'2026-10-09',confirmed:true,requestId:id};
const appointment={title:'Synthetic appointment',start:'2026-10-10T10:00:00-07:00',end:'2026-10-10T11:00:00-07:00',confirmed:true,requestId:id};

let reached=false;
const gate=await middleware({request:request({action:'search'}),env:{INTERNAL_SESSION_SECRET:'test-only'},next:()=>{reached=true;return response({});}});
assert.equal(reached,false);assert.equal(gate.status,302);
assert.equal((await post(expense,env,'https://other.example')).status,403);
assert.equal((await post(null)).status,400);
assert.equal((await post(expense,{})).status,503);
assert.deepEqual(Object.values(connectionStatus({})),Array(10).fill(false));
assert.equal((await post({action:'search'})).status,503);
assert.equal(db.raw.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='google_tool_usage'").get().n,0,'unconfigured calls spend no quota');
for(const v of [null,true,' ',undefined,NaN,91])assert.throws(()=>validateOperation('weather',{latitude:v,longitude:0}));
assert.deepEqual(validateOperation('weather',{latitude:'0',longitude:0}),{latitude:0,longitude:0});
assert.throws(()=>validateOperation('route',{stops:['one']}));
assert.throws(()=>validateOperation('calendar_create',{...appointment,confirmed:false}));
assert.throws(()=>validateOperation('calendar_create',{...appointment,end:appointment.start}));
assert.throws(()=>validateOperation('calendar_create',{...appointment,requestId:'-'.repeat(36)}));
assert.throws(()=>validateExpense({...expense,date:'2026-02-30'}));
assert.throws(()=>validateExpense({...expense,amount:'1.001'}));
assert.throws(()=>validateExpense({...expense,confirmed:false}));
assert.equal(validateExpense(expense).cents,1234);
assert.equal((await post(expense)).status,200);
assert.equal((await post(expense)).status,200);
assert.equal((await post({...expense,amount:'20'})).status,409);
assert.equal(db.raw.prepare('SELECT count(*) AS n FROM google_expenses').get().n,1);
assert.equal(db.raw.prepare('SELECT amount_cents FROM google_expenses').get().amount_cents,1234);
assert.equal((await onRequestGet({env})).headers.get('cache-control'),'private, no-store');
const png=Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');
assert.equal(validateOperation('ocr',{mimeType:'image/png',content:png}).content,png);
assert.throws(()=>validateOperation('ocr',{mimeType:'image/jpeg',content:png}));
assert.throws(()=>validateOperation('ocr',{mimeType:'application/pdf',content:Buffer.from('%PDF-test').toString('base64')}));
assert.throws(()=>validateOperation('receipt',{mimeType:'image/png',content:Buffer.alloc(2*1024*1024+1).toString('base64')}));

const originalFetch=globalThis.fetch;
let calls=0;
globalThis.fetch=async (url,init)=>{calls++;assert.equal(new URL(url).searchParams.has('key'),false);assert.equal(init.headers['x-goog-api-key'],'private-test-key');assert.ok(init.signal);return response({result:{address:{formattedAddress:'Synthetic address'},verdict:{addressComplete:true,hasInferredComponents:true}}});};
try {
  for(let n=0;n<50;n++)assert.equal((await post({action:'address',address:'123 Test St',city:'Vancouver'})).status,200);
  assert.equal((await post({action:'address',address:'123 Test St',city:'Vancouver'})).status,429);
  assert.equal(calls,50);
} finally {globalThis.fetch=originalFetch;}
const address=await runGoogleOperation('address',{address:'123 Test St',city:'Vancouver'},env,async()=>response({result:{verdict:{addressComplete:true,hasInferredComponents:true}}}));
assert.equal(address.needsReview,true);assert.equal(address.latitude,null);
const route=await runGoogleOperation('route',{stops:['Start address','Middle address A','Middle address B','End address'],optimize:true},env,async()=>response({routes:[{distanceMeters:1609.344,duration:'600s',optimizedIntermediateWaypointIndex:[1,0]}]}));
assert.equal(route.miles,1);assert.equal(route.minutes,10);assert.equal(route.stops[1],'Middle address B');assert.equal(route.respectsAppointmentWindows,false);
await assert.rejects(()=>runGoogleOperation('route',{stops:['Start address','Middle address A','Middle address B','End address'],optimize:true},env,async()=>response({routes:[{optimizedIntermediateWaypointIndex:[0,0]}]})));

const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pem=`-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8',pair.privateKey)).toString('base64')}\n-----END PRIVATE KEY-----`;
const account={client_email:'synthetic@example.iam.gserviceaccount.com',private_key:pem};
await googleToken(account,'https://www.googleapis.com/auth/webmasters.readonly',async(url,init)=>{
  assert.equal(url,'https://oauth2.googleapis.com/token');
  const jwt=init.body.get('assertion'),parts=jwt.split('.'),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
  assert.equal(claims.scope,'https://www.googleapis.com/auth/webmasters.readonly');assert.equal(claims.exp-claims.iat,3600);
  assert.equal(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',pair.publicKey,Buffer.from(parts[2],'base64url'),new TextEncoder().encode(parts.slice(0,2).join('.'))),true);
  return response({access_token:'synthetic-token'});
});
const documents={GOOGLE_DOCUMENT_SERVICE_ACCOUNT_JSON:JSON.stringify(account),GOOGLE_DOCUMENT_PROCESSOR:'projects/test/locations/us/processors/receipt'};
const extracted=await runGoogleOperation('receipt',{mimeType:'image/png',content:png},documents,async(url,init)=>url.includes('oauth2')?response({access_token:'token'}):(assert.ok(url.includes('us-documentai.googleapis.com')),assert.deepEqual(JSON.parse(init.body).processOptions,{individualPageSelector:{pages:[1]}}),assert.deepEqual(JSON.parse(init.body).rawDocument,{mimeType:'image/png',content:png}),response({document:{entities:[{type:'total_amount',mentionText:'USD 12.34',confidence:.9},{type:'unknown',mentionText:'excluded'}]}})));
assert.equal(extracted.fields.length,1);assert.equal(extracted.requiresReview,true);
const owner={GOOGLE_OWNER_OAUTH_JSON:JSON.stringify({client_id:'test',client_secret:'secret',refresh_token:'refresh'}),GOOGLE_CALENDAR_ID:'test-calendar'};
let event;
const calendarFetch=async(url,init)=>{
  assert.equal(new URL(url).searchParams.has('key'),false);
  if(url.includes('oauth2'))return response({access_token:'token'});
  if(init.method==='POST'){event=JSON.parse(init.body);assert.equal(new URL(url).searchParams.get('sendUpdates'),'none');assert.equal(event.attendees,undefined);return response({});}
  return response(event);
};
assert.equal((await runGoogleOperation('calendar_create',appointment,owner,calendarFetch)).created,true);
const duplicateFetch=async(url,init)=>url.includes('oauth2')?response({access_token:'token'}):init.method==='POST'?new Response('',{status:409}):response(event);
assert.equal((await runGoogleOperation('calendar_create',appointment,owner,duplicateFetch)).alreadyExists,true);
await assert.rejects(()=>runGoogleOperation('calendar_create',{...appointment,title:'Changed appointment'},owner,duplicateFetch),TypeError);
assert.ok(!JSON.stringify(await (await onRequestGet({env:{...env,...owner,...documents}})).json()).includes('PRIVATE KEY'));
console.log('PASS: Google tools auth/origin, real SQL expense deduplication, quotas, document limits, verified scoped JWT, reviewed extraction, route ordering and calendar conflict checks.');
