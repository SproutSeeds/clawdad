import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AssistantRuntime} from '../lib/assistant-runtime.mjs';
import {runAssistantMCP} from '../lib/assistant-mcp.mjs';
import {Readable, Writable} from 'node:stream';

const queueSession='01a0817d-c8ca-7aa3-9153-74c69e51841d';
test('native shell drafts and new tabs require exact identities and survive duplicate/restart without replay',async t=>{
  const {runtime,root,coordinator}=await fixture(t);
  const draft={action:'terminal.native.type',requestId:'native-draft',tabId:'shell-tab',inputToken:'inspection',inputSessionId:'native-process',mode:'insert',expectedText:'',text:'draft only'};
  await assert.rejects(runtime.command(draft),/Unsupported/);
  for(const changes of [{inputToken:''},{inputSessionId:''},{text:'echo hello\n'},{text:'hello\t'},{expectedText:'existing'},{mode:'clear'}]) {
    await assert.rejects(runtime.command({...draft,...changes},{tool:true}));
  }
  await runtime.command(draft,{tool:true});
  assert.equal((await runtime.nativePoll({workerId:'one'})).job.id,draft.requestId);
  await runtime.nativeResult({id:draft.requestId,result:{tabId:draft.tabId,inputSessionId:draft.inputSessionId,text:draft.text,draftVerified:true,submitted:false}});
  assert.equal((await runtime.job(draft.requestId)).status,'inserted');
  await runtime.command(draft,{tool:true});
  assert.equal((await runtime.nativePoll({workerId:'one'})).job,null);
  await assert.rejects(runtime.command({...draft,text:'different'},{tool:true}),/different action/);
  const create={action:'terminal.new',tabId:'anchor',expectedRevision:7,requestId:'new-tab'};
  await runtime.command(create,{tool:true});
  await runtime.nativePoll({workerId:'one'});
  const restarted=new AssistantRuntime({root,coordinator});t.after(()=>restarted.close());
  assert.equal((await restarted.nativePoll({workerId:'two'})).job,null);
  assert.equal((await restarted.command(create,{tool:true})).job.status,'attention');
  assert.equal((await restarted.nativePoll({workerId:'two'})).job,null);
});

test('native create and typing receipts require observed identity and text before claiming success',async t=>{
  const {runtime}=await fixture(t);
  await runtime.command({action:'terminal.new',tabId:'anchor',expectedRevision:1,requestId:'new'},{tool:true});
  await runtime.nativePoll({workerId:'one'});
  await runtime.nativeResult({id:'new',result:{created:true}});
  assert.equal((await runtime.job('new')).status,'attention');
  await runtime.command({action:'terminal.native.type',tabId:'shell',inputToken:'t',inputSessionId:'native-p',requestId:'typed',mode:'insert',expectedText:'',text:'hello'},{tool:true});
  await runtime.nativePoll({workerId:'one'});
  await runtime.nativeResult({id:'typed',result:{tabId:'shell',inputSessionId:'wrong',text:'hello',draftVerified:true,submitted:false}});
  assert.equal((await runtime.job('typed')).status,'attention');
});

test('verified tab creation is immediately discoverable before the next inventory poll',async t=>{
  const {runtime}=await fixture(t);
  const before={revision:1,selectedTabId:'anchor',tabs:[{id:'anchor'}]};
  await runtime.command({action:'terminal.new',tabId:'anchor',expectedRevision:1,requestId:'create'},{tool:true});
  await runtime.nativePoll({workerId:'one',catalog:before});
  const catalog={revision:2,selectedTabId:'created',tabs:[...before.tabs,{id:'created'}]};
  await runtime.nativeResult({id:'create',result:{created:true,tabId:'created',tab:{id:'created'},catalog,verification:'native-window-and-new-tty'}});
  assert.deepEqual((await runtime.command({action:'state'})).catalog,catalog);
  assert.equal((await runtime.command({action:'terminal.new',tabId:'anchor',expectedRevision:1,requestId:'create'},{tool:true})).job.status,'completed');
  assert.equal((await runtime.command({action:'state'})).catalog.tabs.length,2);
});

test('native close publishes its refreshed catalog and reports refusal or confirmation accurately',async t=>{
  const {runtime}=await fixture(t);
  const state={revision:3,selectedTabId:'target',tabs:[{id:'target'},{id:'other'}]};
  await runtime.command({action:'terminal.close',tabId:'target',expectedRevision:2,requestId:'stale-close'},{tool:true});
  await runtime.nativePoll({workerId:'one',catalog:{...state,revision:2}});
  await runtime.nativeResult({id:'stale-close',result:{close:{tabId:'target',outcome:'failed',errorCode:'stale_catalog',prompt:'The tabs changed. Check the refreshed picker.',state}}});
  assert.equal((await runtime.job('stale-close')).status,'attention');
  assert.deepEqual(runtime.snapshot().catalog,state);
  assert.equal(runtime.snapshot().tasks[0].requestText,'Close the requested Terminal tab');
  await runtime.command({action:'terminal.close',tabId:'target',expectedRevision:3,requestId:'confirm-close'},{tool:true});
  await runtime.nativePoll({workerId:'one',catalog:state});
  await runtime.nativeResult({id:'confirm-close',result:{close:{tabId:'target',outcome:'confirmationRequired',prompt:'Terminate running processes?',confirmationToken:'close-token',state}}});
  assert.equal((await runtime.job('confirm-close')).status,'attention');
  assert.equal((await runtime.nativePoll({workerId:'one',catalog:state})).job,null);
  await runtime.command({action:'terminal.close.resolve',tabId:'target',token:'close-token',confirm:false,requestId:'cancel-close'},{tool:true});
  await runtime.nativePoll({workerId:'one',catalog:state});
  await runtime.nativeResult({id:'cancel-close',result:{close:{tabId:'target',outcome:'cancelled',state}}});
  assert.equal((await runtime.job('confirm-close')).status,'completed');
  assert.equal((await runtime.job('confirm-close')).error,null);
  assert.deepEqual(runtime.snapshot().catalog.tabs,state.tabs);
});

test('existing-draft queue uses the original text and token without a second insertion',async t=>{
  const {runtime}=await fixture(t);
  const request={action:'terminal.queue',tabId:'target',sessionId:queueSession,text:'Reviewed draft',requestId:'existing-queue',useExistingDraft:true,token:'fresh-draft-token'};
  await assert.rejects(runtime.command({...request,token:''},{tool:true}),/inspection/);
  await runtime.command(request,{tool:true});
  const observed=await runtime.nativePoll({workerId:'one'});
  assert.equal(observed.job.args.useExistingDraft,true);
  await runtime.nativePrepare({id:request.requestId,conversationPath:'/fixture/cli.jsonl',sessionId:queueSession,priorTurnId:'turn-before'});
  await runtime.nativeResult({id:request.requestId,result:{tabId:'target',sessionId:queueSession,queueAccepted:true,verification:'rendered-agent-queue'}});
  assert.equal((await runtime.command(request,{tool:true})).job.status,'agent_queued');
  assert.equal((await runtime.nativePoll({workerId:'one'})).job,null);
});

test('queuing an inserted draft follows one native turn and keeps one original task card',async t=>{
  const {runtime}=await fixture(t),file='/fixture/existing-draft.jsonl';
  const draft={action:'terminal.insert',requestId:'original-draft',tabId:'target',sessionId:queueSession,text:'Reviewed draft'};
  await runtime.command(draft,{tool:true});await runtime.nativePoll({workerId:'one'});
  await runtime.nativePrepare({id:draft.requestId,conversationPath:file,sessionId:queueSession,priorTurnId:'original-turn'});
  await runtime.nativeResult({id:draft.requestId,result:{tabId:'target',sessionId:queueSession,draftVerified:true,submitted:false}});
  const queued={action:'terminal.queue',requestId:'queue-draft',tabId:'target',sessionId:queueSession,text:draft.text,useExistingDraft:true,token:'fresh'};
  await runtime.command(queued,{tool:true});await runtime.nativePoll({workerId:'one'});
  await runtime.nativePrepare({id:queued.requestId,conversationPath:file,sessionId:queueSession,priorTurnId:'original-turn'});
  await runtime.nativeResult({id:queued.requestId,result:{tabId:'target',sessionId:queueSession,queueAccepted:true,verification:'rendered-agent-queue'}});
  assert.equal((await runtime.job(draft.requestId)).status,'agent_queued');
  assert.deepEqual(runtime.snapshot().tasks.map(t=>t.id),[draft.requestId]);
  const timestamp=new Date(Date.now()+1000).toISOString();
  for (const payload of [{type:'task_started',turn_id:'own-turn'},{type:'user_message',message:draft.text},{type:'task_complete',turn_id:'own-turn',last_agent_message:'Completed original request'}]) {
    runtime.consumeRecord({type:'event_msg',timestamp,payload},file,{coordinator:false});
  }
  await runtime.save();
  assert.equal((await runtime.job(queued.requestId)).status,'completed');
  assert.equal((await runtime.job(draft.requestId)).status,'completed');
  assert.equal(runtime.snapshot().tasks.length,1);
  assert.equal(runtime.snapshot().tasks[0].response,'Completed original request');
  assert.equal(runtime.state.jobs.find(j=>j.source==='task-update')?.parentTaskId,draft.requestId);
});

test('MCP covers native inputs, new tabs, special commands, existing queue, local Files and clipboard',async t=>{
  const {root}=await fixture(t);await fs.mkdir(path.join(root,'Assistant'));
  await fs.writeFile(path.join(root,'Assistant/connection.json'),JSON.stringify({baseURL:'http://127.0.0.1:4487/'}));
  await fs.writeFile(path.join(root,'native-server.token'),'fixture-token');
  const calls=[['new_terminal_tab',{tabId:'anchor',expectedRevision:1,requestId:'new'},'terminal.new'],
    ['type_terminal_input',{tabId:'shell',inputToken:'token',inputSessionId:'process',expectedText:'',text:'draft',mode:'insert',requestId:'type'},'terminal.native.type'],
    ['press_terminal_key',{tabId:'shell',inputToken:'token2',inputSessionId:'process',shortcut:'control_l',intent:'navigation',requestId:'key'},'terminal.key'],
    ['queue_tab_draft',{tabId:'agent',sessionId:queueSession,token:'draft',text:'reviewed',requestId:'queue'},'terminal.queue'],
    ['files',{action:'list',query:'requested deliverable',requestId:'files'},'files.list'],
    ['clipboard',{operation:'read',requestId:'clipboard'},'remote.clipboard']];
  const lines=[],requests=[];
  await runAssistantMCP({root,input:Readable.from([JSON.stringify({id:1,method:'tools/list'})+'\n',...calls.map(([name,args],i)=>JSON.stringify({id:i+2,method:'tools/call',params:{name,arguments:args}})+'\n')]),
    output:new Writable({write(chunk,_encoding,done){lines.push(JSON.parse(chunk));done();}}),
    fetchImpl:async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({job:{id:'fixture',status:'completed'}})};}});
  for (const [name,args,action] of calls) {
    assert.ok(lines[0].result.tools.some(t=>t.name===name));
    const {action:_,...payload}=args;
    assert.ok(requests.some(r=>r.action===action&&r.requestId===args.requestId));
    assert.deepEqual(requests[calls.findIndex(c=>c[0]===name)],{...payload,action,...(name==='queue_tab_draft'?{useExistingDraft:true}:{})});
  }
});
const queueRequest=(id='queue-1')=>({action:'terminal.queue',requestId:id,tabId:'target',sessionId:queueSession,text:'Authorized follow-up'});
async function prepareQueue(runtime,id='queue-1') {
  await runtime.command(queueRequest(id),{tool:true});
  assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job.id,id);
  await runtime.nativePrepare({id,conversationPath:'/test/queue.jsonl',sessionId:queueSession,tabTitle:'code',priorTurnId:'original-turn'});
}
async function acceptQueue(runtime,id='queue-1') {
  await runtime.nativeResult({id,result:{queueAccepted:true,verification:'rendered-agent-queue',tabId:'target',sessionId:queueSession}});
}

test('native Tab queue requires agent identity, a plain message and stable request IDs',async t=>{
  const {runtime}=await fixture(t);
  await assert.rejects(runtime.command(queueRequest()),/Unsupported/);
  for(const args of [{sessionId:''},{sessionId:'unknown'},{text:'/clear'},{text:' !rm file'},{text:'hello\tescape'},{text:'hello\u001b'}]) {
    await assert.rejects(runtime.command({...queueRequest(),...args},{tool:true}));
  }
  await runtime.command(queueRequest(),{tool:true});
  await runtime.command(Object.fromEntries(Object.entries(queueRequest()).reverse()),{tool:true});
  await assert.rejects(runtime.command({...queueRequest(),tabId:'unrelated'},{tool:true}),/different action/);
  assert.equal(runtime.state.jobs.filter(j=>j.action==='terminal.queue').length,1);
});

test('Assistant MCP exposes native Tab delivery with the inspected session and unchanged message',async t=>{
  const {root}=await fixture(t);await fs.mkdir(path.join(root,'Assistant'));
  await fs.writeFile(path.join(root,'Assistant/connection.json'),JSON.stringify({baseURL:'http://127.0.0.1:4487/'}));
  await fs.writeFile(path.join(root,'native-server.token'),'fixture-token');
  const {action,...args}=queueRequest();const lines=[],requests=[];
  await runAssistantMCP({root,input:Readable.from([
    JSON.stringify({id:1,method:'tools/list'})+'\n',
    JSON.stringify({id:2,method:'tools/call',params:{name:'queue_in_tab',arguments:args}})+'\n']),
    output:new Writable({write(chunk,_encoding,done){lines.push(JSON.parse(chunk));done();}}),
    fetchImpl:async(url,options)=>{requests.push({url:url.href,body:JSON.parse(options.body)});return {ok:true,json:async()=>({job:{id:args.requestId,status:'agent_queued'}})};}});
  const tool=lines[0].result.tools.find(t=>t.name==='queue_in_tab');
  assert.ok(tool.inputSchema.required.includes('sessionId'));assert.match(tool.description,/pressing Tab once/);
  assert.deepEqual(requests,[{url:'http://127.0.0.1:4487/v1/assistant/tool',body:queueRequest()}]);
  assert.equal(JSON.parse(lines[1].result.content[0].text).job.status,'agent_queued');
});

test('Tab follow-ups reach working agents and distinguish native queue acceptance from each own turn',async t=>{
  const {runtime}=await fixture(t),file='/test/queue.jsonl',target={coordinator:false};
  await runtime.command({action:'terminal.send',requestId:'original',tabId:'target',text:'Original task'},{tool:true});
  await runtime.nativePoll({workerId:'worker-1'});await runtime.nativeResult({id:'original',result:{conversationPath:file}});
  const event=(type,fields={})=>({type:'event_msg',timestamp:new Date(Date.now()+1000).toISOString(),payload:{type,...fields}});
  runtime.consumeRecord(event('user_message',{message:'Original task'}),file,target);
  await prepareQueue(runtime);await acceptQueue(runtime);
  assert.equal((await runtime.job('queue-1')).status,'agent_queued');
  assert.equal((await runtime.job('queue-1')).completedAt,undefined);
  await assert.rejects(runtime.command({action:'cancel',requestId:'cancel',jobId:'queue-1'}),/already reached Terminal/);
  await prepareQueue(runtime,'queue-2');await acceptQueue(runtime,'queue-2');
  runtime.consumeRecord(event('task_complete',{turn_id:'original-turn',last_agent_message:'Original finished'}),file,target);
  assert.equal((await runtime.job('queue-1')).status,'agent_queued');
  for(const [id,turn] of [['queue-1','follow-up-1'],['queue-2','follow-up-2']]) {
    runtime.consumeRecord(event('task_started',{turn_id:turn}),file,target);
    runtime.consumeRecord(event('user_message',{message:'Authorized follow-up'}),file,target);
    // CLI emits both event_msg and response_item for one user input.
    runtime.consumeRecord({type:'response_item',timestamp:event('').timestamp,payload:{type:'message',role:'user',content:[{type:'input_text',text:'Authorized follow-up'}]}},file,target);
    assert.equal((await runtime.job(id)).status,'working');assert.ok((await runtime.job(id)).submittedAt);
    if(id==='queue-1') assert.equal((await runtime.job('queue-2')).status,'agent_queued');
    runtime.consumeRecord(event('task_complete',{turn_id:'wrong-turn',last_agent_message:'Unrelated'}),file,target);
    assert.equal((await runtime.job(id)).status,'working');
    runtime.consumeRecord(event('task_complete',{turn_id:turn,last_agent_message:'Follow-up done'}),file,target);
    assert.equal((await runtime.job(id)).status,'completed');assert.equal((await runtime.job(id)).response,'Follow-up done');
  }
});

test('uncertain native queue delivery survives restart without replay and follows late acceptance',async t=>{
  const {runtime,root,coordinator}=await fixture(t);await prepareQueue(runtime);
  const restarted=new AssistantRuntime({root,coordinator});t.after(()=>restarted.close());
  assert.equal((await restarted.nativePoll({workerId:'worker-2'})).job,null);
  assert.equal((await restarted.job('queue-1')).status,'attention');
  await restarted.command(queueRequest(),{tool:true});assert.equal((await restarted.nativePoll({workerId:'worker-2'})).job,null);
  const timestamp=new Date(Date.now()+2000).toISOString(),file='/test/queue.jsonl',target={coordinator:false};
  const event=payload=>({type:'event_msg',timestamp,payload});
  restarted.consumeRecord(event({type:'task_started',turn_id:'original-turn'}),file,target);
  restarted.consumeRecord(event({type:'user_message',message:'Authorized follow-up'}),file,target);
  assert.equal((await restarted.job('queue-1')).status,'attention');
  restarted.consumeRecord(event({type:'task_started',turn_id:'follow-up'}),file,target);
  restarted.consumeRecord(event({type:'user_message',message:'Authorized follow-up'}),file,target);
  assert.equal((await restarted.job('queue-1')).status,'working');
  await restarted.nativeResult({id:'queue-1',error:'Late native timeout'});
  restarted.consumeRecord(event({type:'task_complete',turn_id:'follow-up',last_agent_message:'Done'}),file,target);
  await restarted.nativeResult({id:'queue-1',result:{queueAccepted:true}});
  assert.equal((await restarted.job('queue-1')).status,'completed');assert.equal((await restarted.job('queue-1')).error,null);
});

test('posted Tab or empty composer alone never marks a message queued or completed',async t=>{
  const {runtime}=await fixture(t);await prepareQueue(runtime);
  await assert.rejects(runtime.nativePrepare({id:'queue-1',conversationPath:'/test/queue.jsonl',sessionId:queueSession,priorTurnId:'original-turn'}),/already prepared/);
  await runtime.nativeResult({id:'queue-1',result:{tabPosted:true,draftEmpty:true}});
  const j=await runtime.job('queue-1');assert.equal(j.status,'attention');assert.equal(j.completedAt,undefined);
  await runtime.command(queueRequest(),{tool:true});assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job,null);
});

test('an accepted queue whose tab closes becomes uncertain without automatic redelivery',async t=>{
  const {runtime}=await fixture(t);await prepareQueue(runtime);await acceptQueue(runtime);
  await runtime.nativePoll({workerId:'worker-1',catalog:{tabs:[]}});
  assert.equal((await runtime.job('queue-1')).status,'attention');
  assert.match((await runtime.job('queue-1')).error,/tab closed/);
  await runtime.command(queueRequest(),{tool:true});assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job,null);
});

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-assistant-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const calls=[];
  const coordinator={prepare:async()=>({}),run:async request=>{calls.push(request);await request.onSession('01a07d6d-4359-7361-a94b-8a651ca9858b');},stop(){}};
  let time=Date.now();const runtime=new AssistantRuntime({root,clock:()=>time,coordinator});
  await runtime.command({action:'start',requestId:'start'});
  const claimed=await runtime.nativePoll({workerId:'worker-1',catalog:{revision:1,tabs:[]}});
  assert.equal(claimed.job,null);
  assert.equal((await runtime.job('start')).status,'completed');
  t.after(()=>runtime.close());
  return {root,runtime,coordinator,calls,tick:()=>{time+=3000;}};
}

test('a reconnected phone submits the same exact message only once',async t=>{
  const {runtime}=await fixture(t);
  const command={action:'message',requestId:'voice-1',text:'Please review RoomWave.'};
  await Promise.all([runtime.command(command),runtime.command(command)]);
  const snapshot=await runtime.command({action:'state'});
  assert.equal(snapshot.messages.length,1);
  assert.equal(snapshot.messages.filter(j=>j.id==='voice-1').length,1);
  assert.equal(runtime.state.jobs.filter(j=>j.id==='voice-1').length,1);
  await assert.rejects(runtime.command({...command,text:'Different task'}),/different action/);
  await runtime.drainTask;
  assert.equal((await runtime.job('voice-1')).status,'completed');
  assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job,null);
});

test('busy project tabs preserve FIFO while the conversation remains responsive',async t=>{
  const {runtime,tick}=await fixture(t);
  for(const requestId of ['work-1','work-2'])await runtime.command({action:'terminal.send',requestId,tabId:'same-tab',text:requestId},{tool:true});
  assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job.id,'work-1');
  await runtime.nativeResult({id:'work-1',deferred:true,error:'Agent working'});
  await runtime.command({action:'message',requestId:'conversation',text:'What is running?'});
  await runtime.nativePoll({workerId:'worker-1',catalog:{revision:1,tabs:[]}});
  await runtime.drainTask;
  assert.equal((await runtime.job('conversation')).status,'completed');
  assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job,null);
  tick();assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job.id,'work-1');
});

test('host and native-worker restart preserve uncertain delivery without replay',async t=>{
  const {runtime,root,coordinator}=await fixture(t);
  await runtime.command({action:'terminal.send',tabId:'target',requestId:'uncertain',text:'Continue the patch.'},{tool:true});
  await runtime.nativePoll({workerId:'worker-1'});
  const restarted=new AssistantRuntime({root,coordinator});
  assert.equal((await restarted.nativePoll({workerId:'worker-2'})).job,null);
  assert.equal((await restarted.job('uncertain')).status,'attention');
  await restarted.command({action:'terminal.send',tabId:'target',requestId:'later',text:'Explain the current state.'},{tool:true});
  assert.equal((await restarted.nativePoll({workerId:'worker-2'})).job.id,'later');
  assert.equal((await restarted.nativePoll({workerId:'worker-3'})).job,null);
  assert.equal((await restarted.job('later')).status,'attention');
});

test('a working task leaves its tab available for watching and inspection',async t=>{
  const {runtime}=await fixture(t);
  await runtime.command({action:'terminal.send',requestId:'work',tabId:'tab',text:'Implement the requested patch.'},{tool:true});
  await runtime.nativePoll({workerId:'worker-1'});
  await runtime.nativeResult({id:'work',result:{conversationPath:'/test/work.jsonl'}});
  await runtime.command({action:'terminal.focus',requestId:'watch',tabId:'tab'});
  assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job.id,'watch');
});

test('ordinary paired requests cannot call native-worker or desktop-tool actions',async t=>{
  const {runtime}=await fixture(t);
  for(const action of ['terminal.send','terminal.insert','terminal.clear','terminal.replace','computer.clear','computer.replace','computer.input','native.poll','turn/start'])await assert.rejects(runtime.command({action,requestId:action,tabId:'x',text:'x'}),/Unsupported/);
  await assert.rejects(runtime.command({action:'message',requestId:'loop',text:'loop'},{tool:true}),/Unsupported/);
});

test('draft insertion has a durable verified receipt without submitting or replaying',async t=>{
  const {runtime}=await fixture(t);
  const request={action:'terminal.insert',sessionId:queueSession,requestId:'draft',tabId:'third',text:'hey Cody'};
  await runtime.command(request,{tool:true});
  await runtime.command(request,{tool:true});
  assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job.id,'draft');
  await runtime.nativePrepare({id:'draft',conversationPath:'/test/draft.jsonl',sessionId:queueSession,tabTitle:'contract-work-search'});
  await runtime.nativeResult({id:'draft',result:{tabId:'third',sessionId:queueSession,tabTitle:'contract-work-search',draftVerified:true,submitted:false}});
  const job=await runtime.job('draft');
  assert.equal(job.status,'inserted');assert.equal(job.result.submitted,false);
  await runtime.command(request,{tool:true});
  assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job,null);
  assert.equal(runtime.state.jobs.length,2);
  assert.equal(runtime.state.messages.length,0);
});

test('draft and submit requests keep their order while a busy tab is deferred',async t=>{
  const {runtime,tick}=await fixture(t);
  await runtime.command({action:'terminal.insert',sessionId:queueSession,requestId:'draft',tabId:'tab',text:'Leave this here'},{tool:true});
  await runtime.command({action:'terminal.send',requestId:'send',tabId:'tab',text:'A later task'},{tool:true});
  assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job.id,'draft');
  await runtime.nativeResult({id:'draft',deferred:true,error:'Agent is working'});
  assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job,null);
  tick();assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job.id,'draft');
});

test('clear and replace require an inspected input and preserve exact whitespace',async t=>{
  const {runtime}=await fixture(t);
  for(const action of ['terminal.clear','terminal.replace','computer.clear','computer.replace']) {
    const request={action,requestId:action,tabId:'tab',token:'inspection',expectedText:'Keep  spaces\n🦞',...(action.endsWith('.replace')?{text:'New  draft\nNo Enter'}:{})};
    for(const malformed of [{...request,token:''},{...request,expectedText:null},{...request,expectedText:'x'.repeat(17000)},
      {...request,expectedText:'x\u001b[A'},...(action.endsWith('.replace')?[{...request,text:'text\0'}, {...request,text:undefined}]:[{...request,text:'must not insert'}])]) {
      await assert.rejects(runtime.command(malformed,{tool:true}),/Invalid|does not accept/);
    }
    await runtime.command(request,{tool:true});
    assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job.id,action);
    await runtime.nativeResult({id:action,result:{submitted:false,inputVerified:true,text:request.text??''}});
    const job=await runtime.job(action);
    assert.equal(job.args.expectedText,'Keep  spaces\n🦞');
    assert.equal(job.status,'completed'); assert.equal(job.result.submitted,false);
    await runtime.command(request,{tool:true});
    assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job,null);
    await assert.rejects(runtime.command({...request,expectedText:'Different draft'},{tool:true}),/different action/);
  }
});

test('whole-draft authorization is explicit and part of the durable edit identity',async t=>{
  const {runtime}=await fixture(t);
  const request={action:'terminal.replace',requestId:'whole-draft',tabId:'exact-tab',token:'fresh',
    expectedText:'[Pasted Content 2400 chars]',allowWholeDraft:true,text:'Exact replacement\nSecond line'};
  await assert.rejects(runtime.command({...request,allowWholeDraft:'true'},{tool:true}),/explicit/);
  await runtime.command(request,{tool:true});
  const {job}=await runtime.nativePoll({workerId:'worker-1'});
  assert.equal(job.args.allowWholeDraft,true);
  assert.equal(job.args.expectedText,request.expectedText);
  await runtime.nativeResult({id:job.id,result:{draftVerified:true,submitted:false,text:request.text}});
  await runtime.command(request,{tool:true});
  assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job,null);
  await assert.rejects(runtime.command({...request,allowWholeDraft:false},{tool:true}),/different action/);
});

test('draft edits share tab ordering and uncertain edits survive restart without replay',async t=>{
  const {runtime,root,coordinator,tick}=await fixture(t);
  const requests=[{action:'terminal.insert',sessionId:queueSession,requestId:'first',tabId:'tab',text:'Draft'},
    {action:'terminal.clear',requestId:'clear',tabId:'tab',token:'inspected',expectedText:'Draft'},
    {action:'terminal.replace',requestId:'replace',tabId:'tab',token:'new-inspection',expectedText:'',text:'Replacement'}];
  for(const request of requests) await runtime.command(request,{tool:true});
  assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job.id,'first');
  await runtime.nativeResult({id:'first',deferred:true,error:'Busy'});
  assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job,null);
  tick(); await runtime.nativePoll({workerId:'worker-1'});
  await runtime.nativeResult({id:'first',result:{draftVerified:true,submitted:false}});
  assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job.id,'clear');
  const restarted=new AssistantRuntime({root,coordinator});
  t.after(()=>restarted.close());
  const next=await restarted.nativePoll({workerId:'worker-2'});
  assert.equal((await restarted.job('clear')).status,'attention');
  assert.equal(next.job.id,'replace');
  await restarted.nativeResult({id:'replace',error:'Inspection expired'});
  await restarted.command(requests[1],{tool:true});
  assert.equal((await restarted.nativePoll({workerId:'worker-2'})).job,null);
  assert.equal((await restarted.job('clear')).status,'attention');
});

test('voice timing attaches only bounded numeric diagnostics to the accepted user message',async t=>{
  const {runtime,root}=await fixture(t);
  await runtime.command({action:'message',requestId:'voice',text:'Original message'});
  await runtime.command({action:'voice.timing',requestId:'voice',metrics:{segments:2,transcriptionRoundTripMs:700,hostTranscriptionMs:600,manualSend:1}});
  assert.equal((await runtime.job('voice')).voiceTiming.segments,2);
  await runtime.command({action:'voice.timing',requestId:'voice',metrics:{lastWordToSubmitMs:4010,submitToResponseObservedMs:5200,submitToPlaybackMs:6100,responseToPlaybackMs:900}});
  await runtime.command({action:'voice.timing',requestId:'voice',metrics:{segments:2}});
  assert.equal((await runtime.job('voice')).voiceTiming.submitToPlaybackMs,6100);
  assert.equal((await runtime.job('voice')).voiceTiming.transcriptionRoundTripMs,700);
  assert.equal(runtime.state.messages.length,1);
  assert.equal(runtime.state.jobs.length,2);
  await assert.rejects(runtime.command({action:'voice.timing',requestId:'voice',metrics:{transcript:'private'}}),/Invalid voice timing/);
  await assert.rejects(runtime.command({action:'voice.timing',requestId:'voice',metrics:{hostQueueMs:-1}}),/Invalid voice timing/);
  await assert.rejects(runtime.command({action:'voice.timing',requestId:'voice',metrics:{hostQueueMs:Infinity}}),/Invalid voice timing/);
  await assert.rejects(runtime.command({action:'voice.timing',requestId:'missing',metrics:{}}),/not found/);
  await assert.rejects(runtime.command({action:'voice.timing',requestId:'voice',metrics:{}},{tool:true}),/Unsupported/);
  assert.equal((await fs.readFile(path.join(root,'state.json'),'utf8')).includes('private'),false);
});

test('completion belongs to the accepting tab and creates one visible coordinator update',async t=>{
  const {runtime}=await fixture(t);
  for(const tabId of ['one','two']){
    await runtime.command({action:'terminal.send',requestId:tabId,tabId,text:'Same directory, different work'},{tool:true});
    await runtime.nativePoll({workerId:'worker-1'});
    await runtime.nativeResult({id:tabId,result:{conversationPath:`/test/${tabId}.jsonl`,tabTitle:'code'}});
  }
  const timestamp=new Date(Date.now()+1000).toISOString();
  const event=payload=>({type:'event_msg',timestamp,payload});
  runtime.consumeRecord(event({type:'task_complete',last_agent_message:'Unrelated output'}),'/test/one.jsonl',{coordinator:false});
  assert.equal((await runtime.job('one')).status,'submitted');
  runtime.consumeRecord(event({type:'user_message',message:'Same directory, different work'}),'/test/one.jsonl',{coordinator:false});
  const complete=event({type:'task_complete',turn_id:'turn-1',last_agent_message:'Tests passed.'});
  runtime.consumeRecord(complete,'/test/one.jsonl',{coordinator:false});
  runtime.consumeRecord(complete,'/test/one.jsonl',{coordinator:false});
  assert.equal((await runtime.job('one')).status,'completed');
  assert.equal((await runtime.job('two')).status,'submitted');
  assert.equal(runtime.state.jobs.filter(j=>j.id==='update:one').length,1);
});

test('final response items are retained when task_complete omits response text',async t=>{
  const {runtime}=await fixture(t),file='/test/assistant.jsonl',target={coordinator:true};
  runtime.consumeRecord({type:'event_msg',payload:{type:'task_started'}},file,target);
  runtime.consumeRecord({type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{text:'Here is the answer.'}]}},file,target);
  runtime.consumeRecord({type:'event_msg',timestamp:'2026-09-07T10:00:00Z',payload:{type:'task_complete',turn_id:'answer'}},file,target);
  assert.equal(runtime.state.messages.at(-1).text,'Here is the answer.');
});

test('a fast CLI completion before the native receipt is retained and never replayed',async t=>{
  const {runtime}=await fixture(t),file='/test/fast.jsonl';
  await runtime.command({action:'terminal.send',tabId:'target',requestId:'fast',text:'Hello'},{tool:true});
  await runtime.command({action:'terminal.send',tabId:'target',requestId:'next',text:'Hello'},{tool:true});
  await runtime.nativePoll({workerId:'worker-1'});
  await runtime.nativePrepare({id:'fast',conversationPath:file,sessionId:'session',tabTitle:'Assistant'});
  const timestamp=new Date(Date.now()+1000).toISOString();
  runtime.consumeRecord({type:'event_msg',timestamp,payload:{type:'user_message',message:'Hello'}},file,{coordinator:true});
  assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job,null);
  runtime.consumeRecord({type:'event_msg',timestamp,payload:{type:'task_complete',turn_id:'fast-turn',last_agent_message:'Hello back'}},file,{coordinator:true});
  await runtime.nativeResult({id:'fast',result:{conversationPath:file}});
  assert.equal((await runtime.job('fast')).status,'completed');
  assert.equal((await runtime.job('next')).status,'queued');
  assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job.id,'next');
});

test('current Codex response_item user records attribute completion to the accepting turn',async t=>{
  const {runtime}=await fixture(t),file='/test/current-cli.jsonl';
  await runtime.command({action:'terminal.send',tabId:'target',requestId:'current',text:'Check the patch.\n'},{tool:true});
  await runtime.nativePoll({workerId:'worker-1'});
  await runtime.nativePrepare({id:'current',conversationPath:file,sessionId:'session',tabTitle:'Assistant'});
  const timestamp=new Date(Date.now()+1000).toISOString(),target={coordinator:true};
  runtime.consumeRecord({type:'event_msg',timestamp,payload:{type:'task_started',turn_id:'owned'}},file,target);
  runtime.consumeRecord({type:'response_item',timestamp,payload:{type:'message',role:'user',content:[{type:'input_text',text:'Check the patch.'}]}},file,target);
  assert.equal((await runtime.job('current')).status,'working');
  runtime.consumeRecord({type:'event_msg',timestamp,payload:{type:'task_complete',turn_id:'other',last_agent_message:'Unrelated'}},file,target);
  assert.equal((await runtime.job('current')).status,'working');
  runtime.consumeRecord({type:'event_msg',timestamp,payload:{type:'task_complete',turn_id:'owned',last_agent_message:'Checked'}},file,target);
  assert.equal((await runtime.job('current')).status,'completed');
});

test('screenshots remain transient and do not expand the durable conversation store',async t=>{
  const {runtime,root}=await fixture(t);
  await runtime.command({action:'computer.capture',requestId:'screen'},{tool:true});
  await runtime.nativePoll({workerId:'worker-1'});
  await runtime.nativeResult({id:'screen',result:{imageBase64:'private-image-bytes',width:100}});
  assert.equal((await runtime.job('screen')).result.imageBase64,'private-image-bytes');
  assert.equal((await fs.readFile(path.join(root,'state.json'),'utf8')).includes('private-image-bytes'),false);
  assert.equal(JSON.stringify(await runtime.command({action:'state'})).includes('private-image-bytes'),false);
});

test('paused control leaves pending jobs cancellable and preserves the conversation',async t=>{
  const {runtime}=await fixture(t);
  await runtime.command({action:'terminal.send',tabId:'target',requestId:'pending',text:'Please implement it.'},{tool:true});
  await runtime.command({action:'pause',requestId:'pause',paused:true});
  assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job,null);
  await runtime.command({action:'cancel',requestId:'cancel',jobId:'pending'});
  assert.equal((await runtime.job('pending')).status,'cancelled');
  assert.equal((await runtime.job('pending')).args.text,'Please implement it.');
});

test('MCP sends the exact authorized prompt to the local Terminal queue and returns a durable receipt',async t=>{
  const {root}=await fixture(t);
  await fs.mkdir(path.join(root,'Assistant'));
  await fs.writeFile(path.join(root,'Assistant/connection.json'),JSON.stringify({baseURL:'http://127.0.0.1:4487'}));
  await fs.writeFile(path.join(root,'native-server.token'),'fixture-token');
  const frames=[{id:1,method:'initialize'},{id:2,method:'tools/list'},
    {id:3,method:'tools/call',params:{name:'send_to_tab',arguments:{tabId:'tab-two',text:'Please review the existing patch.',requestId:'stable-request'}}},
    {id:4,method:'tools/call',params:{name:'insert_in_tab',arguments:{tabId:'tab-three',sessionId:queueSession,text:'hey Cody',requestId:'stable-draft'}}},
    ...['clear_tab_input','replace_tab_input','clear_input','replace_input'].map((name,i)=>({id:5+i,method:'tools/call',params:{name,arguments:{
      token:'fresh-input',expectedText:'Original  draft',requestId:name,...(name.includes('tab')?{tabId:'tab-three'}:{}),
      ...(name.startsWith('replace')?{text:'Replacement\n🦞'}:{})}}}))];
  const requests=[],lines=[];
  await runAssistantMCP({root,input:Readable.from(frames.map(f=>JSON.stringify(f)+'\n')),
    output:new Writable({write(chunk,_encoding,done){lines.push(JSON.parse(chunk));done();}}),
    fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);requests.push({url:url.href,body});assert.equal(options.headers.authorization,'Bearer fixture-token');return {ok:true,json:async()=>({job:{id:body.requestId,status:'queued'}})};}});
  assert.equal(lines[0].result.serverInfo.name,'clawdad-assistant');
  assert.ok(lines[1].result.tools.some(t=>t.name==='inspect_tab'));
  assert.ok(lines[1].result.tools.some(t=>t.name==='insert_in_tab'));
  for(const name of ['clear_tab_input','replace_tab_input','clear_input','replace_input']) {
    const tool=lines[1].result.tools.find(t=>t.name===name);
    assert.ok(tool.inputSchema.required.includes('expectedText'));
    assert.ok(tool.inputSchema.required.includes('token'));
    assert.match(tool.description,/WITHOUT Enter/);
  }
  assert.deepEqual(requests,[{url:'http://127.0.0.1:4487/v1/assistant/tool',body:{tabId:'tab-two',text:'Please review the existing patch.',requestId:'stable-request',action:'terminal.send'}},
    {url:'http://127.0.0.1:4487/v1/assistant/tool',body:{tabId:'tab-three',sessionId:queueSession,text:'hey Cody',requestId:'stable-draft',action:'terminal.insert'}},
    ...['terminal.clear','terminal.replace','computer.clear','computer.replace'].map((action,i)=>({url:'http://127.0.0.1:4487/v1/assistant/tool',body:{...frames[4+i].params.arguments,action}}))]);
  assert.equal(JSON.parse(lines[2].result.content[0].text).job.id,'stable-request');
  assert.equal(JSON.parse(lines[3].result.content[0].text).job.id,'stable-draft');
});

test('busy draft insertion reaches the Mac immediately and follows a later manual Tab exactly once',async t=>{
  const {runtime,root,coordinator}=await fixture(t),file='/test/busy-draft.jsonl',target={coordinator:false};
  await runtime.command({action:'terminal.send',requestId:'working',tabId:'target',text:'Ongoing task'},{tool:true});
  await runtime.nativePoll({workerId:'worker-1'});
  await runtime.nativeResult({id:'working',result:{conversationPath:file}});
  let stamp=Date.now()+1000;
  const event=(type,fields={})=>({type:'event_msg',timestamp:new Date(stamp++).toISOString(),payload:{type,...fields}});
  runtime.consumeRecord(event('task_started',{turn_id:'original'}),file,target);
  runtime.consumeRecord(event('user_message',{message:'Ongoing task'}),file,target);
  const text='Please review this entire long draft.\n'+ 'Unicode 🦞 é and exact spaces  '.repeat(80);
  const request={action:'terminal.insert',requestId:'review',tabId:'target',sessionId:queueSession,text};
  await runtime.command(request,{tool:true});
  assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job.id,'review');
  await runtime.nativePrepare({id:'review',conversationPath:file,sessionId:queueSession,priorTurnId:'original'});
  await runtime.nativeResult({id:'review',result:{tabId:'target',sessionId:queueSession,draftVerified:true,submitted:false,expandedTextReadBack:false}});
  assert.equal((await runtime.job('review')).status,'inserted');
  assert.equal((await runtime.job('working')).status,'working');
  assert.equal((await runtime.job('review')).submittedAt,undefined);
  await runtime.command(request,{tool:true});assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job,null);
  const restarted=new AssistantRuntime({root,coordinator});t.after(()=>restarted.close());await restarted.load();
  assert.equal((await restarted.job('review')).status,'inserted');
  restarted.consumeRecord(event('task_started',{turn_id:'manual-tab-turn'}),file,target);
  restarted.consumeRecord(event('user_message',{message:text}),file,target);
  restarted.consumeRecord(event('user_message',{message:text}),file,target);
  assert.equal((await restarted.job('review')).status,'working');
  restarted.consumeRecord(event('task_complete',{turn_id:'manual-tab-turn',last_agent_message:'Reviewed.'}),file,target);
  restarted.consumeRecord(event('task_complete',{turn_id:'manual-tab-turn',last_agent_message:'Reviewed.'}),file,target);
  assert.equal((await restarted.job('review')).status,'completed');
  assert.equal(restarted.state.jobs.filter(j=>j.id==='update:review').length,1);
});

test('an unverified draft receipt cannot claim insertion and never retries automatically',async t=>{
  const {runtime}=await fixture(t);
  const request={action:'terminal.insert',requestId:'uncertain-draft',tabId:'target',sessionId:queueSession,text:'Preserve this'};
  await runtime.command(request,{tool:true});await runtime.nativePoll({workerId:'worker-1'});
  await runtime.nativeResult({id:request.requestId,result:{submitted:false}});
  assert.equal((await runtime.job(request.requestId)).status,'attention');
  await runtime.command(request,{tool:true});assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job,null);
});

test('diagnostic delivery has durable receipts without creating visible tasks or completion announcements',async t=>{
  const {runtime}=await fixture(t),file='/test/diagnostic.jsonl';
  await runtime.command({action:'terminal.send',requestId:'fixture',tabId:'target',text:'Internal fixture only',diagnostic:true},{tool:true});
  await runtime.nativePoll({workerId:'worker-1'});await runtime.nativeResult({id:'fixture',result:{conversationPath:file}});
  const event=(type,fields={})=>({type:'event_msg',timestamp:new Date(Date.now()+1000).toISOString(),payload:{type,...fields}});
  runtime.consumeRecord(event('user_message',{message:'Internal fixture only'}),file,{coordinator:false});
  runtime.consumeRecord(event('task_complete',{last_agent_message:'Internal result'}),file,{coordinator:false});
  assert.equal((await runtime.job('fixture')).status,'completed');
  assert.equal(runtime.state.jobs.some(j=>j.id==='update:fixture'),false);
  assert.equal(runtime.snapshot().tasks.length,0);assert.equal(runtime.snapshot().messages.length,0);
});
