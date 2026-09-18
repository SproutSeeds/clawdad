import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {researchSave} from './research-budget.mjs';

// Dashboard summaries and plans share subscription admission and turn receipts
// with the conversational runtime. They only evaluate supplied evidence.
export class CodexAuxiliaryTasks {
  constructor({root,runner,accounts,resolveModel,timeoutMs=240000}){
    Object.assign(this,{root,runner,accounts,resolveModel,timeoutMs});this.file=path.join(root,'state.json');this.lock=Promise.resolve();
  }
  async load(){
    if(this.state)return;
    try{this.state=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;this.state={version:1,jobs:[]};}
    if(this.state.version!==1||!Array.isArray(this.state.jobs))throw Error('Summary request receipts need repair.');
    for(const job of this.state.jobs)if(['queued','running'].includes(job.status)){job.status='attention';job.error='The host restarted during this summary. Its request will not be replayed.';}
    await researchSave(this.file,this.state);
  }
  transaction(fn){const next=this.lock.then(async()=>{await this.load();const result=await fn();await researchSave(this.file,this.state);return result;});this.lock=next.catch(()=>{});return next;}
  async run(kind,cwd,text){
    const id=randomUUID(),action='auxiliary.text',fingerprint=createHash('sha256').update(JSON.stringify({kind,cwd,text})).digest('hex');
    const job=await this.accounts.withWorkAdmission({id,action,fingerprint},stamp=>this.transaction(()=>{
      const row={id,action,fingerprint,kind,cwd,status:'queued',createdAt:new Date().toISOString(),...stamp};this.state.jobs.push(row);return row;
    }));
    try{
      const modelConfig=await this.resolveModel();await this.accounts.assertDelivery(job);
      await this.transaction(()=>{job.status='running';job.modelConfig=modelConfig;});
      const messages=[];
      const result=await this.runner.run({id,text,cwd,modelConfig,source:'auxiliary',nativeTools:false,disableTools:true,ephemeral:true,
        policy:{mode:'read-only',reviewer:'auto_review',computerUse:false,nativeTools:false},signal:AbortSignal.timeout(this.timeoutMs),
        onSession:threadId=>this.transaction(()=>{job.threadId=threadId;}),onMessage:async message=>{messages.push(message.text);}});
      const response=messages.at(-1)?.trim();if(!response)throw Error('The app server returned no summary text.');
      await this.transaction(()=>{Object.assign(job,{status:'completed',threadId:result.sessionId,turnId:result.turnId,response,completedAt:new Date().toISOString()});});
      return response;
    }catch(error){await this.transaction(()=>{job.status='attention';job.error=error.message;});throw error;}
  }
}
