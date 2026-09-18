import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CodexAppAccountStatus,verifyAppAccountRuntime} from '../lib/codex-app-account-status.mjs';

function fixture(){
  const calls=[];let closed=0,account={type:'chatgpt',email:'actual@example.test',planType:'pro'},home='/app/profile',now=0;
  const limits={accountId:'actual-id',rateLimits:{limitId:'codex',primary:{windowDurationMins:10080,usedPercent:23,resetsAt:2e9}}};
  const reader=new CodexAppAccountStatus({socketPath:'/app/socket',clock:()=>now,createClient:options=>{
    assert.equal(options.socketPath,'/app/socket');return {get info(){return {codexHome:home};},
      request:async(method,args)=>{calls.push({method,args});return method==='account/read'?{account:{...account}}:limits;},close:()=>{closed++;}};
  }});
  return {reader,calls,limits,setAccount:v=>{account=v;},setHome:v=>{home=v;},tick:()=>{now+=2000;},closed:()=>closed};
}
test('active identity and allowance come from the same running server, with bounded caching',async()=>{
  const f=fixture(),value=await f.reader.read();
  assert.equal(value.email,'actual@example.test');assert.equal(value.authorizationHome,'/app/profile');assert.equal(value.usage.remainingPercent,77);
  assert.deepEqual(f.calls.map(c=>c.method),['account/read','account/rateLimits/read','account/read']);
  assert.ok(f.calls.filter(c=>c.method==='account/read').every(c=>c.args.refreshToken===false));
  value.email='changed';assert.equal((await f.reader.read()).email,'actual@example.test');assert.equal(f.calls.length,3);
  f.tick();f.setAccount({type:'chatgpt',email:'next@example.test',planType:'pro'});
  assert.equal((await f.reader.read()).email,'next@example.test');assert.equal(f.closed(),2);
});
test('runtime reuse requires both the selected authorization home and actual subscription identity',async()=>{
  const f=fixture(),launch={env:{CODEX_HOME:'/app/profile'},account:{key:createHash('sha256').update('codex-account:actual-id').digest('hex')}};
  await verifyAppAccountRuntime({reader:f.reader,launch});
  f.setHome('/terminal/default');await assert.rejects(verifyAppAccountRuntime({reader:f.reader,launch}),{code:'app_account_mismatch'});
  f.setHome('/app/profile');f.limits.accountId='different-workspace';await assert.rejects(verifyAppAccountRuntime({reader:f.reader,launch}),{code:'app_account_mismatch'});
});
test('a failed observation never replaces active identity with a saved preview',async()=>{
  const f=fixture();await f.reader.read();f.reader.invalidate();f.setAccount({type:'apiKey'});
  await assert.rejects(f.reader.read(),/activate/);assert.equal(f.closed(),2);
});
test('an expired allowance keeps the running server email explicit without claiming verified subscription access',async()=>{
  const account={type:'chatgpt',email:'expired@example.test',planType:'pro'};
  const reader=new CodexAppAccountStatus({createClient:()=>({info:{codexHome:'/old/home'},close(){},
    request:async method=>{if(method==='account/read')return {account};throw Error('401 Unauthorized token_revoked');}})});
  const value=await reader.read();assert.equal(value.email,account.email);assert.equal(value.status,'needs_check');assert.equal(value.accountKey,null);assert.equal(value.usage,null);
});
