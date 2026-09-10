import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {CodexSharedClient,rpcPages,codexProcessOwners,classifyThreadOwner,assertSharedThreadOwner,acquireThreadControl,validThreadId} from './codex-thread-control.mjs';
import {handleCodexServerRequest} from './codex-app-server-dispatch.mjs';

const exec=promisify(execFile), uuid=()=>crypto.randomUUID(), stamp=()=>new Date().toISOString();
const terminalStates=new Set(['completed','failed','interrupted']);
const activeStates=new Set(['submitted','working','agent_queued']);
const kinds=['cli','vscode','exec','appServer','subAgent','subAgentReview','subAgentCompact','subAgentThreadSpawn','subAgentOther','unknown'];
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const fingerprint=v=>JSON.stringify(ordered(v));
function text(value,max=32000){if(typeof value!=='string'||Buffer.byteLength(value)>max||value.includes('\0'))throw Error('Invalid draft text.');return value;}
const required=(value,label)=>{if(typeof value!=='string'||!value.trim())throw Error(`Missing ${label}.`);return value;};
const responseText=turn=>(turn?.items||[]).filter(i=>i.type==='agentMessage'&&i.phase!=='commentary').map(i=>i.text||'').filter(Boolean).join('\n\n');

export async function readCodexThreadIndex(home=path.join(os.homedir(),'.codex')){
  // Older titles can contain the complete original prompt. Inventory needs a
  // compact label; full content belongs to the paginated history endpoint.
  const sql="SELECT id, substr(name,1,200) AS name, substr(title,1,200) AS title, cwd, source, rollout_path AS path, archived, updated_at AS updatedAt, history_mode AS historyMode FROM threads ORDER BY updated_at DESC, id";
  const {stdout}=await exec('/usr/bin/sqlite3',['-readonly','-json',path.join(home,'state_5.sqlite'),sql],{timeout:5000,maxBuffer:16*1024*1024});
  return JSON.parse(stdout||'[]');
}

// Thread drafts belong to this conversation UI, never to a Codex turn or a
// Terminal composer. Every mutating server RPC has a durable before-send receipt.
export class AssistantAppServer {
  constructor({root,client=new CodexSharedClient(),workspaces=async()=>({roots:[]}),readIndex=readCodexThreadIndex,
    readOwners=codexProcessOwners,lease=acquireThreadControl,onJob=async()=>{},onCreated=async()=>{},now=Date.now}={}){
    Object.assign(this,{root,client,workspaces,readIndex,readOwners,lease,onJob,onCreated,now});
    this.state=null;this.lock=Promise.resolve();this.inventories=new Map();this.inspections=new Map();this.historyObservations=new Map();this.historyPages=new Map();this.timer=null;this.polling=null;
    client.onNotification=()=>{void this.poll();};
    // Preserve Codex permission prompts. This client never grants itself an
    // approval, answers a user question, or takes over another client's prompt.
    client.onServerRequest=m=>{void this.recordApproval(m).catch(()=>{
      // Leave the permission unanswered on recovery failure. Never approve it
      // or crash the shared HTTP service because a prompt lost its owner.
      client.discardServerRequest?.(m.id);
    });};
  }
  async load(){
    if(this.state)return;
    if(this.loading)return this.loading;
    this.loading=this.loadState().finally(()=>{this.loading=null;});
    return this.loading;
  }
  async loadState(){
    await fs.mkdir(this.root,{recursive:true,mode:0o700});
    try{this.state=JSON.parse(await fs.readFile(path.join(this.root,'state.json'),'utf8'));}
    catch(e){if(e.code!=='ENOENT')throw e;this.state={version:1,drafts:{},jobs:[],bindings:{}};}
    if(this.state.version!==1)throw Error('App-server receipts require an update.');
    for(const j of this.state.jobs)if(j.status==='sending'){j.status='attention';j.error='The Mac restarted before delivery was confirmed. Reconcile the original request; it will not be repeated.';}
  }
  async save(){const tmp=path.join(this.root,`.${uuid()}.tmp`);await fs.writeFile(tmp,JSON.stringify(this.state),{mode:0o600});await fs.rename(tmp,path.join(this.root,'state.json'));}
  transaction(fn){const p=this.lock.then(async()=>{await this.load();return fn();});this.lock=p.catch(()=>{});return p;}
  async changed(job){await this.save();await this.onJob(structuredClone(job));return {job};}
  start(){if(this.timer)return;this.timer=setInterval(()=>void this.poll(),3000);this.timer.unref?.();}
  async close(){clearInterval(this.timer);this.timer=null;this.client.close();await this.polling;}
  async allowedProject(project){
    const real=await fs.realpath(required(project,'project path'));const w=await this.workspaces();
    const roots=await Promise.all((w.roots||[]).map(r=>fs.realpath(r.path)));
    if(!roots.some(root=>real===root||real.startsWith(root+path.sep)))throw Error('Choose a project inside the Mac’s configured ClawDad workspace roots.');
    if(!(await fs.stat(real)).isDirectory())throw Error('Project directory is unavailable.');return real;
  }
  async inventory(args={}){
    if(args.cursor){const [key,offsetText]=args.cursor.split(':');const cached=this.inventories.get(key),offset=Number(offsetText);
      if(!cached||this.now()-cached.at>300000||!Number.isInteger(offset)||offset<0)throw Error('This inventory expired. List the threads again.');return this.page(key,cached,offset);}
    const [active,archived,index,owners,loaded,w]=await Promise.all([
      rpcPages(this.client,'thread/list',{limit:100,sourceKinds:kinds,modelProviders:[],archived:false}),
      rpcPages(this.client,'thread/list',{limit:100,sourceKinds:kinds,modelProviders:[],archived:true}),
      this.readIndex().catch(()=>null),this.readOwners(),rpcPages(this.client,'thread/loaded/list',{limit:100}),this.workspaces()]);
    const merged=new Map([...active,...archived].map(t=>[t.id,{...t,listed:true,archived:archived.some(v=>v.id===t.id)}]));
    for(const row of index||[]){const listed=merged.get(row.id);merged.set(row.id,{...row,...listed,cwd:row.cwd,indexPath:row.path,archived:!!row.archived,listed:!!listed});}
    const data=[];
    for(const t of merged.values()){
      if(args.project&&t.cwd!==args.project)continue;
      if(args.archived!==undefined&&t.archived!==args.archived)continue;
      if(!args.includeInternal&&typeof t.source==='object')continue;
      if(!args.includeInternal&&String(t.source).startsWith('sub'))continue;
      const observed=this.historyObservations.get(t.id);
      const available=observed?.available ?? (t.listed||await fs.stat(t.indexPath||t.path||'').then(s=>s.isFile()).catch(()=>false) ? true : null);
      // Index metadata can survive rollout cleanup, or use paginated storage.
      // Missing files are unverified history, not proof the thread is absent.
      if(available===false&&!args.includeUnavailable)continue;
      const name=t.name||t.title||t.preview||path.basename(t.cwd||'')||'Untitled conversation';
      if(args.search&&!`${name} ${t.cwd} ${t.id}`.toLowerCase().includes(args.search.toLowerCase()))continue;
      data.push({id:t.id,name,cwd:t.cwd,archived:t.archived,source:t.source,updatedAt:t.updatedAt,historyAvailable:available,
        historyStatus:available===false?'unavailable':available===null?'needs_inspection':'available',...(observed?.reason?{historyReason:observed.reason}:{}),
        listedByServer:t.listed,owner:classifyThreadOwner(t.id,owners,loaded),status:t.status||{type:'notLoaded'}});
    }
    data.sort((a,b)=>Number(b.updatedAt)-Number(a.updatedAt)||a.id.localeCompare(b.id));
    const key=uuid(),cached={at:this.now(),data,coverage:{serverActive:active.length,serverArchived:archived.length,indexRecords:index?.length??null,
      indexAvailable:index!==null,loaded:loaded.length,roots:w.roots,completePagination:true}};
    this.inventories.set(key,cached);for(const [k,v] of this.inventories)if(this.now()-v.at>300000)this.inventories.delete(k);
    return this.page(key,cached,0);
  }
  page(key,cache,offset){return {threads:cache.data.slice(offset,offset+50),nextCursor:offset+50<cache.data.length?`${key}:${offset+50}`:null,coverage:cache.coverage,observedAt:new Date(cache.at).toISOString()};}
  async inspect(threadId){
    if(!validThreadId(threadId))throw Error('Choose the exact thread ID from list_threads.');
    const [{thread},owners,loaded,index]=await Promise.all([this.client.request('thread/read',{threadId,includeTurns:false}),this.readOwners(),rpcPages(this.client,'thread/loaded/list',{limit:100}),this.readIndex().catch(()=>[])]);
    if(thread.id!==threadId)throw Error('Codex returned a different thread identity.');
    const row=index.find(t=>t.id===threadId), owner=classifyThreadOwner(threadId,owners,loaded);
    const archived=!!row?.archived;
    const queue=await rpcPages(this.client,'thread/queue/list',{threadId,limit:100}).catch(e=>({unavailable:e.message}));
    await this.load();const draft=this.state.drafts[threadId]||{revision:0,text:'',images:[]};
    const targetToken=uuid();this.inspections.set(targetToken,{threadId,owner:fingerprint(owner),at:this.now()});
    for(const [key,value] of this.inspections)if(this.now()-value.at>45000)this.inspections.delete(key);
    return {thread:{...thread,cwd:row?.cwd||thread.cwd,archived},owner,queue,draft,targetToken,expiresInSeconds:45,
      ...(archived?{guidance:'This thread is archived. On an explicit request to restore or resume it, use restore_thread, inspect again, then resume/send as authorized.'}:{}),
      capabilities:{read:true,draft:true,restore:archived&&owner.kind==='saved',resume:!archived&&owner.kind==='saved',send:!archived&&['saved','app_server'].includes(owner.kind)&&Array.isArray(queue),queue:!archived&&['saved','app_server'].includes(owner.kind)&&Array.isArray(queue)}};
  }
  async history(args){
    if(!validThreadId(args.threadId))throw Error('Choose an exact thread ID.');
    const limit=Math.min(50,Math.max(1,args.limit||20));
    if(args.cursor?.startsWith('legacy:')){
      const [,token,offsetText]=args.cursor.split(':'),cached=this.historyPages.get(token),offset=Number(offsetText);
      if(!cached||cached.threadId!==args.threadId||this.now()-cached.at>300000||!Number.isInteger(offset)||offset<0)throw Error('History snapshot expired. Read this thread again.');
      return {data:cached.turns.slice(offset,offset+limit),nextCursor:offset+limit<cached.turns.length?`legacy:${token}:${offset+limit}`:null};
    }
    try {
      const result=await this.client.request('thread/turns/list',{threadId:args.threadId,limit,itemsView:'full',sortDirection:'asc',...(args.cursor?{cursor:args.cursor}:{})});
      this.historyObservations.set(args.threadId,{available:true});return result;
    }catch(error){
      if(args.cursor||!/thread not loaded|method not found/i.test(error.message)){
        this.historyObservations.set(args.threadId,{available:false,reason:'Saved history could not be read. Its source may be missing; inspect this exact thread in ClawDad before resuming.'});throw error;
      }
      // Legacy history is supported by thread/read without resuming a runtime.
      // Page its immutable read snapshot so an update cannot shift page offsets.
      try {
        const {thread}=await this.client.request('thread/read',{threadId:args.threadId,includeTurns:true});
        if(thread?.id!==args.threadId||!Array.isArray(thread.turns))throw Error('Incomplete saved history.');
        const token=uuid();this.historyPages.set(token,{threadId:args.threadId,turns:thread.turns,at:this.now()});
        for(const [id,row] of this.historyPages)if(this.now()-row.at>300000)this.historyPages.delete(id);
        this.historyObservations.set(args.threadId,{available:true});
        return {data:thread.turns.slice(0,limit),nextCursor:thread.turns.length>limit?`legacy:${token}:${limit}`:null};
      }catch(failure){this.historyObservations.set(args.threadId,{available:false,reason:'The saved history source is unavailable. Restore it through ClawDad before resuming; no new runtime was created.'});throw failure;}
    }
  }
  async images(paths=[]){
    if(!Array.isArray(paths)||paths.length>4)throw Error('Choose up to four authorized local images.');
    const images=[];
    for(const file of paths){if(!path.isAbsolute(file)||file.includes('\0'))throw Error('Use an absolute path to the authorized image.');
      const real=await fs.realpath(file),data=await fs.readFile(real);if(data.length>10*1024*1024)throw Error('An image exceeds 10 MB.');
      const png=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg=data[0]===255&&data[1]===216;
      if(!png&&!jpg)throw Error('Choose a PNG or JPEG image.');
      const sha256=crypto.createHash('sha256').update(data).digest('hex'),directory=path.join(this.root,'Images'),retained=path.join(directory,sha256+(png?'.png':'.jpg'));
      await fs.mkdir(directory,{recursive:true,mode:0o700});
      try{await fs.writeFile(retained,data,{flag:'wx',mode:0o400});}catch(e){if(e.code!=='EEXIST')throw e;}
      if(crypto.createHash('sha256').update(await fs.readFile(retained)).digest('hex')!==sha256)throw Error('The retained image failed verification.');
      images.push({path:retained,size:data.length,sha256});
    }return images;
  }
  async control(action,args,requestId,meta={}){
    if(action==='appserver.list')return this.inventory(args);
    if(action==='appserver.workspaces')return {workspace:await this.workspaces()};
    if(action==='appserver.inspect')return this.inspect(args.threadId);
    if(action==='appserver.history')return this.history(args);
    return this.transaction(async()=>{
      required(requestId,'stable request ID');if(requestId.length>128)throw Error('Invalid request ID.');
      const fp=fingerprint({action,args});let job=this.state.jobs.find(j=>j.id===requestId);
      if(job){if(job.fingerprint!==fp)throw Error('This request ID already belongs to a different action.');return {job};}
      const editable=['appserver.draft','appserver.clear'].includes(action);
      if(!['appserver.create','appserver.restore','appserver.resume','appserver.send','appserver.queue', 'appserver.reconcile',...['appserver.draft','appserver.clear']].includes(action))throw Error('Unsupported app-server action.');
      if(action==='appserver.reconcile')return this.reconcile(args.deliveryRequestId);
      if(action!=='appserver.create'&&!validThreadId(args.threadId))throw Error('Choose an exact inspected thread ID.');
      if(editable){
        const old=this.state.drafts[args.threadId]||{revision:0,text:'',images:[]};
        if(args.expectedRevision!==old.revision)throw Error('The draft changed. Inspect it before editing.');
        if((old.text||old.images.length)&&args.replace!==true)throw Error('This draft already contains text or images. Explicit replacement is required.');
        const draft={revision:old.revision+1,text:action==='appserver.clear'?'':text(args.text),images:action==='appserver.clear'?[]:await this.images(args.paths),updatedAt:stamp()};
        this.state.drafts[args.threadId]=draft;
        job={id:requestId,action,args,fingerprint:fp,status:'inserted',result:{threadId:args.threadId,draft,submitted:false},...meta};
        this.state.jobs.push(job);return this.changed(job);
      }
      job={id:requestId,action,args,fingerprint:fp,status:'sending',createdAt:stamp(),...meta};
      this.state.jobs.push(job);await this.changed(job);
      let claim;
      try{
        if(action==='appserver.create'){
          const cwd=await this.allowedProject(args.project);
          // Matches ClawDad's approve-mode workspace sandbox. Existing threads
          // are resumed without overriding their stored permissions.
          const result=await this.client.request('thread/start',{cwd,sandbox:'workspace-write',approvalPolicy:'never'});
          const id=result.thread?.id;if(!validThreadId(id))throw Object.assign(Error('Codex did not confirm the new thread identity.'),{uncertain:true});
          job.threadId=id;job.result={threadId:id,thread:result.thread};this.state.bindings[id]={pid:(await assertSharedThreadOwner(this.client,id,this.readOwners)).pid,cwd};
          await this.changed(job);
          if(args.name)await this.client.request('thread/name/set',{threadId:id,name:text(args.name,256)});
          const verified=await this.client.request('thread/read',{threadId:id});if(verified.thread?.id!==id)throw Error('New thread readback failed.');
          job.result.thread=verified.thread;await this.onCreated(verified.thread,cwd);job.status='completed';return this.changed(job);
        }
        const id=args.threadId;claim=await this.lease(id);
        let owner=await assertSharedThreadOwner(this.client,id,this.readOwners);
        const inspected=this.inspections.get(args.targetToken);
        this.inspections.delete(args.targetToken);
        if(!inspected||inspected.threadId!==id||this.now()-inspected.at>45000||inspected.owner!==fingerprint(owner))throw Error('This thread’s live owner or inspection changed. Inspect this exact thread again; no input was sent.');
        if(action==='appserver.restore'){
          job.threadId=id;await this.changed(job);
          const restored=await this.client.request('thread/unarchive',{threadId:id});
          if(restored.thread?.id!==id)throw Object.assign(Error('Restored thread identity was not confirmed. Reconcile this request before retrying.'),{uncertain:true});
          const row=(await this.readIndex()).find(t=>t.id===id);
          if(!row||row.archived)throw Object.assign(Error('Restoration has not been confirmed in the local index. Reconcile this request.'),{uncertain:true});
          job.status='completed';job.result={threadId:id,restored:true,submitted:false};return this.changed(job);
        }
        const existingDraft=this.state.drafts[id]||{revision:0,text:'',images:[]};
        if(action!=='appserver.resume'&&args.draftRevision===undefined&&(existingDraft.text||existingDraft.images.length))throw Error('This thread has a saved draft. Send its inspected revision or leave it intact.');
        if(owner.kind==='saved'){
          const {thread}=await this.client.request('thread/resume',{threadId:id});
          if(thread?.id!==id)throw Error('Resume returned another thread identity.');
          owner=await assertSharedThreadOwner(this.client,id,this.readOwners);
        }
        if(owner.kind!=='app_server')throw Error('The shared server has not confirmed ownership. Inspect this thread again.');
        this.state.bindings[id]={...this.state.bindings[id],pid:owner.pid};job.threadId=id;
        if(action==='appserver.resume'){job.status='completed';job.result={threadId:id,owner};return this.changed(job);}
        const draft=this.state.drafts[id]||{revision:0,text:'',images:[]};
        if(args.draftRevision!==undefined){if(draft.revision!==args.draftRevision)throw Error('The draft changed before sending. Inspect it again.');}
        else if(draft.text||draft.images.length)throw Error('This thread has a saved draft. Send its inspected revision or leave it intact.');
        const content=args.draftRevision!==undefined?draft:{text:text(args.text??''),images:await this.images(args.paths)};
        if(!content.text.trim()&&!content.images.length)throw Error('Write a message or attach an image.');
        for(const image of content.images){const bytes=await fs.readFile(image.path);if(crypto.createHash('sha256').update(bytes).digest('hex')!==image.sha256)throw Error('An attached image changed. Inspect the draft before sending.');}
        const input=[...(content.text.trim()?[{type:'text',text:content.text}]:[]),...content.images.map(i=>({type:'localImage',path:i.path}))];
        job.args={...args,text:content.text};job.delivery={input,clientUserMessageId:requestId};
        await this.changed(job);
        // Queue-add is durable server acceptance. The daemon automatically
        // starts it when idle, or after existing work, without steering a turn.
        const before=await this.client.request('thread/read',{threadId:id,includeTurns:false});
        if(action==='appserver.send'&&before.thread?.status?.type==='active')throw Error('This thread is working. Use queue_thread for a follow-up; Send will not steer it.');
        const accepted=await this.client.request('thread/queue/add',{threadId:id,...job.delivery});
        const entry=accepted.queuedSubmission||accepted.submission;
        const queue=await rpcPages(this.client,'thread/queue/list',{threadId:id,limit:100});
        const matched=queue.find(q=>q.clientUserMessageId===requestId);
        if(!matched&&(!entry||entry.clientUserMessageId!==requestId||!validThreadId(entry.id)))throw Object.assign(Error('Queue acceptance is uncertain. Reconcile this request; it will not be added again.'),{uncertain:true});
        job.queuedSubmissionId=(matched||entry).id;job.status='agent_queued';job.acceptedAt=stamp();job.result={threadId:id,queuedSubmissionId:job.queuedSubmissionId,owner:'app_server'};
        if(args.draftRevision!==undefined&&this.state.drafts[id]?.revision===args.draftRevision)this.state.drafts[id]={revision:args.draftRevision+1,text:'',images:[]};
        await this.changed(job);
        await this.reconcile(job.id);
        this.start();return {job};
      }catch(e){job.status='attention';job.error=e.message;job.uncertain=!!e.uncertain;return this.changed(job);}
      finally{await claim?.release();}
    });
  }
  async recordApproval(message){
    const owned=await this.transaction(async()=>{
      const threadId=message.params?.threadId;
      for(const job of this.state.jobs.filter(j=>j.threadId===threadId&&activeStates.has(j.status)))await this.reconcile(job.id);
      const job=this.state.jobs.findLast(j=>j.threadId===threadId&&j.turnId===message.params?.turnId&&activeStates.has(j.status));
      if(!job){this.client.discardServerRequest?.(message.id);return null;}
      const {thread}=await this.client.request('thread/read',{threadId});
      job.error='Codex needs your decision. Open this project in ClawDad to review its permission or question.';
      job.pendingApproval={id:message.id,method:message.method,threadId};await this.changed(job);
      return {threadId,turnId:job.turnId,projectPath:thread.cwd};
    });
    if(owned)await handleCodexServerRequest(this.client,message,{projectPath:owned.projectPath,permissionMode:'approve'},
      {record:()=>{}},{ownsRequest:m=>m.params?.threadId===owned.threadId&&m.params?.turnId===owned.turnId});
  }
  async reconcile(id){
    const job=this.state.jobs.find(j=>j.id===id);if(!job)throw Error('Delivery receipt was not found.');
    if(!job.threadId)return {job};
    if(job.action==='appserver.restore'){
      const row=(await this.readIndex()).find(t=>t.id===job.threadId);
      if(row&&!row.archived){const {thread}=await this.client.request('thread/read',{threadId:job.threadId});
        if(thread?.id===job.threadId){job.status='completed';job.error=null;job.uncertain=false;job.result={threadId:job.threadId,restored:true,submitted:false};return this.changed(job);}}
      return {job};
    }
    const queue=await rpcPages(this.client,'thread/queue/list',{threadId:job.threadId,limit:100});
    const queued=queue.find(q=>q.clientUserMessageId===job.id);
    if(queued){job.status='agent_queued';job.queuedSubmissionId=queued.id;job.error=null;return this.changed(job);}
    let cursor,turn;const seen=new Set();
    do {
      const page=await this.client.request('thread/turns/list',{threadId:job.threadId,limit:20,itemsView:'full',sortDirection:'desc',...(cursor?{cursor}:{})});
      turn=page.data.find(t=>t.id===job.turnId||(t.items||[]).some(i=>i.type==='userMessage'&&(i.clientId===job.id||i.clientUserMessageId===job.id)));
      cursor=page.nextCursor;
      if(turn||!cursor||page.data.at(-1)?.startedAt*1000<Date.parse(job.createdAt)-60000)break;
      if(seen.has(cursor)||seen.size>200)throw Error('Could not complete delivery reconciliation.');seen.add(cursor);
    }while(cursor);
    if(turn){job.turnId=turn.id;job.status=terminalStates.has(turn.status)?turn.status==='completed'?'completed':'attention':'working';job.error=turn.error?.message||null;job.response=responseText(turn)||job.response;if(terminalStates.has(turn.status))job.completedAt=stamp();await this.changed(job);}
    return {job};
  }
  poll(){
    if(this.polling)return this.polling;
    this.polling=this.transaction(async()=>{
      for(const job of this.state.jobs.filter(j=>activeStates.has(j.status))){try{await this.reconcile(job.id);}catch{job.connectionNotice='Waiting to reconnect to this task’s owning app server.';}}
    }).catch(()=>{}).finally(()=>{this.polling=null;});return this.polling;
  }
}
