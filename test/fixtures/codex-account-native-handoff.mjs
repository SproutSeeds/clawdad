// Explicitly enabled, disposable real Terminal + native worker + HTTP path.
// No user thread, named snapshot, model turn or authentication change is used.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {AssistantRuntime,assistantHttp} from '../../lib/assistant-runtime.mjs';
import {CodexAccountNativeTransport} from '../../lib/codex-account-native-transport.mjs';
import {CodexAccountNativeDriver} from '../../lib/codex-account-native-driver.mjs';
import {CodexAccountTerminalHandoff} from '../../lib/codex-account-terminal-handoff.mjs';
import {CodexAccountProfileProcess} from '../../lib/codex-account-profile-process.mjs';
import {CodexManagedLogin} from '../../lib/codex-managed-login.mjs';
import {codexProcessOwners} from '../../lib/codex-thread-control.mjs';
import {compareAccountRuntimeConfiguration} from '../../lib/codex-account-layout.mjs';
import {researchSave} from '../../lib/research-budget.mjs';

const name=process.argv[2],run=promisify(execFile);
if(process.argv[3]!=='--approved-two-account-fixture'||!/^native-handoff-[a-z0-9-]+$/.test(name||''))throw Error('Choose a new native-handoff-* fixture name and approve the two-account fixture.');
const base=path.join(os.homedir(),'Library/Application Support/ClawDad/Accounts/verification-2026-09-15'),fixture=path.join(base,'thread-continuity-1');
const root='/private/tmp/clawdad-terminal-coverage-account-'+name,thread='01a0a848-cb86-7033-ae6f-ce006f5b51bb',project=path.join(fixture,'project');
const recover=process.argv[4]==='--reconcile-existing';
let previous;
if(recover){
  const original=path.join(root,'evidence-before-startup-reconciliation.json');
  previous=JSON.parse(await fs.readFile(await fs.stat(original).then(()=>original,()=>path.join(root,'evidence.json')),'utf8'));
  const requests=JSON.parse(await fs.readFile(path.join(root,'Accounts/Transport/native-control.json'),'utf8')).requests;
  if(previous.thread!==thread||!['resume_startup_pending','input_changed_during_observation','foreground_members_changed_during_observation'].includes(previous.reasonCode)||previous.transitions.length||requests.filter(r=>r.action==='launch').length!==1
    ||requests.some(r=>!['observe','launch'].includes(r.action)&&!(r.action==='status'&&r.state==='attention'
      &&r.reasonCode?.startsWith('paste_not_dispatched_')&&r.args.source.draft.text==='')))
    throw Error('Only the original uncertain initial fixture launch can be reconciled by this path');
  await fs.copyFile(path.join(root,'evidence.json'),original,fs.constants.COPYFILE_EXCL).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await fs.copyFile(path.join(root,'evidence.json'),path.join(root,'evidence-before-reconcile-'+randomUUID()+'.json'),fs.constants.COPYFILE_EXCL);
  await fs.rm(path.join(root,'stop-worker'),{force:true});await fs.rm(path.join(root,'worker-ready'),{force:true});
}else await fs.mkdir(root,{mode:0o700}); // Existing names are never replayed.
const evidence={version:1,state:'preflight',startedAt:new Date().toISOString(),root,thread,modelTurnsSent:0,signInActions:0,transitions:[]};
const write=()=>researchSave(path.join(root,'evidence.json'),evidence);
await write();
const owners=await codexProcessOwners();const existing=owners.filter(o=>o.threads.includes(thread));
if(existing.length&&(!recover||existing.length!==1||'/dev/'+existing[0].tty!==previous.tty))throw Error('The synthetic conversation already has another owner. Preserve it and reconcile the old fixture.');
if(recover&&!existing.length)throw Error('The original uncertain launch has no live owner; this reconciliation must not launch again');
const accounts={},configs={};
for(const [profile,email] of [['cody','codyshanemitchell@gmail.com'],['sun','playinthesunwithme@gmail.com']]){
  const connection=new CodexAccountProfileProcess({home:path.join(base,profile),binary:'/opt/homebrew/bin/codex'});
  try{await connection.connect();accounts[profile]=await new CodexManagedLogin({rpc:(...args)=>connection.request(...args)}).identity(email);
    configs[profile]=(await connection.request('config/read',{cwd:project,includeLayers:false})).config;
  }finally{connection.close();}
}
const configuration=await compareAccountRuntimeConfiguration(configs.cody,configs.sun);if(!configuration.equivalent)throw Error('Fixture configurations differ.');
const identities=Object.values(accounts).map(a=>({email:a.subscription.email,accountKey:a.accountKey,method:'chatgpt',verified:true}));
evidence.accounts=identities;evidence.configuration=configuration;await write();
const runtime=new AssistantRuntime({root:path.join(root,'Assistant'),coordinator:{run:()=>{throw Error('No model turns are allowed in this fixture');},stop:()=>{}}});
await runtime.load();const op='fixture-'+name;
let tty,windowID,worker,server;
const transport=new CodexAccountNativeTransport({root:path.join(root,'Accounts','Transport'),authorize:async r=>r.operationId.startsWith(op)&&r.args?.source?.tty===tty});
runtime.accountNativeControl=transport;
const json=(res,status,data)=>{
  if(status>=400)void fs.appendFile(path.join(root,'http-errors.jsonl'),JSON.stringify({at:new Date().toISOString(),status,error:data.error,reasonCode:data.reasonCode})+'\n',{mode:0o600});
  res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));
};
const token=randomUUID();
server=http.createServer(async(req,res)=>{
  if(req.headers.authorization!=='Bearer '+token)return json(res,401,{error:'Authentication required'});
  const readBody=async()=>{let data='';for await(const chunk of req){data+=chunk;if(Buffer.byteLength(data)>1024*1024)throw Error('Fixture request too large');}return data?JSON.parse(data):{};};
  if(!await assistantHttp(req,res,new URL(req.url,'http://127.0.0.1'),runtime,{readBody,json}))json(res,404,{error:'Fixture route unavailable'});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
await researchSave(path.join(root,'connection.json'),{baseURL:'http://127.0.0.1:'+server.address().port});
await fs.writeFile(path.join(root,'native-server.token'),token,{mode:0o600});
const driver=new CodexAccountNativeDriver({transport,identities,permit:async()=>{},verifyPending:async()=>true,waitMs:60000});
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const apple=value=>'"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
const appleScript=script=>run('/usr/bin/osascript',['-e',script],{timeout:30000});
let title='ClawDad account QA '+name;
try{
  // A new physical fixture window. Never reuse a working project tab.
  let created;
  if(recover){
    title=previous.fixtureTitle;created=[previous.tty,previous.windowID];
    if(!/^ClawDad account QA native-handoff-[a-z0-9-]+$/.test(title)||!/^\d+$/.test(previous.windowID)||!/^\/dev\/ttys\d+$/.test(previous.tty))throw Error('Fixture recovery identity changed');
    await appleScript(`tell application "Terminal"\nset matches to every window whose id is ${previous.windowID}\nif (count of matches) is not 1 then error "fixture missing"\nset w to item 1 of matches\nif (count of tabs of w) is not 1 then error "fixture changed"\nif tty of tab 1 of w is not ${apple(previous.tty)} then error "fixture changed"\nset index of w to 1\nactivate\nend tell`);
  }else if(process.argv[4]){
    const oldName=process.argv[4];if(!/^native-handoff-[a-z0-9-]+$/.test(oldName))throw Error('Invalid disposable fixture reuse');
    const oldRoot='/private/tmp/clawdad-terminal-coverage-account-'+oldName,prior=JSON.parse(await fs.readFile(path.join(oldRoot,'evidence.json'),'utf8'));
    const requests=JSON.parse(await fs.readFile(path.join(oldRoot,'Accounts/Transport/native-control.json'),'utf8')).requests;
    if(!requests.length||requests.some(r=>r.action!=='observe')||!/^\d+$/.test(prior.windowID)||!/^\/dev\/ttys\d+$/.test(prior.tty))throw Error('Only an untouched initial fixture shell can be reused');
    title=prior.fixtureTitle||'ClawDad account QA '+(prior.reusedEmptyFixture||oldName);
    if(!/^ClawDad account QA native-handoff-[a-z0-9-]+$/.test(title))throw Error('Disposable title identity changed');
    const result=(await appleScript(`tell application "Terminal"\nset matches to every window whose id is ${prior.windowID}\nif (count of matches) is not 1 then error "fixture missing"\nset w to item 1 of matches\nif (count of tabs of w) is not 1 then error "fixture changed"\nset t to tab 1 of w\nif tty of t is not ${apple(prior.tty)} or custom title of t is not ${apple(title)} or busy of t then error "fixture owner changed"\nset index of w to 1\nactivate\nreturn (tty of t) & "|" & (id of w as text)\nend tell`)).stdout.trim();
    created=result.split('|');evidence.reusedEmptyFixture=oldName;
  }else created=(await appleScript(`tell application "Terminal"\nset t to do script ${apple('unset HISTFILE; cd -- '+quote(project))}\nset custom title of t to ${apple(title)}\nset w to front window\nset bounds of w to {60, 60, 1750, 1030}\nactivate\nreturn (tty of t) & "|" & (id of w as text)\nend tell`)).stdout.trim().split('|');
  [tty,windowID]=created;if(!/^\/dev\/ttys\d+$/.test(tty)||!/^\d+$/.test(windowID))throw Error('Exact new fixture window unavailable');
  evidence.tty=tty;evidence.windowID=windowID;evidence.fixtureTitle=title;evidence.state='native_worker_starting';await write();
  const log=await fs.open(path.join(root,'worker.log'),'w',0o600);
  worker=spawn('/usr/bin/swift',['test','--package-path','native/macos','--filter','MacAssistantTerminalTransportLiveTests/testIsolatedNativeWorker'],
    {cwd:process.cwd(),env:{...process.env,CLAWDAD_TERMINAL_QA_ROOT:root},stdio:['ignore',log.fd,log.fd]});
  worker.on('error',()=>{});let exited=false;worker.on('exit',()=>{exited=true;});
  const deadline=Date.now()+180000;
  while(!await fs.stat(path.join(root,'worker-ready')).then(()=>true,()=>false)){
    if(exited||Date.now()>deadline)throw Error('The native fixture worker did not become ready. Inspect worker.log.');
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  let shell=recover?JSON.parse(await fs.readFile(path.join(root,'Accounts/Transport/native-control.json'),'utf8')).requests.find(r=>r.action==='launch').args.source:
    await driver.call(op,'observe',{source:{tty}});
  if(!recover&&(shell.kind!=='shell'||shell.draft.text!==''))throw Error('The new fixture shell is not empty');
  // Use the same exact original synthetic conversation and accepted history.
  const find=async dir=>{for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()){const result=await find(file);if(result)return result;}else if(entry.name.endsWith(thread+'.jsonl'))return file;}};
  const historyFile=await find(path.join(fixture,'sessions'));if(!historyFile)throw Error('Exact fixture history missing');
  const hashHistory=async()=>{const hash=createHash('sha256');for(const line of (await fs.readFile(historyFile,'utf8')).split('\n').filter(Boolean)){
    const row=JSON.parse(line),p=row.payload;if(row.type==='event_msg'&&['task_started','user_message','task_complete','turn_aborted'].includes(p.type)||row.type==='response_item'&&p.role==='user')hash.update(line+'\n');}return hash.digest('hex');};
  evidence.baselineAcceptedHistory=await hashHistory();await write();
  const target=profile=>({accountKey:accounts[profile].accountKey,authorizationHome:path.join(base,profile),sqliteHome:path.join(fixture,'index'),
    accountVerified:true,configurationVerified:true,configurationHash:configuration.sourceHash,layoutFingerprint:createHash('sha256').update(fixture).digest('hex')});
  const launchSource={...shell,sessionId:thread,directory:project,executable:await fs.realpath('/opt/homebrew/bin/codex'),
    acceptedTurnsHash:evidence.baselineAcceptedHistory,model:'gpt-6-astra',reasoningEffort:'low',resumeOptions:['--no-alt-screen','--sandbox','read-only','--ask-for-approval','never']};
  let source=recover?await driver.observe({operationId:op,source:launchSource,target:target('cody')}):
    driver.identity(await driver.call(op,'launch',{source:launchSource,target:target('cody')},op+'-start'));
  if(recover){evidence.initialLaunchReconciled=true;evidence.originalLaunchRequestId=op+'-start';}
  source.pendingReceiptsResolved=true;
  const draft='NATIVE_HANDOFF_BEGIN 🌿\n'+('Synthetic exact unsent content. Keep  spaces and Unicode Ω.\n').repeat(35)+'NATIVE_HANDOFF_END';
  source=driver.identity(await driver.call(op,'draft',{source,text:draft},op+'-initial-draft'));source.pendingReceiptsResolved=true;
  const controller=new CodexAccountTerminalHandoff({root:path.join(root,'Accounts','Handoff'),driver});
  for(const profile of ['sun','cody']){
    const args={operationId:op+'-'+profile,requestId:op+'-click-'+profile,source,target:target(profile),confirmed:true};
    const result=await controller.run(args);const repeat=await controller.run(args);
    const current=await driver.observe({operationId:args.operationId,source,target:args.target});
    if(result.phase!=='verified'||repeat.phase!=='verified'||current.sessionId!==thread||current.tty!==tty||current.draft.text!==draft)throw Error('Native transition did not preserve exact target and text');
    evidence.transitions.push({profile,phase:result.phase,pid:current.pid,processIdentity:current.processIdentity,sessionId:current.sessionId,tty:current.tty,
      accountKey:current.accountKey,model:current.model,effort:current.reasoningEffort,draftHash:current.draft.hash,draftBytes:Buffer.byteLength(draft),acceptedTurnsHash:current.acceptedTurnsHash});
    await write();source=current;
  }
  evidence.finalAcceptedHistory=await hashHistory();if(evidence.finalAcceptedHistory!==evidence.baselineAcceptedHistory)throw Error('A model turn unexpectedly changed the synthetic history');
  // Stop only this exact verified idle fixture process. Closing the disposable
  // physical window is a separate exact-ID + one-tab check below.
  await driver.call(op,'stop',{source},op+'-finish');
  evidence.state='verified_native_terminal_round_trip';
}catch(error){evidence.state='needs_attention';evidence.reasonCode=error.code||'fixture_failed';evidence.failure=error.message;process.exitCode=1;await write();}
finally{
  if(worker){await fs.writeFile(path.join(root,'stop-worker'),'stop',{mode:0o600});for(let i=0;i<100&&worker.exitCode===null;i++)await new Promise(r=>setTimeout(r,100));}
  try{await runtime.close();}finally{await new Promise(resolve=>server.close(resolve));}
  // Failed native input is deliberately left visible with its receipt. No
  // blind cleanup signal or broad Terminal close is ever used.
  if(evidence.state==='verified_native_terminal_round_trip'){
    const closed=await appleScript(`tell application "Terminal"\nset matches to every window whose id is ${windowID}\nif (count of matches) is not 1 then return "preserved"\nset w to item 1 of matches\nif (count of tabs of w) is not 1 then return "preserved"\nset t to tab 1 of w\nif tty of t is not ${apple(tty)} then return "preserved"\nif busy of t then return "preserved"\nclose w\nreturn "closed-fixture-only"\nend tell`);
    evidence.cleanup=closed.stdout.trim();
  }
  evidence.finishedAt=new Date().toISOString();await write();console.log(JSON.stringify(evidence));
}
