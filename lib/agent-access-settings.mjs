import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export const defaultAgentAccess=Object.freeze({mode:'full',reviewer:'auto_review',computerUse:true,nativeTools:true});
const modes=['full','workspace','read-only'];
const valid=v=>v&&modes.includes(v.mode)&&['auto_review','user'].includes(v.reviewer)
  &&typeof v.computerUse==='boolean'&&typeof v.nativeTools==='boolean';
export function agentPermissionParams(policy,cwd){
  if(!valid(policy))throw Error('Agent access settings need repair.');
  return {
    thread:{sandbox:{full:'danger-full-access',workspace:'workspace-write','read-only':'read-only'}[policy.mode],
      approvalPolicy:'on-request',approvalsReviewer:policy.reviewer},
    turn:{sandboxPolicy:policy.mode==='full'?{type:'dangerFullAccess'}:policy.mode==='workspace'
      ?{type:'workspaceWrite',writableRoots:[cwd],networkAccess:true}:{type:'readOnly',networkAccess:false},
      approvalPolicy:'on-request',approvalsReviewer:policy.reviewer},
  };
}
export class AgentAccessSettings {
  constructor({file}){this.file=file;this.lock=Promise.resolve();}
  transaction(fn){const next=this.lock.then(async()=>{
    let state;try{state=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('Saved agent permissions could not be read.');}
    if(!state){state={version:1,revision:0,policy:{...defaultAgentAccess},receipts:{}};await this.save(state);}
    if(state.version!==1||!Number.isSafeInteger(state.revision)||!valid(state.policy)||!state.receipts)throw Error('Saved agent permissions need repair.');
    return fn(state);
  });this.lock=next.catch(()=>{});return next;}
  async save(state){await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});const temp=this.file+'.'+randomUUID()+'.tmp';
    await fs.writeFile(temp,JSON.stringify(state),{mode:0o600});await fs.rename(temp,this.file);}
  snapshot(){return this.transaction(s=>({version:1,revision:s.revision,policy:structuredClone(s.policy),appliesTo:'subsequent_requests',authentication:'chatgpt_subscription'}));}
  async resolve(mode='host'){
    const {revision,policy}=await this.snapshot();
    if(!['host','approve','full','plan'].includes(mode))throw Error('Choose the computer default, repo scope, full access or read-only access.');
    return {...policy,...(mode==='host'?{}:{mode:{approve:'workspace',full:'full',plan:'read-only'}[mode]}),revision};
  }
  update({policy,expectedRevision},requestId){return this.transaction(async state=>{
    if(!valid(policy)||typeof requestId!=='string'||requestId.length<1||requestId.length>128)throw Error('Choose valid agent permissions and a stable request ID.');
    const normalized=Object.fromEntries(Object.entries(defaultAgentAccess).map(([k])=>[k,policy[k]]));
    const fingerprint=JSON.stringify({policy:normalized,expectedRevision});const prior=state.receipts[requestId];
    if(prior){if(prior.fingerprint!==fingerprint)throw Error('This request ID already belongs to another settings change.');return {receipt:prior,access:{version:1,revision:state.revision,policy:state.policy}};}
    if(expectedRevision!==state.revision)throw Error('Permissions changed elsewhere. Refresh Settings before saving.');
    state.policy=normalized;state.revision++;
    const receipt={requestId,fingerprint,revision:state.revision,savedAt:new Date().toISOString(),appliesTo:'subsequent_requests'};
    state.receipts[requestId]=receipt;await this.save(state);
    return {receipt,access:{version:1,revision:state.revision,policy:structuredClone(state.policy)}};
  });}
}
