// Live, bounded CLI fixture using the two already approved retained accounts.
// No browser/login, ordinary model turn, real Terminal tab or named snapshot.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {CodexAccountTerminalHandoff} from '../../lib/codex-account-terminal-handoff.mjs';
import {CodexAccountProfileProcess} from '../../lib/codex-account-profile-process.mjs';
import {CodexManagedLogin} from '../../lib/codex-managed-login.mjs';
import {compareAccountRuntimeConfiguration} from '../../lib/codex-account-layout.mjs';
import {researchSave} from '../../lib/research-budget.mjs';

const name=process.argv[2];
if(process.argv[3]!=='--approved-two-account-fixture'||!/^handoff-pty-[a-z0-9-]+$/.test(name||''))throw Error('Use a new handoff-pty-* name and the approved two-account fixture flag.');
const base=path.join(os.homedir(),'Library/Application Support/ClawDad/Accounts/verification-2026-09-15'),fixture=path.join(base,'thread-continuity-1'),root=path.join(fixture,name);
try{await fs.lstat(root);throw Error('Inspect the existing receipt; never replay the fixture name.');}catch(error){if(error.code!=='ENOENT')throw error;}
const candidate=path.resolve('native/macos/dist/candidates/codex-account-switch-2026-09-15');
const python=path.join(candidate,'tui-probe-venv/bin/python');
const accounts={},configurations={};
for(const [profile,email] of [['cody','codyshanemitchell@gmail.com'],['sun','playinthesunwithme@gmail.com']]){
  const connection=new CodexAccountProfileProcess({home:path.join(base,profile),binary:'/opt/homebrew/bin/codex'});
  try{
    await connection.connect();accounts[profile]=await new CodexManagedLogin({rpc:(...args)=>connection.request(...args)}).identity(email);
    configurations[profile]=(await connection.request('config/read',{cwd:path.join(fixture,'project'),includeLayers:false})).config;
  }finally{connection.close();}
}
const configuration=await compareAccountRuntimeConfiguration(configurations.cody,configurations.sun);
if(!configuration.equivalent)throw Object.assign(Error('The two fixture configurations differ; inspect changed fields without altering permissions.'),{changedFields:configuration.changedFields});
const child=spawn(python,['test/fixtures/codex-account-handoff-pty.py',name],{cwd:process.cwd(),stdio:['pipe','pipe','pipe']});
const output=createInterface({input:child.stdout}),pending=new Map();let serial=0,stderr='',exited=false,exitCode;
const exit=new Promise(resolve=>child.on('exit',code=>{exited=true;exitCode=code;for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('The private fixture process exited.'));}pending.clear();resolve(code);}));
child.stderr.on('data',data=>{stderr=(stderr+data).slice(-4000);});
output.on('line',line=>{
  try{const value=JSON.parse(line),item=pending.get(value.id);if(item){pending.delete(value.id);clearTimeout(item.timer);value.error?item.reject(Error(value.error)):item.resolve(value.result);}}
  catch{child.stdin.end();}
});
const rpc=(method,args={})=>new Promise((resolve,reject)=>{
  if(exited)return reject(Error('Fixture closed'));
  const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('The bounded fixture action timed out.'));},60000);
  pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,args})+'\n');
});
const receipt={version:1,state:'running',modelTurnsSent:0,signInActions:0,realTerminalWindows:0,startedAt:new Date().toISOString(),configuration,
  accounts:Object.fromEntries(Object.entries(accounts).map(([name,value])=>[name,{accountKey:value.accountKey,email:value.subscription.email,remainingPercent:value.remainingPercent,ordinaryUsageAllowed:value.ordinaryUsageAllowed}])),transitions:[]};
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const attachIdentity=value=>{
  if(value.kind==='agent'){
    const profile=value.authorizationHome===path.join(base,'cody')?'cody':value.authorizationHome===path.join(base,'sun')?'sun':null;
    if(!profile||value.email!==accounts[profile].subscription.email)throw Error('The live local account differs from its exact retained sign-in.');
    return {...value,accountKey:accounts[profile].accountKey,accountVerified:true};
  }return value;
};
const driver={
  observe:async()=>attachIdentity(await rpc('observe')),
  permit:async()=>{}, // This fixture's explicit flag is scoped to its own PTY.
  reconcile:async args=>rpc('receipt',{requestId:args.requestId}),
  verifyOwnership:async({requestId,observed})=>{const value=await rpc('receipt',{requestId});return value.effect==='launch'&&value.processIdentity===observed.processIdentity;},
  stopIdle:async({requestId,source})=>{await rpc('stop',{requestId,processIdentity:source.processIdentity});return {state:'exited'};},
  resumeExact:async({requestId,target})=>{await rpc('launch',{requestId,profile:target.authorizationHome===path.join(base,'sun')?'sun':'cody'});return {state:'started'};},
  restoreDraft:async({requestId,source})=>{await rpc('insert',{requestId,text:source.draft.text});return {state:'inserted'};},
};
try{
  let source=attachIdentity(await rpc('launch',{profile:'cody',requestId:'fixture-start'}));
  const draft='HANDOFF_BEGIN 🌿\n'+('Synthetic unsent research text. Preserve spaces, Unicode Ω and lines.\n').repeat(48)+'HANDOFF_END';
  source=attachIdentity(await rpc('insert',{requestId:'initial-draft',text:draft}));
  const controller=new CodexAccountTerminalHandoff({root:path.join(root,'recovery'),driver});
  await researchSave(path.join(root,'evidence.json'),receipt);
  for(const profile of ['sun','cody']){
    const target={accountKey:accounts[profile].accountKey,authorizationHome:path.join(base,profile),accountVerified:true,configurationVerified:true,
      configurationHash:configuration.sourceHash,layoutFingerprint:fingerprint({sessions:await fs.realpath(path.join(base,profile,'sessions')),index:path.join(fixture,'index'),permissions:'read-only/never'})};
    const args={operationId:'fixture-to-'+profile,requestId:'fixture-click-'+profile,source,target,confirmed:true};
    const result=await controller.run(args);
    const repeated=await new CodexAccountTerminalHandoff({root:path.join(root,'recovery'),driver}).run(args);
    if(result.phase!=='verified'||repeated.phase!=='verified')throw Error('Handoff did not finish with a verified receipt.');
    const current=await driver.observe();
    if(current.sessionId!==source.sessionId||current.tty!==source.tty||current.draft.text!==draft||current.accountKey!==target.accountKey)throw Error('Exact live handoff result did not match.');
    receipt.transitions.push({profile,state:result.phase,sessionId:current.sessionId,tty:current.tty,processId:current.pid,processIdentity:current.processIdentity,
      accountKey:current.accountKey,email:current.email,model:current.model,effort:current.reasoningEffort,draftBytes:Buffer.byteLength(draft),draftHash:current.draft.hash,
      draftVerification:current.draft.provenance,acceptedTurnsHash:current.acceptedTurnsHash,effects:Object.fromEntries(Object.entries(result.effects).map(([key,value])=>[key,{requestId:value.requestId,result:value.result}]))});
    await researchSave(path.join(root,'evidence.json'),receipt);source=current;
  }
  receipt.final=await rpc('finish');receipt.state='verified_same_private_pty_local_resume_and_draft';
}catch(error){receipt.state='needs_attention';receipt.failure=error.message;process.exitCode=1;}
finally{
  child.stdin.end();const timer=setTimeout(()=>child.kill('SIGTERM'),15000);
  await exit;clearTimeout(timer);output.close();receipt.driverExitCode=exitCode;receipt.finishedAt=new Date().toISOString();
  if(stderr){receipt.driverDiagnostic=stderr;receipt.state='needs_attention';process.exitCode=1;}
  await researchSave(path.join(root,'evidence.json'),receipt);
  console.log(JSON.stringify(receipt));
}
