import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AssistantModelSettings,legacyAssistantModel,legacyResearchModel} from '../lib/assistant-model-settings.mjs';

const models=[{model:'gpt-6-astra',supportedReasoningEfforts:['low','medium','high'],inputModalities:['text','image']},
  {model:'other',supportedReasoningEfforts:['low','high'],inputModalities:['text']}];
const threads=[{id:'one',name:'Research',sessionId:'session-one',status:'paused',configured:true},
  {id:'two',name:'Research',sessionId:'session-two',status:'off',configured:true}];
async function fixture(t,legacyMain){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'assistant-models-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let catalog={authenticated:true,models:structuredClone(models)},now=1;
  const options={file:path.join(root,'settings.json'),readCatalog:async()=>catalog,legacyMain,clock:()=>now};
  return {root,options,settings:new AssistantModelSettings(options),catalog:value=>{catalog=value;now+=20_000;}};
}
test('migration preserves actual main configuration and research legacy default, without changing stopped supervisors',async t=>{
  const f=await fixture(t,async()=>({model:'other',reasoningEffort:'high'}));
  const before=structuredClone(threads),s=await f.settings.snapshot(threads);
  assert.equal(s.main.model,'other');assert.equal(s.main.reasoningEffort,'high');
  assert.deepEqual(s.researchDefault,{...legacyResearchModel,available:true});
  assert.ok(s.supervisors.every(t=>t.inherited));assert.deepEqual(threads,before);
  assert.equal((await fs.stat(f.options.file)).mode&0o777,0o600);
});
test('defaults, exact supervisor overrides, inheritance and receipts survive restart',async t=>{
  const f=await fixture(t);await f.settings.snapshot();
  const update={scope:'researchDefault',selection:{model:'other',reasoningEffort:'high'},expectedRevision:0};
  await f.settings.update(update,'default',threads);
  await f.settings.update({scope:'supervisor',threadId:'one',selection:legacyResearchModel,expectedRevision:1},'override',threads);
  const restored=new AssistantModelSettings(f.options);
  assert.equal((await restored.resolve('research','one')).model,'gpt-6-astra');
  assert.equal((await restored.resolve('research','two')).model,'other');
  const duplicate=await restored.update(update,'default',threads);assert.equal(duplicate.settings.revision,2);
  await restored.update({scope:'supervisor',threadId:'one',inherit:true,expectedRevision:2},'inherit',threads);
  assert.equal((await restored.resolve('research','one')).inherited,true);
  assert.equal((await restored.resolve('research','one')).model,'other');
  assert.deepEqual((await restored.snapshot()).main,{...legacyAssistantModel,available:true});
});
test('invalid, unavailable, unauthenticated and stale choices never substitute or save',async t=>{
  const f=await fixture(t);await f.settings.snapshot();
  for(const selection of [{model:'missing',reasoningEffort:'low'},{model:'other',reasoningEffort:'medium'}])
    await assert.rejects(f.settings.update({scope:'main',selection,expectedRevision:0},JSON.stringify(selection)),/unavailable/);
  await assert.rejects(f.settings.update({scope:'supervisor',threadId:'missing',selection:legacyAssistantModel,expectedRevision:0},'wrong',threads),/no longer available/);
  await assert.rejects(f.settings.update({scope:'main',selection:legacyAssistantModel,expectedRevision:99},'stale'),/changed elsewhere/);
  f.catalog({authenticated:false,models});await assert.rejects(f.settings.resolve('main'),/sign-in/);
  const s=await f.settings.snapshot();assert.equal(s.main.model,'gpt-6-astra');assert.equal(s.main.available,false);assert.equal(s.revision,0);
  f.catalog({authenticated:true,models:models.slice(1)});await assert.rejects(f.settings.resolve('main'),/unavailable/);
});
test('in-flight request snapshot stays immutable and future image turns validate modality',async t=>{
  const f=await fixture(t),active=await f.settings.resolve('main');
  await f.settings.update({scope:'main',selection:{model:'other',reasoningEffort:'high'},expectedRevision:0},'new');
  assert.equal(active.model,'gpt-6-astra');assert.equal(active.reasoningEffort,'low');
  assert.equal((await f.settings.resolve('main')).model,'other');
  await assert.rejects(f.settings.resolve('main',null,{images:true}),/cannot inspect images/);
});
test('concurrent saves serialize; reused IDs cannot change intent; failed disk writes roll back',async t=>{
  const f=await fixture(t);await f.settings.snapshot();
  const a={scope:'main',selection:legacyAssistantModel,expectedRevision:0};
  const results=await Promise.all([f.settings.update(a,'same'),f.settings.update(a,'same')]);
  assert.equal(results[0].receipt.revision,results[1].receipt.revision);
  await assert.rejects(f.settings.update({...a,selection:legacyResearchModel},'same'),/already used/);
  f.settings.save=async()=>{throw Error('disk unavailable');};
  await assert.rejects(f.settings.update({...a,selection:legacyResearchModel,expectedRevision:1},'disk'),/disk unavailable/);
  assert.equal((await f.settings.resolve('main')).reasoningEffort,'low');
  assert.equal((await f.settings.snapshot()).revision,1);
});
test('malformed settings remain unavailable on repeated reads rather than silently resetting',async t=>{
  const f=await fixture(t);await fs.writeFile(f.options.file,JSON.stringify({version:99,main:legacyAssistantModel}));
  await assert.rejects(f.settings.resolve('main'),/need repair/);
  await assert.rejects(f.settings.resolve('main'),/need repair/);
});
test('failed initial persistence must succeed before settings become usable',async t=>{
  const f=await fixture(t),save=f.settings.save.bind(f.settings);let writes=0;
  f.settings.save=async()=>{writes++;if(writes===1)throw Error('disk unavailable');await save();};
  await assert.rejects(f.settings.resolve('main'),/disk unavailable/);
  assert.equal((await f.settings.resolve('main')).model,legacyAssistantModel.model);
  assert.equal(writes,2);assert.equal(JSON.parse(await fs.readFile(f.options.file,'utf8')).version,1);
});
