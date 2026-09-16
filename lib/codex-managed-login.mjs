import {normalizeWeeklyUsage} from './codex-weekly-usage.mjs';

// Supported account RPC adapter. The caller must own a verified isolated Codex
// process. This module never spawns/restarts a consumer, reads credentials or
// supplies tokens. URLs and device codes go only to a transient user handoff.
export class CodexManagedLogin {
  constructor({rpc,subscribe,handoff,isolated=false,accountReadyTimeoutMs=10_000}) {
    Object.assign(this,{rpc,subscribe,handoff,isolated,accountReadyTimeoutMs});this.current=null;this.running=null;this.calls=new Map();
  }
  async identity(expectedEmail) {
    const before=await this.rpc('account/read',{refreshToken:false});
    if(!before.account)throw Object.assign(Error('Codex has not exposed the saved account yet. Check the saved sign-in before starting another login.'),{code:'account_state_pending'});
    if(before.account?.type!=='chatgpt'||before.account.email?.toLowerCase()!==expectedEmail.toLowerCase())
      throw Object.assign(Error('The selected subscription account is not signed in to this isolated profile.'),{code:'selected_account_mismatch'});
    const limits=await this.rpc('account/rateLimits/read');
    const after=await this.rpc('account/read',{refreshToken:false});
    if(JSON.stringify(before.account)!==JSON.stringify(after.account))throw Error('Account identity changed during verification.');
    return normalizeWeeklyUsage(limits,{account:after.account});
  }
  start({requestId,email,method='chatgpt',confirmed=false}) {
    if(!this.isolated||confirmed!==true||!['chatgpt','chatgptDeviceCode'].includes(method))
      return Promise.reject(Error('A user-approved isolated subscription sign-in is required.'));
    const fingerprint=JSON.stringify({requestId,email,method});
    const prior=this.calls.get(requestId);
    if(prior)return prior.fingerprint===fingerprint?prior.promise:Promise.reject(Error('That sign-in request ID belongs to a different selection.'));
    if(this.running) {
      if(this.current.fingerprint!==fingerprint)return Promise.reject(Error('Finish or cancel the current sign-in first.'));
      return this.running;
    }
    const state={requestId,email,method,fingerprint,loginId:null,status:'starting'};this.current=state;
    // Register first: a completion may arrive adjacent to the login response.
    const early=[];let finish,finishReady,sequence=0,latestUpdate=0,completionSequence=0,readyTimer;
    const completed=new Promise(resolve=>finish=resolve);
    const accountReady=new Promise(resolve=>finishReady=resolve);
    const unsubscribe=this.subscribe(message=>{
      const ordinal=++sequence;
      // Codex 0.154.0 sends login/completed before reloading AuthManager.
      // account/updated follows that reload. A completion callback alone is
      // therefore insufficient evidence that account/read sees the new login.
      if(message.method==='account/updated'&&message.params?.authMode==='chatgpt'){
        latestUpdate=ordinal;if(completionSequence&&ordinal>completionSequence)finishReady(true);return;
      }
      if(message.method!=='account/login/completed')return;
      const result={...(message.params||{}),ordinal};
      if(!state.loginId&&early.length<32)early.push(result);
      else if(result.loginId===state.loginId)finish(result);
    });
    this.running=(async()=>{
      try {
        const login=await this.rpc('account/login/start',{type:method});
        if(login.type!==method||typeof login.loginId!=='string')throw Error('Codex did not return a supported sign-in.');
        state.loginId=login.loginId;state.status='awaiting_user';
        const url=new URL(method==='chatgpt'?login.authUrl:login.verificationUrl);
        if(url.protocol!=='https:'||!['auth.openai.com','auth.chatgpt.com','chatgpt.com'].includes(url.hostname))
          throw Error('Codex returned an unexpected authentication destination.');
        if(early.some(r=>r.loginId===state.loginId))finish(early.find(r=>r.loginId===state.loginId));
        await this.handoff({url:url.href,userCode:method==='chatgptDeviceCode'?login.userCode:null,email});
        const result=await completed;
        if(result.success!==true)throw Error('Sign-in did not complete. This profile requires another user-owned sign-in.');
        completionSequence=result.ordinal;state.status='verifying';
        if(latestUpdate>completionSequence)finishReady(true);
        readyTimer=setTimeout(()=>finishReady(false),this.accountReadyTimeoutMs);
        if(!await accountReady)throw Object.assign(Error('The saved account has not finished loading. Check saved sign-in before another login.'),{code:'account_state_pending'});
        const identity=await this.identity(email);state.status='verified';
        return {status:'verified',requestId,loginId:state.loginId,...identity};
      }catch(error){state.status='needs_attention';throw Object.assign(Error('Subscription sign-in needs attention. Verify the selected account and supported sign-in prompt.'),
        {code:['selected_account_mismatch','account_state_pending'].includes(error.code)?error.code:'signin_needs_check'});}
      finally{clearTimeout(readyTimer);unsubscribe();this.running=null;}
    })();
    state.finish=finish;state.finishReady=finishReady;
    this.calls.set(requestId,{fingerprint,promise:this.running});
    return this.running;
  }
  snapshot() {
    const s=this.current;return s?{requestId:s.requestId,email:s.email,method:s.method,loginId:s.loginId,status:s.status}:null;
  }
  async cancel() {
    const s=this.current;if(!s?.loginId)throw Error('Sign-in is still starting. Reconcile its login ID before cancelling.');
    await this.rpc('account/login/cancel',{loginId:s.loginId});
    // A cancellation acknowledgement does not prove credentials stayed unchanged.
    s.finish({loginId:s.loginId,success:false});s.finishReady(false);
    return {status:'cancelled_needs_identity_check',loginId:s.loginId};
  }
  disconnected() { this.current?.finish?.({success:false});this.current?.finishReady?.(false); }
}
