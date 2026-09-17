// Explicit, disposable native/HTTP two-account round trip. Never submits a
// model turn or switches the real shared runtime / working Terminal window.
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
import {CodexAccountProfileProcess} from '../../lib/codex-account-profile-process.mjs';
import {CodexManagedLogin} from '../../lib/codex-managed-login.mjs';
import {CodexSharedClient,codexProcessOwners} from '../../lib/codex-thread-control.mjs';
import {readAccountWindow} from '../../lib/codex-account-window-switch.mjs';
import {researchSave} from '../../lib/research-budget.mjs';
import {CodexAccounts} from '../../lib/codex-accounts.mjs';
import {CodexAccountSwitchAdapter} from '../../lib/codex-account-switch-adapter.mjs';
import {inspectManagedAccountConsumers} from '../../lib/codex-account-consumers.mjs';
import {readAccountSharedSummary} from '../../lib/codex-account-switch-runtime.mjs';

const name=process.argv[2],run=promisify(execFile);
if(!/^window-[a-z0-9-]+$/.test(name||'')||process.argv[3]!=='--approved-two-account-fixture')throw Error('Explicit new disposable window fixture required');
const base=path.join(os.homedir(),'Library/Application Support/ClawDad/Accounts/verification-2026-09-15');
const fixture=path.join(base,'thread-continuity-1'),project=path.join(fixture,'project'),thread='01a0a848-cb86-7033-ae6f-ce006f5b51bb';
const root='/private/tmp/clawdad-terminal-coverage-account-'+name,accountRoot=path.join(root,'Accounts');
const controllerRecovery=process.argv[4]==='--controller-recover';
const continuing=process.argv[4]==='--continue-restore'||controllerRecovery;
const controller=process.argv[4]==='--controller'||controllerRecovery;
const reconcile=process.argv[4]==='--reconcile-existing'||continuing;
const attempt=Number(process.argv[5]||1);if(!Number.isInteger(attempt)||attempt<1||attempt>12)throw Error('Invalid reconciliation attempt');
const prior=reconcile?JSON.parse(await fs.readFile(path.join(root,'evidence.json'),'utf8')):null;
if(reconcile){
  const journal=JSON.parse(await fs.readFile(path.join(accountRoot,'NativeTransport/native-control.json'),'utf8'));
  if(journal.requests.some(r=>!['window.capture',...(continuing?['window.restore','window.verify']:[])].includes(r.action))||!prior.originalTTY||prior.transitions.length>1||prior.transitions.length&&!continuing)throw Error('Only the exact disposable capture/restore may be reconciled');
  await fs.copyFile(path.join(root,'evidence.json'),path.join(root,'prior-evidence-'+Date.now()+'.json'));
  await fs.rm(path.join(root,'stop-worker'),{force:true});await fs.rm(path.join(root,'worker-ready'),{force:true});
}else await fs.mkdir(root,{mode:0o700});
const evidence={name,root,thread,startedAt:new Date().toISOString(),state:'preflight',modelTurnsSent:0,statusCommands:0,signInActions:0,transitions:continuing?prior.transitions:[]};
const write=()=>researchSave(path.join(root,'evidence.json'),evidence);
const q=s=>"'"+s.replaceAll("'","'\\''")+"'",a=s=>JSON.stringify(s),apple=async s=>(await run('/usr/bin/osascript',['-e',s],{timeout:30000})).stdout.trim();
const existing=(await codexProcessOwners()).filter(o=>o.threads.includes(thread));
const resumedState=controllerRecovery?JSON.parse(await fs.readFile(path.join(accountRoot,'switch-state.json'),'utf8')):null;
const resumeOperation=resumedState?.operations[resumedState.activeOperationId];
const resumeRecord=controllerRecovery?await readAccountWindow(accountRoot,resumeOperation.id):null;
const expectedTTY=resumeRecord?.progress?.[resumeRecord.entries[0].id]?.binding?.tty||prior?.originalTTY;
if(existing.length&&(!reconcile||existing.length!==1||'/dev/'+existing[0].tty!==expectedTTY))throw Error('Disposable thread already has another owner; preserve it');
const find=async dir=>{for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){const v=await find(p);if(v)return v;}else if(e.name.endsWith(thread+'.jsonl'))return p;}};
const history=await find(path.join(fixture,'sessions'));if(!history)throw Error('Original synthetic history unavailable');
const historyHash=async()=>{const h=createHash('sha256');for(const line of (await fs.readFile(history,'utf8')).split('\n').filter(Boolean)){
  const v=JSON.parse(line),p=v.payload;if(v.type==='event_msg'&&['task_started','user_message','task_complete','turn_aborted'].includes(p.type)||v.type==='response_item'&&p.role==='user')h.update(line+'\n');}return h.digest('hex');};
const realSnapshot=path.join(os.homedir(),'Library/Application Support/ClawDad/MainTerminalWorkspace/main-workspace.json');
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,ordered(x)])):v;
const rosterHash=async()=>{const state=JSON.parse(await fs.readFile(realSnapshot,'utf8'));return createHash('sha256').update(JSON.stringify(ordered(state.snapshots))).digest('hex');};
evidence.acceptedHistoryBefore=await historyHash();evidence.rosterBefore=await rosterHash();
const accounts={};
for(const [profile,email] of [['cody','codyshanemitchell@gmail.com'],['sun','playinthesunwithme@gmail.com']]){
  const p=new CodexAccountProfileProcess({home:path.join(base,profile),binary:'/opt/homebrew/bin/codex'});
  try{await p.connect();accounts[profile]=await new CodexManagedLogin({rpc:(...args)=>p.request(...args)}).identity(email);}finally{p.close();}
}
evidence.accounts=Object.entries(accounts).map(([profile,v])=>({profile,email:v.subscription.email,accountKey:v.accountKey}));await write();
const runtime=new AssistantRuntime({root:path.join(root,'Assistant'),coordinator:{run(){throw Error('No model work in fixture');},stop(){}}});
await runtime.load();const shared=new CodexSharedClient();runtime.appServer={client:shared,readOwners:codexProcessOwners,close:async()=>shared.close()};
let operation,tty,worker,server;
let adapter={root:accountRoot,windows:{},permit:async({operationId})=>{if(operation?.id!==operationId)throw Error('Only the exact disposable operation is allowed');return operation;}};
runtime.accounts={adapter,admission:async()=>({allowed:true}),deliveryAdmission:async()=>({allowed:true})};
let transport=new CodexAccountNativeTransport({root:path.join(accountRoot,'NativeTransport'),authorize:async r=>
  r.operationId===operation?.id&&(['window.capture','window.restore','window.verify'].includes(r.action)||['observe','stop'].includes(r.action)&&r.args.source?.tty===tty)});
runtime.accountNativeControl=transport;
let driver=new CodexAccountNativeDriver({transport,identities:[],permit:async()=>{},waitMs:300000});
const profileEntries={};let selectedProfile,verifiedAccount=accounts.cody.accountKey;
if(controller){
  runtime.accounts=new CodexAccounts({root:accountRoot,usage:{snapshot:async()=>({accountKey:verifiedAccount}),freshReading:async()=>({accountKey:verifiedAccount})}});
  for(const profile of ['cody','sun']){
    const state=await runtime.accounts.snapshot();
    profileEntries[profile]=state.accounts.find(a=>a.email===accounts[profile].subscription.email)||(await runtime.accounts.add({email:accounts[profile].subscription.email,requestId:'add-'+profile,expectedRevision:state.revision})).account;
  }
  const identity=async profile=>{
    const p=new CodexAccountProfileProcess({home:path.join(base,profile),binary:'/opt/homebrew/bin/codex'});
    try{await p.connect();const v=await new CodexManagedLogin({rpc:(...args)=>p.request(...args)}).identity(accounts[profile].subscription.email);
      if(v.accountKey!==accounts[profile].accountKey)throw Error('Disposable retained account changed');return v;
    }finally{p.close();}
  };
  const target=()=>({authorizationHome:path.join(base,selectedProfile),sqliteHome:path.join(fixture,'index'),accountKey:accounts[selectedProfile].accountKey});
  adapter=new CodexAccountSwitchAdapter({root:accountRoot,accounts:runtime.accounts,runtime,windowRebuild:true,
    inventory:async()=>{
      const v=await inspectManagedAccountConsumers(runtime,{readShared:owner=>readAccountSharedSummary(undefined,owner)});
      // The live shared service is read-only evidence and explicitly outside
      // this disposable window test. Production shared transitions have their
      // separate RPC/process fixtures; never restart Cody's service here.
      return {...v,consumers:v.consumers.filter(c=>c.kind!=='shared_app_server').map(c=>c.tty===tty?{...c,tabId:null,windowId:null}:c)};
    },profiles:{identities:async()=>[],prepare:async({target:account})=>{
      selectedProfile=['cody','sun'].find(p=>profileEntries[p].id===account.id);await identity(selectedProfile);
      return {state:'verified',method:'chatgpt',email:account.email,accountKey:accounts[selectedProfile].accountKey,workspaceVerified:true};
    },target:async()=>target(),verify:async()=>{await identity(selectedProfile);verifiedAccount=accounts[selectedProfile].accountKey;return {...target(),freshUsage:true};}},
    sharedDriver:{},verifyPending:async()=>true});
  adapter.capabilities.selectedRuntimeRouting=false;
  runtime.accounts.adapter=adapter;runtime.accounts.inspectConsumers=args=>adapter.inspect(args);
  transport=adapter.transport;driver=adapter.native;runtime.accountNativeControl=transport;
  evidence.productionController=true;evidence.injectedColdBinding=true;
  if(controllerRecovery){
    const active=(await runtime.accounts.snapshot()).activeOperation;
    selectedProfile=['cody','sun'].find(p=>profileEntries[p].id===active.targetId);
    if(!resumeRecord||resumeRecord.entries.length!==1||resumeRecord.entries[0].sessionId!==thread||resumeRecord.entries[0].directory!==project
      ||active.id!==name+'-'+selectedProfile||active.phase!=='transition')throw Error('Exact disposable controller recovery required');
  }
}
const token=randomUUID();const json=(r,c,v)=>{r.writeHead(c,{'Content-Type':'application/json'});r.end(JSON.stringify(v));};
server=http.createServer(async(req,res)=>{
  void fs.appendFile(path.join(root,'http-stages.jsonl'),JSON.stringify({at:new Date().toISOString(),path:req.url})+'\n',{mode:0o600});
  if(req.headers.authorization!=='Bearer '+token)return json(res,401,{error:'Authentication required'});
  const readBody=async()=>{let body='';for await(const b of req)body+=b;if(Buffer.byteLength(body)>1024*1024)throw Error('Fixture body limit');return body?JSON.parse(body):{};};
  if(!await assistantHttp(req,res,new URL(req.url,'http://127.0.0.1'),runtime,{readBody,json}))json(res,404,{error:'Unknown fixture route'});
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));await researchSave(path.join(root,'connection.json'),{baseURL:'http://127.0.0.1:'+server.address().port});await fs.writeFile(path.join(root,'native-server.token'),token,{mode:0o600});
try{
  const command=`unset HISTFILE; cd -- ${q(project)} && env -u OPENAI_API_KEY -u CODEX_API_KEY -u CODEX_ACCESS_TOKEN -u OPENAI_BASE_URL CODEX_HOME=${q(path.join(base,'cody'))} /opt/homebrew/bin/codex resume ${q(thread)} --cd ${q(project)} --model gpt-6-astra -c 'model_reasoning_effort="low"' -c 'cli_auth_credentials_store="keyring"' --no-alt-screen --sandbox read-only --ask-for-approval never`;
  const created=reconcile?[expectedTTY,prior.originalWindowId]:(await apple(`tell application "Terminal"\nset t to do script ${a(command)}\nset custom title of t to ${a('ClawDad account QA '+name)}\nactivate\nreturn (tty of t) & "|" & (id of front window as text)\nend tell`)).split('|');
  [tty,evidence.originalWindowId]=created;evidence.originalTTY=tty;
  if(!/^\/dev\/ttys\d+$/.test(tty)||!/^\d+$/.test(evidence.originalWindowId))throw Error('Fixture identity unavailable');
  await write();
  if(reconcile&&!continuing)await apple(`tell application "Terminal"\nset w to window id ${evidence.originalWindowId}\nif (count of tabs of w) is not 1 or tty of tab 1 of w is not ${a(tty)} then error "Disposable fixture changed"\nset index of w to 1\nactivate\nend tell`);
  const log=await fs.open(path.join(root,'worker.log'),'w',0o600);
  worker=spawn('/usr/bin/swift',['test','--package-path','native/macos','--filter','MacAssistantTerminalTransportLiveTests/testIsolatedNativeWorker'],{cwd:process.cwd(),env:{...process.env,CLAWDAD_TERMINAL_QA_ROOT:root},stdio:['ignore',log.fd,log.fd]});
  for(let n=0;!await fs.stat(path.join(root,'worker-ready')).then(()=>true,()=>false);n++){
    if(worker.exitCode!==null||n>1800)throw Error('Fixture native worker unavailable');await new Promise(r=>setTimeout(r,100));
  }
  const remaining=['sun','cody'].filter(p=>!evidence.transitions.some(t=>t.profile===p));
  for(const profile of remaining){
    const resume=continuing&&!controller&&profile===remaining[0];
    const resumeId=process.argv[6]||name+'-sun-reconciled-3';
    if(resume&&!resumeId.startsWith(name+'-'+profile+'-reconciled-'))throw Error('Exact disposable checkpoint required');
    const id=resume?resumeId:name+'-'+profile+(reconcile&&!controller?'-reconciled-'+attempt:'');operation={id,strategy:'window-rebuild-v1',phase:'preflight'};
    let capture,controllerCompleted=false;
    if(controller){
      const recovery=controllerRecovery&&profile===remaining[0];
      if(recovery){
        await runtime.accounts.control('accounts.reconcile',{});
      }else{
      const census=await runtime.accountConsumerInventory(),catalog=runtime.observation.catalog;
      const tab=census.consumers.find(t=>t.tty===tty)?.tabId||catalog.tabs.find(t=>t.tty===tty)?.id;
      const selection=census.windows.find(w=>w.tabs.some(t=>t.tabId===tab));
      if(selection?.count!==1)throw Error('Only the verified one-tab disposable window is authorized');
      const state=await runtime.accounts.snapshot();
      const request={action:'accounts.switch',accountId:profileEntries[profile].id,requestId:id,expectedRevision:state.revision,confirmed:true,windowSelection:{id:selection.id,tabId:selection.tabId}};
      const response=await fetch('http://127.0.0.1:'+server.address().port+'/v1/assistant/request',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(request)});
      if(!response.ok)throw Error('Disposable switch request rejected');
      await runtime.accounts.advance();
      // Duplicate HTTP acceptance cannot dispatch another close or launch.
      await fetch('http://127.0.0.1:'+server.address().port+'/v1/assistant/request',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(request)});
      await runtime.accounts.advance();
      }
      const accepted=(await runtime.accounts.snapshot()).activeOperation;
      if(accepted.status!=='completed')throw Error(accepted.reason);
      capture={captureHash:(await readAccountWindow(accountRoot,id)).captureHash};controllerCompleted=true;
    }
    if(controllerCompleted){}else if(resume){
      const record=await readAccountWindow(accountRoot,id);if(!record||!['captured','closing','restoring','verified'].includes(record.stage))throw Error('No disposable restoration to reconcile');
      capture={captureHash:record.captureHash};evidence.restoredAfterWorkerRestart=true;
    }else{
      const census=await runtime.accountConsumerInventory(),catalog=runtime.observation.catalog;
      const tab=(census.consumers||[]).find(t=>t.tty===tty)?.tabId||(catalog?.tabs||[]).find(t=>t.tty===tty)?.id;
      const selection=(census.windows||[]).find(w=>w.tabs.some(t=>t.tabId===tab));
      if(!selection||selection.count!==1)throw Error('Only the exact one-tab disposable window may be recreated');
      evidence.state='capturing-'+profile;await write();
      capture=await driver.call(id,'window.capture',{operationId:id,selection},id+'-capture');
    }
    const saved=await readAccountWindow(accountRoot,id);
    if(saved.entries.length!==1||saved.entries[0].sessionId!==thread||saved.entries[0].directory!==project)throw Error('Capture differs from disposable conversation');
    operation.phase='transition';operation.destinationAccountKey=accounts[profile].accountKey;operation.recovery={entries:[{window:{captureHash:capture.captureHash}}]};
    const target={authorizationHome:path.join(base,profile),sqliteHome:path.join(fixture,'index'),accountKey:accounts[profile].accountKey};
    const delivery=id+'-restore'+(resume?'-recovery-'+attempt:'');
    const restored=controllerCompleted?{stage:'verified',count:1}:await driver.call(id,'window.restore',{operationId:id,target},delivery);
    const repeated=controllerCompleted?restored:await driver.call(id,'window.restore',{operationId:id,target},delivery);
    const verified=controllerCompleted?restored:await driver.call(id,'window.verify',{operationId:id},id+'-verify');
    const record=await readAccountWindow(accountRoot,id),bound=record.progress[record.entries[0].id].binding;
    if(restored.stage!=='verified'||repeated.stage!=='verified'||verified.stage!=='verified'||bound.sessionId!==thread||bound.directory!==project)throw Error('Native restore incomplete');
    tty=bound.tty;
    evidence.transitions.push({profile,operationId:id,tty,sessionId:bound.sessionId,directory:bound.directory,owner:bound.owner,model:bound.model,effort:bound.effort,accountKey:target.accountKey,count:restored.count,stage:verified.stage});await write();
  }
  evidence.acceptedHistoryAfter=await historyHash();evidence.rosterAfter=await rosterHash();
  if(evidence.acceptedHistoryAfter!==evidence.acceptedHistoryBefore||evidence.rosterAfter!==evidence.rosterBefore)throw Error('Task history or manual snapshot changed');
  // Cleanup is separate from the product transition, and needs no /status or
  // composer edits. Only this explicitly disposable, unchanged saved thread
  // may be terminated; its one-tab window must still carry the fixture name.
  const owners=(await codexProcessOwners()).filter(o=>o.threads.includes(thread));
  if(owners.length!==1||'/dev/'+owners[0].tty!==tty||await historyHash()!==evidence.acceptedHistoryBefore)throw Error('Disposable cleanup identity changed');
  const pid=owners[0].pid,foreground=(await run('/bin/ps',['-p',String(pid),'-o','pid=,pgid=,tpgid=,comm='])).stdout.trim().split(/\s+/);
  if(foreground[0]!==String(pid)||foreground[1]!==foreground[2]||path.basename(foreground.slice(3).join(' '))!=='codex')throw Error('Disposable foreground changed');
  process.kill(pid,'SIGTERM');
  for(let n=0;n<100;n++){let alive=true;try{process.kill(pid,0);}catch{alive=false;}if(!alive)break;await new Promise(r=>setTimeout(r,100));}
  evidence.cleanup=await apple(`tell application "Terminal"\nset matches to {}\nset windowIds to id of windows\nrepeat with windowId in windowIds\nif (contents of windowId) is not missing value then\nset w to window id (contents of windowId)\nif (count of tabs of w) is 1 and tty of tab 1 of w is ${a(tty)} then set end of matches to w\nend if\nend repeat\nif (count of matches) is not 1 then return "preserved"\nset w to item 1 of matches\nif busy of tab 1 of w or custom title of tab 1 of w is not ${a('ClawDad account QA '+name)} then return "preserved"\nclose w\nreturn "closed-fixture-only"\nend tell`);
  evidence.state='verified_native_window_round_trip';
}catch(error){evidence.state='needs_attention';evidence.reasonCode=error.code||'fixture_failed';evidence.failure=error.message;process.exitCode=1;await write();}
finally{
  if(worker){await fs.writeFile(path.join(root,'stop-worker'),'stop',{mode:0o600});for(let n=0;n<100&&worker.exitCode===null;n++)await new Promise(r=>setTimeout(r,100));}
  shared.close();await runtime.close();await new Promise(r=>server.close(r));
  evidence.finishedAt=new Date().toISOString();await write();console.log(JSON.stringify(evidence));
}
