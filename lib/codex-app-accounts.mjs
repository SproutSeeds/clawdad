import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {acquireCodexAccountClaim as acquireCodexDeliveryClaim} from './codex-account-claim.mjs';
import {researchSave} from './research-budget.mjs';
import {CodexAccountLayout} from './codex-account-layout.mjs';
import {selectedCodexLaunch} from './codex-account-launch.mjs';

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
const settledWork=new Set(['completed','cancelled','inserted','cleared','replaced','not_dispatched','retained_attention','retained_interrupted']);
const pendingWork=new Set(['queued','sending','running','submitted','working','agent_queued','attention','interrupted']);
const recoveryReasons={
  account_model_unavailable:'The selected account does not offer a model used by a captured session. Choose a compatible account, or cancel and deliberately change that session model first.',
  account_effort_unavailable:'The selected account does not offer a captured reasoning setting. Cancel and choose a supported setting, or select a compatible account.',
  profile_in_use:'The selected account profile is still in use. Let its separate account check finish, then check recovery.',
};


export const codexAccountsRoot=()=>path.join(os.homedir(),'Library/Application Support/ClawDad/Accounts');
export const appAccountAction=action=>action==='message'||action==='research.review'||action==='legacy.dispatch'||action?.startsWith('appserver.');

// App-owned account journal. Terminal tools and launches never consult its gate.
// The previous whole-window journal is evidence only and is never advanced.
export class CodexAppAccounts {
  constructor({root=codexAccountsRoot(),usage,readWork=async()=>({complete:true,jobs:[]}),adapter=null,authorizations=null,clock=Date.now,lease=acquireCodexDeliveryClaim}={}) {
    Object.assign(this,{root,usage,readWork,adapter,authorizations,clock,lease});
    this.file=path.join(root,'app-accounts.json');this.lock=Promise.resolve();
  }
  capabilities(){return {ready:!!this.adapter,appOnly:true,windowRebuild:false,managedLogin:true,retainedAuthorizations:true,selectedRuntimeRouting:true};}
  async migrate(){
    let old;try{old=JSON.parse(await fs.readFile(path.join(this.root,'switch-state.json'),'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw Error('The saved account list needs recovery. The original switch record is preserved.');}
    if(old&&!validState(old))throw Error('The previous account record is incomplete. Preserve it for review.');
    // Immutable exact copy before importing. Never re-run or mark old effects successful.
    if(old){
      await fs.mkdir(path.join(this.root,'Retired'),{recursive:true,mode:0o700});
      const data=await fs.readFile(path.join(this.root,'switch-state.json'));
      await fs.writeFile(path.join(this.root,'Retired','switch-state-'+hash(old)+'.json'),data,{flag:'wx',mode:0o600}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    }
    const selected=old?.selectedRuntime,completed=selected&&old.operations[selected.operationId]?.status==='completed';
    const pending=old?await this.readWork():{jobs:[]};
    const state={version:1,revision:0,selectionRevision:0,epoch:old?.epoch||0,accounts:copy(old?.accounts||[]),
      operations:completed?{[selected.operationId]:copy(old.operations[selected.operationId])}:{},requests:{},work:{},activeOperationId:null,
      selectedRuntime:completed?copy(selected):null,
      retiredWork:[...new Set([...(pending.jobs||[]).filter(j=>appAccountAction(j.action)&&(['attention','interrupted'].includes(j.status)||j.accountSwitchHold)).map(j=>j.id),
        ...Object.values(old?.work||{}).filter(j=>appAccountAction(j.action)&&(j.hold||['attention','interrupted','accepting'].includes(j.status))).map(j=>j.id)])],
      migration:{at:new Date(this.clock()).toISOString(),legacyOperationId:old?.activeOperationId||null,legacyEffectsPreserved:true}};
    await researchSave(this.file,state);return state;
  }
  async selectedLaunch(){
    // No selected route means preserve the existing installed launch behavior.
    // A saved account entry or a partially completed switch cannot select a
    // consumer. This read does not refresh usage or recursively call snapshot.
    // The journal is atomically replaced. A pure route read needs no claim or
    // directory creation, especially while a short-lived worker is exiting.
    let saved;try{saved=JSON.parse(await fs.readFile(this.file,'utf8'));}
    catch(error){if(error.code==='ENOENT')return null;throw Error('The selected account checkpoint needs recovery.');}
    if(!validState(saved))throw Error('The selected account checkpoint needs recovery.');
    const state={selected:copy(saved.selectedRuntime||null),operation:copy(saved.operations[saved.selectedRuntime?.operationId]||null)};
    if(!state.selected)return null;
    const {selected,operation}=state;
    if(operation?.status!=='completed'||operation.destinationAccountKey!==selected.accountKey||operation.targetId!==selected.accountId)
      throw Error('The selected account transition needs reconciliation before new work can start.');
    const profiles=await this.authorizations?.snapshot();
    const profile=profiles?.profiles.find(p=>p.accountId===selected.accountId);
    const home=profile?.home||path.join(this.root,'profiles',selected.accountId);
    if(profile?.authentication!=='verified'||profile.accountKey!==selected.accountKey||home!==selected.authorizationHome)
      throw Error('Check the selected saved sign-in before starting more work. Existing work remains on its original account.');
    await new CodexAccountLayout({root:this.root}).verify(selected.layout);
    return selectedCodexLaunch({...selected,verified:true,layoutVerified:true,method:'chatgpt'});
  }
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
      const claim=await this.lease(this.root,{threadId:'app-account-journal',requestId:'journal',timeoutMs:5000});
      try {
        let state;try{state=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('Account-switch recovery needs attention. Saved work is preserved.');}
        state ||= await this.migrate();
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
  async workDrain(){
    const work=await this.readWork();
    return this.transaction(async(state,save)=>{
      const result=this.reconcileWork(state,work);if(result.changed)await save();
      return {complete:work.complete===true,pending:result.pending,ready:work.complete===true&&!result.pending.length,
        retainedReceipts:work.jobs.filter(j=>j.retained===true).map(j=>({id:j.id,action:j.action,status:j.originalStatus,fingerprint:hash(j.fingerprint)}))};
    });
  }
  reconcileWork(state,work,{importExisting=false}={}){
    let changed=false;state.work ||= {};
    const rows=new Map((work.jobs||[]).filter(j=>appAccountAction(j.action)&&!state.retiredWork?.includes(j.id)&&typeof j.fingerprint==='string').map(j=>[j.id,j]));
    if(importExisting&&work.complete===true)for(const j of rows.values()){
      if(!requestID(j.id)||!pendingWork.has(j.status)||!j.fingerprint||j.accountSwitchHold||j.accountReadOnly)continue;
      if(!state.work[j.id]){state.work[j.id]={id:j.id,action:j.action,fingerprint:hash(j.fingerprint),epoch:j.accountEpoch??state.epoch,
        status:j.status,committed:true,hold:null,...(j.legacyImported?{legacyImported:true,projectPath:j.projectPath,sessionId:j.sessionId}: {})};changed=true;}
    }
    const pending=[];
    for(const entry of Object.values(state.work)){
      if(entry.hold&&state.operations[entry.hold]?.status==='cancelled'&&entry.epoch===state.epoch){entry.hold=null;changed=true;}
      if(entry.epoch!==state.epoch||entry.hold||entry.readOnly)continue;
      const row=rows.get(entry.id);
      if(row){
        if(hash(row.fingerprint)!==entry.fingerprint||row.action!==entry.action||![entry.epoch,entry.admittedEpoch].includes(row.accountEpoch??entry.epoch)){
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
  async withWorkAdmission({id,action,fingerprint,parentRequestId=null,allowHold=false,readOnly=false,expectedEpoch=null},persist){
    if(!appAccountAction(action))return persist({accountReadOnly:true});
    if(!requestID(id)||!clean(action,100)||typeof fingerprint!=='string')throw Error('Invalid account work receipt.');
    return this.transaction(async(state,save)=>{
      if(expectedEpoch!==null&&expectedEpoch!==state.epoch)throw Error('The selected account changed while preparing this launch. Review the account and run the command again.');
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
  async assertDelivery(job){const gate=await this.deliveryAdmission(job);if(!gate.allowed)throw Object.assign(Error(gate.reason),{code:gate.reasonCode||'account_switch_pending'});return gate;}
  async snapshot(){
    const usage=await this.usage?.snapshot(),signIns=await this.authorizations?.snapshot();
    return this.transaction(s=>{
      const selected=s.selectedRuntime,accounts=s.accounts.map(a=>{
        const authorization=signIns?.profiles.find(p=>p.accountId===a.id);
        const verifiedAt=authorization?.verifiedAt;
        const fresh=authorization?.authentication==='verified'&&verifiedAt&&this.clock()-Date.parse(verifiedAt)<300000;
        return {...copy(a),...(authorization?{authorization,authentication:authorization.authentication}:{}),
          usage:authorization?{remainingPercent:authorization.remainingPercent??null,resetsAt:authorization.resetsAt??null,
            observedAt:verifiedAt??null,status:fresh?'current':verifiedAt?'stale':'unavailable',
            ordinaryUsageAllowed:authorization.ordinaryUsageAllowed,subscription:authorization.subscription,
            message:fresh?'':verifiedAt?'Last verified reading. Refresh to check the current allowance.':'Check this saved sign-in to read its allowance.'}:null};
      });
      const activeAccountId=selected?.accountId||null;
      return {version:1,scope:'clawdad-app',revision:s.selectionRevision,journalRevision:s.revision,epoch:s.epoch,
        capabilities:this.capabilities(),canConnectAccounts:!!this.authorizations,accounts,activeAccountId,
        current:usage?.subscription?{accountKey:usage.accountKey,...usage.subscription,status:usage.status,observedAt:usage.observedAt}:null,
        usage,activeOperation:copy(s.operations[s.activeOperationId]||null),operations:Object.values(s.operations).slice(-12).map(copy),
        migration:s.migration,retainedRequestCount:s.retiredWork?.length||0};
    });
  }
  async admission(){return this.transaction(s=>{
    const op=s.operations[s.activeOperationId];return {allowed:!op?.fenced,epoch:s.epoch,operationId:op?.id||null,phase:op?.phase||null,
      reason:op?.fenced?'ClawDad account activation is in progress. Accepted app work keeps its account; Terminal remains available.':''};
  });}
  async assertAdmission(){const gate=await this.admission();if(!gate.allowed)throw Object.assign(Error(gate.reason),{code:'account_switch_pending'});return gate;}
  async deliveryAdmission(job){
    if(!appAccountAction(job.action)||job.accountReadOnly)return {allowed:true};
    return this.transaction(async(s,save)=>{
      const entry=s.work?.[job.accountWorkId||job.id],op=s.operations[s.activeOperationId];
      const reject=reason=>({allowed:false,reasonCode:'account_request_reconciliation_required',reason});
      const held=reason=>({allowed:false,reasonCode:'account_activation_pending',reason});
      if(s.retiredWork?.includes(job.id))return reject('This request predates retirement of the Terminal switcher. Its text and receipt are retained for review; it will not be replayed.');
      if(entry&&(entry.fingerprint!==hash(job.fingerprint)||entry.action!==job.action))return reject('This account receipt does not match the accepted message.');
      if(entry?.hold){
        const activation=s.operations[entry.hold];
        if(activation?.status==='completed'){
          // Only work explicitly accepted during THIS app activation may follow it.
          entry.admittedEpoch=entry.epoch;entry.epoch=s.epoch;entry.hold=null;entry.releasedFromActivation=activation.id;await save();
        }else if(activation?.status==='cancelled'){entry.hold=null;await save();}
        else return held('This message is saved until its requested ClawDad account activation finishes.');
      }
      const epoch=entry?.epoch??job.accountEpoch??0;
      if(epoch!==s.epoch)return reject('This request belongs to an earlier account. Review its receipt before sending it again.');
      if(op?.fenced&&!(op.phase==='preflight'&&entry?.committed&&!entry.hold))return held(op.reason||'ClawDad is activating the selected account.');
      return {allowed:true,epoch:s.epoch};
    });
  }
  async preview({accountId,refresh=false,requestId}){
    const target=await this.transaction(s=>copy(s.accounts.find(a=>a.id===accountId)));
    if(!target)throw rejected('Choose a saved account.');
    if(refresh&&this.authorizations)await this.authorizations.request({account:target,requestId:requestID(requestId)?requestId:randomUUID(),mode:'verify'});
    const state=await this.snapshot();return {target:state.accounts.find(a=>a.id===accountId),changesAuthentication:false,changesWork:false};
  }
  async request({accountId,requestId,expectedRevision,confirmed}){
    if(!requestID(requestId)||confirmed!==true)throw rejected('Explicitly activate the selected ClawDad account.');
    const fingerprint=hash({accountId,expectedRevision,confirmed});
    return this.transaction(async(s,save)=>{
      const prior=s.requests[requestId];
      if(prior){if(prior.fingerprint!==fingerprint)throw rejected('This request ID belongs to a different activation.');return copy(s.operations[prior.operationId]);}
      const active=s.operations[s.activeOperationId];
      if(active?.fenced){
        if(active.targetId!==accountId)throw rejected('Finish or cancel the current app activation before activating another account.');
        s.requests[requestId]={fingerprint,operationId:active.id};await save();return copy(active);
      }
      if(expectedRevision!==s.selectionRevision)throw rejected('The active account changed. Review the refreshed selection and try again.');
      if(!s.accounts.some(a=>a.id===accountId))throw rejected('Choose a saved account.');
      const profile=(await this.authorizations?.snapshot())?.profiles.find(p=>p.accountId===accountId);
      if(profile?.authentication!=='verified')throw rejected('Check or reconnect this saved sign-in before activation.');
      if(!this.adapter)throw rejected('Update ClawDad on the connected Mac to activate an app account.');
      this.reconcileWork(s,await this.readWork(),{importExisting:true});
      const op={id:requestId,targetId:accountId,strategy:'app-only-v1',status:'checking',phase:'preflight',fenced:true,
        createdAt:new Date(this.clock()).toISOString(),effects:{},reason:'Verifying the selected ClawDad account.',epoch:s.epoch};
      s.operations[op.id]=op;s.requests[requestId]={fingerprint,operationId:op.id};s.activeOperationId=op.id;
      await save({selectionChanged:true});return copy(op);
    });
  }
  async permit({operationId}){return this.transaction(s=>{
    const op=s.operations[operationId];
    if(s.activeOperationId!==operationId||op?.strategy!=='app-only-v1'||!op.fenced||op.cancelRequested)
      throw Object.assign(Error('This app activation no longer authorizes a server action.'),{code:'account_control_not_authorized'});
    return copy(op);
  });}
  async cancel({operationId,requestId}){
    if(!requestID(requestId))throw rejected('Use the original activation receipt.');
    return this.transaction(async(s,save)=>{
      const fingerprint=hash({action:'cancel',operationId}),prior=s.requests[requestId];
      if(prior){if(prior.fingerprint!==fingerprint)throw rejected('This request ID belongs to a different action.');return copy(s.operations[prior.operationId]);}
      const op=s.operations[operationId];if(!op||op.strategy!=='app-only-v1')throw rejected('That legacy operation is archived and cannot control Terminal.');
      if(op.phase!=='preflight'&&op.phase!=='authenticate')throw rejected('The app server has begun its transition. Retry this same activation to reconcile it safely.');
      op.status='cancelled';op.fenced=false;op.cancelRequested=true;op.reason='Activation cancelled. The current app account is unchanged.';
      s.requests[requestId]={operationId,fingerprint};await save({selectionChanged:true});return copy(op);
    });
  }
  async retry({operationId,requestId,confirmed}){
    if(!requestID(requestId)||confirmed!==true)throw rejected('Explicitly retry the existing activation.');
    return this.transaction(async(s,save)=>{
      const fingerprint=hash({action:'retry',operationId,confirmed}),prior=s.requests[requestId];
      if(prior){if(prior.fingerprint!==fingerprint)throw rejected('This request ID belongs to a different action.');return copy(s.operations[prior.operationId]);}
      const op=s.operations[operationId];if(!op||op.strategy!=='app-only-v1'||!op.fenced)throw rejected('There is no pending app activation.');
      op.status='checking';op.reasonCode=null;s.requests[requestId]={operationId,fingerprint};await save();return copy(op);
    });
  }
  async advance(){
    if(!this.adapter)return;
    let claim;try{claim=await this.lease(this.root,{threadId:'app-account-runner',requestId:'runner',timeoutMs:250});}
    catch(e){if(e.code==='CLAWDAD_CODEX_DELIVERY_CLAIM_TIMEOUT')return;throw e;}
    try{
      let op=await this.transaction(s=>copy(s.operations[s.activeOperationId]));
      if(!op?.fenced||op.status==='needs_attention'||op.cancelRequested)return;
      const update=async fields=>{op=await this.transaction(async(s,save)=>{
        const current=s.operations[op.id];if(current.cancelRequested)throw Error('Activation cancelled');Object.assign(current,fields);await save();return copy(current);
      });};
      const target=await this.transaction(s=>copy(s.accounts.find(a=>a.id===op.targetId)));
      try{
        if(op.phase==='preflight'){
          const drain=await this.workDrain();
          if(!drain.ready)return await update({status:drain.complete?'waiting':'needs_attention',reasonCode:'accepted_app_work',
            reason:drain.complete?`${drain.pending.length} accepted ClawDad request(s) are finishing on their current account. Terminal is unaffected.`:'ClawDad could not read accepted app-work receipts. Retry after reconnecting.'});
          const source=await this.adapter.capture(op);
          await update({source,phase:'authenticate',status:'checking',reason:'Checking saved sign-in and conversation settings.'});
        }
        if(op.phase==='authenticate'){
          const identity=await this.adapter.prepare(op,target);
          if(identity.email?.toLowerCase()!==target.email||identity.method!=='chatgpt'||!identity.accountKey)throw Error('Destination subscription was not verified.');
          await update({destinationAccountKey:identity.accountKey,phase:'transition',status:'activating',reason:'Activating the account for ClawDad project threads.'});
        }
        if(op.phase==='transition'){
          const result=await this.adapter.transition(op);
          if(result.waiting)return await update({status:'activating',reason:'Codex is releasing idle app conversations. Their histories and drafts are saved.',reasonCode:result.reasonCode});
          await update({phase:'verify',status:'verifying',reason:'Verifying the active account and restored conversations.'});
        }
        if(op.phase==='verify'){
          const result=await this.adapter.verify(op);
          if(result.accountKey!==op.destinationAccountKey||!result.runtime)throw Error('The app runtime account could not be verified.');
          const selected={operationId:op.id,accountId:op.targetId,accountKey:result.accountKey,...result.runtime};
          await new CodexAccountLayout({root:this.root}).verify(selected.layout);
          selectedCodexLaunch({...selected,verified:true,layoutVerified:true,method:'chatgpt'});
          await this.onActivated?.(selected);
          await this.transaction(async(s,save)=>{
            const current=s.operations[op.id];Object.assign(current,{status:'completed',phase:'complete',fenced:false,reasonCode:null,
              reason:'Active for ClawDad. Terminal authentication is unchanged.',completedAt:new Date(this.clock()).toISOString()});
            s.selectedRuntime=selected;s.epoch++;await save({selectionChanged:true});
          });
          await this.usage?.refresh?.();
        }
      }catch(error){
        await this.transaction(async(s,save)=>{
          const current=s.operations[op.id];if(current.cancelRequested)return;
          const code=/^[a-z][a-z0-9_]{0,90}$/.test(error.code||'')?error.code:'app_activation_unverified';
          const waiting=['shared_thread_working','shared_thread_pending'].includes(code)&&current.phase==='preflight';
          const observationRace=['shared_inventory_changed','shared_native_census_unavailable','shared_native_owner_changed'].includes(code)
            &&(current.observationRetries||0)<3;
          if(observationRace)current.observationRetries=(current.observationRetries||0)+1;
          current.status=waiting||observationRace?'waiting':'needs_attention';current.reasonCode=code;
          current.reason=observationRace?'Refreshing the app-server observation. Saved activation progress is retained.':waiting?'An in-app project still has running or queued work. It will finish on its current account.':
            recoveryReasons[code]||(error.appAccountSafe===true?error.message:`Activation could not finish (${code}). Retry this activation; the original receipts and conversations are retained.`);
          await save();
        });
      }
    }finally{await claim.release();}
  }
  async control(action,args={}){
    try{
      let accountReceipt,accountOperation,accountPreview;
      if(action==='accounts.status'){
        if(args.receiptId)accountReceipt=await this.transaction(s=>{
          const receipt=s.requests[args.receiptId];if(!receipt)return null;const op=s.operations[receipt.operationId];
          return {requestId:args.receiptId,accepted:true,operationId:op?.id,accountId:op?.targetId||receipt.account?.id};
        });
      }else if(action==='accounts.add')accountReceipt=await this.add(args);
      else if(['accounts.preview','accounts.refresh'].includes(action))accountPreview=await this.preview({...args,refresh:action==='accounts.refresh'});
      else if(['accounts.signin','accounts.verify_signin'].includes(action)){
        const account=await this.transaction(s=>copy(s.accounts.find(a=>a.id===args.accountId)));
        accountReceipt=await this.authorizations.request({account,requestId:args.requestId,mode:action==='accounts.signin'?'signin':'verify',confirmed:args.confirmed,reauthenticate:args.reauthenticate??false});
      }else if(action==='accounts.cancel_signin')accountReceipt=await this.authorizations.cancel(args);
      else if(['accounts.activate','accounts.switch'].includes(action)){
        if(args.windowSelection)throw rejected('Terminal account switching is retired. Open the updated allowance popover to activate a ClawDad account.');
        accountOperation=await this.request(args);
      }else if(action==='accounts.cancel')accountOperation=await this.cancel(args);
      else if(['accounts.retry','accounts.continue'].includes(action))accountOperation=await this.retry(args);
      else if(action==='accounts.reconcile'){/* Read-only compatibility; never advances a legacy switch. */}
      else throw rejected('Terminal account-switch controls are retired. Use ClawDad account activation.');
      return {accounts:await this.snapshot(),...(accountReceipt?{accountReceipt}:{}),...(accountOperation?{accountOperation}:{}),...(accountPreview?{accountPreview}:{})};
    }catch(error){
      if(error.accountRequestRejected)return {accounts:await this.snapshot(),accountReceipt:{requestId:args.requestId,accepted:false,error:error.message}};
      throw error;
    }
  }
}
