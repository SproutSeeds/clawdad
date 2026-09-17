// Explicitly authorized saved-account fixture. Real HTTP/native/protocol path;
// a separate socket, controller journal and synthetic thread; zero model turns.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {AssistantRuntime,assistantHttp} from '../../lib/assistant-runtime.mjs';
import {CodexAppAccounts} from '../../lib/codex-app-accounts.mjs';
import {connectCodexAppAccounts} from '../../lib/codex-app-account-runtime.mjs';
import {CodexAccountAuthorizations} from '../../lib/codex-account-authorizations.mjs';
import {CodexSharedClient,rpcPages} from '../../lib/codex-thread-control.mjs';
import {researchSave} from '../../lib/research-budget.mjs';
if(process.argv[2]!=='--approved-saved-account-app-fixture')throw Error('Explicit saved-account fixture authorization required');
const realRoot=path.join(os.homedir(),'Library/Application Support/ClawDad/Accounts');
const resumed=process.argv[3];if(resumed&&!/^app-only-\d+$/.test(resumed))throw Error('Use the original disposable fixture receipt');
const root=path.join(realRoot,'verification-2026-09-17',resumed||'app-only-'+Date.now());await fs.mkdir(root,{recursive:true,mode:0o700});
const previous=resumed?JSON.parse(await fs.readFile(path.join(root,'evidence.json'),'utf8')):null;
const socketRoot=previous?path.dirname(previous.socketPath):await fs.mkdtemp('/private/tmp/cdad-app-fixture-');await fs.chmod(socketRoot,0o700);const socketPath=path.join(socketRoot,'s');
const censusRoot=await fs.mkdtemp('/private/tmp/clawdad-account-census-');await fs.chmod(censusRoot,0o700);
const evidence=previous?{...previous,status:'recovering',recoveryAt:new Date().toISOString()}:{startedAt:new Date().toISOString(),root,socketPath,modelTurns:0,loginActions:0,terminalActions:0,transitions:[]};
const save=()=>researchSave(path.join(root,'evidence.json'),evidence),sleep=ms=>new Promise(r=>setTimeout(r,ms)),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const log=await fs.open(path.join(root,'native-'+Date.now()+'.log'),'wx',0o600);
const census=spawn('/usr/bin/swift',['test','--package-path','native/macos','--filter','MacCodexAccountCensusFixtureTests/testPrivateReadOnlyCensusBridgeWhenAuthorized'],
  {cwd:process.cwd(),env:{...process.env,CLAWDAD_ACCOUNT_CENSUS_FIXTURE:censusRoot},stdio:['ignore',log.fd,log.fd]});await log.close();
let censusExited=false;census.once('exit',code=>{censusExited=true;evidence.censusExit=code;});
const readNative=async()=>{
  for(let attempt=0;attempt<3;attempt++){
    const id=randomUUID();await researchSave(path.join(censusRoot,'request.json'),{id});
    for(let n=0;n<180;n++){
      if(censusExited)throw Error('Native fixture ended');
      const reply=await fs.readFile(path.join(censusRoot,'reply.json'),'utf8').then(JSON.parse).catch(()=>null);
      if(reply?.id===id){if(reply.error)break;return {processes:reply.inventory.processes,processesComplete:reply.inventory.complete,processesObservedAt:reply.inventory.observedAt};}
      await sleep(50);
    }
  }throw Error('Native process census did not stabilize');
};
const runtime=new AssistantRuntime({root:path.join(root,'Assistant'),coordinator:{stop(){},prepare(){throw Error('No model turn allowed');}}});
runtime.appServer={root:path.join(runtime.root,'AppServer'),client:new CodexSharedClient({socketPath})};
runtime.accountProcessInventory=readNative;
runtime.accountProfileActivity=async home=>{const p=await readNative();return {home,complete:p.processesComplete,observedAt:p.processesObservedAt,owners:p.processes.filter(p=>p.authorizationHome===home)};};
const profiles=(await new CodexAccountAuthorizations({root:realRoot,binary:'/opt/homebrew/bin/codex'}).snapshot()).profiles
  .filter(p=>['codyshanemitchell@gmail.com','backtotheforttv@gmail.com'].includes(p.email));
if(profiles.length!==2||profiles.some(p=>p.authentication!=='verified'))throw Error('Both authorized saved sign-ins must already be verified');
// Seed only the two already-created synthetic QA rollouts in the shared index's
// history directory. Their IDs and bytes are exact; no private project is read.
// Codex 0.154 resume resolves IDs through this canonical history store.
if(!resumed)for(const name of ['rollout-2026-09-15T22-35-38-01a0a848-cb86-7033-ae6f-ce006f5b51bb.jsonl','rollout-2026-09-15T22-35-42-01a0a848-de93-75e3-b69d-8158ebb54973.jsonl']){
  const source=path.join(realRoot,'verification-2026-09-15/thread-continuity-1/sessions/2026/09/15',name);
  const destination=path.join(os.homedir(),'.codex/sessions/2026/09/15',name),bytes=await fs.readFile(source);
  await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});
  try{await fs.writeFile(destination,bytes,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST'||hash(await fs.readFile(destination))!==hash(bytes))throw e;}
  (evidence.syntheticRollouts||=[]).push({path:destination,sha256:hash(bytes)});
}
runtime.accounts=new CodexAppAccounts({root:path.join(root,'Accounts'),usage:{snapshot:async()=>({status:'unavailable'}),refresh:async()=>{}},
  authorizations:{root:realRoot,snapshot:async()=>({profiles})}});
const accounts=runtime.accounts;await runtime.load();
if(!resumed)for(const [i,p] of profiles.entries()){
  // Preserve exact production identity while retaining a disposable journal.
  await accounts.transaction(async(s,save)=>{s.accounts.push({id:p.accountId,email:p.email,authentication:'verified',accountKey:p.accountKey});await save({selectionChanged:true});});
}
// Reuse already-verified canonical resource receipts; no profile adoption or
// credential change is necessary for this disposable verification.
if(!resumed)for(const name of await fs.readdir(realRoot))if(name.startsWith('runtime-adoption-')){
  const file=path.join(realRoot,name,'state.json'),record=await fs.readFile(file,'utf8').then(JSON.parse).catch(()=>null);
  if(record?.state==='verified'&&profiles.some(p=>(p.home||path.join(realRoot,'profiles',p.accountId))===record.selection?.plan?.profileHome)){
    await fs.mkdir(path.join(accounts.root,name),{mode:0o700});await fs.copyFile(file,path.join(accounts.root,name,'state.json'));
  }
}
const connected=connectCodexAppAccounts({accounts,runtime,binary:'/opt/homebrew/bin/codex',socketPath,canonicalHome:path.join(os.homedir(),'.codex')});
const server=http.createServer(async(req,res)=>{try{if(await assistantHttp(req,res,new URL(req.url,'http://localhost'),runtime,{
  json:(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));},
  readBody:async req=>{let text='';for await(const chunk of req)text+=chunk;return JSON.parse(text);}}))return;res.writeHead(404).end();
}catch(e){res.writeHead(500).end(JSON.stringify({error:e.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const request=async body=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/v1/assistant/request`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error);return data;};
try{
  for(let n=0;n<2400;n++){if(await fs.stat(path.join(censusRoot,'ready')).catch(()=>null))break;if(censusExited)throw Error('Native fixture build failed');await sleep(50);}
  for(const [i,p] of [profiles[0],profiles[1],profiles[0]].entries()){
    if(i<evidence.transitions.length)continue;
    const before=await request({action:'accounts.status'}),current=before.accounts.activeOperation,start=Date.now();
    const recovering=current?.fenced&&current.targetId===p.accountId;
    const requestId=recovering?current.id:'fixture-app-'+randomUUID();
    const args=recovering?{action:'accounts.retry',operationId:requestId,requestId:'retry-'+randomUUID(),confirmed:true}:
      {action:'accounts.activate',accountId:p.accountId,expectedRevision:before.accounts.revision,requestId,confirmed:true};
    await request(args);await request(args);
    for(let n=0;n<80;n++){
      await accounts.advance();const op=(await accounts.snapshot()).activeOperation;
      if(i===1&&op.source?.threads?.length&&!evidence.threadFingerprint)evidence.threadFingerprint=hash(op.source.threads);
      evidence.progress={phase:op.phase,status:op.status,reason:op.reason};await save();
      if(op.status==='completed')break;if(op.status==='needs_attention')throw Error(op.reason);await sleep(1500);
    }
    const after=(await request({action:'accounts.status',receiptId:requestId})).accounts;
    if(after.activeAccountId!==p.accountId||after.activeOperation.status!=='completed')throw Error('Activation not verified');
    const observation=await connected.driver.observe({operationId:requestId});
    if(observation.accountKey!==p.accountKey)throw Error('Wrong actual account');
    if(i===0){
      const client=runtime.appServer.client;
      const threadId='01a0a848-cb86-7033-ae6f-ce006f5b51bb';
      const started=await client.request('thread/resume',{threadId,excludeTurns:true,model:'gpt-6-astra',sandbox:'read-only',approvalPolicy:'never',config:{model_reasoning_effort:'low'}});
      if(started.thread.id!==threadId)throw Error('The synthetic saved thread did not match');
      evidence.threadId=started.thread.id;
      await fs.mkdir(runtime.appServer.root,{recursive:true,mode:0o700});
      await researchSave(path.join(runtime.appServer.root,'state.json'),{version:1,drafts:{[evidence.threadId]:{revision:1,text:'Held exact fixture draft 🦞\nDO NOT SUBMIT',images:[]}},jobs:[]});
      client.close();
    }else if(hash(observation.threads)!==evidence.threadFingerprint)throw Error('Exact thread/history/settings/draft changed');
    evidence.transitions.push({email:p.email,pid:observation.pid,accountKey:observation.accountKey,requestId,ms:Date.now()-start,threadId:evidence.threadId});await save();
  }
  const final=await connected.processes.observe();connected.close();runtime.appServer.client.close();
  const client=new CodexSharedClient({socketPath});
  for(let n=0;n<100;n++){if(!(await rpcPages(client,'thread/loaded/list',{limit:100})).length)break;await sleep(1000);}client.close();
  // An explicit fixture-only permit replaces the completed activation permit
  // exclusively for cleaning up this proven disposable idle owner.
  connected.processes.permit=async()=>{};await connected.processes.stopIdle({operationId:evidence.transitions.at(-1).requestId,source:final});
  evidence.status='passed';
}catch(e){evidence.status='needs_attention';evidence.error=e.message;evidence.reasonCode=e.code;process.exitCode=1;connected.close();runtime.appServer.client.close();}
finally{
  server.close();await fs.writeFile(path.join(censusRoot,'done'),'done',{mode:0o600});
  for(let n=0;n<100&&!censusExited;n++)await sleep(50);evidence.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify(evidence));
}
