import {normalizeWeeklyUsage} from './codex-weekly-usage.mjs';

// Supported account RPC adapter. The caller must own a verified isolated Codex
// process. This module never spawns/restarts a consumer, reads credentials or
// supplies tokens. URLs and device codes go only to a transient user handoff.
export class CodexManagedLogin {
  constructor({rpc,subscribe,handoff,isolated=false}) {
    Object.assign(this,{rpc,subscribe,handoff,isolated});this.current=null;this.running=null;this.calls=new Map();
  }
  async identity(expectedEmail) {
    const before=await this.rpc('account/read',{refreshToken:false});
    if(before.account?.type!=='chatgpt'||before.account.email?.toLowerCase()!==expectedEmail.toLowerCase())
      throw Error('The selected subscription account is not signed in to this isolated profile.');
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
    const early=[];let finish;
    const completed=new Promise(resolve=>finish=resolve);
    const unsubscribe=this.subscribe(message=>{
      if(message.method!=='account/login/completed')return;
      const result=message.params||{};
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
        const identity=await this.identity(email);state.status='verified';
        return {status:'verified',requestId,loginId:state.loginId,...identity};
      }catch(error){state.status='needs_attention';throw Error('Subscription sign-in needs attention. Verify the selected account and supported sign-in prompt.');}
      finally{unsubscribe();this.running=null;}
    })();
    state.finish=finish;
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
    s.finish({loginId:s.loginId,success:false});
    return {status:'cancelled_needs_identity_check',loginId:s.loginId};
  }
  disconnected() { this.current?.finish?.({success:false}); }
}
