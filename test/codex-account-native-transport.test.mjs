import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CodexAccountNativeTransport} from '../lib/codex-account-native-transport.mjs';

async function fixture(t){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'account-native-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let allowed=true;const open=()=>new CodexAccountNativeTransport({root,authorize:async()=>allowed});
  return {root,open,control:open(),pause:()=>allowed=false};}
const request={operationId:'switch-one',requestId:'step-one',action:'stop',args:{tty:'/dev/ttys901',processIdentity:'exact-owner'}};
const context=job=>({id:job.id,workerId:job.workerId,dispatchId:job.dispatchId});

test('private native mailbox deduplicates competing requests and dispatches once',async t=>{
  const f=await fixture(t);await Promise.all([f.control.enqueue(request),f.open().enqueue(request)]);
  await assert.rejects(f.control.enqueue({...request,action:'launch'}),{code:'native_account_request_conflict'});
  const polls=await Promise.all([f.control.poll({workerId:'worker'}),f.open().poll({workerId:'worker'})]);
  assert.equal(polls.filter(p=>p.job).length,1);const job=polls.find(p=>p.job).job;
  await f.control.prepare(context(job));await assert.rejects(f.open().prepare(context(job)),{code:'native_account_dispatch_uncertain'});
  assert.equal((await f.control.poll({workerId:'worker'})).job,null);
  const result={state:'shell',exactOwnerExited:true};await f.control.complete({...context(job),result});
  await f.open().complete({...context(job),result});
  await assert.rejects(f.control.complete({...context(job),result:{state:'agent'}}),{code:'native_account_result_changed'});
  assert.equal((await f.open().inspect(request.requestId)).state,'completed');
});

test('worker restart before preparation permits explicit retry with the same request',async t=>{
  const f=await fixture(t);await f.control.enqueue(request);const first=(await f.control.poll({workerId:'first'})).job;
  await f.open().poll({workerId:'second'});assert.equal((await f.control.inspect(request.requestId)).state,'not_dispatched');
  await assert.rejects(f.control.prepare(context(first)),{code:'native_account_dispatch_uncertain'});
  await f.control.retryUnsent(request.requestId);const second=(await f.open().poll({workerId:'second'})).job;
  assert.equal(second.id,first.id);assert.notEqual(second.dispatchId,first.dispatchId);
  await assert.rejects(f.control.complete({...context(first),reasonCode:'stale_worker'}),{code:'native_account_worker_changed'});
  await f.control.prepare(context(second));await f.control.complete({...context(second),result:{state:'shell'}});
});

test('lost prepared acknowledgement and worker restart never replay an uncertain effect',async t=>{
  const f=await fixture(t);await f.control.enqueue(request);const job=(await f.control.poll({workerId:'first'})).job;
  await f.control.prepare(context(job));await f.open().poll({workerId:'second'});
  assert.equal((await f.control.inspect(request.requestId)).state,'attention');
  await assert.rejects(f.control.retryUnsent(request.requestId),{code:'native_account_delivery_uncertain'});
  assert.equal((await f.control.poll({workerId:'third'})).job,null);
  // The original worker may still deliver its durable result after reconnect.
  await f.open().complete({...context(job),result:{state:'shell'}});
  assert.equal((await f.control.inspect(request.requestId)).state,'completed');
});

test('manual pause and ordinary native work hold dispatch and preparation',async t=>{
  const f=await fixture(t);await f.control.enqueue(request);
  assert.equal((await f.control.poll({workerId:'worker',canDispatch:false})).job,null);
  const job=(await f.control.poll({workerId:'worker'})).job;f.pause();
  await assert.rejects(f.control.prepare(context(job)),{code:'account_control_not_authorized'});
  await f.control.complete({...context(job),reasonCode:'manual_input_changed'});
  assert.equal((await f.control.inspect(job.id)).state,'not_dispatched');
  await assert.rejects(f.control.retryUnsent(job.id),{code:'account_control_not_authorized'});
});

test('success requires preparation and complete journal validation survives service restart',async t=>{
  const f=await fixture(t);await f.control.enqueue(request);const job=(await f.control.poll({workerId:'worker'})).job;
  await assert.rejects(f.control.complete({...context(job),result:{state:'shell'}}),{code:'native_account_prepare_missing'});
  await assert.rejects(f.control.enqueue({...request,requestId:'bad',action:'arbitrary-key'}),{code:'native_account_request_invalid'});
  const state=JSON.parse(await fs.readFile(f.control.file));state.requests[0].args.processIdentity='another-owner';
  await fs.writeFile(f.control.file,JSON.stringify(state));
  await assert.rejects(f.open().poll({workerId:'worker'}),{code:'native_account_journal_invalid'});
});
