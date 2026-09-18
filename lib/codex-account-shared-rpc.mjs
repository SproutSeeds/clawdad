import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {CodexSharedClient,rpcPages,validThreadId} from './codex-thread-control.mjs';
import {normalizeWeeklyUsage} from './codex-weekly-usage.mjs';
import {researchSave} from './research-budget.mjs';
import {privateAccountDirectory} from './codex-account-profile-process.mjs';

const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(ordered(v))).digest('hex');
const fail=(code,message)=>Object.assign(Error(message),{code});
const settings=r=>Object.fromEntries(['model','modelProvider','serviceTier','cwd','runtimeWorkspaceRoots','instructionSources',
  'approvalPolicy','approvalsReviewer','sandbox','activePermissionProfile','reasoningEffort'].map(k=>[k,r[k]??null]));
export async function canonicalSharedSettings(value){
  if(Array.isArray(value))return Promise.all(value.map(canonicalSharedSettings));
  if(value&&typeof value==='object')return Object.fromEntries(await Promise.all(Object.entries(value).map(async([k,v])=>[k,await canonicalSharedSettings(v)])));
  if(typeof value==='string'&&path.isAbsolute(value))return fs.realpath(value).catch(()=>value);
  return value;
}

export function sharedAccountResumeParams(thread){
  const s=thread.settings;
  if(!s||!validThreadId(thread.id)||s.cwd!==thread.cwd||typeof s.model!=='string'||typeof s.reasoningEffort!=='string')
    throw fail('shared_settings_incomplete','The exact saved thread model and permission settings are incomplete.');
  const params={threadId:thread.id,excludeTurns:true,model:s.model,modelProvider:s.modelProvider,
    cwd:s.cwd,runtimeWorkspaceRoots:s.runtimeWorkspaceRoots,approvalPolicy:s.approvalPolicy,approvalsReviewer:s.approvalsReviewer,
    config:{model_reasoning_effort:s.reasoningEffort}};
  // The protocol's optional nullable tier distinguishes omission from an
  // explicit reset. Codex 0.154.0 changed a captured null into "default" when
  // sent serviceTier:null. Preserve absent configuration by omitting it, and
  // still compare the actual resumed result before accepting the transition.
  if(s.serviceTier!==null&&s.serviceTier!==undefined)params.serviceTier=s.serviceTier;
  if(s.activePermissionProfile?.id)params.permissions=s.activePermissionProfile.id;
  else {
    const type=s.sandbox?.type;
    if(type==='readOnly'){
      params.sandbox='read-only';params.config['sandbox_read_only.network_access']=s.sandbox.networkAccess;
    }else if(type==='workspaceWrite'){
      params.sandbox='workspace-write';
      for(const [key,value] of Object.entries({writable_roots:s.sandbox.writableRoots,network_access:s.sandbox.networkAccess,
        exclude_tmpdir_env_var:s.sandbox.excludeTmpdirEnvVar,exclude_slash_tmp:s.sandbox.excludeSlashTmp}))params.config['sandbox_workspace_write.'+key]=value;
    }else if(type==='dangerFullAccess')params.sandbox='danger-full-access';
    else throw fail('shared_permissions_unsupported','This thread uses external or unrecognized permissions. Preserve its owner and review that adapter before switching.');
  }
  return params;
}

// The process adapter owns exact OS lifetime/socket verification. This adapter
// owns the supported protocol, paginated evidence and one-time RPC receipts.
// It never sends turn/start, turn/steer, queue/add, login or approval responses.
export class CodexAccountSharedRPC {
  constructor({root,socketPath,processes,permit,captureLocal,createClient=options=>new CodexSharedClient(options),clock=Date.now,
    retryWait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
    Object.assign(this,{root,socketPath,processes,permit,captureLocal,createClient,clock,retryWait});this.client=null;this.clientPID=null;this.cache=new Map();this.accountCache=null;
  }
  async connection(owner){
    if(this.clientPID!==owner.pid){this.client?.close();this.client=this.createClient({socketPath:this.socketPath});this.clientPID=owner.pid;this.accountCache=null;}
    const d=await this.client.request('server/diagnostics',{});
    if(d.process?.id!==owner.pid)throw fail('shared_socket_owner_changed','The shared socket belongs to another process. Preserve its threads.');
    return this.client;
  }
  async account(client){
    const before=await client.request('account/read',{refreshToken:false});
    if(before.account?.type!=='chatgpt')throw fail('shared_subscription_unavailable','This server does not have verified subscription authentication.');
    const cached=this.accountCache;
    if(cached&&cached.client===client&&cached.identity===hash(before.account)&&this.clock()-cached.at>=0&&this.clock()-cached.at<5000)return cached.value;
    let limits;
    for(let attempt=0;attempt<3;attempt++){
      try{limits=await client.request('account/rateLimits/read');break;}
      catch(error){if(/401 Unauthorized/.test(error.message)&&/token_revoked|invalidated oauth token/.test(error.message))
          throw Object.assign(fail('shared_authentication_expired','The shared server holds an expired subscription login.'),{accountIdentityHash:hash(before.account)});
        if(attempt===2)throw fail('shared_account_read_unavailable','The subscription identity service is temporarily unavailable. Preserve the switch receipt and retry its account check.');
        await this.retryWait(250*(2**attempt));}
    }
    const after=await client.request('account/read',{refreshToken:false});
    if(hash(before.account)!==hash(after.account))throw fail('shared_account_changed','The server account changed during inspection.');
    const value=normalizeWeeklyUsage(limits,{account:after.account});
    this.accountCache={client,identity:hash(after.account),at:this.clock(),value};return value;
  }
  async thread(client,id,{capture=false,operationId,owner}={}){
    const before=(await client.request('thread/read',{threadId:id,includeTurns:false})).thread;
    if(before?.id!==id||before.status?.type!=='idle')throw fail('shared_thread_working','Let this exact thread finish its accepted work before switching.');
    const queue=await rpcPages(client,'thread/queue/list',{threadId:id,limit:100});
    if(queue.length||client.serverRequests?.size)throw fail('shared_thread_pending','This server has queued work or an unanswered permission request.');
    let current=this.cache.get(owner.processIdentity+':'+id);
    if(capture){
      await this.permit({operationId,effect:'inspect_shared_settings',threadId:id,owner});
      // With only an exact loaded UUID, resume rejoins that same live thread.
      // No model/policy/path/history override is supplied during inspection.
      const response=await client.request('thread/resume',{threadId:id,excludeTurns:true});
      await client.request('thread/unsubscribe',{threadId:id});
      if(response.thread.id!==id||response.thread.status.type!=='idle')throw fail('shared_thread_changed','The inspected thread changed during its settings read.');
      current=await canonicalSharedSettings(settings(response));sharedAccountResumeParams({id,cwd:current.cwd,settings:current});
      this.cache.set(owner.processIdentity+':'+id,current);
    }
    if(!current||before.model!==current.model||before.reasoningEffort!==current.reasoningEffort||await canonicalSharedSettings(before.cwd)!==current.cwd)
      throw fail('shared_settings_changed','The live thread model, effort or directory needs a fresh verified settings capture.');
    let turns;
    try{turns=await rpcPages(client,'thread/turns/list',{threadId:id,limit:100,itemsView:'full'});}
    catch(error){
      if(/not materialized yet.*before first user message/.test(error.message))
        throw Object.assign(fail('shared_thread_not_persisted','A newly opened ClawDad thread has no saved conversation yet. Its draft is retained. Send its intended first message, or close that empty thread, then retry activation.'),{appAccountSafe:true});
      throw error;
    }
    const local=await this.captureLocal(id);
    if(local?.receiptsResolved!==true||typeof local.draftHash!=='string')throw fail('shared_local_work_pending','A ClawDad draft or delivery receipt cannot be reconciled yet.');
    const after=(await client.request('thread/read',{threadId:id,includeTurns:false})).thread;
    if(hash({id:before.id,cwd:before.cwd,model:before.model,reasoningEffort:before.reasoningEffort,status:before.status})!==
      hash({id:after.id,cwd:after.cwd,model:after.model,reasoningEffort:after.reasoningEffort,status:after.status})
      ||(await rpcPages(client,'thread/queue/list',{threadId:id,limit:100})).length)
      throw fail('shared_thread_changed','Work changed while checking the thread. Its owner was preserved.');
    return {id,cwd:current.cwd,historyHash:hash(turns),draftHash:local.draftHash,busy:false,queueEmpty:true,approvalsEmpty:true,
      settings:current,settingsVerified:true,receiptsResolved:true};
  }
  async observe({operationId,source,target,capture=false}={}){
    const owner=await this.processes.observe();
    if(owner.kind==='absent')return {kind:'absent',socketPath:this.socketPath,inventoryComplete:true,dispatchHeld:await this.processes.dispatchHeld(operationId)};
    const client=await this.connection(owner),ids=await rpcPages(client,'thread/loaded/list',{limit:100});
    if(ids.some(id=>!validThreadId(id))||new Set(ids).size!==ids.length)throw fail('shared_inventory_incomplete','The loaded thread inventory is incomplete.');
    let account,emptySourceAccountUnavailable=false,sourceAccountIdentityHash=null;
    try{account=await this.account(client);}catch(error){
      const originalSource=(source?.emptySourceAccountUnavailable===true||source?.sourceAccountUnavailable===true)
        &&source.pid===owner.pid&&source.processIdentity===owner.processIdentity
        &&(!source.sourceAccountIdentityHash||source.sourceAccountIdentityHash===error.accountIdentityHash);
      if(error.code!=='shared_authentication_expired'||!capture&&!originalSource||client.serverRequests?.size
        ||!await this.processes.dispatchHeld(operationId))throw error;
      await this.permit({operationId,effect:'inspect_expired_server',owner});
      emptySourceAccountUnavailable=ids.length===0;
      sourceAccountIdentityHash=error.accountIdentityHash;
    }
    const threads=[];
    for(const id of ids){
      // Restart recovery can use the durable captured settings only for this
      // same original lifetime or this operation's verified new launch.
      const saved=source?.threads.find(t=>t.id===id);
      if(saved&&!this.cache.has(owner.processIdentity+':'+id)){
        if(owner.processIdentity===source.processIdentity||await this.processes.verifyOwnership({operationId,source,target,observed:owner}))
          this.cache.set(owner.processIdentity+':'+id,saved.settings);
      }
      threads.push(await this.thread(client,id,{capture,operationId,owner}));
    }
    const after=await this.processes.observe();
    const loadedAfter=await rpcPages(client,'thread/loaded/list',{limit:100});
    if(after.processIdentity!==owner.processIdentity||hash([...ids].sort())!==hash([...loadedAfter].sort()))
      throw fail('shared_inventory_changed','The shared process or loaded inventory changed.');
    return {...owner,kind:'server',socketPath:this.socketPath,accountKey:account?.accountKey??null,accountVerified:!!account,
      ...(emptySourceAccountUnavailable?{emptySourceAccountUnavailable:true}:{}),
      ...(sourceAccountIdentityHash?{sourceAccountUnavailable:true,sourceAccountIdentityHash}:{}),
      inventoryComplete:true,dispatchHeld:await this.processes.dispatchHeld(operationId),threads:threads.sort((a,b)=>a.id.localeCompare(b.id))};
  }
  async receipt(requestId){
    if(!/^[a-f0-9]{64}$/.test(requestId||''))throw Error('Invalid shared action request.');
    await privateAccountDirectory(this.root);const file=path.join(this.root,'rpc-'+requestId+'.json');
    try{const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||s.mode&0o077||s.size>8192)throw Error();
      const r=JSON.parse(await fs.readFile(file,'utf8'));if(r.requestId!==requestId||r.version!==1)throw Error();return {file,value:r};}
    catch(e){if(e.code==='ENOENT')return {file,value:null};throw fail('shared_rpc_receipt_invalid','The original RPC receipt needs recovery.');}
  }
  async effect(args,name,action){
    await this.permit({...args,effect:name});const {file,value}=await this.receipt(args.requestId);
    const fingerprint=hash({operationId:args.operationId,name,threadId:args.thread?.id,source:args.source.processIdentity,target:args.target.accountKey});
    if(value){if(value.fingerprint!==fingerprint)throw fail('shared_rpc_request_conflict','That receipt belongs to another server action.');
      if(value.state==='completed')return value;if(value.state!=='not_dispatched')throw fail('shared_rpc_delivery_uncertain','The original server action may have occurred. Reconcile before retrying.');}
    const receipt={version:1,requestId:args.requestId,operationId:args.operationId,fingerprint,name,threadId:args.thread?.id,state:'not_dispatched'};
    await researchSave(file,receipt);
    let prepared=false;
    await action(async()=>{
      if(prepared)throw fail('shared_rpc_already_dispatched','A shared action can be dispatched once.');
      await this.permit({...args,effect:name});receipt.state='uncertain';await researchSave(file,receipt);prepared=true;
    });
    if(!prepared)throw fail('shared_rpc_prepare_missing','No shared action was dispatched.');
    receipt.state='completed';await researchSave(file,receipt);return receipt;
  }
  async reconcile(args){
    const {requestId,source,target,operationId,effect}=args,{file,value}=await this.receipt(requestId);
    if(!value||value.state!=='uncertain')return {state:value?.state||'not_dispatched',durable:true};
    if(!effect)return {state:value.state,durable:true};
    if(value.operationId!==operationId)throw fail('shared_rpc_request_conflict','That receipt belongs to another activation.');
    const owner=await this.processes.observe();let completed=false;
    if(effect==='stop')completed=owner.kind==='absent'&&await this.processes.exactDigest(source.pid)!==source.processIdentity;
    else if(effect==='launch')completed=owner.kind==='server'&&await this.processes.verifyOwnership({...args,observed:owner});
    else if(effect.startsWith('release:')&&owner.processIdentity===source.processIdentity){
      const client=await this.connection(owner);completed=!(await rpcPages(client,'thread/loaded/list',{limit:100})).includes(value.threadId);
    }else if(effect.startsWith('resume:')&&owner.kind==='server'&&await this.processes.verifyOwnership({...args,requestId:undefined,observed:owner})){
      const observed=await this.observe({operationId,source,target});
      const actual=observed.threads.find(t=>t.id===value.threadId),expected=source.threads.find(t=>t.id===value.threadId);
      completed=!!actual&&!!expected&&observed.accountKey===target.accountKey&&hash(actual)===hash(expected);
    }
    if(completed){value.state='completed';value.reconciledAt=new Date(this.clock()).toISOString();await researchSave(file,value);}
    return {state:value.state,durable:true};
  }
  async release(args){return this.effect(args,'release',async prepare=>{
    const owner=await this.processes.observe();if(owner.processIdentity!==args.source.processIdentity)throw fail('shared_owner_changed','The original server changed.');
    const client=await this.connection(owner),current=await this.thread(client,args.thread.id,{operationId:args.operationId,owner});
    if(hash(current)!==hash(args.thread))throw fail('shared_thread_changed','The exact thread changed before release.');
    await prepare();const reply=await client.request('thread/unsubscribe',{threadId:args.thread.id});
    if(!['unsubscribed','notSubscribed','notLoaded'].includes(reply.status))throw Error('Release acknowledgement unavailable');
  });}
  async stopIdle(args){return this.effect(args,'stop',async prepare=>{
    const owner=await this.processes.observe(),client=await this.connection(owner);
    if(owner.processIdentity!==args.source.processIdentity||(await rpcPages(client,'thread/loaded/list',{limit:100})).length)
      throw fail('shared_owner_not_released','The original server still owns threads.');
    this.client.close();await prepare();await this.processes.stopIdle(args);
  });}
  async launch(args){return this.effect(args,'launch',async prepare=>{await prepare();await this.processes.launch(args);});}
  async resume(args){return this.effect(args,'resume',async prepare=>{
    const owner=await this.processes.observe();
    if(!await this.processes.verifyOwnership({...args,requestId:undefined,observed:owner}))throw fail('shared_new_owner_unverified','The new owner does not match this switch.');
    const client=await this.connection(owner);
    if((await this.account(client)).accountKey!==args.target.accountKey)throw fail('shared_account_mismatch','The new server is on a different account.');
    if((await rpcPages(client,'thread/loaded/list',{limit:100})).includes(args.thread.id))throw fail('shared_resume_already_loaded','Reconcile this already-loaded thread before another resume.');
    await this.processes.assertThreadUnowned(args.thread.id,owner);
    const params=sharedAccountResumeParams(args.thread);
    await prepare();const resumed=await client.request('thread/resume',params);
    const restored=await canonicalSharedSettings(settings(resumed));
    if(resumed.thread.id!==args.thread.id||hash(restored)!==hash(args.thread.settings)){
      const fields=Object.entries(restored).filter(([k,v])=>hash(v)!==hash(args.thread.settings[k])).map(([k])=>k);
      throw fail('shared_restored_settings_changed','The restored '+fields.join(', ')+' settings differ. Preserve this owner for review.');
    }
    this.cache.set(owner.processIdentity+':'+args.thread.id,restored);
    await client.request('thread/unsubscribe',{threadId:args.thread.id});
  });}
  verifyOwnership(args){return this.processes.verifyOwnership(args);}
  close(){this.client?.close();}
}
