import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CodexAccountTerminalHandoff,validateAccountHandoffCapture} from './codex-account-terminal-handoff.mjs';
import {CodexAccountSharedHandoff,validateSharedAccountCapture} from './codex-account-shared-handoff.mjs';
import {CodexAccountNativeDriver} from './codex-account-native-driver.mjs';
import {CodexAccountNativeTransport} from './codex-account-native-transport.mjs';
import {researchSave} from './research-budget.mjs';
import {privateAccountDirectory} from './codex-account-profile-process.mjs';
import {accountSwitchScope} from './codex-account-switch-scope.mjs';
import {CodexAccountWindowSwitch,readAccountWindow} from './codex-account-window-switch.mjs';

const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const textHash=v=>createHash('sha256').update(v).digest('hex');
const fail=(code,message)=>Object.assign(Error(message),{code});

// Binds the proven per-owner controllers to one accepted account-switch job.
// Runtime discovery, profile preparation and OS process control remain explicit
// injected native adapters. Constructing this never selects an account.
export class CodexAccountSwitchAdapter {
  constructor({root,accounts,runtime,inventory,profiles,sharedDriver,verifyPending,verifyManaged,clock=Date.now,windowRebuild=false}={}){
    Object.assign(this,{root,accounts,runtime,inventory,profiles,sharedDriver,verifyPending,verifyManaged,clock});
    this.capabilities={ready:true,managedLogin:true,retainedAuthorizations:true,consumerAccountAdoption:true,
      sessionTransition:true,selectedRuntimeRouting:true,requiresCancellationDrain:true,skipTerminalSessions:true,reasons:[]};
    this.transport=new CodexAccountNativeTransport({root:path.join(root,'NativeTransport'),authorize:r=>this.authorizeNative(r)});
    this.native=new CodexAccountNativeDriver({transport:this.transport,identities:[],permit:a=>this.permit(a),verifyPending});
    this.terminals=new CodexAccountTerminalHandoff({root:path.join(root,'TerminalHandoffs'),driver:this.native});
    this.shared=new CodexAccountSharedHandoff({root:path.join(root,'SharedHandoffs'),driver:sharedDriver});
    if(windowRebuild){this.windows=new CodexAccountWindowSwitch(this);Object.assign(this.capabilities,{windowRebuild:true,skipTerminalSessions:false});this.native.waitMs=300000;}
  }
  file(id){if(!/^[A-Za-z0-9_.:-]{1,160}$/.test(id||''))throw Error('Invalid account switch identity');return path.join(this.root,'captures',id+'.json');}
  async readCapture(id){
    const file=this.file(id);try{const stat=await fs.lstat(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||stat.mode&0o077||stat.size>16*1024*1024)throw Error();
      const v=JSON.parse(await fs.readFile(file,'utf8'));if(v.version!==1||v.operationId!==id||!Array.isArray(v.entries))throw Error();return v;
    }catch(e){if(e.code==='ENOENT')return null;throw fail('account_capture_invalid','The account recovery capture needs review. Existing sessions were preserved.');}
  }
  async permit({operationId}){
    const gate=await this.accounts.admission();
    if(gate.operationId!==operationId||gate.allowed||this.runtime.state?.paused)throw fail('account_control_not_authorized','The accepted account switch is paused or changed.');
    // Read the atomic journal, avoiding lock inversion with native poll/prepare.
    const state=JSON.parse(await fs.readFile(this.accounts.file,'utf8')),op=state.operations[operationId];
    if(!op||op.cancelRequested||!op.fenced||!['preflight','authenticate','transition','verify'].includes(op.phase))
      throw fail('account_control_not_authorized','The account switch is no longer authorized.');
    return op;
  }
  async authorizeNative(request){
    try{
      const op=await this.permit(request),source=request.args?.source;
      if(this.windows){
        if(!request.action.startsWith('window.')||request.args.operationId!==op.id||op.strategy!=='window-rebuild-v1')return false;
        if(request.action==='window.capture')return ['preflight','authenticate'].includes(op.phase)&&JSON.stringify(request.args.selection)===JSON.stringify(op.windowSelection);
        if(!['transition','verify'].includes(op.phase))return false;
        const recovery=op.recovery?.entries.find(e=>e.window)?.window,record=await readAccountWindow(this.root,op.id);
        if(!recovery||recovery.captureHash!==record?.captureHash)return false;
        if(request.action==='window.verify')return true;
        const target=await this.profiles.target(op);
        return request.action==='window.restore'&&request.args.target?.authorizationHome===target.authorizationHome
          &&request.args.target?.sqliteHome===target.sqliteHome&&request.args.target?.accountKey===op.destinationAccountKey;
      }
      if(!source?.tty)return false;
      if(op.excludedConsumers?.some(e=>e.owner.tty===source.tty.replace(/^\/dev\//,'')))return false;
      if(['preflight','authenticate'].includes(op.phase)&&['observe','status'].includes(request.action)){
        const capture=await this.readCapture(op.id),owner=capture?.selection?.find(c=>c.tty===source.tty);
        return !!owner&&owner.processIdentity===source.processIdentity&&Number(owner.pid)===Number(source.pid);
      }
      const entry=op.recovery?.entries.find(e=>e.native?.tty===source.tty);
      if(!entry||!['transition','verify'].includes(op.phase))return false;
      const original=entry.native;
      if(source.tabLifetime!==original.tabLifetime||source.windowIdentity!==original.windowIdentity||source.sessionId!==original.sessionId)return false;
      if(request.action==='launch'){
        const target=await this.profiles.target(op);
        return request.args.target?.authorizationHome===target.authorizationHome&&request.args.target?.accountKey===op.destinationAccountKey;
      }
      if(request.action==='draft'&&request.args.text!==original.draft.text)return false;
      return ['observe','status','stop','draft'].includes(request.action);
    }catch{return false;}
  }
  async inspect({operation=null}={}){
    let observed=await this.inventory();
    if(this.windows)this.windows.choices=observed.windows||[];
    if(!operation||!['preflight','authenticate'].includes(operation.phase))return observed;
    await this.permit({operationId:operation.id});
    if(this.windows)observed=await this.windows.inspect(observed,operation);
    const scoped=accountSwitchScope(observed,operation);
    if(!scoped.complete)return {...observed,complete:false,reasons:scoped.reasons};
    if(scoped.consumers.some(c=>c.busy!==false||c.pendingReceipts?.length))return observed;
    const identities=await this.profiles.identities();this.native.identities=identities;
    const capture={version:1,operationId:operation.id,selection:scoped.consumers.map(c=>({id:c.id,tty:c.tty,pid:c.pid,processIdentity:c.processIdentity})),entries:[]};
    await privateAccountDirectory(path.dirname(this.file(operation.id)));await researchSave(this.file(operation.id),capture);
    const consumers=observed.consumers.filter(c=>!scoped.consumers.includes(c));
    for(const owner of scoped.consumers){
      await this.permit({operationId:operation.id});
      if(owner.kind==='terminal_window'){
        capture.entries.push(this.windows.recovery(observed.windowRecord,owner));consumers.push(owner);
        await researchSave(this.file(operation.id),capture);continue;
      }else if(owner.reason||owner.alternateAuthentication===true||owner.launchReasonCode||owner.kind==='terminal_codex'&&!owner.sessionId){
        consumers.push({...owner,recoverable:false});continue;
      }
      if(owner.kind==='terminal_codex'){
        try{
          const source=validateAccountHandoffCapture(await this.native.capture({operationId:operation.id,source:{tty:owner.tty,processIdentity:owner.processIdentity,pid:owner.pid}}));
          if(source.processIdentity!==owner.processIdentity||source.pid!==owner.pid||source.sessionId!==owner.sessionId)
            throw fail('account_capture_owner_changed','The exact Terminal owner changed during capture.');
          capture.entries.push({id:owner.id,...source,native:source,draft:source.draft,pendingReceipts:[]});
          consumers.push({...owner,...source,kind:'terminal_codex',id:owner.id,recoverable:true,draft:{...source.draft,state:'captured',recoverable:true},pendingReceipts:[],reason:''});
        }catch(error){consumers.push({...owner,recoverable:false,reason:'This tab needs review before switching: '+(error.code||'native_capture_unavailable')+'. Its input was preserved.'});}
      }else if(owner.kind==='shared_app_server'){
        try{
          const source=validateSharedAccountCapture(await this.sharedDriver.observe({operationId:operation.id,capture:true}));
          if(source.pid!==owner.pid||source.processIdentity!==owner.processIdentity)throw Error('Shared owner changed');
          const draft={text:'',hash:textHash(''),provenance:'app-server-owned-drafts',recoverable:true,state:'retained'};
          capture.entries.push({id:owner.id,processIdentity:source.processIdentity,sessionId:null,directory:null,accountKey:source.accountKey,draft,images:[],pendingReceipts:[],shared:source});
          consumers.push({...owner,accountKey:source.accountKey,accountVerified:true,recoverable:true,busy:false,sessionId:null,directory:null,draft,pendingReceipts:[],reason:''});
        }catch(error){consumers.push({...owner,recoverable:false,reason:'The shared server needs review before switching: '+(error.code||'shared_capture_unavailable')+'. Existing threads were preserved.'});}
      }else consumers.push({...owner,recoverable:false,reason:'This runtime has no verified account-transition adapter.'});
      await researchSave(this.file(operation.id),capture);
    }
    return {...observed,consumers};
  }
  async captureRecovery(observed){
    const gate=await this.accounts.admission();await this.permit({operationId:gate.operationId});
    const capture=await this.readCapture(gate.operationId);
    if(!capture||capture.entries.length!==observed.consumers.length)throw Error('Capture incomplete');
    return {fingerprint:observed.fingerprint,entries:capture.entries};
  }
  async authenticate({operation,target}){
    await this.permit({operationId:operation.id});return this.profiles.prepare({operation,target});
  }
  reconcileAuthentication(args){return this.authenticate(args);}
  async transition({operation,consumer}){
    await this.permit({operationId:operation.id});
    if(consumer.kind==='terminal_window')return this.windows.transition(operation);
    this.native.identities=await this.profiles.identities();
    const target=await this.profiles.target(operation),entry=operation.recovery?.entries.find(e=>e.id===consumer.id);
    if(!entry)throw Error('Exact captured owner missing');
    const result=entry.native?await this.terminals.run({operationId:operation.id,requestId:hash([operation.id,consumer.id]),source:entry.native,target,confirmed:true}):
      entry.shared?await this.shared.run({operationId:operation.id,source:entry.shared,target,confirmed:true}):null;
    if(result?.waiting)return {state:'waiting',reasonCode:result.reasonCode};
    if(result?.phase!=='verified')throw Error('Owner transition incomplete');
    return {state:'verified',sessionId:consumer.sessionId,accountKey:target.accountKey,ownerVerified:true,draftVerified:true};
  }
  reconcileTransition(args){return this.transition(args);}
  async verify({operation}){
    for(const consumer of operation.consumers){
      if(consumer.kind==='terminal_window')await this.windows.verify(operation);
      else if((await this.transition({operation,consumer})).state!=='verified')throw Error('A consumer remains unverified');
    }
    const result=await this.profiles.verify(operation);
    if(!this.windows&&!await this.verifyManaged({operation,target:result}))throw Error('The complete managed runtime inventory changed');
    return {...result,allConsumersVerified:true};
  }
  async reconcileCancellation({operation}){
    // Profile sign-in verification/adoption does not replace active credentials.
    // Wait for any already prepared status/draft capture to finish restoring its
    // input before releasing the hold. A possible owner transition requires an
    // explicit continuation of this same operation instead of a blind rollback.
    const transitioned=Object.entries(operation.effects).some(([name,value])=>name.startsWith('transition:')&&value.dispatchedAt);
    const settled=await this.transport.settleCancellation(operation.id,{reconcileReadOnly:async receipt=>{
      if(['observe','window.capture','window.verify'].includes(receipt.action))return {noAccountOrProcessMutation:true,originalDraftPreserved:true,kind:'observation_only'};
      if(receipt.action!=='status')return null;
      // The previous /status adapter saved recovery BEFORE any input mutation.
      // An empty original draft requires no restoration. Preserve the uncertain
      // status receipt; it never becomes proof that a command was accepted.
      let record;
      try{
        const file=path.join(this.root,'NativeRecovery',receipt.id+'.json'),stat=await fs.lstat(file);
        if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||stat.mode&0o077||stat.size>256*1024)return null;
        record=JSON.parse(await fs.readFile(file,'utf8'));
      }catch(error){if(error.code==='ENOENT')return {noAccountOrProcessMutation:true,originalDraftPreserved:true,kind:'status_not_prepared'};return null;}
      if(record.requestId!==receipt.id||record.command!=='/status'||record.source?.draft?.text!==''
        ||record.source?.processIdentity!==receipt.args.source?.processIdentity
        ||!['captured','local_command_enter_prepared','verified'].includes(record.stage))return null;
      return {noAccountOrProcessMutation:true,originalDraftPreserved:true,kind:'local_status_empty_draft',deliveryStillUncertain:true};
    }});
    return {accountKey:operation.sourceAccountKey,allConsumersVerified:!transitioned&&settled,
      pendingEffectsResolved:!transitioned&&settled,performedMutations:false};
  }
}
