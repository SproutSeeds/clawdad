import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import {PushNotificationService,normalizeCompletion,completionPayload} from '../cloud/push-notifications.mjs';
import {WorkspaceRelay} from '../cloud/worker.mjs';

const at=Date.parse('2026-09-07T12:00:00Z');
const completion={id:'a'.repeat(64),sessionId:'11111111-1111-4111-8111-111111111111',directory:'BioSentinel',completedAt:new Date(at+1000).toISOString()};
const identity={hostName:'Studio Mac',hostId:'mac',workspaceId:'work',accountId:'account'};
const credentials=()=>({CLAWDAD_APNS_KEY_ID:'ABCDE12345',CLAWDAD_APNS_TEAM_ID:'4QV4WR9G32',CLAWDAD_APNS_PRIVATE_KEY:crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'pem',type:'pkcs8'})});
function storage() {
  const values=new Map(); const alarms=[];
  return {values,alarms,storage:{get:async key=>structuredClone(values.get(key)),put:async(key,value)=>values.set(key,structuredClone(value)),delete:async key=>values.delete(key),
    list:async({prefix})=>new Map([...values].filter(([key])=>key.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)])),setAlarm:async at=>alarms.push(at)},getWebSockets:()=>[]};
}
async function fixture({respond=()=>new Response(null,{status:200}),env=credentials()}={}) {
  const state=storage(); let now=at; const sent=[];
  const dependencies={clock:()=>now,fetchImpl:async(url,options)=>{sent.push({url,options});return respond(url,options);}};
  const service=new PushNotificationService(state,env,dependencies);
  await state.storage.put('access:device:phone',{tokenHash:'trusted',revokedAt:''});
  await service.register('phone',{enabled:true,token:'b'.repeat(64),environment:'production',timeZone:'America/Chicago',locale:'en-US'});
  return {state,service,sent,restart:()=>new PushNotificationService(state,env,dependencies),advance:ms=>{now+=ms;}};
}
test('push payload names the exact conversation, local completion time, and contains no transcript or path',()=>{
  const event=normalizeCompletion({...completion,projectPath:'/private/code/BioSentinel',response:'private text'},at+2000);
  const payload=completionPayload(event,{timeZone:'America/Chicago',locale:'en-US'},identity);
  assert.match(payload.aps.alert.title,/BioSentinel/);
  assert.match(payload.aps.alert.body,/7:00/);
  assert.equal(payload.clawdad.sessionId,completion.sessionId);
  assert.equal(payload.clawdad.eventId,completion.id);
  assert.equal(JSON.stringify(payload).includes('/private/'),false);
  assert.equal(JSON.stringify(payload).includes('private text'),false);
  assert.throws(()=>normalizeCompletion({...completion,directory:'/private/code'},at+2000));
  assert.throws(()=>normalizeCompletion({...completion,completedAt:new Date(at-25*60*60*1000).toISOString()},at));
});
test('completion is durably queued once and APNs receives the correct environment, topic and signature',async()=>{
  const f=await fixture(); f.advance(2000);
  assert.equal((await f.service.submit(completion,identity)).accepted,true);
  assert.equal(f.sent.length,0);
  assert.equal((await f.service.submit(completion,identity)).duplicate,true);
  await f.service.alarm();
  assert.equal(f.sent.length,1);
  const request=f.sent[0]; assert.match(request.url,/^https:\/\/api\.push\.apple\.com\//);
  assert.equal(request.options.headers['apns-topic'],'earth.frg.clawdad.ios');
  assert.equal(request.options.headers['apns-push-type'],'alert');
  assert.equal(request.options.headers['apns-collapse-id'],completion.id);
  const token=request.options.headers.authorization.slice(7);
  const [head,body,signature]=token.split('.');
  assert.equal(JSON.parse(Buffer.from(body,'base64url')).iss,'4QV4WR9G32');
  assert.equal(crypto.verify('sha256',Buffer.from(`${head}.${body}`),{key:crypto.createPublicKey(f.service.env.CLAWDAD_APNS_PRIVATE_KEY),dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')),true);
  await f.service.alarm(); assert.equal(f.sent.length,1);
});
test('transient APNs errors retry after restart and never resend to devices already acknowledged',async()=>{
  let fail=true; const f=await fixture({respond:()=>fail?Response.json({reason:'ServiceUnavailable'},{status:503}):new Response(null,{status:200})});
  f.advance(2000); await f.service.submit(completion,identity); await f.service.alarm();
  assert.equal(f.state.values.get('push:events')[0].targets.length,1);
  fail=false; f.advance(20_000); f.service=f.restart(); await f.service.alarm(); await f.service.alarm();
  assert.equal(f.sent.length,2); assert.equal(f.state.values.get('push:events')[0].targets.length,0);
});
test('unregistered tokens are removed and device revocation/opt-out cancels pending alerts',async()=>{
  const f=await fixture({respond:()=>Response.json({reason:'Unregistered'},{status:410})});
  f.advance(2000); await f.service.submit(completion,identity); await f.service.alarm();
  assert.equal(f.state.values.has('push:device:phone'),false);
  const g=await fixture(); g.advance(2000); await g.service.submit(completion,identity);
  await g.state.storage.put('access:device:phone',{tokenHash:'',revokedAt:new Date().toISOString()});
  await g.service.alarm(); assert.equal(g.sent.length,0);
  const h=await fixture(); h.advance(2000); await h.service.submit(completion,identity);
  await h.service.register('phone',{enabled:false}); await h.service.alarm(); assert.equal(h.sent.length,0);
});
test('new opt-in does not replay history, token rotation preserves the opt-in time, and missing keys stay pending locally',async()=>{
  const f=await fixture({env:{}}); f.advance(2000);
  assert.equal((await f.service.submit(completion,identity)).unavailable,true);
  assert.equal(f.state.values.has('push:events'),false);
  const g=await fixture(); g.advance(3000);
  await g.service.register('phone',{enabled:true,token:'c'.repeat(64),environment:'production'});
  assert.equal(g.state.values.get('push:device:phone').enabledSince,at);
  await g.service.submit(completion,identity); await g.service.alarm(); assert.match(g.sent[0].url,/c{64}$/);
  await g.service.register('phone',{enabled:false});
  await g.service.register('phone',{enabled:true,token:'c'.repeat(64),environment:'production'});
  assert.equal((await g.service.submit({...completion,id:'d'.repeat(64)},identity)).recipients,0);
});
test('development registration requires its own APNs environment credentials',async()=>{
  const f=await fixture();
  const result=await f.service.register('phone',{enabled:true,token:'c'.repeat(64),environment:'development'});
  assert.equal(result.configured,false);
  f.advance(2000); assert.equal((await f.service.submit(completion,identity)).unavailable,true);
  assert.equal(f.sent.length,0);
});
test('relay requires the paired device token to register and host credential to publish',async()=>{
  const state=storage(); const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
  await state.storage.put('access:host',{...identity,tokenHash:hash('h'.repeat(40))});
  await state.storage.put('access:device:phone',{tokenHash:hash('p'.repeat(40))});
  const relay=new WorkspaceRelay(state,{});
  const request=(route,method,credential,body)=>new Request(`https://relay/workspaces/work${route}?accountId=account&deviceId=phone`,{
    method,headers:{authorization:`Bearer ${credential}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await relay.fetch(request('/notifications/device','PUT','h'.repeat(40),{enabled:false}))).status,401);
  assert.equal((await relay.fetch(request('/notifications/device','PUT','other-device',{enabled:false}))).status,401);
  assert.equal((await relay.fetch(request('/notifications/device','PUT','p'.repeat(40),{enabled:false}))).status,200);
  assert.equal((await relay.fetch(request('/notifications/events','POST','p'.repeat(40),completion))).status,401);
  await state.storage.put('access:device:phone',{tokenHash:hash('p'.repeat(40)),revokedAt:new Date().toISOString()});
  assert.equal((await relay.fetch(request('/notifications/device','PUT','p'.repeat(40),{enabled:false}))).status,401);
});

test('delivered event metadata expires without another completion or app launch',async()=>{
  const f=await fixture(); f.advance(2000);
  await f.service.submit(completion,identity); await f.service.alarm();
  assert.equal(f.state.alarms.at(-1),Date.parse(completion.completedAt)+24*60*60*1000+1);
  f.advance(24*60*60*1000); f.service=f.restart(); await f.service.alarm();
  assert.equal(f.state.values.has('push:events'),false);
  assert.equal(f.sent.length,1);
});
