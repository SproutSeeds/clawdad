import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {researchSave} from './research-budget.mjs';
import {privateAccountDirectory} from './codex-account-profile-process.mjs';
import {acquireCodexAccountClaim as acquireCodexDeliveryClaim} from './codex-account-claim.mjs';

const id=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const phases=new Set(['pending','running','prepared','completed','attention','not_dispatched']);
const actions=new Set(['observe','status','stop','launch','draft','window.capture','window.restore','window.verify']);
const reject=(code,message)=>Object.assign(Error(message),{code});

// This private mailbox is deliberately separate from Assistant messages and
// public tools. Only an accepted switch controller can enqueue a request. The
// native worker prepares an exact effect durably before touching its target;
// reconnects never grant a second dispatch of an uncertain action.
export class CodexAccountNativeTransport {
  constructor({root,authorize,clock=Date.now,lease=acquireCodexDeliveryClaim}={}) {
    Object.assign(this,{root,authorize,clock,lease});this.file=path.join(root,'native-control.json');this.lock=Promise.resolve();
  }
  async transaction(fn){
    const pending=this.lock.then(async()=>{
      await privateAccountDirectory(this.root);
      const claim=await this.lease(this.root,{threadId:'native-account-controls',requestId:'journal',timeoutMs:5000});
      try {
        let state={version:1,requests:[]};
        try {
          const stat=await fs.lstat(this.file);
          if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||stat.mode&0o077||stat.size>32*1024*1024)throw Error();
          state=JSON.parse(await fs.readFile(this.file,'utf8'));
          if(state.version!==1||!Array.isArray(state.requests)||state.requests.length>1000||new Set(state.requests.map(r=>r.id)).size!==state.requests.length
            ||state.requests.some(r=>!id(r.id)||!id(r.operationId)||!actions.has(r.action)||!phases.has(r.state)
              ||r.fingerprint!==hash({operationId:r.operationId,action:r.action,args:r.args})
              ||['running','prepared'].includes(r.state)&&(!id(r.workerId)||!id(r.dispatchId))))throw Error();
        }catch(error){if(error.code!=='ENOENT')throw reject('native_account_journal_invalid','The private account-control receipt needs recovery. Terminal input was preserved.');}
        const save=async()=>{await researchSave(this.file,state);const handle=await fs.open(this.root,'r');try{await handle.sync();}finally{await handle.close();}};
        return await fn(state,save);
      }finally{await claim.release();}
    });this.lock=pending.catch(()=>{});return pending;
  }
  async permit(request){
    if(typeof this.authorize!=='function'||await this.authorize(structuredClone(request))!==true)
      throw reject('account_control_not_authorized','This account transition is paused or no longer authorized. Existing input is preserved.');
  }
  async enqueue({operationId,requestId,action,args}){
    if(!id(operationId)||!id(requestId)||!actions.has(action)||!args||Array.isArray(args)||typeof args!=='object'
      ||Buffer.byteLength(JSON.stringify(args))>128*1024)throw reject('native_account_request_invalid','The exact account-control request is incomplete.');
    const value={id:requestId,operationId,action,args:structuredClone(args)},fingerprint=hash({operationId,action,args});
    await this.permit(value);
    return this.transaction(async(state,save)=>{
      const old=state.requests.find(r=>r.id===requestId);
      if(old){if(old.fingerprint!==fingerprint)throw reject('native_account_request_conflict','The account request ID already belongs to another action.');return structuredClone(old);}
      if(state.requests.length>=1000)throw reject('native_account_receipts_full','The account-control receipt history needs archival before another transition.');
      const request={...value,fingerprint,state:'pending',createdAt:new Date(this.clock()).toISOString()};
      state.requests.push(request);await save();return structuredClone(request);
    });
  }
  async inspect(requestId){return this.transaction(state=>structuredClone(state.requests.find(r=>r.id===requestId)||null));}
  async settleCancellation(operationId,{reconcileReadOnly}={}){
    return this.transaction(async(state,save)=>{
      let changed=false;
      for(const r of state.requests.filter(r=>r.operationId===operationId)){
        if(['pending','running'].includes(r.state)&&!r.preparedAt){
          r.state='not_dispatched';r.reasonCode='cancelled_before_prepare';changed=true;
        }
        if(r.state==='attention'&&!r.cancellationReconciled&&reconcileReadOnly){
          const proof=await reconcileReadOnly(structuredClone(r));
          if(proof?.noAccountOrProcessMutation===true&&proof?.originalDraftPreserved===true){
            r.cancellationReconciled={...proof,observedAt:new Date(this.clock()).toISOString()};changed=true;
          }
        }
      }
      if(changed)await save();
      return state.requests.filter(r=>r.operationId===operationId).every(r=>['completed','not_dispatched'].includes(r.state)||r.cancellationReconciled);
    });
  }
  async poll({workerId,canDispatch=true}){
    if(!id(workerId))return {job:null,busy:true};
    return this.transaction(async(state,save)=>{
      let changed=false;
      for(const r of state.requests)if(['running','prepared'].includes(r.state)&&r.workerId!==workerId){
        r.state=r.preparedAt?'attention':'not_dispatched';r.reasonCode=r.preparedAt?'worker_restarted_after_prepare':'worker_restarted_before_prepare';changed=true;
      }
      if(changed)await save();
      if(state.requests.some(r=>['running','prepared'].includes(r.state)))return {job:null,busy:true};
      if(!canDispatch)return {job:null,busy:false};
      const next=state.requests.find(r=>r.state==='pending');
      if(!next)return {job:null,busy:false};
      try{await this.permit(next);}catch{return {job:null,busy:false};}
      next.state='running';next.workerId=workerId;next.dispatchId=randomUUID();next.startedAt=new Date(this.clock()).toISOString();
      await save();return {job:structuredClone(next),busy:true};
    });
  }
  async prepare({id:requestId,workerId,dispatchId}){
    return this.transaction(async(state,save)=>{
      const r=state.requests.find(r=>r.id===requestId);
      if(!r||r.state!=='running'||r.workerId!==workerId||r.dispatchId!==dispatchId||r.preparedAt)
        throw reject('native_account_dispatch_uncertain','This native action is no longer available for dispatch. Reconcile its original receipt.');
      await this.permit(r);
      r.state='prepared';r.preparedAt=new Date(this.clock()).toISOString();await save();return {ok:true};
    });
  }
  async complete({id:requestId,workerId,dispatchId,result,reasonCode,message}){
    if(result!==undefined&&(!result||typeof result!=='object'||Array.isArray(result)||Buffer.byteLength(JSON.stringify(result))>128*1024))
      throw reject('native_account_result_invalid','The native account receipt is invalid. Preserve the original request.');
    if(reasonCode!==undefined&&!id(reasonCode))throw reject('native_account_result_invalid','The native reason code is invalid.');
    return this.transaction(async(state,save)=>{
      const r=state.requests.find(r=>r.id===requestId);
      if(!r||r.workerId!==workerId||r.dispatchId!==dispatchId)throw reject('native_account_worker_changed','This receipt does not belong to the dispatched native worker.');
      if(message!==undefined&&(!r.action.startsWith('window.')||typeof message!=='string'||message.length>2000))throw Error('Invalid native window guidance');
      const response={result:result??null,reasonCode:reasonCode??null};
      if(r.completedAt){if(r.resultHash!==hash(response))throw reject('native_account_result_changed','The completed native receipt changed.');return {ok:true};}
      if(!['running','prepared','attention','not_dispatched'].includes(r.state))throw reject('native_account_result_invalid','No native action is awaiting this receipt.');
      // A positive effect cannot be claimed if its one-time permission was
      // never durably prepared. Observation still uses prepare before focus.
      if(result&&!r.preparedAt)throw reject('native_account_prepare_missing','Native control was never prepared.');
      r.state=reasonCode?(r.preparedAt?'attention':'not_dispatched'):'completed';Object.assign(r,response);
      if(message)r.message=message;
      r.resultHash=hash(response);r.completedAt=new Date(this.clock()).toISOString();await save();return {ok:true};
    });
  }
  async retryUnsent(requestId){
    return this.transaction(async(state,save)=>{
      const r=state.requests.find(r=>r.id===requestId);
      if(!r||r.state!=='not_dispatched'||r.preparedAt)throw reject('native_account_delivery_uncertain','Only a proven undispatched native request can be retried.');
      await this.permit(r);
      r.attempts||=[];r.attempts.push({workerId:r.workerId,dispatchId:r.dispatchId,reasonCode:r.reasonCode});
      for(const key of ['workerId','dispatchId','startedAt','completedAt','resultHash','result','reasonCode'])delete r[key];
      r.state='pending';await save();return structuredClone(r);
    });
  }
}
