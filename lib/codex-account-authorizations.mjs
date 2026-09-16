import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {researchSave} from './research-budget.mjs';
import {acquireCodexDeliveryClaim} from './codex-delivery-claim.mjs';
import {CodexManagedLogin} from './codex-managed-login.mjs';
import {CodexAccountProfileProcess,openCodexSignIn,privateAccountDirectory} from './codex-account-profile-process.mjs';

const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const profileId=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const active=new Set(['checking','starting','awaiting_user','cancelling']);
const rejected=message=>Object.assign(Error(message),{accountRequestRejected:true});
const safeFailure='The saved sign-in needs checking. Use Check saved sign-in; if it is unavailable, connect again on the Mac.';
const processIsLive=pid=>{if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}};

// This journal is separate from switch recovery and manual workspaces. It
// records only supported sign-in receipts and nonsecret identity observations.
// Connecting an account never selects it for any existing or future agent.
export class CodexAccountAuthorizations {
  constructor({root,binary,clock=Date.now,timeoutMs=10*60_000,open=openCodexSignIn,
    createProcess=options=>new CodexAccountProfileProcess(options),lease=acquireCodexDeliveryClaim}={}) {
    Object.assign(this,{root,binary,clock,timeoutMs,open,createProcess,lease});this.file=path.join(root,'authorizations.json');
    this.tasks=new Map();this.connections=new Map();this.serial=Promise.resolve();this.stopping=false;this.instanceId=randomUUID();
  }
  async transaction(fn) {
    const run=this.serial.then(async()=>{
      await privateAccountDirectory(this.root);
      const claim=await this.lease(this.root,{threadId:'account-authorizations',requestId:'journal',timeoutMs:5000});
      try {
        let state;try{state=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw Error('Saved sign-in recovery needs attention.');}
        state||={version:1,revision:0,profiles:{},requests:{}};
        if(state.version!==1||!Number.isSafeInteger(state.revision)||!state.profiles||!state.requests)throw Error('Saved sign-in recovery needs attention.');
        const save=async()=>{state.revision++;await researchSave(this.file,state);const dir=await fs.open(this.root,'r');try{await dir.sync();}finally{await dir.close();}};
        return await fn(state,save);
      }finally{await claim.release();}
    });this.serial=run.catch(()=>{});return run;
  }
  async snapshot() {
    return this.transaction(state=>({revision:state.revision,profiles:Object.values(state.profiles).map(profile=>{
      const operation=state.requests[profile.operationId];
      return {...structuredClone(profile),operation:operation?this.publicReceipt(operation):null};
    })}));
  }
  publicReceipt(receipt){
    const result=structuredClone(receipt);
    if(active.has(result.status)&&!this.tasks.has(result.requestId)&&!this.otherLiveOwner(result)){
      result.status='needs_check';result.reason='The sign-in connection was interrupted. Check saved sign-in before starting again.';
    }
    return result;
  }
  otherLiveOwner(receipt){return receipt.ownerInstanceId!==this.instanceId&&processIsLive(receipt.ownerPid);}
  async request({account,requestId,mode='signin',confirmed=false,reauthenticate=false}) {
    if(!account||!profileId(account.id)||!/^\S+@\S+\.\S+$/.test(account.email||'')||!validId(requestId)
      ||!['signin','verify'].includes(mode)||mode==='signin'&&confirmed!==true)throw rejected('Choose an account and explicitly connect its subscription sign-in.');
    if(this.stopping)throw Error('Account connection is restarting. Retry this same request after reconnecting.');
    if(reauthenticate!==false&&(reauthenticate!==true||mode!=='signin'))throw rejected('Reconnecting an account requires an explicit sign-in action.');
    const hash=fingerprint({accountId:account.id,email:account.email,mode,reauthenticate});let launch=false;
    const receipt=await this.transaction(async(state,save)=>{
      const old=state.requests[requestId];
      if(old){if(old.fingerprint!==hash)throw rejected('That sign-in request ID belongs to another account action.');return this.publicReceipt(old.targetRequestId?state.requests[old.targetRequestId]:old);}
      // One browser ceremony at a time because the installed CLI owns a local
      // callback listener. Other profiles remain authenticated and untouched.
      const pending=Object.values(state.requests).find(r=>active.has(r.status));
      if(pending){
        const running=this.tasks.has(pending.requestId)||this.otherLiveOwner(pending);
        if(pending.fingerprint===hash&&running){
          state.requests[requestId]={requestId,fingerprint:hash,accountId:account.id,mode:'alias',status:'alias',targetRequestId:pending.requestId};
          await save();return this.publicReceipt(pending);
        }
        if(running)throw rejected('Finish or cancel the open Codex sign-in first.');
        if(mode==='signin')throw rejected('Check saved sign-in first. An interrupted login must be reconciled before another browser flow.');
        pending.status='needs_check';pending.reason=safeFailure;
      }
      let profile=state.profiles[account.id];
      if(profile&&profile.email!==account.email)throw rejected('This account entry no longer matches its saved sign-in.');
      profile||={accountId:account.id,email:account.email,authentication:'needs_sign_in',accountKey:null};
      const entry={requestId,fingerprint:hash,accountId:account.id,mode,reauthenticate,status:'checking',
        ownerPid:process.pid,ownerInstanceId:this.instanceId,
        startedAt:new Date(this.clock()).toISOString(),reason:'Checking the separate Codex authorization.'};
      profile.operationId=requestId;state.profiles[account.id]=profile;state.requests[requestId]=entry;
      await save();launch=true;return structuredClone(entry);
    });
    if(launch){
      const task=this.run(receipt).finally(()=>{this.tasks.delete(receipt.requestId);this.connections.delete(receipt.requestId);});
      this.tasks.set(receipt.requestId,task);
      // Request acceptance is durable; the service keeps the ceremony alive
      // when the phone or settings sheet disconnects. Errors go to the receipt.
      task.catch(()=>{});
    }
    return receipt;
  }
  async update(id,fn){return this.transaction(async(state,save)=>{const r=state.requests[id],p=state.profiles[r.accountId];await fn(r,p);await save();return structuredClone(r);});}
  async run(receipt) {
    let connection,claim,login,timer;
    try {
      claim=await this.lease(this.root,{threadId:'account-login-runner',requestId:'runner',timeoutMs:250});
      const profile=await this.transaction(state=>structuredClone(state.profiles[receipt.accountId]));
      const home=path.join(this.root,'profiles',receipt.accountId);
      connection=this.createProcess({home,binary:this.binary});this.connections.set(receipt.requestId,{connection});
      timer=setTimeout(()=>{login?.disconnected();connection.close();},this.timeoutMs);
      await connection.connect();
      let cancelled=await this.transaction(s=>s.requests[receipt.requestId].cancelRequested===true);
      if(cancelled||this.stopping)throw Error('Connection cancelled');
      login=new CodexManagedLogin({isolated:true,rpc:(...args)=>connection.request(...args),subscribe:fn=>connection.subscribe(message=>{
        if(message.method==='clawdad/accountConnectionClosed')login.disconnected();else fn(message);
      }),handoff:async info=>{
        const current=await this.update(receipt.requestId,r=>{r.loginId=login.snapshot().loginId;r.status='awaiting_user';r.reason=`Finish signing in as ${profile.email} in the Mac browser.`;});
        if(current.cancelRequested||this.stopping){await login.cancel();return;}
        await this.open(info);
      }});
      this.connections.set(receipt.requestId,{connection,login});
      const existing=await connection.request('account/read',{refreshToken:false});
      let identity;
      if(existing.account&&!receipt.reauthenticate)identity=await login.identity(profile.email);
      else if(receipt.mode==='verify') {
        await this.update(receipt.requestId,(r,p)=>{r.status='needs_sign_in';r.reason='No retained subscription sign-in is available. Connect this account on the Mac.';p.authentication='needs_sign_in';});return;
      } else {
        const updated=await this.update(receipt.requestId,r=>{r.status='starting';r.dispatchedAt=new Date(this.clock()).toISOString();r.reason='Opening supported Codex sign-in on the Mac.';});
        if(updated.cancelRequested||this.stopping)throw Error('Connection cancelled');
        identity=await login.start({requestId:receipt.requestId,email:profile.email,confirmed:true});
      }
      await connection.verifyStorage();
      await this.update(receipt.requestId,(r,p)=>{
        if(p.accountKey&&p.accountKey!==identity.accountKey){p.authentication='identity_changed';r.status='needs_attention';r.reason='This saved sign-in now reports a different allowance/workspace identity. Review it before using it.';return;}
        const verifiedAt=new Date(this.clock()).toISOString();
        p.accountKey=identity.accountKey;p.authentication='verified';p.verifiedAt=verifiedAt;
        p.subscription=identity.subscription;p.remainingPercent=identity.remainingPercent;p.resetsAt=identity.resetsAt;
        p.ordinaryUsageAllowed=identity.ordinaryUsageAllowed;
        r.status='verified';r.completedAt=verifiedAt;r.reason='Subscription sign-in retained in Keychain. Existing agents have not been switched.';
      });
    } catch(error) {
      await this.update(receipt.requestId,(r,p)=>{r.status='needs_check';r.reason=r.cancelRequested?
        'Sign-in cancelled. Check saved sign-in to determine whether authorization completed before cancellation.':
        error.code==='selected_account_mismatch'?'The browser signed into a different account. Reconnect and choose the email shown here.':safeFailure;
        if(p.authentication==='verified')p.authentication='needs_check';}).catch(()=>{});
    } finally {clearTimeout(timer);login?.disconnected();connection?.close();await claim?.release();}
  }
  async cancel({operationId,requestId}) {
    if(!validId(requestId)||!validId(operationId))throw rejected('Choose the exact sign-in to cancel.');
    const result=await this.transaction(async(state,save)=>{
      const operation=state.requests[operationId];if(!operation)throw rejected('That sign-in was not found.');
      const hash=fingerprint({operationId,mode:'cancel'}),old=state.requests[requestId];
      if(old){if(old.fingerprint!==hash)throw rejected('That request ID belongs to another sign-in action.');return {receipt:structuredClone(old),dispatch:false};}
      operation.cancelRequested=true;
      if(active.has(operation.status)){operation.status='cancelling';operation.reason='Stopping the separate sign-in connection.';}
      const receipt={requestId,fingerprint:hash,accountId:operation.accountId,mode:'cancel',status:'accepted',operationId};state.requests[requestId]=receipt;await save();return {receipt,dispatch:true};
    });
    if(!result.dispatch)return result.receipt;
    const activeConnection=this.connections.get(operationId);
    if(activeConnection?.login?.snapshot()?.loginId)await activeConnection.login.cancel().catch(()=>{});
    activeConnection?.connection.close();
    return result.receipt;
  }
  async close(){this.stopping=true;for(const {connection,login} of this.connections.values()){login?.disconnected();connection.close();}await Promise.allSettled(this.tasks.values());}
}
