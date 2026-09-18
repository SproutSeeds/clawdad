import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,realpath} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import {codexSharedSocketPath,codexSharedWebSocketUrl} from './codex-shared-runtime.mjs';
import {acquireCodexDeliveryClaim} from './codex-delivery-claim.mjs';

const exec=promisify(execFile);
const socketGeneration=s=>`${s.dev}:${s.ino}:${s.birthtimeMs}:${s.ctimeMs}`;
export const validThreadId = id => typeof id==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id);

// All ClawDad writers use the same account/home lock, independent of project
// aliases and delivery request IDs. It serializes ownership checks and dispatch,
// not the lifetime of a running agent.
export const acquireThreadControl = threadId => acquireCodexDeliveryClaim(os.homedir(), {
  threadId,requestId:'clawdad-thread-control',timeoutMs:12_000,
});

export class CodexSharedClient {
  constructor({socketPath=codexSharedSocketPath(),timeoutMs=12_000,onNotification=()=>{},onServerRequest=()=>{}}={}) {
    Object.assign(this,{socketPath,timeoutMs,onNotification,onServerRequest});this.pending=new Map();this.serverRequests=new Map();this.effectiveMode='shared';this.next=0;this.ws=null;this.connecting=null;
  }
  async connect(){
    if(this.ws?.readyState===WebSocket.OPEN&&this.initialized)return;
    if(this.connecting)return this.connecting;
    this.connecting=this.open().finally(()=>{this.connecting=null;});return this.connecting;
  }
  async open(){
    let socketIdentity;
    for(const file of [path.dirname(this.socketPath),this.socketPath]){
      const s=await lstat(file);if(s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o022))throw Error('The local Codex socket ownership or permissions could not be verified.');
      if(file===this.socketPath){if(!s.isSocket())throw Error('The Codex endpoint is not a local socket.');socketIdentity=socketGeneration(s);}
    }
    const ws=new WebSocket(codexSharedWebSocketUrl(this.socketPath),{handshakeTimeout:4000,perMessageDeflate:false});
    this.ws=ws;this.initialized=false;
    ws.on('error',()=>{});
    ws.on('close',()=>{if(this.ws===ws){this.initialized=false;this.ws=null;this.serverRequests.clear();}for(const [id,p] of this.pending){if(p.ws===ws){clearTimeout(p.timer);p.reject(Object.assign(Error('The Codex connection closed. Reconcile this request before retrying.'),{uncertain:true}));this.pending.delete(id);}}});
    ws.on('message',data=>{
      let m;try{m=JSON.parse(String(data));}catch{return;}
      if(m.method){if(m.id!=null){this.serverRequests.set(m.id,m);queueMicrotask(()=>this.onServerRequest(m,this));}else {if(m.method==='serverRequest/resolved')this.serverRequests.delete(m.params?.requestId);this.onNotification(m);}return;}
      const p=this.pending.get(m.id);if(!p||p.ws!==ws)return;this.pending.delete(m.id);clearTimeout(p.timer);
      m.error?p.reject(Object.assign(Error(m.error.message||'Codex rejected the request'),{rpcCode:m.error.code,data:m.error.data})):p.resolve(m.result);
    });
    await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
    this.info=await this.raw('initialize',{clientInfo:{name:'clawdad_assistant_threads',version:'0.7.0'},capabilities:{experimentalApi:true}});
    if(socketGeneration(await lstat(this.socketPath))!==socketIdentity){ws.close();throw Error('The Codex socket changed while connecting. Inspect it again.');}
    this.connectionIdentity={id:randomUUID(),socketIdentity};
    ws.send(JSON.stringify({method:'initialized',params:{}}));this.initialized=true;
  }
  raw(method,params={},id=++this.next){
    const ws=this.ws;
    return new Promise((resolve,reject)=>{
      if(ws?.readyState!==WebSocket.OPEN)return reject(Error('Codex is disconnected.'));
      if(this.pending.has(id))return reject(Error('This JSON-RPC correlation ID is already pending.'));
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Object.assign(Error('Codex acknowledgement timed out. Reconcile this request before retrying.'),{uncertain:true}));},this.timeoutMs);
      this.pending.set(id,{resolve,reject,timer,ws});ws.send(JSON.stringify({id,method,params}));
    });
  }
  async request(method,params={}){
    await this.connect();
    if(method==='thread/turns/list'){
      if(!this.compatTurns){try{return await this.raw(method,params);}catch(error){if(error.rpcCode!==-32601)throw error;this.compatTurns=true;}}
      // 0.154 advertises this method but some builds still return -32601.
      // Reconcile the same ID through the supported read API; never resend.
      const result=await this.raw('thread/read',{threadId:params.threadId,includeTurns:true});
      let turns=[...(result.thread?.turns||[])];if(params.sortDirection==='desc')turns.reverse();
      const offset=params.cursor?Number(String(params.cursor).replace(/^compat:/,'')):0;
      if(!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid history cursor.');
      const limit=Math.min(100,Math.max(1,params.limit||20));
      return {data:turns.slice(offset,offset+limit),nextCursor:offset+limit<turns.length?'compat:'+(offset+limit):null};
    }
    return this.raw(method,params);
  }
  // Strict turn controls use the connection just inspected. Reconnecting is a
  // read/reconcile operation, never an implicit part of a mutating dispatch.
  async requestPinned(method,params,{connectionId,requestId,dispatch=send=>send()}){
    if(!['turn/steer','turn/interrupt'].includes(method))throw Error('Unsupported pinned turn control.');
    const identity=this.connectionIdentity;
    let current;try{current=socketGeneration(await lstat(this.socketPath));}catch{}
    if(!this.initialized||this.ws?.readyState!==WebSocket.OPEN||identity?.id!==connectionId||identity.socketIdentity!==current)
      throw Object.assign(Error('The inspected Codex connection changed before dispatch. No control was sent.'),{notSent:true,reasonCode:'connection_changed'});
    let sent=false;
    try{
      // The Assistant's authorization/paused-state lock covers the final
      // synchronous wire enqueue, then releases before awaiting the reply.
      const {response}=await dispatch(()=>{
        if(!this.initialized||this.ws?.readyState!==WebSocket.OPEN||this.connectionIdentity?.id!==connectionId)
          throw Error('The inspected connection closed before dispatch.');
        sent=true;return {response:this.raw(method,params,requestId)};
      });
      return await response;
    }catch(error){if(!sent)error.notSent=true;throw error;}
  }
  hasServerRequest(id){return this.serverRequests.has(id)&&this.ws?.readyState===WebSocket.OPEN;}
  discardServerRequest(id){return this.serverRequests.delete(id);}
  respond(id,result){if(!this.hasServerRequest(id))return false;this.ws.send(JSON.stringify({id,result}));this.serverRequests.delete(id);return true;}
  respondError(id,message,code=-32603){if(!this.hasServerRequest(id))return false;this.ws.send(JSON.stringify({id,error:{message,code}}));this.serverRequests.delete(id);return true;}
  close(){this.serverRequests.clear();this.ws?.close();}
}

// A PID can be reused. Bind strict controls to the local endpoint inode, its
// connected server PID, the process start/executable digest and provider home.
// This is read-only OS/protocol evidence and never starts a missing server.
export async function readSharedControlGeneration(client,owner,{run=exec,stat=lstat,canonical=realpath}={}){
  if(!['app_server','saved'].includes(owner?.kind)||!Number.isSafeInteger(owner.pid)||!client.connectionIdentity)
    throw Error('The exact shared-server lifetime is unavailable.');
  const {stdout}=await run('/bin/ps',['-p',String(owner.pid),'-o','pid=,uid=,lstart=,comm='],{timeout:4000,maxBuffer:8192});
  const match=stdout.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d{2}:\d{2}:\d{2})\s+(\d{4})\s+(.+)$/);
  if(!match||Number(match[1])!==owner.pid||Number(match[2])!==process.getuid()||path.basename(match[8])!=='codex')
    throw Error('The shared-server process lifetime could not be verified.');
  const diagnostics=await client.request('server/diagnostics',{}),s=await stat(client.socketPath);
  if(diagnostics.process?.id!==owner.pid||s.isSymbolicLink()||!s.isSocket()||s.uid!==process.getuid()||(s.mode&0o022)
    ||socketGeneration(s)!==client.connectionIdentity.socketIdentity||!path.isAbsolute(client.info?.codexHome||''))
    throw Error('The connected server, socket or provider home changed.');
  return {computer:os.hostname(),uid:process.getuid(),endpoint:await canonical(client.socketPath),
    providerHome:await canonical(client.info.codexHome),pid:owner.pid,
    processLifetime:createHash('sha256').update(match.slice(1).join('\0')).digest('hex'),socketGeneration:socketGeneration(s)};
}

export async function rpcPages(client,method,params={}){
  const data=[],seen=new Set();let cursor=null;
  do {
    const r=await client.request(method,{...params,...(cursor?{cursor}:{})});
    if(!Array.isArray(r.data))throw Error('Codex returned an incomplete inventory.');
    data.push(...r.data);cursor=r.nextCursor;
    if(cursor&&seen.has(cursor))throw Error('Codex repeated an inventory cursor.');seen.add(cursor);
    if(seen.size>10_000)throw Error('Codex inventory exceeds the supported page limit.');
  }while(cursor);return data;
}

// Read-only process/file evidence. Names and directories never establish live
// ownership. A foreign foreground, background or second-server owner fences
// writes, including resume, even when the shared server can read its history.
export async function codexProcessOwners({run=exec,socketPath=codexSharedSocketPath()}={}){
  let rows,files;
  for(let attempt=0;attempt<3;attempt++){
    const ps=(await run('/bin/ps',['-axo','pid=,tty=,comm='],{timeout:4000,maxBuffer:4*1024*1024})).stdout;
    rows=ps.split('\n').map(s=>s.trim().split(/\s+/)).filter(r=>r.length>=3&&path.basename(r.slice(2).join(' '))==='codex');
    const pids=rows.map(r=>r[0]);if(!pids.length)throw Error('No Codex owner is observable.');
    try{files=(await run('/usr/sbin/lsof',['-n','-P','-p',pids.join(','),'-Fpn'],{timeout:5000,maxBuffer:16*1024*1024})).stdout;break;}
    catch(error){
      // A short-lived account verification process can exit between ps and
      // lsof. Discard partial output and repeat the entire read-only census.
      // Persistent inspection failure still fences delivery/resume.
      if(error.code!==1||attempt===2)throw error;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
  }
  const owners=rows.map(([pid,tty])=>({pid:Number(pid),tty,threads:[],socket:false}));let owner;
  for(const line of files.split('\n')){
    if(line[0]==='p')owner=owners.find(v=>v.pid===Number(line.slice(1)));
    if(!owner||line[0]!=='n')continue;
    if(line.slice(1)===socketPath)owner.socket=true;
    const id=line.match(/\/rollout-[^/]+-([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.jsonl$/i)?.[1];
    if(id&&!owner.threads.includes(id))owner.threads.push(id);
  }
  return owners;
}

export function classifyThreadOwner(threadId,owners,loaded){
  const servers=owners.filter(o=>o.socket),holders=owners.filter(o=>o.threads.includes(threadId));
  if(servers.length!==1)return {kind:'uncertain',reason:'The shared app-server process owner is not unique.'};
  const foreign=holders.filter(o=>o.pid!==servers[0].pid);
  if(foreign.length)return {kind:foreign.length===1&&foreign[0].tty!=='??'?'terminal':'other_runtime',processes:foreign.map(o=>({...o,threads:[threadId]})),
    reason:'This conversation is owned by another live Codex process. App-server delivery cannot attach to that independent process. Keep work in its exact Terminal/native transport, or explicitly finish and exit that owner before inspecting and resuming this same saved ID in ClawDad. No work was moved or rerouted.'};
  return {kind:loaded.includes(threadId)?'app_server':'saved',pid:servers[0].pid};
}

export async function assertSharedThreadOwner(client,threadId,readOwners=codexProcessOwners){
  if(!validThreadId(threadId))throw Error('Use an exact inspected Codex thread ID.');
  const [owners,loaded]=await Promise.all([readOwners({socketPath:client.socketPath||client.appServerSocket}),rpcPages(client,'thread/loaded/list',{limit:100})]);
  const owner=classifyThreadOwner(threadId,owners,loaded);
  if(!['saved','app_server'].includes(owner.kind))throw Object.assign(Error(owner.reason),{reasonCode:'foreign_runtime_owner',owner});
  return owner;
}
