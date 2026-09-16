import {codexProcessOwners} from './codex-thread-control.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {classifyAccountOwnerScope,readAccountOwners,readAccountProcessTree} from './codex-account-owner-scope.mjs';
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
  return {complete,jobs:[...jobs.values()]};
}

// Lightweight inventory only: no tab focus, composer keystroke, capture, login,
// resume, process termination or workspace snapshot operation is performed.
export async function inspectAccountConsumers(runtime,{readOwners=codexProcessOwners}={}){
  const native=runtime.accountConsumerInventory?await runtime.accountConsumerInventory():null;
  const owners=await readOwners(),catalog=runtime.observation?.catalog||runtime.workspaceCatalog?.catalog;
  const tabs=catalog?.tabs||[],jobs=runtime.state?.jobs||[],consumers=[];
  for(const owner of owners){
    const bindings=(native?.consumers||[]).filter(c=>Number(c.processId)===owner.pid&&c.tty?.replace('/dev/','')===owner.tty);
    const binding=bindings.length===1?bindings[0]:null;
    const tab=binding?tabs.find(t=>t.id===binding.tabId):tabs.find(t=>t.tty?.replace('/dev/','')===owner.tty);
    const receipts=jobs.filter(j=>['queued','running','submitted','working','agent_queued','inserted','attention','interrupted'].includes(j.status)
      &&(j.args?.tabId===tab?.id&&tab || owner.threads?.includes(j.sessionId||j.args?.sessionId)));
    const shell=owner.tty==='??';
    consumers.push({id:'pid:'+owner.pid,pid:owner.pid,kind:owner.socket?'shared_app_server':shell?'background_codex':'terminal_codex',
      processIdentity:binding?.agentInstanceId||tab?.agentInstanceId||null,tabId:binding?.tabId||tab?.id,windowId:binding?.windowId||tab?.windowId,tty:owner.tty,
      sessionId:binding?.sessionId&&owner.threads.includes(binding.sessionId)?binding.sessionId:owner.threads.length===1?owner.threads[0]:null,
      directory:binding?.directory||tab?.directory,title:binding?.title||tab?.title,
      authorizationHome:binding?.authorizationHome||null,executable:binding?.executable||null,cliVersion:binding?.cliVersion||null,
      alternateAuthentication:binding?.alternateAuthentication??null,
      resumeOptions:binding?.resumeOptions||null,launchReasonCode:binding?.launchReasonCode||null,
      model:binding?.model||null,reasoningEffort:binding?.reasoningEffort||null,settingsEvidence:binding?.settingsEvidence||null,
      busy:binding?(typeof binding.isBusy==='boolean'?binding.isBusy:null):receipts.some(r=>['working','running','submitted','agent_queued'].includes(r.status))?true:null,
      busyEvidence:binding?.busyEvidence||'requires_fresh_owner_observation',
      draft:{state:'requires_verified_capture',recoverable:false},pendingReceipts:receipts.map(j=>({id:j.id,status:j.status})),
      accountVerified:false,recoverable:false,reason:binding?.alternateAuthentication===true?'This process has an explicit API/token/provider environment override. Preserve its route and review it before subscription switching.':binding?.launchReasonCode?'This running Codex launch needs a configuration adapter: '+binding.launchReasonCode+'.':!binding&&owner.threads.length>1?'Multiple live conversations share this process. All owners need verified transition.':
        'Per-process account adoption and exact unsent input recovery still need verification.'});
  }
  return {complete:false,consumers,reasons:[
    ...(native?.reason?[native.reason]:[]),
    ...(!catalog?['The native Terminal catalog is not currently available.']:[]),
    'This read-only inventory does not establish each process’s authenticated account or capture hidden drafts. Live switching remains guarded.',
  ]};
}

// Complete managed inventory is distinct from the older diagnostic census.
// Read-only discovery cannot establish a hidden draft or a cached account;
// those are captured after the user accepts a fenced transition.
export async function inspectManagedAccountConsumers(runtime,{socketPath,readNative=()=>runtime.accountConsumerInventory(),
  readOwners=readAccountOwners,readTree=readAccountProcessTree,readShared,clock=Date.now,servicePID=process.pid}={}){
  const native=await readNative();
  const nativeIssues=[];
  if(native?.complete!==true)nativeIssues.push(native?.reason||'The Mac could not verify every Terminal tab. Refresh its inventory; existing sessions remain unchanged.');
  for(const entry of native?.consumers||[])if(entry.reasonCode)nativeIssues.push(
    'Terminal '+(entry.tty||entry.tabId||'tab')+' could not be inspected ('+entry.reasonCode+'). Its running process and input were preserved.');
  if(native?.processesComplete!==true)nativeIssues.push('The Mac process census is incomplete'+(native?.processesReasonCode?' ('+native.processesReasonCode+')':'')+'. Wait for it to refresh before switching.');
  else if(!Number.isFinite(native.processesObservedAt)||Math.abs(clock()-native.processesObservedAt)>5000)
    nativeIssues.push('The process census became stale before delivery. ClawDad is requesting a fresh inventory; existing sessions remain unchanged.');
  if(nativeIssues.length)return {complete:false,consumers:[],windows:native?.windows||[],reasons:nativeIssues,
    diagnostics:{workerId:native?.workerId??null,reasonCode:native?.reasonCode??null,
      complete:native?.complete===true,processesComplete:native?.processesComplete===true,
      processAgeMs:Number.isFinite(native?.processesObservedAt)?clock()-native.processesObservedAt:null,
      elapsedMs:native?.elapsedMs??null,lastRequestMatched:native?.lastRequestMatched??null}};
  const [owners,tree]=await Promise.all([readOwners({socketPath}),readTree()]);
  const sharedOwners=owners.filter(owner=>owner.socket);
  const scoped=classifyAccountOwnerScope({owners,native,tree,managedSocketPID:sharedOwners.length===1?sharedOwners[0].pid:null,servicePID});
  const consumers=[],reasons=scoped.unknown.map(owner=>'A Codex process needs ownership review: '+owner.reasonCode+'.');
  let complete=scoped.complete&&sharedOwners.length<=1;
  if(sharedOwners.length>1)reasons.push('The managed shared socket has more than one possible owner.');
  for(const owner of scoped.selected){
    const processRows=native.processes.filter(p=>Number(p.pid)===owner.pid),processRow=processRows[0];
    if(processRows.length!==1){complete=false;reasons.push('A selected native process changed during discovery.');continue;}
    const binding=owner.native,sessionId=binding?.sessionId||null;
    let busy=binding?.isBusy??null,shared;
    if(owner.scope==='shared'){
      try{shared=await readShared(owner);busy=shared.busy;
        if(shared.complete!==true||shared.pid!==owner.pid)throw Error();}
      catch{complete=false;reasons.push('The shared server inventory could not be read completely.');}
    }
    const pending=(runtime.state?.jobs||[]).filter(j=>['queued','sending','running','submitted','working','agent_queued'].includes(j.status)
      &&(sessionId&&(j.sessionId||j.args?.sessionId)===sessionId||binding?.tabId&&j.args?.tabId===binding.tabId));
    const reason=processRow.alternateAuthentication!==false?'This process has a separate authentication route. Preserve it for review.':
      processRow.reasonCode||binding?.launchReasonCode?'This launch configuration needs a supported adapter.':
      !sessionId&&owner.scope==='terminal'?'This fresh agent has no verified resumable conversation yet. Let it establish its own history before switching.':'';
    consumers.push({id:'pid:'+owner.pid,pid:owner.pid,kind:owner.scope==='shared'?'shared_app_server':'terminal_codex',
      processIdentity:binding?.agentInstanceId||processRow.processLifetime,tty:binding?.tty||owner.tty,
      tabId:binding?.tabId,windowId:binding?.windowId,sessionId,directory:binding?.directory||null,title:binding?.title||'ClawDad project threads',
      authorizationHome:processRow.authorizationHome,executable:processRow.executable,cliVersion:binding?.cliVersion,
      alternateAuthentication:processRow.alternateAuthentication,launchReasonCode:processRow.reasonCode||binding?.launchReasonCode,
      resumeOptions:binding?.resumeOptions,model:binding?.model,reasoningEffort:binding?.reasoningEffort,
      busy,busyEvidence:binding?.busyEvidence||'shared_thread_inventory',draft:{state:'requires_verified_capture',recoverable:false},
      pendingReceipts:pending.map(j=>({id:j.id,status:j.status})),accountVerified:false,recoverable:false,reason});
  }
  // Helpers with a separate open transcript can carry independent work. A
  // parent being idle is insufficient evidence that such work has finished.
  if(scoped.helpers.some(h=>h.threads?.some(id=>!scoped.selected.find(p=>p.pid===h.ownerPID)?.threads?.includes(id)))){
    complete=false;reasons.push('A managed child process still owns separate work. Finish or reconcile it before switching.');
  }
  return {complete,consumers,reasons,windows:native.windows||[],excludedApplications:scoped.foreign.map(p=>({pid:p.pid,application:p.application})),helperCount:scoped.helpers.length};
}
