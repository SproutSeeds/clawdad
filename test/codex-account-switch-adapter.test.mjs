import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {CodexAccounts} from '../lib/codex-accounts.mjs';
import {CodexAccountSwitchAdapter} from '../lib/codex-account-switch-adapter.mjs';

const hash=text=>createHash('sha256').update(text).digest('hex');
async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-account-combined-')));
  const emails=['first@example.test','second@example.test','third@example.test'];
  const identities=emails.map((email,n)=>({email,accountKey:hash(String(n)),method:'chatgpt',verified:true}));
  const source={kind:'agent',pid:42,processIdentity:'process-original',shellIdentity:'persistent-shell',tty:'/dev/ttys999',tabLifetime:hash('tab'),
    windowIdentity:hash('window'),sessionId:'00000000-0000-4000-8000-000000000001',directory:'/fixture/project',authorizationHome:'/canonical',
    executable:'/fixture/codex',acceptedTurnsHash:hash('prior exact accepted turns'),accountKey:identities[0].accountKey,accountVerified:true,
    model:'gpt-6-astra',reasoningEffort:'max',settingsVerified:true,launchPolicyVerified:true,shellWillRemain:true,resumeOptions:[],
    busy:false,queueEmpty:true,pendingReceiptsResolved:true,draft:{text:'Unsent long draft 🌿\n'+('word '.repeat(400)),verified:true,provenance:'unchanged-native-paste'},images:[],status:{email:emails[0]}};
  source.draft.hash=hash(source.draft.text);let observed=structuredClone(source),allow=true,working=false,stopped=false,workerTask;
  const effects=[],savedAccounts=[];
  const usage={freshReading:async()=>({accountKey:observed.accountKey}),snapshot:async()=>({accountKey:observed.accountKey})};
  const accounts=new CodexAccounts({root,usage});
  for(const [n,email] of emails.entries())savedAccounts.push((await accounts.add({email,requestId:'add-'+n,expectedRevision:n})).account);
  let currentTarget;
  const profiles={identities:async()=>identities,
    prepare:async({target})=>{const index=emails.indexOf(target.email);currentTarget={...identities[index],authorizationHome:'/profile/'+index,
      accountVerified:true,configurationVerified:true,configurationHash:hash('same config'),layoutFingerprint:hash('same work')};
      return {state:'verified',email:target.email,accountKey:currentTarget.accountKey,method:'chatgpt',workspaceVerified:true};},
    target:async()=>currentTarget,
    verify:async()=>({accountKey:currentTarget.accountKey,freshUsage:true})};
  const runtime={state:{paused:false}};
  const inventory=async()=>({complete:true,consumers:[{...observed,id:'fixture-tab',kind:'terminal_codex',reason:'',busy:working,
    draft:{state:'requires_verified_capture',recoverable:false},pendingReceipts:[],accountVerified:false,recoverable:false}]});
  const adapter=new CodexAccountSwitchAdapter({root,accounts,runtime,inventory,profiles,sharedDriver:{},verifyPending:async()=>allow,verifyManaged:async()=>true});
  // This test covers mailbox/global state integration; profile layout and
  // selected-launch routing have independent filesystem-backed tests.
  adapter.capabilities.selectedRuntimeRouting=false;accounts.adapter=adapter;accounts.inspectConsumers=args=>adapter.inspect(args);
  const timer=setInterval(()=>{
    if(stopped||workerTask)return;
    workerTask=(async()=>{
      const {job}=await adapter.transport.poll({workerId:'fixture-native-worker'});if(!job)return;
      await adapter.transport.prepare({id:job.id,workerId:job.workerId,dispatchId:job.dispatchId});let result;
      if(['observe','status'].includes(job.action))result=structuredClone(observed);
      else if(job.action==='stop'){effects.push('stop');observed={...observed,kind:'shell',draft:{text:'',hash:hash(''),verified:true}};result={};}
      else if(job.action==='launch'){effects.push('launch');observed={...structuredClone(source),pid:observed.pid+1,
        processIdentity:'process-'+job.id,launchRequestId:job.id,authorizationHome:job.args.target.authorizationHome,
        accountKey:job.args.target.accountKey,status:{email:currentTarget.email},draft:{text:'',hash:hash(''),verified:true}};result=structuredClone(observed);}
      else if(job.action==='draft'){effects.push('draft');observed.draft={...source.draft,text:job.args.text,hash:hash(job.args.text)};result=structuredClone(observed);}
      else assert.fail(job.action);
      await adapter.transport.complete({id:job.id,workerId:job.workerId,dispatchId:job.dispatchId,result});
    })().finally(()=>{workerTask=null;});workerTask.catch(error=>{stopped=true;effects.push('worker-error:'+error.message);});
  },2);
  t.after(async()=>{stopped=true;clearInterval(timer);await workerTask;await fs.rm(root,{recursive:true,force:true});});
  return {root,accounts,adapter,source,savedAccounts,identities,effects,runtime,observed:()=>observed,setBusy:v=>{working=v;},setAllowed:v=>{allow=v;}};
}
test('combined controller switches three saved identities through one-use native mailbox and preserves an unsent Unicode draft',async t=>{
  const f=await fixture(t);
  for(const n of [1,2,0]){
    const args={accountId:f.savedAccounts[n].id,requestId:'switch-'+n,expectedRevision:(await f.accounts.snapshot()).revision,confirmed:true};
    await f.accounts.request(args);await f.accounts.advance();
    const state=await f.accounts.snapshot();assert.equal(state.activeOperation.status,'completed',state.activeOperation.reason);
    assert.equal(f.observed().accountKey,f.identities[n].accountKey);assert.deepEqual(f.observed().draft,f.source.draft);
    assert.equal(f.observed().sessionId,f.source.sessionId);assert.equal(f.observed().acceptedTurnsHash,f.source.acceptedTurnsHash);
    const count=f.effects.length;await f.accounts.request(args);await f.accounts.advance();assert.equal(f.effects.length,count);
  }
  assert.deepEqual(f.effects,['stop','launch','draft','stop','launch','draft','stop','launch','draft']);
  assert.equal((await f.accounts.admission()).allowed,true);
});
test('busy work and paused user control prevent native capture/transition; cancellation keeps original owner',async t=>{
  const f=await fixture(t);f.setBusy(true);
  await f.accounts.request({accountId:f.savedAccounts[1].id,requestId:'wait',expectedRevision:3,confirmed:true});await f.accounts.advance();
  assert.equal((await f.accounts.snapshot()).activeOperation.status,'waiting');assert.deepEqual(f.effects,[]);
  await f.accounts.control('accounts.cancel',{operationId:'wait',requestId:'cancel-wait'});await f.accounts.advance();
  assert.equal((await f.accounts.admission()).allowed,true);assert.equal(f.observed().processIdentity,f.source.processIdentity);
});
test('retained old errors never make live working agents eligible for transition',async t=>{
  const f=await fixture(t);f.setBusy(true);
  f.accounts.readWork=async()=>({complete:true,jobs:[{id:'past-uncertain',action:'terminal.queue',fingerprint:'original',
    status:'retained_attention',originalStatus:'attention',retained:true}]});
  await f.accounts.request({accountId:f.savedAccounts[1].id,requestId:'wait',expectedRevision:3,confirmed:true});await f.accounts.advance();
  assert.equal((await f.accounts.snapshot()).activeOperation.status,'waiting');assert.deepEqual(f.effects,[]);
  f.setBusy(false);await f.accounts.advance();const operation=(await f.accounts.snapshot()).activeOperation;
  assert.equal(operation.status,'completed');assert.equal(operation.retainedReceipts[0].id,'past-uncertain');assert.equal(operation.retainedReceipts[0].status,'attention');
});
