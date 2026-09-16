import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {codexProcessOwners} from './codex-thread-control.mjs';

const run=promisify(execFile);
export async function readAccountOwners(options={},read=codexProcessOwners){
  // Short-lived helper processes can exit between ps and lsof. A failed
  // inventory is never treated as no owner; repeat the whole read boundedly.
  for(let attempt=0;attempt<3;attempt++){
    try{return await read(options);}catch(error){
      if(attempt===2)throw Object.assign(Error('Codex ownership is changing or unavailable. Preserve the current owners and inspect again.'),{code:'account_owner_inventory_unavailable'});
      await new Promise(resolve=>setTimeout(resolve,50*(attempt+1)));
    }
  }
}
export function parseAccountProcessTree(text){
  const rows=new Map();
  for(const line of text.split('\n').filter(s=>s.trim())){
    const match=line.trim().match(/^(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/);
    if(!match)throw Error('Process ancestry inventory is incomplete.');
    const [,pid,parent,start,executable]=match;const value={pid:Number(pid),parent:Number(parent),start,executable};
    if(rows.has(value.pid))throw Error('Process inventory repeated an identity.');
    value.identity=createHash('sha256').update(JSON.stringify(value)).digest('hex');rows.set(value.pid,value);
  }
  return rows;
}
export async function readAccountProcessTree({execute=run}={}){
  return parseAccountProcessTree((await execute('/bin/ps',['-axo','pid=,ppid=,lstart=,comm='],{timeout:4000,maxBuffer:8*1024*1024})).stdout);
}

// An ancestry relationship is evidence for a helper's lifecycle, not evidence
// for its account. Only the foreground native owner or exact managed socket
// receives a transition. Separate apps keep their own background processes.
export function classifyAccountOwnerScope({owners,native,tree,managedSocketPID,servicePID}){
  const foreground=new Map((native.consumers||[]).filter(c=>c.processId).map(c=>[Number(c.processId),c]));
  const selected=[],helpers=[],foreign=[],unknown=[];
  const roots=new Set([...foreground.keys(),managedSocketPID,servicePID].filter(Number.isSafeInteger));
  for(const owner of owners){
    const row=tree.get(owner.pid);if(!row){unknown.push({...owner,reasonCode:'process_ancestry_unavailable'});continue;}
    const base={...owner,processLifetime:row.identity};
    if(foreground.has(owner.pid)){selected.push({...base,scope:'terminal',native:foreground.get(owner.pid)});continue;}
    if(owner.pid===managedSocketPID&&owner.socket){selected.push({...base,scope:'shared'});continue;}
    const chain=[],seen=new Set([row.pid]);let cursor=row;
    while(cursor.parent>1&&chain.length<64){
      cursor=tree.get(cursor.parent);if(!cursor||seen.has(cursor.pid))break;seen.add(cursor.pid);chain.push(cursor);
    }
    const ancestor=chain.find(p=>roots.has(p.pid));
    if(ancestor){helpers.push({...base,scope:'descendant',ownerPID:ancestor.pid});continue;}
    const app=[row,...chain].map(p=>p.executable.match(/^(.*?\.app)\/Contents\//)?.[1]).find(Boolean);
    if(app&&!['Terminal.app','ClawDad.app'].includes(path.basename(app))){foreign.push({...base,scope:'other_app',application:app});continue;}
    unknown.push({...base,reasonCode:'unmanaged_codex_owner'});
  }
  // A native foreground owner absent from the independent process census is
  // a changing observation, never an empty successful inventory.
  for(const [pid,binding] of foreground)if(!selected.some(o=>o.pid===pid))unknown.push({pid,tty:binding.tty,reasonCode:'native_owner_changed'});
  return {complete:native.complete===true&&unknown.length===0,selected,helpers,foreign,unknown};
}
