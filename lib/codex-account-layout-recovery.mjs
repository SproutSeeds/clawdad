import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CodexAccountLayout,inspectCodexAccountLayoutCandidates,accountSharedResources} from './codex-account-layout.mjs';
import {privateAccountDirectory} from './codex-account-profile-process.mjs';
import {claimAccountProfile} from './codex-account-profile-guard.mjs';
import {acquireCodexDeliveryClaim} from './codex-delivery-claim.mjs';
import {researchSave} from './research-budget.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure=(code,message)=>Object.assign(Error(message),{code});
const present=file=>fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
const requestId=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const exactPath=value=>typeof value==='string'&&path.isAbsolute(value)&&path.normalize(value)===value&&!/[\x00-\x1f\x7f]/.test(value);
const nameAllowed=name=>typeof name==='string'&&(accountSharedResources.includes(name)||/^[A-Za-z0-9_.-]+\.config\.toml$/.test(name));
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const unique=values=>new Set(values).size===values.length;
function validRecord(record,home){
  try {
    const s=record.selection,p=s.plan,{fingerprint:pf,...plan}=p,{fingerprint:sf,...selection}=s;
    if(record.version!==1||!['preparing','linking','verified','rolling_back','rolled_back'].includes(record.state)
      ||!Array.isArray(record.requests)||!record.requests.length||!record.requests.every(requestId)||!unique(record.requests)
      ||s.version!==1||p.version!==1||p.profileHome!==home||![p.profileHome,p.canonicalHome,p.sqliteHome].every(exactPath)
      ||p.profileHome===p.canonicalHome||p.profileHome.startsWith(p.canonicalHome+path.sep)||p.canonicalHome.startsWith(p.profileHome+path.sep)
      ||!digest(pf)||hash(plan)!==pf||!digest(sf)||hash(selection)!==sf||!Array.isArray(p.entries)
      ||!Array.isArray(s.displaced)||!Array.isArray(s.retainedLinks)||!unique(p.entries.map(e=>e.name))
      ||!unique(s.displaced.map(e=>e.name))||!unique(s.retainedLinks))return false;
    for(const e of p.entries)if(!nameAllowed(e.name)||e.source!==path.join(p.canonicalHome,e.name)||!exactPath(e.target)
      ||!['directory','file'].includes(e.kind)||![e.device,e.inode].every(Number.isSafeInteger))return false;
    for(const e of s.displaced)if(!nameAllowed(e.name)||!['directory','file','link'].includes(e.evidence?.kind)
      ||!digest(e.evidence.sha256)||![e.evidence.device,e.evidence.inode,e.evidence.entries,e.evidence.bytes].every(v=>Number.isSafeInteger(v)&&v>=0))return false;
    if(s.retainedLinks.some(name=>!p.entries.some(e=>e.name===name)||s.displaced.some(e=>e.name===name)))return false;
    if(record.layout&&(record.layout.plan?.fingerprint!==pf||hash(record.layout.plan)!==hash(p)))return false;
    if(record.state==='verified'&&record.layout?.state!=='verified')return false;
    return record.progress&&typeof record.progress==='object'&&!Array.isArray(record.progress)
      &&Object.entries(record.progress).every(([name,value])=>s.displaced.some(e=>e.name===name)&&value==='preserved');
  }catch{return false;}
}
async function sync(directory){const handle=await fs.open(directory,'r');try{await handle.sync();}finally{await handle.close();}}

// Hash only the selected work resources. Credentials, logs, database caches and
// arbitrary home files are excluded. Symlinks are recorded, never traversed.
// Exact content is hashed transiently; journal entries contain no file contents.
async function evidence(file){
  const budget={entries:0,bytes:0};
  async function visit(target){
    if(++budget.entries>25_000)throw failure('resource_inventory_limit','This account resource needs a separate review before migration.');
    const stat=await fs.lstat(target),base={device:stat.dev,inode:stat.ino,mode:stat.mode,owner:stat.uid};
    if(stat.uid!==process.getuid()||stat.mode&0o022&&!stat.isSymbolicLink())throw failure('unsafe_profile_resource','A profile resource has unverified ownership or write permissions. It was preserved.');
    let content;
    if(stat.isSymbolicLink())content={kind:'link',target:await fs.readlink(target)};
    else if(stat.isDirectory()){
      const names=(await fs.readdir(target)).sort(),children=[];
      for(const name of names)children.push([name,await visit(path.join(target,name))]);
      content={kind:'directory',children};
    }else if(stat.isFile()){
      if(stat.size>32*1024*1024||(budget.bytes+=stat.size)>256*1024*1024)throw failure('resource_inventory_limit','This account resource exceeds the bounded migration inventory. It was preserved.');
      const bytes=await fs.readFile(target);try{content={kind:'file',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}finally{bytes.fill(0);}
    }else throw failure('unsupported_profile_resource','A special filesystem resource needs manual review before adoption.');
    const after=await fs.lstat(target);
    if(stat.dev!==after.dev||stat.ino!==after.ino||stat.mode!==after.mode||stat.mtimeMs!==after.mtimeMs||stat.size!==after.size)
      throw failure('profile_resource_changed','An account resource changed during inspection. Nothing was discarded; inspect it again.');
    return {...base,...content};
  }
  const value=await visit(file);
  return {device:value.device,inode:value.inode,kind:value.kind,sha256:hash(value),entries:budget.entries,bytes:budget.bytes};
}

// The owning switch controller supplies a fresh native inactivity check. This
// module has no authentication client, cannot stop a process, and cannot grant
// itself permission by interpreting a saved snapshot or folder name.
export class CodexAccountLayoutRecovery {
  constructor({root,assertInactive,clock=Date.now,lease=acquireCodexDeliveryClaim,onStep=async()=>{}}={}){
    Object.assign(this,{root,assertInactive,clock,lease,onStep});this.layout=new CodexAccountLayout({root,lease});
  }
  async inactive(home){
    if(typeof this.assertInactive!=='function')throw failure('profile_activity_unverified','Verify that this account profile has no live consumers before changing its layout.');
    const proof=await this.assertInactive(home);
    if(proof?.home!==home||proof.complete!==true||!Array.isArray(proof.owners)||proof.owners.length||
      !Number.isFinite(proof.observedAt)||this.clock()-proof.observedAt<0||this.clock()-proof.observedAt>2000)
      throw failure('profile_in_use','This account profile is active or its activity check is stale. Its resources were preserved.');
  }
  async inspect(input){
    const {plan,conflicts}=await inspectCodexAccountLayoutCandidates(input),displaced=[],retainedLinks=[];
    for(const name of conflicts)displaced.push({name,evidence:await evidence(path.join(plan.profileHome,name))});
    for(const entry of plan.entries)if(!conflicts.includes(entry.name)&&await present(path.join(plan.profileHome,entry.name)))retainedLinks.push(entry.name);
    const selection={version:1,plan,displaced,retainedLinks};return {...selection,fingerprint:hash(selection)};
  }
  async journal(home){
    if(!exactPath(home))throw failure('invalid_profile_home','Use the exact saved account home.');
    await privateAccountDirectory(this.root);
    const directory=path.join(this.root,'runtime-adoption-'+hash(home));await privateAccountDirectory(directory);
    return {directory,file:path.join(directory,'state.json')};
  }
  async save(location,record){await researchSave(location.file,record);await sync(location.directory);}
  async load(location,home){
    try {
      const stat=await fs.lstat(location.file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||stat.mode&0o077||stat.size>4*1024*1024)throw Error();
      const result=JSON.parse(await fs.readFile(location.file,'utf8'));if(!validRecord(result,home))throw Error();return result;
    }
    catch(error){if(error.code==='ENOENT')return null;throw failure('adoption_receipt_invalid','The account layout receipt needs recovery. No resource was changed.');}
  }
  async adopt({input,requestId:id,expectedFingerprint,confirmed=false}){
    if(!requestId(id)||confirmed!==true||! /^[a-f0-9]{64}$/.test(expectedFingerprint||''))throw failure('layout_authorization_required','Review and authorize the exact account resource adoption before switching.');
    const location=await this.journal(input.profileHome);
    const claim=await this.lease(this.root,{threadId:'account-profile-adoption',requestId:'adoption',timeoutMs:5000});
    let profileGuard;
    try{
      profileGuard=await claimAccountProfile(input.profileHome,{lease:this.lease});
      let record=await this.load(location,input.profileHome);
      if(record){
        if(record.selection.plan.canonicalHome!==input.canonicalHome||record.selection.plan.profileHome!==input.profileHome||record.selection.plan.sqliteHome!==(input.sqliteHome||input.canonicalHome))
          throw failure('adoption_destination_changed','This profile already has a recovery operation for another runtime. Reconcile that operation first.');
        if(['rolling_back','rolled_back'].includes(record.state))throw failure('adoption_was_rolled_back','This adoption is being recovered or was rolled back. Finish its recovery before planning a new migration.');
        if(expectedFingerprint!==record.selection.fingerprint)throw failure('adoption_review_changed','Use the original reviewed adoption receipt to reconcile this profile.');
        if(!record.requests.includes(id)){record.requests.push(id);await this.save(location,record);}
        if(record.state==='verified'){await this.layout.verify(record.layout);return structuredClone(record);}
      }else{
        await this.inactive(input.profileHome);
        const selection=await this.inspect(input);
        if(selection.fingerprint!==expectedFingerprint)throw failure('profile_resource_changed','The inspected account resources changed. Review them again; nothing was moved.');
        record={version:1,state:'preparing',selection,requests:[id],progress:{},createdAt:new Date(this.clock()).toISOString()};
        await this.save(location,record);
      }
      const backups=path.join(location.directory,'preserved');await privateAccountDirectory(backups);
      for(const item of record.selection.displaced){
        await this.inactive(input.profileHome);
        const original=path.join(input.profileHome,item.name),backup=path.join(backups,item.name);
        if(await present(backup)){
          if(hash(await evidence(backup))!==hash(item.evidence))throw failure('preserved_resource_changed','A preserved account resource changed. Reconcile its recovery record before continuing.');
          if(await present(original)){
            const source=record.selection.plan.entries.find(entry=>entry.name===item.name)?.source;
            if(!source||await fs.readlink(original).catch(()=>null)!==source)throw failure('profile_resource_changed','The profile path was changed after preservation. Both copies were retained for review.');
          }
        }else{
          if(!await present(original)||hash(await evidence(original))!==hash(item.evidence))throw failure('profile_resource_changed','An account resource changed before preservation. Existing work was left in place.');
          // Every destination is private and new. Never merge, replace or unlink
          // an existing backup. A crash after rename is resolved by its identity.
          await fs.rename(original,backup);await sync(input.profileHome);await sync(backups);
          await this.onStep('preserved',item.name);
          if(hash(await evidence(backup))!==hash(item.evidence))throw failure('preserved_resource_changed','The moved resource changed concurrently. It remains preserved for recovery.');
        }
        record.progress[item.name]='preserved';await this.save(location,record);
      }
      await this.inactive(input.profileHome);
      const {plan,conflicts}=await inspectCodexAccountLayoutCandidates(input);
      if(conflicts.length||plan.fingerprint!==record.selection.plan.fingerprint)throw failure('canonical_layout_changed','The canonical history/configuration changed during adoption. Preserved resources remain recoverable.');
      record.state='linking';await this.save(location,record);
      record.layout=await this.layout.prepare(input);await this.onStep('linked',null);
      await this.inactive(input.profileHome);
      await this.layout.verify(record.layout);record.state='verified';record.verifiedAt=new Date(this.clock()).toISOString();
      await this.save(location,record);return structuredClone(record);
    }finally{await profileGuard?.release();await claim.release();}
  }
  async rollback({profileHome,requestId:id,expectedFingerprint,confirmed=false}){
    if(!requestId(id)||confirmed!==true)throw failure('rollback_authorization_required','Explicitly choose recovery before restoring preserved account resources.');
    const location=await this.journal(profileHome);
    const claim=await this.lease(this.root,{threadId:'account-profile-adoption',requestId:'adoption',timeoutMs:5000});
    let profileGuard;
    try{
      profileGuard=await claimAccountProfile(profileHome,{lease:this.lease});
      const record=await this.load(location,profileHome);
      if(!record||record.selection.fingerprint!==expectedFingerprint)throw failure('adoption_review_changed','Inspect the exact adoption receipt before recovery.');
      if(record.state==='rolled_back')return structuredClone(record);
      await this.inactive(profileHome);
      record.state='rolling_back';record.rollbackRequestId=id;await this.save(location,record);
      const backups=path.join(location.directory,'preserved');
      // This directory may be absent after an interruption before the first
      // move. Creating it is safe; following a substituted symlink is not.
      await privateAccountDirectory(backups);
      // Validate every path before the first removal. Only our exact links may
      // be removed; unknown edits and active consumers always stop recovery.
      for(const entry of record.selection.plan.entries){
        const original=path.join(profileHome,entry.name),item=record.selection.displaced.find(value=>value.name===entry.name);
        if(record.selection.retainedLinks.includes(entry.name)&&await fs.readlink(original).catch(()=>null)!==entry.source)
          throw failure('rollback_resource_changed','A pre-existing shared resource changed. Reconcile it before rollback.');
        if(await present(original)){
          if(await fs.readlink(original).catch(()=>null)===entry.source)continue;
          if(item&&hash(await evidence(original))===hash(item.evidence)&&!await present(path.join(backups,entry.name)))continue;
          throw failure('rollback_resource_changed','The account path changed after adoption. Preserve it and reconcile before rollback.');
        }
      }
      for(const item of record.selection.displaced){
        const backup=path.join(backups,item.name),original=path.join(profileHome,item.name);
        if(await present(backup)){
          if(hash(await evidence(backup))!==hash(item.evidence))throw failure('preserved_resource_changed','The preserved resource changed. It was retained for review.');
          if(await present(original)){
            const source=record.selection.plan.entries.find(e=>e.name===item.name)?.source;
            if(!source||await fs.readlink(original).catch(()=>null)!==source)throw failure('rollback_resource_changed','Recovery would replace an unrelated resource. Both copies were preserved.');
          }
        }else if(!await present(original)||hash(await evidence(original))!==hash(item.evidence))throw failure('preserved_resource_missing','A preserved resource cannot be verified at either location. Inspect the recovery record.');
      }
      for(const entry of record.selection.plan.entries){
        if(record.selection.retainedLinks.includes(entry.name))continue;
        await this.inactive(profileHome);const original=path.join(profileHome,entry.name);
        if(await fs.readlink(original).catch(()=>null)===entry.source){await fs.unlink(original);await sync(profileHome);await this.onStep('unlinked',entry.name);}
      }
      for(const item of record.selection.displaced){
        await this.inactive(profileHome);const original=path.join(profileHome,item.name),backup=path.join(backups,item.name);
        if(await present(backup)){
          if(await present(original))throw failure('rollback_resource_changed','An account resource appeared during recovery. It was preserved.');
          await fs.rename(backup,original);await sync(profileHome);await sync(backups);await this.onStep('restored',item.name);
        }
        if(hash(await evidence(original))!==hash(item.evidence))throw failure('rollback_resource_changed','The restored resource needs verification.');
      }
      record.state='rolled_back';record.rolledBackAt=new Date(this.clock()).toISOString();await this.save(location,record);return structuredClone(record);
    }finally{await profileGuard?.release();await claim.release();}
  }
}
