import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {CodexSharedTurnRunner} from '../lib/codex-shared-turn-runner.mjs';
import {prepareAgentTools,readAgentToolOrigin} from '../lib/agent-tool-context.mjs';
const threadId='01a0b590-77a9-7102-b769-f0192b71ff55',turnId='01a0b590-7a1b-7290-aa18-629174d51d2b';
const policy={mode:'full',reviewer:'auto_review',nativeTools:true,computerUse:true};
async function fixture(t,{rejectAuth=false,uncertain=false,resume=false,question=false}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'shared-turn-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const calls=[],pending=new Set();let requestId;
  const client={connect:async()=>{},close(){pending.clear();},hasServerRequest:id=>pending.has(id),discardServerRequest:id=>pending.delete(id),
    respond(id,result){calls.push(['answer',result]);pending.delete(id);this.onNotification({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}});return true;},
    async request(method,args){calls.push([method,args]);
      if(method==='thread/read')return {thread:{id:threadId,status:{type:'idle'}}};
      if(method==='thread/start'||method==='thread/resume')return {thread:{id:threadId}};
      if(method==='thread/unsubscribe')return {status:'notSubscribed'};
      if(method==='mcpServerStatus/list')return {data:[{name:'clawdad_assistant',tools:{computer:{name:'computer'}}}]};
      if(method==='turn/start'){
        requestId=args.clientUserMessageId;
        if(uncertain)throw Object.assign(Error('Acknowledgement lost'),{uncertain:true});
        // The actual socket can deliver items/questions before its RPC result.
        this.onNotification({method:'item/completed',params:{threadId,turnId,item:{type:'agentMessage',id:'one',text:'Result'}}});
        if(question){pending.add(7);this.onServerRequest({id:7,method:'item/tool/requestUserInput',params:{threadId,turnId,questions:[{id:'q',question:'Which file?'}]}});}
        else this.onNotification({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}});
        return {turn:{id:turnId}};
      }
      if(method==='thread/turns/list')return {data:[{id:turnId,status:'inProgress',items:[{type:'userMessage',clientId:requestId}]}]};
      if(method==='turn/interrupt')return {};
      throw Error(method);
    }};
  const runner=new CodexSharedTurnRunner({root,createClient:()=>client,resolveAccountLaunch:async()=>({account:{key:'safe'},env:{CODEX_HOME:'/selected'}}),
    verifyAccount:async()=>{if(rejectAuth)throw Error('Account mismatch');},assertOwner:async()=>{},lease:async()=>({release:async()=>{}})});
  const args={id:randomUUID(),text:'Exact user message',nativeTools:false,modelConfig:{model:'test',reasoningEffort:'low'},...(resume?{sessionId:threadId}:{})};
  return {root,client,runner,args,calls};
}
test('shared runner preserves resumed identity and exact input, streams once and never starts twice',async t=>{
  const f=await fixture(t,{resume:true}),messages=[];
  const result=await f.runner.run({...f.args,onMessage:async m=>messages.push(m)});
  assert.equal(result.sessionId,threadId);assert.equal(result.turnId,turnId);assert.equal(messages.length,1);
  const params=f.calls.find(([m])=>m==='turn/start')[1];assert.equal(params.input[0].text,f.args.text);assert.equal(params.clientUserMessageId,f.args.id);
  assert.equal(params.sandboxPolicy.type,'dangerFullAccess');assert.equal(params.approvalsReviewer,'auto_review');
  assert.equal(f.calls.find(([m])=>m==='thread/resume')[1].modelProvider,'openai');
  await assert.rejects(f.runner.run(f.args),/already has a delivery receipt/);assert.equal(f.calls.filter(([m])=>m==='turn/start').length,1);
});
test('wrong authentication stops before loading or dispatching a model turn',async t=>{
  const f=await fixture(t,{rejectAuth:true});await assert.rejects(f.runner.run(f.args),/Account mismatch/);assert.equal(f.calls.length,0);
});
test('native tools must actually load before a resumed turn can start',async t=>{
  const f=await fixture(t,{resume:true});
  await f.runner.run({...f.args,nativeTools:true});
  const methods=f.calls.map(([method])=>method);
  assert.ok(methods.indexOf('thread/unsubscribe')<methods.indexOf('thread/resume'));
  assert.ok(methods.indexOf('mcpServerStatus/list')<methods.indexOf('turn/start'));
  const failed=await fixture(t,{resume:true}),request=failed.client.request.bind(failed.client);
  failed.client.request=(method,args)=>method==='mcpServerStatus/list'?Promise.resolve({data:[]}):request(method,args);
  await assert.rejects(failed.runner.run({...failed.args,nativeTools:true}),/has not loaded/);
  assert.equal(failed.calls.some(([method])=>method==='turn/start'),false);
});
test('uncertain turn acceptance persists and is never retried',async t=>{
  const f=await fixture(t,{uncertain:true});await assert.rejects(f.runner.run(f.args),/Acknowledgement lost/);
  const receipt=JSON.parse(await fs.readFile(path.join(f.root,'Turns',f.args.id+'.json')));assert.equal(receipt.uncertain,true);
  await assert.rejects(f.runner.run(f.args),/already has a delivery receipt/);assert.equal(f.calls.filter(([m])=>m==='turn/start').length,1);
});
test('questions arriving before turn acknowledgement require the exact user answer',async t=>{
  const f=await fixture(t,{question:true}),run=f.runner.run(f.args);
  for(let i=0;i<100&&!f.runner.approvals().length;i++)await new Promise(r=>setTimeout(r,5));
  const question=f.runner.approvals()[0];assert.ok(question);
  assert.throws(()=>f.runner.decide({approvalId:question.id,decision:'approve'}),/Answer each/);
  f.runner.decide({approvalId:question.id,decision:'approve',answers:{q:{answers:['report.txt']}}});await run;
  assert.deepEqual(f.calls.find(([m])=>m==='answer')[1],{answers:{q:{answers:['report.txt']}}});
  assert.throws(()=>f.runner.decide({approvalId:question.id,decision:'approve'}),/no longer pending/);
});
test('persistent tool handles follow only their active accepted user turn and close after completion',async t=>{
  const f=await fixture(t);const first=await prepareAgentTools({root:f.root,threadId,requestId:f.args.id,text:'first',policy,
    authorizationText:'Original user instruction',authorizationSource:'user'});await first.bind(threadId,turnId);
  const client={close(){},request:async()=>({data:[{id:turnId,status:'inProgress',items:[{type:'userMessage',clientId:f.args.id}]}]})};
  const options={createClient:()=>client};const origin=await readAgentToolOrigin(f.root,first.contextId,options);
  assert.equal(origin.text,'first');assert.equal(origin.authorizationText,'Original user instruction');
  await first.close();await assert.rejects(readAgentToolOrigin(f.root,first.contextId,options),/no active/);
  const next=await prepareAgentTools({root:f.root,threadId,requestId:randomUUID(),text:'next',policy});await next.bind(threadId,turnId);
  await first.close();
  const current=JSON.parse(await fs.readFile(path.join(f.root,'AgentTools',next.contextId+'.json')));
  assert.equal(current.status,'active');assert.equal(current.text,'next');
  assert.equal(first.contextId,next.contextId);await assert.rejects(readAgentToolOrigin(f.root,next.contextId,options),/no longer belongs/);
});
