import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {CodexSharedClient,rpcPages} from './codex-thread-control.mjs';
import {readAccountOwners} from './codex-account-owner-scope.mjs';
import {selectedCodexLaunch,withCodexAccountLaunch} from './codex-account-launch.mjs';
import {claimAccountProfile} from './codex-account-profile-guard.mjs';
import {privateAccountDirectory} from './codex-account-profile-process.mjs';
import {researchSave} from './research-budget.mjs';

const failure=(code,message)=>Object.assign(Error(message),{code});
const valid=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const run=promisify(execFile);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// OS effects are deliberately separate from the protocol. All calls require
// the durable switch permit and the same exclusive gate as normal shared
// runtime startup. No PID, socket pathname or directory alone authorizes stop.
export class CodexAccountSharedProcess {
  constructor({root,socketPath,readNative,permit,exclusive,readOwners=readAccountOwners,
    createClient=options=>new CodexSharedClient(options),spawnProcess=spawn,execute=run,
    signal=(pid,name)=>process.kill(pid,name),profileGate=claimAccountProfile,clock=Date.now}={}){
    Object.assign(this,{root,socketPath,readNative,permit,exclusive,readOwners,createClient,spawnProcess,execute,signal,profileGate,clock});
  }
  async dispatchHeld(operationId){try{await this.permit({operationId});return true;}catch{return false;}}
  async census(){
    const native=await this.readNative();
    if(native?.processesComplete!==true||!Array.isArray(native.processes)||!Number.isFinite(native.processesObservedAt)
      ||Math.abs(this.clock()-native.processesObservedAt)>5000)
      throw failure('shared_native_census_unavailable','Refresh the complete native process inventory before switching the server.');
    return native.processes;
  }
  async observe(){
    const [processes,owners]=await Promise.all([this.census(),this.readOwners({socketPath:this.socketPath})]);
    const candidates=owners.filter(p=>p.socket);
    if(candidates.length>1)throw failure('shared_socket_ambiguous','More than one Codex process holds the shared socket. Preserve them for review.');
    if(!candidates.length){
      if((await this.socketPIDs()).length)throw failure('shared_socket_foreign_owner','Another process owns the shared socket. Preserve it for review.');
      return {kind:'absent'};
    }
    const matches=processes.filter(p=>Number(p.pid)===candidates[0].pid),row=matches[0];
    if(matches.length!==1||row.kind!=='app_server'||row.alternateAuthentication!==false||row.reasonCode
      ||!path.isAbsolute(row.authorizationHome||'')||!path.isAbsolute(row.executable||'')||!valid(row.processLifetime)||!Array.isArray(row.serverOptions))
      throw failure('shared_launch_unverified','The shared process launch or authentication route needs a supported native adapter.');
    const client=this.createClient({socketPath:this.socketPath});
    try{if((await client.request('server/diagnostics',{})).process?.id!==Number(row.pid))
      throw failure('shared_socket_owner_changed','The socket no longer matches its native process owner.');}finally{client.close();}
    return {kind:'server',pid:Number(row.pid),processIdentity:row.processLifetime,authorizationHome:row.authorizationHome,
      executable:row.executable,serverOptions:row.serverOptions,accountTransitionId:row.accountTransitionId||null,
      accountLaunchRequestId:row.accountLaunchRequestId||null};
  }
  async socketPIDs(){
    try{const value=(await this.execute('/usr/sbin/lsof',['-nP','-Fp','--',this.socketPath],{timeout:4000,maxBuffer:8192})).stdout;
      return [...new Set(value.split('\n').filter(line=>/^p\d+$/.test(line)).map(line=>Number(line.slice(1))))];
    }catch(error){if(error.code===1&&!error.stdout?.trim())return [];throw error;}
  }
  async exactDigest(pid){
    try{const value=(await this.execute('/bin/ps',['-p',String(pid),'-o','pid=,uid=,lstart=,comm='],{timeout:4000,maxBuffer:8192})).stdout;
      const match=value.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d{2}:\d{2}:\d{2})\s+(\d{4})\s+(.+)$/);
      if(!match||Number(match[1])!==pid||Number(match[2])!==process.getuid())return null;
      return createHash('sha256').update(match.slice(1).join('\0')).digest('hex');
    }catch(error){if(error.code===1)return null;throw error;}
  }
  async stopIdle(args){
    return this.exclusive(async()=>{
      await this.permit(args);const owner=await this.observe();
      if(owner.processIdentity!==args.source.processIdentity||owner.pid!==args.source.pid)
        throw failure('shared_owner_changed','The original server lifetime changed before stopping.');
      const client=this.createClient({socketPath:this.socketPath});
      try{if((await client.request('server/diagnostics',{})).process?.id!==owner.pid||(await rpcPages(client,'thread/loaded/list',{limit:100})).length)
        throw failure('shared_owner_not_empty','The original server still owns a conversation. Let it release before switching.');}finally{client.close();}
      if(await this.exactDigest(owner.pid)!==owner.processIdentity)throw failure('shared_owner_changed','The server lifetime changed at dispatch.');
      await this.permit(args);this.signal(owner.pid,'SIGINT');
      for(let i=0;i<100;i++){
        const current=await this.exactDigest(owner.pid);if(current!==owner.processIdentity)return {state:'exited'};
        await wait(50);
      }
      // Never escalate to kill. The durable stop receipt is reconciled against
      // its exact lifetime; a slow/failed shutdown preserves the recovery hold.
      throw failure('shared_exit_unconfirmed','The original server has not confirmed exit. Reconcile its saved stop receipt.');
    });
  }
  file(requestId){if(!/^[a-f0-9]{64}$/.test(requestId||''))throw Error('Invalid shared launch receipt');return path.join(this.root,'process-'+requestId+'.json');}
  async receipt(requestId){
    try{const file=this.file(requestId),s=await fs.lstat(file);
      if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||s.mode&0o077||s.size>16384)throw Error();
      const value=JSON.parse(await fs.readFile(file,'utf8'));if(value.version!==1||value.requestId!==requestId)throw Error();return value;
    }catch(error){if(error.code==='ENOENT')return null;throw failure('shared_launch_receipt_invalid','The original server launch receipt needs recovery.');}
  }
  async launch(args){
    return this.exclusive(async()=>{
      await this.permit(args);await privateAccountDirectory(this.root);
      const {operationId,requestId,source,target}=args,previous=await this.receipt(requestId);
      if(previous)throw failure('shared_launch_uncertain','The original server launch may have occurred. Reconcile it before another launch.');
      if((await this.observe()).kind!=='absent'||await this.exactDigest(source.pid)===source.processIdentity)
        throw failure('shared_previous_owner_present','The original server has not exited, or another socket owner exists.');
      if(!path.isAbsolute(source.executable||'')||!Array.isArray(source.serverOptions))throw failure('shared_launch_options_missing','The original executable and launch options were not captured.');
      const options=source.serverOptions;
      for(let i=0;i<options.length;i+=2)if(options[i]!=='-c'||typeof options[i+1]!=='string'||!/^features\.[A-Za-z0-9_]+=(true|false)$/.test(options[i+1]))
        throw failure('shared_launch_options_unsupported','Preserve the original server launch until its options have a supported adapter.');
      const gate=await this.profileGate(target.authorizationHome);
      try{
        const stat=await fs.lstat(this.socketPath).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
        if(stat){
          if(!stat.isSocket()||stat.uid!==process.getuid())throw failure('shared_socket_unsafe','The shared socket path contains an unrelated object.');
          if((await this.socketPIDs()).length)throw failure('shared_socket_occupied','Another process acquired the shared socket.');
          const again=await fs.lstat(this.socketPath);if(again.dev!==stat.dev||again.ino!==stat.ino)throw failure('shared_socket_changed','The shared socket changed before cleanup.');
          await fs.unlink(this.socketPath);
        }
        const record={version:1,operationId,requestId,state:'uncertain',authorizationHome:target.authorizationHome,
          accountKey:target.accountKey,executable:source.executable,socketPath:this.socketPath,serverOptions:options};
        await researchSave(this.file(requestId),record);await this.permit(args);
        const config=selectedCodexLaunch({verified:true,layoutVerified:true,method:'chatgpt',accountId:'switch',operationId,
          accountKey:target.accountKey,authorizationHome:target.authorizationHome,sqliteHome:target.sqliteHome});
        config.env.CLAWDAD_ACCOUNT_LAUNCH_REQUEST_ID=requestId;
        const log=await fs.open(path.join(this.root,'server-'+requestId+'.log'),'a',0o600);
        let child;
        try{child=this.spawnProcess(source.executable,withCodexAccountLaunch([...options,'app-server','--listen','unix://'+this.socketPath],config),
          {cwd:target.authorizationHome,env:config.env,detached:true,stdio:['ignore',log.fd,log.fd]});child.on?.('error',()=>{});child.unref?.();}
        finally{await log.close();}
        record.pid=child.pid;record.processIdentity=await this.exactDigest(child.pid);await researchSave(this.file(requestId),record);
        if(!record.processIdentity)throw failure('shared_launch_unobserved','The new process identity is not observable. Reconcile the original launch.');
        for(let i=0;i<30;i++){
          try{const owner=await this.observe();if(await this.verifyOwnership({...args,observed:owner})){record.state='started';await researchSave(this.file(requestId),record);return;}}catch(error){if(i===29)throw error;}
          await wait(250);
        }
        throw failure('shared_launch_unconfirmed','The server has not become ready. Its original launch receipt is retained.');
      }finally{await gate.release();}
    });
  }
  async verifyOwnership({operationId,requestId,observed}){
    const id=requestId||observed.accountLaunchRequestId;if(!id)return false;
    const record=await this.receipt(id);
    return !!record&&record.operationId===operationId&&record.socketPath===this.socketPath
      &&record.authorizationHome===observed.authorizationHome&&record.executable===observed.executable
      &&observed.accountTransitionId===operationId&&observed.accountLaunchRequestId===id
      &&(!record.pid||record.pid===observed.pid)&&(!record.processIdentity||record.processIdentity===observed.processIdentity);
  }
  async assertThreadUnowned(id,owner){
    if((await this.readOwners({socketPath:this.socketPath})).some(p=>p.pid!==owner.pid&&p.threads.includes(id)))
      throw failure('shared_thread_foreign_owner','This conversation has another live owner. Preserve its transport.');
  }
}
