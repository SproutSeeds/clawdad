import {codexProcessOwners} from './codex-thread-control.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

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
        jobs.set(job.id,{id:job.id,action:job.action,fingerprint:job.fingerprint,status:job.status,
          accountEpoch:job.accountEpoch,accountSwitchHold:job.accountSwitchHold,accountReadOnly:job.accountReadOnly});
      }
    }catch(error){if(error.code!=='ENOENT')complete=false;}
  }
  return {complete,jobs:[...jobs.values()]};
}

// Lightweight inventory only: no tab focus, composer keystroke, capture, login,
// resume, process termination or workspace snapshot operation is performed.
export async function inspectAccountConsumers(runtime,{readOwners=codexProcessOwners}={}){
  const owners=await readOwners(),catalog=runtime.observation?.catalog||runtime.workspaceCatalog?.catalog;
  const tabs=catalog?.tabs||[],jobs=runtime.state?.jobs||[],consumers=[];
  for(const owner of owners){
    const tab=tabs.find(t=>t.tty?.replace('/dev/','')===owner.tty);
    const receipts=jobs.filter(j=>['queued','running','submitted','working','agent_queued','inserted','attention','interrupted'].includes(j.status)
      &&(j.args?.tabId===tab?.id&&tab || owner.threads?.includes(j.sessionId||j.args?.sessionId)));
    const shell=owner.tty==='??';
    consumers.push({id:'pid:'+owner.pid,pid:owner.pid,kind:owner.socket?'shared_app_server':shell?'background_codex':'terminal_codex',
      processIdentity:tab?.agentInstanceId||null,tabId:tab?.id,windowId:tab?.windowId,tty:owner.tty,
      sessionId:owner.threads.length===1?owner.threads[0]:null,directory:tab?.directory,title:tab?.title,
      busy:typeof tab?.isBusy==='boolean'?tab.isBusy:receipts.some(r=>['working','running','submitted','agent_queued'].includes(r.status))?true:null,
      draft:{state:'requires_verified_capture',recoverable:false},pendingReceipts:receipts.map(j=>({id:j.id,status:j.status})),
      accountVerified:false,recoverable:false,reason:owner.threads.length>1?'Multiple live conversations share this process. All owners need verified transition.':
        'Per-process account adoption and exact unsent input recovery still need verification.'});
  }
  return {complete:false,consumers,reasons:[
    ...(!catalog?['The native Terminal catalog is not currently available.']:[]),
    'This read-only inventory does not establish each process’s authenticated account or capture hidden drafts. Live switching remains guarded.',
  ]};
}
