import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {CodexAppAccounts} from '../lib/codex-app-accounts.mjs';
import {AssistantRuntime} from '../lib/assistant-runtime.mjs';
import {CodexAccountLayout} from '../lib/codex-account-layout.mjs';
import {researchSave} from '../lib/research-budget.mjs';

async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-app-accounts-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const home=path.join(root,'profile'),canonical=path.join(root,'canonical');
  await fs.mkdir(home,{mode:0o700});await fs.mkdir(canonical,{mode:0o700});
  for(const name of ['sessions','archived_sessions','thread-writer-locks'])await fs.mkdir(path.join(canonical,name),{mode:0o700});
  const layout=await new CodexAccountLayout({root}).prepare({canonicalHome:canonical,profileHome:home});
  const key='a'.repeat(64),jobs=[],effects=[],profiles=[];
  const authorizations={snapshot:async()=>({profiles}),request:async args=>{effects.push('refresh');return args;}};
  const adapter={capture:async()=>{effects.push('capture');return {kind:'absent'};},prepare:async(_,target)=>({method:'chatgpt',email:target.email,accountKey:key}),
    transition:async()=>{effects.push('transition');return {};},verify:async()=>({accountKey:key,runtime:{authorizationHome:home,sqliteHome:canonical,layout}})};
  const options={root,adapter,authorizations,readWork:async()=>({complete:true,jobs}),usage:{snapshot:async()=>({status:'unavailable'}),refresh:async()=>effects.push('usage')}};
  const accounts=new CodexAppAccounts(options),entry=(await accounts.add({email:'fixture@example.test',requestId:'save',expectedRevision:0})).account;
  profiles.push({accountId:entry.id,email:entry.email,accountKey:key,home,authentication:'verified',verifiedAt:new Date().toISOString(),remainingPercent:0,resetsAt:2e9});
  const activate=async(id='activate')=>accounts.request({accountId:entry.id,requestId:id,confirmed:true,expectedRevision:(await accounts.snapshot()).revision});
  return {root,home,canonical,key,accounts,options,entry,activate,jobs,effects,profiles,adapter};
}
test('preview/refresh preserves active routing; zero allowance permits verified activation without a model turn',async t=>{
  const f=await fixture(t);
  await f.accounts.preview({accountId:f.entry.id,refresh:true,requestId:'refresh'});
  assert.equal(await f.accounts.selectedLaunch(),null);assert.deepEqual(f.effects,['refresh']);
  await f.activate();await f.accounts.advance();
  const state=await f.accounts.snapshot();assert.equal(state.activeAccountId,f.entry.id);assert.equal(state.activeOperation.status,'completed');
  assert.equal(state.accounts[0].usage.remainingPercent,0);
  const restarted=new CodexAppAccounts(f.options);assert.equal((await restarted.selectedLaunch()).env.CODEX_HOME,f.home);
  assert.deepEqual(f.effects,['refresh','capture','transition','usage']);
});
test('concurrent requests alias one activation, retries never repeat a completed effect',async t=>{
  const f=await fixture(t),revision=(await f.accounts.snapshot()).revision;
  const input={accountId:f.entry.id,confirmed:true,expectedRevision:revision};
  const [a,b]=await Promise.all([f.accounts.request({...input,requestId:'one'}),f.accounts.request({...input,requestId:'two'})]);
  assert.equal(a.id,b.id);await Promise.all([f.accounts.advance(),new CodexAppAccounts(f.options).advance()]);
  assert.equal(f.effects.filter(x=>x==='transition').length,1);
  assert.equal((await f.accounts.control('accounts.status',{receiptId:'two'})).accountReceipt.operationId,a.id);
});
test('Terminal actions never read the app fence, even when activation fails',async t=>{
  const f=await fixture(t);f.adapter.prepare=async()=>{throw Object.assign(Error('fixture'),{code:'fixture_failure'});};
  await f.activate();await f.accounts.advance();assert.equal((await f.accounts.admission()).allowed,false);
  for(const action of ['terminal.insert','terminal.send','terminal.queue','terminal.key','workspace.restore','input.edit']){
    let called=0;await f.accounts.withWorkAdmission({id:'terminal',action,fingerprint:'draft'},async()=>{called++;});
    assert.equal(called,1);assert.equal((await f.accounts.deliveryAdmission({id:'terminal',action})).allowed,true);
  }
  assert.equal((await f.accounts.control('accounts.windows',{})).accountReceipt.accepted,false);
});
test('old failed window switch is archived byte-exact and cannot hold Terminal or replay uncertain app work',async t=>{
  const f=await fixture(t);await fs.unlink(f.accounts.file);
  const old={version:1,revision:4,epoch:7,accounts:[f.entry],work:{},requests:{},activeOperationId:'broken',operations:{broken:{id:'broken',status:'needs_attention',phase:'transition',fenced:true}}};
  const bytes=JSON.stringify(old)+'\n';await fs.writeFile(path.join(f.root,'switch-state.json'),bytes);
  f.jobs.push({id:'uncertain',action:'message',fingerprint:'original',status:'attention'}, {id:'live',action:'message',fingerprint:'live-message',status:'running',accountEpoch:7});
  const state=await f.accounts.snapshot();assert.equal(state.activeOperation,null);assert.equal((await f.accounts.admission()).allowed,true);
  const archive=(await fs.readdir(path.join(f.root,'Retired')))[0];assert.equal(await fs.readFile(path.join(f.root,'Retired',archive),'utf8'),bytes);
  assert.equal(await fs.readFile(path.join(f.root,'switch-state.json'),'utf8'),bytes);
  assert.equal((await f.accounts.deliveryAdmission(f.jobs[0])).allowed,false);
  await f.activate();await f.accounts.advance();assert.equal((await f.accounts.snapshot()).activeOperation.status,'waiting');
  assert.equal(f.effects.length,0);f.jobs[1].status='completed';await f.accounts.advance();assert.equal((await f.accounts.snapshot()).activeOperation.status,'completed');
});
test('accepted work drains on old epoch; held text/images retain exact receipt and deliver once on new epoch',async t=>{
  const f=await fixture(t);
  const save=async(id,hold)=>f.accounts.withWorkAdmission({id,action:'message',fingerprint:id+'-🦞',allowHold:hold},async stamp=>{
    const job={id,action:'message',fingerprint:id+'-🦞',status:'queued',text:'Exact\n🦞',images:['retained.png'],...stamp};f.jobs.push(job);return job;
  });
  const accepted=await save('before',false);await f.activate();const held=await save('after',true);
  assert.equal((await f.accounts.deliveryAdmission(accepted)).allowed,true);assert.equal((await f.accounts.deliveryAdmission(held)).allowed,false);
  const runtime=new AssistantRuntime({root:path.join(f.root,'Assistant'),coordinator:{stop(){}}});
  runtime.accounts=f.accounts;runtime.save=async()=>{};
  assert.equal(await runtime.accountDeliveryBlocked(held),true);assert.equal(held.status,'queued');
  await f.accounts.advance();assert.equal(f.effects.length,0);accepted.status='completed';await f.accounts.advance();
  assert.equal((await f.accounts.deliveryAdmission(held)).allowed,true);held.status='completed';
  assert.equal((await f.accounts.workDrain()).ready,true);
  assert.equal(held.text,'Exact\n🦞');assert.deepEqual(held.images,['retained.png']);
  await assert.rejects(save('after',true),/Reconcile/);
});
test('changed identity stops activation before publishing destination and explicit retry reconciles original ID',async t=>{
  const f=await fixture(t);let fails=true;f.adapter.transition=async op=>{f.effects.push(op.id);if(fails)throw Object.assign(Error('connection'),{code:'shared_launch_unconfirmed'});return {};};
  const op=await f.activate();await f.accounts.advance();assert.equal(await f.accounts.selectedLaunch(),null);
  assert.equal((await f.accounts.snapshot()).activeOperation.reasonCode,'shared_launch_unconfirmed');
  await f.accounts.advance();assert.equal(f.effects.filter(x=>x===op.id).length,1);
  fails=false;await f.accounts.retry({operationId:op.id,requestId:'retry',confirmed:true});await f.accounts.advance();
  assert.equal((await f.accounts.snapshot()).activeOperation.id,op.id);
});
test('retained shell launcher forwards unmodified arguments without touching a switch journal',async t=>{
  const f=await fixture(t),script=path.join(f.root,'cli.mjs');await fs.writeFile(script,'console.log(JSON.stringify(process.argv.slice(2)));');
  const result=spawnSync(process.execPath,['bin/clawdad-codex',process.execPath,'--',script,'resume','exact-thread'],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,CLAWDAD_ACCOUNTS_ROOT:f.root}});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),['resume','exact-thread']);
});
test('cancel and retry request IDs cannot be reused for a different operation or effect',async t=>{
  const f=await fixture(t),op=await f.activate();
  await f.accounts.cancel({operationId:op.id,requestId:'cancel-one'});
  assert.equal((await f.accounts.cancel({operationId:op.id,requestId:'cancel-one'})).status,'cancelled');
  await assert.rejects(f.accounts.retry({operationId:op.id,requestId:'cancel-one',confirmed:true}),/different action/);
  await assert.rejects(f.accounts.cancel({operationId:'wrong',requestId:'cancel-one'}),/different action/);
});
test('bounded read-only inventory races keep the same activation and never replay a completed transition',async t=>{
  const f=await fixture(t);let reads=0;
  const capture=f.adapter.capture;f.adapter.capture=async op=>{if(reads++===0)throw Object.assign(Error('Inventory changed'),{code:'shared_inventory_changed'});return capture(op);};
  const op=await f.activate();await f.accounts.advance();
  assert.equal((await f.accounts.snapshot()).activeOperation.status,'waiting');assert.equal(f.effects.length,0);
  await f.accounts.advance();assert.equal((await f.accounts.snapshot()).activeOperation.status,'completed');
  const count=f.effects.length;await f.accounts.advance();assert.equal(f.effects.length,count);
  assert.equal((await f.accounts.snapshot()).activeOperation.id,op.id);
});
