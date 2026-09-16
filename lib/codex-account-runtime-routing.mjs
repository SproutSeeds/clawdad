import fs from 'node:fs/promises';
import path from 'node:path';
import {CodexAccounts,codexAccountsRoot} from './codex-accounts.mjs';
import {CodexAccountAuthorizations} from './codex-account-authorizations.mjs';
import {withAccountSharedGate} from './codex-account-shared-gate.mjs';
import {ensureCodexSharedRuntime,codexSharedRuntimeStatus,codexSharedSocketPath} from './codex-shared-runtime.mjs';
import {readLegacyAccountRequest} from './codex-account-project-inventory.mjs';
import {CodexAccountLegacyWork} from './codex-account-legacy-work.mjs';
import {serverRuntimeRoots} from './server-runtime-roots.mjs';

export function accountRoutingController(binary){
  const root=serverRuntimeRoots().accounts;
  return new CodexAccounts({root,authorizations:process.platform==='darwin'?new CodexAccountAuthorizations({root,binary}):null});
}
export async function accountRouteForLegacyRequest({accounts,binary,requestId,projectPath}={}){
  accounts ||= accountRoutingController(binary);
  let receipt=null;
  if(typeof requestId==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(requestId)){
    const file=path.join(accounts.root,'ProjectWork',requestId+'.json');
    try{const stat=await fs.lstat(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||stat.mode&0o077||stat.size>16384)throw Error('Project account receipt needs recovery.');
      receipt=JSON.parse(await fs.readFile(file,'utf8'));
      if(receipt.version!==1||receipt.id!==requestId||receipt.action!=='legacy.dispatch'||receipt.projectPath!==projectPath
        ||typeof receipt.fingerprint!=='string')throw Error('Project account receipt no longer matches the accepted request.');
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  if(receipt)await accounts.assertDelivery(receipt);
  else if(requestId&&projectPath){
    const accepted=await readLegacyAccountRequest(projectPath,requestId);
    if(!accepted||accepted.provider!=='codex')throw Error('The exact accepted Codex project request must be recovered before delivery.');
    const gate=await accounts.admission();
    if(!gate.allowed){
      // A queue accepted before installing this ledger can drain only if the
      // switch imported this exact immutable request before setting its fence.
      await accounts.assertDelivery(accepted);receipt=accepted;
    }else{
      const ledger=new CodexAccountLegacyWork({root:path.join(accounts.root,'ProjectWork'),accounts});
      receipt=await ledger.reserve(accepted);await ledger.prepare(receipt);
    }
  }else await accounts.assertAdmission();
  return {accounts,receipt,launch:await accounts.selectedLaunch()};
}

export async function ensureAccountSharedRuntime(options,{accounts,receipt=null,
  ensure=ensureCodexSharedRuntime,status=codexSharedRuntimeStatus,exclusive=withAccountSharedGate}={}){
  accounts ||= accountRoutingController(options.codexBinary);
  const socketPath=options.socketPath||codexSharedSocketPath(options.env||process.env);
  return exclusive(socketPath,async()=>{
    const gate=await accounts.admission();
    if(!gate.allowed){
      // Health polling and already accepted work may inspect the old healthy
      // owner. No startup, repair or automatic upgrade occurs during the hold.
      const existing=await status({...options,socketPath});
      if(existing.ready&&gate.phase==='preflight'){
        if(receipt)await accounts.assertDelivery(receipt);return existing;
      }
      throw Object.assign(Error(gate.reason),{code:'account_switch_pending'});
    }
    if(receipt)await accounts.assertDelivery(receipt);
    const accountLaunch=await accounts.selectedLaunch();
    return ensure({...options,socketPath,accountLaunch,env:accountLaunch?.env||options.env});
  });
}
