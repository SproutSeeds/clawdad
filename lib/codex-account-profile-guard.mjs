import fs from 'node:fs/promises';
import path from 'node:path';
import {acquireCodexAccountClaim as acquireCodexDeliveryClaim} from './codex-account-claim.mjs';

// One deterministic launch/layout gate per retained authorization home. Hold
// during migration or until a newly launched consumer has initialized; existing
// long-lived consumers are detected separately by the native process inventory.
export async function claimAccountProfile(home,{lease=acquireCodexDeliveryClaim,timeoutMs=5000,allowReadableHome=false}={}){
  if(typeof home!=='string'||!path.isAbsolute(home)||path.normalize(home)!==home||/[\x00-\x1f\x7f]/.test(home))
    throw Object.assign(Error('Use the exact saved account home.'),{code:'invalid_profile_home'});
  const stat=await fs.lstat(home);
  if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(home)!==home||stat.uid!==process.getuid()||stat.mode&(allowReadableHome?0o022:0o077))
    throw Object.assign(Error('The account home needs private local ownership.'),{code:'unsafe_profile_home'});
  const directory=path.join(home,'.clawdad-account-control');await fs.mkdir(directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  const control=await fs.lstat(directory);
  if(!control.isDirectory()||control.isSymbolicLink()||control.uid!==process.getuid()||control.mode&0o077)
    throw Object.assign(Error('The account runtime guard needs recovery.'),{code:'unsafe_profile_guard'});
  return lease(directory,{threadId:'account-runtime-launch-layout',requestId:'gate',timeoutMs});
}
