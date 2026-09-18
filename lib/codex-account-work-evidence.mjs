import {isTurnControl,pendingTurnControl} from './assistant-turn-control.mjs';
// Project old receipts into the account-drain ledger without modifying their
// original status, result or retry protection. Past uncertain receipts stay
// retained; separate fresh runtime proof is required before any transition.
export const accountReadOnlyActions=new Set(['terminal.inspect','terminal.observe','terminal.context','terminal.native.inspect',
  'computer.inspect','computer.capture','computer.displays','files.list','files.read','mainworkspace.status','mainworkspace.inspect',
  'mainworkspace.preview','mainworkspace.close.inspect']);
export function accountWorkEvidence(job){
  const evidence={status:job.status,accountReadOnly:job.accountReadOnly===true||accountReadOnlyActions.has(job.action)};
  // A lost control acknowledgment must remain in the account drain. History
  // absence cannot release its original epoch for activation of another account.
  if(isTurnControl(job.action)){
    if(pendingTurnControl(job))return {...evidence,status:'sending',evidence:'turn_control_requires_reconciliation'};
    if(job.controlReceipt?.state==='rejected')return {...evidence,status:'not_dispatched',evidence:'turn_control_rejected'};
  }
  if(evidence.accountReadOnly||!['attention','interrupted'].includes(job.status))return evidence;
  const result=job.result||{};
  const enter=job.action===['terminal','key'].join('.')&&job.args?.key==='enter'&&job.args?.intent==='submit';
  const guarded=['terminal.send','terminal.queue','terminal.insert','terminal.prompt'].includes(job.action)||enter;
  // These native paths persist prepare before input. A completed error receipt
  // without prepare establishes that this dispatcher sent no input.
  if(guarded&&!job.preparedAt&&job.status==='attention'&&typeof job.error==='string')
    return {...evidence,status:'not_dispatched',evidence:'native_prepare_absent'};
  if(enter&&result.keySent===false&&result.turnAccepted!==true||job.action==='terminal.queue'&&result.tabSent===false&&result.queueAccepted!==true)
    return {...evidence,status:'not_dispatched',evidence:'native_key_not_sent'};
  // These are terminal states of the Assistant dispatchers, not proof that a
  // message was rejected or completed. They are never automatically dispatched
  // again. Keep them visible and retain their exact original receipts. A
  // separate fresh owner/composer/queue capture must still establish that no
  // agent or queue is running before an account handoff can occur.
  return {...evidence,status:'retained_'+job.status,originalStatus:job.status,retained:true,evidence:'inactive_receipt_preserved'};
}
