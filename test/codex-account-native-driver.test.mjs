import test from 'node:test';
import assert from 'node:assert/strict';
import {CodexAccountNativeDriver} from '../lib/codex-account-native-driver.mjs';

const source={kind:'agent',processIdentity:'old',tty:'/dev/ttys999',sessionId:'exact-thread',directory:'/fixture/project',tabLifetime:'exact-life',draft:{text:'keep',hash:'draft'},settingsVerified:true,status:{email:'cody@example.test'}};
const identity={email:'cody@example.test',accountKey:'account-a',method:'chatgpt',verified:true};
const target={authorizationHome:'/fixture/b'};
test('native driver keeps cached live account separate from authorization home and rejects ambiguous workspace attribution',()=>{
  const driver=new CodexAccountNativeDriver({identities:[identity]});
  assert.equal(driver.identity({...source,authorizationHome:'/different-profile'}).accountKey,'account-a');
  assert.throws(()=>driver.identity({...source,status:{email:'another@example.test'}}),{code:'cached_account_identity_ambiguous'});
  assert.throws(()=>new CodexAccountNativeDriver({identities:[identity,{...identity,accountKey:'workspace-b'}]}).identity(source),{code:'cached_account_identity_ambiguous'});
});
test('an independently launched same-directory session never receives local status keys',async()=>{
  const actions=[];const driver=new CodexAccountNativeDriver({identities:[identity],transport:{inspect:async()=>null},verifyPending:async()=>true});
  driver.call=async(_,action)=>{actions.push(action);return {...source,processIdentity:'new',settingsVerified:false,authorizationHome:target.authorizationHome};};
  await assert.rejects(driver.observe({operationId:'switch',source,target}),{code:'handoff_owner_unverified'});
  assert.deepEqual(actions,['observe']);
});
test('native ownership requires the exact launch receipt, target profile, session and tab lifetime',async()=>{
  let receipt={operationId:'switch',action:'launch',preparedAt:'now',args:{source,target}};
  const driver=new CodexAccountNativeDriver({transport:{inspect:async()=>receipt}}),observed={...source,processIdentity:'new',launchRequestId:'launch-id'};
  const args={operationId:'switch',requestId:'launch-id',source,target,observed};
  assert.equal(await driver.verifyOwnership(args),true);
  for(const changed of [{...receipt,operationId:'other'},{...receipt,preparedAt:null},{...receipt,result:{processIdentity:'unrelated'}},
    {...receipt,args:{source:{...source,sessionId:'other-thread'},target}}, {...receipt,args:{source,target:{authorizationHome:'/elsewhere'}}}]){
    const prior=receipt;receipt=changed;assert.equal(await driver.verifyOwnership(args),false);receipt=prior;
  }
});
test('busy capture does not clear a draft or execute status; pending receipts remain unresolved',async()=>{
  const actions=[];const driver=new CodexAccountNativeDriver({identities:[identity],verifyPending:async()=>false});
  let busy=true;driver.call=async(_,action)=>{actions.push(action);return {...source,busy,queueEmpty:!busy};};
  await assert.rejects(driver.capture({operationId:'switch',source}),{code:'agent_work_pending'});assert.deepEqual(actions,['observe']);
  busy=false;const result=await driver.capture({operationId:'switch',source});assert.equal(result.pendingReceiptsResolved,false);
  assert.deepEqual(actions,['observe','observe','status']);
});
test('draft recovery checks the actual restored process and preserves any new draft',async()=>{
  const driver=new CodexAccountNativeDriver({transport:{inspect:async()=>null}}),actions=[];
  driver.call=async(_,action)=>{actions.push(action);return {...source,processIdentity:'new',draft:{text:'manually added'}};};
  await assert.rejects(driver.restoreDraft({operationId:'switch',requestId:'draft',source,target,owner:'new'}),{code:'draft_recovery_target_changed'});
  assert.deepEqual(actions,['observe']);
});
