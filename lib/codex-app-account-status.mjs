import {CodexSharedClient} from './codex-thread-control.mjs';
import {normalizeWeeklyUsage} from './codex-weekly-usage.mjs';

// Observe the process that owns app threads. Never launch an account probe
// with Terminal's default credentials or substitute a cached preview account.
export class CodexAppAccountStatus {
  constructor({socketPath,createClient=options=>new CodexSharedClient(options),clock=Date.now,cacheMs=1500}={}) {
    Object.assign(this,{socketPath,createClient,clock,cacheMs});
  }
  invalidate(){this.cached=null;}
  async read({fresh=false}={}) {
    if(!fresh&&this.cached&&this.clock()-this.cached.at<this.cacheMs)return structuredClone(this.cached.value);
    if(this.pending)return this.pending;
    this.pending=this.observe().finally(()=>{this.pending=null;});
    return this.pending;
  }
  async observe(){
    const client=this.createClient({socketPath:this.socketPath,timeoutMs:5000});
    try{
      const before=await client.request('account/read',{refreshToken:false});
      if(before.account?.type!=='chatgpt')throw Error('Choose and activate a saved ChatGPT account for ClawDad.');
      let limits;
      try{limits=await client.request('account/rateLimits/read');}catch{}
      const after=await client.request('account/read',{refreshToken:false});
      if(JSON.stringify(before.account)!==JSON.stringify(after.account))throw Error('The app account changed during verification. Check it again.');
      if(!limits){
        const value={method:'chatgpt',email:after.account.email,plan:after.account.planType,accountKey:null,
          authorizationHome:client.info?.codexHome,status:'needs_check',source:'app-server',observedAt:new Date(this.clock()).toISOString(),usage:null,
          message:'The app server reports this account, but its subscription could not be verified. Activate a verified saved account.'};
        this.cached={at:this.clock(),value};return structuredClone(value);
      }
      const usage=normalizeWeeklyUsage(limits,{account:after.account});
      const value={...usage.subscription,accountKey:usage.accountKey,authorizationHome:client.info?.codexHome,
        status:'current',source:'app-server',observedAt:new Date(this.clock()).toISOString(),usage};
      this.cached={at:this.clock(),value};return structuredClone(value);
    }finally{client.close();}
  }
}

export async function verifyAppAccountRuntime({socketPath,launch,reader=new CodexAppAccountStatus({socketPath})}){
  const current=await reader.read({fresh:true});
  if(current.authorizationHome!==launch.env.CODEX_HOME||current.accountKey!==launch.account.key)
    throw Object.assign(Error('The running ClawDad server does not match the selected account. Activate the account again to reconcile it.'),{code:'app_account_mismatch'});
  return current;
}
