import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {acquireCodexAccountClaim as acquireCodexDeliveryClaim} from './codex-account-claim.mjs';
import {researchSave} from './research-budget.mjs';

// Authorization homes remain distinct. These are shared *work* resources, not
// credentials. In particular writer locks must follow history across homes.
// A shared SQLite index alone cannot resolve paginated/forked rollout ancestors.
export const accountSharedResources=Object.freeze([
  'sessions','archived_sessions','attachments','thread-writer-locks',
  'config.toml','AGENTS.md','rules','skills','memories','hooks','hooks.json','plugins',
]);
const requiredDirectories=new Set(['sessions','archived_sessions','thread-writer-locks']);
const digest=value=>createHash('sha256').update(JSON.stringify(value)??'undefined').digest('hex');
const invalid=(code,message)=>Object.assign(Error(message),{code});
const pathValue=value=>typeof value==='string'&&path.isAbsolute(value)&&path.normalize(value)===value&&!/[\x00-\x1f\x7f]/.test(value);
const present=async file=>fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});

async function ownedDirectory(directory,{privateOnly=false}={}){
  if(!pathValue(directory))throw invalid('invalid_runtime_path','The Codex runtime directory needs an exact absolute path.');
  const stat=await fs.lstat(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(directory)!==directory||stat.uid!==process.getuid()
    ||stat.mode&(privateOnly?0o077:0o022))throw invalid('unsafe_runtime_directory','The Codex runtime directory ownership or permissions changed.');
}

// Planning is read-only and never examines auth.json, Keychain values, model
// cache contents, shell history, or a user's transcript text.
export async function inspectCodexAccountLayoutCandidates({canonicalHome,profileHome,sqliteHome=canonicalHome}){
  await ownedDirectory(canonicalHome);await ownedDirectory(profileHome,{privateOnly:true});await ownedDirectory(sqliteHome);
  if(canonicalHome===profileHome||canonicalHome.startsWith(profileHome+path.sep)||profileHome.startsWith(canonicalHome+path.sep))
    throw invalid('overlapping_runtime_homes','Use separate authorization and canonical history directories.');
  const names=[...new Set([...(await fs.readdir(canonicalHome)),...(await fs.readdir(profileHome))])];
  const selected=[...accountSharedResources,...names.filter(name=>/^[A-Za-z0-9_.-]+\.config\.toml$/.test(name))].sort();
  const entries=[],conflicts=[];
  for(const name of selected){
    const source=path.join(canonicalHome,name),destination=path.join(profileHome,name),stat=await present(source);
    if(!stat){
      if(requiredDirectories.has(name))throw invalid('missing_canonical_history','The canonical history and writer-lock directories must exist before account adoption.');
      // An independent profile resource would shadow absence in the source.
      if(await present(destination))conflicts.push(name);
      continue;
    }
    const target=await fs.realpath(source),actual=await fs.stat(source);
    if(target===profileHome||target.startsWith(profileHome+path.sep))
      throw invalid('cyclic_runtime_resource','A canonical work resource resolves into the account profile. Review that layout before adoption.');
    if((!actual.isDirectory()&&!actual.isFile())||actual.uid!==process.getuid()||(actual.mode&0o022))
      throw invalid('unsafe_shared_resource',`The canonical ${name} resource needs verified local ownership.`);
    if(requiredDirectories.has(name)&&!actual.isDirectory())throw invalid('invalid_canonical_history',`The canonical ${name} resource must be a directory.`);
    const existing=await present(destination);
    if(existing&&(!existing.isSymbolicLink()||await fs.readlink(destination)!==source||await fs.realpath(destination).catch(()=>null)!==target))
      conflicts.push(name);
    entries.push({name,source,target,kind:actual.isDirectory()?'directory':'file',device:actual.dev,inode:actual.ino});
  }
  const plan={version:1,canonicalHome,profileHome,sqliteHome,entries};
  return {plan:{...plan,fingerprint:digest(plan)},conflicts};
}

export async function inspectCodexAccountLayout(input){
  const {plan,conflicts}=await inspectCodexAccountLayoutCandidates(input);
  if(conflicts.length)throw invalid('profile_resource_conflict',`The saved sign-in has independent ${conflicts.join(', ')} resources. Review their recoverable adoption before switching. Nothing was replaced.`);
  return plan;
}

export class CodexAccountLayout {
  constructor({root,lease=acquireCodexDeliveryClaim}={}){Object.assign(this,{root,lease});}
  async prepare(input){
    await ownedDirectory(this.root,{privateOnly:true});
    const claim=await this.lease(this.root,{threadId:'account-runtime-layout',requestId:'layout',timeoutMs:5000});
    try{
      const plan=await inspectCodexAccountLayout(input);
      const file=path.join(this.root,'runtime-layout-'+digest(plan.profileHome)+'.json');
      let receipt;try{receipt=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw invalid('layout_receipt_invalid','The runtime layout receipt needs recovery.');}
      if(receipt&&(receipt.version!==1||receipt.plan?.fingerprint!==plan.fingerprint))
        throw invalid('layout_changed','The canonical runtime layout changed. Review the original adoption receipt before changing it.');
      receipt||={version:1,plan,state:'preparing',links:{}};
      // Record intent before any link; after a crash, inspect exact existing
      // targets. symlink is exclusive: it cannot overwrite a concurrent change.
      await researchSave(file,receipt);
      for(const entry of plan.entries){
        await fs.symlink(entry.source,path.join(plan.profileHome,entry.name),entry.kind==='directory'?'dir':'file')
          .catch(async error=>{
            if(error.code!=='EEXIST')throw error;
            if(await fs.readlink(path.join(plan.profileHome,entry.name)).catch(()=>null)!==entry.source)
              throw invalid('profile_resource_conflict','A runtime resource changed during adoption. Existing work was preserved.');
          });
        receipt.links[entry.name]='verified';await researchSave(file,receipt);
      }
      const current=await inspectCodexAccountLayout(input);
      if(current.fingerprint!==plan.fingerprint)throw invalid('layout_changed','The canonical runtime changed during adoption. Reconcile its saved receipt.');
      const directory=await fs.open(plan.profileHome,'r');try{await directory.sync();}finally{await directory.close();}
      receipt.state='verified';await researchSave(file,receipt);
      const store=await fs.open(this.root,'r');try{await store.sync();}finally{await store.close();}
      return structuredClone(receipt);
    }finally{await claim.release();}
  }
  async verify(receipt){
    if(receipt?.state!=='verified'||receipt.version!==1)throw invalid('layout_unverified','Verify the account runtime layout before launching a consumer.');
    const current=await inspectCodexAccountLayout(receipt.plan);
    if(current.fingerprint!==receipt.plan.fingerprint)throw invalid('layout_changed','The saved runtime layout changed before launch. Inspect it again.');
    for(const entry of current.entries)if(await fs.readlink(path.join(current.profileHome,entry.name)).catch(()=>null)!==entry.source)
      throw invalid('layout_incomplete','A shared runtime resource is missing. Reconcile the saved layout before launching.');
    return current;
  }
}

// Normalize aliases only when they actually resolve to the same local object.
// Config values never enter the journal/logs; return fingerprints plus changed
// field names. Permissions, provider, hooks and tool settings are compared too.
async function canonicalConfiguration(value){
  if(Array.isArray(value))return Promise.all(value.map(v=>canonicalConfiguration(v)));
  if(value&&typeof value==='object'){
    const rows=await Promise.all(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(async([k,v])=>[k,await canonicalConfiguration(v)]));
    return Object.fromEntries(rows);
  }
  if(typeof value==='string'&&pathValue(value))return fs.realpath(value).catch(()=>value);
  return value;
}

export async function compareAccountRuntimeConfiguration(before,after){
  if(!before||!after||typeof before!=='object'||typeof after!=='object')throw invalid('configuration_unavailable','Both effective runtime configurations must be observed.');
  const source=await canonicalConfiguration(before),destination=await canonicalConfiguration(after);
  // Only the intentional credential-store change is exempt. History paths,
  // sandbox, approvals, provider and managed workspace requirements are not.
  for(const value of [source,destination])delete value.cli_auth_credentials_store;
  const fields=[...new Set([...Object.keys(source),...Object.keys(destination)])].sort();
  const changed=fields.filter(field=>digest(source[field])!==digest(destination[field]));
  return {equivalent:changed.length===0,changedFields:changed,sourceHash:digest(source),destinationHash:digest(destination)};
}

export function accountRuntimeLaunchOptions({layout,baseEnvironment={},arguments:args=[]}){
  if(layout?.state!=='verified'||!pathValue(layout.plan?.profileHome)||!pathValue(layout.plan?.sqliteHome))
    throw invalid('layout_unverified','Verify account history and configuration before launching.');
  // Explicit per-child selection; never change the host's environment. Reject
  // conflicting routes instead of stripping one and silently selecting another.
  for(const name of ['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','OPENAI_BASE_URL'])
    if(baseEnvironment[name])throw invalid('alternate_authentication_present','This consumer has an explicit API/token/provider override. Review that runtime before subscription switching.');
  if(!Array.isArray(args)||!args.every(arg=>typeof arg==='string'&&!arg.includes('\0')))throw invalid('invalid_launch_arguments','The original Codex launch arguments are unavailable.');
  if(args.includes('--')||args.some(arg=>arg==='--remote'||arg.startsWith('--remote=')||arg==='--oss'||arg==='--local-provider'||arg.startsWith('--local-provider=')))
    throw invalid('unsupported_launch_mode','This launch cannot verify local subscription selection. Preserve its existing runtime and review the launch mode.');
  const overrides=['-c','cli_auth_credentials_store="keyring"','-c',`sqlite_home=${JSON.stringify(layout.plan.sqliteHome)}`];
  return {env:{...baseEnvironment,CODEX_HOME:layout.plan.profileHome},arguments:[...args,...overrides]};
}
