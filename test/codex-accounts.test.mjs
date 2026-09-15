import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Readable,Writable} from 'node:stream';
import {createHash} from 'node:crypto';
import {CodexAccounts,installedAccountSwitchCapabilities} from '../lib/codex-accounts.mjs';
import {inspectAccountConsumers} from '../lib/codex-account-consumers.mjs';
import {AssistantRuntime,assistantHttp} from '../lib/assistant-runtime.mjs';
import {runAssistantMCP} from '../lib/assistant-mcp.mjs';

const a='a'.repeat(64),b='b'.repeat(64),thread='11111111-1111-4111-8111-111111111111';
async function fixture(t,{supported=true}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-accounts-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let reading={accountKey:a,remainingPercent:0,resetsAt:2000000000,subscription:{method:'chatgpt',email:'a@example.test',plan:'pro'}};
  const usage={snapshot:async()=>({...reading,status:'current'}),freshReading:async()=>structuredClone(reading)};
  const consumers=[{id:'terminal-A',kind:'terminal_codex',pid:99999,processIdentity:'owner-A',tabId:'exact-tab',windowId:'exact-window',
    tty:'ttys099',sessionId:thread,directory:'/fixture/α project',busy:false,recoverable:true,
    draft:{state:'expanded',hash:'draft-hash',provenance:'verified-native',recoverable:true},pendingReceipts:[]}];
  const draftText='Kept draft 🌿\nSecond line';
  consumers[0].accountVerified=true;consumers[0].accountKey=a;
  consumers[0].draft.hash=createHash('sha256').update(draftText).digest('hex');
  const calls=[];const remote={authenticated:false,transitioned:new Set()};
  const adapter=supported?{
    capabilities:{...installedAccountSwitchCapabilities,ready:true,reasons:[]},
    captureRecovery:async observed=>({fingerprint:observed.fingerprint,entries:observed.consumers.map(c=>({...c,draft:{...c.draft,text:draftText},images:[{path:'/fixture/retained.png',size:128,sha256:'c'.repeat(64)}]}))}),
    authenticate:async()=>{calls.push('authenticate');remote.authenticated=true;return {state:'verified',method:'chatgpt',email:'b@example.test',accountKey:b,workspaceVerified:true};},
    reconcileAuthentication:async()=>{calls.push('reconcile-authenticate');return remote.authenticated?{state:'verified',method:'chatgpt',email:'b@example.test',accountKey:b,workspaceVerified:true}:{state:'uncertain'};},
    transition:async({consumer})=>{calls.push('transition:'+consumer.id);remote.transitioned.add(consumer.id);return {state:'verified',sessionId:consumer.sessionId,accountKey:b,ownerVerified:true,draftVerified:true};},
    reconcileTransition:async({consumer})=>{calls.push('reconcile:'+consumer.id);return remote.transitioned.has(consumer.id)?{state:'verified',sessionId:consumer.sessionId,accountKey:b,ownerVerified:true,draftVerified:true}:{state:'uncertain'};},
    verify:async()=>({accountKey:b,allConsumersVerified:true,freshUsage:true}),
  }:null;
  const options={root,usage,adapter,inspectConsumers:async()=>({complete:true,consumers})};
  const controller=new CodexAccounts(options);
  const entry=(await controller.add({email:'b@example.test',workspaceLabel:'Personal',requestId:'add',expectedRevision:0})).account;
  return {root,options,controller,entry,usage,adapter,consumers,calls,remote,setReading:r=>reading=r,
    request:async(id='switch')=>controller.request({accountId:entry.id,requestId:id,expectedRevision:(await controller.snapshot()).revision,confirmed:true})};
}

test('shipped capability gate saves a recoverable choice without authenticating, fencing or touching work',async t=>{
  const f=await fixture(t,{supported:false});const op=await f.request();
  assert.equal(op.status,'needs_setup');assert.equal(op.fenced,false);assert.equal((await f.controller.admission()).allowed,true);
  await f.controller.advance();assert.deepEqual(f.calls,[]);
  assert.equal((await f.controller.snapshot()).accounts[0].authentication,'needs_sign_in');
  assert.equal((await fs.stat(f.controller.file)).mode&0o777,0o600);
});
test('single selection at zero allowance runs deterministic transition, preserves exact draft and does not call a model',async t=>{
  const f=await fixture(t);await f.request();assert.equal((await f.controller.admission()).allowed,false);
  await f.controller.advance();const state=await f.controller.snapshot();
  assert.equal(state.activeOperation.status,'completed');assert.equal(state.epoch,1);
  assert.equal(state.activeOperation.recovery.entries[0].draft.text,'Kept draft 🌿\nSecond line');
  assert.equal(state.activeOperation.consumers[0].sessionId,thread);
  assert.deepEqual(f.calls,['authenticate','transition:terminal-A']);assert.equal((await f.controller.admission()).allowed,true);
});
test('service driver completes an accepted selection without UI polling and resumes one durable operation after restart',async t=>{
  const f=await fixture(t);f.consumers[0].busy=true;
  await f.request();
  const waitFor=async predicate=>{
    const deadline=Date.now()+5000;
    while(Date.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,15));}
    assert.fail('Account driver did not reach the expected state');
  };
  try{
    assert.equal(f.controller.start({intervalMs:10}),true);
    assert.equal(f.controller.start({intervalMs:10}),false);
    await waitFor(async()=>JSON.parse(await fs.readFile(f.controller.file,'utf8')).operations.switch.status==='waiting');
  }finally{await f.controller.stop();}
  assert.deepEqual(f.calls,[]);f.consumers[0].busy=false;
  const restarted=new CodexAccounts(f.options);
  try{
    restarted.start({intervalMs:10});
    // Read the receipt file to verify that no accounts.reconcile/UI request is
    // responsible for advancing authentication or transition work.
    await waitFor(async()=>JSON.parse(await fs.readFile(f.controller.file,'utf8')).operations.switch.status==='completed');
  }finally{await restarted.stop();}
  assert.deepEqual(f.calls,['authenticate','transition:terminal-A']);
  assert.equal((await restarted.snapshot()).epoch,1);
});
test('unverified production capability starts no runner and creates no switch operation',async t=>{
  const f=await fixture(t,{supported:false});
  assert.equal(f.controller.start(),false);assert.equal(f.controller.runnerTask,undefined);
  await f.controller.stop();assert.deepEqual(f.calls,[]);
  assert.equal((await f.controller.snapshot()).activeOperation,null);
});
test('concurrent controllers and duplicate clicks coalesce one durable operation and one set of side effects',async t=>{
  const f=await fixture(t),other=new CodexAccounts(f.options),revision=(await f.controller.snapshot()).revision;
  const args={accountId:f.entry.id,expectedRevision:revision,confirmed:true};
  const [first,second]=await Promise.all([f.controller.request({...args,requestId:'one'}),other.request({...args,requestId:'two'})]);
  assert.equal(first.id,second.id);await Promise.all([f.controller.advance(),other.advance()]);
  assert.deepEqual(f.calls,['authenticate','transition:terminal-A']);
  assert.equal((await other.request({...args,requestId:'two'})).status,'completed');
  await assert.rejects(other.request({...args,accountId:'wrong',requestId:'one'}),/already used/);
});
test('busy and unrecoverable inputs wait; cancel does not authenticate or stop the agent',async t=>{
  for(const field of ['busy','recoverable']){
    const f=await fixture(t);f.consumers[0][field]=field==='busy';await f.request();await f.controller.advance();
    assert.equal((await f.controller.snapshot()).activeOperation.status,'waiting');assert.deepEqual(f.calls,[]);
    await f.controller.cancel({operationId:'switch',requestId:'cancel'});
    assert.equal((await f.controller.admission()).allowed,true);await f.controller.advance();assert.deepEqual(f.calls,[]);
  }
});
test('crash after authentication dispatch reconciles the original receipt without logging in twice',async t=>{
  const f=await fixture(t),original=f.adapter.authenticate;
  f.adapter.authenticate=async args=>{await original(args);throw Error('Connection ended after authentication');};
  await f.request();await f.controller.advance();assert.equal((await f.controller.snapshot()).activeOperation.status,'needs_attention');
  const restarted=new CodexAccounts(f.options);await restarted.advance();
  assert.equal((await restarted.snapshot()).activeOperation.status,'completed');
  assert.deepEqual(f.calls,['authenticate','reconcile-authenticate','transition:terminal-A']);
});
test('partial process transition reconciles only uncertain owner and retains completed progress',async t=>{
  const f=await fixture(t);f.consumers.push({...structuredClone(f.consumers[0]),id:'terminal-B',sessionId:'22222222-2222-4222-8222-222222222222'});
  const transition=f.adapter.transition;let failed=false;
  f.adapter.transition=async args=>{const receipt=await transition(args);if(args.consumer.id==='terminal-B'&&!failed){failed=true;throw Error('Uncertain acknowledgement');}return receipt;};
  await f.request();await f.controller.advance();await new CodexAccounts(f.options).advance();
  assert.deepEqual(f.calls,['authenticate','transition:terminal-A','transition:terminal-B','reconcile:terminal-B']);
  assert.equal((await f.controller.snapshot()).activeOperation.status,'completed');
});
test('wrong browser account, API method and unverifiable destination keep the transition fenced',async t=>{
  for(const changed of [{email:'wrong@example.test'},{method:'apiKey'},{workspaceVerified:false}]){
    const f=await fixture(t);f.adapter.authenticate=async()=>({state:'verified',method:'chatgpt',email:'b@example.test',accountKey:b,workspaceVerified:true,...changed});
    await f.request();await f.controller.advance();assert.equal((await f.controller.snapshot()).activeOperation.status,'needs_attention');
    assert.equal((await f.controller.admission()).allowed,false);assert.deepEqual(f.calls,[]);
  }
});
test('cancellation after uncertain authentication never claims credentials stayed unchanged',async t=>{
  const f=await fixture(t);f.adapter.authenticate=async()=>{throw Error('Callback lost');};
  await f.request();await f.controller.advance();const cancelled=await f.controller.cancel({operationId:'switch',requestId:'cancel'});
  assert.equal(cancelled.status,'needs_attention');assert.equal(cancelled.reasonCode,'cancel_requires_reconciliation');
  assert.equal((await f.controller.admission()).allowed,false);await f.controller.advance();assert.deepEqual(f.calls,[]);
});
test('cancel recovery releases held work only after read-only verification of every original owner and receipt',async t=>{
  const f=await fixture(t);f.adapter.authenticate=async()=>{throw Error('Callback lost');};
  await f.request();await f.controller.advance();await f.controller.cancel({operationId:'switch',requestId:'cancel'});
  for(const value of [{accountKey:b,allConsumersVerified:true,pendingEffectsResolved:true,performedMutations:false},
    {accountKey:a,allConsumersVerified:true,pendingEffectsResolved:false,performedMutations:false},
    {accountKey:a,allConsumersVerified:true,pendingEffectsResolved:true,performedMutations:true}]){
    f.adapter.reconcileCancellation=async()=>value;await f.controller.advance();
    assert.equal((await f.controller.admission()).allowed,false);
  }
  f.adapter.reconcileCancellation=async()=>({accountKey:a,allConsumersVerified:true,pendingEffectsResolved:true,performedMutations:false});
  await new CodexAccounts(f.options).advance();
  assert.equal((await f.controller.snapshot()).activeOperation.status,'cancelled');
  assert.equal((await f.controller.admission()).allowed,true);assert.equal((await f.controller.snapshot()).epoch,0);
  assert.deepEqual(f.calls,[]);
});
test('manual edits between capture and authentication trigger a new inspection',async t=>{
  const f=await fixture(t),original=f.adapter.captureRecovery;
  f.adapter.captureRecovery=async o=>{const r=await original(o);f.consumers[0].draft.hash='user-edited';return r;};
  await f.request();await f.controller.advance();assert.equal((await f.controller.snapshot()).activeOperation.status,'waiting');assert.deepEqual(f.calls,[]);
});
test('authentication secrets and callback URLs are discarded from receipts',async t=>{
  const f=await fixture(t),original=f.adapter.authenticate;
  f.adapter.authenticate=async args=>({...await original(args),accessToken:'PRIVATE_SENTINEL',authUrl:'https://example.test/?secret=PRIVATE_SENTINEL',userCode:'PRIVATE_SENTINEL'});
  await f.request();await f.controller.advance();assert.ok(!(await fs.readFile(f.controller.file,'utf8')).includes('PRIVATE_SENTINEL'));
});

test('recovery projections and authentication errors never persist adapter secrets',async t=>{
  const f=await fixture(t),capture=f.adapter.captureRecovery;
  f.adapter.captureRecovery=async o=>({...await capture(o),accessToken:'PRIVATE_SENTINEL',callbackURL:'PRIVATE_SENTINEL'});
  f.adapter.authenticate=async()=>{throw Error('OAuth callback https://example.test/?secret=PRIVATE_SENTINEL');};
  await f.request();await f.controller.advance();
  const file=await fs.readFile(f.controller.file,'utf8');assert.ok(!file.includes('PRIVATE_SENTINEL'));
  assert.equal((await f.controller.admission()).allowed,false);
});

test('corrupt or missing active operation fails closed, while a rejected entry can be corrected without ambiguous delivery',async t=>{
  const f=await fixture(t,{supported:false});
  const rejected=await f.controller.control('accounts.add',{requestId:'bad',email:'bad',expectedRevision:1});
  assert.equal(rejected.accountReceipt.accepted,false);assert.equal(rejected.accounts.accounts.length,1);
  const stale=await f.controller.control('accounts.switch',{requestId:'stale',accountId:f.entry.id,confirmed:true,expectedRevision:0});
  assert.equal(stale.accountReceipt.accepted,false);assert.equal(stale.accounts.activeOperation,null);
  await fs.writeFile(f.controller.file,JSON.stringify({version:1,revision:1,epoch:0,accounts:[],requests:{},operations:{},activeOperationId:'missing'}));
  assert.equal((await f.controller.admission()).allowed,false);
  await assert.rejects(f.controller.snapshot(),/recovery/);
});

test('accepted Assistant text and image remain durable while fenced and never silently adopt a new account epoch',async t=>{
  const f=await fixture(t);await f.request();
  const runtime=new AssistantRuntime({root:path.join(f.root,'Assistant'),coordinator:{stop(){},prepare(){throw Error('No model may run');}}});
  runtime.accounts=f.controller;t.after(()=>runtime.close());await runtime.load();runtime.state.enabled=true;
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  const image={id:'aaaaaaaa-1111-4111-8111-111111111111',fileName:'fixture.png',mimeType:'image/png',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  for(const action of ['uploadBegin','uploadChunk','uploadFinish'])await runtime.images.request({action,owner:'fixture-phone',upload:image,...(action==='uploadChunk'?{offset:0,bytes:bytes.toString('base64')}:{})});
  const request={action:'message',requestId:'held-message',text:'Keep this exact draft 🌿\nSecond line',images:[image],imageOwner:'fixture-phone'};
  const first=await runtime.command(request);const retry=await runtime.command(request);
  assert.equal(first.job.status,'queued');assert.equal(retry.job.id,first.job.id);assert.equal(first.job.accountEpoch,0);
  await runtime.nativePoll({workerId:'fixture',catalog:{tabs:[]}});
  assert.equal((await runtime.job(request.requestId)).status,'queued');
  await f.controller.advance();
  await runtime.drain();
  const retained=await runtime.job(request.requestId);
  assert.equal(retained.status,'attention');assert.equal(retained.reasonCode,'account_request_reconciliation_required');
  assert.equal(retained.args.text,request.text);assert.deepEqual(retained.args.images,[image]);
  const resolved=await runtime.images.resolve({owner:'fixture-phone',uploadIds:[image.id]});assert.deepEqual(await fs.readFile(resolved.images[0].path),bytes);
  assert.equal(runtime.state.messages.filter(m=>m.id===request.requestId).length,1);
});
test('read-only inventory preserves same-directory separate sessions and reports unknown account ownership',async()=>{
  const runtime={state:{jobs:[]},observation:{catalog:{tabs:[{id:'one',tty:'/dev/ttys101',directory:'/same',title:'One'},{id:'two',tty:'/dev/ttys102',directory:'/same',title:'Two'}]}}};
  const value=await inspectAccountConsumers(runtime,{readOwners:async()=>[{pid:1,tty:'ttys101',threads:['A']},{pid:2,tty:'ttys102',threads:['B']}]});
  assert.deepEqual(value.consumers.map(c=>c.sessionId),['A','B']);assert.equal(value.complete,false);assert.ok(value.consumers.every(c=>!c.accountVerified&&!c.recoverable));
});
test('actual Assistant HTTP and MCP account status paths require no enabled conversation or model',async t=>{
  const f=await fixture(t,{supported:false}),runtime=new AssistantRuntime({root:path.join(f.root,'Assistant'),coordinator:{stop(){},prepare(){throw Error('MODEL MUST NOT START');}}});runtime.accounts=f.controller;
  t.after(()=>runtime.close());await runtime.load();
  await fs.writeFile(path.join(runtime.root,'connection.json'),JSON.stringify({baseURL:'http://127.0.0.1:4487'}));
  await fs.writeFile(path.join(f.root,'native-server.token'),'fixture');const output=[];
  await runAssistantMCP({root:f.root,input:Readable.from([JSON.stringify({id:1,method:'tools/call',params:{name:'codex_accounts',arguments:{}}})+'\n']),
    output:new Writable({write(chunk,enc,done){output.push(JSON.parse(chunk));done();}}),fetchImpl:async(url,options)=>{
      let code,result;await assistantHttp({method:'POST'},null,new URL(url),runtime,{readBody:async()=>JSON.parse(options.body),json:(res,c,data)=>{code=c;result=data;}});
      return {ok:code===200,json:async()=>result};
    }});
  assert.equal(output[0].result.isError,undefined);assert.equal(runtime.state.enabled,false);assert.equal(runtime.state.jobs.length,0);
});
