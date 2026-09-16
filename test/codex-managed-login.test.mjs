import test from 'node:test';
import assert from 'node:assert/strict';
import {CodexManagedLogin} from '../lib/codex-managed-login.mjs';

function fixture({device=false,wrong=false,early=false,accountReadyTimeoutMs=50}={}) {
  let observer,started,release;const messages=[],handed=[];
  const ready=new Promise(r=>release=r);
  const adapter=new CodexManagedLogin({isolated:true,accountReadyTimeoutMs,subscribe:f=>{observer=f;return()=>observer=null;},
    handoff:async v=>{handed.push(v);release();},rpc:async(method,args)=>{
      messages.push({method,args});
      if(method==='account/login/start') {
        started=true;if(early)queueMicrotask(()=>{observer({method:'account/login/completed',params:{loginId:'ours',success:true}});observer({method:'account/updated',params:{authMode:'chatgpt'}});});
        return {type:device?'chatgptDeviceCode':'chatgpt',loginId:'ours',authUrl:'https://auth.openai.com/auth?state=PRIVATE',verificationUrl:'https://auth.openai.com/codex/device',userCode:'PRIVATE_CODE'};
      }
      if(method==='account/read')return {account:{type:'chatgpt',email:wrong?'wrong@example.test':'selected@example.test',planType:'pro'}};
      if(method==='account/rateLimits/read')return {accountId:'fixture',ordinaryUsageAllowed:false,rateLimits:{limitId:'codex',primary:{windowDurationMins:10080,usedPercent:100,resetsAt:2000000000}}};
      return {};
    }});
  return {adapter,messages,handed,ready,emit:(params,{updated=true}={})=>{observer?.({method:'account/login/completed',params});if(updated&&params.success)observer?.({method:'account/updated',params:{authMode:'chatgpt'}});},updated:()=>observer?.({method:'account/updated',params:{authMode:'chatgpt'}}),started:()=>started};
}
test('managed browser and device login verify exact identity at zero allowance without tokens or model work',async()=>{
  for(const device of [false,true]) {
    const f=fixture({device}),args={requestId:'one',email:'selected@example.test',method:device?'chatgptDeviceCode':'chatgpt',confirmed:true};
    const pending=f.adapter.start(args);assert.equal(f.adapter.start(args),pending);await f.ready;
    f.emit({loginId:'foreign',success:true});assert.equal(f.messages.filter(r=>r.method==='account/read').length,0);
    f.emit({loginId:'ours',success:true});const receipt=await pending;
    assert.deepEqual(await f.adapter.start(args),receipt);
    assert.equal(receipt.remainingPercent,0);assert.equal(receipt.ordinaryUsageAllowed,false);assert.equal(receipt.status,'verified');
    assert.equal(f.messages.filter(r=>r.method==='account/login/start').length,1);
    assert.equal(f.handed[0].userCode,device?'PRIVATE_CODE':null);
    assert.ok(!JSON.stringify([receipt,f.adapter.snapshot()]).includes('PRIVATE'));
    assert.ok(f.messages.every(r=>['account/login/start','account/read','account/rateLimits/read'].includes(r.method)));
  }
});
test('early callbacks are retained; wrong account and disconnected login remain recoverable',async()=>{
  const early=fixture({early:true});assert.equal((await early.adapter.start({requestId:'early',email:'selected@example.test',confirmed:true})).status,'verified');
  for(const wrong of [false,true]) {
    const f=fixture({wrong}),pending=f.adapter.start({requestId:'failure',email:'selected@example.test',confirmed:true});await f.ready;
    if(wrong)f.emit({loginId:'ours',success:true});else f.adapter.disconnected();
    await assert.rejects(pending,/needs attention/);assert.equal(f.adapter.snapshot().status,'needs_attention');
  }
});
test('cancellation and unsupported methods never log out an existing account',async()=>{
  const f=fixture();await assert.rejects(f.adapter.start({requestId:'bad',email:'selected@example.test',method:'apiKey',confirmed:true}),/isolated subscription/);
  assert.equal(f.started(),undefined);
  const pending=f.adapter.start({requestId:'cancel',email:'selected@example.test',confirmed:true});await f.ready;
  assert.equal((await f.adapter.cancel()).status,'cancelled_needs_identity_check');await assert.rejects(pending,/needs attention/);
  assert.ok(!f.messages.some(r=>r.method==='account/logout'));
});
test('a successful callback waits for account reload before exact identity verification',async()=>{
  const f=fixture({accountReadyTimeoutMs:1000}),pending=f.adapter.start({requestId:'reload',email:'selected@example.test',confirmed:true});await f.ready;
  f.updated(); // An older update must not authorize reads after this completion.
  f.emit({loginId:'ours',success:true},{updated:false});
  await new Promise(r=>setImmediate(r));
  assert.equal(f.adapter.snapshot().status,'verifying');assert.equal(f.messages.filter(m=>m.method==='account/read').length,0);
  f.updated();assert.equal((await pending).status,'verified');
  assert.equal(f.messages.filter(m=>m.method==='account/login/start').length,1);
});
test('missing reload notification and disconnect after completion remain recoverable without another login',async()=>{
  for(const disconnect of [false,true]){
    const f=fixture(),pending=f.adapter.start({requestId:'pending',email:'selected@example.test',confirmed:true});await f.ready;
    f.emit({loginId:'ours',success:true},{updated:false});await new Promise(r=>setImmediate(r));
    if(disconnect)f.adapter.disconnected();
    await assert.rejects(pending,error=>error.code==='account_state_pending');
    assert.equal(f.messages.filter(m=>m.method==='account/read').length,0);
    assert.equal(f.messages.filter(m=>m.method==='account/login/start').length,1);
  }
});
