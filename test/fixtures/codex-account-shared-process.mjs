// Approved synthetic account round trip using the actual Swift process census
// and production OS/protocol controllers. No login, model turn or live project.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {CodexSharedClient,rpcPages} from '../../lib/codex-thread-control.mjs';
import {CodexAccountSharedProcess} from '../../lib/codex-account-shared-process.mjs';
import {CodexAccountSharedRPC} from '../../lib/codex-account-shared-rpc.mjs';
import {CodexAccountSharedHandoff} from '../../lib/codex-account-shared-handoff.mjs';
import {withAccountSharedGate} from '../../lib/codex-account-shared-gate.mjs';
import {selectedCodexLaunch,withCodexAccountLaunch} from '../../lib/codex-account-launch.mjs';
import {readAccountOwners} from '../../lib/codex-account-owner-scope.mjs';
import {researchSave} from '../../lib/research-budget.mjs';

const name=process.argv[2];
let resuming=process.argv[3]==='--resume-approved-two-account-fixture';
if(!['--approved-two-account-fixture','--resume-approved-two-account-fixture'].includes(process.argv[3])||!/^shared-process-[a-z0-9-]+$/.test(name||''))throw Error('Use an explicitly approved shared-process-* fixture');
const base=path.join(os.homedir(),'Library/Application Support/ClawDad/Accounts/verification-2026-09-15'),fixture=path.join(base,'thread-continuity-1');
const root=path.join(fixture,name),thread='01a0a848-de93-75e3-b69d-8158ebb54973';
let previous;
if(resuming){
  previous=JSON.parse(await fs.readFile(path.join(root,'evidence.json'),'utf8'));
  if(previous.thread!==thread||previous.modelTurns!==0||previous.loginActions!==0||previous.state!=='needs_attention'||!previous.source||previous.transitions.length>=2)
    throw Error('The original fixture receipt cannot authorize recovery');
  await fs.copyFile(path.join(root,'evidence.json'),path.join(root,'evidence-before-recovery-'+Date.now()+'.json'),fs.constants.COPYFILE_EXCL);
}else await fs.mkdir(root,{mode:0o700});
if((await readAccountOwners()).some(owner=>owner.threads.includes(thread)&&(!resuming||owner.pid!==previous.source.pid)))throw Error('The synthetic fork already has another live owner');
const censusRoot=await fs.mkdtemp('/private/tmp/clawdad-account-census-');await fs.chmod(censusRoot,0o700);
const socketRoot=resuming?path.dirname(previous.socketPath):await fs.mkdtemp('/private/tmp/cdad-account-os-');
if(!socketRoot.startsWith('/private/tmp/cdad-account-os-'))throw Error('Unknown fixture socket directory');
await fs.chmod(socketRoot,0o700);const socketPath=path.join(socketRoot,'s');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const evidence=resuming?{...previous,state:'recovering',recoveryStartedAt:new Date().toISOString(),censusRoot,censusExit:null}:
  {version:1,state:'starting',thread,startedAt:new Date().toISOString(),modelTurns:0,loginActions:0,transitions:[],socketPath,censusRoot};
const save=()=>researchSave(path.join(root,'evidence.json'),evidence);
const log=await fs.open(path.join(root,resuming?'native-census-recovery-'+Date.now()+'.log':'native-census.log'),'wx',0o600);
const census=spawn('/usr/bin/swift',['test','--package-path','native/macos','--filter','MacCodexAccountCensusFixtureTests/testPrivateReadOnlyCensusBridgeWhenAuthorized'],
  {cwd:process.cwd(),env:{...process.env,CLAWDAD_ACCOUNT_CENSUS_FIXTURE:censusRoot},stdio:['ignore',log.fd,log.fd]});await log.close();
let censusExited=false;census.once('exit',code=>{censusExited=true;evidence.censusExit=code;});census.on('error',()=>{});
let activeOperation=name+'-initial';
const readNative=async()=>{
  for(let attempt=0;attempt<3;attempt++){
    const id=randomUUID();await researchSave(path.join(censusRoot,'request.json'),{id});
    for(let n=0;n<200;n++){
      if(censusExited)throw Error('Read-only native fixture ended');
      const reply=await fs.readFile(path.join(censusRoot,'reply.json'),'utf8').then(JSON.parse).catch(()=>null);
      if(reply?.id===id){if(reply.error)break;return {processes:reply.inventory.processes,processesComplete:reply.inventory.complete,processesObservedAt:reply.inventory.observedAt};}
      await sleep(50);
    }
  }
  throw Error('The actual native census did not stabilize');
};
const accounts={cody:'ca4dbdde17bd744517c78efde1c44fa6ce8313c3373fccba58f74808ece027fd',sun:'29d43ccf151241b704a8562d2738e16e40061369cb78490a4b177272da9acd17'};
const target=profile=>({accountKey:accounts[profile],authorizationHome:path.join(base,profile),sqliteHome:path.join(fixture,'index'),accountVerified:true,configurationVerified:true});
const permit=async args=>{if(args.operationId!==activeOperation)throw Error('Disposable fixture permit changed');};
const processes=new CodexAccountSharedProcess({root:path.join(root,'processes'),socketPath,readNative,permit,exclusive:fn=>withAccountSharedGate(socketPath,fn)});
const driver=new CodexAccountSharedRPC({root:path.join(root,'rpc'),socketPath,processes,permit,
  captureLocal:async()=>({draftHash:hash({text:'Held synthetic draft 🌿',images:[]}),receiptsResolved:true})});
const controller=()=>new CodexAccountSharedHandoff({root:path.join(root,'handoff'),driver});
try{
  for(let n=0;n<1800;n++){if(await fs.stat(path.join(censusRoot,'ready')).catch(()=>null))break;if(censusExited)throw Error('Native fixture build failed');await sleep(50);}
  if(!resuming){
  const launch=selectedCodexLaunch({verified:true,layoutVerified:true,method:'chatgpt',accountId:'fixture',operationId:activeOperation,...target('cody')});
  const log=await fs.open(path.join(root,'initial-server.log'),'wx',0o600);
  const child=spawn('/opt/homebrew/bin/codex',withCodexAccountLaunch(['app-server','--listen','unix://'+socketPath],launch),
    {cwd:fixture,env:launch.env,stdio:['ignore',log.fd,log.fd]});await log.close();child.on('error',()=>{});
  evidence.initialPID=child.pid;await save();
  for(let n=0;n<200;n++){if(await fs.stat(socketPath).catch(()=>null))break;await sleep(50);}
  const client=new CodexSharedClient({socketPath});
  try{const resumed=await client.request('thread/resume',{threadId:thread,excludeTurns:true,model:'gpt-6-astra',sandbox:'read-only',approvalPolicy:'never',config:{model_reasoning_effort:'low'}});
    if(resumed.thread.id!==thread||resumed.thread.status.type!=='idle')throw Error('Synthetic fork was not ready');}finally{client.close();}
  }
  for(const profile of ['sun','cody'].slice(evidence.transitions.length)){
    activeOperation=name+'-'+profile;const source=resuming?previous.source:await driver.observe({operationId:activeOperation,capture:true});resuming=false;
    if(source.threads.length!==1||source.threads[0].id!==thread)throw Error('Loaded synthetic identity differs');
    evidence.baseline||=hash(source.threads);if(hash(source.threads)!==evidence.baseline)throw Error('Synthetic history/settings/draft changed');
    evidence.source=source;await save();let result;const started=Date.now();
    for(let n=0;n<70;n++){
      result=await controller().run({operationId:activeOperation,source,target:target(profile),confirmed:true});
      evidence.phase=result.phase;evidence.reasonCode=result.reasonCode;await save();if(!result.waiting)break;await sleep(2000);
    }
    if(result.phase!=='verified')throw Error('The shared process transition remains unverified');
    const observed=await driver.observe({operationId:activeOperation,source,target:target(profile)});
    if(hash(observed.threads)!==evidence.baseline)throw Error('Exact conversation state changed');
    await controller().run({operationId:activeOperation,source,target:target(profile),confirmed:true});
    evidence.transitions.push({profile,pid:observed.pid,processIdentity:observed.processIdentity,accountKey:observed.accountKey,ms:Date.now()-started});await save();
  }
  const final=await processes.observe();driver.close();
  const cleanup=new CodexSharedClient({socketPath});
  for(let n=0;n<100;n++){if(!(await rpcPages(cleanup,'thread/loaded/list',{limit:100})).length)break;await sleep(1000);}cleanup.close();
  await processes.stopIdle({operationId:activeOperation,source:final});
  evidence.state='verified_native_shared_process_round_trip';await fs.rm(socketRoot,{recursive:true,force:true});
}catch(error){evidence.state='needs_attention';evidence.reason=error.message;evidence.reasonCode=error.code;process.exitCode=1;driver.close();}
finally{
  await fs.writeFile(path.join(censusRoot,'done'),'done',{mode:0o600});
  for(let n=0;n<100&&!censusExited;n++)await sleep(50);
  evidence.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify(evidence));
}
