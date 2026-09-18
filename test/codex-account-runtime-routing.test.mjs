import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {accountRouteForLegacyRequest,ensureAccountSharedRuntime} from '../lib/codex-account-runtime-routing.mjs';
import {researchSave} from '../lib/research-budget.mjs';

test('native project workers verify their exact accepted receipt and selected account before launching',async t=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-project-account-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'ProjectWork'),{mode:0o700});
  const receipt={version:1,id:'request',action:'legacy.dispatch',projectPath:'/fixture/project',fingerprint:'exact-request',accountEpoch:2};
  await researchSave(path.join(root,'ProjectWork/request.json'),receipt);const checks=[],launch={account:{id:'third'}};
  const accounts={root,assertAdmission:async()=>{checks.push('new');},assertDelivery:async value=>{checks.push(value);},selectedLaunch:async()=>launch};
  const route=await accountRouteForLegacyRequest({accounts,requestId:'request',projectPath:'/fixture/project'});
  assert.deepEqual(checks,[receipt]);assert.equal(route.launch,launch);
  await assert.rejects(accountRouteForLegacyRequest({accounts,requestId:'request',projectPath:'/wrong'}),/no longer matches/);
  accounts.assertDelivery=async()=>{throw Error('old epoch');};await assert.rejects(accountRouteForLegacyRequest({accounts,requestId:'request',projectPath:'/fixture/project'}),/old epoch/);
});
test('shared startup uses selected routing; a transition hold permits existing health without creating or upgrading a process',async()=>{
  let gate={allowed:true},starts=0,checks=0;const launch={env:{CODEX_HOME:'/third'},configArgs:[]},options={socketPath:'/fixture/socket',env:{HOME:'/user'}};
  const accounts={admission:async()=>gate,selectedLaunch:async()=>launch,assertDelivery:async()=>{checks++;}};
  const extra={accounts,verify:async()=>{},exclusive:async(_path,fn)=>fn(),status:async()=>({ready:true,mode:'shared'}),ensure:async value=>{starts++;assert.equal(value.accountLaunch,launch);assert.equal(value.env,launch.env);return {ready:true};}};
  await ensureAccountSharedRuntime(options,extra);assert.equal(starts,1);
  gate={allowed:false,phase:'preflight'};await ensureAccountSharedRuntime(options,{...extra,receipt:{id:'accepted'}});assert.equal(checks,1);assert.equal(starts,1);
  gate={allowed:false,phase:'transition',reason:'switching'};await assert.rejects(ensureAccountSharedRuntime(options,extra),{code:'account_switch_pending'});assert.equal(starts,1);
});

test('an unselected native startup never launches a server using Terminal credentials',async()=>{
  let launches=0;
  await assert.rejects(ensureAccountSharedRuntime({socketPath:'/fixture/socket'}, {
    accounts:{admission:async()=>({allowed:false,phase:'unselected',reasonCode:'app_account_required',reason:'Activate an app account.'})},
    exclusive:async(_path,fn)=>fn(),status:async()=>({ready:true}),ensure:async()=>{launches++;}
  }),{code:'app_account_required'});
  assert.equal(launches,0);
});
