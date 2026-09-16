import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {researchSave} from './research-budget.mjs';
import {privateAccountDirectory} from './codex-account-profile-process.mjs';
import {acquireCodexAccountClaim as acquireCodexDeliveryClaim} from './codex-account-claim.mjs';

const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const absolute=v=>typeof v==='string'&&path.isAbsolute(v)&&path.normalize(v)===v&&!/[\x00-\x1f\x7f]/.test(v);
const fail=(code,message)=>Object.assign(Error(message),{code});
const safeThread=t=>t&&/^[-a-f0-9]{36}$/i.test(t.id||'')&&absolute(t.cwd)&&digest(t.historyHash)
  &&digest(t.draftHash)&&t.busy===false&&t.queueEmpty===true&&t.approvalsEmpty===true
  &&t.settings&&id(t.settings.model)&&id(t.settings.reasoningEffort)&&t.settings.cwd===t.cwd
  &&t.settingsVerified===true&&t.receiptsResolved===true;

export function validateSharedAccountCapture(source){
  if(!source||!absolute(source.socketPath)||!id(source.processIdentity)||!Number.isSafeInteger(source.pid)||source.pid<=0
    ||!digest(source.accountKey)||source.accountVerified!==true||source.inventoryComplete!==true
    ||!Array.isArray(source.threads)||source.threads.some(t=>!safeThread(t))
    ||new Set(source.threads.map(t=>t.id)).size!==source.threads.length||source.dispatchHeld!==true)
    throw fail('shared_account_capture_incomplete','Verify this exact server, its complete idle thread inventory, settings, drafts and pending receipts before switching.');
  return structuredClone(source);
}

const sameThread=(a,b)=>a.id===b.id&&a.cwd===b.cwd&&a.historyHash===b.historyHash&&a.draftHash===b.draftHash
  &&hash(a.settings)===hash(b.settings)&&safeThread(a);
const sourceThreads=(current,source,{subset=false}={})=>Array.isArray(current.threads)
  &&current.threads.every(t=>source.threads.some(s=>sameThread(t,s)))
  &&(subset||current.threads.length===source.threads.length);

// An unsubscribe acknowledgement is only a release request. Re-observe until
// loaded/list is empty before stopping the exact original process. Each effect
// has its own durable receipt; an unknown launch/resume is never replayed.
export class CodexAccountSharedHandoff {
  constructor({root,driver,lease=acquireCodexDeliveryClaim,clock=Date.now}={}){Object.assign(this,{root,driver,lease,clock});}
  file(source){return path.join(this.root,'shared-handoff-'+hash(source.socketPath)+'.json');}
  async save(file,record){await researchSave(file,record);const dir=await fs.open(this.root,'r');try{await dir.sync();}finally{await dir.close();}}
  async load(file){
    try{
      const s=await fs.lstat(file);
      if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||s.mode&0o077||s.size>8*1024*1024)throw Error();
      const r=JSON.parse(await fs.readFile(file,'utf8'));validateSharedAccountCapture(r.source);
      if(r.version!==1||!id(r.operationId)||r.fingerprint!==hash({operationId:r.operationId,source:r.source,target:r.target})
        ||!r.effects||!['captured','releasing','stopping','launching','resuming','verified'].includes(r.phase))throw Error();
      return r;
    }catch(e){if(e.code==='ENOENT')return null;throw fail('shared_account_receipt_invalid','The saved shared-server transition needs reconciliation. Existing threads were preserved.');}
  }
  async run({operationId,source,target,confirmed=false}){
    source=validateSharedAccountCapture(source);
    if(!id(operationId)||confirmed!==true||!target||!digest(target.accountKey)||!absolute(target.authorizationHome)
      ||target.accountVerified!==true||target.configurationVerified!==true)
      throw fail('shared_account_authorization_required','Use an explicitly accepted switch to a verified subscription profile.');
    await privateAccountDirectory(this.root);
    const claim=await this.lease(this.root,{threadId:'shared-account:'+source.socketPath,requestId:'handoff',timeoutMs:5000});
    const file=this.file(source),fingerprint=hash({operationId,source,target});
    try{
      let r=await this.load(file);
      if(r&&r.fingerprint!==fingerprint){
        if(r.phase!=='verified')throw fail('shared_account_pending','Reconcile the existing shared-server switch before starting another.');
        const archive=file+'.'+r.operationId+'.json';
        await fs.link(file,archive).catch(async e=>{if(e.code!=='EEXIST'||(await this.load(archive)).fingerprint!==r.fingerprint)throw e;});r=null;
      }
      if(!r){r={version:1,operationId,source,target,fingerprint,phase:'captured',effects:{},createdAt:new Date(this.clock()).toISOString()};await this.save(file,r);}
      const observe=async()=>{
        const v=await this.driver.observe({operationId,source,target});
        if(v?.socketPath!==source.socketPath||v.inventoryComplete!==true||v.dispatchHeld!==true)
          throw fail('shared_account_inventory_changed','The shared socket, work hold or thread inventory cannot be verified. Preserve the original owner.');
        return v;
      };
      const original=v=>v.kind==='server'&&v.processIdentity===source.processIdentity&&v.pid===source.pid
        &&v.accountKey===source.accountKey&&v.accountVerified===true;
      const destination=v=>v.kind==='server'&&v.accountKey===target.accountKey&&v.accountVerified===true
        &&v.authorizationHome===target.authorizationHome;
      const effect=async(name,fn)=>{
        const requestId=hash({operationId,socket:source.socketPath,effect:name});
        if(r.effects[name]){
          const receipt=await this.driver.reconcile({operationId,requestId,source,target,effect:name});
          if(receipt?.state==='completed')return;
          if(receipt?.state!=='not_dispatched'||receipt.durable!==true)
            throw fail('shared_account_delivery_uncertain','An earlier server action may have occurred. Reconcile its original receipt before retrying.');
        }
        r.effects[name]={requestId,state:'uncertain'};await this.save(file,r);
        await this.driver.permit({operationId,requestId,effect:name,source,target});
        const receipt=await fn(requestId);
        r.effects[name].state=receipt?.state==='completed'?'completed':'uncertain';await this.save(file,r);
      };
      let v=await observe();
      if(r.phase==='verified'){
        if(!(destination(v)||r.alreadySelected&&original(v))||!sourceThreads(v,source))
          throw fail('shared_account_completed_changed','The previously verified server changed. Its completed transition remains saved.');
        return structuredClone(r);
      }
      if(original(v)){
        if(!sourceThreads(v,source,{subset:r.phase!=='captured'}))throw fail('shared_account_source_changed','A thread, draft, setting, queue or accepted turn changed. Finish or reconcile it before switching.');
        if(source.accountKey===target.accountKey){r.phase='verified';r.alreadySelected=true;await this.save(file,r);return structuredClone(r);}
        r.phase='releasing';await this.save(file,r);
        for(const thread of source.threads){
          if(v.threads.some(t=>t.id===thread.id))await effect('release:'+thread.id,requestId=>this.driver.release({operationId,requestId,source,target,thread}));
          v=await observe();
          if(!original(v)||!sourceThreads(v,source,{subset:true}))throw fail('shared_account_release_changed','Server ownership or thread state changed while releasing. No replacement owner was launched.');
        }
        if(v.threads.length)return {...structuredClone(r),waiting:true,reasonCode:'shared_threads_releasing'};
        r.phase='stopping';await this.save(file,r);
        await effect('stop',requestId=>this.driver.stopIdle({operationId,requestId,source,target}));v=await observe();
        if(v.kind!=='absent')return {...structuredClone(r),waiting:true,reasonCode:'shared_owner_stopping'};
      }
      if(v.kind==='absent'){
        if(!r.effects.stop)throw fail('shared_account_source_exited','The original server exited independently. Reconcile accepted work before resuming another owner.');
        r.phase='launching';await this.save(file,r);
        await effect('launch',requestId=>this.driver.launch({operationId,requestId,source,target}));v=await observe();
      }
      if(!destination(v)||!r.effects.launch||await this.driver.verifyOwnership({operationId,requestId:r.effects.launch.requestId,source,target,observed:v})!==true)
        throw fail('shared_account_destination_unverified','The replacement server is not verified against this switch receipt. No threads were resumed.');
      if(!sourceThreads(v,source,{subset:true}))throw fail('shared_account_foreign_threads','The replacement server already has unrelated or changed work. Preserve it for review.');
      r.phase='resuming';await this.save(file,r);
      for(const thread of source.threads){
        if(!v.threads.some(t=>t.id===thread.id))await effect('resume:'+thread.id,requestId=>this.driver.resume({operationId,requestId,source,target,thread}));
        v=await observe();
        if(!destination(v)||!sourceThreads(v,source,{subset:true}))throw fail('shared_account_restoration_changed','A restored conversation differs from its saved identity, history, settings or draft. Preserve it for review.');
      }
      if(!sourceThreads(v,source))throw fail('shared_account_restoration_incomplete','Some exact conversations have not been verified. Successful restoration remains saved.');
      r.phase='verified';r.verifiedAt=new Date(this.clock()).toISOString();r.destinationProcessIdentity=v.processIdentity;await this.save(file,r);return structuredClone(r);
    }finally{await claim.release();}
  }
}
