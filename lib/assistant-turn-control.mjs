import {createHash} from 'node:crypto';
import {classifyThreadOwner,rpcPages,validThreadId} from './codex-thread-control.mjs';

export const isTurnControl=action=>['appserver.steer','appserver.interrupt'].includes(action);
const terminal=new Set(['completed','failed','interrupted']);
const pending=new Set(['prepared','sent_unconfirmed','accepted_same_turn','interrupt_requested','uncertain']);
export const pendingTurnControl=job=>isTurnControl(job.action)&&pending.has(job.controlReceipt?.state);
export const observeTurnControl=job=>pendingTurnControl(job)||(isTurnControl(job.action)&&job.controlReceipt?.state==='observed_in_turn'&&!terminal.has(job.controlReceipt.targetTurnStatus));
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value);
const failure=(reasonCode,message)=>Object.assign(Error(message),{reasonCode});
const clean=(value,max)=>typeof value==='string'&&value.trim()&&Buffer.byteLength(value)<=max&&!value.includes('\0');

// The host serializes its durable store. These controls never enter its message
// dispatcher, acquire a turn-lifetime delivery claim or become an approval owner.
export class AssistantTurnControl {
  constructor(host){this.host=host;this.unsupported=new Set();}
  stamp(){return new Date(this.host.now()).toISOString();}
  async generation(owner){
    const h=this.host,generation=await h.readControlGeneration(h.client,owner);
    if(!generation||!['computer','endpoint','providerHome','processLifetime','socketGeneration'].every(k=>clean(generation[k],4096))
      ||generation.pid!==owner.pid||!Number.isSafeInteger(generation.uid))throw failure('owner_unverified','The complete server generation is unavailable.');
    const admission=await h.accountControls?.admission();
    if(h.accountControls&&(!admission||!Number.isSafeInteger(admission.epoch)))throw failure('account_unverified','The app account epoch is unavailable.');
    return {...generation,accountEpoch:admission?.epoch??null};
  }
  async capture(threadId){
    const h=this.host,[read,owners,loaded]=await Promise.all([
      h.client.request('thread/read',{threadId,includeTurns:true}),
      h.readOwners({socketPath:h.client.socketPath}),rpcPages(h.client,'thread/loaded/list',{limit:100})]);
    const thread=read.thread,owner=classifyThreadOwner(threadId,owners,loaded);
    if(thread?.id!==threadId||!Array.isArray(thread.turns))throw failure('turn_history_unavailable','Exact turn history is unavailable.');
    if(!['app_server','saved'].includes(owner.kind))throw failure('foreign_runtime_owner',owner.reason);
    const identity=await this.generation(owner);
    return {thread,owner,identity,connectionId:h.client.connectionIdentity?.id};
  }
  active(thread){return thread.turns.filter(t=>t.status==='inProgress');}
  async inspect(thread,owner){
    const observedAt=this.stamp(),active=Array.isArray(thread.turns)?this.active(thread):[];
    const activeTurn=active.length===1?{id:active[0].id,status:active[0].status}:null;
    const result={activeTurn,observedAt,activeFlags:thread.status?.activeFlags||[],canAcceptDirectInput:thread.canAcceptDirectInput===true,
      canSteer:false,canInterrupt:false};
    try{
      if(owner.kind!=='app_server'||thread.status?.type!=='active'||active.length!==1||!clean(activeTurn.id,256))
        throw failure('active_turn_unavailable','A single active turn owned by this app server is required.');
      const identity=await this.generation(owner),key=canonical(identity);
      if(typeof this.host.client.requestPinned!=='function')throw Error('This connection cannot pin an exact turn control.');
      result.canSteer=result.canAcceptDirectInput&&!this.unsupported.has(key+':appserver.steer');
      result.canInterrupt=!this.unsupported.has(key+':appserver.interrupt');
      return {...result,binding:{identity,turnId:activeTurn.id}};
    }catch(error){return {...result,controlUnavailable:error.message};}
  }
  validate(action,args,requestId){
    const steer=action==='appserver.steer',turnKey=steer?'expectedTurnId':'turnId';
    const allowed=new Set(['threadId',turnKey,'targetToken','approvalText',...(steer?['text']:[])]);
    if(Object.keys(args).some(k=>!allowed.has(k)))throw Error('Unsupported turn-control field. This action supports literal text only and never consumes drafts or attachments.');
    if(!validThreadId(requestId))throw Error('Use one stable request UUID for this exact control.');
    if(!validThreadId(args.threadId)||!clean(args[turnKey],256)||!clean(args.targetToken,128)||!clean(args.approvalText,8000))
      throw Error('Use the exact inspected thread, active turn, fresh token and current user authorization.');
    if(steer&&!clean(args.text,32000))throw Error('Supply the literal authorized steering text (up to 32 KB).');
    // Tokens expire, intents do not. Returning an existing receipt requires no
    // fresh token, account admission or repeat authorization/dispatch.
    return canonical({action,threadId:args.threadId,turnId:args[turnKey],approvalText:args.approvalText,...(steer?{text:args.text}:{})});
  }
  async authorize(meta,action,args){
    if(typeof meta.authorize!=='function')throw Error('Turn controls require the current explicit user instruction through the Assistant.');
    const authority=await meta.authorize();
    if(!authority?.userRequestId||authority.approvalText!==args.approvalText||authority.action!==action
      ||authority.threadId!==args.threadId||authority.turnId!==(args.expectedTurnId||args.turnId)||!/^[a-f0-9]{64}$/.test(authority.userTextHash||''))
      throw Error('The user authorization does not match this exact turn control.');
    return authority;
  }
  summarize(job){
    const r=job.controlReceipt;
    const summaries={prepared:'Prepared; no native acceptance is claimed.',sent_unconfirmed:'Sent; native acceptance is unconfirmed.',
      accepted_same_turn:'Codex accepted the context for this exact active turn; recorded input is still awaiting verification.',
      observed_in_turn:'The exact context was recorded once in this same turn. This does not prove how the agent used it.',
      interrupt_requested:'Codex acknowledged the stop request; the exact turn has not yet been observed interrupted.',
      interrupted_observed:'This exact turn is interrupted. Command and downstream tool termination are unverified. Completed effects remain; queued work and supervisors retain their own controls.',
      already_finished:'This exact turn had already finished. No successor was stopped.',
      rejected:'This control was rejected. It was not converted into a message or queued follow-up.',
      uncertain:'The outcome is uncertain. Reconcile this original receipt; it will never be replayed automatically.'};
    job.result={threadId:job.threadId,turnId:job.turnId,controlState:r.state,summary:summaries[r.state],
      nativeAcknowledged:!!r.acknowledgedAt,recordedInput:r.state==='observed_in_turn',
      interruptionObserved:r.state==='interrupted_observed',targetTurnStatus:r.targetTurnStatus??null,
      ...(job.action==='appserver.interrupt'?{cancellation:{
        request:r.acknowledgedAt?'acknowledged':r.sentAt?'sent_unconfirmed':'not_sent',
        turn:r.state==='interrupted_observed'?'interrupted':r.targetTurnStatus??'unknown',
        nativeCommandTermination:'unknown',downstreamToolTermination:'unknown',rollbackPerformed:false,
        explanation:'Turn interruption does not prove process termination. Native commands and provider-owned tools may continue; completed effects are not rolled back.'}}:{}),
      remainingWork:r.remainingWork??null};
    job.uncertain=r.state==='uncertain'||r.state==='sent_unconfirmed';
    job.status=['observed_in_turn','interrupted_observed','already_finished'].includes(r.state)?'completed':
      ['rejected','uncertain'].includes(r.state)?'attention':r.state==='prepared'?'sending':'submitted';
    return job;
  }
  async save(job){this.summarize(job);return this.host.changed(job);}
  async remaining(threadId){
    const h=this.host;
    const native=await rpcPages(h.client,'thread/queue/list',{threadId,limit:100})
      .then(data=>({available:true,items:data.map(q=>({id:q.id,clientUserMessageId:q.clientUserMessageId??null}))}))
      .catch(error=>({available:false,reason:error.message}));
    return {observedAt:this.stamp(),native,localWaitingRequestIds:h.state.jobs.filter(j=>j.threadId===threadId&&j.status==='queued').map(j=>j.id),
      guidance:'This control leaves queue entries, waiting requests, drafts and supervisors unchanged. Their normal owners may dispatch later.'};
  }
  checkTarget(job,snapshot,identity){
    const {thread,owner}=snapshot,r=job.controlReceipt;
    if(canonical(snapshot.identity)!==canonical(identity))throw failure('server_generation_changed','The inspected server lifetime, socket, provider home or account epoch changed. Recovery requires a fresh inspection.');
    const active=this.active(thread),target=thread.turns.find(t=>t.id===job.turnId);
    r.targetTurnStatus=target?.status??null;
    if(active.some(t=>t.id!==job.turnId)||active.length>1)throw failure('stale_turn','A different or ambiguous turn is now active. It was left alone.');
    if(!active.length&&target&&terminal.has(target.status)){
      if(job.action==='appserver.interrupt'){r.state='already_finished';r.finishedBeforeDispatch=true;return false;}
      throw failure('turn_finished','The inspected turn finished before receiving this context. Choose any later message separately.');
    }
    if(owner.kind!=='app_server'||thread.status?.type!=='active'||active.length!==1||active[0].id!==job.turnId)
      throw failure('active_turn_unavailable','The exact inspected turn is no longer verifiably active.');
    if(job.action==='appserver.steer'&&thread.canAcceptDirectInput!==true)throw failure('direct_input_unavailable','This active turn cannot accept direct input.');
    if(this.unsupported.has(canonical(identity)+':'+job.action))throw failure('unsupported_method','This server does not support this turn control.');
    return true;
  }
  async control(action,args,requestId,meta){
    const h=this.host,fp=this.validate(action,args,requestId),previous=h.state.jobs.find(j=>j.id===requestId);
    if(previous){if(previous.fingerprint!==fp)throw Error('This request ID already belongs to a different action.');return {job:structuredClone(previous)};}
    const authorization=await this.authorize(meta,action,args),steer=action==='appserver.steer';
    const inspected=h.inspections.get(args.targetToken);
    const {authorize:_,...origin}=meta;
    const job={...origin,id:requestId,action,args:structuredClone(args),fingerprint:fp,threadId:args.threadId,turnId:args.expectedTurnId||args.turnId,
      status:'sending',createdAt:this.stamp(),controlReceipt:{version:1,kind:steer?'steer':'interrupt',state:'prepared',authorization,
        requestId,clientUserMessageId:steer?requestId:null,inputHash:steer?hash(args.text):null}};
    let claim,wirePossible=false;
    try{
      const persist=async admission=>{Object.assign(job,admission);h.state.jobs.push(job);await h.save();return job;};
      if(h.accountControls?.withWorkAdmission)await h.accountControls.withWorkAdmission({id:requestId,action,fingerprint:fp,
        parentRequestId:meta.accountParentRequestId,expectedEpoch:inspected?.control?.identity.accountEpoch??null},persist);
      else {await h.accountControls?.assertAdmission?.();await persist({});}
      await h.onJob(structuredClone(job));
      claim=await h.lease(args.threadId);
      h.inspections.delete(args.targetToken);
      if(!inspected?.control||inspected.threadId!==args.threadId||inspected.control.turnId!==job.turnId
        ||h.now()-inspected.at>45000||h.now()<inspected.at)throw failure('stale_inspection','The active-turn inspection expired, was consumed or targets a different turn. Inspect again; no control was sent.');
      const identity=inspected.control.identity,snapshot=await this.capture(args.threadId),r=job.controlReceipt;
      r.targetIdentity=identity;r.before={observedAt:this.stamp(),threadStatus:snapshot.thread.status,turnId:job.turnId,
        canAcceptDirectInput:snapshot.thread.canAcceptDirectInput,draftRevision:h.state.drafts[args.threadId]?.revision??0};
      if(!this.checkTarget(job,snapshot,identity))return this.save(job);
      r.remainingWork=await this.remaining(args.threadId);
      await this.save(job);
      await h.accountControls?.assertDelivery?.(job);
      if(!await h.mayDispatch(job))throw failure('control_paused','Mac control is paused or account delivery is held.');
      const againAuthority=await this.authorize(meta,action,args);
      if(canonical(againAuthority)!==canonical(authorization))throw failure('authorization_changed','The authorizing user message changed before dispatch.');
      const fresh=await this.capture(args.threadId);
      if(!this.checkTarget(job,fresh,identity))return this.save(job);
      if(h.now()-inspected.at>45000)throw failure('stale_inspection','The active-turn inspection expired before dispatch.');
      if(typeof h.client.requestPinned!=='function'||!fresh.connectionId)throw failure('connection_unverified','The exact inspected connection cannot be pinned.');
      r.state='sent_unconfirmed';r.sentAt=this.stamp();r.rpcRequestId='clawdad-turn-control:'+requestId;
      await this.save(job); // A crash after this write is uncertain, never retryable.
      wirePossible=true;
      const result=await h.client.requestPinned(steer?'turn/steer':'turn/interrupt',steer?
        {threadId:job.threadId,expectedTurnId:job.turnId,input:[{type:'text',text:args.text}],clientUserMessageId:requestId}:
        {threadId:job.threadId,turnId:job.turnId},{connectionId:fresh.connectionId,requestId:r.rpcRequestId,
          dispatch:send=>meta.authorize(current=>{
            if(canonical(current)!==canonical(authorization))throw failure('authorization_changed','The authorizing user message changed at dispatch.');
            return send();
          })});
      r.acknowledgment=result;
      if(steer&&result?.turnId!==job.turnId)throw failure('returned_turn_mismatch','Codex acknowledged a different turn. Preserve this receipt for recovery.');
      r.acknowledgedAt=this.stamp();r.state=steer?'accepted_same_turn':'interrupt_requested';
      await this.save(job);
      await this.reconcile(job);
      h.start();return {job:structuredClone(job)};
    }catch(error){
      if(!h.state.jobs.includes(job))h.state.jobs.push(job);
      const r=job.controlReceipt;
      const explicitRejection=[-32600,-32601,-32602].includes(error.rpcCode);
      r.state=wirePossible&&!error.notSent&&!explicitRejection?'uncertain':'rejected';
      r.dispatchDisposition=!wirePossible||error.notSent?'not_sent':explicitRejection?'provider_rejected':'unconfirmed';
      r.rejection=error.rpcCode!==undefined?{code:error.rpcCode,message:error.message}:null;
      if(error.rpcCode===-32601&&r.targetIdentity)this.unsupported.add(canonical(r.targetIdentity)+':'+action);
      job.error=error.message;job.reasonCode=error.reasonCode||error.code||'turn_control_failed';
      // A terminal race can be resolved by readback after a native rejection.
      // This cannot turn a rejection into a claim that this request stopped it.
      if(!steer&&error.rpcCode===-32600&&r.targetIdentity){try{
        const snapshot=await this.capture(job.threadId),target=snapshot.thread.turns.find(t=>t.id===job.turnId);
        if(canonical(snapshot.identity)===canonical(r.targetIdentity)&&target&&terminal.has(target.status)){
          r.state='already_finished';r.targetTurnStatus=target.status;r.targetTurnObservedAt=this.stamp();
          r.evidence={source:'thread/read_after_rejection',threadId:job.threadId,turnId:job.turnId,status:target.status,observedAt:this.stamp()};
          job.error='Codex rejected the old turn control; this exact turn had already finished. No successor was stopped.';
        }
      }catch{ /* The rejection remains the only established outcome. */ }}
      await this.save(job);
      if(pendingTurnControl(job))h.start();
      return {job:structuredClone(job)};
    }finally{await claim?.release();}
  }
  async reconcile(job){
    if(!observeTurnControl(job))return {job:structuredClone(job)};
    const r=job.controlReceipt;
    const proven=r.state==='observed_in_turn';
    if(!r.sentAt){r.state='rejected';job.error='The control stopped before wire dispatch. Nothing will be sent on recovery.';return this.save(job);}
    try{
      const snapshot=await this.capture(job.threadId);
      if(canonical(snapshot.identity)!==canonical(r.targetIdentity))throw failure('server_generation_changed','The original server generation changed. Preserve this receipt for recovery; it will not be replayed.');
      const turns=snapshot.thread.turns,target=turns.find(t=>t.id===job.turnId);
      r.reconciledAt=this.stamp();r.targetTurnStatus=target?.status??null;r.targetTurnObservedAt=this.stamp();
      if(proven){
        // Delivery evidence is immutable even if the later outcome cannot be
        // read. Updating the original turn does not re-complete the steer.
        delete job.connectionNotice;return this.save(job);
      }
      if(job.action==='appserver.steer'){
        const matches=turns.flatMap(turn=>(turn.items||[]).filter(i=>i.type==='userMessage'&&(i.clientId===job.id||i.clientUserMessageId===job.id)).map(item=>({turn,item})));
        if(matches.length){
          const {turn,item}=matches[0],content=item.content;
          if(matches.length!==1||turn.id!==job.turnId||!Array.isArray(content)||content.length!==1||content[0].type!=='text'||typeof content[0].text!=='string'||hash(content[0].text)!==r.inputHash)
            throw failure('input_evidence_conflict','The client message ID has duplicate, wrong-turn or different-content evidence. Review the original receipt.');
          r.state='observed_in_turn';r.evidence={source:'thread/read',threadId:job.threadId,turnId:job.turnId,itemId:item.id??null,
            clientUserMessageId:job.id,inputHash:r.inputHash,observedAt:this.stamp()};
        }else if(!r.acknowledgedAt||!target||terminal.has(target.status)){
          r.state='uncertain';job.error='The exact context is not yet visible in this turn. An absent item does not establish non-delivery; do not resend.';
        }
      }else if(target&&terminal.has(target.status)){
        r.state=target.status==='interrupted'?'interrupted_observed':'already_finished';
        r.evidence={source:'thread/read',threadId:job.threadId,turnId:job.turnId,status:target.status,observedAt:this.stamp(),
          attribution:'Observed outcome; the protocol does not identify which client caused interruption.'};
      }else if(!r.acknowledgedAt||!target){r.state='uncertain';job.error='Interruption of the exact turn is unconfirmed. Reconcile this receipt without repeating the request.';}
      if(['observed_in_turn','interrupted_observed','already_finished'].includes(r.state)){job.error=null;job.reasonCode=null;r.resolvedAt=this.stamp();}
      delete job.connectionNotice;
    }catch(error){if(proven){job.connectionNotice='Context delivery is verified; the original turn outcome is unavailable: '+error.message;return this.save(job);}
      r.state='uncertain';job.error=error.message;job.reasonCode=error.reasonCode||'readback_unavailable';
      r.recoveryRequired=error.reasonCode==='server_generation_changed'||error.reasonCode==='foreign_runtime_owner';}
    return this.save(job);
  }
  recover(job){
    const r=job.controlReceipt;if(!r||!pendingTurnControl(job))return;
    if(r.state==='prepared'&&!r.sentAt){r.state='rejected';job.error='The app restarted before this control was dispatched. No control will be sent on recovery.';}
    else if(r.state==='sent_unconfirmed'){r.state='uncertain';job.error='The app restarted before acknowledgment. Reconcile the original receipt; it will not be replayed.';}
    this.summarize(job);
  }
}
