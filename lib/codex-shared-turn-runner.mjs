import fs from 'node:fs/promises';
import path from 'node:path';
import {CodexSharedClient,assertSharedThreadOwner,acquireThreadControl,validThreadId} from './codex-thread-control.mjs';
import {verifyAppAccountRuntime} from './codex-app-account-status.mjs';
import {agentPermissionParams,defaultAgentAccess} from './agent-access-settings.mjs';
import {prepareAgentTools,verifyAgentToolConfiguration} from './agent-tool-context.mjs';
import {serverRequestResultFromDecision} from './codex-app-server-dispatch.mjs';
import {randomUUID} from 'node:crypto';
import {researchSave} from './research-budget.mjs';
import {AssistantWorkProgress} from './assistant-work-policy.mjs';

// One client and one durable receipt per accepted turn. Disconnects are read
// back by exact turn ID; turn/start is never retried after wire uncertainty.
export class CodexSharedTurnRunner {
  constructor({root,resolveAccountLaunch,accessSettings,createClient=()=>new CodexSharedClient(),
    verifyAccount=verifyAppAccountRuntime,assertOwner=assertSharedThreadOwner,lease=acquireThreadControl,workPolicy={}}={}){
    Object.assign(this,{root,resolveAccountLaunch,accessSettings,createClient,verifyAccount,assertOwner,lease,workPolicy});
    this.active=new Map();this.pendingApprovals=new Map();this.stopped=false;
  }
  async run({id,text,images=[],sessionId,cwd=this.root,modelConfig,signal,onSession=async()=>{},onMessage=async()=>{},onProgress=async()=>{},
    nativeTools=true,disableTools=false,config={},policy:requestedPolicy,outputSchema,ephemeral=false,source='assistant'}){
    if(this.stopped)throw Error('ClawDad is stopping. This request is saved.');
    signal?.throwIfAborted();
    if(!id||this.active.has(id))throw Error('This accepted request is already running.');
    if(sessionId&&!validThreadId(sessionId))throw Error('The saved conversation identity is invalid.');
    const policy=requestedPolicy||await this.accessSettings?.resolve()||{...defaultAgentAccess};
    const permission=agentPermissionParams(policy,cwd),client=this.createClient();
    const file=path.join(this.root,'Turns',id+'.json');
    let receipt;
    try{receipt=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    if(receipt)throw Error('This request already has a delivery receipt. Reconcile it before sending another request; nothing was replayed.');
    receipt={version:1,id,threadId:sessionId||null,status:'preparing',policy,modelConfig,source,createdAt:new Date().toISOString()};
    await researchSave(file,receipt);
    const save=async()=>researchSave(file,receipt);
    const progress=new AssistantWorkProgress(this.workPolicy),seen=new Set();
    let tools,claim,turnId,threadId=sessionId,finished=false,events=Promise.resolve(),failure,terminal,pending=[],lastStage='',lastProgressSavedAt=0;
    const processEvent=async event=>{
      const p=event.params||{};if(p.threadId!==threadId||!turnId)return;
      if((p.turnId||p.turn?.id)&& (p.turnId||p.turn.id)!==turnId)return;
      const item=p.item;
      if(event.method==='item/completed'&&item?.type==='agentMessage'&&item.text?.trim()&&!seen.has(item.id)){
        await onMessage({id:item.id,text:item.text});seen.add(item.id);
      }
      if(event.method==='turn/completed'){terminal=p.turn;}
      if(event.method==='error'&&!p.willRetry)failure=p.error?.message||'Codex could not finish this turn.';
      const type=event.method==='turn/started'?'turn.started':event.method==='turn/completed'?'turn.completed':event.method.startsWith('item/')?'item.updated':null;
      if(type&&progress.observe({type,item:item?{...item,type:{mcpToolCall:'mcp_tool_call',commandExecution:'command_execution'}[item.type]||item.type}:{id:p.itemId,event:event.method,delta:p.delta}})){
        const status=progress.status();
        if(status.stage!==lastStage||Date.now()-lastProgressSavedAt>5000){lastStage=status.stage;lastProgressSavedAt=Date.now();await onProgress(status);}
      }
    };
    const enqueue=e=>{events=events.then(()=>processEvent(e)).catch(error=>{failure=error.message;});};
    client.onNotification=e=>{if(!turnId)pending.push(e);else enqueue(e);};
    client.onServerRequest=m=>{
      const dispatch=()=>{
        if(m.params?.threadId!==threadId||m.params?.turnId!==turnId){client.discardServerRequest(m.id);return;}
        if(m.method==='currentTime/read'){client.respond(m.id,{currentTimeAt:Math.floor(Date.now()/1000)});return;}
        const key=randomUUID();this.pendingApprovals.set(key,{key,client,message:m,userRequestId:id});
        void onProgress({...progress.status(),stage:'awaiting_approval',message:'Open Agent access in Settings to answer this request.'});
      };
      // An approval can precede the turn/start response on the same socket.
      if(!turnId)pending.push({approval:dispatch});else void dispatch();
    };
    const interrupt=async()=>{if(turnId&&!finished)await client.request('turn/interrupt',{threadId,turnId});};
    const active={interrupt,cancelled:false};this.active.set(id,active);
    const abort=()=>{active.cancelled=true;void interrupt().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
    try{
      const launch=await this.resolveAccountLaunch?.({requestId:id,kind:source});
      if(!launch)throw Error('Activate a ChatGPT subscription account in ClawDad before starting this request.');
      await client.connect();await this.verifyAccount({socketPath:client.socketPath,launch});
      if(disableTools){
        const current=await client.request('config/read',{includeLayers:false});
        for(const name of Object.keys(current.config?.mcp_servers||{}))config[`mcp_servers.${name}.enabled`]=false;
      }
      if(threadId){claim=await this.lease(threadId);await this.assertOwner(client,threadId);
        const read=await client.request('thread/read',{threadId});
        if(read.thread.status?.type==='active')throw Error('This conversation is already working. Its current turn was preserved.');
      }
      if(nativeTools)tools=await prepareAgentTools({root:this.root,threadId,requestId:id,text,policy,source});
      const params={cwd,...permission.thread,model:modelConfig.model,modelProvider:'openai',config:{...config,...tools?.config}};
      if(threadId)await client.request('thread/unsubscribe',{threadId});
      const loaded=await client.request(threadId?'thread/resume':'thread/start',threadId?{...params,threadId}:{...params,ephemeral});
      if(!validThreadId(loaded.thread?.id)||(threadId&&loaded.thread.id!==threadId))throw Error('Codex returned a different conversation identity.');
      threadId=loaded.thread.id;receipt.threadId=threadId;
      if(tools)await verifyAgentToolConfiguration(client,threadId,policy);
      await onSession(threadId);await tools?.bind(threadId);await save();
      signal?.throwIfAborted();if(active.cancelled||this.stopped)throw Error('This request was stopped before delivery.');
      await this.verifyAccount({socketPath:client.socketPath,launch});
      receipt.status='sending';await save();
      signal?.throwIfAborted();if(active.cancelled||this.stopped)throw Error('This request was stopped before delivery.');
      const started=await client.request('turn/start',{threadId,clientUserMessageId:id,
        input:[{type:'text',text,text_elements:[]},...images.map(image=>({type:'localImage',path:image}))],
        model:modelConfig.model,effort:modelConfig.reasoningEffort,...permission.turn,...(outputSchema?{outputSchema}:{})});
      turnId=started.turn?.id;if(!turnId)throw Object.assign(Error('Turn acceptance is uncertain. Inspect this request; it will not be replayed.'),{uncertain:true});
      receipt.turnId=turnId;receipt.status='working';await save();await tools?.bind(threadId,turnId);
      for(const event of pending.splice(0))event.approval?void event.approval():enqueue(event);
      await claim?.release();claim=null;
      let lastPoll=Date.now();
      while(!terminal){
        await events;
        if(failure)throw Error(failure);
        if(signal?.aborted||active.cancelled||this.stopped){await interrupt();throw Error('This response was interrupted. Saved messages and accepted actions are preserved.');}
        if(progress.status().stalled){await interrupt();throw Error('Codex stopped reporting progress. Inspect this saved turn before continuing.');}
        if(Date.now()-lastPoll>10000){
          lastPoll=Date.now();
          const page=await client.request('thread/turns/list',{threadId,limit:5,itemsView:'full',sortDirection:'desc'});
          const turn=page.data?.find(t=>t.id===turnId);
          if(!turn)throw Error('The accepted turn could not be reconciled. Its request will not be replayed.');
          for(const item of turn.items||[])if(item.type==='agentMessage')enqueue({method:'item/completed',params:{threadId,turnId,item}});
          if(['completed','failed','interrupted'].includes(turn.status))terminal=turn;
        }
        if(!terminal)await new Promise(resolve=>setTimeout(resolve,150));
      }
      await events;
      if(terminal.status!=='completed')throw Error(terminal.error?.message||`Codex turn ${terminal.status}.`);
      finished=true;receipt.status='completed';receipt.completedAt=new Date().toISOString();await save();
      return {sessionId:threadId,turnId,policy};
    }catch(error){receipt.uncertain=receipt.status==='sending'||!!turnId||!!error.uncertain;receipt.status='attention';receipt.error=error.message;
      await save();throw error;
    }finally{
      if(!finished&&turnId)await interrupt().catch(()=>{});
      signal?.removeEventListener('abort',abort);await tools?.close();await claim?.release();client.close();this.active.delete(id);
    }
  }
  cancel(id){const active=this.active.get(id);if(!active)return false;active.cancelled=true;void active.interrupt().catch(()=>{});return true;}
  approvals(){
    const result=[];for(const [key,entry] of this.pendingApprovals){
      if(!entry.client.hasServerRequest(entry.message.id)){this.pendingApprovals.delete(key);continue;}
      result.push({id:key,userRequestId:entry.userRequestId,method:entry.message.method,params:entry.message.params});
    }return result;
  }
  decide({approvalId,decision,answers,content}){
    const entry=this.pendingApprovals.get(approvalId);
    if(!entry||!entry.client.hasServerRequest(entry.message.id))throw Error('This decision is no longer pending. Refresh its current state.');
    if(!['approve','decline'].includes(decision))throw Error('Choose Allow once or Decline.');
    if(entry.message.method==='item/tool/requestUserInput'&&(!answers||!(entry.message.params.questions||[]).every(q=>Array.isArray(answers[q.id]?.answers))))
      throw Error('Answer each question before submitting.');
    const result=serverRequestResultFromDecision(entry.message,{decision,answers,content});
    if(!entry.client.respond(entry.message.id,result))throw Error('The requesting connection closed. No decision was sent.');
    this.pendingApprovals.delete(approvalId);return {accepted:true,approvalId};
  }
  stop(){this.stopped=true;for(const id of this.active.keys())this.cancel(id);}
}
