// Read-only production Swift census against one already authorized synthetic
// TUI. No account switch, real tab, model request, sign-in or shell mutation.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {CodexAccountShellLaunches} from '../../lib/codex-account-shell-launch.mjs';
import {researchSave} from '../../lib/research-budget.mjs';
const name=process.argv[2];if(!/^tui-status-shell-census-[a-z0-9-]+$/.test(name||''))throw Error('Use a new bounded shell-census fixture name.');
const fixture=path.join(os.homedir(),'Library/Application Support/ClawDad/Accounts/verification-2026-09-15/thread-continuity-1',name);
if(await fs.stat(fixture).catch(()=>null))throw Error('Inspect the existing fixture receipt instead of replaying it.');
const root=await fs.mkdtemp('/private/tmp/clawdad-account-census-');await fs.chmod(root,0o700);
const candidate=path.resolve('native/macos/dist/candidates/codex-account-switch-2026-09-15');
const log=await fs.open(path.join(candidate,name+'-native.log'),'wx',0o600);
const native=spawn('/usr/bin/swift',['test','--package-path','native/macos','--filter','MacCodexAccountCensusFixtureTests/testPrivateReadOnlyCensusBridgeWhenAuthorized'],
  {env:{...process.env,CLAWDAD_ACCOUNT_CENSUS_FIXTURE:root},stdio:['ignore',log.fd,log.fd]});await log.close();
const delay=ms=>new Promise(r=>setTimeout(r,ms));let child,childDone,nativeDone=false;
native.on('exit',()=>{nativeDone=true;});
try{
  const until=Date.now()+90000;while(!await fs.stat(path.join(root,'ready')).catch(()=>null)){if(nativeDone||Date.now()>until)throw Error('Native census did not start');await delay(100);}
  child=spawn(path.join(candidate,'tui-probe-venv/bin/python'),['test/fixtures/codex-account-tui-status.py','cody',name,'--selected-shell-census'],{stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',()=>{});childDone=new Promise(r=>child.on('exit',r));
  let receipt;const ready=Date.now()+40000;
  while(Date.now()<ready){receipt=await fs.readFile(path.join(fixture,'receipt.json'),'utf8').then(JSON.parse).catch(()=>null);if(receipt?.state==='verified_local_status')break;if(receipt?.state==='needs_attention')throw Error('TUI fixture failed');await delay(100);}
  if(receipt?.state!=='verified_local_status')throw Error('The exact TUI was not ready');
  const readNative=async()=>{for(let attempt=0;attempt<3;attempt++){
    const id=randomUUID();await researchSave(path.join(root,'request.json'),{id});
    const until=Date.now()+9000;while(Date.now()<until){const r=await fs.readFile(path.join(root,'reply.json'),'utf8').then(JSON.parse).catch(()=>null);
      if(r?.id===id){if(r.error)break;return {processes:r.inventory.processes,processesComplete:r.inventory.complete,processesObservedAt:r.inventory.observedAt};}await delay(50);}
  }throw Error('Native census remained incomplete');};
  const launches=new CodexAccountShellLaunches({root:path.join(fixture,'launcher-journal/ShellLaunches'),readNative});
  const observed=await launches.snapshot(),job=observed.jobs.find(j=>j.id===name);
  if(!observed.complete||job?.pid!==receipt.pid||job?.reasonCode!=='native_launch_observed')throw Error('Exact production launch reconciliation failed');
  const result={pid:job.pid,state:job.reasonCode,accountId:job.accountId,markerVerified:true,modelPrompts:0,finishedAt:new Date().toISOString()};
  await researchSave(path.join(fixture,'census-verified.json'),result);
  if(await childDone!==0)throw Error('TUI cleanup failed');console.log(output.trim());console.log(JSON.stringify(result));
}finally{
  // The child only owns the synthetic PTY and cleans it on timeout; no real
  // Codex process or window is signalled by this runner.
  if(childDone)await childDone;
  await fs.writeFile(path.join(root,'done'),'done',{mode:0o600});
  for(let n=0;n<200&&!nativeDone;n++)await delay(50);
}
