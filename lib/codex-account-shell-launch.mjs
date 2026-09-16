import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {CodexAccounts,codexAccountsRoot} from './codex-accounts.mjs';
import {CodexAccountAuthorizations} from './codex-account-authorizations.mjs';
import {withCodexAccountLaunch} from './codex-account-launch.mjs';
import {privateAccountDirectory} from './codex-account-profile-process.mjs';
import {researchSave} from './research-budget.mjs';

const run=promisify(execFile);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const idValid=id=>typeof id==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(id);
const commands=new Set(['exec','e','review','login','logout','mcp','mcp-server','app-server','app','completion','sandbox','debug','apply','a','resume','fork','cloud','features','remote']);
const valueFlags=new Set(['-c','--config','-m','--model','-p','--profile','-C','--cd','-i','--image','-s','--sandbox','-a','--ask-for-approval','--enable','--disable','--add-dir','--remote','--remote-auth-token-env','--local-provider']);

// Only interactive Codex sessions inherit the app preference. Maintenance,
// authentication and automation commands retain the original CLI contract.
export function isInteractiveCodexLaunch(args){
  const end=args.indexOf('--');
  if(args.slice(0,end<0?args.length:end).some(a=>['--help','-h','--version','-V'].includes(a)))return false;
  for(let i=0;i<args.length;i++){
    const a=args[i];
    if(a==='--')return true;
    if(['--help','-h','--version','-V'].includes(a))return false;
    if(valueFlags.has(a)){i++;continue;}
    if(a.startsWith('-'))continue;
    return !commands.has(a)||['resume','fork'].includes(a);
  }
  return true;
}

// Codex 0.154.0's resumed TUI does not apply these account settings from the
// root command. Put them in the resume/fork option scope, before positional
// prompts or --, while keeping every original argument in its original order.
export function interactiveCodexAccountArguments(args,launch){
  if(!launch)return [...args];
  for(let i=0;i<args.length;i++){
    const a=args[i];if(a==='--')break;
    if(valueFlags.has(a)){i++;continue;}
    if(a.startsWith('-'))continue;
    if(['resume','fork'].includes(a))return [...args.slice(0,i+1),...withCodexAccountLaunch(args.slice(i+1),launch)];
    break;
  }
  return withCodexAccountLaunch(args,launch);
}

export function validateSelectedShellArguments(args,env){
  for(const name of ['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','OPENAI_BASE_URL','CODEX_HOME','CODEX_SQLITE_HOME','CLAWDAD_CODEX_HOME'])
    if(env[name])throw Error('This shell explicitly configures authentication or history. Use command codex deliberately for that route; ClawDad will not silently replace it.');
  for(let i=0;i<args.length;i++){
    const a=args[i];if(a==='--')break;
    if(['--remote','--remote-auth-token-env','--oss','--local-provider','-p','--profile'].includes(a)
      ||/^--(?:remote|remote-auth-token-env|local-provider|profile)=/.test(a)||/^-p.+/.test(a))
      throw Error('This launch selects a separate runtime or configuration profile. Use command codex for that explicit route.');
    let config;
    if(a==='-c'||a==='--config')config=args[++i];
    else if(a.startsWith('--config='))config=a.slice(9);
    else if(a.startsWith('-c')&&a.length>2)config=a.slice(2);
    if(config!==undefined){
      const key=String(config).split('=',1)[0].trim().replaceAll('"','').replaceAll("'",'');
      if(/^(?:cli_auth_credentials_store|sqlite_home|model_provider|model_providers|openai_base_url|chatgpt_base_url|forced_login_method|forced_chatgpt_workspace_id|profile|profiles)(?:\.|$)/.test(key))
        throw Error('This launch overrides account routing. Use command codex for the explicit override, or remove it to follow ClawDad.');
    }
  }
}

export async function readShellLaunchProcesses({execute=run}={}){
  const {stdout}=await execute('/bin/ps',['-axo','pid=,uid=,lstart=,comm='],{timeout:4000,maxBuffer:8*1024*1024,env:{...process.env,LC_ALL:'C',TZ:'UTC'}});
  const rows=new Map();
  for(const line of stdout.split('\n').filter(v=>v.trim())){
    const m=line.trim().match(/^(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/);
    if(!m)throw Error('The launcher process census is incomplete.');
    const [,pid,uid,start,executable]=m;rows.set(Number(pid),{pid:Number(pid),uid:Number(uid),start,executable});
  }
  return rows;
}

// A launch is admitted before execve, then reconciled from the exact process
// lifetime and native random marker. No prompt text, image path or credential
// is retained. A launch receipt never means its eventual task has completed.
export class CodexAccountShellLaunches {
  constructor({root,accounts,readProcesses=readShellLaunchProcesses,readNative,clock=Date.now}={}){Object.assign(this,{root,accounts,readProcesses,readNative,clock});}
  file(id){if(!idValid(id))throw Error('Invalid shell launch request.');return path.join(this.root,id+'.json');}
  async load(id){
    try{const file=this.file(id),s=await fs.lstat(file);
      if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||s.mode&0o077||s.size>16384)throw Error();
      const value=JSON.parse(await fs.readFile(file,'utf8'));
      if(value.version!==1||value.id!==id||value.action!=='terminal.launch'||!['queued','completed','cancelled'].includes(value.status)
        ||!Number.isSafeInteger(value.pid)||value.pid<=0||typeof value.start!=='string'||!path.isAbsolute(value.executable||'')
        ||!path.isAbsolute(value.launcherExecutable||'')||!/^[a-f0-9]{64}$/.test(value.fingerprint||'')||!/^[a-f0-9]{64}$/.test(value.marker||''))throw Error();
      return value;
    }catch(e){if(e.code==='ENOENT')return null;throw Error('A Terminal launch receipt needs reconciliation; it will not be replayed.');}
  }
  async reserve({id,owner,executable,args,gate,launch}){
    await privateAccountDirectory(this.root);
    if(await this.load(id))throw Error('This Terminal launch already has a receipt. Inspect it instead of launching again.');
    const fingerprint=hash({id,owner,executable,args,epoch:gate.epoch,account:launch?.account||null});
    return this.accounts.withWorkAdmission({id,action:'terminal.launch',fingerprint,expectedEpoch:gate.epoch},async stamp=>{
      const job={version:1,id,action:'terminal.launch',fingerprint,status:'queued',pid:owner.pid,start:owner.start,
        launcherExecutable:owner.executable,executable,marker:hash({id,nonce:randomUUID()}),
        createdAt:new Date(this.clock()).toISOString(),accountId:launch?.account?.id||null,...stamp};
      await researchSave(this.file(id),job);return job;
    });
  }
  async failed(job){await researchSave(this.file(job.id),{...job,status:'cancelled',reasonCode:'exec_not_dispatched'});}
  async snapshot(){
    const names=(await fs.readdir(this.root).catch(e=>{if(e.code==='ENOENT')return [];throw e;})).filter(n=>n.endsWith('.json'));
    if(names.length>10000)return {complete:false,jobs:[]};
    const jobs=[];let complete=true,processes,native;
    for(const name of names){
      try{
        const job=await this.load(name.slice(0,-5));if(!job)continue;
        if(job.status==='queued'){
          processes ||= await this.readProcesses();const owner=processes.get(job.pid);
          if(!owner||owner.start!==job.start||owner.uid!==process.getuid()){
            // execve keeps the PID and birth time. Its disappearance settles
            // only launch bookkeeping; task receipts/history stay independent.
            job.status='completed';job.reasonCode='launcher_lifetime_ended';
          }else if(owner.executable===job.executable){
            native ||= await this.readNative();
            if(native?.processesComplete!==true||!Number.isFinite(native.processesObservedAt)||Math.abs(this.clock()-native.processesObservedAt)>5000)throw Error();
            const matches=native.processes.filter(p=>Number(p.pid)===job.pid&&p.executable===job.executable&&p.accountLaunchRequestId===job.marker);
            if(matches.length!==1)throw Error();
            job.status='completed';job.reasonCode='native_launch_observed';
          }else if(owner.executable!==job.launcherExecutable)throw Error();
        }
        jobs.push(job);
      }catch{complete=false;}
    }
    return {complete,jobs};
  }
}

export async function launchSelectedCodex({binary,args,env=process.env,pid=process.pid,root=codexAccountsRoot(),
  accounts,launches,execute=process.execve,readProcesses=readShellLaunchProcesses,id=randomUUID()}={}){
  if(typeof execute!=='function')throw Error('Update ClawDad: its bundled Node runtime must support execve.');
  if(!path.isAbsolute(binary||'')||!Array.isArray(args)||args.some(a=>typeof a!=='string'||a.includes('\0')))throw Error('Use an exact installed Codex executable and argument list.');
  const executable=await fs.realpath(binary),stat=await fs.stat(executable);
  if(!stat.isFile()||stat.mode&0o022||!['codex','codex.exe'].includes(path.basename(executable)))throw Error('The installed Codex executable needs verification.');
  if(!isInteractiveCodexLaunch(args))return execute(executable,[executable,...args],env);
  accounts ||= new CodexAccounts({root,authorizations:new CodexAccountAuthorizations({root,binary})});
  const gate=await accounts.assertAdmission(),launch=await accounts.selectedLaunch();
  if(launch)validateSelectedShellArguments(args,env);
  const owner=(await readProcesses()).get(pid);
  if(!owner||owner.uid!==process.getuid())throw Error('The exact launcher process could not be verified.');
  launches ||= new CodexAccountShellLaunches({root:path.join(root,'ShellLaunches'),accounts,readProcesses});
  const job=await launches.reserve({id,owner,executable,args,gate,launch});
  try{
    await accounts.assertDelivery(job);
    const routedEnv={...(launch?.env||env),CLAWDAD_ACCOUNT_LAUNCH_REQUEST_ID:job.marker};
    return execute(executable,[executable,...interactiveCodexAccountArguments(args,launch)],routedEnv);
  }catch(error){await launches.failed(job);throw error;}
}
