// Explicit disposable app-server ownership experiment. Retained authorizations
// are read through Codex; there are no login calls, model turns or live threads.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {CodexSharedClient,rpcPages,codexProcessOwners} from '../../lib/codex-thread-control.mjs';
import {CodexManagedLogin} from '../../lib/codex-managed-login.mjs';
import {selectedCodexLaunch,withCodexAccountLaunch} from '../../lib/codex-account-launch.mjs';
import {researchSave} from '../../lib/research-budget.mjs';

const name=process.argv[2];
if(process.argv[3]!=='--approved-two-account-fixture'||!/^shared-handoff-[a-z0-9-]+$/.test(name||''))throw Error('Use an approved new shared-handoff-* fixture.');
const base=path.join(os.homedir(),'Library/Application Support/ClawDad/Accounts/verification-2026-09-15');
const fixture=path.join(base,'thread-continuity-1'),root=path.join(fixture,name),thread='01a0a848-de93-75e3-b69d-8158ebb54973';
await fs.mkdir(root,{mode:0o700});
const evidence={version:1,state:'checking',startedAt:new Date().toISOString(),thread,modelTurnsSent:0,loginActions:0,observations:[]};
const save=()=>researchSave(path.join(root,'evidence.json'),evidence);
const owners=await codexProcessOwners();if(owners.some(o=>o.threads.includes(thread)))throw Error('The synthetic fork already has a live owner. Preserve it.');
const find=async dir=>{for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()){const found=await find(file);if(found)return found;}else if(entry.name.endsWith(thread+'.jsonl'))return file;}};
const history=await find(path.join(fixture,'sessions'));if(!history)throw Error('Exact synthetic fork history is missing.');
const acceptedHash=async()=>{
  const hash=createHash('sha256');for(const line of (await fs.readFile(history,'utf8')).split('\n').filter(Boolean)){
    const r=JSON.parse(line),p=r.payload;
    if(r.type==='event_msg'&&['task_started','user_message','task_complete','turn_aborted'].includes(p.type)||r.type==='response_item'&&p.role==='user')hash.update(line+'\n');
  }return hash.digest('hex');
};
evidence.acceptedHistoryBefore=await acceptedHash();await save();
const accounts={cody:{email:'codyshanemitchell@gmail.com',key:'ca4dbdde17bd744517c78efde1c44fa6ce8313c3373fccba58f74808ece027fd'},
  sun:{email:'playinthesunwithme@gmail.com',key:'29d43ccf151241b704a8562d2738e16e40061369cb78490a4b177272da9acd17'}};
let settings,historyFingerprint;
try{
  for(const profile of ['cody','sun','cody']){
    const socketRoot=await fs.mkdtemp('/private/tmp/cdad-account-server-'),socket=path.join(socketRoot,'s');
    await fs.chmod(socketRoot,0o700);
    const route=selectedCodexLaunch({verified:true,layoutVerified:true,method:'chatgpt',accountId:profile,operationId:name,
      accountKey:accounts[profile].key,authorizationHome:path.join(base,profile),sqliteHome:path.join(fixture,'index')});
    const log=await fs.open(path.join(root,profile+'-'+evidence.observations.length+'.stderr.log'),'wx',0o600);
    const child=spawn('/opt/homebrew/bin/codex',withCodexAccountLaunch(['app-server','--listen','unix://'+socket],route),
      {cwd:path.join(fixture,'project'),env:route.env,stdio:['ignore','ignore',log.fd]});
    await log.close();let exited=false;const exit=new Promise(resolve=>child.once('exit',()=>{exited=true;resolve();}));
    child.on('error',()=>{});
    let client=new CodexSharedClient({socketPath:socket});let idleProven=false;
    evidence.activeConsumer={profile,pid:child.pid,socket,startedAt:new Date().toISOString()};await save();
    try{
      for(let n=0;n<100;n++){if(await fs.stat(socket).then(s=>s.isSocket(),()=>false))break;if(exited)throw Error('Fixture app server exited during startup');await new Promise(r=>setTimeout(r,50));}
      const pid=(await client.request('server/diagnostics',{})).process?.id;
      if(pid!==child.pid)throw Error('The fixture socket belongs to another process');
      if((await rpcPages(client,'thread/loaded/list',{limit:100})).length)throw Error('A new fixture server unexpectedly owns a thread');
      idleProven=true;
      const account=await new CodexManagedLogin({rpc:(...args)=>client.request(...args)}).identity(accounts[profile].email);
      if(account.accountKey!==accounts[profile].key)throw Error('Unexpected fixture account identity');
      // Exact UUID only. No path/history override can silently fork the input.
      idleProven=false;
      const resumed=await client.request('thread/resume',{threadId:thread,excludeTurns:true,
        ...(settings?{model:settings.model,cwd:settings.cwd,approvalPolicy:settings.approvalPolicy,sandbox:'read-only',
          config:{model_reasoning_effort:settings.reasoningEffort}}:{model:'gpt-6-astra',approvalPolicy:'never',sandbox:'read-only',config:{model_reasoning_effort:'low'}})});
      const selected={model:resumed.model,cwd:resumed.cwd,approvalPolicy:resumed.approvalPolicy,sandbox:resumed.sandbox,
        reasoningEffort:resumed.reasoningEffort,approvalsReviewer:resumed.approvalsReviewer,runtimeWorkspaceRoots:resumed.runtimeWorkspaceRoots};
      if(resumed.thread.id!==thread||resumed.thread.status.type!=='idle'||resumed.cwd!==path.join(fixture,'project'))throw Error('Exact idle synthetic thread was not resumed');
      if(settings&&JSON.stringify(selected)!==JSON.stringify(settings))throw Error('Synthetic thread runtime settings changed');
      settings=selected;
      const turns=await rpcPages(client,'thread/turns/list',{threadId:thread,limit:100,itemsView:'full'});
      const messages=turns.flatMap(t=>(t.items||[]).filter(i=>['userMessage','agentMessage'].includes(i.type)).map(i=>({type:i.type,text:i.text??i.content?.filter(c=>c.type==='text').map(c=>c.text).join('')??''})));
      if(!messages.some(m=>m.type==='agentMessage'&&m.text.trim()==='CLAWDAD_CONTINUITY_9F3A 🌿')||!messages.some(m=>m.type==='userMessage'))throw Error('Inherited synthetic messages were not returned');
      const messageHash=createHash('sha256').update(JSON.stringify(messages)).digest('hex');
      if(historyFingerprint&&messageHash!==historyFingerprint)throw Error('Inherited synthetic history changed');
      historyFingerprint=messageHash;
      if((await rpcPages(client,'thread/queue/list',{threadId:thread,limit:100})).length)throw Error('Unexpected synthetic queue');
      if(await acceptedHash()!==evidence.acceptedHistoryBefore)throw Error('Accepted synthetic history changed');
      const read=(await client.request('thread/read',{threadId:thread,includeTurns:false})).thread;
      if(read.id!==thread||read.status.type!=='idle')throw Error('Synthetic thread became active');
      const unsubscribe=await client.request('thread/unsubscribe',{threadId:thread});
      const releasedAt=Date.now();
      const loadedImmediately=await rpcPages(client,'thread/loaded/list',{limit:100});
      evidence.releasePending={pid,thread,unsubscribe:unsubscribe.status,at:new Date(releasedAt).toISOString(),loadedImmediately};await save();
      // Observe with a new read-only connection after releasing the fixture's
      // subscription connection. This must not rejoin or resume the thread.
      client.close();client=new CodexSharedClient({socketPath:socket});
      let loaded;
      for(let n=0;n<90;n++){loaded=await rpcPages(client,'thread/loaded/list',{limit:100});if(!loaded.length)break;await new Promise(r=>setTimeout(r,1000));}
      if(loaded.length)throw Error('Unsubscribing did not release the fixture thread; preserve its owner');
      idleProven=true;
      evidence.observations.push({profile,pid,accountKey:account.accountKey,email:account.subscription.email,remainingPercent:account.remainingPercent,
        thread,settings:selected,unsubscribe:unsubscribe.status,loadedImmediately,releaseMs:Date.now()-releasedAt,
        loadedAfterUnsubscribe:loaded,acceptedHistory:await acceptedHash(),messageHash,turnIds:turns.map(t=>t.id)});
      evidence.releasePending=null;await save();
    }finally{
      // Only the PID this fixture spawned is eligible for shutdown. A failure
      // with an unreconciled loaded thread leaves it alive for inspection.
      if(idleProven&&!exited){
        const pid=(await client.request('server/diagnostics',{})).process?.id;
        const loaded=await rpcPages(client,'thread/loaded/list',{limit:100});
        if(pid!==child.pid||loaded.length)throw Error('Fixture shutdown guard changed; owner preserved');
        // The installed Unix app server reliably handles its normal interrupt
        // shutdown. SIGTERM on the third observed fixture left an unloaded
        // process alive; preserve that evidence instead of equating dispatch
        // with exit. This only targets this fixture's verified empty owner.
        client.close();child.kill('SIGINT');
        await Promise.race([exit,new Promise((_,reject)=>setTimeout(()=>reject(Error('Fixture exit unconfirmed')),5000))]);
        await fs.rm(socketRoot,{recursive:true,force:true});
        evidence.activeConsumer=null;await save();
      }else client.close();
    }
  }
  evidence.acceptedHistoryAfter=await acceptedHash();
  if(evidence.acceptedHistoryAfter!==evidence.acceptedHistoryBefore)throw Error('Accepted history mismatch');
  evidence.state='verified_shared_round_trip';
}catch(error){evidence.state='needs_attention';evidence.reason=error.message;process.exitCode=1;}
evidence.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify(evidence));
