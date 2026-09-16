import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {acquireCodexDeliveryClaim} from './codex-delivery-claim.mjs';
import {researchSave} from './research-budget.mjs';

const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const copy=v=>structuredClone(v);
const clean=(v,max=254)=>typeof v==='string'&&v.trim()&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const requestID=v=>clean(v,160)&&/^[A-Za-z0-9_.:-]+$/.test(v);
const rejected=message=>Object.assign(Error(message),{accountRequestRejected:true});
const validWork=work=>work&&typeof work==='object'&&!Array.isArray(work)&&Object.entries(work).every(([id,e])=>
  e&&e.id===id&&requestID(id)&&clean(e.action,100)&&/^[a-f0-9]{64}$/.test(e.fingerprint||'')
  &&Number.isSafeInteger(e.epoch)&&e.epoch>=0&&clean(e.status,100)&&typeof e.committed==='boolean'
  &&(e.hold===null||requestID(e.hold))&&(e.readOnly===undefined||typeof e.readOnly==='boolean'));
const validState=state=>state?.version===1&&Number.isSafeInteger(state.revision)&&state.revision>=0
  &&Number.isSafeInteger(state.epoch)&&state.epoch>=0&&Array.isArray(state.accounts)
  &&state.operations&&state.requests&&(!state.activeOperationId||state.operations[state.activeOperationId])
  &&(!Object.hasOwn(state,'work')||validWork(state.work))
  &&(state.selectionRevision===undefined||Number.isSafeInteger(state.selectionRevision)&&state.selectionRevision>=0);
const terminal=new Set(['completed','cancelled','needs_setup']);
const textHash=text=>createHash('sha256').update(text).digest('hex');
const settledWork=new Set(['completed','cancelled','inserted','cleared','replaced']);
const pendingWork=new Set(['queued','sending','running','submitted','working','agent_queued','attention','interrupted']);

// A future verified adapter supplies recoverable input, not arbitrary runtime
// state. Keep this projection explicit so credentials and callback data cannot
// accidentally be serialized with a process recovery record.
function recoveryRecord(observed, captured) {
  if(captured?.fingerprint!==observed.fingerprint||!Array.isArray(captured.entries)
    ||captured.entries.length!==observed.consumers.length)throw Error('Incomplete recovery capture');
  const entries=observed.consumers.map(owner=>{
    const matches=captured.entries.filter(e=>e.id===owner.id),entry=matches[0];
    if(matches.length!==1||entry.processIdentity!==owner.processIdentity||entry.sessionId!==owner.sessionId
      ||entry.directory!==owner.directory||entry.accountKey!==observed.sourceAccountKey)throw Error('Recovery owner changed');
    const draft=entry.draft;
    if(!draft||typeof draft.text!=='string'||Buffer.byteLength(draft.text)>1024*1024
      ||textHash(draft.text)!==owner.draft?.hash||draft.hash!==owner.draft.hash)throw Error('Draft recovery is not exact');
    const images=(entry.images||[]).map(image=>{
      if(!path.isAbsolute(image.path||'')||!clean(image.path,4096)||!/^[a-f0-9]{64}$/.test(image.sha256||'')
        ||!Number.isSafeInteger(image.size)||image.size<0)throw Error('Image recovery is incomplete');
      return {path:image.path,sha256:image.sha256,size:image.size};
    });
    return {id:owner.id,processIdentity:owner.processIdentity,sessionId:owner.sessionId,directory:owner.directory,
      accountKey:observed.sourceAccountKey,model:owner.model,reasoningEffort:owner.reasoningEffort,
      draft:{text:draft.text,hash:draft.hash,provenance:owner.draft.provenance},images,
      pendingReceipts:copy(owner.pendingReceipts)};
  });
  return {version:1,fingerprint:observed.fingerprint,entries};
}
export const codexAccountsRoot=()=>path.join(os.homedir(),'Library/Application Support/ClawDad/Accounts');

// Separate retained Keychain homes were verified with the installed CLI. That
// does not establish universal runtime adoption. The transition gate has no
// environment/UI bypass; live adapters require their own acceptance evidence.
export const installedAccountSwitchCapabilities=Object.freeze({ready:false,managedLogin:true,
  retainedAuthorizations:true,consumerAccountAdoption:false,sessionTransition:false,
  reasons:[{code:'runtime_account_adoption_unverified',message:'Saved Codex sign-ins are supported. Existing Terminal and app-server processes still need verified session transition before complete switching is enabled.'}]});

// One deterministic, private journal shared by native UI, phone and Assistant.
// It deliberately has no model client and never writes named workspace storage.
export class CodexAccounts {
  constructor({root=codexAccountsRoot(),usage,inspectConsumers=async()=>({complete:false,consumers:[],reasons:['Runtime inventory is unavailable.']}),
    readWork=async()=>({complete:true,jobs:[]}),adapter=null,authorizations=null,clock=Date.now,lease=acquireCodexDeliveryClaim}={}) {
    Object.assign(this,{root,usage,inspectConsumers,readWork,adapter,authorizations,clock,lease});this.file=path.join(root,'switch-state.json');this.lock=Promise.resolve();
  }
  capabilities(){return this.adapter?.capabilities || installedAccountSwitchCapabilities;}
  start({intervalMs=3000,maxBackoffMs=30000}={}){
    // The service owns progress, so closing a sheet or losing the phone cannot
    // abandon an accepted operation. An unverified live adapter starts nothing.
    if(this.runnerStarted||this.capabilities().ready!==true)return false;
    this.runnerStarted=true;this.runnerFailures=0;
    const interval=Math.max(10,intervalMs),maximum=Math.max(interval,maxBackoffMs);
    const tick=()=>{
      this.runnerTask=(async()=>{
        try{
          const gate=await this.admission();
          if(gate.operationId)await this.advance();
          this.runnerFailures=0;
        }catch{
          // A lock or storage failure retains the durable fence/receipt. Keep
          // provider errors out of logs and retry observation with capped backoff.
          this.runnerFailures=Math.min((this.runnerFailures||0)+1,10);
        }
      })().finally(()=>{
        if(this.runnerStarted){
          this.runnerTimer=setTimeout(tick,Math.min(maximum,interval*2**this.runnerFailures));
          this.runnerTimer.unref?.();
        }
      });
    };
    tick();return true;
  }
  async stop(){
    // Stop scheduling without cancelling an effect already in flight. Its
    // receipt still completes, or the next service reconciles its uncertainty.
    this.runnerStarted=false;clearTimeout(this.runnerTimer);await this.runnerTask;await this.authorizations?.close();
  }
  async transaction(fn){
    const operation=this.lock.then(async()=>{
      const claim=await this.lease(this.root,{threadId:'account-switch-journal',requestId:'journal',timeoutMs:5000});
      try {
        let state;try{state=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('Account-switch recovery needs attention. Saved work is preserved.');}
        state ||= {version:1,revision:0,epoch:0,accounts:[],operations:{},requests:{},activeOperationId:null};
        if(!validState(state))throw Error('Account-switch recovery needs attention.');
        // Work receipts can change frequently without invalidating a reviewed
        // account selection. Account/selection changes retain their own CAS.
        state.selectionRevision ??= state.revision;
        const save=async({selectionChanged=false}={})=>{state.revision++;if(selectionChanged)state.selectionRevision++;
          await researchSave(this.file,state);const dir=await fs.open(this.root,'r');try{await dir.sync();}finally{await dir.close();}};
        return await fn(state,save);
      }finally{await claim.release();}
    });this.lock=operation.catch(()=>{});return operation;
  }
  async snapshot(){
    const usage=await this.usage.snapshot();
    const signIns=await this.authorizations?.snapshot();
    return this.transaction(state=>({version:1,revision:state.selectionRevision,journalRevision:state.revision,epoch:state.epoch,capabilities:copy(this.capabilities()),
      canConnectAccounts:!!this.authorizations,
      current:usage?.subscription?{accountKey:usage.accountKey,...usage.subscription,status:usage.status,observedAt:usage.observedAt}:null,
      accounts:state.accounts.map(account=>{
        const signIn=signIns?.profiles.find(profile=>profile.accountId===account.id);
        return {...copy(account),...(signIn?{authentication:signIn.authentication,authorization:signIn}:{} )};
      }),usage,activeOperation:copy(state.operations[state.activeOperationId]||null),
      operations:Object.values(state.operations).slice(-12).map(copy)}));
  }
  async add({email,workspaceLabel='',requestId,expectedRevision}){
    if(!clean(email)||!/^\S+@\S+\.\S+$/.test(email)||workspaceLabel&&!clean(workspaceLabel,120)||!requestID(requestId))throw rejected('Enter the account email and an optional workspace label.');
    const input={email:email.trim().toLowerCase(),workspaceLabel:workspaceLabel.trim(),expectedRevision};
    return this.transaction(async(state,save)=>{
      if(state.requests[requestId]){if(state.requests[requestId].fingerprint!==hash(input))throw Error('This account request ID was already used.');return copy(state.requests[requestId]);}
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==state.selectionRevision)throw rejected('The account list changed. Review the refreshed list before saving again.');
      if(state.accounts.length>=20)throw rejected('The saved account list is full.');
      let account=state.accounts.find(a=>a.email===input.email&&a.workspaceLabel===input.workspaceLabel);
      if(!account){account={id:randomUUID(),email:input.email,workspaceLabel:input.workspaceLabel,workspaceVerified:false,
        accountKey:null,authentication:'needs_sign_in',addedAt:new Date(this.clock()).toISOString()};state.accounts.push(account);}
      const receipt={requestId,fingerprint:hash(input),account:copy(account),saved:true,authenticated:false,
        message:'Account entry saved. First sign-in and isolated credential verification are still required.'};
      state.requests[requestId]=receipt;await save({selectionChanged:true});return copy(receipt);
    });
  }
  async observe(){
    const reading=await this.usage.freshReading();
    const inventory=await this.inspectConsumers();
    const work=await this.readWork();
    const drain=await this.transaction(async(state,save)=>{
      const result=this.reconcileWork(state,work);if(result.changed)await save();
      return {complete:work.complete===true,pending:result.pending,ready:work.complete===true&&!result.pending.length};
    });
    // Inventory is a whitelisted native projection. Raw transcript/command
    // strings, environment variables and authentication material never enter it.
    const consumers=(inventory.consumers||[]).map(c=>({id:c.id,kind:c.kind,pid:c.pid??null,processIdentity:c.processIdentity??null,
      tabId:c.tabId??null,windowId:c.windowId??null,tty:c.tty??null,sessionId:c.sessionId??null,directory:c.directory??null,
      title:c.title??c.kind,model:c.model??null,reasoningEffort:c.reasoningEffort??null,busy:c.busy??null,
      draft:c.draft?{state:c.draft.state,hash:c.draft.hash??null,provenance:c.draft.provenance??null,recoverable:c.draft.recoverable===true}:null,
      pendingReceipts:(c.pendingReceipts||[]).map(r=>({id:r.id,status:r.status})),
      accountKey:c.accountKey??null,accountVerified:c.accountVerified===true,recoverable:c.recoverable===true,
      reason:clean(c.reason,500)?c.reason:''}));
    const identity={sourceAccountKey:reading.accountKey,consumers,complete:inventory.complete===true};
    return {...identity,reading,drain,observedAt:new Date(this.clock()).toISOString(),fingerprint:hash(identity),
      reasons:(inventory.reasons||[]).filter(r=>clean(r,500)),ready:drain.ready&&inventory.complete===true&&consumers.every(c=>c.recoverable&&c.busy===false
        &&c.accountVerified&&c.accountKey===reading.accountKey&&!c.pendingReceipts.some(r=>!['completed','cancelled'].includes(r.status)))};
  }
  async preview({accountId}){
    const target=await this.transaction(s=>copy(s.accounts.find(a=>a.id===accountId)||null));
    if(!target)throw Error('Choose a saved account entry.');
    const observation=await this.observe();
    return {target,observation,capabilities:copy(this.capabilities()),changesAuthentication:false,changesWork:false};
  }
  async request({accountId,requestId,expectedRevision,confirmed}){
    if(!requestID(requestId)||confirmed!==true)throw rejected('Select an account explicitly to request a switch.');
    const fingerprint=hash({accountId,expectedRevision,confirmed});
    return this.transaction(async(state,save)=>{
      const prior=state.requests[requestId];
      if(prior){if(prior.fingerprint!==fingerprint)throw Error('This switch request ID was already used for a different selection.');return copy(state.operations[prior.operationId]);}
      const current=state.operations[state.activeOperationId];
      if(current&&!terminal.has(current.status)){
        if(current.targetId!==accountId)throw rejected('Finish or cancel the current account transition before selecting another account.');
        state.requests[requestId]={fingerprint,operationId:current.id};await save();return copy(current);
      }
      if(!Number.isSafeInteger(expectedRevision)||state.selectionRevision!==expectedRevision)throw rejected('Account state changed. Review the refreshed state before selecting again.');
      if(!state.accounts.some(a=>a.id===accountId))throw rejected('Choose a saved account entry.');
      const ready=this.capabilities().ready===true;
      // Import only already durable work before the fence. This also covers
      // queued requests accepted before the admission journal was installed.
      // New acceptances share this same lock, so none can slip past capture.
      if(ready){const work=await this.readWork();this.reconcileWork(state,work,{importExisting:true});}
      const op={id:requestId,targetId:accountId,status:ready?'checking':'needs_setup',phase:'preflight',
        createdAt:new Date(this.clock()).toISOString(),effects:{},consumers:[],
        reason:ready?'Checking the current account and sessions.':this.capabilities().reasons.map(r=>r.message).join(' '),
        reasonCode:ready?null:'live_switch_verification_required',fenced:ready,epoch:state.epoch};
      state.operations[op.id]=op;state.requests[requestId]={fingerprint,operationId:op.id};state.activeOperationId=op.id;
      await save({selectionChanged:true});return copy(op);
    });
  }
  async admission(){
    // Atomic rename makes this cheap read safe. Ordinary polling does not create
    // a ledger or churn claim directories when no switch has ever been started.
    let state;try{state=JSON.parse(await fs.readFile(this.file,'utf8'));}
    catch(e){if(e.code==='ENOENT')return {allowed:true,epoch:0,operationId:null,reason:''};
      return {allowed:false,epoch:null,operationId:null,reason:'Account-switch recovery needs attention. New work is held until its checkpoint is readable.'};}
    if(!validState(state))return {allowed:false,epoch:null,reason:'The account-switch checkpoint is incomplete. New work is held for recovery.'};
    const op=state.operations[state.activeOperationId];
    return {allowed:!op?.fenced,epoch:state.epoch,operationId:op?.id??null,phase:op?.phase??null,
      reason:op?.fenced?'Account switching is holding new work. Existing accepted work stays with its current owner.':''};
  }
  async assertAdmission(){const gate=await this.admission();if(!gate.allowed)throw Object.assign(Error(gate.reason),{code:'account_switch_pending'});return gate;}
  reconcileWork(state,work,{importExisting=false}={}){
    let changed=false;state.work ||= {};
    const rows=new Map((work.jobs||[]).filter(j=>typeof j.fingerprint==='string').map(j=>[j.id,j]));
    if(importExisting&&work.complete===true)for(const j of rows.values()){
      if(!requestID(j.id)||!pendingWork.has(j.status)||!j.fingerprint||j.accountSwitchHold||j.accountReadOnly)continue;
      if(!state.work[j.id]){state.work[j.id]={id:j.id,action:j.action,fingerprint:hash(j.fingerprint),epoch:j.accountEpoch??state.epoch,
        status:j.status,committed:true,hold:null};changed=true;}
    }
    const pending=[];
    for(const entry of Object.values(state.work)){
      if(entry.hold&&state.operations[entry.hold]?.status==='cancelled'&&entry.epoch===state.epoch){entry.hold=null;changed=true;}
      if(entry.epoch!==state.epoch||entry.hold||entry.readOnly)continue;
      const row=rows.get(entry.id);
      if(row){
        if(hash(row.fingerprint)!==entry.fingerprint||row.action!==entry.action||(row.accountEpoch??entry.epoch)!==entry.epoch){
          pending.push({id:entry.id,action:entry.action,status:'receipt_identity_changed'});continue;
        }
        if(entry.status!==row.status||!entry.committed){entry.status=row.status;entry.committed=true;changed=true;}
      }
      if(!settledWork.has(entry.status))pending.push({id:entry.id,action:entry.action,status:row?entry.status:'acceptance_needs_reconciliation'});
    }
    // A legacy/unregistered in-flight receipt is never silently ignored.
    for(const row of rows.values())if(pendingWork.has(row.status)&&!row.accountSwitchHold&&!row.accountReadOnly&&!state.work[row.id])
      pending.push({id:row.id,action:row.action,status:'unregistered_accepted_work'});
    return {changed,pending};
  }
  async withWorkAdmission({id,action,fingerprint,parentRequestId=null,allowHold=false,readOnly=false},persist){
    if(!requestID(id)||!clean(action,100)||typeof fingerprint!=='string')throw Error('Invalid account work receipt.');
    return this.transaction(async(state,save)=>{
      state.work ||= {};
      const old=state.work[id],fp=hash(fingerprint),op=state.operations[state.activeOperationId];
      if(old&&(old.fingerprint!==fp||old.action!==action))throw Error('This work receipt belongs to another account action.');
      const parent=state.work[parentRequestId];
      const continuation=op?.phase==='preflight'&&!op.cancelRequested&&parent?.action==='message'&&parent.epoch===state.epoch
        &&parent.committed&&!parent.hold&&['queued','running'].includes(parent.status);
      const held=!!op?.fenced&&!continuation&&!readOnly;
      if(held&&!allowHold)throw Object.assign(Error('Account switching is holding new work. Accepted work remains with its original account.'),{code:'account_switch_pending'});
      if(old?.committed)throw Error('Reconcile the original accepted work receipt before attempting delivery again.');
      const entry=old||{id,action,fingerprint:fp,epoch:state.epoch,status:'accepting',committed:false,
        hold:held?op.id:null,readOnly,parentRequestId};
      if(entry.epoch!==state.epoch||entry.hold!== (held?op.id:null))throw Error('Work acceptance crossed an account transition. Reconcile the original request.');
      state.work[id]=entry;await save();
      const stamp={accountEpoch:entry.epoch,accountWorkId:id,accountSwitchHold:entry.hold,
        ...(readOnly?{accountReadOnly:true}:{}),...(parentRequestId?{accountParentRequestId:parentRequestId}:{})};
      // persist writes only the caller's durable receipt. It must not call this
      // controller or acquire another service's lock while holding admission.
      // If either durable write fails, the accepting receipt blocks transition.
      const result=await persist(stamp);
      if(result?.id!==id||result.action!==action||hash(result.fingerprint)!==fp||result.accountEpoch!==entry.epoch||!clean(result.status,100))
        throw Error('The durable work receipt does not match its account admission. Reconcile before switching.');
      entry.committed=true;entry.status=result.status;await save();return result;
    });
  }
  async deliveryAdmission(job){
    const gate=await this.admission();
    if(!gate.allowed){
      if(gate.phase!=='preflight')return gate;
      if(job.accountReadOnly===true)return {...gate,allowed:true};
      return this.transaction(state=>{
        const entry=state.work?.[job.accountWorkId||job.id],op=state.operations[state.activeOperationId];
        const allowed=op?.fenced&&op.phase==='preflight'&&!op.cancelRequested&&entry?.committed&&!entry.hold
          &&entry.epoch===state.epoch&&entry.fingerprint===hash(job.fingerprint)&&entry.action===job.action
          &&!settledWork.has(entry.status);
        return {...gate,allowed:!!allowed};
      });
    }
    if((job.accountEpoch??0)!==gate.epoch)return {...gate,allowed:false,reasonCode:'account_request_reconciliation_required',
      reason:'This request was accepted before the account changed. Its text and receipt are preserved; review its account authorization before sending it.'};
    return gate;
  }
  async assertDelivery(job){const gate=await this.deliveryAdmission(job);if(!gate.allowed)throw Object.assign(Error(gate.reason),{code:gate.reasonCode||'account_switch_pending'});return gate;}
  async cancel({operationId,requestId}){
    if(!requestID(requestId))throw Error('Provide a stable cancel request ID.');
    return this.transaction(async(state,save)=>{
      const input=hash({operationId,action:'cancel'}),old=state.requests[requestId];
      if(old){if(old.fingerprint!==input)throw Error('This request ID was already used.');return copy(state.operations[old.operationId]);}
      const op=state.operations[operationId];if(!op)throw Error('That account transition was not found.');
      if(terminal.has(op.status))return copy(op);
      const dispatched=Object.values(op.effects).some(e=>e.dispatchedAt);
      op.status=dispatched?'needs_attention':'cancelled';op.reasonCode=dispatched?'cancel_requires_reconciliation':null;
      op.reason=dispatched?'Authentication or session transition may have occurred. Reconcile this operation before releasing held work.':'Account switch cancelled. Existing work was preserved.';
      op.fenced=dispatched;op.cancelRequested=true;
      state.requests[requestId]={fingerprint:input,operationId};await save({selectionChanged:true});return copy(op);
    });
  }
  async advance(){
    if(this.capabilities().ready!==true)return;
    const run=await this.lease(this.root,{threadId:'account-switch-runner',requestId:'runner',timeoutMs:250});
    try{
      let op=await this.transaction(s=>copy(s.operations[s.activeOperationId]||null));
      if(!op||terminal.has(op.status))return;
      if(op.cancelRequested){
        // Checking cancellation may reconcile evidence but must never perform a
        // rollback login, restart or resume as a side effect of this read action.
        if(!this.adapter.reconcileCancellation)return;
        let verified;try{verified=await this.adapter.reconcileCancellation({operation:copy(op)});}catch{return;}
        if(verified?.accountKey!==op.sourceAccountKey||verified.allConsumersVerified!==true
          ||verified.pendingEffectsResolved!==true||verified.performedMutations!==false)return;
        return await this.transaction(async(s,save)=>{
          const item=s.operations[op.id];
          if(!item.cancelRequested)return;
          item.status='cancelled';item.fenced=false;item.reasonCode=null;
          item.reason='Cancellation verified. All affected sessions remain on the original account; held work can continue.';
          item.cancellationVerifiedAt=new Date(this.clock()).toISOString();await save();
        });
      }
      const target=await this.transaction(s=>copy(s.accounts.find(a=>a.id===op.targetId)));
      const update=async changes=>this.transaction(async(s,save)=>{const item=s.operations[op.id];if(item.cancelRequested)throw Error('Account switch cancellation is pending.');Object.assign(item,changes);await save();op=copy(item);return op;});
      try{
        if(op.phase==='preflight'){
          const observed=await this.observe();
          if(!observed.ready)return await update({status:'waiting',reason:!observed.drain.complete?'Accepted-work receipts could not be read completely. Restore that inventory before switching.':observed.drain.pending.length?'Finishing or reconciling already accepted work on its original account. New work is held.':'Waiting for running work, drafts, queues or unverifiable sessions.',observation:observed,consumers:observed.consumers});
          // Recovery must be obtained by the verified adapter before any restart.
          // It remains private in this independent journal, never a named setup.
          const recovery=recoveryRecord(observed,await this.adapter.captureRecovery(observed));
          await update({status:'switching',phase:'authenticate',sourceAccountKey:observed.sourceAccountKey,observation:observed,consumers:observed.consumers,recovery});
        }
        if(op.phase==='authenticate'){
          const current=await this.observe();
          if(!op.effects.authenticate&&current.fingerprint!==op.observation.fingerprint)return await update({status:'waiting',phase:'preflight',reason:'The observed sessions changed. Checking again before authentication.'});
          const result=await this.effect(op,'authenticate',()=>this.adapter.authenticate({operation:copy(op),target}),()=>this.adapter.reconcileAuthentication({operation:copy(op),target}));
          if(result.state==='waiting')return await update({status:'needs_sign_in',reason:'Complete the supported account sign-in to continue.'});
          if(result.state!=='verified'||result.email?.toLowerCase()!==target.email||!result.accountKey||result.method!=='chatgpt'||result.workspaceVerified!==true)
            throw Error('The selected subscription account and workspace have not been verified.');
          await update({status:'switching',phase:'transition',destinationAccountKey:result.accountKey,verifiedIdentity:{email:result.email,workspaceName:result.workspaceName??null,accountKey:result.accountKey}});
        }
        if(op.phase==='transition'){
          for(const consumer of op.consumers){
            const id='transition:'+consumer.id;
            const result=await this.effect(op,id,()=>this.adapter.transition({operation:copy(op),consumer}),()=>this.adapter.reconcileTransition({operation:copy(op),consumer}));
            if(result.state!=='verified'||result.sessionId!==consumer.sessionId||result.accountKey!==op.destinationAccountKey||result.ownerVerified!==true||result.draftVerified!==true)
              throw Error('A session or draft has not been verified on the destination account. Successful transitions remain saved.');
          }
          await update({status:'verifying',phase:'verify',reason:'Verifying each runtime and the selected account allowance.'});
        }
        if(op.phase==='verify'){
          const result=await this.adapter.verify({operation:copy(op)});
          if(result.accountKey!==op.destinationAccountKey||result.allConsumersVerified!==true||result.freshUsage!==true)throw Error('Some sessions or allowance readings are not yet verified on the selected account.');
          await this.transaction(async(s,save)=>{const item=s.operations[op.id];if(item.cancelRequested)return;
            item.status='completed';item.phase='complete';item.reason='Selected account verified. Saved threads and work are preserved.';item.fenced=false;item.completedAt=new Date(this.clock()).toISOString();s.epoch++;
            const account=s.accounts.find(a=>a.id===item.targetId);Object.assign(account,{authentication:'verified',accountKey:item.destinationAccountKey,verifiedAt:item.completedAt});await save({selectionChanged:true});});
        }
      }catch(error){await this.transaction(async(s,save)=>{const item=s.operations[op.id];item.status='needs_attention';item.reasonCode='reconciliation_required';
        // Adapter exceptions may contain OAuth URLs or provider response bodies.
        // Preserve phase and receipts, never raw authentication errors.
        item.reason=`Account ${item.phase==='authenticate'?'authentication':'session transition'} needs recovery. Check the original operation; uncertain actions will be reconciled before retrying.`;await save();});}
    }finally{await run.release();}
  }
  async effect(op,key,dispatch,reconcile){
    const before=await this.transaction(async(s,save)=>{const item=s.operations[op.id];if(item.cancelRequested)throw Error('Account switch cancellation is pending.');
      if(item.effects[key])return copy(item.effects[key]);
      item.effects[key]={requestId:hash(`${op.id}:${key}`),dispatchedAt:new Date(this.clock()).toISOString(),state:'uncertain'};await save();return null;});
    if(before?.state==='verified')return before.result;
    const result=before?await reconcile():await dispatch();
    // Only safe, nonsecret receipts are retained. Authentication URLs, tokens,
    // callback parameters and device codes belong to transient login transport.
    const receipt={state:result.state,email:result.email,method:result.method,workspaceVerified:result.workspaceVerified,
      workspaceName:result.workspaceName,accountKey:result.accountKey,sessionId:result.sessionId,
      ownerVerified:result.ownerVerified,draftVerified:result.draftVerified};
    await this.transaction(async(s,save)=>{Object.assign(s.operations[op.id].effects[key],{state:receipt.state,result:receipt});await save();});
    return receipt;
  }
  async control(action,args={}){
    try {
    switch(action){
      case 'accounts.status':return {accounts:await this.snapshot()};
      case 'accounts.add':return {accountReceipt:await this.add(args),accounts:await this.snapshot()};
      case 'accounts.signin':
      case 'accounts.verify_signin': {
        if(!this.authorizations)throw rejected('Update ClawDad on the Mac to connect a saved account.');
        const account=await this.transaction(s=>copy(s.accounts.find(a=>a.id===args.accountId)));
        if(!account)throw rejected('Choose an existing saved account.');
        const receipt=await this.authorizations.request({account,requestId:args.requestId,
          mode:action==='accounts.signin'?'signin':'verify',confirmed:args.confirmed,reauthenticate:args.reauthenticate??false});
        return {accountReceipt:receipt,accounts:await this.snapshot()};
      }
      case 'accounts.cancel_signin': {
        if(!this.authorizations)throw rejected('No separate account connection is available.');
        return {accountReceipt:await this.authorizations.cancel(args),accounts:await this.snapshot()};
      }
      case 'accounts.preview':return {accountPreview:await this.preview(args),accounts:await this.snapshot()};
      case 'accounts.switch':return {accountOperation:await this.request(args),accounts:await this.snapshot()};
      case 'accounts.cancel':return {accountOperation:await this.cancel(args),accounts:await this.snapshot()};
      case 'accounts.reconcile':await this.advance();return {accounts:await this.snapshot()};
      default:throw Error('Unknown account control.');
    }
    }catch(error){
      // Only explicit pre-mutation validation failures can release a pending UI
      // selection. Network/storage failures keep its exact ID for reconciliation.
      if(error.accountRequestRejected)return {accountReceipt:{requestId:args.requestId,accepted:false,error:error.message},accounts:await this.snapshot()};
      throw error;
    }
  }
}
