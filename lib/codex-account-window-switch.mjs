import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const failure=(code,message)=>Object.assign(Error(message),{code,accountWindowMessage:message});
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
export async function readAccountWindow(root,id){
  if(!validId(id))throw Error('Invalid account window operation');
  const file=path.join(root,'WindowSwitches',id+'.json');
  try{
    const stat=await fs.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||stat.mode&0o077||stat.size>16*1024*1024)throw Error();
    const record=JSON.parse(await fs.readFile(file,'utf8'));
    if(record.version!==1||record.operationId!==id||!/^[a-f0-9]{64}$/.test(record.captureHash||'')
      ||!Array.isArray(record.entries)||!record.entries.length||record.entries.length>128
      ||!Array.isArray(record.tabs)||record.tabs.length!==record.entries.length)throw Error();
    for(const entry of record.entries){
      if(!validId(entry.id)||!path.isAbsolute(entry.directory||'')||!['shell','codex'].includes(entry.kind)
        ||typeof entry.draft?.text!=='string'||Buffer.byteLength(entry.draft.text)>1024*1024
        ||entry.pendingReceipts?.length||entry.identityIssue
        ||entry.kind==='codex'&&(!validId(entry.sessionId)||!path.isAbsolute(entry.conversationPath||'')||!path.isAbsolute(entry.executable||'')))throw Error();
    }
    return record;
  }catch(error){if(error.code==='ENOENT')return null;throw failure('account_window_record_invalid','The private window recovery record needs inspection. Its data and Terminal work were preserved.');}
}

// A physical window is one transition consumer. Previous cached account labels
// are not needed to close it: newly launched owners are verified against the
// authenticated destination and exact saved conversations instead.
export function windowConsumer(record,selection){
  return {id:'window:'+record.selection,kind:'terminal_window',pid:null,processIdentity:record.captureHash,
    windowId:record.selection,tabId:selection.tabId,tty:null,sessionId:null,directory:null,
    title:`${selection.title} · ${record.entries.length} tabs`,busy:false,windowVerified:true,
    recoverable:true,accountKey:null,accountVerified:false,
    draft:{state:'captured',recoverable:true,hash:createHash('sha256').update('').digest('hex'),provenance:'private-exact-window-capture'},pendingReceipts:[],reason:''};
}

export class CodexAccountWindowSwitch {
  constructor(adapter){this.adapter=adapter;this.choices=[];}
  async progress(){
    try{
      const gate=await this.adapter.accounts.admission();if(!gate.operationId)return null;
      const record=await readAccountWindow(this.adapter.root,gate.operationId);if(!record)return null;
      return {operationId:record.operationId,stage:record.stage,message:record.message||null,
        tabs:record.entries.map(e=>({name:e.name,sessionId:e.sessionId||null,status:record.progress?.[e.id]?.phase||'saved',message:record.progress?.[e.id]?.message||null}))};
    }catch{return {stage:'needs_attention',message:'The saved window recovery needs inspection.'};}
  }
  async windows(){
    const inventory=await this.adapter.inventory();
    this.choices=inventory.windows||[];
    return {windows:this.choices,complete:inventory.complete,reasons:inventory.reasons};
  }
  async select(choice){
    const {windows}=await this.windows();
    const match=choice?windows.find(w=>w.id===choice.id&&w.tabId===choice.tabId):windows.length===1?windows[0]:null;
    if(!match)throw Object.assign(Error('Choose the exact Terminal window to recreate. Refresh its window list if needed.'),{accountRequestRejected:true});
    return structuredClone(match);
  }
  async call(operation,action,args={}){
    const requestId=hash([operation.id,action,operation.recoveryAttempt||0]);
    try{return await this.adapter.native.call(operation.id,action,{operationId:operation.id,...args},requestId);}
    catch(error){
      const receipt=await this.adapter.transport.inspect(requestId);
      if(receipt?.message)throw failure(error.code,receipt.message);
      throw error;
    }
  }
  async inspect(observed,operation){
    const selection=operation.windowSelection;
    if(!selection)throw failure('account_window_selection_required','Choose the Terminal window before starting this switch. The previous per-tab switch is paused.');
    this.choices=observed.windows||[];
    const captured=await readAccountWindow(this.adapter.root,operation.id);
    // Before capture use the explicit native catalog member IDs. Once captured,
    // TTY + process identity binds the selection across catalog reconstruction.
    const included=observed.consumers.filter(c=>c.kind==='shared_app_server'||c.kind==='terminal_codex'&&
      (captured?captured.tabs.some(t=>t.tty===c.tty&&t.owner===c.processIdentity):selection.tabs.some(t=>t.tabId===c.tabId)));
    const outside=observed.consumers.filter(c=>!included.includes(c));
    if(outside.some(c=>c.kind==='terminal_codex'&&!c.tabId))return {...observed,complete:false,consumers:included,
      reasons:['A Terminal process is not yet bound to its physical window. Open its tab once to identify it, then refresh; no input was sent.']};
    if(!captured&&!this.choices.some(w=>w.id===selection.id))return {...observed,complete:false,consumers:included,
      reasons:['The chosen window changed. Cancel and choose its current lineup before switching.']};
    if(!observed.complete||included.some(c=>c.busy!==false||c.pendingReceipts?.length))return {...observed,consumers:included};
    if(!captured)await this.call(operation,'window.capture',{selection});
    const record=await readAccountWindow(this.adapter.root,operation.id);
    if(!record)throw failure('account_window_capture_pending','The native window capture is still pending. Keep the same switch request.');
    const current=windowConsumer(record,selection);
    return {...observed,consumers:[current,...included.filter(c=>c.kind==='shared_app_server')],
      windowRecord:record,outsideCount:outside.length};
  }
  recovery(record,consumer){
    // Keep only recovery fields, never process environments or credentials.
    return {...consumer,draft:{text:'',hash:consumer.draft.hash,provenance:consumer.draft.provenance},images:[],
      window:{operationId:record.operationId,captureHash:record.captureHash,selection:record.selection,
        entries:record.entries,launches:record.launches}};
  }
  async transition(operation){
    const prepared=await this.adapter.profiles.target(operation),target={authorizationHome:prepared.authorizationHome,sqliteHome:prepared.sqliteHome,accountKey:prepared.accountKey};
    const result=await this.call(operation,'window.restore',{target});
    if(result.stage!=='verified')throw failure('account_window_restore_pending','The chosen window has not finished restoring. Its progress is saved.');
    return {state:'verified',sessionId:null,accountKey:target.accountKey,ownerVerified:true,draftVerified:true};
  }
  async verify(operation){return this.call(operation,'window.verify');}
}
