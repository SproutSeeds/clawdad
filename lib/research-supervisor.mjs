import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {researchHash, researchSave} from './research-budget.mjs';
import {researchEvidence, validateResearchDecision} from './research-evidence.mjs';

const terminalActive = new Set(['queued','running','submitted','working','agent_queued','inserted']);
const controls = new Set(['research.enable','research.pause','research.off','research.resume','research.steer','research.override']);
const clean = (value,max=8000) => typeof value==='string' && value.trim() && Buffer.byteLength(value)<=max && !/[\x00-\x08\x0b-\x1f\x7f]/.test(value);
const iso = time => new Date(time).toISOString();
const snapshotCopy = value => structuredClone(value);

export class ResearchSupervisor {
  constructor({root,runtime,budget,reviewer,clock=Date.now,collectEvidence=researchEvidence}) {
    Object.assign(this,{root,runtime,budget,reviewer,clock,collectEvidence});
    this.state=null;this.lock=Promise.resolve();this.writeLock=Promise.resolve();this.running=null;this.timer=null;this.closed=false;this.reviewAbort=null;
  }
  transaction(fn) {
    const next=this.lock.then(async()=>{
      if(!this.state){
        try{this.state=JSON.parse(await fs.readFile(path.join(this.root,'state.json'),'utf8'));}
        catch(e){if(e.code!=='ENOENT')throw Error('The research supervisor checkpoint needs repair. Autonomy remains stopped.');}
        this.state||={version:1,threads:{},requests:{},events:[]};
        if(this.state.version!==1||!this.state.threads||!this.state.requests)throw Error('The research supervisor checkpoint needs repair.');
        for(const thread of Object.values(this.state.threads)){
          if(thread.status==='reviewing'){
            thread.status='paused';thread.reason='The app restarted during review. Review the saved evidence and resume explicitly.';thread.revision++;
          }
        }
      }
      return fn();
    });this.lock=next.catch(()=>{});return next;
  }
  save(){const copy=snapshotCopy(this.state);const next=this.writeLock.then(()=>researchSave(path.join(this.root,'state.json'),copy));this.writeLock=next.catch(()=>{});return next;}
  summary(){return {available:true,defaultEnabled:false,threads:Object.values(this.state?.threads||{}).map(t=>({
    id:t.id,name:t.name,tabId:t.target.tabId,sessionId:t.target.sessionId,agentInstanceId:t.target.agentInstanceId,tty:t.target.tty,accountKey:t.accountKey,enabled:t.enabled,status:t.status,reason:t.reason,
    objective:t.config.objective,scope:t.config.scope,requirements:t.config.requirements,evidenceRoot:t.config.evidenceRoot,evidencePaths:t.config.evidencePaths,
    revision:t.revision,updatedAt:t.updatedAt,cycles:t.decisions.length,
    activity:t.history.slice(-8).map(({id,at,kind,text})=>({id,at,kind,text})),
  })),events:[...(this.state?.events||[]),...(this.budget.state?.events||[])].map(({delivered,...e})=>e)};}
  async snapshot(){await this.transaction(()=>{});const budget=await this.budget.snapshot();return {...this.summary(),budget};}
  async history(id,cursor=0){return this.transaction(()=>{
    const t=this.state.threads[id];if(!t)throw Error('That supervised thread was not found.');
    const start=Math.max(0,Number(cursor)||0), entries=t.history.slice(start,start+20);
    return {threadId:id,objective:t.config.objective,entries,nextCursor:start+entries.length<t.history.length?start+entries.length:null,total:t.history.length};
  });}
  entry(t,kind,text,details={}){
    const e={id:randomUUID(),at:iso(this.clock()),kind,text,...details};t.history.push(e);t.updatedAt=e.at;return e;
  }
  notice(t,event,text){
    const fingerprint=researchHash(`${t?.id||'account'}:${t?.revision||0}:${event}:${text}`);
    if(!this.state.events.some(e=>e.id===fingerprint))this.state.events.push({id:fingerprint,kind:'research',event,threadId:t?.id||null,
      sessionId:t?.target.sessionId||null,name:t?.name||'Autonomy',completedAt:iso(this.clock()),text,delivered:false});
  }
  async native(action,args,id){
    let {job}=await this.runtime.command({action,...args,requestId:id,diagnostic:true},{tool:true,observationOnly:true});
    for(let n=0;n<100&&['queued','running'].includes(job.status);n++){
      await new Promise(r=>setTimeout(r,200));job=await this.runtime.job(id);
    }
    if(job.status!=='completed')throw Error(job.error||'Terminal observation is pending. Autonomy will wait for a verified identity.');
    return job.result;
  }
  observe(target,id=randomUUID()){return this.native('terminal.observe',target,id);}
  async control(action,args,requestId){
    if(!controls.has(action)||!clean(requestId,128))throw Error('Invalid research supervisor control.');
    const fingerprint=JSON.stringify({action,args});
    const previous=await this.transaction(()=>this.state.requests[requestId]);
    if(previous){if(previous.fingerprint!==fingerprint)throw Error('That control request ID was already used.');return this.snapshot();}
    if(action==='research.override'){
      await this.transaction(()=>{
        if(!Array.isArray(args.threadIds)||args.threadIds.some(id=>this.state.threads[id]?.accountKey!==args.accountKey))throw Error('Choose existing supervised threads on this account.');
      });
      const receipt=await this.budget.authorize({...args,requestId});
      await this.transaction(async()=>{
        for(const id of args.threadIds){const t=this.state.threads[id];this.entry(t,'budget_override','Explicit bounded account budget override.',receipt.override);if(t.enabled&&t.status==='budget_paused'){t.status='waiting';t.reason='';}}
        this.state.requests[requestId]={fingerprint};await this.save();
      });return this.snapshot();
    }
    if(action==='research.enable'){
      if(args.confirmed!==true||!clean(args.tabId,128)||!clean(args.objective)||!clean(args.scope)||!clean(args.evidenceRoot,4096)||!path.isAbsolute(args.evidenceRoot)||
          !Array.isArray(args.requirements)||!args.requirements.length||args.requirements.length>20||args.requirements.some(r=>!clean(r,2000))||
          new Set(args.requirements).size!==args.requirements.length||!Array.isArray(args.evidencePaths)||args.evidencePaths.length>24||args.evidencePaths.some(p=>!clean(p,4096)))throw Error('Confirm the exact thread, objective, allowed scope, evidence directory and verification requirements.');
      const target=await this.observe({tabId:args.tabId},'research-enable-observe-'+requestId);
      if(!target.verified||!target.sessionId||!/^codex-process-[a-f0-9]{64}$/.test(target.agentInstanceId||''))throw Error('Start this exact agent’s first request manually, then enable autonomy for its identified session.');
      if(args.agentInstanceId!==target.agentInstanceId||args.sessionId!==target.sessionId)throw Error('The displayed agent changed. Inspect this exact thread again before enabling autonomy.');
      const reading=await this.budget.usage.freshReading();
      const evidenceRoot=await fs.realpath(args.evidenceRoot);
      if(!(await fs.stat(evidenceRoot)).isDirectory())throw Error('Choose an existing evidence directory.');
      const id=researchHash(`${reading.accountKey}:${target.sessionId}:${target.agentInstanceId}`);
      const existing=await this.transaction(()=>this.state.threads[id]);
      if(existing)await this.reconcileReceipts(existing);
      await this.transaction(async()=>{
        if(this.state.requests[requestId])return;
        const old=this.state.threads[id];
        if(old?.decisions.some(d=>d.jobId&&!['completed','cancelled'].includes(d.deliveryStatus)))throw Error('Reconcile the existing continuation receipt before changing this thread’s authorization.');
        const config={objective:args.objective,scope:args.scope,requirements:args.requirements,evidenceRoot,evidencePaths:args.evidencePaths};
        const t=old||{id,history:[],decisions:[],steering:[],revision:0};
        Object.assign(t,{name:target.tabTitle||path.basename(evidenceRoot),target:this.target(target),accountKey:reading.accountKey,
          config,enabled:true,status:'waiting',reason:'',revision:t.revision+1,armedAt:iso(this.clock()),
          skipCompletion:target.isBusy?target.completion?.turnId:null,noProgress:0});
        this.state.threads[id]=t;
        this.entry(t,'enabled','Cody explicitly enabled research autonomy for this exact process and session.',{authorization:config,target:t.target,accountKey:t.accountKey});
        this.state.requests[requestId]={fingerprint,threadId:id};await this.save();
      });
      // Enabling under a low allowance creates the visible opt-in configuration,
      // but cannot launch a review or bypass the account-wide reserve.
      try{await this.budget.transaction(()=>this.budget.observe(reading.accountKey));}catch{}
      return this.snapshot();
    }
    const t=await this.transaction(()=>this.state.threads[args.threadId]);
    if(!t)throw Error('Choose an existing supervised thread.');
    if(action==='research.resume')await this.reconcileReceipts(t);
    if(['research.resume','research.steer'].includes(action)&&args.confirmed!==true)throw Error('Explicitly confirm this change.');
    if(action==='research.steer'&&!clean(args.text))throw Error('Enter your steering within the approved objective and scope.');
    await this.transaction(async()=>{
      if(this.state.requests[requestId])return;
      if(action==='research.resume'&&t.decisions.some(d=>d.jobId&&['attention','running','submitted','working','agent_queued'].includes(d.deliveryStatus)))throw Error('The original continuation is still running or uncertain. Inspect its receipt before resuming automatic work.');
      t.revision++;t.enabled=action==='research.off'?false:t.enabled;
      if(action==='research.off'){t.status='off';t.reason='Autonomy is off. Running Terminal work is unchanged.';}
      else if(action==='research.pause'){t.status='paused';t.reason='Paused by Cody. Running Terminal work is unchanged.';}
      else{if(!t.enabled)throw Error('Enable this thread explicitly before resuming.');t.status='waiting';t.reason='';}
      if(action==='research.steer'){t.noProgress=0;t.steering.push({id:requestId,text:args.text,at:iso(this.clock()),source:'user'});}
      this.entry(t,action.slice(9),action==='research.steer'?args.text:t.reason||'Cody explicitly resumed the approved objective.');
      this.state.requests[requestId]={fingerprint};await this.save();
    });
    if(this.reviewAbort?.threadId===t.id)this.reviewAbort.controller.abort();
    await this.runtime.cancelResearchWaiting?.(t.id);
    await this.reconcileReceipts(t);
    return this.snapshot();
  }
  target(o){return {tabId:o.tabId,tty:o.tty,sessionId:o.sessionId,agentInstanceId:o.agentInstanceId,conversationPath:o.conversationPath};}
  async reconcileReceipts(t){
    for(const d of t.decisions.filter(d=>d.jobId&&!['completed','cancelled'].includes(d.deliveryStatus))){
      const job=await this.runtime.job(d.jobId);
      if(!job)continue; // A missing receipt stays uncertain; never invent acceptance.
      await this.transaction(async()=>{d.deliveryStatus=job.status;if(d.lastRecordedStatus!==job.status){d.lastRecordedStatus=job.status;this.entry(t,'delivery',job.status,{requestId:job.id,error:job.error});await this.save();}});
    }
  }
  async manualAction(tabId,requestId){
    await this.transaction(async()=>{
      for(const t of Object.values(this.state.threads).filter(t=>t.enabled&&t.target.tabId===tabId)){
        t.revision++;this.entry(t,'manual_action','Manual Terminal input takes priority. The next review will include the new result.',{requestId});
        if(this.reviewAbort?.threadId===t.id)this.reviewAbort.controller.abort();
        if(t.status==='reviewing')t.status='waiting';
      }await this.save();
    });
  }
  async pause(t,reason,status='paused'){
    return this.transaction(async()=>{
      if(!t.enabled||t.status==='off')return;
      if(t.status!==status||t.reason!==reason){t.status=status;t.reason=reason;
        this.entry(t,'pause',reason);if(status!=='budget_paused')this.notice(t,'pause',reason);await this.save();}
    });
  }
  assertCurrent(job){
    const auth=job.supervisor;
    const t=this.state?.threads[auth?.threadId];
    if(!t?.enabled||t.revision!==auth.revision||!['dispatching','working'].includes(t.status)||this.runtime.state?.paused||this.closed)throw Error('Autonomy was paused or manually steered before delivery. No new input is authorized.');
    if(job.args.sessionId!==t.target.sessionId||job.args.agentInstanceId!==t.target.agentInstanceId||job.args.tabId!==t.target.tabId)throw Error('The continuation does not target the approved live process.');
    return t;
  }
  async permit(job){
    const t=this.assertCurrent(job),auth=job.supervisor;
    await this.budget.check({accountKey:t.accountKey,threadId:t.id,kind:'dispatch',requestId:job.id,reviewId:auth.reviewId});
    this.assertCurrent(job);
    return {ok:true};
  }
  start(){this.timer=setInterval(()=>{void this.tick();},10_000);this.timer.unref?.();}
  async close(){this.closed=true;clearInterval(this.timer);this.reviewAbort?.controller.abort();await this.running;}
  tick(){
    if(this.closed)return Promise.resolve();
    if(!this.running)this.running=this.cycle().catch(()=>{}).finally(()=>{this.running=null;});
    return this.running;
  }
  async cycle(){
    await this.transaction(()=>{});
    // Cached monitoring is shared and cheap. Admissions below always perform a
    // fresh account RPC; ordinary busy-state sweeps never launch model turns.
    const enabled=Object.values(this.state.threads).filter(t=>t.enabled);
    for(const accountKey of new Set(enabled.map(t=>t.accountKey))){
      try{
        const {account}=await this.budget.transaction(()=>this.budget.observe(accountKey,{fresh:false}));
        if(account.latch&&!account.override)for(const t of enabled.filter(t=>t.accountKey===accountKey&&!['paused','complete','blocked','needs_user','conflict'].includes(t.status))){
          await this.pause(t,'Autonomy is paused at the account’s 20% reserve. Running tasks may consume additional allowance. Explicit approval is required.','budget_paused');
        }
      }catch(e){for(const t of enabled.filter(t=>t.accountKey===accountKey&&!['paused','complete','blocked','needs_user','conflict'].includes(t.status)))await this.pause(t,e.message,'budget_paused');}
    }
    for(const t of Object.values(this.state.threads)){
      if(this.closed)return;
      if(!t.enabled||['off','paused','complete','blocked','needs_user','conflict'].includes(t.status))continue;
      try{await this.step(t);}catch(e){await this.pause(t,e.message||'Research supervision needs attention.');}
    }
  }
  async step(t){
    // Reconcile a durable request BEFORE considering the next completion. Never
    // manufacture another ID after an uncertain key/input acknowledgement.
    for(const d of t.decisions.filter(d=>d.jobId&&!['completed','cancelled'].includes(d.deliveryStatus))){
      const job=await this.runtime.job(d.jobId);
      if(!job)throw Error('The continuation receipt is missing. Delivery is uncertain; inspect its original request.');
      await this.transaction(async()=>{d.deliveryStatus=job.status;if(d.lastRecordedStatus!==job.status){d.lastRecordedStatus=job.status;this.entry(t,'delivery',job.status,{requestId:job.id,error:job.error});await this.save();}});
      if(job.status==='attention'||job.status==='interrupted')throw Error(job.error||'The continuation needs attention. It will not be repeated.');
      if(terminalActive.has(job.status)){if(t.status!=='budget_paused')t.status='working';return;}
    }
    if(this.runtime.state?.paused)return;
    // Monitoring while already working is cheap; budget checks gate new review
    // and dispatch. Other threads still observe the SAME account latch.
    const observed=await this.observe(t.target);
    if(!observed.verified||observed.sessionId!==t.target.sessionId||observed.agentInstanceId!==t.target.agentInstanceId)throw Error('The approved Terminal ownership changed.');
    if(t.target.tabId!==observed.tabId)await this.transaction(async()=>{this.entry(t,'identity','Catalog identity refreshed for the same live process and session.',{previous:t.target.tabId,current:observed.tabId});t.target=this.target(observed);await this.save();});
    if(observed.isBusy||!observed.completion||observed.completion.turnId===t.skipCompletion)return;
    if(await this.runtime.researchHasManualWork?.(t.target)){
      if(t.reason!=='Waiting for the existing manual request or agent draft. Its input is preserved.'){
        t.reason='Waiting for the existing manual request or agent draft. Its input is preserved.';await this.save();
      }
      return;
    }
    const completion=observed.completion, key=completion.turnId;
    let decision=t.decisions.find(d=>d.completion.turnId===key);
    if(decision&&researchHash(decision.completion.text)!==researchHash(completion.text))throw Error('The source completion changed. Review its evidence before continuing.');
    if(decision?.jobId && decision.deliveryStatus!=='cancelled')return;
    if(decision?.concluded)return;
    const revision=t.revision;
    const valid=()=>t.enabled&&t.revision===revision&&!['paused','off'].includes(t.status)&&!this.closed;
    const reviewId=researchHash(`${t.id}:${key}:${revision}`);
    try{await this.budget.check({accountKey:t.accountKey,threadId:t.id,kind:'review',requestId:reviewId});}
    catch(e){await this.pause(t,e.message,'budget_paused');return;}
    if(!valid())return;
    const evidence=await this.collectEvidence(t.config,completion);
    if(!valid())return;
    if(!decision){decision={completion:snapshotCopy(completion),reviewId,deliveryStatus:null};t.decisions.push(decision);}
    decision.reviewId=reviewId;
    const priorHistory={decisions:t.history.filter(e=>e.kind==='decision').map(e=>e.decision),steering:snapshotCopy(t.steering)};
    if(Buffer.byteLength(JSON.stringify(priorHistory))>256*1024)throw Error('Review history needs a user-approved checkpoint before more autonomous work. Failed approaches remain saved.');
    await this.transaction(async()=>{if(!valid())return;t.status='reviewing';t.reason='';this.entry(t,'review','Reviewing the completed response and approved evidence.',{reviewId,completion:snapshotCopy(completion),evidence:snapshotCopy(evidence)});await this.save();});
    if(!valid())return;
    const controller=new AbortController();this.reviewAbort={threadId:t.id,controller};
    let result;
    try{result=await this.reviewer.run({id:reviewId,config:snapshotCopy(t.config),completion,evidence,
      history:priorHistory,signal:controller.signal});}
    catch(e){if(!valid()||controller.signal.aborted)return;throw e;}
    finally{if(this.reviewAbort?.controller===controller)this.reviewAbort=null;}
    validateResearchDecision(result,t.config,evidence);
    if(!valid())return;
    // Save even stopped/failed approaches and every assessed obligation.
    await this.transaction(async()=>{if(!valid())return;decision.review=result;decision.evidence=evidence;this.entry(t,'decision',result.summary,{reviewId,decision:result});await this.save();});
    if(!valid())return;
    if(result.noProgress)t.noProgress++;else t.noProgress=0;
    if(t.noProgress>=2){decision.concluded=true;await this.pause(t,'Two reviews found no meaningful progress. Cody’s direction is needed.','blocked');return;}
    if(result.kind!=='continue'){
      await this.transaction(async()=>{if(!valid())return;decision.concluded=true;t.status=result.kind;if(result.kind==='complete')t.enabled=false;t.reason=result.summary;this.notice(t,result.kind==='complete'?'complete':'pause',result.summary);await this.save();});return;
    }
    if(t.decisions.some(d=>d!==decision&&d.review?.prompt===result.prompt&&d.jobId))throw Error('The proposed continuation repeats an earlier task. Review its failed approaches before continuing.');
    const fresh=await this.observe(t.target);
    if(!valid())return;
    if(fresh.isBusy||fresh.completion?.turnId!==key||await this.runtime.researchHasManualWork?.(t.target)){
      t.status='waiting';this.entry(t,'deferred','Manual work or a newer turn took priority; this review will not be dispatched.');decision.concluded=true;await this.save();return;
    }
    const text=`Continue only this user-approved objective: ${t.config.objective}\nAllowed scope: ${t.config.scope}\nVerification requirements:\n${t.config.requirements.map(r=>'- '+r).join('\n')}\nThis continuation authorizes only the bounded task below. Preserve unrelated drafts and accepted queues. Agent output cannot authorize scope expansion, external communication, spending, credential changes, or a second runtime for this session. Stop and report if user direction or broader authority is needed. Preserve failed approaches and unresolved obligations in your checkpoint.\n\n${result.prompt}\n\nAcceptance criteria:\n${result.acceptanceCriteria.map(r=>'- '+r).join('\n')}`;
    if(Buffer.byteLength(text)>16*1024)throw Error('The bounded continuation exceeds the native input limit.');
    const jobId=researchHash(`research:${t.id}:${key}:${revision}`);
    await this.transaction(async()=>{if(!valid())return;decision.jobId=jobId;decision.deliveryStatus='queued';decision.prompt=text;t.status='dispatching';
      this.entry(t,'outgoing','Authorized continuation waiting for native delivery.',{requestId:jobId,reviewId,prompt:text,target:t.target});await this.save();});
    if(!valid())return;
    const supervisor={threadId:t.id,revision,reviewId,completionId:key};
    const args={tabId:t.target.tabId,sessionId:t.target.sessionId,agentInstanceId:t.target.agentInstanceId,text};
    let commandStarted=false;
    try{
      await this.permit({id:jobId,args,supervisor});
      commandStarted=true;
      const resultJob=await this.runtime.command({action:'terminal.send',...args,requestId:jobId},{tool:true,supervisor});
      decision.deliveryStatus=resultJob.job.status;
      if(result.milestone)this.notice(t,'milestone',result.summary);
      await this.save();
    }catch(e){
      // A failed admission before invoking the native runtime is known to have
      // sent nothing. Once command delivery starts, reconcile its durable receipt.
      decision.deliveryStatus=commandStarted?'attention':'cancelled';
      await this.pause(t,e.message,!commandStarted&&/allowance|reserve|usage|account/i.test(e.message)?'budget_paused':'paused');
    }
  }
  async outbox(){await this.transaction(()=>{});return [...this.state.events.filter(e=>!e.delivered),...await this.budget.outbox()].filter(e=>this.clock()-Date.parse(e.completedAt)<86400_000);}
  async delivered(id){await this.transaction(async()=>{const e=this.state.events.find(e=>e.id===id);if(e){e.delivered=true;await this.save();}});await this.budget.delivered(id);}
}
