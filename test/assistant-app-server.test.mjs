import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {AssistantAppServer} from '../lib/assistant-app-server.mjs';
import {classifyThreadOwner,rpcPages} from '../lib/codex-thread-control.mjs';
import {AssistantRuntime} from '../lib/assistant-runtime.mjs';

const id=()=>crypto.randomUUID();
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-appserver-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const threadId=id(),other=id();let owners=[{pid:40,tty:'??',socket:true,threads:[]}];
  const threads=new Map([[threadId,{id:threadId,cwd:root,status:{type:'idle'},name:'Same name',turns:[]}],
    [other,{id:other,cwd:root,status:{type:'idle'},name:'Same name',turns:[]}]]);
  const loaded=new Set(threads.keys()),queue=new Map(),calls=[];let loseReply=false;
  const client={close(){},async request(method,args={}){
    calls.push({method,args});
    const thread=threads.get(args.threadId);
    if(method==='thread/list')return {data:args.archived?[]:[...threads.values()],nextCursor:null};
    if(method==='thread/loaded/list')return {data:[...loaded],nextCursor:null};
    if(method==='thread/read'){if(!thread)throw Error('Unknown thread');return {thread};}
    if(method==='thread/turns/list')return {data:thread.turns,nextCursor:null};
    if(method==='thread/queue/list')return {data:queue.get(args.threadId)||[],nextCursor:null};
    if(method==='thread/start'){const key=id();threads.set(key,{id:key,cwd:args.cwd,status:{type:'idle'},turns:[]});loaded.add(key);return {thread:threads.get(key)};}
    if(method==='thread/name/set'){thread.name=args.name;return {};}
    if(method==='thread/resume'){loaded.add(args.threadId);return {thread};}
    if(method==='thread/queue/add'){
      const entry={id:id(),...args};queue.set(args.threadId,[...(queue.get(args.threadId)||[]),entry]);
      if(loseReply){loseReply=false;throw Object.assign(Error('Lost acknowledgement'),{uncertain:true});}return {queuedSubmission:entry};
    }throw Error('Unexpected '+method);
  }};
  const options={root,client,workspaces:async()=>({roots:[{path:root}]}),readIndex:async()=>[...threads.values()],readOwners:async()=>owners,lease:async()=>({release:async()=>{}})};
  const app=new AssistantAppServer(options);t.after(()=>app.close());
  return {root,threadId,other,threads,loaded,queue,calls,app,options,foreign(){owners.push({pid:80,tty:'ttys012',socket:false,threads:[threadId]});},restart(){owners[0].pid++;},lose(){loseReply=true;}};
}

test('owner proof keeps shared history independent of Terminal or background owners',()=>{
  const t=id(),server={pid:1,socket:true,tty:'??',threads:[]};
  assert.equal(classifyThreadOwner(t,[server],[]).kind,'saved');
  assert.equal(classifyThreadOwner(t,[server],[t]).kind,'app_server');
  assert.equal(classifyThreadOwner(t,[server,{pid:2,socket:false,tty:'ttys005',threads:[t]}],[t]).kind,'terminal');
  assert.equal(classifyThreadOwner(t,[server,{pid:2,socket:false,tty:'??',threads:[t]}],[]).kind,'other_runtime');
  assert.equal(classifyThreadOwner(t,[],[]).kind,'uncertain');
});
test('inventory follows pages, distinguishes same-named IDs and does not load threads',async t=>{
  const f=await fixture(t);const inventory=await f.app.inventory();assert.equal(inventory.threads.length,2);
  assert.notEqual(inventory.threads[0].id,inventory.threads[1].id);
  assert.equal(f.calls.some(c=>/start|resume|queue\/add/.test(c.method)),false);
  let n=0;assert.deepEqual(await rpcPages({request:async()=>++n===1?{data:[1],nextCursor:'two'}:{data:[2],nextCursor:null}},'list'),[1,2]);
  await assert.rejects(rpcPages({request:async()=>({data:[],nextCursor:'same'})},'list'),/repeated/);
});
test('drafts stay separate from delivery, preserve another draft and use revision checks',async t=>{
  const f=await fixture(t),args={threadId:f.threadId,text:'Line one\nLine two',expectedRevision:0};
  const requestId=id();const a=await f.app.control('appserver.draft',args,requestId);
  assert.equal(a.job.status,'inserted');assert.equal(f.calls.length,0);
  assert.equal((await f.app.control('appserver.draft',{...args},requestId)).job.id,requestId);
  await f.app.control('appserver.draft',{threadId:f.other,text:'Keep this',expectedRevision:0},id());
  await assert.rejects(f.app.control('appserver.clear',{threadId:f.threadId,expectedRevision:0,replace:true},id()),/changed/);
  await f.app.control('appserver.clear',{threadId:f.threadId,expectedRevision:1,replace:true},id());
  assert.equal((await f.app.inspect(f.threadId)).draft.text,'');assert.equal((await f.app.inspect(f.other)).draft.text,'Keep this');
});
test('foreign owner and stale runtime inspection block resume and delivery',async t=>{
  const f=await fixture(t),token=(await f.app.inspect(f.threadId)).targetToken;f.foreign();
  const blocked=await f.app.control('appserver.send',{threadId:f.threadId,targetToken:token,text:'Authorized task'},id());
  assert.equal(blocked.job.status,'attention');assert.match(blocked.job.error,/another live Codex/);
  assert.equal(f.calls.some(c=>['thread/resume','thread/queue/add'].includes(c.method)),false);
  const g=await fixture(t),targetToken=(await g.app.inspect(g.threadId)).targetToken;g.restart();
  assert.match((await g.app.control('appserver.send',{threadId:g.threadId,targetToken,text:'Task'},id())).job.error,/inspection changed/);
});
test('native queue preserves order, one client ID, and uncertainty reconciles without readding',async t=>{
  const f=await fixture(t);f.threads.get(f.threadId).status={type:'active'};
  let token=(await f.app.inspect(f.threadId)).targetToken;
  assert.match((await f.app.control('appserver.send',{threadId:f.threadId,targetToken:token,text:'Task'},id())).job.error,/working/);
  token=(await f.app.inspect(f.threadId)).targetToken;const requestId=id(),args={threadId:f.threadId,targetToken:token,text:'First'};
  f.lose();const uncertain=await f.app.control('appserver.queue',args,requestId);assert.equal(uncertain.job.uncertain,true);
  assert.equal((await f.app.control('appserver.queue',args,requestId)).job.status,'attention');
  const recovered=await f.app.control('appserver.reconcile',{deliveryRequestId:requestId},id());assert.equal(recovered.job.status,'agent_queued');
  const reloaded=new AssistantAppServer(f.options);t.after(()=>reloaded.close());
  assert.equal((await reloaded.control('appserver.queue',args,requestId)).job.status,'agent_queued');
  assert.equal(f.calls.filter(c=>c.method==='thread/queue/add').length,1);
  f.queue.set(f.threadId,[]);f.threads.get(f.threadId).turns.push({id:id(),status:'completed',items:[{type:'userMessage',clientId:requestId},{type:'agentMessage',phase:'final_answer',text:'Verified result'}]});
  const completed=await reloaded.control('appserver.reconcile',{deliveryRequestId:requestId},id());assert.equal(completed.job.response,'Verified result');assert.equal(completed.job.status,'completed');
});
test('retained image-only draft delivers bytes and is cleared only after native acceptance',async t=>{
  const f=await fixture(t),image=path.join(f.root,'original.png');const bytes=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);await fs.writeFile(image,bytes);
  const draft=await f.app.control('appserver.draft',{threadId:f.threadId,text:'',paths:[image],expectedRevision:0},id());
  const retained=draft.job.result.draft.images[0];assert.notEqual(retained.path,image);await fs.unlink(image);assert.deepEqual(await fs.readFile(retained.path),bytes);
  const inspected=await f.app.inspect(f.threadId);const sent=await f.app.control('appserver.send',{threadId:f.threadId,targetToken:inspected.targetToken,draftRevision:1},id());
  assert.equal(sent.job.status,'agent_queued');assert.equal(f.calls.filter(c=>c.method==='thread/queue/add').at(-1).args.input[0].path,retained.path);
  assert.equal((await f.app.inspect(f.threadId)).draft.images.length,0);
});
test('new thread returns verified identity without a message and retains native approve sandbox',async t=>{
  const f=await fixture(t);const requestId=id();const j=await f.app.control('appserver.create',{project:f.root,name:'Disposable'},requestId);
  assert.equal(j.job.status,'completed');assert.equal(j.job.result.thread.name,'Disposable');
  assert.deepEqual(f.calls.find(c=>c.method==='thread/start').args,{cwd:await fs.realpath(f.root),sandbox:'workspace-write',approvalPolicy:'never'});
  await f.app.control('appserver.create',{project:f.root,name:'Disposable'},requestId);assert.equal(f.calls.filter(c=>c.method==='thread/start').length,1);
  assert.equal(f.calls.filter(c=>c.method==='thread/queue/add').length,0);
});
test('destination is persisted per conversation, frozen per message and never submits work',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-destination-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const coordinator={prepare:async()=>({}),stop(){}};const r=new AssistantRuntime({root,coordinator});
  await r.command({action:'start',requestId:'start'});let d=r.snapshot().destination;
  const command={action:'destination',requestId:id(),conversationId:d.conversationId,expectedRevision:d.revision,transport:'app_server'};
  await r.command(command);await r.command(command);assert.equal(r.state.jobs.length,1);
  await r.command({action:'message',requestId:'message',text:'Discuss this idea'});assert.equal(r.state.jobs.at(-1).destination.transport,'app_server');
  d=r.snapshot().destination;await r.command({action:'destination',requestId:id(),conversationId:d.conversationId,expectedRevision:d.revision,transport:'terminal'});
  assert.equal(r.state.jobs.at(-1).destination.transport,'app_server');
  const again=new AssistantRuntime({root,coordinator});await again.load();assert.deepEqual(again.snapshot().destination,r.snapshot().destination);
  await assert.rejects(r.command({...command,requestId:id(),conversationId:'another'}),/another conversation/);
});

test('concurrent cold inspection and control share receipt initialization', async t => {
  const f=await fixture(t);
  await Promise.all([
    f.app.inspect(f.threadId),
    f.app.control('appserver.draft',{threadId:f.threadId,text:'Preserved receipt',expectedRevision:0},id()),
    f.app.inspect(f.other),
  ]);
  assert.equal((await f.app.inspect(f.threadId)).draft.text,'Preserved receipt');
  assert.equal(f.app.state.jobs.length,1);
});

test('unverified index-only histories remain discoverable and legacy reads never resume', async t => {
  const f=await fixture(t),unlisted=id();
  f.app.readIndex=async()=>[{id:unlisted,cwd:f.root,title:'Retained index',source:'cli',archived:true,path:'/missing/rollout'}];
  let result=await f.app.inventory({includeInternal:true});
  assert.equal(result.threads.find(t=>t.id===unlisted).historyStatus,'needs_inspection');
  const request=f.app.client.request.bind(f.app.client);
  f.app.client.request=async(method,args)=>{
    if(method==='thread/turns/list')throw Error('thread not loaded');
    if(method==='thread/read')return {thread:{id:args.threadId,turns:[{id:'one',items:[]},{id:'two',items:[]}]}};
    return request(method,args);
  };
  const first=await f.app.history({threadId:unlisted,limit:1});
  assert.equal(first.data[0].id,'one');
  assert.equal((await f.app.history({threadId:unlisted,limit:1,cursor:first.nextCursor})).data[0].id,'two');
  assert.equal(f.calls.some(c=>c.method==='thread/resume'),false);
});
