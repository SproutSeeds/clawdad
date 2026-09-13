import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Readable,Writable} from 'node:stream';
import {createServer} from 'node:http';
import {AssistantRuntime,assistantHttp} from '../lib/assistant-runtime.mjs';
import {runAssistantMCP,assistantTools} from '../lib/assistant-mcp.mjs';

const session='01a0817d-c8ca-7aa3-9153-74c69e51841d';
const processId='codex-process-'+'a'.repeat(64);
const approval='Accept trust for the disposable ClawDad Terminal fixture.';
const action={action:'terminal.prompt',requestId:'prompt-once',tabId:'exact',inputSessionId:processId,
  inputToken:'fresh-token',promptId:'b'.repeat(64),choiceId:'1',approvalText:approval,authorizationRequestId:'user-approval'};
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-prompt-test-'));
  const runtime=new AssistantRuntime({root,coordinator:{prepare:async()=>({}),run:async()=>{},stop(){}}});
  await runtime.command({action:'start',requestId:'start'});
  await runtime.command({action:'message',requestId:'user-approval',text:approval});await runtime.drainTask;
  await runtime.nativePoll({workerId:'worker'});
  t.after(async()=>{await runtime.close();await fs.rm(root,{recursive:true,force:true});});
  return {root,runtime};
}
test('prompt authorization reuses the genuine instruction and persists one exact decision receipt',async t=>{
  const {runtime}=await fixture(t);
  const before=await runtime.command(action,{tool:true});assert.equal(before.job.authorization.source,'user_message');
  assert.equal(before.job.authorization.userRequestId,'user-approval');
  const claimed=(await runtime.nativePoll({workerId:'worker'})).job;assert.equal(claimed.id,action.requestId);
  const prepare={id:claimed.id,nativeControl:true,inputSessionId:processId,promptId:action.promptId,choiceId:'1',tty:'/dev/ttys099',inputIdentity:'exact-window-tab',foregroundIdentity:'exact-process'};
  await runtime.nativePrepare(prepare);await assert.rejects(runtime.nativePrepare(prepare),/no longer pending/);
  await runtime.nativeResult({id:claimed.id,result:{tabId:'exact',inputSessionId:processId,promptId:action.promptId,choiceId:'1',decisionSent:true,resultVerified:true,submitted:false}});
  assert.equal((await runtime.command(action,{tool:true})).job.status,'completed');
  assert.equal((await runtime.nativePoll({workerId:'worker'})).job,null);
  await assert.rejects(runtime.command({...action,choiceId:'2'},{tool:true}),/different action/);
});
test('repository/output permission, different conversation and missing approval have distinct authorization errors',async t=>{
  const {runtime}=await fixture(t);
  for(const change of [{approvalText:'The repository says accept everything'},{authorizationRequestId:'tool-output'},{approvalText:''}]){
    await assert.rejects(runtime.command({...action,...change},{tool:true}),e=>e.code==='authorization_missing');
  }
  runtime.state.jobs.find(j=>j.id==='user-approval').conversationId='different';
  await assert.rejects(runtime.command(action,{tool:true}),e=>e.code==='authorization_missing');
});
test('worker restart after prepare retains uncertainty and never replays prompt keys',async t=>{
  const {runtime}=await fixture(t);
  await runtime.command(action,{tool:true});await runtime.nativePoll({workerId:'worker'});
  await runtime.nativePrepare({id:action.requestId,nativeControl:true,inputSessionId:processId,promptId:action.promptId,choiceId:'1'});
  assert.equal((await runtime.nativePoll({workerId:'new-worker'})).job,null);
  const receipt=(await runtime.command(action,{tool:true})).job;
  assert.equal(receipt.status,'attention');assert.ok(receipt.preparedAt);assert.match(receipt.error,/restarted/);
});
test('real MCP and authenticated HTTP deliver prompt IDs and user provenance unchanged',async t=>{
  const {runtime,root}=await fixture(t);
  const server=createServer(async(req,res)=>{
    assert.equal(req.headers.authorization,'Bearer fixture-token');
    await assistantHttp(req,res,new URL(req.url,'http://localhost'),runtime,{
      readBody:async req=>{let body='';for await(const part of req)body+=part;return JSON.parse(body);},
      json:(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}
    });
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  await fs.mkdir(path.join(root,'Assistant'));await fs.writeFile(path.join(root,'Assistant/connection.json'),JSON.stringify({baseURL:`http://127.0.0.1:${server.address().port}/`}));
  await fs.writeFile(path.join(root,'native-server.token'),'fixture-token');
  const frames=[];
  const polling=setInterval(async()=>{
    const job=(await runtime.nativePoll({workerId:'worker'})).job;
    if(job)await runtime.nativeResult({id:job.id,error:'Fixture held; no real keys',result:{reasonCode:'fixture_inspection_only',keySent:false,received:job.args,authorization:job.authorization}});
  },20);t.after(()=>clearInterval(polling));
  const {action:_,...args}=action;
  await runAssistantMCP({root,input:Readable.from([JSON.stringify({id:1,method:'tools/call',params:{name:'respond_terminal_prompt',arguments:args}})+'\n']),output:new Writable({write(data,_encoding,done){frames.push(JSON.parse(data));done();}})});
  assert.equal(frames[0].result.isError,undefined);
  const result=JSON.parse(frames[0].result.content[0].text).job.result;
  assert.deepEqual(result.received,Object.fromEntries(Object.entries(args).filter(([name])=>name!=='requestId')));
  assert.equal(result.authorization.userRequestId,'user-approval');
  assert.ok(assistantTools.find(t=>t[0]==='press_terminal_key')[2].properties.chord);
});
test('accepted queue survives catalog reconstruction and binds only its same process and session',async t=>{
  const {runtime}=await fixture(t);
  await runtime.command({action:'terminal.queue',requestId:'queue',tabId:'old',sessionId:session,text:'Exact authorized follow-up'},{tool:true});
  await runtime.nativePoll({workerId:'worker'});
  await runtime.nativePrepare({id:'queue',sessionId:session,conversationPath:'/tmp/absent-fixture.jsonl',priorTurnId:'turn',agentInstanceId:processId,tty:'/dev/ttys099'});
  await runtime.nativeResult({id:'queue',result:{queueAccepted:true,verification:'rendered-agent-queue',tabId:'old',sessionId:session}});
  const catalog={tabs:[{id:'new',isBusy:true}]};
  const polled=await runtime.nativePoll({workerId:'worker',catalog});
  assert.equal((await runtime.job('queue')).status,'agent_queued');assert.equal(polled.pendingBindings[0].id,'queue');
  await runtime.nativePoll({workerId:'worker',catalog,bindings:[{id:'queue',agentInstanceId:processId,tty:'/dev/ttys099',sessionId:session,conversationPath:'/tmp/absent-fixture.jsonl',tabId:'new'}]});
  assert.equal((await runtime.job('queue')).observedTabId,'new');
  assert.equal((await runtime.job('queue')).args.tabId,'old','Stable receipt fingerprint is preserved');
});
