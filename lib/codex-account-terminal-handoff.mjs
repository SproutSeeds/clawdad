import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {researchSave} from './research-budget.mjs';
import {privateAccountDirectory} from './codex-account-profile-process.mjs';
import {acquireCodexAccountClaim as acquireCodexDeliveryClaim} from './codex-account-claim.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const textHash=value=>createHash('sha256').update(value).digest('hex');
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const absolute=value=>typeof value==='string'&&path.isAbsolute(value)&&path.normalize(value)===value&&!/[\x00-\x1f\x7f]/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const failure=(code,message)=>Object.assign(Error(message),{code});
const unchangedTab=(a,b)=>a?.tty===b?.tty&&a?.tabLifetime===b?.tabLifetime&&a?.windowIdentity===b?.windowIdentity;
const sameHistory=(a,b)=>a?.sessionId===b?.sessionId&&a?.directory===b?.directory&&a?.acceptedTurnsHash===b?.acceptedTurnsHash;
const sameDraft=(draft,expected)=>draft?.verified===true&&draft.text===expected.text&&draft.hash===expected.hash;
const idle=value=>value?.busy===false&&value?.queueEmpty===true&&value?.pendingReceiptsResolved===true;

// Only independently verified text is recoverable. A collapsed length alone
// never qualifies. Attachment preservation requires a separate exact adapter;
// it is a deliberate stop before terminating the source owner.
export function validateAccountHandoffCapture(source){
  if(!source||!id(source.processIdentity)||!id(source.shellIdentity)||!Number.isSafeInteger(source.pid)||source.pid<=0
    ||!/^\/dev\/tty[A-Za-z0-9]+$/.test(source.tty||'')||!digest(source.tabLifetime)||!digest(source.windowIdentity)
    ||!/^[-a-f0-9]{36}$/i.test(source.sessionId||'')||!absolute(source.directory)||!absolute(source.authorizationHome)
    ||!absolute(source.executable)||!digest(source.acceptedTurnsHash)||!id(source.accountKey)||source.accountVerified!==true
    ||!id(source.model)||!id(source.reasoningEffort)||source.settingsVerified!==true||source.launchPolicyVerified!==true||source.shellWillRemain!==true||!Array.isArray(source.resumeOptions)
    ||!source.resumeOptions.every(value=>typeof value==='string'&&!/[\x00\r\n]/.test(value)))
    throw failure('handoff_identity_incomplete','Verify the exact live tab, conversation, account, launch policy and current model settings before switching.');
  if(!idle(source))throw failure('handoff_work_pending','Wait for this agent and its accepted native queue to finish. Existing work stays with its current account.');
  const draft=source.draft;
  if(!draft||typeof draft.text!=='string'||Buffer.byteLength(draft.text)>16*1024||draft.verified!==true
    ||!['rendered-composer','unchanged-native-paste'].includes(draft.provenance)||draft.hash!==textHash(draft.text)
    ||!Array.isArray(source.images)||source.images.length)
    throw failure('handoff_input_not_recoverable','This input is not fully recoverable yet. Preserve its images or hidden text and resolve them before switching this tab.');
  return structuredClone(source);
}

function validateTarget(target){
  if(!target||!id(target.accountKey)||!absolute(target.authorizationHome)||target.accountVerified!==true
    ||target.configurationVerified!==true||!digest(target.layoutFingerprint)||!digest(target.configurationHash))
    throw failure('handoff_target_unverified','Verify the selected subscription account and compatible runtime configuration first.');
  return structuredClone(target);
}

// The native driver owns focus/manual-input protection, exact process checks,
// supported UI adapters and its own one-time dispatch receipts. This controller
// owns restart recovery and never posts keys, signals a PID or selects another
// tab on its own. It does not read/write manual workspace snapshots.
export class CodexAccountTerminalHandoff {
  constructor({root,driver,lease=acquireCodexDeliveryClaim,clock=Date.now,onStep=async()=>{}}={}){
    Object.assign(this,{root,driver,lease,clock,onStep});
  }
  async location(source){
    await privateAccountDirectory(this.root);
    return path.join(this.root,'terminal-handoff-'+hash([source.tty,source.tabLifetime])+'.json');
  }
  async save(file,record){await researchSave(file,record);const dir=await fs.open(this.root,'r');try{await dir.sync();}finally{await dir.close();}}
  async load(file){
    try {
      const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||stat.mode&0o077||stat.size>2*1024*1024)throw Error();
      const value=JSON.parse(await fs.readFile(file,'utf8'));
      validateAccountHandoffCapture(value.source);validateTarget(value.target);
      if(value.version!==1||!id(value.operationId)||!Array.isArray(value.requests)||!value.requests.every(id)
        ||value.fingerprint!==hash({operationId:value.operationId,source:value.source,target:value.target})
        ||!['captured','stopping','launching','restoring','verified'].includes(value.phase)||!value.effects)throw Error();
      return value;
    }catch(error){if(error.code==='ENOENT')return null;throw failure('handoff_receipt_invalid','This tab’s account recovery record needs review. Its current input was preserved.');}
  }
  async inspect(source){const file=await this.location(source);return this.load(file);}
  async run({operationId,requestId,source,target,confirmed=false}){
    source=validateAccountHandoffCapture(source);target=validateTarget(target);
    if(!id(operationId)||!id(requestId)||confirmed!==true)throw failure('handoff_authorization_required','An explicitly accepted account switch is required.');
    const file=await this.location(source),fingerprint=hash({operationId,source,target});
    const claim=await this.lease(this.root,{threadId:'terminal-account-handoff:'+source.tty,requestId:'handoff',timeoutMs:5000});
    try {
      let record=await this.load(file);
      if(record&&record.fingerprint!==fingerprint){
        // Completed prior switches remain immutable. A new approved operation
        // gets a separate archive before a new per-tab transition is recorded.
        if(record.phase!=='verified')throw failure('handoff_already_pending','Reconcile the existing transition for this exact tab before choosing another account.');
        const archive=file+'.'+record.operationId+'.json';
        try{await fs.link(file,archive);}catch(error){if(error.code!=='EEXIST')throw error;
          const old=await this.load(archive);if(old.fingerprint!==record.fingerprint)throw failure('handoff_archive_changed','The previous transition archive needs review.');}
        record=null;
      }
      if(!record){record={version:1,operationId,fingerprint,source,target,requests:[requestId],phase:'captured',effects:{},createdAt:new Date(this.clock()).toISOString()};await this.save(file,record);}
      else if(!record.requests.includes(requestId)){record.requests.push(requestId);await this.save(file,record);}
      const observe=async()=>{
        const value=await this.driver.observe({source,target,operationId});
        if(!unchangedTab(value,source))throw failure('handoff_tab_changed','The original window or tab lifetime changed. Its recovery record is retained; no replacement tab was chosen.');
        if(value.kind==='agent'&&!sameHistory(value,source))throw failure('handoff_history_changed','This tab’s exact conversation or accepted work changed. Preserve it and review the saved draft before recovery.');
        return value;
      };
      const destination=value=>value.kind==='agent'&&sameHistory(value,source)&&value.authorizationHome===target.authorizationHome
        &&value.accountKey===target.accountKey&&value.accountVerified===true&&value.settingsVerified===true
        &&value.model===source.model&&value.reasoningEffort===source.reasoningEffort;
      const sourceOwner=value=>value.kind==='agent'&&sameHistory(value,source)&&value.processIdentity===source.processIdentity&&value.pid===source.pid
        &&value.authorizationHome===source.authorizationHome&&value.accountKey===source.accountKey&&value.accountVerified===true
        &&value.settingsVerified===true&&value.model===source.model&&value.reasoningEffort===source.reasoningEffort;
      const shell=value=>value.kind==='shell'&&value.shellIdentity===source.shellIdentity&&sameDraft(value.draft,{text:'',hash:textHash('')});
      const effect=async(name,dispatch)=>{
        const stable=hash({operationId,tab:source.tabLifetime,effect:name});
        if(record.effects[name]){
          // A driver can prove its exact request never reached dispatch. Only
          // that durable proof permits the same request to be attempted again.
          const receipt=await this.driver.reconcile({requestId:stable,operationId,source,target,effect:name});
          if(receipt?.state!=='not_dispatched'||receipt.requestId!==stable||receipt.durable!==true)
            throw failure('handoff_delivery_uncertain','A previous transition action may have occurred. Keep the saved request and reconcile its native receipt; it will not be blindly repeated.');
        }
        record.effects[name]={requestId:stable,state:'uncertain',preparedAt:new Date(this.clock()).toISOString()};await this.save(file,record);
        await this.onStep('prepared:'+name);
        await this.driver.permit({operationId,requestId:stable,effect:name,source,target});
        const result=await dispatch(stable);
        record.effects[name].result=result?.state||'awaiting_observation';await this.save(file,record);await this.onStep('dispatched:'+name);
      };
      let current=await observe();
      if(record.phase==='verified'){
        if(!(destination(current)||record.alreadySelected&&sourceOwner(current))||!sameDraft(current.draft,source.draft))throw failure('handoff_verified_state_changed','The previously switched tab has changed since verification. Its completed receipt remains saved.');
        return structuredClone(record);
      }
      if(sourceOwner(current)){
        if(!idle(current)||!sameDraft(current.draft,source.draft))throw failure('handoff_source_changed','The agent, pending work or captured draft changed. No restart was requested.');
        // The same verified cached subscription needs no process restart just
        // to move its credential home. New managed launches use the selected
        // profile independently; this live owner keeps its proven identity.
        if(source.accountKey===target.accountKey){
          record.phase='verified';record.alreadySelected=true;record.verifiedAt=new Date(this.clock()).toISOString();await this.save(file,record);return structuredClone(record);
        }
        record.phase='stopping';await this.save(file,record);
        await effect('stop',requestId=>this.driver.stopIdle({requestId,operationId,source,target}));
        current=await observe();
        if(!shell(current))throw failure('handoff_exit_unconfirmed','The original Codex exit and preserved shell are not verified. Reconcile this tab; no second stop or launch was sent.');
      }
      if(shell(current)){
        if(!record.effects.stop)throw failure('handoff_source_exited','The captured source exited independently. Review its recovery before launching another owner.');
        record.phase='launching';await this.save(file,record);
        await effect('launch',requestId=>this.driver.resumeExact({requestId,operationId,source,target}));
        current=await observe();
      }
      if(!destination(current))throw failure('handoff_destination_unverified','Finish or inspect this exact tab’s startup. Its account, conversation and settings are not yet verified; another owner will not be launched.');
      if(!record.effects.launch||await this.driver.verifyOwnership({operationId,requestId:record.effects.launch.requestId,source,target,observed:current})!==true)
        throw failure('handoff_destination_owner_uncertain','The new owner is not bound to this transition’s exact launch receipt. Preserve it and reconcile before recovering a draft.');
      if(!idle(current))throw failure('handoff_destination_working','The restored agent already has work or unresolved receipts. Its saved draft stays in recovery until that state is reviewed.');
      if(!sameDraft(current.draft,source.draft)){
        if(!sameDraft(current.draft,{text:'',hash:textHash('')}))throw failure('handoff_new_draft','A new draft is already present. Preserve it and review the independently saved original; nothing was overwritten.');
        record.phase='restoring';await this.save(file,record);
        await effect('draft',requestId=>this.driver.restoreDraft({requestId,operationId,source,target,owner:current.processIdentity}));
        current=await observe();
      }
      if(!destination(current)||!idle(current)||!sameDraft(current.draft,source.draft))throw failure('handoff_draft_unverified','The exact restored text or owner could not be verified. Inspect the saved recovery; no message was submitted.');
      record.phase='verified';record.destinationProcessIdentity=current.processIdentity;record.verifiedAt=new Date(this.clock()).toISOString();
      await this.save(file,record);return structuredClone(record);
    }finally{await claim.release();}
  }
}
