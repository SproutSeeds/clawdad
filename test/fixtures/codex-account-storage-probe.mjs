// Read-only installed-runtime probe. No login, logout, tokens, thread operations
// or model calls. Run explicitly; this is not part of npm test.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';

const base=path.resolve(process.argv[2]||'');
if(!path.basename(base).startsWith('account-storage-probe-'))throw Error('Use an explicit isolated probe directory.');
await fs.mkdir(base,{recursive:false,mode:0o700});
const binary=process.argv[3]||'/opt/homebrew/bin/codex';
const baseline=async()=>{try{const s=await fs.stat(path.join(os.homedir(),'.codex/auth.json'));return {size:s.size,mtimeMs:s.mtimeMs,ino:s.ino,mode:s.mode};}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const before=await baseline();
const records=[];
async function probe(mode) {
  const profile=path.join(base,mode);await fs.mkdir(profile,{mode:0o700});
  const env=Object.fromEntries(['PATH','HOME','USER','LOGNAME','TMPDIR','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  // This is Codex's documented child-process home setting, never a shell/global
  // preference change. No production history, config or credentials are linked.
  env.CODEX_HOME=profile;
  const args=['app-server','--stdio','-c',`cli_auth_credentials_store="${mode}"`];
  const child=spawn(binary,args,{cwd:profile,env,stdio:['pipe','pipe','ignore']});
  const lines=createInterface({input:child.stdout});const pending=new Map();let id=0,count=0;
  const methods=[];
  const fail=()=>{for(const p of pending.values())p.reject(Error('Isolated account read did not complete'));pending.clear();};
  child.on('error',fail);child.on('exit',fail);child.stdin.on('error',fail);
  lines.on('line',line=>{
    count+=line.length;if(count>1024*1024){fail();child.kill();return;}
    try {const m=JSON.parse(line),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error('Isolated RPC rejected')):p.resolve(m.result);}}
    catch {fail();}
  });
  const timer=setTimeout(()=>{fail();child.kill();},15000);
  const rpc=(method,params={})=>new Promise((resolve,reject)=>{methods.push(method);const next=++id;pending.set(next,{resolve,reject});child.stdin.write(JSON.stringify({id:next,method,params})+'\n');});
  try {
    const init=await rpc('initialize',{clientInfo:{name:'clawdad_account_storage_probe',version:'1'}});
    child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
    const config=await rpc('config/read',{cwd:profile,includeLayers:false});
    const auth=await rpc('account/read',{refreshToken:false});
    if(auth.account!==null)throw Error('The empty isolated profile unexpectedly has an account. Stop before authentication.');
    const record={mode,profile,methods,accountAbsent:true,reportedStore:config.config?.cli_auth_credentials_store??null,
      userAgent:init.userAgent??null,authFilePresent:await fs.stat(path.join(profile,'auth.json')).then(()=>true,()=>false),
      expectedDirectKeyringNamespace:'cli|'+createHash('sha256').update(await fs.realpath(profile)).digest('hex').slice(0,16)};
    records.push(record);
  }finally{clearTimeout(timer);lines.close();child.stdin.end();child.kill();}
}
try {
  await probe('file');await probe('keyring');
  const after=await baseline();
  const report={version:1,at:new Date().toISOString(),binary,productionAuthMetadataUnchanged:JSON.stringify(before)===JSON.stringify(after),
    profiles:records,loginAttempted:false,modelCalled:false,limits:'Empty-profile reads establish lookup isolation only. No Keychain write, token refresh or cross-account history resume was tested.'};
  if(!report.productionAuthMetadataUnchanged)throw Error('Production auth metadata changed concurrently; stop and inspect before interpreting the probe.');
  await fs.writeFile(path.join(base,'evidence.json'),JSON.stringify(report,null,2),{mode:0o600});
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
} catch(error) {
  process.stderr.write(error.message+'\n');process.exitCode=1;
}
