import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CodexAccountSwitchProfiles} from '../lib/codex-account-switch-profiles.mjs';
import {normalizeWeeklyUsage} from '../lib/codex-weekly-usage.mjs';

async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-switch-profile-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const canonicalHome=path.join(root,'canonical'),profileHome=path.join(root,'profile'),storage=path.join(root,'journal');
  for(const directory of [canonicalHome,profileHome,storage])await fs.mkdir(directory,{mode:0o700});
  for(const name of ['sessions','archived_sessions','thread-writer-locks'])await fs.mkdir(path.join(canonicalHome,name),{mode:0o700});
  await fs.writeFile(path.join(canonicalHome,'config.toml'),'model="fixture"\n',{mode:0o600});
  await fs.writeFile(path.join(profileHome,'config.toml'),'old independent profile config\n',{mode:0o600});
  const account={type:'chatgpt',email:'third@example.test',planType:'pro'};
  const limits={accountId:'subscription-third',rateLimits:{limitId:'codex',primary:{windowDurationMins:10080,usedPercent:10,resetsAt:2000000000}}};
  const identity=normalizeWeeklyUsage(limits,{account}),calls=[];
  const profile={accountId:'third',email:account.email,home:profileHome,authentication:'verified',accountKey:identity.accountKey,subscription:{method:'chatgpt'}};
  const authorizations={root,snapshot:async()=>({profiles:[profile]})};
  let permitted=true,active=false,configMismatch=false,models=[{model:'fixture',supportedReasoningEfforts:[{reasoningEffort:'low'}]}];
  const options={root:storage,canonicalHome,binary:'/fixture/codex',authorizations,
    permit:async()=>{if(!permitted)throw Error('paused');},
    runtime:{accountProfileActivity:async home=>({home,complete:true,observedAt:Date.now(),owners:active?[{pid:42}]:[]})},
    createProcess:({home,configurationOnly=false})=>({connect:async()=>{},close(){},async request(method){
      calls.push({home,configurationOnly,method});
      if(method==='config/read'){assert.equal(configurationOnly,true);return {config:{model:configMismatch&&home===profileHome?'changed':'fixture',approval_policy:'never'}};}
      assert.equal(configurationOnly,false);
      if(method==='account/read')return {account};if(method==='account/rateLimits/read')return limits;
      if(method==='model/list')return {data:models,nextCursor:null};
      assert.fail('Unexpected account RPC '+method);
    }})};
  const operation={id:'switch-third',targetId:'third',destinationAccountKey:identity.accountKey,recovery:{entries:[{directory:root,native:{authorizationHome:canonicalHome,model:'fixture',reasoningEffort:'low'}}]}};
  const target={id:'third',email:account.email};
  return {root,canonicalHome,profileHome,storage,profile,identity,calls,options,operation,target,
    setAllowed:v=>{permitted=v;},setActive:v=>{active=v;},setMismatch:v=>{configMismatch=v;},setModels:v=>{models=v;}};
}
test('a third saved account adopts canonical work resources recoverably and survives controller reconstruction',async t=>{
  const f=await fixture(t),controller=new CodexAccountSwitchProfiles(f.options);
  assert.equal((await controller.prepare({operation:f.operation,target:f.target})).state,'verified');
  const next=new CodexAccountSwitchProfiles(f.options),target=await next.target(f.operation);
  assert.equal(target.accountKey,f.identity.accountKey);assert.equal(target.authorizationHome,f.profileHome);
  assert.equal(await fs.realpath(path.join(f.profileHome,'sessions')),path.join(f.canonicalHome,'sessions'));
  assert.equal((await next.verify(f.operation)).freshUsage,true);
  const before=(await fs.readdir(f.storage)).sort();await next.prepare({operation:f.operation,target:f.target});
  assert.deepEqual((await fs.readdir(f.storage)).sort(),before);
  assert.ok(f.calls.every(c=>c.configurationOnly?c.method==='config/read':c.method.startsWith('account/')||c.method==='model/list'));
  assert.equal((await fs.stat(next.file(f.operation.id))).mode&0o777,0o600);
});
test('unavailable destination models or effort stop before profile adoption or owner replacement',async t=>{
  const f=await fixture(t),controller=new CodexAccountSwitchProfiles(f.options);
  f.setModels([]);await assert.rejects(controller.prepare({operation:f.operation,target:f.target}),{code:'account_model_unavailable'});
  f.setModels([{model:'fixture',supportedReasoningEfforts:['max']}]);
  await assert.rejects(controller.prepare({operation:f.operation,target:f.target}),{code:'account_effort_unavailable'});
  assert.equal(await fs.readFile(path.join(f.profileHome,'config.toml'),'utf8'),'old independent profile config\n');
});
test('profile preparation preserves independent source histories, active profiles, and unavailable sign-ins',async t=>{
  const f=await fixture(t),controller=new CodexAccountSwitchProfiles(f.options);
  f.operation.recovery.entries[0].native.authorizationHome=f.profileHome;
  await assert.rejects(controller.prepare({operation:f.operation,target:f.target}));
  assert.equal(await fs.readFile(path.join(f.profileHome,'config.toml'),'utf8'),'old independent profile config\n');
  f.operation.recovery.entries[0].native.authorizationHome=f.canonicalHome;f.setActive(true);
  await assert.rejects(controller.prepare({operation:f.operation,target:f.target}),{code:'profile_in_use'});
  f.profile.authentication='needs_sign_in';assert.deepEqual(await controller.prepare({operation:f.operation,target:f.target}),{state:'waiting'});
});
test('paused authorization, changed project configuration and account attribution block verification',async t=>{
  const f=await fixture(t),controller=new CodexAccountSwitchProfiles(f.options);
  f.setAllowed(false);await assert.rejects(controller.prepare({operation:f.operation,target:f.target}),/paused/);f.setAllowed(true);
  f.setMismatch(true);await assert.rejects(controller.prepare({operation:f.operation,target:f.target}),/configuration differs/);
  await assert.rejects(controller.target(f.operation),/no longer verified/);
  f.setMismatch(false);await controller.prepare({operation:f.operation,target:f.target});
  f.profile.accountKey='a'.repeat(64);await assert.rejects(controller.target(f.operation),/no longer verified/);
});
