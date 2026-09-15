// Run only after review of reports/codex-account-switch-live-plan-2026-09-15.md.
// This account-only fixture cannot run a model, resume a thread or touch the
// production Codex home. Browser/MFA interaction remains with the user.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {CodexManagedLogin} from '../../lib/codex-managed-login.mjs';
import {researchSave} from '../../lib/research-budget.mjs';
import {acquireCodexDeliveryClaim} from '../../lib/codex-delivery-claim.mjs';

const [mode,profileName,email,requestId,approval]=process.argv.slice(2);
if(!['signin','verify'].includes(mode)||!['cody','sun'].includes(profileName)
  ||!/^\S+@\S+\.\S+$/.test(email||'')||!/^account-check-[a-z0-9-]+$/.test(requestId||'')
  ||approval!=='--user-approved-isolated-signin')
  throw Error('Use the reviewed isolated account-check arguments and explicit user approval.');
const base=path.join(os.homedir(),'Library/Application Support/ClawDad/Accounts/verification-2026-09-15');
await fs.mkdir(base,{recursive:true,mode:0o700});
if(await fs.realpath(base)!==base)throw Error('The test profile must be a real internal-drive directory.');
const profile=path.join(base,profileName);
await fs.mkdir(profile,{recursive:true,mode:0o700});
const stat=await fs.lstat(profile);
if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0)
  throw Error('The test profile needs private directory ownership.');
const claim=await acquireCodexDeliveryClaim(base,{threadId:'isolated-authentication',requestId,timeoutMs:250});
const evidence=path.join(base,`${profileName}-check.json`);
const authMetadata=async()=>{try{const s=await fs.stat(path.join(os.homedir(),'.codex/auth.json'));return {size:s.size,mtimeMs:s.mtimeMs,ino:s.ino};}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const baseline=await authMetadata();
let previous;try{previous=JSON.parse(await fs.readFile(evidence,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const env=Object.fromEntries(['PATH','HOME','USER','LOGNAME','TMPDIR','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
env.CODEX_HOME=profile;
const child=spawn('/opt/homebrew/bin/codex',['app-server','--stdio','-c','cli_auth_credentials_store="keyring"'],{cwd:profile,env,stdio:['pipe','pipe','ignore']});
const pending=new Map(),listeners=new Set(),lines=createInterface({input:child.stdout});let nextId=0,bytes=0,closed=false;
const methods=[];
const allowed=new Set(['initialize','config/read','account/read','account/rateLimits/read','account/login/start','account/login/cancel']);
const fail=()=>{closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Isolated account connection ended.'));}pending.clear();login.disconnected();};
const rpc=(method,params={})=>new Promise((resolve,reject)=>{
  if(!allowed.has(method)||closed)return reject(Error('Only supported account operations are available in this check.'));
  const id=++nextId;
  const timer=setTimeout(()=>{pending.delete(id);reject(Error('Account response timed out; reconcile before retrying.'));},30_000);
  pending.set(id,{resolve,reject,timer});methods.push(method);
  child.stdin.write(JSON.stringify({id,method,params})+'\n');
});
const login=new CodexManagedLogin({rpc,isolated:true,subscribe:callback=>{listeners.add(callback);return()=>listeners.delete(callback);},
  handoff:async({url})=>{
    // The OAuth URL is transient: no stdout, journal, file or provider-body log.
    await new Promise((resolve,reject)=>{const opener=spawn('/usr/bin/open',[url],{stdio:'ignore'});opener.on('error',()=>reject(Error('Open the supported sign-in flow from this Mac.')));opener.on('exit',code=>code===0?resolve():reject(Error('Browser handoff unavailable.')));});
    process.stdout.write(JSON.stringify({state:'awaiting_user',email,profileName})+'\n');
  }});
child.on('error',fail);child.on('exit',fail);child.stdin.on('error',fail);
lines.on('line',line=>{
  bytes+=line.length;if(bytes>4*1024*1024){fail();child.kill();return;}
  try {
    const message=JSON.parse(line),p=pending.get(message.id);
    if(p){pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error('Supported account operation was rejected.')):p.resolve(message.result);}
    else if(message.id!=null&&message.method)child.stdin.write(JSON.stringify({id:message.id,error:{code:-32601,message:'Account-only check'}})+'\n');
    else for(const callback of listeners)callback(message);
  }catch{fail();}
});
const timeout=setTimeout(()=>{login.disconnected();child.kill();},10*60_000);
try {
  const initialized=await rpc('initialize',{clientInfo:{name:'clawdad_isolated_account_check',version:'1'}});
  child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
  const config=await rpc('config/read',{cwd:profile,includeLayers:false});
  if(config.config?.cli_auth_credentials_store!=='keyring')throw Error('The isolated profile did not select the OS credential store.');
  const account=await rpc('account/read',{refreshToken:false});
  const record={version:1,requestId,email,profileName,profile,mode,at:new Date().toISOString(),userAgent:initialized.userAgent,
    expectedKeyringNamespace:'cli|'+createHash('sha256').update(profile).digest('hex').slice(0,16),state:'checking'};
  let identity;
  if(account.account)identity=await login.identity(email);
  else {
    if(mode!=='signin')throw Error('No saved subscription authorization was found in this profile.');
    if(previous)throw Error('An earlier sign-in receipt exists. Review its uncertain outcome before authorizing a new login.');
    record.state='login_requested';await researchSave(evidence,record);
    identity=await login.start({requestId,email,method:'chatgpt',confirmed:true});
  }
  const authFilePresent=await fs.stat(path.join(profile,'auth.json')).then(()=>true,()=>false);
  const unchanged=JSON.stringify(baseline)===JSON.stringify(await authMetadata());
  if(authFilePresent||!unchanged)throw Error('Credential isolation evidence changed; preserve state and review before proceeding.');
  Object.assign(record,{state:'verified',accountKey:identity.accountKey,subscription:identity.subscription,remainingPercent:identity.remainingPercent,
    resetsAt:identity.resetsAt,ordinaryUsageAllowed:identity.ordinaryUsageAllowed,productionAuthMetadataUnchanged:unchanged,
    authFilePresent,modelCalled:false,methods});
  await researchSave(evidence,record);
  process.stdout.write(JSON.stringify(record,null,2)+'\n');
}catch{
  // No raw provider errors, OAuth URLs, user codes or credentials are persisted.
  process.stderr.write('Isolated verification needs attention. The existing receipt is retained; no production session was switched.\n');
  process.exitCode=1;
}finally{
  clearTimeout(timeout);for(const p of pending.values())clearTimeout(p.timer);
  lines.close();child.stdin.end();child.kill();await claim.release();
}
