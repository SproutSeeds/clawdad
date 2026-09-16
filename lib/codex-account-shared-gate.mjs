import fs from 'node:fs/promises';
import path from 'node:path';
import {acquireCodexAccountClaim as acquireCodexDeliveryClaim} from './codex-account-claim.mjs';

// Normal startup and account replacement use this same OS-wide lock. The
// durable account fence is checked inside it before creating any process.
export async function withAccountSharedGate(socketPath,action,{lease=acquireCodexDeliveryClaim}={}){
  if(!path.isAbsolute(socketPath)||path.normalize(socketPath)!==socketPath)throw Error('Use the exact managed socket path.');
  const root=path.dirname(socketPath);await fs.mkdir(root,{recursive:true,mode:0o700});
  const s=await fs.lstat(root);
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||s.mode&0o022)throw Error('The shared runtime directory needs verified local ownership.');
  const claim=await lease(root,{threadId:'clawdad-account-shared-runtime',requestId:'runtime',timeoutMs:30_000});
  try{return await action();}finally{await claim.release();}
}
