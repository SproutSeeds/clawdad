import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {AssistantAppServer} from '../lib/assistant-app-server.mjs';
import {classifyThreadOwner,rpcPages} from '../lib/codex-thread-control.mjs';
import {AssistantRuntime} from '../lib/assistant-runtime.mjs';
import {CodexAccounts} from '../lib/codex-accounts.mjs';
import {readAccountWork} from '../lib/codex-account-consumers.mjs';

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
    if(method==='account/read')return {account:{type:'chatgpt'}};
    if(method==='config/read')return {config:{model:'test-model',model_reasoning_effort:'high'}};
    if(method==='model/list')return {data:[{model:'test-model',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],inputModalities:['text','image']}],nextCursor:null};
    if(method==='thread/read'){if(!thread)throw Error('Unknown thread');return {thread};}
    if(method==='thread/turns/list')return {data:thread.turns,nextCursor:null};
    if(method==='thread/queue/list')return {data:queue.get(args.threadId)||[],nextCursor:null};
    if(method==='thread/start'){const key=id();threads.set(key,{id:key,cwd:args.cwd,status:{type:'idle'},turns:[]});loaded.add(key);return {thread:threads.get(key)};}
    if(method==='thread/name/set'){thread.name=args.name;return {};}
    if(method==='thread/unarchive'){thread.archived=false;return {thread};}
    if(method==='thread/resume'){loaded.add(args.threadId);return {thread};}
    if(method==='thread/unsubscribe')return {status:'unsubscribed'};
    if(method==='thread/queue/add'){
      const entry={id:id(),...args};queue.set(args.threadId,[...(queue.get(args.threadId)||[]),entry]);
      if(loseReply){loseReply=false;throw Object.assign(Error('Lost acknowledgement'),{uncertain:true});}return {queuedSubmission:entry};
    }
    if(method==='turn/start'){
      assert.equal(thread.status.type,'idle','configured sends cannot steer active work');
      const turn={id:id(),status:'inProgress',items:[{type:'userMessage',clientId:args.clientUserMessageId,content:args.input}]};
      thread.turns.push(turn);thread.status={type:'active'};
      if(loseReply){loseReply=false;throw Object.assign(Error('Lost acknowledgement'),{uncertain:true});}return {turn};
    }throw Error('Unexpected '+method);
  }};
  const options={root,client,workspaces:async()=>({roots:[{path:root}]}),readIndex:async()=>[...threads.values()],readOwners:async()=>owners,lease:async()=>({release:async()=>{}}),deliveryLease:async()=>({release:async()=>{}})};
  const app=new AssistantAppServer(options);t.after(()=>app.close());
  return {root,threadId,other,threads,loaded,queue,calls,app,options,foreign(){owners.push({pid:80,tty:'ttys012',socket:false,threads:[threadId]});},exitForeign(){owners=owners.filter(p=>p.socket);},restart(){owners[0].pid++;},lose(){loseReply=true;}};
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

test('archived restoration is explicit, owner-bound and separate from resume or submission', async t => {
  const f=await fixture(t);f.threads.get(f.threadId).archived=true;f.loaded.delete(f.threadId);
  const inspected=await f.app.inspect(f.threadId);assert.equal(inspected.capabilities.restore,true);assert.equal(inspected.capabilities.resume,false);
  const requestId=id(),args={threadId:f.threadId,targetToken:inspected.targetToken};
  const restored=await f.app.control('appserver.restore',args,requestId);assert.equal(restored.job.status,'completed');assert.equal(restored.job.result.submitted,false);
  await f.app.control('appserver.restore',args,requestId);assert.equal(f.calls.filter(c=>c.method==='thread/unarchive').length,1);
  assert.equal(f.calls.some(c=>c.method==='thread/resume'||c.method==='thread/queue/add'),false);
  const again=await f.app.inspect(f.threadId);assert.equal(again.capabilities.resume,true);
  await f.app.control('appserver.resume',{threadId:f.threadId,targetToken:again.targetToken},id());
  assert.equal(f.calls.filter(c=>c.method==='thread/resume').length,1);
});

test('inaccessible histories stay visible, JSON subagents are filtered, and live metadata wins',async t=>{
  const f=await fixture(t),missing=id(),internal=id();
  f.app.readIndex=async()=>[{id:f.threadId,cwd:'/stale/cwd',source:'cli'},
    {id:missing,cwd:f.root,source:'cli',title:'Missing retained history'},
    {id:internal,cwd:f.root,source:'{"subAgent":{"thread_spawn":{}}}'}];
  await assert.rejects(f.app.history({threadId:missing}));
  const result=await f.app.inventory();
  assert.equal(result.threads.find(v=>v.id===missing).historyStatus,'unavailable');
  assert.equal(result.threads.some(v=>v.id===internal),false);
  assert.equal(result.threads.find(v=>v.id===f.threadId).cwd,f.root);
  assert.equal(result.threads.find(v=>v.id===f.threadId).metadataStale,true);
  const inspect=await f.app.inspect(missing);assert.equal(inspect.reasonCode,'history_read_failed');
  assert.equal(inspect.targetToken,undefined);assert.equal(inspect.capabilities.send,false);
  assert.ok((await f.app.inventory({includeInternal:true})).threads.some(v=>v.id===internal));
});

test('owner proof ignores unrelated guardian handles and fresh inspection permits explicit handoff after owner exits',async t=>{
  const f=await fixture(t),server={pid:1,socket:true,tty:'??',threads:[]};
  const owner=(extra)=>classifyThreadOwner(f.threadId,[server,{pid:2,socket:false,tty:'ttys005',threads:[f.threadId,...extra]}],[f.threadId]);
  assert.deepEqual(owner([]),owner([id()]));
  f.foreign();f.loaded.delete(f.threadId);
  const before=await f.app.inspect(f.threadId);assert.equal(before.capabilities.resume,false);
  f.exitForeign();
  const stale=await f.app.control('appserver.resume',{threadId:f.threadId,targetToken:before.targetToken},id());assert.equal(stale.job.status,'attention');
  const fresh=await f.app.inspect(f.threadId);assert.equal(fresh.owner.kind,'saved');
  const resumed=await f.app.control('appserver.resume',{threadId:f.threadId,targetToken:fresh.targetToken},id());
  assert.equal(resumed.job.result.threadId,f.threadId);assert.equal(resumed.job.result.owner.kind,'app_server');
});

test('selected model/effort reaches one accepted turn after existing work and native queue, in order',async t=>{
  const f=await fixture(t);f.threads.get(f.threadId).status={type:'active'};
  const model=await f.app.modelOptions(f.root);assert.equal(model.configuredReasoningEffort,'high');
  await f.app.control('appserver.draft',{threadId:f.threadId,text:'BEGIN\nRésumé 🦞\nEND',expectedRevision:0},id());
  const first=id(),args={threadId:f.threadId,targetToken:(await f.app.inspect(f.threadId)).targetToken,draftRevision:1,model:'test-model',reasoningEffort:'high'};
  let result=await f.app.control('appserver.queue',args,first);assert.equal(result.job.status,'queued');assert.equal(result.job.result.nativeAccepted,false);
  await f.app.poll();assert.equal(f.calls.some(c=>c.method==='turn/start'),false);
  f.threads.get(f.threadId).status={type:'idle'};f.queue.set(f.threadId,[{id:id(),clientUserMessageId:id()}]);
  await f.app.poll();assert.equal(f.calls.some(c=>c.method==='turn/start'),false);
  f.queue.set(f.threadId,[]);await f.app.poll();
  result=await f.app.control('appserver.queue',args,first);assert.equal(result.job.status,'working');assert.equal(result.job.result.nativeAccepted,true);
  const sent=f.calls.filter(c=>c.method==='turn/start');assert.equal(sent.length,1);
  assert.equal(sent[0].args.model,'test-model');assert.equal(sent[0].args.effort,'high');assert.equal(sent[0].args.clientUserMessageId,first);
  assert.equal(sent[0].args.input[0].text,'BEGIN\nRésumé 🦞\nEND');assert.equal((await f.app.inspect(f.threadId)).draft.text,'');
  const second=id(),third=id();
  await f.app.control('appserver.queue',{threadId:f.threadId,targetToken:(await f.app.inspect(f.threadId)).targetToken,text:'second',model:'test-model',reasoningEffort:'low'},second);
  await f.app.control('appserver.queue',{threadId:f.threadId,targetToken:(await f.app.inspect(f.threadId)).targetToken,text:'third'},third);
  for(const expected of [second,third]){
    const thread=f.threads.get(f.threadId);thread.turns.at(-1).status='completed';thread.status={type:'idle'};
    await f.app.poll();assert.equal(f.calls.filter(c=>c.method==='turn/start').at(-1).args.clientUserMessageId,expected);
  }
});

test('configured queue survives restart and pause, cancels before dispatch, and preserves later draft edits',async t=>{
  const f=await fixture(t);let allowed=false;f.app.mayDispatch=()=>allowed;
  await f.app.control('appserver.draft',{threadId:f.threadId,text:'captured',expectedRevision:0},id());
  const requestId=id(),args={threadId:f.threadId,targetToken:(await f.app.inspect(f.threadId)).targetToken,draftRevision:1,model:'test-model',reasoningEffort:'high'};
  await f.app.control('appserver.queue',args,requestId);await f.app.poll();assert.equal(f.calls.some(c=>c.method==='turn/start'),false);
  const restored=new AssistantAppServer({...f.options,mayDispatch:()=>allowed});t.after(()=>restored.close());
  await restored.load();await restored.control('appserver.draft',{threadId:f.threadId,text:'Keep later edits',expectedRevision:1,replace:true},id());
  allowed=true;await restored.poll();assert.equal(restored.state.jobs.find(j=>j.id===requestId).status,'working');
  assert.equal((await restored.inspect(f.threadId)).draft.text,'Keep later edits');
  const cancelled=id();await restored.control('appserver.queue',{threadId:f.threadId,targetToken:(await restored.inspect(f.threadId)).targetToken,draftRevision:2,model:'test-model'},cancelled);
  await restored.cancelWaiting(cancelled);await restored.cancelWaiting(cancelled);
  f.threads.get(f.threadId).status={type:'idle'};await restored.poll();assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);
  assert.equal((await restored.inspect(f.threadId)).draft.text,'Keep later edits');
});

test('unavailable settings reject safely and lost configured acknowledgement reconciles without replay',async t=>{
  const f=await fixture(t);let token=(await f.app.inspect(f.threadId)).targetToken;
  assert.match((await f.app.control('appserver.send',{threadId:f.threadId,targetToken:token,text:'keep',model:'missing'},id())).job.error,/unavailable/);
  token=(await f.app.inspect(f.threadId)).targetToken;
  assert.match((await f.app.control('appserver.send',{threadId:f.threadId,targetToken:token,text:'keep',model:'test-model',reasoningEffort:'impossible'},id())).job.error,/Unsupported reasoning/);
  await f.app.control('appserver.draft',{threadId:f.threadId,text:'Retain until proven',expectedRevision:0},id());
  const requestId=id(),args={threadId:f.threadId,targetToken:(await f.app.inspect(f.threadId)).targetToken,draftRevision:1,model:'test-model'};
  await f.app.control('appserver.send',args,requestId);f.lose();await f.app.poll();
  assert.equal(f.app.state.jobs.find(j=>j.id===requestId).uncertain,true);assert.equal((await f.app.inspect(f.threadId)).draft.text,'Retain until proven');
  await f.app.control('appserver.send',args,requestId);await f.app.control('appserver.reconcile',{deliveryRequestId:requestId},id());
  assert.equal(f.app.state.jobs.find(j=>j.id===requestId).status,'working');assert.equal((await f.app.inspect(f.threadId)).draft.text,'');
  assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);
});

test('accepted configured app-server work drains on its original owner before an account switch',async t=>{
  const f=await fixture(t);f.app.start=()=>{};
  const changes=[],a='a'.repeat(64),b='b'.repeat(64);
  const accounts=new CodexAccounts({root:path.join(f.root,'Accounts'),
    usage:{snapshot:async()=>({}),freshReading:async()=>({accountKey:a})},
    inspectConsumers:async()=>({complete:true,consumers:[]}),
    readWork:()=>readAccountWork({root:path.join(f.root,'Assistant'),appServer:f.app}),
    adapter:{capabilities:{ready:true,reasons:[]},captureRecovery:async o=>({fingerprint:o.fingerprint,entries:[]}),
      authenticate:async()=>{changes.push('account');return {state:'verified',method:'chatgpt',email:'b@example.test',accountKey:b,workspaceVerified:true};},
      verify:async()=>({accountKey:b,allConsumersVerified:true,freshUsage:true})}});
  f.app.accountControls=accounts;f.app.mayDispatch=async job=>(await accounts.deliveryAdmission(job)).allowed;
  const saved=await accounts.add({email:'b@example.test',requestId:'saved',expectedRevision:0});
  f.threads.get(f.threadId).status={type:'active'};
  const token=(await f.app.inspect(f.threadId)).targetToken;
  const args={threadId:f.threadId,targetToken:token,text:'Authorized original-account work',model:'test-model',reasoningEffort:'low'};
  const accepted=await f.app.control('appserver.queue',args,'accepted');assert.equal(accepted.job.status,'queued');
  await accounts.request({accountId:saved.account.id,requestId:'switch',expectedRevision:(await accounts.snapshot()).revision,confirmed:true});
  await accounts.advance();assert.deepEqual(changes,[]);
  await assert.rejects(f.app.control('appserver.queue',{...args,text:'Later work'},'later'),/holding new work/);
  // Local draft editing stays available without submitting or changing owner.
  await f.app.control('appserver.draft',{threadId:f.other,text:'Keep this draft',expectedRevision:0},'draft');
  f.threads.get(f.threadId).status={type:'idle'};await f.app.poll();
  assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);
  assert.equal(f.calls.find(c=>c.method==='turn/start').args.clientUserMessageId,'accepted');
  await accounts.advance();assert.deepEqual(changes,[]);
  f.threads.get(f.threadId).turns[0].status='completed';f.threads.get(f.threadId).status={type:'idle'};await f.app.poll();
  await accounts.advance();assert.deepEqual(changes,['account']);assert.equal((await accounts.snapshot()).epoch,1);
  await f.app.control('appserver.queue',args,'accepted');assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);
  assert.equal((await f.app.inspect(f.other)).draft.text,'Keep this draft');
});
