import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {captureAccountAppServerLocal,readAccountSharedSummary,connectCodexAccountSwitchRuntime,verifyAccountSwitchInventory} from '../lib/codex-account-switch-runtime.mjs';
import {accountSkipIdentity,accountSkipOwner} from '../lib/codex-account-switch-scope.mjs';
import {researchSave} from '../lib/research-budget.mjs';

test('final account verification accounts for unchanged exclusions and rejects replacement, added or wrong-session owners',()=>{
  const skipped={kind:'terminal_codex',pid:99,tty:'/dev/ttys099',processIdentity:'skip-lifetime'};
  const kept={kind:'terminal_codex',pid:100,tty:'/dev/ttys100',sessionId:'exact-thread'};
  const op={consumers:[kept],recovery:{entries:[{native:kept}]},excludedConsumers:[{owner:accountSkipOwner(skipped),identity:accountSkipIdentity(skipped),display:{}}]};
  assert.equal(verifyAccountSwitchInventory({complete:true,consumers:[kept,skipped]},op),true);
  assert.equal(verifyAccountSwitchInventory({complete:true,consumers:[kept,{...skipped,pid:101}]},op),false);
  assert.equal(verifyAccountSwitchInventory({complete:true,consumers:[{...kept,sessionId:'other-thread'},skipped]},op),false);
  assert.equal(verifyAccountSwitchInventory({complete:true,consumers:[kept,skipped,{...kept,pid:200,tty:'/dev/ttys200'}]},op),false);
  assert.equal(verifyAccountSwitchInventory({complete:false,consumers:[kept]},op),false);
  assert.equal(verifyAccountSwitchInventory({complete:true,consumers:[kept]},op),true);
});

test('local shared draft capture binds exact text and image bytes without changing pending receipts',async t=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-shared-drafts-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const bytes=Buffer.from('synthetic image'),image=path.join(root,'image.png');await fs.writeFile(image,bytes,{mode:0o600});
  const state={version:1,drafts:{thread:{revision:3,text:'Held Unicode 🌿\nline two',images:[{path:image,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]}},jobs:[]};
  const file=path.join(root,'state.json');await researchSave(file,state);const before=await fs.readFile(file);
  const captured=await captureAccountAppServerLocal(root,'thread');assert.equal(captured.receiptsResolved,true);
  assert.deepEqual(await fs.readFile(file),before);state.drafts.thread.text+=' correction';await researchSave(file,state);
  assert.notEqual((await captureAccountAppServerLocal(root,'thread')).draftHash,captured.draftHash);
  state.jobs.push({threadId:'thread',status:'attention',uncertain:true});await researchSave(file,state);assert.equal((await captureAccountAppServerLocal(root,'thread')).receiptsResolved,true);
  state.jobs.push({threadId:'thread',status:'queued'});await researchSave(file,state);assert.equal((await captureAccountAppServerLocal(root,'thread')).receiptsResolved,false);
  await fs.writeFile(image,'changed');await assert.rejects(captureAccountAppServerLocal(root,'thread'),/changed or is missing/);
});
test('shared read-only summary paginates loaded threads and reports queue work without resuming or submitting',async()=>{
  const calls=[],client={close(){},async request(method,args){calls.push(method);
    if(method==='server/diagnostics')return {process:{id:42}};
    if(method==='thread/loaded/list')return args.cursor?{data:['two'],nextCursor:null}:{data:['one'],nextCursor:'next'};
    if(method==='thread/read')return {thread:{id:args.threadId,status:{type:'idle'}}};
    if(method==='thread/queue/list')return {data:args.threadId==='two'?[{id:'queued'}]:[],nextCursor:null};
    assert.fail(method);}};
  assert.deepEqual(await readAccountSharedSummary('/fixture/socket',{pid:42},{createClient:()=>client}),{pid:42,complete:true,busy:true});
  assert.ok(calls.every(method=>method.endsWith('/list')||method.endsWith('/read')||method==='server/diagnostics'));
});
test('connecting controllers starts no login, worker, capture or transition before an explicit switch',()=>{
  const accounts={root:'/fixture/accounts',authorizations:{}},runtime={root:'/fixture/assistant',appServer:{root:'/fixture/assistant/AppServer'}};
  const connection=connectCodexAccountSwitchRuntime({accounts,runtime,binary:'/fixture/codex',socketPath:'/fixture/socket',canonicalHome:'/fixture/canonical'});
  assert.equal(accounts.adapter,connection.adapter);assert.equal(runtime.accountNativeControl,connection.adapter.transport);
  assert.equal(connection.sharedDriver.client,null);connection.close();
});
