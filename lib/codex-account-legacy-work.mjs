import fs from 'node:fs/promises';
import path from 'node:path';
import {researchSave} from './research-budget.mjs';
import {privateAccountDirectory} from './codex-account-profile-process.mjs';
import {acquireCodexAccountClaim as acquireCodexDeliveryClaim} from './codex-account-claim.mjs';
import {readLegacyAccountInventory} from './codex-account-project-inventory.mjs';

const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(id);
// The existing project Send flow has its own detached workers/receipts. Record
// its acceptance under the common account fence before starting a worker; an
// HTTP admission check alone has a race with account preflight.
export class CodexAccountLegacyWork {
  constructor({root,accounts,inspectReceipt,readProjects=null,lease=acquireCodexDeliveryClaim}={}){Object.assign(this,{root,accounts,inspectReceipt,readProjects,lease});}
  file(id){if(!valid(id))throw Error('Invalid project work request.');return path.join(this.root,id+'.json');}
  async load(id){
    const file=this.file(id);
    try{const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||s.mode&0o077||s.size>16384)throw Error();
      const v=JSON.parse(await fs.readFile(file,'utf8'));if(v.version!==1||v.id!==id||v.action!=='legacy.dispatch'||typeof v.fingerprint!=='string'||!path.isAbsolute(v.projectPath))throw Error();return v;}
    catch(e){if(e.code==='ENOENT')return null;throw Error('The accepted project work receipt needs reconciliation.');}
  }
  async reserve({id,fingerprint,projectPath,sessionId}){
    if(!valid(id)||typeof fingerprint!=='string'||!path.isAbsolute(projectPath))throw Error('Project work identity is incomplete.');
    await privateAccountDirectory(this.root);
    const previous=await this.load(id);
    if(previous)throw Error('This project request already has a receipt. Reconcile it instead of starting it again.');
    return this.accounts.withWorkAdmission({id,action:'legacy.dispatch',fingerprint},async stamp=>{
      const job={version:1,id,action:'legacy.dispatch',fingerprint,projectPath,sessionId,status:'queued',effectPrepared:false,...stamp};
      await researchSave(this.file(id),job);return job;
    });
  }
  async update(id,fn){
    const claim=await this.lease(this.root,{threadId:id,requestId:'legacy-receipt',timeoutMs:5000});
    try{const job=await this.load(id);if(!job)throw Error('Original project work receipt is missing.');await fn(job);await researchSave(this.file(id),job);return job;}
    finally{await claim.release();}
  }
  async prepare(job){
    await this.accounts.assertDelivery(job);
    return this.update(job.id,current=>{
      if(current.effectPrepared)throw Error('Project delivery may already have occurred. Reconcile the original receipt.');
      current.effectPrepared=true;current.status='sending';
    });
  }
  async finishAttempt(job){
    return this.update(job.id,current=>{
      // Only a failure before the effect boundary proves non-delivery. Once a
      // worker/queue may exist, its actual receipt decides completion.
      if(!current.effectPrepared){current.status='cancelled';current.reasonCode='not_dispatched';}
    });
  }
  async snapshot(){
    const jobs=[];let complete=true;
    const names=await fs.readdir(this.root).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
    if(names.filter(n=>n.endsWith('.json')).length>10_000)return {complete:false,jobs:[]};
    for(const name of names.filter(n=>n.endsWith('.json'))){
      try{
        const job=await this.load(name.slice(0,-5));if(!job)continue;
        if(job.effectPrepared&&!['completed','cancelled'].includes(job.status)){
          const observed=await this.inspectReceipt(job);
          if(observed?.id!==job.id||observed.sessionId!==job.sessionId||observed.projectPath!==job.projectPath){
            job.status='attention';job.reasonCode='external_receipt_unresolved';
          }else if(observed.status==='completed')job.status='completed';
          else if(['queued','running','working','submitted','agent_queued'].includes(observed.status))job.status=observed.status;
          else {job.status='attention';job.reasonCode='external_work_needs_review';}
        }
        jobs.push(job);
      }catch{complete=false;}
    }
    if(this.readProjects){
      try{
        const state=JSON.parse(await fs.readFile(this.accounts.file,'utf8').catch(e=>{if(e.code==='ENOENT')return '{}';throw e;}));
        const known=Object.values(state.work||{}).filter(j=>j.legacyImported&&j.epoch===state.epoch&&!['completed','cancelled'].includes(j.status));
        const external=await readLegacyAccountInventory(await this.readProjects(),{known});
        complete&&=external.complete;
        for(const job of external.jobs)if(!jobs.some(j=>j.id===job.id))jobs.push(job);
      }catch{complete=false;}
    }
    return {complete,jobs};
  }
}
