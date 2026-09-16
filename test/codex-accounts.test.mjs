import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Readable,Writable} from 'node:stream';
import {createHash} from 'node:crypto';
import {CodexAccounts,installedAccountSwitchCapabilities} from '../lib/codex-accounts.mjs';
import {inspectAccountConsumers,readAccountWork} from '../lib/codex-account-consumers.mjs';
import {AssistantRuntime,assistantHttp} from '../lib/assistant-runtime.mjs';
import {runAssistantMCP} from '../lib/assistant-mcp.mjs';
import {CodexAccountLayout} from '../lib/codex-account-layout.mjs';

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
test('an unsigned additional account is rejected before holding current work',async t=>{
  const f=await fixture(t);f.controller.authorizations={snapshot:async()=>({profiles:[{accountId:f.entry.id,authentication:'needs_sign_in'}]})};
  const response=await f.controller.control('accounts.switch',{accountId:f.entry.id,requestId:'unsigned',expectedRevision:1,confirmed:true});
  assert.equal(response.accountReceipt.accepted,false);assert.match(response.accountReceipt.error,/Connect this account/);
  assert.equal((await f.controller.admission()).allowed,true);assert.equal(response.accounts.activeOperation,null);assert.deepEqual(f.calls,[]);
});
test('single selection at zero allowance runs deterministic transition, preserves exact draft and does not call a model',async t=>{
  const f=await fixture(t);await f.request();assert.equal((await f.controller.admission()).allowed,false);
  await f.controller.advance();const state=await f.controller.snapshot();
  assert.equal(state.activeOperation.status,'completed');assert.equal(state.epoch,1);
  assert.equal(state.activeOperation.recovery.entries[0].draft.text,'Kept draft 🌿\nSecond line');
  assert.equal(state.activeOperation.consumers[0].sessionId,thread);
  assert.deepEqual(f.calls,['authenticate','transition:terminal-A']);assert.equal((await f.controller.admission()).allowed,true);
});
test('a delayed shared ownership release remains waiting and reconciles the original transition after restart',async t=>{
  const f=await fixture(t);let released=false,dispatched=0,reconciled=0;
  f.adapter.transition=async()=>{dispatched++;return {state:'waiting',reasonCode:'shared_threads_releasing'};};
  f.adapter.reconcileTransition=async({consumer})=>{reconciled++;return released?{state:'verified',sessionId:consumer.sessionId,accountKey:b,ownerVerified:true,draftVerified:true}:
    {state:'waiting',reasonCode:'shared_threads_releasing'};};
  await f.request();await f.controller.advance();
  assert.equal((await f.controller.snapshot()).activeOperation.status,'waiting');assert.equal((await f.controller.admission()).allowed,false);
  const restored=new CodexAccounts(f.options);await restored.advance();assert.equal(dispatched,1);assert.equal(reconciled,1);
  released=true;await restored.advance();assert.equal((await restored.snapshot()).activeOperation.status,'completed');assert.equal(dispatched,1);
});
test('a verified selected launch is published only with complete transition and survives restart without leaking into earlier work',async t=>{
  const f=await fixture(t),root=await fs.realpath(f.root),canonical=path.join(root,'canonical'),home=path.join(root,'saved-profile');
  await fs.mkdir(home,{mode:0o700});await fs.mkdir(canonical,{mode:0o700});
  for(const name of ['sessions','archived_sessions','thread-writer-locks'])await fs.mkdir(path.join(canonical,name),{mode:0o700});
  const layout=await new CodexAccountLayout({root}).prepare({canonicalHome:canonical,profileHome:home,sqliteHome:canonical});
  const profile={accountId:f.entry.id,authentication:'verified',accountKey:b,home};
  const authorizations={snapshot:async()=>({profiles:[structuredClone(profile)]})};f.controller.authorizations=authorizations;
  f.adapter.capabilities.selectedRuntimeRouting=true;
  f.adapter.verify=async()=>({accountKey:b,allConsumersVerified:true,freshUsage:true,runtime:{authorizationHome:home,sqliteHome:canonical,layout}});
  assert.equal(await f.controller.selectedLaunch(),null);await f.request();assert.equal(await f.controller.selectedLaunch(),null);
  await f.controller.advance();assert.equal((await f.controller.snapshot()).activeOperation.status,'completed');
  const restored=new CodexAccounts({...f.options,authorizations}),launch=await restored.selectedLaunch();
  assert.equal(launch.account.key,b);assert.equal(launch.env.CODEX_HOME,home);
  assert.ok(launch.configArgs.includes('sqlite_home='+JSON.stringify(canonical)));
  // Captured child environments are independent values; a later identity
  // change blocks subsequent launches without rewriting already-started work.
  profile.accountKey=a;await assert.rejects(restored.selectedLaunch(),/saved sign-in/);
  assert.equal(launch.account.key,b);profile.accountKey=b;
  await fs.unlink(path.join(home,'sessions'));await fs.mkdir(path.join(home,'sessions'),{mode:0o700});
  await assert.rejects(restored.selectedLaunch(),/resources|layout|resource/i);
});
test('incomplete routing evidence keeps the account fence and never selects a silent fallback',async t=>{
  const f=await fixture(t);f.adapter.capabilities.selectedRuntimeRouting=true;
  await f.request();await f.controller.advance();
  assert.equal((await f.controller.snapshot()).activeOperation.status,'needs_attention');
  assert.equal((await f.controller.admission()).allowed,false);assert.equal(await f.controller.selectedLaunch(),null);
});
test('mixed cached account ownership is preserved per consumer instead of attributed to the global allowance reader',async t=>{
  const f=await fixture(t);
  f.consumers.push({...structuredClone(f.consumers[0]),id:'terminal-B',pid:99998,processIdentity:'owner-B',sessionId:'22222222-2222-4222-8222-222222222222',accountKey:b});
  await f.request();await f.controller.advance();const state=await f.controller.snapshot();
  assert.equal(state.activeOperation.status,'completed');
  assert.deepEqual(state.activeOperation.recovery.entries.map(e=>e.accountKey),[a,b]);
  assert.equal(state.activeOperation.sourceAccountKey,a);
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

test('runner contention leaves one existing switch progressing without repeating any effect',async t=>{
  const f=await fixture(t);await f.request();
  const lease=f.controller.lease;
  f.controller.lease=async(...args)=>{
    if(args[1].threadId==='account-switch-runner')throw Object.assign(Error('another runner owns this operation'),{code:'CLAWDAD_CODEX_DELIVERY_CLAIM_TIMEOUT'});
    return lease(...args);
  };
  await f.controller.advance();assert.deepEqual(f.calls,[]);
  assert.equal((await f.controller.snapshot()).activeOperation.status,'checking');
  f.controller.lease=lease;await f.controller.advance();
  assert.equal((await f.controller.snapshot()).activeOperation.status,'completed');assert.deepEqual(f.calls,['authenticate','transition:terminal-A']);
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
test('explicit continuation after partial cancellation reconciles the original effects without repeating a dispatch',async t=>{
  const f=await fixture(t);let complete=false,starts=0;
  f.adapter.transition=async()=>{starts++;throw Error('acknowledgment lost');};
  f.adapter.reconcileTransition=async({consumer})=>({state:complete?'verified':'uncertain',sessionId:consumer.sessionId,accountKey:b,ownerVerified:true,draftVerified:true});
  await f.request();await f.controller.advance();assert.equal(starts,1);
  await f.controller.cancel({operationId:'switch',requestId:'cancel'});
  await f.controller.advance();assert.equal(starts,1);assert.equal((await f.controller.admission()).allowed,false);
  const args={operationId:'switch',requestId:'continue-original',confirmed:true};
  await assert.rejects(f.controller.continueSwitch({...args,confirmed:false}),/Explicitly/);
  complete=true;await f.controller.continueSwitch(args);await f.controller.continueSwitch(args);
  await new CodexAccounts(f.options).advance();assert.equal((await f.controller.snapshot()).activeOperation.status,'completed');assert.equal(starts,1);
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
  await fs.writeFile(f.controller.file,JSON.stringify({version:1,revision:1,epoch:0,accounts:[],requests:{},operations:{},activeOperationId:null,work:null}));
  assert.equal((await f.controller.admission()).allowed,false);await assert.rejects(f.controller.snapshot(),/recovery/);
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
test('native account inventory resolves a primary thread beside helper rollouts without borrowing the global account',async()=>{
  const runtime={state:{jobs:[]},accountConsumerInventory:async()=>({complete:true,consumers:[{
    tabId:'native-tab',windowId:'window-2',processId:'42',tty:'/dev/ttys101',agentInstanceId:'exact-instance',sessionId:'primary',
    directory:'/actual/project',authorizationHome:'/private/profile',executable:'/pinned/codex',cliVersion:'0.154.0',
    model:'gpt-6-astra',reasoningEffort:'max',settingsEvidence:'last_persisted_turn',resumeOptions:['--search'],isBusy:true}]})};
  const value=await inspectAccountConsumers(runtime,{readOwners:async()=>[{pid:42,tty:'ttys101',threads:['primary','helper']}]});
  const owner=value.consumers[0];assert.equal(owner.sessionId,'primary');assert.equal(owner.directory,'/actual/project');
  assert.equal(owner.processIdentity,'exact-instance');assert.equal(owner.busy,true);assert.equal(owner.authorizationHome,'/private/profile');
  assert.equal(owner.accountVerified,false);assert.equal(owner.recoverable,false);
});
test('native inventory requires a new matching request and leaves disabled Assistant, drafts and jobs unchanged',async t=>{
  const f=await fixture(t,{supported:false}),runtime=new AssistantRuntime({root:path.join(f.root,'Assistant'),coordinator:{stop(){}}});
  t.after(()=>runtime.close());await runtime.load();const before=structuredClone(runtime.state);
  const request=runtime.accountConsumerInventory({waitMs:1200});
  const first=await runtime.nativePoll({workerId:'worker-1',accountInventory:{id:'stale',consumers:[{processId:'wrong'}]}});
  assert.ok(first.accountInventoryRequest);assert.equal(first.job,null);
  await runtime.nativePoll({workerId:'worker-2',accountInventory:{id:first.accountInventoryRequest,complete:true,consumers:[{processId:'42'}]}});
  const result=await request;assert.equal(result.workerId,'worker-2');assert.equal(result.consumers[0].processId,'42');
  assert.equal(runtime.state.enabled,before.enabled);assert.deepEqual(runtime.state.jobs,before.jobs);assert.deepEqual(runtime.state.messages,before.messages);
  const second=runtime.accountConsumerInventory({waitMs:1200});
  const next=await runtime.nativePoll({workerId:'worker-2'});assert.notEqual(next.accountInventoryRequest,first.accountInventoryRequest);
  await runtime.nativePoll({workerId:'worker-2',accountInventory:{id:next.accountInventoryRequest,complete:true,consumers:[]}});
  assert.deepEqual((await second).consumers,[]);
});
test('fresh process inventory preserves unknown busy state and explicit alternate authentication instead of borrowing a stale badge',async()=>{
  const runtime={state:{jobs:[]},observation:{catalog:{tabs:[{id:'tab',tty:'/dev/ttys101',isBusy:false}]}},
    accountConsumerInventory:async()=>({consumers:[{tabId:'tab',processId:'42',tty:'/dev/ttys101',agentInstanceId:'exact',
      alternateAuthentication:true,isBusy:null,busyEvidence:'transcript_unavailable'}]})};
  const result=await inspectAccountConsumers(runtime,{readOwners:async()=>[{pid:42,tty:'ttys101',threads:[]}]});
  assert.equal(result.consumers[0].busy,null);assert.equal(result.consumers[0].busyEvidence,'transcript_unavailable');
  assert.equal(result.consumers[0].alternateAuthentication,true);assert.match(result.consumers[0].reason,/explicit API/);
  assert.equal(result.consumers[0].accountVerified,false);
});
test('closed or expired native inventory requests stop asking the worker and return explicit unavailable state',async t=>{
  const f=await fixture(t,{supported:false}),runtime=new AssistantRuntime({root:path.join(f.root,'Assistant'),coordinator:{stop(){}}});
  t.after(()=>runtime.close());await runtime.load();
  const request=runtime.accountConsumerInventory({waitMs:1000});runtime.accountInventoryRequest.expires=0;
  const result=await request;assert.equal(result.complete,false);assert.equal(runtime.accountInventoryRequest,null);
  assert.match(result.reason,/fresh account-process inventory/);assert.equal(runtime.state.jobs.length,0);
});
test('profile activity transport binds each native census to its exact home and fresh request without starting a conversation',async t=>{
  const f=await fixture(t,{supported:false}),runtime=new AssistantRuntime({root:path.join(f.root,'Assistant'),coordinator:{stop(){}}});
  t.after(()=>runtime.close());await runtime.load();const before=structuredClone(runtime.state);
  const first=runtime.accountProfileActivity('/fixture/one',{waitMs:1000});
  await new Promise(resolve=>setImmediate(resolve));
  const poll=await runtime.nativePoll({workerId:'worker-1',accountProfileActivity:{id:'stale',home:'/fixture/one',complete:true,owners:[]}});
  assert.equal(poll.accountProfileRequest.home,'/fixture/one');assert.equal(poll.job,null);
  await runtime.nativePoll({workerId:'worker-1',accountProfileActivity:{id:poll.accountProfileRequest.id,home:'/fixture/wrong',complete:true,owners:[]}});
  assert.equal(runtime.accountProfileRequest.id,poll.accountProfileRequest.id);
  const second=runtime.accountProfileActivity('/fixture/two',{waitMs:1000});
  await runtime.nativePoll({workerId:'worker-2',accountProfileActivity:{id:poll.accountProfileRequest.id,home:'/fixture/one',complete:true,owners:[],observedAt:Date.now()}});
  assert.equal((await first).workerId,'worker-2');await new Promise(resolve=>setImmediate(resolve));
  const next=await runtime.nativePoll({workerId:'worker-2'});assert.equal(next.accountProfileRequest.home,'/fixture/two');
  assert.notEqual(next.accountProfileRequest.id,poll.accountProfileRequest.id);
  await runtime.nativePoll({workerId:'worker-2',accountProfileActivity:{id:next.accountProfileRequest.id,home:'/fixture/two',complete:true,owners:[{pid:'42'}],observedAt:Date.now()}});
  assert.equal((await second).owners[0].pid,'42');assert.equal(runtime.accountProfileRequest,null);
  assert.equal(runtime.state.enabled,before.enabled);assert.deepEqual(runtime.state.jobs,before.jobs);assert.deepEqual(runtime.state.messages,before.messages);
});
test('missing native activity support never claims an idle account profile',async t=>{
  const f=await fixture(t,{supported:false}),runtime=new AssistantRuntime({root:path.join(f.root,'Assistant'),coordinator:{stop(){}}});
  t.after(()=>runtime.close());await runtime.load();
  const result=await runtime.accountProfileActivity('/fixture/one',{waitMs:100});
  assert.equal(result.complete,false);assert.equal(result.reasonCode,'native_profile_activity_unavailable');assert.equal(runtime.accountProfileRequest,null);
  assert.equal((await runtime.nativePoll({workerId:'old-worker'})).accountProfileRequest,null);
  await assert.rejects(runtime.accountProfileActivity('../other'),/exact saved/);
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

test('acceptance and switching serialize durably, and a crash before job persistence prevents transition',async t=>{
  const f=await fixture(t),jobs=[];f.controller.readWork=async()=>({complete:true,jobs});
  let release,entered;const waiting=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const input={id:'accepted-before-fence',action:'message',fingerprint:'exact-body'};
  const saving=f.controller.withWorkAdmission(input,async stamp=>{
    entered();await waiting;const job={...input,...stamp,status:'queued'};jobs.push(job);return job;
  });
  await started;
  const selection=f.request();await new Promise(r=>setTimeout(r,20));
  assert.equal(JSON.parse(await fs.readFile(f.controller.file,'utf8')).activeOperationId,null);
  release();await saving;await selection;await f.controller.advance();
  assert.equal((await f.controller.snapshot()).activeOperation.status,'waiting');assert.deepEqual(f.calls,[]);
  assert.equal((await f.controller.deliveryAdmission(jobs[0])).allowed,true);
  jobs[0].status='completed';await f.controller.advance();assert.equal((await f.controller.snapshot()).activeOperation.status,'completed');

  const g=await fixture(t);g.controller.readWork=async()=>({complete:true,jobs:[]});
  await assert.rejects(g.controller.withWorkAdmission({id:'lost-acceptance',action:'message',fingerprint:'body'},async()=>{throw Error('disk failed');}),/disk failed/);
  await g.request();await new CodexAccounts({...g.options,readWork:g.controller.readWork}).advance();
  const blocked=await g.controller.snapshot();assert.equal(blocked.activeOperation.status,'waiting');
  assert.equal(blocked.activeOperation.observation.drain.pending[0].status,'acceptance_needs_reconciliation');assert.deepEqual(g.calls,[]);
});

test('an accepted Assistant turn and its actual MCP/HTTP native tool finish during preflight; later text waits without rerouting',async t=>{
  const f=await fixture(t);let runtime,runs=0,release;const finish=new Promise(r=>release=r);
  const coordinator={stop(){release();},prepare:async()=>({mode:'background'}),run:async({id,onMessage})=>{
    runs++;const output=[];
    await runAssistantMCP({root:f.root,coordinatorRequestId:id,
      input:Readable.from([JSON.stringify({id:1,method:'tools/call',params:{name:'focus_tab',arguments:{requestId:'original-tool',tabId:'fixture-tab'}}})+'\n']),
      output:new Writable({write(chunk,encoding,done){output.push(JSON.parse(chunk));done();}}),
      fetchImpl:async(url,options)=>{
        let code,result;await assistantHttp({method:options.method},null,new URL(url),runtime,{readBody:async()=>JSON.parse(options.body),json:(res,c,data)=>{code=c;result=data;}});
        return {ok:code===200,json:async()=>result};
      }});
    assert.equal(output[0].result.isError,undefined);
    await finish;await onMessage({id:'reply',text:'Finished original request'});
  }};
  runtime=new AssistantRuntime({root:path.join(f.root,'Assistant'),coordinator});t.after(()=>runtime.close());
  runtime.accounts=f.controller;f.controller.readWork=()=>readAccountWork(runtime);
  await runtime.load();runtime.state.enabled=true;await runtime.save();
  await fs.writeFile(path.join(runtime.root,'connection.json'),JSON.stringify({baseURL:'http://127.0.0.1:4487'}));
  await fs.writeFile(path.join(f.root,'native-server.token'),'synthetic');
  await runtime.command({action:'message',requestId:'original-message',text:'Original authorized action'});
  await f.request();await f.controller.advance();assert.deepEqual(f.calls,[]);
  await runtime.command({action:'message',requestId:'later-message',text:'Later request 🌿'});
  const observation={workerId:'fixture-worker',catalog:{tabs:[{id:'fixture-tab'}]}};
  await runtime.nativePoll(observation);
  const deadline=Date.now()+3000;
  while(!(await runtime.job('original-tool'))&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));
  assert.equal(runs,1);assert.equal((await runtime.job('original-tool')).accountSwitchHold,null);
  const native=await runtime.nativePoll(observation);assert.equal(native.job.id,'original-tool');
  await runtime.nativeResult({id:native.job.id,result:{}});
  release();await runtime.drainTask;
  assert.equal((await runtime.job('original-message')).status,'completed');
  assert.equal((await runtime.job('later-message')).status,'queued');
  await assert.rejects(runtime.command({action:'terminal.focus',requestId:'expired-child',tabId:'fixture-tab',coordinatorRequestId:'original-message'},{tool:true}),/no longer active/);
  await f.controller.advance();assert.equal((await f.controller.snapshot()).activeOperation.status,'completed');
  await runtime.drain();assert.equal(runs,1);
  assert.equal((await runtime.job('later-message')).reasonCode,'account_request_reconciliation_required');
  assert.equal(runtime.state.messages.filter(m=>m.role==='assistant').length,1);
});

test('cancelled switch releases held work on the original epoch; another switch waits for it',async t=>{
  const f=await fixture(t),jobs=[];f.controller.readWork=async()=>({complete:true,jobs});
  await f.request();
  await f.controller.withWorkAdmission({id:'held',action:'message',fingerprint:'unchanged',allowHold:true},async stamp=>{
    const job={id:'held',action:'message',fingerprint:'unchanged',...stamp,status:'queued'};jobs.push(job);return job;
  });
  await f.controller.cancel({operationId:'switch',requestId:'cancel'});
  assert.equal((await f.controller.deliveryAdmission(jobs[0])).allowed,true);
  await f.request('next-switch');await f.controller.advance();
  assert.equal((await f.controller.snapshot()).activeOperation.status,'waiting');
  assert.equal((await f.controller.deliveryAdmission(jobs[0])).allowed,true);assert.deepEqual(f.calls,[]);
  jobs[0].status='completed';await f.controller.advance();assert.equal((await f.controller.snapshot()).activeOperation.status,'completed');
});

test('legacy accepted receipts are drained by exact fingerprint and unreadable inventory prevents adoption',async t=>{
  const f=await fixture(t),job={id:'legacy',action:'terminal.queue',fingerprint:'exact',status:'agent_queued'};
  let complete=true;f.controller.readWork=async()=>({complete,jobs:[job]});
  await f.request();await f.controller.advance();assert.equal((await f.controller.deliveryAdmission(job)).allowed,true);
  assert.equal((await f.controller.deliveryAdmission({...job,fingerprint:'changed'})).allowed,false);
  job.status='completed';complete=false;await f.controller.advance();assert.deepEqual(f.calls,[]);
  job.status='working';complete=true;await f.controller.advance();assert.deepEqual(f.calls,[]);
  job.fingerprint='changed';job.status='completed';await f.controller.advance();assert.deepEqual(f.calls,[]);
  assert.equal((await f.controller.snapshot()).activeOperation.observation.drain.pending[0].status,'receipt_identity_changed');
  job.fingerprint='exact';
  complete=true;await f.controller.advance();assert.equal((await f.controller.snapshot()).activeOperation.status,'completed');
});

test('work receipt traffic preserves the reviewed account-selection revision',async t=>{
  const f=await fixture(t),reviewed=await f.controller.snapshot();
  await f.controller.withWorkAdmission({id:'background-work',action:'message',fingerprint:'payload'},async stamp=>
    ({id:'background-work',action:'message',fingerprint:'payload',status:'queued',...stamp}));
  const after=await f.controller.snapshot();assert.equal(after.revision,reviewed.revision);assert.ok(after.journalRevision>reviewed.journalRevision);
  const op=await f.controller.request({accountId:f.entry.id,requestId:'chosen',expectedRevision:reviewed.revision,confirmed:true});
  assert.equal(op.status,'checking');assert.ok((await f.controller.snapshot()).revision>reviewed.revision);
});

test('the committed-work inventory reports malformed receipts and preserves project-queue identity',async t=>{
  const f=await fixture(t),runtime={root:path.join(f.root,'Assistant')};
  await fs.mkdir(path.join(runtime.root,'AppServer'),{recursive:true});
  await fs.writeFile(path.join(runtime.root,'state.json'),JSON.stringify({version:1,jobs:[
    {id:'main',action:'message',fingerprint:'main-body',status:'running'},
    {id:'project',action:'appserver.queue',fingerprint:'old-mirror',status:'completed'}]}));
  await fs.writeFile(path.join(runtime.root,'AppServer/state.json'),JSON.stringify({version:1,jobs:[
    {id:'project',action:'appserver.queue',fingerprint:'actual-project-body',status:'agent_queued'}]}));
  const read=await readAccountWork(runtime);assert.equal(read.complete,true);
  assert.equal(read.jobs.find(j=>j.id==='project').status,'agent_queued');assert.equal(read.jobs.length,2);
  await fs.writeFile(path.join(runtime.root,'state.json'),JSON.stringify({version:1,jobs:[{id:'unknown',status:'running'}]}));
  assert.equal((await readAccountWork(runtime)).complete,false);
});
