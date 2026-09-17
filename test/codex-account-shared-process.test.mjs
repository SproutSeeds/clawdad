import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {CodexAccountSharedProcess} from '../lib/codex-account-shared-process.mjs';

async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-shared-process-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const socketPath=path.join(root,'s'),home=path.join(root,'profile'),canonical=path.join(root,'canonical');
  const calls=[],operationId='switch-test',requestId='b'.repeat(64);let permit=true,loaded=[],foreignSocket=[],failAfterSpawn=false;
  const row=(pid,extra={})=>{const text=`${pid} ${process.getuid()} Wed Sep 16 01:02:03 2026 /fixture/codex`;
    return {pid:String(pid),text,processLifetime:createHash('sha256').update(text.split(' ').join('\0')).digest('hex'),kind:'app_server',
      authorizationHome:canonical,executable:'/fixture/codex',serverOptions:[],alternateAuthentication:false,...extra};};
  let live=row(100);const source={kind:'server',pid:100,processIdentity:live.processLifetime,authorizationHome:canonical,executable:live.executable,serverOptions:[]};
  const target={accountKey:'a'.repeat(64),authorizationHome:home,sqliteHome:canonical};
  const options={root,socketPath,readNative:async()=>({processesComplete:true,processesObservedAt:Date.now(),processes:live?[live]:[]}),
    readOwners:async()=>live?[{pid:Number(live.pid),socket:true,threads:[]}]:[],permit:async()=>{if(!permit)throw Error('paused');},
    exclusive:async fn=>{calls.push('lock');try{return await fn();}finally{calls.push('unlock');}},
    profileGate:async()=>({release:async()=>{calls.push('profile-release');}}),
    execute:async(exe,args)=>{
      if(exe.endsWith('lsof'))return {stdout:foreignSocket.map(pid=>'p'+pid).join('\n')};
      if(failAfterSpawn&&live?.pid==='200'){failAfterSpawn=false;throw Error('simulated lost process observation');}
      return {stdout:live&&args.includes(live.pid)?live.text:''};
    },signal:(pid,name)=>{calls.push({signal:name,pid});assert.equal(pid,Number(live.pid));live=null;},
    spawnProcess:(binary,args,opts)=>{
      calls.push({launch:binary,args,env:opts.env});live=row(200,{authorizationHome:home,accountTransitionId:opts.env.CLAWDAD_ACCOUNT_TRANSITION_ID,
        accountLaunchRequestId:opts.env.CLAWDAD_ACCOUNT_LAUNCH_REQUEST_ID});return Object.assign(new EventEmitter(),{pid:200,unref(){}});
    },createClient:()=>({close(){},async request(method){if(method==='server/diagnostics')return {process:{id:Number(live.pid)}};
      if(method==='thread/loaded/list')return {data:loaded,nextCursor:null};assert.fail(method);}})};
  return {root,source,target,operationId,requestId,calls,options,driver:new CodexAccountSharedProcess(options),
    setPermit:value=>{permit=value;},setLoaded:value=>{loaded=value;},setForeign:value=>{foreignSocket=value;},
    setLive:value=>{live=value;},getLive:()=>live,failSpawn:()=>{failAfterSpawn=true;}};
}
test('empty exact server stops once, launches with selected profile, and verifies its durable marker after reconstruction',async t=>{
  const f=await fixture(t),args={source:f.source,target:f.target,operationId:f.operationId,requestId:f.requestId};
  assert.equal((await f.driver.observe()).processIdentity,f.source.processIdentity);
  await f.driver.stopIdle(args);await f.driver.launch(args);
  const next=new CodexAccountSharedProcess(f.options),observed=await next.observe();
  assert.equal(await next.verifyOwnership({...args,observed}),true);
  assert.equal(await next.verifyOwnership({...args,operationId:'other',observed}),false);
  await assert.rejects(next.launch(args),{code:'shared_launch_uncertain'});
  assert.equal(f.calls.filter(c=>c.signal).length,1);assert.equal(f.calls.filter(c=>c.launch).length,1);
  const launched=f.calls.find(c=>c.launch);assert.equal(launched.env.CODEX_HOME,f.target.authorizationHome);
  assert.equal(launched.env.CLAWDAD_ACCOUNT_LAUNCH_REQUEST_ID,f.requestId);assert.ok(launched.args.includes('app-server'));
});
test('a busy, changed, paused or foreign owner is preserved',async t=>{
  const f=await fixture(t),args={source:f.source,target:f.target,operationId:f.operationId,requestId:f.requestId};
  f.setLoaded(['thread']);await assert.rejects(f.driver.stopIdle(args),{code:'shared_owner_not_empty'});
  f.setLoaded([]);f.setPermit(false);await assert.rejects(f.driver.stopIdle(args),/paused/);f.setPermit(true);
  await assert.rejects(f.driver.stopIdle({...args,source:{...f.source,processIdentity:'changed'}}),{code:'shared_owner_changed'});
  f.setLive(null);f.setForeign([777]);await assert.rejects(f.driver.observe(),{code:'shared_socket_foreign_owner'});
  assert.equal(f.calls.filter(c=>c.signal||c.launch).length,0);
});
test('a lost launch observation reconciles the exact operation marker without respawning or borrowing another process',async t=>{
  const f=await fixture(t),args={source:f.source,target:f.target,operationId:f.operationId,requestId:f.requestId};
  await f.driver.stopIdle(args);f.failSpawn();await assert.rejects(f.driver.launch(args),/lost process observation/);
  const next=new CodexAccountSharedProcess(f.options),observed=await next.observe();
  assert.equal(await next.verifyOwnership({...args,observed}),true);
  assert.equal(await next.verifyOwnership({...args,observed:{...observed,accountLaunchRequestId:'c'.repeat(64)}}),false);
  await assert.rejects(next.launch(args),{code:'shared_launch_uncertain'});assert.equal(f.calls.filter(c=>c.launch).length,1);
});
test('bare ps command retains its lifetime while exact native executable drives recreation',async t=>{
  const f=await fixture(t),live=f.getLive();
  live.text=live.text.replace('/fixture/codex','codex');
  live.processLifetime=createHash('sha256').update(live.text.split(' ').join('\0')).digest('hex');
  live.executable='/fixture/versions/0.154.0/codex';f.setLive(live);
  const source=await f.driver.observe();
  assert.equal(source.processIdentity,await f.driver.exactDigest(source.pid));
  await f.driver.stopIdle({operationId:f.operationId,source});
  // The spawn fixture represents the newly created PID's native executable.
  const spawn=f.options.spawnProcess;f.driver.spawnProcess=(binary,args,opts)=>{
    const result=spawn(binary,args,opts);f.getLive().executable=binary;return result;
  };
  await f.driver.launch({operationId:f.operationId,requestId:f.requestId,source,target:f.target});
  assert.equal(f.calls.find(c=>c.launch).launch,'/fixture/versions/0.154.0/codex');
});
test('launch validation identifies the failed predicate and never stops an uncertain owner',async t=>{
  const f=await fixture(t),original={...f.getLive()};
  for(const [field,value,code] of [
    ['executable','codex','shared_executable_unverified'],['authorizationHome',null,'shared_home_unverified'],
    ['processLifetime',null,'shared_lifetime_unverified'],['serverOptions',null,'shared_options_unverified'],
    ['alternateAuthentication',true,'shared_authentication_route_unverified'],['kind','exec','shared_process_kind_unverified'],
    ['reasonCode','server_executable_unavailable','shared_native_launch_unverified']]){
    f.setLive({...original,[field]:value});await assert.rejects(f.driver.observe(),{code});
  }
  assert.equal(f.calls.filter(c=>c.signal||c.launch).length,0);
});
