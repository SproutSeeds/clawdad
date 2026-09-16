// Explicit two-account disposable protocol/controller test. It uses the
// existing synthetic fork, never a live project, prompt, login or saved setup.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {CodexSharedClient,rpcPages,codexProcessOwners} from '../../lib/codex-thread-control.mjs';
import {CodexAccountSharedHandoff} from '../../lib/codex-account-shared-handoff.mjs';
import {CodexAccountSharedRPC} from '../../lib/codex-account-shared-rpc.mjs';
import {selectedCodexLaunch,withCodexAccountLaunch} from '../../lib/codex-account-launch.mjs';
import {researchSave} from '../../lib/research-budget.mjs';
import {readAccountOwners} from '../../lib/codex-account-owner-scope.mjs';

const name=process.argv[2];
if(process.argv[3]!=='--approved-two-account-fixture'||!/^shared-controller-[a-z0-9-]+$/.test(name||''))throw Error('Use a new approved shared-controller-* fixture');
const base=path.join(os.homedir(),'Library/Application Support/ClawDad/Accounts/verification-2026-09-15');
const fixture=path.join(base,'thread-continuity-1'),root=path.join(fixture,name),thread='01a0a848-de93-75e3-b69d-8158ebb54973';
await fs.mkdir(root,{mode:0o700});
const socketRoot=await fs.mkdtemp('/private/tmp/cdad-account-controller-'),socketPath=path.join(socketRoot,'s');await fs.chmod(socketRoot,0o700);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const accounts={cody:'ca4dbdde17bd744517c78efde1c44fa6ce8313c3373fccba58f74808ece027fd',sun:'29d43ccf151241b704a8562d2738e16e40061369cb78490a4b177272da9acd17'};
const evidence={version:1,state:'preflight',startedAt:new Date().toISOString(),thread,modelTurns:0,loginActions:0,events:[],transitions:[]};
const save=()=>researchSave(path.join(root,'evidence.json'),evidence);
const owners=await readAccountOwners();if(owners.some(o=>o.threads.includes(thread)))throw Error('Synthetic fork already owned; preserve it');
let current,serial=0,activeOperation;
const identify=pid=>{
  try{return execFileSync('/bin/ps',['-p',String(pid),'-o','pid=,lstart=,comm='],{encoding:'utf8'}).trim();}catch{return null;}
};
const processes={
  async observe(){
    if(!current||current.exited)return {kind:'absent'};
    if(identify(current.pid)!==current.lifetime)throw Error('Fixture process lifetime changed');
    return {kind:'server',pid:current.pid,processIdentity:hash(current.lifetime),authorizationHome:current.home};
  },
  async dispatchHeld(op){return op===activeOperation;},
  async verifyOwnership({operationId,requestId,observed}){
    return current?.operationId===operationId&&(!requestId||current.requestId===requestId)&&current.pid===observed.pid&&hash(current.lifetime)===observed.processIdentity;
  },
  async assertThreadUnowned(id,owner){if((await readAccountOwners({socketPath})).some(o=>o.pid!==owner.pid&&o.threads.includes(id)))throw Error('Synthetic thread has another owner');},
  async launch({operationId,requestId,target}){
    if(current&&!current.exited)throw Error('Previous fixture owner remains');
    const old=await fs.lstat(socketPath).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
    if(old){if(!old.isSocket()||!current?.socketStat||old.dev!==current.socketStat.dev||old.ino!==current.socketStat.ino)throw Error('Unknown fixture socket');await fs.unlink(socketPath);}
    const launch=selectedCodexLaunch({verified:true,layoutVerified:true,method:'chatgpt',accountId:'fixture',operationId,
      accountKey:target.accountKey,authorizationHome:target.authorizationHome,sqliteHome:path.join(fixture,'index')});
    const log=await fs.open(path.join(root,'server-'+(++serial)+'.log'),'wx',0o600);
    const child=spawn('/opt/homebrew/bin/codex',withCodexAccountLaunch(['app-server','--listen','unix://'+socketPath],launch),
      {cwd:path.join(fixture,'project'),env:launch.env,stdio:['ignore','ignore',log.fd]});await log.close();
    const owner=current={pid:child.pid,child,home:target.authorizationHome,operationId,requestId,exited:false};
    child.once('exit',()=>{owner.exited=true;});child.on('error',()=>{});
    owner.lifetime=identify(owner.pid);if(!owner.lifetime)throw Error('Fixture process not observable');
    evidence.active={pid:owner.pid,lifetime:owner.lifetime,socketPath,operationId,requestId};await save();
    for(let n=0;n<200;n++){owner.socketStat=await fs.lstat(socketPath).catch(()=>null);if(owner.socketStat?.isSocket())break;if(owner.exited)throw Error('Fixture server exited before ready');await new Promise(r=>setTimeout(r,50));}
    if(!owner.socketStat?.isSocket())throw Error('Fixture socket not ready');
    evidence.events.push({at:new Date().toISOString(),action:'launch',pid:owner.pid,requestId});await save();
  },
  async stopIdle(){
    const owner=await this.observe(),client=new CodexSharedClient({socketPath});
    try{if((await client.request('server/diagnostics',{})).process?.id!==owner.pid||(await rpcPages(client,'thread/loaded/list',{limit:100})).length)throw Error('Fixture remains loaded');}
    finally{client.close();}
    if(identify(current.pid)!==current.lifetime)throw Error('Fixture changed before interrupt');
    current.child.kill('SIGINT');
    for(let n=0;n<100&&!current.exited;n++)await new Promise(r=>setTimeout(r,50));
    if(!current.exited)throw Error('Fixture shutdown unconfirmed');
    evidence.events.push({at:new Date().toISOString(),action:'stopped',pid:owner.pid});evidence.active=null;await save();
  }
};
const target=profile=>({accountKey:accounts[profile],authorizationHome:path.join(base,profile),accountVerified:true,configurationVerified:true});
const driver=new CodexAccountSharedRPC({root:path.join(root,'rpc'),socketPath,processes,
  permit:async a=>{if(a.operationId!==activeOperation)throw Error('Fixture permit changed');},
  captureLocal:async()=>({draftHash:hash({text:'Held synthetic draft 🌿',images:[]}),receiptsResolved:true})});
const controller=()=>new CodexAccountSharedHandoff({root:path.join(root,'handoff'),driver});
try{
  activeOperation=name+'-initial';await processes.launch({operationId:activeOperation,requestId:hash('initial'),target:target('cody')});
  const initial=new CodexSharedClient({socketPath});
  try{const result=await initial.request('thread/resume',{threadId:thread,excludeTurns:true,model:'gpt-6-astra',sandbox:'read-only',approvalPolicy:'never',config:{model_reasoning_effort:'low'}});
    if(result.thread.id!==thread||result.thread.status.type!=='idle')throw Error('Wrong initial fixture');}finally{initial.close();}
  for(const profile of ['sun','cody']){
    activeOperation=name+'-'+profile;
    const source=await driver.observe({operationId:activeOperation,capture:true});
    if(source.threads.length!==1||source.threads[0].id!==thread)throw Error('Wrong loaded fixture set');
    if(evidence.baseline&&hash(source.threads)!==evidence.baseline)throw Error('Thread state changed before switch');
    evidence.baseline||=hash(source.threads);evidence.source=source;await save();
    let result;const started=Date.now();
    for(let n=0;n<55;n++){
      result=await controller().run({operationId:activeOperation,source,target:target(profile),confirmed:true});
      evidence.phase=result.phase;evidence.waitingReason=result.reasonCode;await save();
      if(!result.waiting)break;await new Promise(r=>setTimeout(r,2000));
    }
    if(result.phase!=='verified')throw Error('Fixture transition still waiting');
    await controller().run({operationId:activeOperation,source,target:target(profile),confirmed:true});
    const observed=await driver.observe({operationId:activeOperation,source,target:target(profile)});
    if(hash(observed.threads)!==evidence.baseline)throw Error('Exact history/settings/draft changed');
    evidence.transitions.push({profile,pid:observed.pid,accountKey:observed.accountKey,ms:Date.now()-started,threadHash:hash(observed.threads)});await save();
  }
  // Release the controller's own subscription before timing unloading. A
  // second client cannot release another client's retained subscription.
  driver.close();
  const cleanup=new CodexSharedClient({socketPath});
  await cleanup.request('thread/unsubscribe',{threadId:thread});cleanup.close();
  const observeCleanup=new CodexSharedClient({socketPath});
  for(let n=0;n<90;n++){if(!(await rpcPages(observeCleanup,'thread/loaded/list',{limit:100})).length)break;await new Promise(r=>setTimeout(r,1000));}
  observeCleanup.close();await processes.stopIdle();
  evidence.state='verified_durable_shared_controller_round_trip';await fs.rm(socketRoot,{recursive:true,force:true});
}catch(error){evidence.state='needs_attention';evidence.reasonCode=error.code;evidence.reason=error.message;process.exitCode=1;driver.close();}
evidence.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify(evidence));
