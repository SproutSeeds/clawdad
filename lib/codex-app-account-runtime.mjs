import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CodexAccountSharedProcess} from './codex-account-shared-process.mjs';
import {CodexAccountSharedRPC} from './codex-account-shared-rpc.mjs';
import {CodexAccountSharedHandoff} from './codex-account-shared-handoff.mjs';
import {CodexAccountSwitchProfiles} from './codex-account-switch-profiles.mjs';
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


// Only app-server protocol/OS operations are available here. The native bridge
// supplies read-only process facts; no Terminal catalogue, focus or input action.
export function connectCodexAppAccounts({accounts,runtime,binary,socketPath,canonicalHome}={}){
  const root=path.join(accounts.root,'AppActivation'),permit=args=>accounts.permit(args);
  const profiles=new CodexAccountSwitchProfiles({root:accounts.root,canonicalHome,binary,authorizations:accounts.authorizations,runtime,permit});
  const processes=new CodexAccountSharedProcess({root:path.join(root,'Processes'),socketPath,
    readNative:()=>runtime.accountProcessInventory(),permit,exclusive:action=>withAccountSharedGate(socketPath,action)});
  const driver=new CodexAccountSharedRPC({root:path.join(root,'RPC'),socketPath,processes,permit,
    captureLocal:id=>captureAccountAppServerLocal(runtime.appServer.root,id)});
  const handoff=new CodexAccountSharedHandoff({root:path.join(root,'Handoffs'),driver});
  const sourceOperation=op=>({...op,recovery:{entries:op.source.kind==='server'?[{shared:op.source}]:[]}});
  const adapter={
    async capture(op){
      return driver.observe({operationId:op.id,capture:true});
    },
    async prepare(op,target){
      return profiles.prepare({operation:sourceOperation(op),target});
    },
    async transition(op){
      const target=await profiles.target(op);
      // Accepted work has drained. Release this app's idle subscriptions so
      // Codex can unload its conversations without a forced interruption.
      runtime.appServer.client?.close();
      if(op.source.kind==='server')return handoff.run({operationId:op.id,source:op.source,target,confirmed:true});
      const requestId=hash({operationId:op.id,effect:'initial-app-server'});
      const observed=await processes.observe();
      if(observed.kind==='server'){
        if(!await processes.verifyOwnership({operationId:op.id,requestId,observed}))
          throw Object.assign(Error('Another process opened the app-server socket. Its work was preserved.'),{code:'shared_owner_changed',appAccountSafe:true});
        return {verified:true};
      }
      await fs.mkdir(path.dirname(socketPath),{recursive:true,mode:0o700});
      await processes.launch({operationId:op.id,requestId,target,
        source:{pid:0,processIdentity:'absent',executable:await fs.realpath(binary),serverOptions:[]}});
      return {verified:true};
    },
    async verify(op){
      const current=await driver.observe({operationId:op.id,source:op.source.kind==='server'?op.source:undefined});
      const target=await profiles.target(op);
      if(current.kind!=='server'||current.accountVerified!==true||current.accountKey!==op.destinationAccountKey||current.authorizationHome!==target.authorizationHome)
        throw Object.assign(Error('The app server did not verify the chosen subscription.'),{code:'app_account_mismatch',appAccountSafe:true});
      return profiles.verify(op);
    },
  };
  accounts.adapter=adapter;
  return {adapter,profiles,processes,driver,close:()=>driver.close()};
}
