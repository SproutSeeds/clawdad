import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {spawn,execFileSync} from 'node:child_process';import {once} from 'node:events';
import {CodexAccounts} from '../lib/codex-accounts.mjs';
import {selectedCodexLaunch} from '../lib/codex-account-launch.mjs';
import {researchSave} from '../lib/research-budget.mjs';
import {isInteractiveCodexLaunch,interactiveCodexAccountArguments,validateSelectedShellArguments,readShellLaunchProcesses,CodexAccountShellLaunches,launchSelectedCodex} from '../lib/codex-account-shell-launch.mjs';

async function setup(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-shell-launch-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const binary=path.join(root,'codex');await fs.writeFile(binary,'#!/bin/sh\nexit 0\n',{mode:0o700});
  const accounts=new CodexAccounts({root}),pid=99123,owner={pid,uid:process.getuid(),start:'Wed Sep 16 10:00:00 2026',executable:process.execPath};
  const processes=new Map([[pid,owner]]);let native={processesComplete:true,processesObservedAt:Date.now(),processes:[]};
  const readProcesses=async()=>processes;
  const launches=new CodexAccountShellLaunches({root:path.join(root,'ShellLaunches'),accounts,readProcesses,readNative:async()=>native});
  const state={version:1,revision:0,epoch:0,accounts:[],operations:{},requests:{},activeOperationId:null};await researchSave(accounts.file,state);
  const original={...process.env};delete original.CODEX_HOME;delete original.OPENAI_API_KEY;
  const route=name=>selectedCodexLaunch({verified:true,operationId:'switch-'+name,accountId:name,accountKey:(name==='dough'?'a':'b').repeat(64),
    authorizationHome:path.join(root,name),sqliteHome:path.join(root,'history'),layoutVerified:true,method:'chatgpt'},{env:original});
  return {root,binary,accounts,pid,owner,processes,readProcesses,launches,state,route,native,env:original};
}
test('only new interactive, resume and fork sessions follow the selected account',()=>{
  for(const a of [[],['-c','features.code_mode_host=true'],['resume','exact-id'],['-C','/directory with spaces','fork','exact-id'],['a prompt'],['--','--help']])assert.equal(isInteractiveCodexLaunch(a),true,JSON.stringify(a));
  for(const a of [['--version'],['resume','--help'],['login'],['logout'],['exec','prompt'],['-c','features.code_mode_host=true','app-server'],['completion','zsh']])assert.equal(isInteractiveCodexLaunch(a),false,JSON.stringify(a));
});
test('explicit authentication, provider, remote and named-profile overrides need deliberate original CLI use',()=>{
  for(const args of [['-c','sqlite_home="/other"'],['--config=cli_auth_credentials_store="file"'],['-cmodel_provider="other"'],['--profile','custom'],['-pcustom'],['--remote','host'],['--oss']])assert.throws(()=>validateSelectedShellArguments(args,{}),/route|routing|runtime/);
  for(const name of ['CODEX_HOME','OPENAI_API_KEY','CODEX_ACCESS_TOKEN','CODEX_SQLITE_HOME'])assert.throws(()=>validateSelectedShellArguments([],{[name]:'fixture'}),/explicitly/);
  assert.doesNotThrow(()=>validateSelectedShellArguments(['-c','features.code_mode_host=true','-m','gpt-6-astra','-c','model_reasoning_effort="max"','resume','exact-id'],{}));
});
test('interactive resume and fork account options use their own CLI scope and preserve positional text',()=>{
  const route={configArgs:['-c','cli_auth_credentials_store="keyring"','-c','sqlite_home="/fixture history"'],env:{},account:{}};
  for(const command of ['resume','fork']){
    const prefix=['-c','features.code_mode_host=true','--cd','/fixture project',command],tail=['exact-id','--','🌿 multiline\n--help'];
    assert.deepEqual(interactiveCodexAccountArguments([...prefix,...tail],route),[...prefix,...route.configArgs,...tail]);
  }
  assert.deepEqual(interactiveCodexAccountArguments(['--','resume'],route),[...route.configArgs,'--','resume']);
  assert.deepEqual(interactiveCodexAccountArguments(['literal message'],route),[...route.configArgs,'literal message']);
  assert.deepEqual(interactiveCodexAccountArguments(['resume','id'],null),['resume','id']);
});
test('fresh manual launches pin each selected account and preserve exact arguments, Unicode, cwd and permissions',async t=>{
  const s=await setup(t),calls=[];let selected='dough';s.accounts.selectedLaunch=async()=>s.route(selected);
  const args=['-c','features.code_mode_host=true','-C','/project with spaces','-s','read-only','-a','never','resume','exact-id','Line one\n🌿 é "quotes"'];
  const launch=id=>launchSelectedCodex({...s,args,id,execute:(...values)=>calls.push(values)});
  await launch('first');selected='sun';await launch('second');
  assert.equal(calls[0][2].CODEX_HOME,path.join(s.root,'dough'));assert.equal(calls[1][2].CODEX_HOME,path.join(s.root,'sun'));
  for(const [,argv,env] of calls){const split=argv.indexOf('resume')+1;assert.deepEqual([...argv.slice(1,split),...argv.slice(split+4)],args);assert.equal(env.HOME,s.env.HOME);assert.match(env.CLAWDAD_ACCOUNT_LAUNCH_REQUEST_ID,/^[a-f0-9]{64}$/);}
  assert.notEqual(calls[0][2].CLAWDAD_ACCOUNT_LAUNCH_REQUEST_ID,calls[1][2].CLAWDAD_ACCOUNT_LAUNCH_REQUEST_ID);
  assert.ok(!(await fs.readFile(s.launches.file('first'),'utf8')).includes('Line one'));assert.ok(!(await fs.readFile(s.launches.file('first'),'utf8')).includes('/project with spaces'));
  await assert.rejects(launch('first'),/already has a receipt/);assert.equal(calls.length,2);
});
test('no selected app account preserves the current CLI login; maintenance creates no launch receipt',async t=>{
  const s=await setup(t),calls=[];
  await launchSelectedCodex({...s,args:[],id:'ordinary',env:{HOME:'/existing'},execute:(...x)=>calls.push(x)});
  assert.equal(calls[0][2].HOME,'/existing');assert.equal(calls[0][2].CODEX_HOME,undefined);assert.equal(calls[0][1].length,1);
  await launchSelectedCodex({...s,args:['login','status'],id:'status',execute:(...x)=>calls.push(x)});
  assert.equal(await s.launches.load('status'),null);assert.deepEqual(calls[1][1],[s.binary,'login','status']);
});
test('switch hold and epoch changes prevent execution without leaving accepting orphan receipts',async t=>{
  const s=await setup(t);let executions=0;
  await researchSave(s.accounts.file,{...s.state,activeOperationId:'switch',operations:{switch:{id:'switch',fenced:true,phase:'preflight'}}});
  await assert.rejects(launchSelectedCodex({...s,args:[],id:'held',execute:()=>executions++}),/holding/);
  await researchSave(s.accounts.file,s.state);
  s.accounts.selectedLaunch=async()=>{await researchSave(s.accounts.file,{...s.state,epoch:1});return null;};
  await assert.rejects(launchSelectedCodex({...s,args:[],id:'stale',execute:()=>executions++}),/account changed/);
  assert.equal(executions,0);const state=JSON.parse(await fs.readFile(s.accounts.file,'utf8'));assert.equal(state.work?.stale,undefined);
});
test('exec failure is proven non-dispatch and never automatically retried',async t=>{
  const s=await setup(t);let calls=0;
  await assert.rejects(launchSelectedCodex({...s,args:[],id:'failure',execute:()=>{calls++;throw Error('synthetic exec failure');}}),/synthetic/);
  const job=await s.launches.load('failure');assert.equal(job.status,'cancelled');assert.equal(job.reasonCode,'exec_not_dispatched');
  await assert.rejects(launchSelectedCodex({...s,args:[],id:'failure',execute:()=>calls++}),/already has/);assert.equal(calls,1);
});
test('pending exec survives controller restart and blocks transition until the exact native marker is observed',async t=>{
  const s=await setup(t);await launchSelectedCodex({...s,args:[],id:'pending',execute:()=>{}});
  const fresh=new CodexAccountShellLaunches({root:s.launches.root,accounts:s.accounts,readProcesses:s.readProcesses,readNative:async()=>s.native});
  s.accounts.readWork=()=>fresh.snapshot();assert.equal((await s.accounts.workDrain()).ready,false);
  const job=await fresh.load('pending');s.processes.set(s.pid,{...s.owner,executable:s.binary});
  s.native.processes=[{pid:String(s.pid),executable:s.binary,accountLaunchRequestId:'wrong'}];assert.equal((await s.accounts.workDrain()).complete,false);
  s.native.processes[0].accountLaunchRequestId=job.marker;
  assert.equal((await fresh.snapshot()).jobs[0].reasonCode,'native_launch_observed');assert.equal((await s.accounts.workDrain()).ready,true);
});
test('dead launchers, PID reuse, missing native evidence and tampered receipts reconcile conservatively',async t=>{
  const s=await setup(t);await launchSelectedCodex({...s,args:[],id:'dead',execute:()=>{}});
  s.processes.delete(s.pid);assert.equal((await s.launches.snapshot()).jobs[0].reasonCode,'launcher_lifetime_ended');
  s.processes.set(s.pid,{...s.owner,start:'new lifetime'});assert.equal((await s.launches.snapshot()).jobs[0].reasonCode,'launcher_lifetime_ended');
  s.processes.set(s.pid,{...s.owner,executable:'/unexpected'});assert.equal((await s.launches.snapshot()).complete,false);
  await fs.writeFile(s.launches.file('dead'),'{}');assert.equal((await s.launches.snapshot()).complete,false);
});
test('real execve replaces the launcher PID and preserves standard input, output, arguments and exit code', {skip:process.platform!=='darwin'||typeof process.execve!=='function'},async t=>{
  const s=await setup(t),c=path.join(s.root,'fixture.c');
  await fs.writeFile(c,'#include <stdio.h>\n#include <unistd.h>\n#include <stdlib.h>\nint main(int n,char **v){printf("PID=%d%c",getpid(),0);for(int i=0;i<n;i++)printf("%s%c",v[i],0);printf("MARKER=%s%c",getenv("CLAWDAD_ACCOUNT_LAUNCH_REQUEST_ID"),0);fflush(stdout);char b[128];int r;while((r=read(0,b,128))>0)write(1,b,r);return 7;}\n');
  execFileSync('/usr/bin/clang',[c,'-o',s.binary]);
  const module=new URL('../lib/codex-account-shell-launch.mjs',import.meta.url).href;
  const script=path.join(s.root,'run.mjs');await fs.writeFile(script,`import {launchSelectedCodex} from ${JSON.stringify(module)};await launchSelectedCodex({binary:${JSON.stringify(s.binary)},root:${JSON.stringify(s.root)},args:['resume','synthetic-id','🌿 line one\\nline two']});`);
  const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',script],{stdio:['pipe','pipe','pipe']});t.after(()=>{if(child.exitCode===null)child.kill();});
  let out=Buffer.alloc(0),err='';child.stdout.on('data',b=>{out=Buffer.concat([out,b]);});child.stderr.on('data',b=>{err+=b;});
  const exit=once(child,'exit');const until=Date.now()+10000;while(!out.includes(Buffer.from('MARKER='))&&Date.now()<until)await new Promise(r=>setTimeout(r,10));
  assert.ok(out.includes(Buffer.from('MARKER=')),err);assert.equal((await readShellLaunchProcesses()).get(child.pid).executable,s.binary);
  const fields=out.toString('utf8').split('\0');assert.equal(fields[0],'PID='+child.pid);assert.deepEqual(fields.slice(1,5),[s.binary,'resume','synthetic-id','🌿 line one\nline two']);
  child.stdin.end('UTF-8 input 🌿\n');assert.deepEqual(await exit,[7,null]);assert.ok(out.toString('utf8').endsWith('UTF-8 input 🌿\n'));assert.equal(err,'');
});
