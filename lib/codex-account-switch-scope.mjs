import {createHash} from 'node:crypto';

// Exclusion authorizes leaving one process untouched, never a directory/name
// match or a replacement owner on the same TTY. Catalog IDs may be rebuilt.
export function accountSkipOwner(owner) {
  if(owner?.kind!=='terminal_codex'||!Number.isSafeInteger(owner.pid)||owner.pid<=0
    ||typeof owner.processIdentity!=='string'||!owner.processIdentity
    ||!/^(?:\/dev\/)?tty[A-Za-z0-9]+$/.test(owner.tty||''))return null;
  return {kind:owner.kind,pid:owner.pid,processIdentity:owner.processIdentity,
    tty:owner.tty.replace(/^\/dev\//,''),executable:owner.executable??null,authorizationHome:owner.authorizationHome??null};
}
export const accountSkipIdentity=owner=>{
  const value=accountSkipOwner(owner);
  return value?createHash('sha256').update(JSON.stringify(value)).digest('hex'):null;
};

export function accountSwitchScope(inventory,operation) {
  const consumers=[...(inventory.consumers||[])],skippedConsumers=[],reasons=[...(inventory.reasons||[])];
  let complete=inventory.complete===true;
  for(const exclusion of operation?.excludedConsumers||[]) {
    const matches=consumers.filter(c=>accountSkipIdentity(c)===exclusion.identity);
    const occupants=consumers.filter(c=>c.tty?.replace(/^\/dev\//,'')===exclusion.owner.tty);
    if(matches.length===1&&occupants.length===1) {
      const owner=matches[0];consumers.splice(consumers.indexOf(owner),1);
      skippedConsumers.push({...owner,skipIdentity:exclusion.identity,skipState:'unchanged',skippedAt:exclusion.acceptedAt});
    } else if(matches.length===0&&occupants.length===0) {
      const verifiedExit=inventory.complete===true;
      skippedConsumers.push({...exclusion.display,...exclusion.owner,skipIdentity:exclusion.identity,
        skipState:verifiedExit?'exited':'verification_pending',skippedAt:exclusion.acceptedAt});
      if(!verifiedExit)reasons.push('Waiting for a complete Terminal inventory to verify the excluded process. Its exclusion is saved; no replacement has been authorized.');
    } else {
      complete=false;
      reasons.push('A skipped Terminal process changed. Cancel this switch and review the replacement before trying again; the new process was not skipped.');
    }
  }
  return {...inventory,complete,consumers,skippedConsumers,reasons:[...new Set(reasons)]};
}

export function accountSwitchSessionResults(operation) {
  if(!operation)return [];
  return [
    ...(operation.consumers||[]).map(c=>({...c,skipIdentity:accountSkipIdentity(c),
      canSkip:operation.phase==='preflight'&&operation.fenced===true&&!operation.cancelRequested&&!!accountSkipOwner(c),
      switchState:operation.effects?.['transition:'+c.id]?.state==='verified'?'switched':
        operation.status==='cancelled'?'cancelled':operation.status==='needs_attention'?'stopped':
        operation.cancelRequested?'cancelling':operation.effects?.['transition:'+c.id]?'verifying':
        c.busy===true?'working':c.busy===false?(c.recoverable?'ready':'idle'):'checking'})),
    ...(operation.skippedConsumers||[]).map(c=>({...c,canSkip:false,switchState:'skipped',
      reason:c.skipState==='exited'?'This excluded process has exited. No replacement was launched.':
        c.skipState==='verification_pending'?'Exclusion saved. Waiting for a complete inventory to verify this process.':'Left untouched. Its account is not verified by this switch.'})),
  ];
}
