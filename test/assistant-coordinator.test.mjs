import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {AssistantCoordinator,assistantExecArguments,assistantWorkspaceInstructions} from '../lib/assistant-coordinator.mjs';
import {AssistantRuntime} from '../lib/assistant-runtime.mjs';

const id='01a07d6d-4359-7361-a94b-8a651ca9858b';
const catalog={revision:7,selectedTabId:'one',tabs:[
  {id:'one',title:'code',detail:'Window 1 · Tab 1',isBusy:false},
  {id:'two',title:'code',detail:'Window 1 · Tab 2',isBusy:false},
]};
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-call-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const script=path.join(root,'fixture.mjs'),spawns=[];
  await fs.writeFile(script,`
    let text='';for await(const part of process.stdin)text+=part;
    const event=value=>process.stdout.write(JSON.stringify(value)+'\\n');
    if(text==='failure'){process.stderr.write('private CLI diagnostic');process.exit(1);}
    event({type:'thread.started',thread_id:text==='wrong-session'?'01a07d6d-4359-7361-a94b-8a651ca9858c':'${id}'});
    if(text==='wait'){await new Promise(r=>setTimeout(r,60_000));}
    event({type:'item.completed',item:{id:'early',type:'agent_message',text:'Received: '+text}});
    if(text==='two-parts')await new Promise(r=>setTimeout(r,80));
    event({type:'item.completed',item:{id:'final',type:'agent_message',text:'Finished'}});
    event({type:'turn.completed'});
  `);
  const make=()=>new AssistantCoordinator({root,codexPath:process.execPath,spawnImpl:(command,args,options)=>{
    spawns.push({command,args,options});return spawn(command,[script,...args],options);
  }});
  return {root,spawns,make};
}
async function ready(runtime){
  await runtime.command({action:'start',requestId:'start'});
  await runtime.nativePoll({workerId:'native-1',catalog});
  await runtime.drainTask;
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('upgrades refresh only the owned Terminal tool guidance and preserve workspace instructions',async t=>{
  const {root,make}=await fixture(t);
  const custom='# My Assistant\nKeep my exact instructions.\n';
  await fs.writeFile(path.join(root,'AGENTS.md'),custom);
  await make().prepare();
  const updated=await fs.readFile(path.join(root,'AGENTS.md'),'utf8');
  assert.ok(updated.startsWith(custom));
  assert.match(updated,/insert_in_tab/);
  assert.match(updated,/without submitting/);
  assert.equal(assistantWorkspaceInstructions(updated),updated);
  assert.match(assistantWorkspaceInstructions(updated.replace('insert_in_tab','obsolete_insert')),/insert_in_tab/);
  assert.equal(updated.includes('sandbox_mode'),false);
});

test('CLI arguments use an explicit conversation model, exact session, and stdin without a shell',()=>{
  const args=assistantExecArguments({root:'/Users/test/Library/Application Support/ClawDad/Assistant',sessionId:id,
    nodePath:'/a "quoted"/node',mcpPath:'/test/a\\b/mcp.mjs'});
  assert.equal(args[0],'exec');assert.equal(args.at(-1),'-');
  assert.equal(args[args.indexOf('resume')+1],id);
  assert.equal(args[args.indexOf('--model')+1],'gpt-6-astra');
  assert.ok(args.includes('model_reasoning_effort="low"'));
  assert.ok(args.includes('sandbox_mode="read-only"'));
  assert.ok(args.includes('mcp_servers.clawdad_assistant.required=true'));
  assert.equal(JSON.parse(args.find(a=>a.startsWith('mcp_servers.clawdad_assistant.args=')).split('=').slice(1).join('='))[0],'/test/a\\b/mcp.mjs');
  assert.throws(()=>assistantExecArguments({root:'/tmp/assistant',sessionId:'--last'}),/invalid/);
});

test('repeated call starts prepare one conversation without spawning or creating Terminal commands',async t=>{
  const {root,spawns,make}=await fixture(t),runtime=new AssistantRuntime({root,coordinator:make()});
  t.after(()=>runtime.close());
  for(let i=0;i<20;i++)await runtime.command({action:'start',requestId:`start-${i}`});
  const snapshot=await runtime.command({action:'state'});
  assert.equal(snapshot.coordinator.mode,'background');assert.equal(snapshot.coordinator.reasoningEffort,'low');
  assert.equal(spawns.length,0);
  assert.equal((await runtime.nativePoll({workerId:'native-1'})).job,null);
  assert.equal((await fs.readdir(root)).some(file=>file.endsWith('.command')),false);
});

test('speech messages wait for the shared inventory and preserve duplicate-directory tab identities',async t=>{
  const {root,spawns,make}=await fixture(t),runtime=new AssistantRuntime({root,coordinator:make()});
  t.after(()=>runtime.close());
  await runtime.command({action:'start',requestId:'start'});
  await runtime.command({action:'message',requestId:'voice',text:'Which code tab is selected?'});
  await runtime.drainTask;assert.equal(spawns.length,0);
  const poll=await runtime.nativePoll({workerId:'native-1',catalog});assert.equal(poll.job,null);
  await runtime.drainTask;
  assert.equal(spawns.length,1);
  assert.deepEqual((await runtime.command({action:'state'})).catalog,catalog);
  assert.equal((await runtime.job('voice')).status,'completed');
});

test('a reconnect resumes the same saved CLI conversation and preserves exact speech text',async t=>{
  const {root,spawns,make}=await fixture(t),runtime=new AssistantRuntime({root,coordinator:make()});
  await ready(runtime);
  const request={action:'message',requestId:'first',text:'Literal `text` $(unchanged) "hello"\nSecond line.'};
  await Promise.all([runtime.command(request),runtime.command(request)]);await runtime.drainTask;
  assert.equal(spawns.length,1);assert.equal(spawns[0].options.shell,false);
  assert.ok((await runtime.command({action:'state'})).messages.some(m=>m.text===`Received: ${request.text}`));
  await runtime.close();
  const restarted=new AssistantRuntime({root,coordinator:make()});t.after(()=>restarted.close());
  await ready(restarted);await restarted.command({action:'message',requestId:'second',text:'Continue our conversation.'});
  await restarted.drainTask;
  assert.equal(spawns.length,2);
  assert.equal(spawns[1].args[spawns[1].args.indexOf('resume')+1],id);
  assert.equal((await restarted.command({action:'state'})).coordinator.sessionId,id);
});

test('native project work can run while the conversational CLI is still responding',async t=>{
  const {root,make}=await fixture(t),runtime=new AssistantRuntime({root,coordinator:make()});t.after(()=>runtime.close());
  await ready(runtime);await runtime.command({action:'message',requestId:'chat',text:'wait'});
  while(!runtime.coordinator.child)await settle();
  await runtime.command({action:'terminal.send',requestId:'work',tabId:'two',text:'The approved project task.'},{tool:true});
  const claimed=await runtime.nativePoll({workerId:'native-1',catalog});
  assert.equal(claimed.job.id,'work');assert.equal(claimed.job.args.tabId,'two');
  await runtime.nativePrepare({id:'work',conversationPath:'/fixture/two.jsonl',sessionId:'project',tabTitle:'code'});
  await runtime.nativeResult({id:'work',result:{}});
  assert.equal((await runtime.job('work')).status,'submitted');
  assert.equal((await runtime.job('chat')).status,'running');
});

test('completed speech parts are published in order before the full turn finishes',async t=>{
  const {make}=await fixture(t),coordinator=make(),parts=[];let earlyAt=0;
  const start=Date.now();
  await coordinator.run({text:'two-parts',onSession:async()=>{},onMessage:async m=>{
    parts.push(m.text);if(parts.length===1)earlyAt=Date.now();
  }});
  assert.deepEqual(parts,['Received: two-parts','Finished']);assert.ok(Date.now()-earlyAt>=60);
  assert.ok(earlyAt>=start);
});

test('a second runtime cannot start a concurrent conversation process',async t=>{
  const {make,spawns}=await fixture(t),first=make(),second=make();
  const running=first.run({text:'wait',onSession:async()=>{},onMessage:async()=>{}});
  while(!first.child)await settle();
  await assert.rejects(second.run({text:'second',onSession:async()=>{},onMessage:async()=>{}}),/already processing/);
  assert.equal(spawns.length,1);first.stop();await assert.rejects(running);
});

test('shutdown kills only the owned process and releases its conversation lock',async t=>{
  const {root,make}=await fixture(t),coordinator=make();
  const running=coordinator.run({text:'wait',onSession:async()=>{},onMessage:async()=>{}});
  while(!coordinator.child)await settle();coordinator.stop();await assert.rejects(running);
  assert.equal(coordinator.child,null);await assert.rejects(fs.access(path.join(root,'conversation.lock')));
  await assert.rejects(coordinator.run({text:'later'}),/stopping/);
});

test('a failed turn is not replayed and raw process diagnostics stay off the phone',async t=>{
  const {root,spawns,make}=await fixture(t),runtime=new AssistantRuntime({root,coordinator:make()});t.after(()=>runtime.close());
  await ready(runtime);const request={action:'message',requestId:'failure',text:'failure'};
  await runtime.command(request);await runtime.drainTask;await runtime.command(request);await runtime.drainTask;
  assert.equal(spawns.length,1);assert.equal((await runtime.job('failure')).status,'attention');
  assert.equal(JSON.stringify(await runtime.command({action:'state'})).includes('private CLI diagnostic'),false);
});

test('a mismatched resume identity is rejected before its answer reaches the conversation',async t=>{
  const {make}=await fixture(t),coordinator=make(),parts=[];
  await assert.rejects(coordinator.run({text:'wrong-session',sessionId:id,onSession:async()=>{},onMessage:async m=>parts.push(m)}),/different Assistant conversation/);
  assert.equal(parts.length,0);
});

test('migration retires failed window starts and preserves history without adopting a live Terminal session',async t=>{
  const {root,spawns,make}=await fixture(t);
  await fs.writeFile(path.join(root,'state.json'),JSON.stringify({version:1,enabled:true,paused:false,
    coordinator:{tty:'/dev/ttys007',sessionId:id},messages:[{id:'old',role:'user',text:'Keep this conversation.',createdAt:'2026-09-07'}],
    jobs:[{id:'old-start',action:'start',status:'attention',error:'Finish startup in Terminal',args:{}}]}));
  const runtime=new AssistantRuntime({root,coordinator:make()});t.after(()=>runtime.close());
  await ready(runtime);const snapshot=await runtime.command({action:'state'});
  assert.equal(snapshot.messages[0].text,'Keep this conversation.');
  assert.equal(snapshot.coordinator.sessionId,undefined);assert.equal(snapshot.coordinator.tty,undefined);
  assert.equal((await runtime.job('old-start')).status,'cancelled');assert.equal(spawns.length,0);
});
