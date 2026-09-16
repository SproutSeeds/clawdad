import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {researchHash, researchSave} from './research-budget.mjs';
import {researchEvidence, validateResearchDecision} from './research-evidence.mjs';

const terminalActive = new Set(['queued','running','submitted','working','agent_queued','inserted']);
const controls = new Set(['research.enable','research.configure','research.start','research.pause','research.off','research.resume','research.restart','research.clear','research.steer','research.override','research.budget']);
const clean = (value,max=8000) => typeof value==='string' && value.trim() && Buffer.byteLength(value)<=max && !/[\x00-\x08\x0b-\x1f\x7f]/.test(value);
const iso = time => new Date(time).toISOString();
const snapshotCopy = value => structuredClone(value);

export class ResearchSupervisor {
  constructor({root,runtime,budget,reviewer,modelSettings=null,clock=Date.now,collectEvidence=researchEvidence}) {
    Object.assign(this,{root,runtime,budget,reviewer,modelSettings,clock,collectEvidence});
    this.state=null;this.lock=Promise.resolve();this.writeLock=Promise.resolve();this.running=null;this.timer=null;this.closed=false;this.reviewAbort=null;
    this.controlCalls=new Map();
  }
  transaction(fn) {
    const next=this.lock.then(async()=>{
      if(!this.state){
        try{this.state=JSON.parse(await fs.readFile(path.join(this.root,'state.json'),'utf8'));}
        catch(e){if(e.code!=='ENOENT')throw Error('The research supervisor checkpoint needs repair. Autonomy remains stopped.');}
        this.state||={version:1,threads:{},requests:{},events:[]};
        if(this.state.version!==1||!this.state.threads||!this.state.requests)throw Error('The research supervisor checkpoint needs repair.');
        if(this.state.budgetPolicyVersion!==2){
          await this.budget.transaction(()=>{});
          for(const thread of Object.values(this.state.threads)){
            const account=this.budget.state.accounts[thread.accountKey];
            if(thread.status==='budget_paused' && account && this.budget.policyStatus(account,account.reading,thread.id).mode==='none'){
              thread.status='paused';thread.reason='The former app-wide allowance reserve was removed. Resume this supervisor explicitly when ready.';
              thread.revision++;this.entry(thread,'budget_migration',thread.reason);
            }
          }
          this.state.budgetPolicyVersion=2;
          try { await this.save(); }
          catch(error) { this.state=null; throw error; }
        }
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
    objective:t.config?.objective||'',scope:t.config?.scope||'',requirements:t.config?.requirements||[],evidenceRoot:t.config?.evidenceRoot||'',evidencePaths:t.config?.evidencePaths||[],
    configured:!!t.config,generation:t.generation||0,revision:t.revision,updatedAt:t.updatedAt,cycles:t.decisions.length,
    activity:t.history.slice(-8).map(({id,at,kind,text})=>({id,at,kind,text})),
  })),events:[...(this.state?.events||[]),...this.budget.activeEvents()].map(({delivered,...e})=>e)};}
  async snapshot(){
    await this.transaction(()=>{});const budget=await this.budget.snapshot(),summary=this.summary();
    return {...summary,budget,threads:summary.threads.map(t=>{
      const account=budget.accounts.find(a=>a.accountKey===t.accountKey);
      return {...t,budgetPolicy:account?this.budget.policyStatus({...account,latch:account.latch},account.reading,t.id):null};
    })};
  }
  async history(id,cursor=0){return this.transaction(()=>{
    const t=this.state.threads[id];if(!t)throw Error('That supervised thread was not found.');
    const start=Math.max(0,Number(cursor)||0), entries=t.history.slice(start,start+20);
    return {threadId:id,objective:t.config?.objective||'',entries:snapshotCopy(entries),nextCursor:start+entries.length<t.history.length?start+entries.length:null,total:t.history.length};
  });}
  entry(t,kind,text,details={}){
    const e={id:randomUUID(),at:iso(this.clock()),kind,text,...details};t.history.push(e);t.updatedAt=e.at;return e;
  }
  notice(t,event,text,approvalId=''){
    const fingerprint=researchHash(`${t?.id||'account'}:${t?.revision||0}:${event}:${text}:${approvalId}`);
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
  async control(action,args,requestId,options={}){
    if(!controls.has(action)||!clean(requestId,128))throw Error('Invalid research supervisor control.');
    const fingerprint=JSON.stringify({action,args});
    const pending=this.controlCalls.get(requestId);
    if(pending){if(pending.fingerprint!==fingerprint)throw Error('That control request ID was already used.');return pending.promise;}
    const promise=this.applyControl(action,snapshotCopy(args),requestId,fingerprint,options).finally(()=>this.controlCalls.delete(requestId));
    this.controlCalls.set(requestId,{fingerprint,promise});return promise;
  }
  async controlResult(requestId){return {...await this.snapshot(),controlReceipt:snapshotCopy(this.state.requests[requestId])};}
  async invalidate(t,revision){
    if(this.reviewAbort?.threadId===t.id&&this.reviewAbort.revision<revision)this.reviewAbort.controller.abort();
    // Only cancel work belonging to the superseded authorization. A newly
    // approved cycle may start while this asynchronous cleanup is finishing.
    await this.runtime.cancelResearchWaiting?.(t.id,revision);
    await this.reconcileReceipts(t);
  }
  async applyControl(action,args,requestId,fingerprint,{authorize,assistant=false}={}){
    const previous=await this.transaction(()=>this.state.requests[requestId]);
    if(previous){if(previous.fingerprint!==fingerprint)throw Error('That control request ID was already used.');return this.controlResult(requestId);}
    const authorization=authorize?await authorize():{source:'user_controls'};
    const receipt=(threadId)=>({requestId,action,fingerprint,threadId,revision:this.state.threads[threadId]?.revision,authorization,at:iso(this.clock())});
    const checkRevision=(t,expected)=>{
      if(t?.revision!==expected || (args.expectedRevision!==undefined && args.expectedRevision!==t?.revision))throw Error('This research setup changed. Read research_status and use its current revision before changing it.');
    };
    if(assistant && args.confirmed!==true)throw Error('This change requires Cody’s explicit instruction in the current conversation.');
    if(action==='research.budget'){
      await this.transaction(async()=>{
        const t=args.scope==='supervisor'?this.state.threads[args.threadId]:null;
        if(args.scope==='supervisor'&&(!t||t.accountKey!==args.accountKey))throw Error('Choose the exact saved supervisor and its account from research_status.');
        if(t&&(!Number.isSafeInteger(args.expectedRevision)||t.revision!==args.expectedRevision))throw Error('This research setup changed. Read research_status and use its current revision.');
        const budgetReceipt=await this.budget.change({...args,requestId,authorization});
        const affected=t?[t]:Object.values(this.state.threads).filter(thread=>thread.accountKey===args.accountKey);
        for(const thread of affected){
          const policy=this.budget.policyStatus(this.budget.state.accounts[args.accountKey],budgetReceipt.reading,thread.id);
          if(thread.enabled&&thread.status==='budget_paused'&&!policy.paused){thread.status='waiting';thread.reason='';}
          const text=['none','default'].includes(args.mode)?'Cody selected no project allowance limit for this supervisor.':
            `Cody approved a ${args.threshold}% weekly allowance reserve for this supervisor, through the current weekly cycle.`;
          this.entry(thread,'budget',text,{budgetReceipt,authorization});
        }
        // Budget-only changes never enable, restart or unpause a manual pause.
        // An enabled supervisor held only by allowance rechecks its fresh limit.
        this.state.requests[requestId]={...receipt(t?.id),budgetReceipt};await this.save();
      });return this.controlResult(requestId);
    }
    if(action==='research.override'){
      await this.transaction(()=>{
        if(!Array.isArray(args.threadIds)||args.threadIds.some(id=>this.state.threads[id]?.accountKey!==args.accountKey))throw Error('Choose existing supervised threads on this account.');
      });
      const budgetReceipt=await this.budget.authorize({...args,requestId});
      await this.transaction(async()=>{
        for(const id of args.threadIds){const t=this.state.threads[id];this.entry(t,'budget_override','Explicit bounded account budget override.',budgetReceipt.override);if(t.enabled&&t.status==='budget_paused'){t.status='waiting';t.reason='';}}
        this.state.requests[requestId]=receipt();await this.save();
      });return this.controlResult(requestId);
    }
    const configuring=['research.enable','research.configure'].includes(action);
    const existing=await this.transaction(()=>args.threadId?this.state.threads[args.threadId]:configuring?Object.values(this.state.threads).find(t=>t.target.sessionId===args.sessionId&&t.target.agentInstanceId===args.agentInstanceId):null);
    if(args.threadId&&!existing)throw Error('Choose an existing supervised thread from research_status.');
    if(!configuring&&!existing)throw Error('Choose an existing supervised thread.');
    if(assistant&&existing&&!Number.isSafeInteger(args.expectedRevision))throw Error('Read research_status and provide this setup’s expectedRevision.');
    if(existing&&['sessionId','agentInstanceId'].some(field=>args[field]!==undefined&&args[field]!==existing.target[field]))throw Error('The requested process/session does not match this research setup. Inspect its exact ownership again.');
    const expected=existing?.revision;
    checkRevision(existing,expected);
    if(configuring){
      if(args.confirmed!==true||(!existing&&!clean(args.tabId,128))||!clean(args.objective)||!clean(args.scope)||!clean(args.evidenceRoot,4096)||!path.isAbsolute(args.evidenceRoot)||
          !Array.isArray(args.requirements)||!args.requirements.length||args.requirements.length>20||args.requirements.some(r=>!clean(r,2000))||
          new Set(args.requirements).size!==args.requirements.length||!Array.isArray(args.evidencePaths)||args.evidencePaths.length>24||args.evidencePaths.some(p=>!clean(p,4096)))throw Error('Confirm the exact thread, objective, allowed scope, evidence directory and verification requirements.');
      if(action==='research.configure'&&typeof args.start!=='boolean')throw Error('Choose whether to start supervision now or save its setup stopped.');
      const target=await this.observe(existing?.target||{tabId:args.tabId},'research-enable-observe-'+requestId);
      if(!target.verified||!target.sessionId||!/^codex-process-[a-f0-9]{64}$/.test(target.agentInstanceId||''))throw Error('Start this exact agent’s first request manually, then enable autonomy for its identified session.');
      const identity=existing?.target||args;
      if(identity.agentInstanceId!==target.agentInstanceId||identity.sessionId!==target.sessionId)throw Error('The displayed agent changed. Inspect this exact thread again before enabling autonomy.');
      const reading=await this.budget.usage.freshReading();
      if(existing&&existing.accountKey!==reading.accountKey)throw Error('The signed-in account changed. This setup remains bound to its original account; inspect its ownership before configuring new work.');
      const evidenceRoot=await fs.realpath(args.evidenceRoot);
      if(!(await fs.stat(evidenceRoot)).isDirectory())throw Error('Choose an existing evidence directory.');
      const id=researchHash(`${reading.accountKey}:${target.sessionId}:${target.agentInstanceId}`);
      if(existing)await this.reconcileReceipts(existing);
      let updated;
      await this.transaction(async()=>{
        const old=this.state.threads[id];
        checkRevision(old,expected);
        const config={objective:args.objective,scope:args.scope,requirements:args.requirements,evidenceRoot,evidencePaths:args.evidencePaths};
        const t=old||{id,history:[],decisions:[],steering:[],revision:0};
        const previousConfig=snapshotCopy(t.config||null),start=action==='research.enable'||args.start;
        if(JSON.stringify(previousConfig)!==JSON.stringify(config))t.steering=[];
        Object.assign(t,{name:target.tabTitle||path.basename(evidenceRoot),target:this.target(target),accountKey:reading.accountKey,
          config,enabled:start,status:start?'waiting':'off',reason:start?'':'Setup saved. Autonomy is off.',revision:t.revision+1,generation:(t.generation||0)+1,armedAt:iso(this.clock()),
          skipCompletion:target.isBusy?target.completion?.turnId:null,noProgress:0});
        this.state.threads[id]=t;
        this.entry(t,start?'enabled':'configured',start?'Cody explicitly enabled the approved research objective.':'Cody saved the research setup with autonomy off.',{previousConfig,config:snapshotCopy(config),generation:t.generation,authorization,target:t.target,accountKey:t.accountKey});
        this.state.requests[requestId]=receipt(id);updated={t,revision:t.revision};await this.save();
      });
      await this.invalidate(updated.t,updated.revision);
      // Enabling under a low allowance creates the visible opt-in configuration,
      // but cannot bypass an explicitly approved project limit.
      try{await this.budget.transaction(()=>this.budget.observe(reading.accountKey));}catch{}
      return this.controlResult(requestId);
    }
    const t=existing,starting=['research.start','research.resume','research.restart'].includes(action);
    if((starting||action==='research.steer')&&args.confirmed!==true)throw Error('Explicitly confirm this change.');
    if(action==='research.steer'&&!clean(args.text))throw Error('Enter your steering within the approved objective and scope.');
    if((starting||action==='research.steer')&&!t.config)throw Error('This setup was cleared. Configure its objective, scope and verification requirements before starting or steering it.');
    let target;
    if(starting){
      await this.reconcileReceipts(t);
      if(t.decisions.some(d=>d.jobId&&(!d.deliveryStatus||['attention','interrupted'].includes(d.deliveryStatus))))throw Error('The original continuation delivery is uncertain. Inspect its receipt before starting automatic work.');
      target=await this.observe(t.target,'research-start-observe-'+requestId);
      if(!target.verified||target.agentInstanceId!==t.target.agentInstanceId||target.sessionId!==t.target.sessionId)throw Error('The approved Terminal ownership changed. Inspect the exact process and session before starting.');
    }
    let revision;
    await this.transaction(async()=>{
      checkRevision(t,expected);
      const previousConfig=snapshotCopy(t.config),wasEnabled=t.enabled;
      revision=++t.revision;
      if(action==='research.off'){t.status='off';t.reason='Autonomy is off. Running Terminal work is unchanged.';}
      else if(action==='research.pause'){t.status='paused';t.reason='Paused by Cody. Running Terminal work is unchanged.';}
      else if(action==='research.clear'){t.config=null;t.steering=[];t.status='cleared';t.reason='Research setup cleared. History and running Terminal work are preserved.';}
      else if(starting){t.enabled=true;t.target=this.target(target);t.status='waiting';t.reason='';t.skipCompletion=target.isBusy?target.completion?.turnId:null;}
      if(['research.off','research.clear'].includes(action))t.enabled=false;
      if(['research.restart','research.clear','research.steer'].includes(action)||(starting&&!wasEnabled))t.generation=(t.generation||0)+1;
      if(starting||action==='research.steer')t.noProgress=0;
      if(action==='research.steer'){
        t.steering.push({id:requestId,text:args.text,at:iso(this.clock()),source:'user'});
        if(t.enabled&&t.status!=='paused'){t.status='waiting';t.reason='';}
      }
      this.entry(t,action.slice(9),action==='research.steer'?args.text:t.reason||'Cody explicitly started the approved objective.',{authorization,generation:t.generation||0,...(action==='research.clear'?{previousConfig}:{} )});
      this.state.requests[requestId]=receipt(t.id);await this.save();
    });
    await this.invalidate(t,revision);
    return this.controlResult(requestId);
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
    if(this.runtime.accounts?.assertDelivery)await this.runtime.accounts.assertDelivery(job);
    else await this.runtime.accounts?.assertAdmission();
    await this.budget.check({accountKey:t.accountKey,threadId:t.id,kind:'dispatch',requestId:job.id,reviewId:auth.reviewId});
    if(this.runtime.accounts?.assertDelivery)await this.runtime.accounts.assertDelivery(job);
    else await this.runtime.accounts?.assertAdmission();
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
        for(const t of enabled.filter(t=>t.accountKey===accountKey&&!['paused','complete','blocked','needs_user','conflict'].includes(t.status))){
          const policy=this.budget.policyStatus(account,account.reading,t.id);
          if(policy.paused){
            await this.pause(t,policy.reason,'budget_paused');
            if(policy.mode==='override')await this.transaction(async()=>{this.notice(t,'pause',policy.reason,policy.requestId);await this.save();});
          }
        }
      }catch(e){for(const t of enabled.filter(t=>t.accountKey===accountKey&&!['paused','complete','blocked','needs_user','conflict'].includes(t.status)))await this.pause(t,e.message,'budget_paused');}
    }
    for(const t of Object.values(this.state.threads)){
      if(this.closed)return;
      if(!t.enabled||['off','paused','complete','blocked','needs_user','conflict'].includes(t.status))continue;
      const revision=t.revision;
      try{await this.step(t);}catch(e){if(t.revision===revision)await this.pause(t,e.message||'Research supervision needs attention.');}
    }
  }
  async step(t){
    const revision=t.revision,generation=t.generation||0,config=snapshotCopy(t.config);
    const valid=()=>!!t.config&&t.enabled&&t.revision===revision&&!['paused','off','cleared'].includes(t.status)&&!this.closed;
    if(!valid())return;
    // Reconcile a durable request BEFORE considering the next completion. Never
    // manufacture another ID after an uncertain key/input acknowledgement.
    for(const d of t.decisions.filter(d=>d.jobId&&!['completed','cancelled'].includes(d.deliveryStatus))){
      const job=await this.runtime.job(d.jobId);
      if(!valid())return;
      if(!job)throw Error('The continuation receipt is missing. Delivery is uncertain; inspect its original request.');
      await this.transaction(async()=>{d.deliveryStatus=job.status;if(d.lastRecordedStatus!==job.status){d.lastRecordedStatus=job.status;this.entry(t,'delivery',job.status,{requestId:job.id,error:job.error});await this.save();}});
      if(job.status==='attention'||job.status==='interrupted')throw Error(job.error||'The continuation needs attention. It will not be repeated.');
      if(terminalActive.has(job.status)){if(t.status!=='budget_paused')t.status='working';return;}
    }
    if(this.runtime.state?.paused)return;
    if(this.runtime.accounts&&!(await this.runtime.accounts.admission()).allowed)return;
    // Monitoring while already working is cheap; budget checks gate new review
    // and dispatch. Each explicit project limit uses the SAME account reading.
    const observed=await this.observe(t.target);
    if(!valid())return;
    if(!observed.verified||observed.sessionId!==t.target.sessionId||observed.agentInstanceId!==t.target.agentInstanceId)throw Error('The approved Terminal ownership changed.');
    if(t.target.tabId!==observed.tabId)await this.transaction(async()=>{this.entry(t,'identity','Catalog identity refreshed for the same live process and session.',{previous:t.target.tabId,current:observed.tabId});t.target=this.target(observed);await this.save();});
    if(observed.isBusy||!observed.completion||observed.completion.turnId===t.skipCompletion)return;
    const manual=await this.runtime.researchHasManualWork?.(t.target);
    if(!valid())return;
    if(manual){
      if(t.reason!=='Waiting for the existing manual request or agent draft. Its input is preserved.'){
        t.reason='Waiting for the existing manual request or agent draft. Its input is preserved.';await this.save();
      }
      return;
    }
    const completion=observed.completion, key=completion.turnId;
    let decision=t.decisions.find(d=>d.completion.turnId===key&&(d.generation||0)===generation);
    if(decision&&researchHash(decision.completion.text)!==researchHash(completion.text))throw Error('The source completion changed. Review its evidence before continuing.');
    if(decision?.jobId && decision.deliveryStatus!=='cancelled')return;
    if(decision?.concluded)return;
    const reviewId=researchHash(`${t.id}:${key}:${revision}`);
    try{await this.budget.check({accountKey:t.accountKey,threadId:t.id,kind:'review',requestId:reviewId});}
    catch(e){if(valid())await this.pause(t,e.message,'budget_paused');return;}
    if(!valid())return;
    if(this.runtime.accounts&&!(await this.runtime.accounts.admission()).allowed)return;
    const modelConfig=this.modelSettings?await this.modelSettings.resolve('research',t.id):undefined;
    if(!valid())return;
    const evidence=await this.collectEvidence(config,completion);
    if(!valid())return;
    if(!decision){decision={completion:snapshotCopy(completion),generation,reviewId,deliveryStatus:null};t.decisions.push(decision);}
    decision.reviewId=reviewId;decision.modelConfig=snapshotCopy(modelConfig);
    const priorHistory={decisions:t.history.filter(e=>e.kind==='decision').map(e=>({...e.decision,objectiveGeneration:e.generation||0})),steering:snapshotCopy(t.steering),currentObjectiveGeneration:generation};
    if(Buffer.byteLength(JSON.stringify(priorHistory))>256*1024)throw Error('Review history needs a user-approved checkpoint before more autonomous work. Failed approaches remain saved.');
    await this.transaction(async()=>{if(!valid())return;t.status='reviewing';t.reason='';this.entry(t,'review','Reviewing the completed response and approved evidence.',{reviewId,generation,config,modelConfig,completion:snapshotCopy(completion),evidence:snapshotCopy(evidence)});await this.save();});
    if(!valid())return;
    const controller=new AbortController();this.reviewAbort={threadId:t.id,revision,controller};
    let result;
    try{result=await this.reviewer.run({id:reviewId,config,completion,evidence,modelConfig,
      history:priorHistory,signal:controller.signal});}
    catch(e){if(!valid()||controller.signal.aborted)return;throw e;}
    finally{if(this.reviewAbort?.controller===controller)this.reviewAbort=null;}
    if(!valid())return;
    validateResearchDecision(result,config,evidence);
    // Save even stopped/failed approaches and every assessed obligation.
    await this.transaction(async()=>{if(!valid())return;decision.review=result;decision.evidence=evidence;this.entry(t,'decision',result.summary,{reviewId,generation,decision:result});await this.save();});
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
      if(valid()&&result.milestone)this.notice(t,'milestone',result.summary);
      await this.save();
    }catch(e){
      // A failed admission before invoking the native runtime is known to have
      // sent nothing. Once command delivery starts, reconcile its durable receipt.
      decision.deliveryStatus=commandStarted?'attention':'cancelled';
      if(valid())await this.pause(t,e.message,!commandStarted&&/allowance|reserve|usage|account/i.test(e.message)?'budget_paused':'paused');
      else await this.save();
    }
  }
  async outbox(){await this.transaction(()=>{});return [...this.state.events.filter(e=>!e.delivered),...await this.budget.outbox()].filter(e=>this.clock()-Date.parse(e.completedAt)<86400_000);}
  async delivered(id){await this.transaction(async()=>{const e=this.state.events.find(e=>e.id===id);if(e){e.delivered=true;await this.save();}});await this.budget.delivered(id);}
}
