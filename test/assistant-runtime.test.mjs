import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AssistantRuntime} from '../lib/assistant-runtime.mjs';
import {runAssistantMCP} from '../lib/assistant-mcp.mjs';
import {Readable, Writable} from 'node:stream';

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
  assert.equal(snapshot.tasks.filter(j=>j.id==='voice-1').length,1);
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
  const request={action:'terminal.insert',requestId:'draft',tabId:'third',text:'hey Cody'};
  await runtime.command(request,{tool:true});
  await runtime.command(request,{tool:true});
  assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job.id,'draft');
  await runtime.nativeResult({id:'draft',result:{tabId:'third',tabTitle:'contract-work-search',draftVerified:true,submitted:false}});
  const job=await runtime.job('draft');
  assert.equal(job.status,'completed');assert.equal(job.result.submitted,false);
  await runtime.command(request,{tool:true});
  assert.equal((await runtime.nativePoll({workerId:'worker-1'})).job,null);
  assert.equal(runtime.state.jobs.length,2);
  assert.equal(runtime.state.messages.length,0);
});

test('draft and submit requests keep their order while a busy tab is deferred',async t=>{
  const {runtime,tick}=await fixture(t);
  await runtime.command({action:'terminal.insert',requestId:'draft',tabId:'tab',text:'Leave this here'},{tool:true});
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

test('draft edits share tab ordering and uncertain edits survive restart without replay',async t=>{
  const {runtime,root,coordinator,tick}=await fixture(t);
  const requests=[{action:'terminal.insert',requestId:'first',tabId:'tab',text:'Draft'},
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
    {id:4,method:'tools/call',params:{name:'insert_in_tab',arguments:{tabId:'tab-three',text:'hey Cody',requestId:'stable-draft'}}},
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
    {url:'http://127.0.0.1:4487/v1/assistant/tool',body:{tabId:'tab-three',text:'hey Cody',requestId:'stable-draft',action:'terminal.insert'}},
    ...['terminal.clear','terminal.replace','computer.clear','computer.replace'].map((action,i)=>({url:'http://127.0.0.1:4487/v1/assistant/tool',body:{...frames[4+i].params.arguments,action}}))]);
  assert.equal(JSON.parse(lines[2].result.content[0].text).job.id,'stable-request');
  assert.equal(JSON.parse(lines[3].result.content[0].text).job.id,'stable-draft');
});
