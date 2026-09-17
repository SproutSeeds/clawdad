import fs from 'node:fs/promises';
import path from 'node:path';
import {accountWorkEvidence} from './codex-account-work-evidence.mjs';

// Read committed receipts, not an in-memory job that has not reached disk.
// No service locks are acquired: admission holds its own journal lock while
// the caller saves a job, and must never wait on a conversation lock here.
export async function readAccountWork(runtime){
  const files=[path.join(runtime.root,'state.json'),path.join(runtime.appServer?.root||path.join(runtime.root,'AppServer'),'state.json')];
  const jobs=new Map();let complete=true;
  for(const [index,file] of files.entries()){
    try{
      const stat=await fs.stat(file);if(stat.size>128*1024*1024)throw Error('Receipt inventory exceeds bounded read');
      const state=JSON.parse(await fs.readFile(file,'utf8'));
      if(state.version!==1||!Array.isArray(state.jobs))throw Error('Invalid receipt inventory');
      for(const job of state.jobs){
        if(index===0&&job.action?.startsWith('appserver.'))continue;
        if(typeof job.id!=='string'||typeof job.action!=='string'||typeof job.fingerprint!=='string'||typeof job.status!=='string'){
          complete=false;continue;
        }
        jobs.set(job.id,{id:job.id,action:job.action,fingerprint:job.fingerprint,...accountWorkEvidence(job),
          accountEpoch:job.accountEpoch,accountSwitchHold:job.accountSwitchHold});
      }
    }catch(error){if(error.code!=='ENOENT')complete=false;}
  }
  try{
    const file=path.join(runtime.research?.root||path.join(runtime.root,'Research'),'state.json');
    const stat=await fs.stat(file);if(stat.size>128*1024*1024)throw Error('Research receipt inventory exceeds bounded read');
    const state=JSON.parse(await fs.readFile(file,'utf8'));
    if(state.version!==1||!state.threads)throw Error('Invalid research receipt inventory');
    for(const receipt of Object.values(state.accountReviews||{})){
      if(typeof receipt.id!=='string'||receipt.action!=='research.review'||typeof receipt.fingerprint!=='string'||typeof receipt.status!=='string'){complete=false;continue;}
      jobs.set(receipt.id,receipt);
    }
  }catch(error){if(error.code!=='ENOENT')complete=false;}
  return {complete,jobs:[...jobs.values()]};
}
