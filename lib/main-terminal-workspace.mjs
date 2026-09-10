import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {acquireThreadControl,assertSharedThreadOwner,validThreadId} from './codex-thread-control.mjs';

export const mainWorkspaceActions=['mainworkspace.inspect','mainworkspace.save','mainworkspace.restore','mainworkspace.remove','mainworkspace.recover'];
export function workspaceProjection(state){
  const date=value=>typeof value==='number'?new Date((value+978307200)*1000).toISOString():null;
  return {revision:state.revision,status:state.status,message:state.message||null,savedAt:date(state.roster?.savedAt),observedAt:date(state.observedAt),
    fullScreen:!!state.roster?.fullScreen,activeRequest:state.activeRequest||null,
    snapshots:(state.previous||[]).map((v,index)=>({index,savedAt:date(v.savedAt),count:v.entries.length})),
    entries:(state.roster?.entries||[]).map(e=>({id:e.id,name:e.name,directory:e.directory,kind:e.kind,sessionId:e.sessionId||null,
      status:state.progress?.[e.id]?.phase||'saved',pendingReceipts:e.pendingReceipts||[],
      message:[state.progress?.[e.id]?.message,(e.pendingReceipts||[]).length?`Pending or uncertain message receipts need review: ${e.pendingReceipts.join(', ')}. Native queue messages are not replayed automatically.`:null].filter(Boolean).join(' ')||null,
      draftText:e.draft?.text??null,draftLimitation:e.draft?.limitation||null}))};
}
export async function readMainWorkspace(root){
  try{return workspaceProjection(JSON.parse(await fs.readFile(path.join(root,'..','MainTerminalWorkspace','main-workspace.json'),'utf8')));}
  catch(error){if(error.code==='ENOENT')return {revision:1,status:'not_saved',entries:[],snapshots:[]};
    return {status:'needs_attention',entries:[],message:'The saved workspace could not be read. Its file was preserved; inspect the Mac diagnostics.'};}
}

// Use the same per-thread lock as app-server writers across the entire native
// resume operation. Holding this lease never changes the owning transport.
export class MainWorkspaceResumeClaims {
  constructor(runtime){this.runtime=runtime;this.leases=new Map();}
  async claim({id,sessionId}){
    const job=await this.runtime.job(id);
    if(job?.action!=='mainworkspace.restore'||job.status!=='running'||!validThreadId(sessionId))throw Error('No authorized workspace restore is running.');
    const state=JSON.parse(await fs.readFile(path.join(this.runtime.root,'..','MainTerminalWorkspace','main-workspace.json'),'utf8'));
    if(!state.roster.entries.some(e=>e.sessionId===sessionId))throw Error('This conversation is not in the approved workspace.');
    if(!this.runtime.appServer)throw Error('The shared server ownership check is unavailable. Restore is waiting.');
    const claim=await acquireThreadControl(sessionId),release=()=>claim.release();
    try{
      const owner=await assertSharedThreadOwner(this.runtime.appServer.client,sessionId,this.runtime.appServer.readOwners);
      if(owner.kind!=='saved')throw Error('This conversation is already owned by a live runtime. Use that owner; restore will not resume it in a second process.');
      const token=crypto.randomUUID(),expires=Date.now()+60_000;
      const timer=setTimeout(()=>this.release({token}),60_000);timer.unref();
      this.leases.set(token,{release,timer,expires});return {allowed:true,token,expiresAt:new Date(expires).toISOString()};
    }catch(error){await release();throw error;}
  }
  check({token}){if(!this.leases.has(token)||this.leases.get(token).expires<=Date.now())throw Error('The resume ownership lease expired before launch. No launch should be retried without reconciliation.');return {allowed:true};}
  async release({token}){const lease=this.leases.get(token);if(lease){this.leases.delete(token);clearTimeout(lease.timer);await lease.release();}return {ok:true};}
  async close(){for(const token of this.leases.keys())await this.release({token});}
}
