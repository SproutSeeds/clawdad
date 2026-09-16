import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {CodexAccountLegacyWork} from '../lib/codex-account-legacy-work.mjs';
import {CodexAccounts} from '../lib/codex-accounts.mjs';
async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-legacy-account-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let external=null,work;const accounts=new CodexAccounts({root,usage:{snapshot:async()=>({}),freshReading:async()=>({accountKey:'a'})},
    inspectConsumers:async()=>({complete:true,consumers:[]}),readWork:async()=>work.snapshot(),adapter:{capabilities:{ready:true}}});
  work=new CodexAccountLegacyWork({root:path.join(root,'legacy'),accounts,inspectReceipt:async()=>external});
  const entry=(await accounts.add({email:'synthetic@example.test',requestId:'account',expectedRevision:0})).account;
  const request=()=>accounts.request({accountId:entry.id,requestId:'switch',expectedRevision:1,confirmed:true});
  const input={id:'request',fingerprint:'complete-payload-hash',projectPath:'/project',sessionId:'exact-session'};
  return {accounts,work,request,input,setExternal:x=>external=x};
}
test('accepted project work drains on original account, while a racing new request is rejected before worker dispatch',async t=>{
  const f=await fixture(t),job=await f.work.reserve(f.input);await f.request();
  assert.equal((await f.accounts.observe()).drain.ready,false);await f.work.prepare(job);
  await assert.rejects(f.work.reserve({...f.input,id:'later'}),/holding new work/);
  f.setExternal({id:job.id,sessionId:job.sessionId,projectPath:job.projectPath,status:'working'});
  assert.equal((await f.accounts.observe()).drain.ready,false);
  f.setExternal({id:job.id,sessionId:job.sessionId,projectPath:job.projectPath,status:'completed'});
  assert.equal((await f.accounts.observe()).drain.ready,true);
});
test('no effect means cancelled; uncertain effects and mismatched receipts remain held across restart',async t=>{
  const f=await fixture(t),job=await f.work.reserve(f.input);await f.work.finishAttempt(job);
  assert.equal((await f.work.snapshot()).jobs[0].status,'cancelled');
  const next=await f.work.reserve({...f.input,id:'second'});await f.work.prepare(next);await f.work.finishAttempt(next);
  assert.equal((await f.work.snapshot()).jobs[1].status,'attention');
  f.setExternal({id:'second',sessionId:'wrong',projectPath:'/project',status:'completed'});
  assert.equal((await f.work.snapshot()).jobs.find(j=>j.id==='second').status,'attention');
  await assert.rejects(f.work.reserve({...f.input,id:'second'}),/already has a receipt/);
  await assert.rejects(f.work.prepare(next),/already have occurred/);
});
