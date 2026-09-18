import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CodexAccountSharedRPC,sharedAccountResumeParams,canonicalSharedSettings} from '../lib/codex-account-shared-rpc.mjs';
const id='01a0a848-cb86-7033-ae6f-ce006f5b51bb';
const base={model:'gpt-6-astra',reasoningEffort:'low',cwd:'/project',modelProvider:'openai',serviceTier:null,
  runtimeWorkspaceRoots:['/project'],instructionSources:['/project/AGENTS.md'],approvalPolicy:'never',approvalsReviewer:'user',
  sandbox:{type:'readOnly',networkAccess:false},activePermissionProfile:null};
test('shared instruction files compare by proven filesystem alias while different resources remain distinct',async t=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-settings-alias-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file=path.join(root,'AGENTS.md'),alias=path.join(root,'profile-AGENTS.md');await fs.writeFile(file,'same instruction');await fs.symlink(file,alias);
  assert.deepEqual(await canonicalSharedSettings({instructionSources:[alias]}),{instructionSources:[file]});
  assert.notDeepEqual(await canonicalSharedSettings({instructionSources:[path.join(root,'missing')]}),{instructionSources:[file]});
});
test('exact resume has separate model/effort and preserved permissions with no prompt/history/path replacement',()=>{
  const params=sharedAccountResumeParams({id,cwd:'/project',settings:base});
  assert.equal(params.threadId,id);assert.equal(params.sandbox,'read-only');assert.equal(params.config.model_reasoning_effort,'low');
  assert.equal(params.config['sandbox_read_only.network_access'],false);assert.equal(params.path,undefined);assert.equal(params.history,undefined);
  assert.equal(Object.hasOwn(params,'serviceTier'),false);
  assert.equal(sharedAccountResumeParams({id,cwd:'/project',settings:{...base,serviceTier:'fast'}}).serviceTier,'fast');
  const named=sharedAccountResumeParams({id,cwd:'/project',settings:{...base,activePermissionProfile:{id:'limited',extends:':workspace'}}});
  assert.equal(named.permissions,'limited');assert.equal(named.sandbox,undefined);
  assert.throws(()=>sharedAccountResumeParams({id,cwd:'/project',settings:{...base,sandbox:{type:'externalSandbox'}}}),e=>e.code==='shared_permissions_unsupported');
});
async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-shared-rpc-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const owner={kind:'server',pid:123,processIdentity:'original-owner',authorizationHome:'/account'};
  const state={loaded:[id],queue:[],status:'idle',settings:structuredClone(base),turns:[{id:'turn-a',status:'completed',items:[{type:'userMessage',content:[{type:'text',text:'BEGIN 🌿\nEND'}]}]}],calls:[],permitted:true,foreign:false};
  const thread=()=>({id,status:{type:state.status},cwd:'/project',model:state.settings.model,reasoningEffort:state.settings.reasoningEffort});
  const account={type:'chatgpt',email:'synthetic@example.test',planType:'pro',accountId:'synthetic'};
  const client={serverRequests:new Map(),close(){},async request(method,params){
    state.calls.push({method,params});
    switch(method){
      case 'server/diagnostics':return {process:{id:owner.pid}};
      case 'account/read':return {account};
      case 'account/rateLimits/read':return {accountId:'synthetic',rateLimits:{limitId:'codex',primary:{usedPercent:2,windowDurationMins:300,resetsAt:1800000000},secondary:{usedPercent:20,windowDurationMins:10080,resetsAt:1800400000}}};
      case 'thread/loaded/list':return {data:state.loaded,nextCursor:null};
      case 'thread/read':return {thread:thread()};
      case 'thread/queue/list':return {data:state.queue,nextCursor:null};
      case 'thread/turns/list':return {data:state.turns,nextCursor:null};
      case 'thread/resume':if(!state.loaded.includes(id))state.loaded.push(id);return {...state.settings,thread:thread()};
      case 'thread/unsubscribe':return {status:'unsubscribed'};
      default:throw Error('Unexpected RPC '+method);
    }
  }};
  const processes={observe:async()=>({...owner}),dispatchHeld:async()=>true,verifyOwnership:async()=>true,
    assertThreadUnowned:async()=>{if(state.foreign)throw Error('Foreign owner');},stopIdle:async()=>{state.stopped=true;},launch:async()=>{state.launched=true;}};
  const driver=new CodexAccountSharedRPC({root,socketPath:'/private/test.sock',processes,createClient:()=>client,
    permit:async()=>{if(!state.permitted)throw Error('Paused');},captureLocal:async()=>({draftHash:'a'.repeat(64),receiptsResolved:true})});
  return {root,state,driver,owner,client};
}
test('transient identity reads retry boundedly and short polling reuses only the same live account',async t=>{
  const f=await fixture(t),request=f.client.request.bind(f.client);let failures=2,reads=0,clock=10000;
  f.driver.clock=()=>clock;f.driver.retryWait=async()=>{};
  f.client.request=async(method,args)=>{if(method==='account/rateLimits/read'){reads++;if(failures-->0)throw Error('temporary provider failure');}return request(method,args);};
  const first=await f.driver.account(f.client);assert.equal(reads,3);assert.equal((await f.driver.account(f.client)).accountKey,first.accountKey);assert.equal(reads,3);
  clock+=5001;failures=10;await assert.rejects(f.driver.account(f.client),{code:'shared_account_read_unavailable'});assert.equal(reads,6);
  assert.equal(f.state.calls.some(c=>c.method==='account/login/start'),false);
});
test('revoked source authentication preserves fully verified idle threads and rejects busy or changed owners',async t=>{
  const f=await fixture(t),request=f.client.request.bind(f.client);let accountReads=0;
  f.owner.executable='/verified/codex';f.owner.serverOptions=[];
  f.client.request=async(method,args)=>{if(method==='account/rateLimits/read'){accountReads++;throw Error('401 Unauthorized token_revoked');}return request(method,args);};
  f.state.status='active';
  await assert.rejects(f.driver.observe({operationId:'switch',capture:true}),{code:'shared_thread_working'});
  f.state.status='idle';
  const retained=await f.driver.observe({operationId:'switch',capture:true});
  assert.equal(retained.sourceAccountUnavailable,true);assert.equal(retained.threads.length,1);assert.match(retained.sourceAccountIdentityHash,/^[a-f0-9]{64}$/);
  f.state.loaded=[];
  await assert.rejects(f.driver.observe({operationId:'switch'}),{code:'shared_authentication_expired'});
  f.state.permitted=false;
  await assert.rejects(f.driver.observe({operationId:'switch',capture:true}),/Paused/);
  f.state.permitted=true;
  const source=await f.driver.observe({operationId:'switch',capture:true});
  assert.equal(source.accountKey,null);assert.equal(source.accountVerified,false);assert.equal(source.emptySourceAccountUnavailable,true);
  assert.deepEqual(source.threads,[]);
  assert.equal((await f.driver.observe({operationId:'switch',source})).emptySourceAccountUnavailable,true);
  f.owner.pid=456;f.owner.processIdentity='destination';
  await assert.rejects(f.driver.observe({operationId:'switch',source}),{code:'shared_authentication_expired'});
  assert.equal(accountReads,7,'Revoked tokens are not pointlessly retried');
  assert.equal(f.state.calls.some(c=>/login|turn\//.test(c.method)),false);
  assert.equal(f.state.calls.filter(c=>c.method==='thread/unsubscribe').length,1,'the settings reader releases only its own subscription');
});
test('supported RPC capture verifies complete history/account/settings, keeps unsubscribe separate from release',async t=>{
  const f=await fixture(t);const source=await f.driver.observe({operationId:'switch',capture:true});
  assert.equal(source.threads.length,1);assert.equal(source.threads[0].busy,false);assert.equal(source.accountVerified,true);
  const args={operationId:'switch',requestId:'b'.repeat(64),source,target:{accountKey:source.accountKey},thread:source.threads[0]};
  await f.driver.release(args);await f.driver.release(args);
  assert.equal(f.state.calls.filter(c=>c.method==='thread/unsubscribe').length,2,'one inspection cleanup and one idempotent release');
  assert.equal((await f.driver.observe({...args})).threads.length,1);
  await assert.rejects(f.driver.stopIdle({...args,requestId:'c'.repeat(64)}),e=>e.code==='shared_owner_not_released');
  assert.equal(f.state.stopped,undefined);
  assert.equal(f.state.calls.some(c=>/turn\/(start|steer)|login|queue\/add/.test(c.method)),false);
});
test('local draft receipts, busy/queued state and changed settings block capture or transition',async t=>{
  const f=await fixture(t);f.state.status='active';await assert.rejects(f.driver.observe({operationId:'switch',capture:true}),e=>e.code==='shared_thread_working');
  f.state.status='idle';f.state.queue=[{id:'pending'}];await assert.rejects(f.driver.observe({operationId:'switch',capture:true}),e=>e.code==='shared_thread_pending');
  f.state.queue=[];await f.driver.observe({operationId:'switch',capture:true});f.state.settings.reasoningEffort='high';
  await assert.rejects(f.driver.observe({operationId:'switch'}),e=>e.code==='shared_settings_changed');
});
test('unmaterialized first-turn history has an actionable specific failure and causes no process effect',async t=>{
  const f=await fixture(t),original=f.client.request.bind(f.client);
  f.client.request=async(method,args)=>{if(method==='thread/turns/list')throw Error('thread '+id+' is not materialized yet; thread/turns/list is unavailable before first user message');return original(method,args);};
  await assert.rejects(f.driver.observe({operationId:'switch',capture:true}),e=>e.code==='shared_thread_not_persisted'&&e.appAccountSafe===true);
  assert.equal(f.state.stopped,undefined);assert.equal(f.state.launched,undefined);
  assert.equal(f.state.calls.some(c=>/turn\//.test(c.method)),false);
  assert.equal(f.state.calls.filter(c=>c.method==='thread/unsubscribe').length,1,'failed history inspection leaves no configuration-pinning subscription');
});
test('no replay after unknown RPC delivery; exact target permission is required for every effect',async t=>{
  const f=await fixture(t),source=await f.driver.observe({operationId:'switch',capture:true});
  const args={operationId:'switch',requestId:'d'.repeat(64),source,target:{accountKey:source.accountKey},thread:source.threads[0]};
  f.driver.processes.launch=async()=>{throw Error('Lost acknowledgement');};
  await assert.rejects(f.driver.launch(args),/Lost acknowledgement/);
  await assert.rejects(f.driver.launch(args),e=>e.code==='shared_rpc_delivery_uncertain');
  assert.equal((await f.driver.reconcile(args)).state,'uncertain');
  f.state.permitted=false;await assert.rejects(f.driver.release({...args,requestId:'e'.repeat(64)}),/Paused/);
  assert.equal(f.state.calls.filter(c=>c.method==='thread/unsubscribe').length,1,'the rejected release adds no subscription operation beyond inspection cleanup');
});
test('resume refuses foreign ownership and never sends a message or replaces history',async t=>{
  const f=await fixture(t),source=await f.driver.observe({operationId:'switch',capture:true});
  f.state.loaded=[];f.state.foreign=true;
  const args={operationId:'switch',requestId:'e'.repeat(64),source,target:{accountKey:source.accountKey},thread:source.threads[0]};
  await assert.rejects(f.driver.resume(args),/Foreign owner/);
  assert.equal(f.state.calls.filter(c=>c.method==='thread/resume').length,1);
  assert.equal((await f.driver.reconcile(args)).state,'not_dispatched');
  f.state.foreign=false;
  f.driver.processes.verifyOwnership=async value=>value.requestId===undefined;
  await f.driver.resume(args);
  assert.equal(f.state.calls.filter(c=>c.method==='thread/resume').length,2);
  assert.equal((await f.driver.reconcile(args)).state,'completed');
});
