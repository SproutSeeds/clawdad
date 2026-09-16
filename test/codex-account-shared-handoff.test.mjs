import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CodexAccountSharedHandoff} from '../lib/codex-account-shared-handoff.mjs';

const a='a'.repeat(64),b='b'.repeat(64),h='c'.repeat(64);
async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-shared-handoff-test-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const thread=id=>({id,cwd:'/project',historyHash:h,draftHash:h,busy:false,queueEmpty:true,approvalsEmpty:true,
    settings:{model:'gpt-6-astra',reasoningEffort:'low',cwd:'/project',approvalPolicy:'never',sandbox:{type:'readOnly'}},settingsVerified:true,receiptsResolved:true});
  const source={kind:'server',socketPath:'/private/socket',processIdentity:'pid-123-start',pid:123,accountKey:a,accountVerified:true,
    inventoryComplete:true,dispatchHeld:true,threads:[thread('01a0a848-cb86-7033-ae6f-ce006f5b51bb'),thread('01a0a848-de93-75e3-b69d-8158ebb54973')]};
  const target={accountKey:b,authorizationHome:'/profile/b',accountVerified:true,configurationVerified:true};
  const state={value:structuredClone(source),effects:[],receipts:new Map(),delayRelease:false,allow:true,failAfter:null};
  const effect=(name,fn)=>async args=>{state.effects.push(name);fn(args);state.receipts.set(args.requestId,{state:'completed',durable:true});
    if(state.failAfter===name)throw Error('Simulated interruption after effect');return {state:'completed'};};
  const driver={observe:async()=>structuredClone(state.value),permit:async()=>{if(!state.allow)throw Error('Paused');},
    reconcile:async({requestId})=>state.receipts.get(requestId)||{state:'unknown'},verifyOwnership:async()=>state.owned!==false,
    release:effect('release',({thread})=>{if(!state.delayRelease)state.value.threads=state.value.threads.filter(t=>t.id!==thread.id);}),
    stopIdle:effect('stop',()=>{assert.equal(state.value.threads.length,0);state.value={kind:'absent',socketPath:source.socketPath,inventoryComplete:true,dispatchHeld:true};}),
    launch:effect('launch',()=>{state.value={...structuredClone(source),threads:[],pid:456,processIdentity:'pid-456-start',accountKey:b,authorizationHome:target.authorizationHome};}),
    resume:effect('resume',({thread})=>{state.value.threads.push(structuredClone(thread));})};
  const controller=()=>new CodexAccountSharedHandoff({root,driver});
  const args={operationId:'switch-1',source,target,confirmed:true};
  return {root,source,target,state,driver,controller,args};
}

test('durable shared-server handoff preserves distinct same-directory threads, settings and drafts without tasks',async t=>{
  const f=await fixture(t),r=await f.controller().run(f.args);
  assert.equal(r.phase,'verified');assert.deepEqual(f.state.effects,['release','release','stop','launch','resume','resume']);
  assert.deepEqual(f.state.value.threads,f.source.threads);
  await f.controller().run(f.args);assert.equal(f.state.effects.length,6);
});
test('unsubscribe acknowledgement waits across controller restart until observed ownership release',async t=>{
  const f=await fixture(t);f.state.delayRelease=true;
  const first=await f.controller().run(f.args);assert.equal(first.reasonCode,'shared_threads_releasing');
  assert.deepEqual(f.state.effects,['release','release']);
  assert.equal((await f.controller().run(f.args)).waiting,true);assert.equal(f.state.effects.length,2);
  f.state.value.threads=[];
  assert.equal((await f.controller().run(f.args)).phase,'verified');
  assert.deepEqual(f.state.effects,['release','release','stop','launch','resume','resume']);
});
test('crash after replacement launch reconciles exact ownership without a duplicate process',async t=>{
  const f=await fixture(t);f.state.failAfter='launch';await assert.rejects(f.controller().run(f.args),/Simulated interruption/);
  f.state.failAfter=null;assert.equal((await f.controller().run(f.args)).phase,'verified');
  assert.equal(f.state.effects.filter(e=>e==='launch').length,1);
});
test('unconfirmed launch never retries after an absent process without non-delivery proof',async t=>{
  const f=await fixture(t);f.driver.launch=async()=>{throw Error('Unknown delivery');};
  await assert.rejects(f.controller().run(f.args),/Unknown delivery/);
  await assert.rejects(f.controller().run(f.args),e=>e.code==='shared_account_delivery_uncertain');
});
test('busy work, native queues, approvals, edited drafts and changed settings block before process stop',async t=>{
  for(const change of [s=>s.threads[0].busy=true,s=>s.threads[0].queueEmpty=false,s=>s.threads[0].approvalsEmpty=false,
    s=>s.threads[0].draftHash=a,s=>s.threads[0].settings.reasoningEffort='high',s=>s.processIdentity='another-owner']){
    const f=await fixture(t);change(f.state.value);await assert.rejects(f.controller().run(f.args));assert.deepEqual(f.state.effects,[]);
  }
});
test('foreign target owner or unexpected thread blocks automatic restoration',async t=>{
  const f=await fixture(t);f.state.failAfter='launch';await assert.rejects(f.controller().run(f.args));
  f.state.failAfter=null;f.state.owned=false;
  await assert.rejects(f.controller().run(f.args),e=>e.code==='shared_account_destination_unverified');
  assert.equal(f.state.effects.includes('resume'),false);
  f.state.owned=true;f.state.value.threads=[{...f.source.threads[0],historyHash:a}];
  await assert.rejects(f.controller().run(f.args),e=>e.code==='shared_account_foreign_threads');
});
test('concurrent requests converge and same account preserves the original server',async t=>{
  const f=await fixture(t);const results=await Promise.all([f.controller().run(f.args),f.controller().run(f.args)]);
  assert.ok(results.every(r=>r.phase==='verified'));assert.equal(f.state.effects.filter(e=>e==='launch').length,1);
  const g=await fixture(t);g.args.target.accountKey=a;
  assert.equal((await g.controller().run(g.args)).alreadySelected,true);assert.deepEqual(g.state.effects,[]);
});
test('paused permission prevents the next effect and retained history remains intact',async t=>{
  const f=await fixture(t);f.state.allow=false;await assert.rejects(f.controller().run(f.args),/Paused/);
  assert.deepEqual(f.state.effects,[]);assert.deepEqual(f.state.value.threads,f.source.threads);
});
