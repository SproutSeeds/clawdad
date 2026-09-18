import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(id);
const active=new Set(['queued','pending','processing','starting','dispatching','running','dispatched','submitted','working']);
// Project history's canonical success status is "answered". Account work
// uses "completed"; normalize at both receipt adapters, including imports.
export const accountProjectStatus=status=>status==='answered'?'completed':status;
async function json(file){
  try{
    const stat=await fs.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||stat.size>16*1024*1024)throw Error('Unsafe project receipt');
    return JSON.parse(await fs.readFile(file,'utf8'));
  }catch(error){if(error.code==='ENOENT')return null;throw error;}
}
// Immutable request fields establish acceptance independently of a worker's
// changing progress. Only identity hashes enter the account journal; prompts
// and responses stay in their existing project history.
export async function readLegacyAccountRequest(projectPath,requestId){
  if(!path.isAbsolute(projectPath||'')||!valid(requestId))throw Error('Project receipt identity is incomplete.');
  const root=path.join(projectPath,'.clawdad','history');
  const index=await json(path.join(root,'requests',requestId+'.json'));if(!index)return null;
  if(index.requestId!==requestId||!path.isAbsolute(index.file||''))throw Error('Project request index changed.');
  const relative=path.relative(root,index.file);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Project receipt is outside its history.');
  const realRoot=await fs.realpath(root),realFile=await fs.realpath(index.file);
  if(!realFile.startsWith(realRoot+path.sep))throw Error('Project receipt escaped its history.');
  const record=await json(index.file);
  if(!record||record.requestId!==requestId||record.projectPath!==projectPath||!valid(record.sessionId)
    ||index.sessionId!==record.sessionId||typeof record.message!=='string'||typeof record.sentAt!=='string')
    throw Error('Project request history does not match its exact identity.');
  const identity={requestId,projectPath,sessionId:record.sessionId,provider:record.provider,
    sentAt:record.sentAt,message:record.message,scheduleMode:record.scheduleMode};
  return {id:requestId,action:'legacy.dispatch',projectPath,sessionId:record.sessionId,provider:record.provider,
    fingerprint:createHash('sha256').update(JSON.stringify(identity)).digest('hex'),status:accountProjectStatus(record.status)};
}

// Covers previously accepted project work from before the account admission
// ledger. It never restarts a pump, repairs a status, resumes or sends a turn.
export async function readLegacyAccountInventory(projects,{known=[]}={}){
  if(!Array.isArray(projects)||projects.length>2000)return {complete:false,jobs:[]};
  const jobs=new Map(),knownIDs=new Set(known.map(j=>j.id));let complete=true;
  for(const project of projects){
    const projectPath=project?.path;if(!path.isAbsolute(projectPath||'')){complete=false;continue;}
    try{
      const mailbox=path.join(projectPath,'.clawdad','mailbox');
      const candidates=[];
      const state=await json(path.join(mailbox,'status.json'));
      if(state&&active.has(state.state))candidates.push({id:state.request_id||state.requestId,state:state.state});
      for(const folder of ['queued','interjections']){
        const dir=path.join(mailbox,folder);
        const names=await fs.readdir(dir).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
        if(names.length>20000)throw Error('Project queue inventory exceeds its bound.');
        for(const name of names.filter(n=>n.endsWith('.json'))){
          const item=await json(path.join(dir,name));if(!item||!active.has(item.state))continue;
          if(item.projectPath!==projectPath)throw Error('Project queue identity changed.');
          candidates.push({id:item.requestId,state:item.state});
        }
      }
      // Retain an imported request after it leaves the queue, so the account
      // drain can see its final exact receipt rather than an unexplained gap.
      for(const prior of known.filter(j=>j.projectPath===projectPath))candidates.push({id:prior.id,retained:true});
      for(const candidate of candidates){
        if(!valid(candidate.id))throw Error('A live project request has no stable identity.');
        const record=await readLegacyAccountRequest(projectPath,candidate.id);
        if(!record)throw Error('A live project request has no retained receipt.');
        if(record.provider&&record.provider!=='codex')continue;
        if(record.provider!=='codex')throw Error('Project provider is unverified.');
        const existing=jobs.get(record.id);
        if(existing&&existing.fingerprint!==record.fingerprint)throw Error('A request ID belongs to different project work.');
        const status=record.status==='completed'?'completed':candidate.retained?record.status:'working';
        jobs.set(record.id,{...record,status,legacyImported:true});
      }
    }catch{complete=false;}
  }
  if([...knownIDs].some(id=>!jobs.has(id)))complete=false;
  return {complete,jobs:[...jobs.values()]};
}
