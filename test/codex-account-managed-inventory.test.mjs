import test from 'node:test';import assert from 'node:assert/strict';
import {inspectManagedAccountConsumers} from '../lib/codex-account-consumers.mjs';
import {parseAccountProcessTree} from '../lib/codex-account-owner-scope.mjs';
function fixture(){
  const native={complete:true,processesComplete:true,processesObservedAt:1000,
    consumers:[{processId:30,agentInstanceId:'exact-process',tty:'/dev/ttys001',tabId:'tab',windowId:'window',sessionId:'thread',
      directory:'/project',isBusy:false,alternateAuthentication:false}],
    processes:[30,40].map(pid=>({pid,processLifetime:'life-'+pid,authorizationHome:'/canonical',executable:'/codex',alternateAuthentication:false}))};
  const tree=parseAccountProcessTree(['10 1 Wed Sep 16 02:55:07 2026 /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal',
    '30 10 Wed Sep 16 02:55:07 2026 /codex','40 1 Wed Sep 16 02:55:07 2026 /codex',
    '50 1 Wed Sep 16 02:55:07 2026 /Applications/Other.app/Contents/MacOS/Other','51 50 Wed Sep 16 02:55:07 2026 /codex'].join('\n'));
  const owners=[{pid:30,tty:'ttys001',threads:['thread']},{pid:40,tty:'??',socket:true,threads:[]},{pid:51,tty:'??',threads:[]}];
  const runtime={state:{jobs:[{id:'old-error',action:'terminal.queue',status:'attention',args:{tabId:'tab'}}]}};
  const options={readNative:async()=>native,readOwners:async()=>owners,readTree:async()=>tree,clock:()=>1000,readShared:async()=>({complete:true,pid:40,busy:false})};
  return {native,tree,owners,runtime,options,inspect:()=>inspectManagedAccountConsumers(runtime,options)};
}
test('managed inventory uses exact native and socket owners, preserves other apps, and keeps old error receipts separate',async()=>{
  const f=fixture(),value=await f.inspect();assert.equal(value.complete,true);
  assert.deepEqual(value.consumers.map(c=>c.pid),[30,40]);assert.equal(value.excludedApplications[0].pid,51);
  assert.deepEqual(value.consumers[0].pendingReceipts,[]);assert.equal(value.consumers[0].sessionId,'thread');
  f.runtime.state.jobs.push({id:'accepted',status:'working',args:{tabId:'tab'}});
  assert.equal((await f.inspect()).consumers[0].pendingReceipts[0].id,'accepted');
});
test('stale native state, changing process and shared queue state never become a recoverable idle owner',async()=>{
  const f=fixture();f.options.clock=()=>6001;assert.equal((await f.inspect()).complete,false);
  f.options.clock=()=>1000;f.options.readShared=async()=>({complete:true,pid:40,busy:true});
  assert.equal((await f.inspect()).consumers[1].busy,true);
  f.options.readShared=async()=>({complete:true,pid:41,busy:false});assert.equal((await f.inspect()).complete,false);
  f.native.consumers[0].processId=31;assert.equal((await f.inspect()).complete,false);
});
test('fresh sessions and alternate authentication give explicit reasons and remain in inventory',async()=>{
  const f=fixture();f.native.consumers[0].sessionId=null;
  assert.match((await f.inspect()).consumers[0].reason,/no verified resumable/);
  f.native.processes[0].alternateAuthentication=true;
  assert.match((await f.inspect()).consumers[0].reason,/separate authentication/);
});
