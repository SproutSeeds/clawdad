import {randomUUID} from 'node:crypto';

const failure=(code,message)=>Object.assign(Error(message),{code});
// Adapts only the deterministic private account mailbox. No public Assistant
// tool can manufacture an account transition, source draft or target profile.
export class CodexAccountNativeDriver {
  constructor({transport,identities,permit,verifyPending=async()=>false,clock=Date.now,waitMs=60000}={}){
    Object.assign(this,{transport,identities,permit,verifyPending,clock,waitMs});
  }
  async call(operationId,action,args,requestId=randomUUID()){
    let receipt=await this.transport.enqueue({operationId,requestId,action,args});
    const deadline=this.clock()+this.waitMs;
    while(this.clock()<deadline){
      if(receipt.state==='completed')return receipt.result;
      if(['attention','not_dispatched'].includes(receipt.state))throw failure(receipt.reasonCode||'native_account_action_uncertain',
        'The exact native account action needs reconciliation. Its input and receipt are preserved.');
      await new Promise(resolve=>setTimeout(resolve,75));receipt=await this.transport.inspect(requestId);
    }
    throw failure('native_account_receipt_pending','The native account-control receipt is still pending. Keep its original request ID; do not repeat the action.');
  }
  identity(value){
    if(value.kind!=='agent')return value;
    // Email is read from this live process's deliberately executed /status;
    // a CODEX_HOME path alone is never treated as cached account identity.
    const matches=this.identities.filter(identity=>identity.email===value.status?.email&&identity.method==='chatgpt'&&identity.verified===true);
    if(matches.length!==1)throw failure('cached_account_identity_ambiguous','The live process account does not uniquely match the verified subscription identities. Preserve it and review its workspace.');
    return {...value,accountKey:matches[0].accountKey,accountVerified:true};
  }
  async capture({operationId,source}){
    let observed=await this.call(operationId,'observe',{source});
    if(observed.kind!=='agent')throw failure('agent_owner_unavailable','This exact tab is no longer an established agent. Its shell was preserved.');
    if(observed.busy!==false||observed.queueEmpty!==true)throw failure('agent_work_pending','Let the current work and native queue finish before account capture.');
    observed=await this.call(operationId,'status',{source:observed});
    const pendingReceiptsResolved=await this.verifyPending(observed);
    return {...this.identity(observed),pendingReceiptsResolved};
  }
  async observe({operationId,source,target}){
    let value=await this.call(operationId,'observe',{source});
    if(value.kind==='agent'&&value.settingsVerified!==true){
      // Only the captured owner, or this operation's proven new owner, may have
      // its draft temporarily held for a fresh local /status read.
      if(value.processIdentity!==source.processIdentity){
        if(value.sessionId!==source.sessionId||value.directory!==source.directory||value.authorizationHome!==target.authorizationHome
          ||!value.launchRequestId||!await this.verifyOwnership({operationId,requestId:value.launchRequestId,source,target,observed:value}))
          throw failure('handoff_owner_unverified','The new process is not bound to this switch. No account inspection keys were sent.');
      }
      value=await this.call(operationId,'status',{source:value});
    }
    return {...this.identity(value),pendingReceiptsResolved:await this.verifyPending(value)};
  }
  async reconcile({requestId}){
    const value=await this.transport.inspect(requestId);
    // An absent native request also proves it never reached this dispatcher.
    return {requestId,durable:true,state:!value||value.state==='not_dispatched'?'not_dispatched':value.state};
  }
  async verifyOwnership({operationId,requestId,source,target,observed}){
    const receipt=await this.transport.inspect(requestId);
    return !!receipt&&receipt.operationId===operationId&&receipt.action==='launch'&&receipt.preparedAt!=null
      &&receipt.args.source.sessionId===source.sessionId&&receipt.args.source.tabLifetime===source.tabLifetime
      &&receipt.args.target.authorizationHome===target.authorizationHome&&observed.launchRequestId===requestId
      &&(!receipt.result?.processIdentity||receipt.result.processIdentity===observed.processIdentity);
  }
  async action(effect,{operationId,requestId,source,target,owner}){
    const existing=await this.transport.inspect(requestId);
    if(existing?.state==='not_dispatched')await this.transport.retryUnsent(requestId);
    let args={source,target};
    if(effect==='draft'){
      const current=await this.call(operationId,'observe',{source});
      if(current.processIdentity!==owner||current.sessionId!==source.sessionId||current.draft?.text!=='')
        throw failure('draft_recovery_target_changed','The restored input changed. The separately saved draft was preserved.');
      args={source:current,text:source.draft.text};
    }
    const result=await this.call(operationId,effect,args,requestId);
    return {state:effect==='stop'?'exited':effect==='launch'?'started':'inserted',result};
  }
  stopIdle(args){return this.action('stop',args);}
  resumeExact(args){return this.action('launch',args);}
  restoreDraft(args){return this.action('draft',args);}
}
