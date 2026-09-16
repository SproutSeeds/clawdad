import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CodexAccountTerminalHandoff,validateAccountHandoffCapture} from '../lib/codex-account-terminal-handoff.mjs';

const hash=text=>createHash('sha256').update(text).digest('hex');
const draft=text=>({text,hash:hash(text),verified:true,provenance:text.length>1024?'unchanged-native-paste':'rendered-composer'});
async function fixture(t,{text='Retain this draft 🌿\nsecond line',onStep}={}){
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-handoff-')),root=await fs.realpath(temporary);
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source={kind:'agent',pid:42,processIdentity:'source-process',shellIdentity:'persistent-shell',tty:'/dev/ttys999',tabLifetime:hash('tab'),
    windowIdentity:hash('window'),sessionId:'00000000-0000-4000-8000-000000000001',directory:'/fixture/project',authorizationHome:'/fixture/account-A',
    executable:'/fixture/codex',acceptedTurnsHash:hash('one previously accepted exact turn'),accountKey:'account-A',accountVerified:true,
    model:'gpt-6-astra',reasoningEffort:'max',settingsVerified:true,launchPolicyVerified:true,shellWillRemain:true,resumeOptions:['-c','features.code_mode_host=true'],
    busy:false,queueEmpty:true,pendingReceiptsResolved:true,draft:draft(text),images:[]};
  const target={accountKey:'account-B',authorizationHome:'/fixture/account-B',accountVerified:true,configurationVerified:true,
    layoutFingerprint:hash('verified-layout'),configurationHash:hash('verified-config')};
  let observed=structuredClone(source);const effects=[],receipts=new Map();
  const driver={
    observe:async()=>structuredClone(observed),permit:async()=>{},verifyOwnership:async({requestId})=>receipts.get(requestId)==='launch',
    reconcile:async({requestId})=>({requestId,state:receipts.has(requestId)?'dispatched':'not_dispatched',durable:true}),
    stopIdle:async({requestId})=>{effects.push('stop');receipts.set(requestId,'stop');observed={...source,kind:'shell',draft:draft('')};return {state:'exited'};},
    resumeExact:async({requestId})=>{effects.push('launch');receipts.set(requestId,'launch');observed={...source,pid:52,processIdentity:'destination-process',
      authorizationHome:target.authorizationHome,accountKey:target.accountKey,draft:draft('')};return {state:'started'};},
    restoreDraft:async({requestId})=>{effects.push('draft');receipts.set(requestId,'draft');observed.draft=structuredClone(source.draft);return {state:'inserted'};},
  };
  const options={root,driver,onStep},handoff=new CodexAccountTerminalHandoff(options),args={operationId:'switch-A-B',requestId:'click-one',source,target,confirmed:true};
  return {root,source,target,driver,effects,receipts,options,handoff,args,get observed(){return observed;},set observed(value){observed=value;}};
}
test('same-tab handoff preserves exact history, settings and unsent Unicode text without submitting or creating a tab',async t=>{
  const f=await fixture(t),before=structuredClone(f.source),result=await f.handoff.run(f.args);
  assert.equal(result.phase,'verified');assert.deepEqual(f.effects,['stop','launch','draft']);
  assert.equal(f.observed.tty,before.tty);assert.equal(f.observed.windowIdentity,before.windowIdentity);assert.equal(f.observed.sessionId,before.sessionId);
  assert.equal(f.observed.acceptedTurnsHash,before.acceptedTurnsHash);assert.equal(f.observed.reasoningEffort,'max');assert.deepEqual(f.observed.draft,before.draft);
  const recovered=await new CodexAccountTerminalHandoff(f.options).inspect(f.source);assert.deepEqual(recovered.source,before);
  assert.equal((await fs.stat(await f.handoff.location(f.source))).mode&0o777,0o600);
});
test('concurrent clicks, same request retries and a restarted controller converge on one set of native effects',async t=>{
  const f=await fixture(t),other=new CodexAccountTerminalHandoff(f.options);
  const results=await Promise.all([f.handoff.run(f.args),other.run({...f.args,requestId:'click-two'})]);
  assert.ok(results.every(r=>r.phase==='verified'));assert.deepEqual(f.effects,['stop','launch','draft']);
  assert.equal((await other.run(f.args)).phase,'verified');assert.equal(f.effects.length,3);
});
test('crashes after each native effect reconcile observed state and exact native ownership without repeating effects',async t=>{
  for(const stop of ['dispatched:stop','dispatched:launch','dispatched:draft']){
    let failed=false;const f=await fixture(t,{onStep:async stage=>{if(stage===stop&&!failed){failed=true;throw Error('simulated process exit');}}});
    await assert.rejects(f.handoff.run(f.args),/simulated process exit/);
    const recovered=new CodexAccountTerminalHandoff({...f.options,onStep:async()=>{}});
    assert.equal((await recovered.run(f.args)).phase,'verified');assert.deepEqual(f.effects,['stop','launch','draft']);
  }
});
test('a saved intent may dispatch after recovery only with exact durable not-dispatched proof',async t=>{
  let failed=false;const f=await fixture(t,{onStep:async stage=>{if(stage==='prepared:stop'&&!failed){failed=true;throw Error('crash before native action');}}});
  await assert.rejects(f.handoff.run(f.args),/crash before/);assert.deepEqual(f.effects,[]);
  f.driver.reconcile=async()=>({state:'not_dispatched',durable:true,requestId:'wrong'});
  const resumed=new CodexAccountTerminalHandoff({...f.options,onStep:async()=>{}});
  await assert.rejects(resumed.run(f.args),{code:'handoff_delivery_uncertain'});assert.deepEqual(f.effects,[]);
  f.driver.reconcile=async({requestId})=>({state:'not_dispatched',durable:true,requestId});
  assert.equal((await resumed.run(f.args)).phase,'verified');assert.deepEqual(f.effects,['stop','launch','draft']);
});
test('lost stop or launch acknowledgement cannot cause repeated stop or a second owner',async t=>{
  for(const effect of ['stopIdle','resumeExact']){
    const f=await fixture(t);let calls=0;
    f.driver[effect]=async({requestId})=>{calls++;f.receipts.set(requestId,'uncertain');throw Error('lost native acknowledgement');};
    await assert.rejects(f.handoff.run(f.args),/lost native acknowledgement/);
    await assert.rejects(new CodexAccountTerminalHandoff(f.options).run(f.args),{code:'handoff_delivery_uncertain'});assert.equal(calls,1);
  }
});
test('busy turns, accepted queues, uncertain receipts, attachments and unknown collapsed text remain intact',async t=>{
  const f=await fixture(t);
  for(const change of [{busy:true},{queueEmpty:false},{pendingReceiptsResolved:false}]){
    await assert.rejects(f.handoff.run({...f.args,source:{...f.source,...change}}),{code:'handoff_work_pending'});
  }
  for(const change of [{images:[{path:'/fixture/image.png'}]},{draft:{...f.source.draft,provenance:'collapsed-length'}},{draft:{...f.source.draft,hash:hash('wrong')}}]){
    assert.throws(()=>validateAccountHandoffCapture({...f.source,...change}),{code:'handoff_input_not_recoverable'});
  }
  assert.deepEqual(f.effects,[]);assert.deepEqual(f.observed.draft,f.source.draft);
});
test('source manual edits, changed thread in the same directory and new tab lifetime never select a substitute',async t=>{
  for(const [change,code] of [[{draft:draft('user correction')},'handoff_source_changed'],[{sessionId:'00000000-0000-4000-8000-000000000002'},'handoff_history_changed'],
    [{acceptedTurnsHash:hash('new accepted turn')},'handoff_history_changed'],[{tabLifetime:hash('new tab')},'handoff_tab_changed']]){
    const f=await fixture(t);f.observed={...f.observed,...change};await assert.rejects(f.handoff.run(f.args),{code});assert.deepEqual(f.effects,[]);
  }
});
test('wrong destination account or settings, new drafts and an independently created matching owner block restoration',async t=>{
  for(const [change,code] of [[{accountKey:'account-C'},'handoff_destination_unverified'],[{reasoningEffort:'low'},'handoff_destination_unverified'],
    [{draft:draft('new user draft')},'handoff_new_draft'],[{busy:true},'handoff_destination_working']]){
    const f=await fixture(t),resume=f.driver.resumeExact;f.driver.resumeExact=async args=>{await resume(args);f.observed={...f.observed,...change};};
    await assert.rejects(f.handoff.run(f.args),{code});assert.deepEqual(f.effects,['stop','launch']);
  }
  const f=await fixture(t);f.observed={...f.observed,pid:99,processIdentity:'independent-owner',authorizationHome:f.target.authorizationHome,accountKey:f.target.accountKey,draft:draft('')};
  await assert.rejects(f.handoff.run(f.args),{code:'handoff_destination_owner_uncertain'});assert.deepEqual(f.effects,[]);
});
test('empty and long exactly retained drafts survive while an already selected account needs no restart',async t=>{
  for(const text of ['',('unicode 🌿\n').repeat(700)]){
    const f=await fixture(t,{text});assert.equal((await f.handoff.run(f.args)).phase,'verified');assert.equal(f.observed.draft.text,text);
    assert.deepEqual(f.effects,text?['stop','launch','draft']:['stop','launch']);
  }
  const f=await fixture(t),target={...f.target,accountKey:f.source.accountKey,authorizationHome:f.source.authorizationHome};
  const result=await f.handoff.run({...f.args,target});assert.equal(result.alreadySelected,true);assert.deepEqual(f.effects,[]);
});
test('an already verified destination account in the original CLI home preserves its process and repeats without a restart',async t=>{
  const f=await fixture(t),args={...f.args,target:{...f.target,accountKey:f.source.accountKey}};
  assert.notEqual(args.source.authorizationHome,args.target.authorizationHome);
  assert.equal((await f.handoff.run(args)).alreadySelected,true);
  assert.equal((await new CodexAccountTerminalHandoff(f.options).run(args)).phase,'verified');
  assert.deepEqual(f.effects,[]);assert.equal(f.observed.processIdentity,f.source.processIdentity);
});
test('turning control off at the final native permit preserves current stage and blocks new effects',async t=>{
  const f=await fixture(t);f.driver.permit=async({effect})=>{if(effect==='launch')throw Object.assign(Error('user paused switching'),{code:'control_paused'});};
  await assert.rejects(f.handoff.run(f.args),{code:'control_paused'});assert.deepEqual(f.effects,['stop']);
  assert.equal((await f.handoff.inspect(f.source)).source.draft.text,f.source.draft.text);
});
test('a deliberate switch back archives the completed forward transition without overwriting its recovery',async t=>{
  const f=await fixture(t);await f.handoff.run(f.args);
  const oldFile=await f.handoff.location(f.source),original=await fs.readFile(oldFile,'utf8');
  const source={...f.observed},target={...f.target,accountKey:'account-A',authorizationHome:'/fixture/account-A'};
  // The back transition remains a separate reviewed source/configuration.
  f.driver.stopIdle=async({requestId})=>{f.effects.push('stop-back');f.receipts.set(requestId,'stop');f.observed={...source,kind:'shell',draft:draft('')};};
  f.driver.resumeExact=async({requestId})=>{f.effects.push('launch-back');f.receipts.set(requestId,'launch');f.observed={...source,pid:62,processIdentity:'back-process',accountKey:'account-A',authorizationHome:target.authorizationHome,draft:draft('')};};
  f.driver.restoreDraft=async()=>{f.effects.push('draft-back');f.observed.draft=source.draft;};
  assert.equal((await f.handoff.run({operationId:'switch-B-A',requestId:'back',source,target,confirmed:true})).phase,'verified');
  assert.equal(await fs.readFile(oldFile+'.switch-A-B.json','utf8'),original);
  assert.equal(f.observed.sessionId,source.sessionId);assert.equal(f.observed.draft.text,source.draft.text);
});
