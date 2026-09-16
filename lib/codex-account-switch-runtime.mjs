import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CodexSharedClient,rpcPages} from './codex-thread-control.mjs';
import {inspectManagedAccountConsumers,readAccountWork} from './codex-account-consumers.mjs';
import {CodexAccountSharedProcess} from './codex-account-shared-process.mjs';
import {CodexAccountSharedRPC} from './codex-account-shared-rpc.mjs';
import {CodexAccountSwitchProfiles} from './codex-account-switch-profiles.mjs';
import {CodexAccountSwitchAdapter} from './codex-account-switch-adapter.mjs';
import {withAccountSharedGate} from './codex-account-shared-gate.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pending=new Set(['queued','running','sending','submitted','working','agent_queued']);

export async function captureAccountAppServerLocal(root,threadId){
  let state;
  try{const file=path.join(root,'state.json'),stat=await fs.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||stat.size>128*1024*1024)throw Error();
    state=JSON.parse(await fs.readFile(file,'utf8'));if(state.version!==1||!state.drafts||!Array.isArray(state.jobs))throw Error();
  }catch(error){if(error.code!=='ENOENT')throw Error('The app-server draft/receipt store needs recovery.');state={drafts:{},jobs:[]};}
  const draft=state.drafts[threadId]||{revision:0,text:'',images:[]};
  if(typeof draft.text!=='string'||!Array.isArray(draft.images)||draft.images.length>4)throw Error('The retained thread draft is incomplete.');
  for(const image of draft.images){
    if(!path.isAbsolute(image.path||'')||!/^[a-f0-9]{64}$/.test(image.sha256||'')||!Number.isSafeInteger(image.size)||image.size<0||image.size>10*1024*1024)
      throw Error('The retained image identity cannot be verified.');
    const bytes=await fs.readFile(image.path);
    if(bytes.length!==image.size||createHash('sha256').update(bytes).digest('hex')!==image.sha256)throw Error('A retained image changed or is missing.');
  }
  return {draftHash:hash(draft),receiptsResolved:!state.jobs.some(job=>(job.threadId||job.args?.threadId)===threadId&&pending.has(job.status))};
}

export async function readAccountSharedSummary(socketPath,owner,{createClient=options=>new CodexSharedClient(options)}={}){
  const client=createClient({socketPath});
  try{
    const pid=(await client.request('server/diagnostics',{})).process?.id;
    if(pid!==owner.pid)throw Error('Shared owner changed');
    const ids=await rpcPages(client,'thread/loaded/list',{limit:100});let busy=false;
    for(const id of ids){const thread=(await client.request('thread/read',{threadId:id,includeTurns:false})).thread;
      if(thread?.id!==id||thread.status?.type!=='idle'||(await rpcPages(client,'thread/queue/list',{threadId:id,limit:100})).length)busy=true;}
    const after=await rpcPages(client,'thread/loaded/list',{limit:100});
    if(hash([...ids].sort())!==hash([...after].sort())||(await client.request('server/diagnostics',{})).process?.id!==pid)throw Error('Shared inventory changed');
    return {pid,complete:true,busy};
  }finally{client.close();}
}

// Creates deterministic controllers only. Installation never accepts a switch,
// authenticates, captures a composer, migrates a profile or restarts an agent.
export function connectCodexAccountSwitchRuntime({accounts,runtime,binary,socketPath,canonicalHome,root=accounts.root}={}){
  let adapter,inFlightNative,lastNative;
  const readNative=async()=>{
    if(lastNative&&Date.now()-lastNative.at<200)return lastNative.value;
    if(inFlightNative)return inFlightNative;
    inFlightNative=runtime.accountConsumerInventory().then(value=>{lastNative={at:Date.now(),value};return value;});
    try{return await inFlightNative;}finally{inFlightNative=null;}
  };
  const permit=args=>adapter.permit(args);
  const inventory=()=>inspectManagedAccountConsumers(runtime,{socketPath,readNative,readShared:owner=>readAccountSharedSummary(socketPath,owner)});
  const profiles=new CodexAccountSwitchProfiles({root,canonicalHome,binary,authorizations:accounts.authorizations,runtime,permit});
  const processes=new CodexAccountSharedProcess({root:path.join(root,'SharedProcesses'),socketPath,readNative,permit,
    exclusive:action=>withAccountSharedGate(socketPath,action)});
  const sharedDriver=new CodexAccountSharedRPC({root:path.join(root,'SharedRPC'),socketPath,processes,permit,
    captureLocal:id=>captureAccountAppServerLocal(runtime.appServer.root,id)});
  const verifyPending=async source=>{
    const work=await readAccountWork(runtime);if(!work.complete)return false;
    // Active dispatches drain before capture. Past uncertain error receipts
    // remain saved; independent live idle/empty-queue proof is still required.
    const gate=await accounts.workDrain();
    return gate.ready===true&&source.pendingReceiptsResolved!==false;
  };
  const verifyManaged=async({operation})=>{
    const current=await inventory();
    if(!current.complete||current.consumers.length!==operation.consumers.length)return false;
    return current.consumers.every(owner=>operation.recovery.entries.some(entry=>
      owner.kind==='terminal_codex'?entry.native?.tty===owner.tty&&entry.native.sessionId===owner.sessionId:
      owner.kind==='shared_app_server'&&!!entry.shared));
  };
  adapter=new CodexAccountSwitchAdapter({root,accounts,runtime,inventory,profiles,sharedDriver,verifyPending,verifyManaged});
  accounts.adapter=adapter;accounts.inspectConsumers=args=>adapter.inspect(args);
  runtime.accountNativeControl=adapter.transport;
  return {adapter,profiles,processes,sharedDriver,close:()=>sharedDriver.close()};
}
