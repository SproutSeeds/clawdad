import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ResearchBudget} from '../lib/research-budget.mjs';
import {ResearchSupervisor} from '../lib/research-supervisor.mjs';
import {researchEvidence,validateResearchDecision} from '../lib/research-evidence.mjs';
import {AssistantRuntime} from '../lib/assistant-runtime.mjs';
import {runAssistantMCP} from '../lib/assistant-mcp.mjs';
import {Readable,Writable} from 'node:stream';
import {normalizeResearchNotification,researchNotificationPayload} from '../cloud/push-notifications.mjs';

const accountKey='a'.repeat(64), instance='codex-process-'+ 'b'.repeat(64), session='11111111-1111-4111-8111-111111111111';
const initial=Date.parse('2026-09-09T12:00:00Z');
const config={objective:'Verify the two disposable calculations.',scope:'Only the disposable fixture directory. No external actions.',requirements:['Both calculations have verified evidence.'],evidencePaths:['report.txt']};
const completion={sessionId:session,turnId:'turn-1',text:'The first calculation is ready. See [report](report.txt).',completedAt:new Date(initial).toISOString(),inProgress:false};
const observation={verified:true,tabId:'tab-A',tty:'/dev/ttys099',sessionId:session,agentInstanceId:instance,conversationPath:'/fixture/rollout.jsonl',tabTitle:'Fixture',directory:'/fixture',isBusy:false,completion};
const managementArgs=(thread,extra={})=>({threadId:thread.id,expectedRevision:thread.revision,confirmed:true,...extra});
const review=()=>({kind:'continue',summary:'The first calculation passed; the second remains.',rationale:'Finish the remaining approved calculation.',
  prompt:'Verify the second calculation and update report.txt with the result.',acceptanceCriteria:['The second calculation is checked.'],noProgress:false,milestone:false,
  findings:[{kind:'proved',text:'First calculation checked.',evidence:[{id:'evidence-1',quote:'First calculation: PASS'}]},
    {kind:'obligation',text:'Second calculation remains.',evidence:[]}],
  requirements:[{requirement:config.requirements[0],status:'open',evidence:[]}]});

async function fixture(t,{realRuntime=false}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-research-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'report.txt'),'First calculation: PASS\n');
  let now=initial,percent=50,cycle=initial/1000+604800,offline=false,key=accountKey,reads=0;
  const usage={freshReading:async()=>{reads++;if(offline)throw Error('Usage is stale');return {accountKey:key,remainingPercent:percent,resetsAt:cycle,cycle,observedAt:new Date(now).toISOString()};}};
  const budget=new ResearchBudget({file:path.join(root,'budget.json'),usage,clock:()=>now});
  const jobs=new Map(), deliveries=[], observed=structuredClone(observation);let manual=false, reviews=0, onReview=null;
  const runtime=realRuntime?new AssistantRuntime({root:path.join(root,'Assistant'),coordinator:{stop(){},async prepare(){return {};}}}):{
    state:{paused:false},async command(request,options={}){
      if(request.action==='terminal.observe')return {job:{status:'completed',result:structuredClone(observed)}};
      if(jobs.has(request.requestId))return {job:jobs.get(request.requestId)};
      const j={id:request.requestId,args:request,supervisor:options.supervisor,status:'queued'};jobs.set(j.id,j);deliveries.push(j);return {job:j};
    },async job(id){return jobs.get(id);},async researchHasManualWork(){return manual;},
    async cancelResearchWaiting(threadId,beforeRevision=Infinity){for(const j of jobs.values())if(j.status==='queued'&&j.supervisor?.threadId===threadId&&j.supervisor.revision<beforeRevision)j.status='cancelled';},
  };
  const reviewer={async run(args){reviews++;return onReview?await onReview(args):review();}};
  const options={root:path.join(root,'Research'),runtime,budget,reviewer,clock:()=>now};
  const supervisor=new ResearchSupervisor(options);runtime.research=supervisor;
  return {root,supervisor,options,budget,usage,runtime,observed,jobs,deliveries,
    setPercent:v=>percent=v,setTime:v=>now=v,setCycle:v=>cycle=v,setAccount:v=>key=v,setOffline:v=>offline=v,
    setManual:v=>manual=v,setReview:fn=>onReview=fn,reviewCount:()=>reviews,readCount:()=>reads,
    async enable(id='enable-1'){
      await supervisor.control('research.enable',{...config,evidenceRoot:root,tabId:'tab-A',agentInstanceId:instance,sessionId:session,confirmed:true},id);
      return Object.values(supervisor.state.threads)[0];
    }};
}

test('installation stays off and consumes no review/usage calls; conversation has a separate coordinator',async t=>{
  const f=await fixture(t);await f.supervisor.tick();
  assert.equal(f.reviewCount(),0);assert.equal(f.readCount(),0);assert.equal((await f.supervisor.snapshot()).threads.length,0);
});
test('save stopped, start, steer, pause, resume, stop, restart and clear retain one durable setup and history',async t=>{
  const f=await fixture(t),args={...config,evidenceRoot:f.root,tabId:'tab-A',sessionId:session,agentInstanceId:instance,start:false,confirmed:true};
  const saved=await f.supervisor.control('research.configure',args,'setup');
  const thread=f.supervisor.state.threads[saved.controlReceipt.threadId];
  await f.supervisor.tick();assert.equal(thread.enabled,false);assert.equal(f.reviewCount(),0);
  for(const action of ['start','steer','pause','resume','off','restart']){
    const before=thread.revision;
    const result=await f.supervisor.control('research.'+action,managementArgs(thread,{text:'Keep the second calculation bounded.'}),action);
    assert.equal(thread.revision,before+1);assert.equal(result.controlReceipt.revision,thread.revision);
    assert.equal(Object.values(f.supervisor.state.threads).length,1);
  }
  assert.equal(thread.enabled,true);assert.equal(thread.steering.length,1);
  await f.supervisor.control('research.clear',managementArgs(thread),'clear');
  assert.equal(thread.enabled,false);assert.equal(thread.config,null);assert.equal(thread.status,'cleared');
  const history=await f.supervisor.history(thread.id);assert.equal(history.objective,'');
  assert.deepEqual(history.entries.at(-1).previousConfig,{...config,evidenceRoot:await fs.realpath(f.root)});
  assert.ok(history.entries.find(e=>e.kind==='steer'));assert.equal(await fs.readFile(path.join(f.root,'report.txt'),'utf8'),'First calculation: PASS\n');
  await assert.rejects(f.supervisor.control('research.start',managementArgs(thread),'invalid-start'),/cleared/);
  const restored=new ResearchSupervisor(f.options);await restored.tick();assert.equal((await restored.snapshot()).threads[0].configured,false);
  await restored.control('research.configure',{...args,threadId:thread.id,expectedRevision:thread.revision,objective:'A clearer approved objective.',start:false},'reconfigure');
  assert.equal((await restored.history(thread.id)).entries.length,history.entries.length+1);
});
test('steering preserves paused/off states; changing an objective records both versions and drops superseded steering only from active context',async t=>{
  const f=await fixture(t),thread=await f.enable();
  for(const action of ['pause','off']){
    await f.supervisor.control('research.'+action,managementArgs(thread),action);
    const enabled=thread.enabled,status=thread.status;
    await f.supervisor.control('research.steer',managementArgs(thread,{text:'Earlier within-scope direction.'}),'steer-'+action);
    assert.equal(thread.enabled,enabled);assert.equal(thread.status,status);
  }
  await f.supervisor.control('research.configure',managementArgs(thread,{...config,evidenceRoot:f.root,objective:'New approved objective',start:false}),'new-objective');
  assert.equal(thread.steering.length,0);assert.equal(thread.history.filter(e=>e.kind==='steer').length,2);
  assert.equal(thread.history.at(-1).previousConfig.objective,config.objective);
  assert.equal(thread.history.at(-1).config.objective,'New approved objective');
});
test('clearing or replacing during review discards the old decision and cannot dispatch it after the response arrives',async t=>{
  for(const action of ['clear','configure']){
    const f=await fixture(t),thread=await f.enable();let finish,started,signal;
    const began=new Promise(r=>started=r);
    f.setReview(async args=>{signal=args.signal;started();return new Promise(r=>finish=()=>r(review()));});
    const tick=f.supervisor.tick();await began;
    await f.supervisor.control('research.'+action,managementArgs(thread,action==='configure'?{...config,evidenceRoot:f.root,objective:'Changed objective',start:true}:{}),action);
    assert.equal(signal.aborted,true);finish();await tick;
    assert.equal(f.deliveries.length,0);assert.equal(thread.history.filter(e=>e.kind==='decision').length,0);
    assert.equal(thread.status,action==='clear'?'cleared':'waiting');
  }
});
test('configuration changes preserve working receipts, manual drafts and accepted queue entries; new work waits for completion',async t=>{
  const f=await fixture(t),thread=await f.enable();await f.supervisor.tick();
  const accepted=f.deliveries[0];accepted.status='agent_queued';
  await f.supervisor.control('research.configure',managementArgs(thread,{...config,evidenceRoot:f.root,objective:'The refined objective',start:true}),'refine');
  await f.supervisor.tick();assert.equal(accepted.status,'agent_queued');assert.equal(f.reviewCount(),1);assert.equal(thread.status,'working');
  await f.supervisor.control('research.off',managementArgs(thread),'off-working');
  await f.supervisor.control('research.restart',managementArgs(thread),'restart-working');
  await f.supervisor.tick();assert.equal(f.deliveries.length,1);assert.equal(accepted.status,'agent_queued');
  accepted.status='completed';f.observed.completion={...completion,turnId:'accepted-result'};f.setManual(true);
  await f.supervisor.tick();assert.equal(f.reviewCount(),1);
  await f.supervisor.control('research.clear',managementArgs(thread),'clear-working-history');
  assert.equal(thread.decisions[0].jobId,accepted.id);assert.equal(accepted.status,'completed');
});
test('restart creates a new review generation without replaying previous outgoing requests',async t=>{
  const f=await fixture(t),thread=await f.enable();
  f.setReview(async()=>({...review(),kind:'needs_user',prompt:'',acceptanceCriteria:[]}));
  await f.supervisor.tick();assert.equal(thread.status,'needs_user');
  const generation=thread.generation;
  await f.supervisor.control('research.restart',managementArgs(thread),'restart-review');
  await f.supervisor.tick();assert.equal(f.reviewCount(),2);assert.equal(thread.decisions.length,2);
  assert.equal(thread.decisions[1].generation,generation+1);assert.equal(f.deliveries.length,0);
});
test('superseded waiting deliveries cancel while running ones remain; stale revision, account and owner changes cannot reconfigure',async t=>{
  const f=await fixture(t),thread=await f.enable();await f.supervisor.tick();
  const stale=managementArgs(thread);
  await f.supervisor.control('research.pause',managementArgs(thread),'pause');
  assert.equal(f.deliveries[0].status,'cancelled');
  const revision=thread.revision;
  await assert.rejects(f.supervisor.control('research.restart',stale,'stale'),/changed/);assert.equal(thread.revision,revision);
  f.observed.agentInstanceId='codex-process-'+'c'.repeat(64);
  await assert.rejects(f.supervisor.control('research.start',managementArgs(thread),'wrong-owner'),/ownership/);assert.equal(thread.revision,revision);
  f.observed.agentInstanceId=instance;f.observed.tabId='refreshed-catalog';
  await f.supervisor.control('research.start',managementArgs(thread),'same-owner');assert.equal(thread.target.tabId,'refreshed-catalog');
  f.setAccount('c'.repeat(64));
  await assert.rejects(f.supervisor.control('research.configure',managementArgs(thread,{...config,evidenceRoot:f.root,start:true}),'wrong-account'),/account changed/);
});
test('an in-flight configuration cannot undo a later stop; concurrent duplicates and restart retries apply once',async t=>{
  const f=await fixture(t),thread=await f.enable();let release,started;
  const began=new Promise(r=>started=r),observe=f.supervisor.observe.bind(f.supervisor);
  f.supervisor.observe=async(...args)=>{started();await new Promise(r=>release=r);return observe(...args);};
  const update=f.supervisor.control('research.configure',managementArgs(thread,{...config,evidenceRoot:f.root,start:true}),'slow-configure');
  await began;await f.supervisor.control('research.off',managementArgs(thread),'stop-now');release();
  await assert.rejects(update,/changed/);assert.equal(thread.enabled,false);
  f.supervisor.observe=observe;
  const args=managementArgs(thread),before=thread.revision;
  await Promise.all([f.supervisor.control('research.restart',args,'once'),f.supervisor.control('research.restart',args,'once')]);
  assert.equal(thread.revision,before+1);
  const restored=new ResearchSupervisor(f.options);
  const retry=await restored.control('research.restart',args,'once',{authorize:()=>{throw Error('Original conversation ended');}});
  assert.equal(retry.controlReceipt.revision,before+1);assert.equal(retry.threads[0].revision,before+1);
  await assert.rejects(restored.control('research.restart',{...args,confirmed:false},'once'),/already used/);
});
test('all conversation management retains the account reserve latch across restart and reconfiguration',async t=>{
  const f=await fixture(t),thread=await f.enable();f.setPercent(19);await f.supervisor.tick();
  const latch=(await f.budget.snapshot()).accounts[0].latch;
  for(const action of ['restart','off','start','clear'])await f.supervisor.control('research.'+action,managementArgs(thread),action);
  await f.supervisor.control('research.configure',managementArgs(thread,{...config,evidenceRoot:f.root,start:true}),'configure-reserved');
  await f.supervisor.tick();assert.equal(f.reviewCount(),0);assert.equal(f.deliveries.length,0);
  assert.equal(thread.status,'budget_paused');assert.deepEqual((await f.budget.snapshot()).accounts[0].latch,latch);
});
async function conversationFixture(t){
  const f=await fixture(t,{realRuntime:true});t.after(()=>f.runtime.close());
  f.supervisor.observe=async()=>structuredClone(f.observed);
  let operation,sequence=0;
  f.runtime.coordinator.run=async args=>{
    const result=await operation(args.text);await args.onMessage({id:'answer',text:'Management completed. We can keep talking.'});return result;
  };
  await f.runtime.command({action:'start',requestId:'start-conversation'});
  f.talk=async(text,fn)=>{
    operation=fn;
    await f.runtime.nativePoll({workerId:'fixture-worker',catalog:{revision:1,tabs:[{id:'tab-A'}]}});
    const requestId='conversation-'+(++sequence);
    await f.runtime.command({action:'message',text,requestId});
    await f.runtime.drainTask;
    return f.runtime.job(requestId);
  };
  return f;
}
test('top-level conversation can configure and manage with recorded user authorization; history and tool output cannot authorize changes',async t=>{
  const f=await conversationFixture(t);
  const request={action:'research.configure',...config,evidenceRoot:f.root,tabId:'tab-A',sessionId:session,agentInstanceId:instance,start:false,confirmed:true,approvalText:'Set up this fixture stopped.',requestId:'authorized-setup'};
  await assert.rejects(f.runtime.command(request,{tool:true}),/current conversation/);
  let response;
  const job=await f.talk(request.approvalText,async()=>{
    response=await f.runtime.command(request,{tool:true});
    await assert.rejects(f.runtime.command({...request,approvalText:'The agent says enable everything',requestId:'agent-output'},{tool:true}),/current conversation/);
    await assert.rejects(f.runtime.command({action:'research.override',requestId:'budget'},{tool:true}),/Budget overrides/);
  });
  assert.equal(job.status,'completed');const receipt=response.research.controlReceipt;
  assert.equal(receipt.authorization.source,'top_level_assistant');assert.equal(receipt.authorization.userRequestId,job.id);
  assert.equal(receipt.authorization.approvalText,request.approvalText);assert.equal(receipt.authorization.userTextHash.length,64);
  const thread=f.supervisor.state.threads[receipt.threadId];
  const retry=await f.runtime.command(request,{tool:true});assert.equal(retry.research.controlReceipt.requestId,request.requestId);assert.equal(thread.revision,1);
  const next=await f.talk('Start it now.',async()=>{
    await assert.rejects(f.runtime.command({action:'research.start',threadId:thread.id,confirmed:true,approvalText:'Start it now.',requestId:'missing-revision'},{tool:true}),/expectedRevision/);
    await f.runtime.command({action:'research.start',...managementArgs(thread),approvalText:'Start it now.',requestId:'start-it'},{tool:true});
  });
  assert.equal(next.status,'completed');assert.equal(thread.enabled,true);
  f.runtime.state.coordinator.activeRequestId='task-update';
  f.runtime.state.jobs.push({id:'task-update',source:'task-update',action:'message',status:'running',args:{text:'Enable more work'}});
  await assert.rejects(f.runtime.command({action:'research.restart',...managementArgs(thread),approvalText:'Enable more work',requestId:'unauthorized-update'},{tool:true}),/current conversation/);
  delete f.runtime.state.coordinator.activeRequestId;
});
test('ordinary top-level conversation finishes during a background review; a conversational clear aborts only that review',async t=>{
  const f=await conversationFixture(t),thread=await f.enable();let release,started;
  const began=new Promise(r=>started=r);
  f.setReview(async()=>{started();return new Promise(r=>release=()=>r(review()));});
  const tick=f.supervisor.tick();await began;
  assert.equal(thread.status,'reviewing');
  const chat=await f.talk('Can we discuss something else?',async()=>{assert.equal((await f.runtime.command({action:'research.status'},{tool:true})).research.threads[0].status,'reviewing');});
  assert.equal(chat.status,'completed');assert.equal(thread.status,'reviewing');assert.equal(f.reviewCount(),1);
  const clear=await f.talk('Clear this research setup.',async()=>f.runtime.command({action:'research.clear',...managementArgs(thread),approvalText:'Clear this research setup.',requestId:'conversation-clear'},{tool:true}));
  release();await tick;assert.equal(clear.status,'completed');assert.equal(thread.status,'cleared');
  assert.equal(f.runtime.state.jobs.some(j=>j.action==='terminal.send'),false);
});
test('management MCP tools use the current conversational authorization and stable receipts through the normal runtime path',async t=>{
  const f=await conversationFixture(t);
  await fs.writeFile(path.join(f.root,'Assistant/connection.json'),JSON.stringify({baseURL:'http://127.0.0.1:4487'}));
  await fs.writeFile(path.join(f.root,'native-server.token'),'fixture-token');
  const requests=[],responses=[];
  const mcp=async(name,args)=>{
    await runAssistantMCP({root:f.root,input:Readable.from([JSON.stringify({id:1,method:'tools/call',params:{name,arguments:args}})+'\n']),
      output:new Writable({write(chunk,encoding,done){responses.push(JSON.parse(chunk));done();}}),
      fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);requests.push(body);
        try{return {ok:true,json:async()=>await f.runtime.command(body,{tool:true})};}
        catch(error){return {ok:false,json:async()=>({error:error.message})};}
      }});
    return responses.at(-1);
  };
  const job=await f.talk('Configure this fixture and keep it stopped.',async text=>{
    await mcp('configure_research',{...config,evidenceRoot:f.root,tabId:'tab-A',sessionId:session,agentInstanceId:instance,start:false,approvalText:text,requestId:'mcp-config'});
    const thread=Object.values(f.supervisor.state.threads)[0];assert.ok(thread);
    await mcp('steer_research',{threadId:thread.id,expectedRevision:thread.revision,text:'Stay in the fixture.',approvalText:text,requestId:'mcp-steer'});
    await mcp('manage_research',{threadId:thread.id,expectedRevision:thread.revision,operation:'stop',approvalText:text,requestId:'mcp-stop'});
    const rejected=await mcp('manage_research',{operation:'override',approvalText:text,requestId:'mcp-override'});assert.equal(rejected.result.isError,true);
    const missing=await mcp('manage_research',{operation:'stop',approvalText:text});assert.equal(missing.result.isError,true);
  });
  assert.equal(job.status,'completed');assert.deepEqual(requests.map(r=>r.action),['research.configure','research.steer','research.off']);
  assert.ok(requests.every(r=>r.confirmed===true));assert.equal(responses.slice(0,3).some(r=>r.result.isError),false);
  assert.equal(Object.values(f.supervisor.state.threads)[0].history[0].authorization.userRequestId,job.id);
});
test('a late failure from a superseded dispatch cannot pause the replacement objective or cancel newer waiting work',async t=>{
  const f=await fixture(t),thread=await f.enable();
  f.supervisor.permit=async()=>{
    await f.supervisor.control('research.configure',managementArgs(thread,{...config,evidenceRoot:f.root,objective:'Replacement objective',start:true}),'replace-before-dispatch');
    throw Error('Old authorization is no longer current');
  };
  await f.supervisor.tick();assert.equal(thread.status,'waiting');assert.equal(f.deliveries.length,0);
  assert.equal(thread.decisions[0].deliveryStatus,'cancelled');
  const real=await fixture(t,{realRuntime:true});await real.runtime.load();
  real.runtime.state.jobs.push(
    {id:'old',status:'queued',supervisor:{threadId:'fixture',revision:2}},
    {id:'new',status:'queued',supervisor:{threadId:'fixture',revision:3}},
    {id:'active',status:'working',supervisor:{threadId:'fixture',revision:2}},
    {id:'manual',status:'queued'});
  await real.runtime.cancelResearchWaiting('fixture',3);
  assert.deepEqual(real.runtime.state.jobs.map(j=>j.status),['cancelled','queued','working','queued']);
});
test('a historical shell launch receipt does not hold a new Codex session open; its current agent draft and active work still do',async t=>{
  const f=await fixture(t,{realRuntime:true});await f.runtime.load();
  const target={tabId:'tab-A',sessionId:session,agentInstanceId:instance};
  f.runtime.state.jobs.push({id:'shell-launch',action:'terminal.native.type',status:'inserted',args:{tabId:'tab-A',text:'codex'}});
  assert.equal(await f.runtime.researchHasManualWork(target),false);
  const draft={id:'current-draft',action:'terminal.insert',status:'inserted',agentInstanceId:instance,sessionId:session,args:{tabId:'tab-A',text:'Review this draft'}};
  f.runtime.state.jobs.push(draft);assert.equal(await f.runtime.researchHasManualWork(target),true);
  draft.status='cleared';assert.equal(await f.runtime.researchHasManualWork(target),false);
  draft.status='working';assert.equal(await f.runtime.researchHasManualWork(target),true);
});
test('completion review records actual evidence and dispatches one bounded task; duplicate events do not deliver twice',async t=>{
  const f=await fixture(t),thread=await f.enable();await f.supervisor.tick();
  assert.equal(f.reviewCount(),1);assert.equal(f.deliveries.length,1);
  const delivery=f.deliveries[0];assert.equal(delivery.args.tabId,'tab-A');assert.equal(delivery.args.sessionId,session);assert.equal(delivery.args.agentInstanceId,instance);
  assert.ok(delivery.args.text.includes(config.scope));assert.ok(delivery.args.text.includes('Acceptance criteria:'));
  await f.supervisor.tick();await f.supervisor.tick();assert.equal(f.deliveries.length,1);
  assert.ok(thread.history.find(e=>e.kind==='review').evidence.documents[1].text.includes('PASS'));
  assert.equal(thread.history.find(e=>e.kind==='outgoing').prompt,delivery.args.text);
  assert.equal((await f.supervisor.history(thread.id)).entries.length,thread.history.length);
});
test('accepted receipt survives restart and is never resent while working or uncertain',async t=>{
  const f=await fixture(t);await f.enable();await f.supervisor.tick();
  f.deliveries[0].status='working';
  let supervisor=new ResearchSupervisor(f.options);await supervisor.tick();assert.equal(f.deliveries.length,1);
  f.deliveries[0].status='attention';f.deliveries[0].error='Uncertain native receipt';await supervisor.tick();
  const thread=Object.values(supervisor.state.threads)[0];assert.equal(thread.status,'paused');assert.match(thread.reason,/Uncertain/);
  await assert.rejects(supervisor.control('research.resume',{threadId:thread.id,confirmed:true},'resume'),/uncertain/);
  assert.equal(f.deliveries.length,1);
});
test('same directory does not authorize a different process; catalog ID can rebind only the same verified owner',async t=>{
  const f=await fixture(t),thread=await f.enable();f.observed.tabId='restarted-catalog';await f.supervisor.tick();
  assert.equal(thread.target.tabId,'restarted-catalog');assert.equal(f.deliveries[0].args.tabId,'restarted-catalog');
  f.deliveries[0].status='completed';f.observed.agentInstanceId='codex-process-'+ 'c'.repeat(64);await f.supervisor.tick();
  assert.equal(thread.status,'paused');assert.match(thread.reason,/ownership/);assert.equal(f.deliveries.length,1);
});
test('manual drafts and accepted queues postpone review without clearing or queueing input',async t=>{
  const f=await fixture(t);await f.enable();f.setManual(true);await f.supervisor.tick();assert.equal(f.reviewCount(),0);
  f.setManual(false);f.observed.isBusy=true;await f.supervisor.tick();assert.equal(f.reviewCount(),0);
  f.observed.isBusy=false;await f.supervisor.tick();assert.equal(f.deliveries.length,1);
});
test('pause during a slow review keeps conversation responsive and prevents delivery',async t=>{
  const f=await fixture(t),thread=await f.enable();let finish,started;
  const began=new Promise(r=>started=r);
  f.setReview(async()=>{started();return new Promise(r=>finish=()=>r(review()));});
  const running=f.supervisor.tick();await began;
  const status=await f.supervisor.snapshot();assert.equal(status.threads[0].status,'reviewing');
  await f.supervisor.control('research.pause',{threadId:thread.id},'pause');finish();await running;
  assert.equal(thread.status,'paused');assert.equal(f.deliveries.length,0);
});
test('off and manual steering invalidate review and survive restart without losing objective or history',async t=>{
  for(const action of ['research.off','research.steer']){
    const f=await fixture(t),thread=await f.enable();
    f.setReview(async()=>{await f.supervisor.control(action,{threadId:thread.id,confirmed:true,text:'Check the proof first.'},action);return review();});
    await f.supervisor.tick();assert.equal(f.deliveries.length,0);
    const restored=new ResearchSupervisor(f.options);await restored.transaction(()=>{});
    const saved=Object.values(restored.state.threads)[0];assert.equal(saved.config.objective,config.objective);
    assert.ok(saved.history.some(e=>e.kind===action.slice(9)));
  }
});
test('new manual completion while review is running takes priority; old decision is never submitted',async t=>{
  const f=await fixture(t);await f.enable();f.setReview(async()=>{f.observed.completion={...completion,turnId:'manual-new-turn'};return review();});
  await f.supervisor.tick();assert.equal(f.deliveries.length,0);
});
test('reserve crossed at final admission records no delivery and remains recoverable by explicit bounded approval',async t=>{
  const f=await fixture(t),thread=await f.enable();
  const original=f.runtime.command;let observations=0;
  f.runtime.command=async request=>{
    const result=await original.call(f.runtime,request);
    if(request.action==='terminal.observe'&&++observations===2)f.setPercent(19);
    return result;
  };
  await f.supervisor.tick();
  assert.equal(thread.status,'budget_paused');assert.equal(f.deliveries.length,0);
  assert.equal(thread.decisions[0].deliveryStatus,'cancelled');
  await f.supervisor.control('research.override',{confirmed:true,accountKey,threadIds:[thread.id],threshold:10,maxReviews:1},'override-before-delivery');
  assert.equal(thread.status,'waiting');
});
test('first observation at or below20 latches account-wide, notifies once, and reset/restart do not remove pause',async t=>{
  const f=await fixture(t),thread=await f.enable();f.setPercent(19);
  await f.supervisor.tick();await f.supervisor.tick();assert.equal(f.reviewCount(),0);assert.equal(thread.status,'budget_paused');
  assert.equal((await f.budget.outbox()).length,1);
  f.setTime(initial+7*86400_000);f.setCycle((initial+14*86400_000)/1000);f.setPercent(100);
  const b=new ResearchBudget({file:path.join(f.root,'budget.json'),usage:f.usage,clock:()=>initial+7*86400_000});
  await assert.rejects(b.check({accountKey,threadId:thread.id,requestId:'new-review'}),/20% reserve/);
  assert.equal((await b.outbox()).length,1);
});
test('shared budget serializes simultaneous requests; threshold reached between admissions blocks the second',async t=>{
  const f=await fixture(t);let reads=0;
  f.budget.usage={freshReading:async()=>({accountKey,remainingPercent:++reads===1?21:20,resetsAt:initial/1000+604800,cycle:1,observedAt:new Date(initial).toISOString()})};
  const results=await Promise.allSettled(['A','B'].map(threadId=>f.budget.check({accountKey,threadId,requestId:threadId})));
  assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.equal((await f.budget.outbox()).length,1);
});
test('bounded overrides bind account, thread, review count, threshold, expiry and cycle; no reset reactivation',async t=>{
  const f=await fixture(t);f.setPercent(18);
  await assert.rejects(f.budget.check({accountKey,threadId:'A',requestId:'r0'}),/20%/);
  const args={requestId:'override',accountKey,threadIds:['A'],threshold:10,maxReviews:1,confirmed:true};
  await f.budget.authorize(args);await f.budget.authorize(args);
  await assert.rejects(f.budget.check({accountKey,threadId:'B',requestId:'r1'}),/20%/);
  await f.budget.check({accountKey,threadId:'A',requestId:'r1'});
  await f.budget.check({accountKey,threadId:'A',kind:'dispatch',requestId:'d1',reviewId:'r1'});
  await assert.rejects(f.budget.check({accountKey,threadId:'A',requestId:'r2'}),/20%/);
  f.setCycle(initial/1000+604801);
  await assert.rejects(f.budget.check({accountKey,threadId:'A',kind:'dispatch',requestId:'d1',reviewId:'r1'}),/20%/);
  assert.equal((await f.budget.snapshot()).accounts[0].latched,true);
});
test('stale usage and account changes fail before any model work; threshold crossed during review blocks dispatch',async t=>{
  for(const scenario of ['stale','changed','crossed']){
    const f=await fixture(t),thread=await f.enable();
    if(scenario==='stale')f.setOffline(true);if(scenario==='changed')f.setAccount('c'.repeat(64));
    if(scenario==='crossed')f.setReview(async()=>{f.setPercent(20);return review();});
    await f.supervisor.tick();assert.equal(f.deliveries.length,0);assert.match(thread.reason,/stale|account changed|20%/);
  }
});
test('completion must satisfy every approved requirement with actual artifacts; blockers preserve obligations',async t=>{
  const f=await fixture(t),thread=await f.enable();
  f.setReview(async()=>({...review(),kind:'complete'}));await f.supervisor.tick();
  assert.equal(thread.status,'paused');assert.match(thread.reason,/obligations/);assert.equal(f.deliveries.length,0);
  const evidence=await researchEvidence({...config,evidenceRoot:f.root},completion);
  const done={...review(),kind:'complete',findings:[],requirements:[{requirement:config.requirements[0],status:'met',evidence:[{id:'evidence-1',quote:'First calculation: PASS'}]}]};
  assert.equal(validateResearchDecision(done,config,evidence).kind,'complete');
  done.requirements[0].evidence[0].quote='fabricated';assert.throws(()=>validateResearchDecision(done,config,evidence),/evidence/);
});
test('missing, binary, oversized and escaping evidence remain explicit, without reading unrelated private files',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'binary.txt'),Buffer.from([0,1]));
  const evidence=await researchEvidence({...config,evidenceRoot:f.root,evidencePaths:['missing.txt','binary.txt','../../etc/passwd']},completion);
  assert.equal(evidence.unavailable.length,3);assert.equal(evidence.documents.length,2);
});
test('native delivery admission checks durable enabled state and exact process before prepare',async t=>{
  const f=await fixture(t),thread=await f.enable();await f.supervisor.tick();
  const d=thread.decisions[0],job={id:d.jobId,args:f.deliveries[0].args,supervisor:{threadId:thread.id,revision:thread.revision,reviewId:d.reviewId}};
  await f.supervisor.permit(job);
  await f.supervisor.control('research.off',{threadId:thread.id},'off');
  await assert.rejects(f.supervisor.permit(job),/paused|steered/);
});

test('a full second completion with verified artifacts finishes the objective and switches autonomy off',async t=>{
  const f=await fixture(t),thread=await f.enable();await f.supervisor.tick();f.deliveries[0].status='completed';
  await fs.writeFile(path.join(f.root,'report.txt'),'First calculation: PASS\nSecond calculation: PASS\n');
  f.observed.completion={...completion,turnId:'turn-2',text:'Both calculations are finished. See [report](report.txt).'};
  f.setReview(async()=>({...review(),kind:'complete',prompt:'',acceptanceCriteria:[],summary:'Both calculations verified.',findings:[],
    requirements:[{requirement:config.requirements[0],status:'met',evidence:[{id:'evidence-1',quote:'First calculation: PASS\nSecond calculation: PASS'}]}]}));
  await f.supervisor.tick();assert.equal(thread.status,'complete');assert.equal(thread.enabled,false);assert.equal(f.deliveries.length,1);
  assert.equal(f.supervisor.state.events.filter(e=>e.event==='complete').length,1);
  await f.supervisor.tick();assert.equal(f.reviewCount(),2);
});
test('two attempts without meaningful progress stop, preserve failed approaches, and notify once',async t=>{
  const f=await fixture(t),thread=await f.enable();
  f.setReview(async()=>({...review(),noProgress:true,findings:[{kind:'failed_approach',text:'The attempted estimate failed.',evidence:[]}]}));
  await f.supervisor.tick();f.deliveries[0].status='completed';f.observed.completion={...completion,turnId:'turn-2'};
  await f.supervisor.tick();assert.equal(thread.status,'blocked');assert.equal(f.deliveries.length,1);
  assert.equal(thread.history.filter(e=>e.kind==='decision').length,2);
  await f.supervisor.tick();assert.equal(f.supervisor.state.events.length,1);
});
test('pausing at final ownership check prevents insertion even after a review decision was saved',async t=>{
  const f=await fixture(t),thread=await f.enable(),observe=f.supervisor.observe.bind(f.supervisor);
  f.supervisor.observe=async(...args)=>{
    const result=await observe(...args);
    if(f.reviewCount())await f.supervisor.control('research.off',{threadId:thread.id},'off-before-dispatch');
    return result;
  };
  await f.supervisor.tick();assert.equal(f.deliveries.length,0);assert.equal(thread.status,'off');
  assert.equal(thread.history.filter(e=>e.kind==='decision').length,1);
});
test('off cancels only waiting automatic delivery, keeps running work intact, and reconciles cancelled receipts',async t=>{
  for(const state of ['queued','working']){
    const f=await fixture(t),thread=await f.enable();await f.supervisor.tick();f.deliveries[0].status=state;
    await f.supervisor.control('research.off',{threadId:thread.id},'off-'+state);
    assert.equal(f.deliveries[0].status,state==='queued'?'cancelled':'working');
    assert.equal(thread.decisions[0].deliveryStatus,f.deliveries[0].status);
    if(state==='queued')await f.enable('enable-again');
  }
});
test('manual pause and verified completion are not silently resumed by the account reserve or reset',async t=>{
  const f=await fixture(t),thread=await f.enable();await f.supervisor.control('research.pause',{threadId:thread.id},'pause');
  f.setPercent(15);await f.supervisor.tick();assert.equal(thread.status,'paused');assert.match(thread.reason,/Cody/);
  f.setPercent(100);f.setCycle(initial/1000+900000);await f.supervisor.tick();assert.equal(f.reviewCount(),0);
});
test('review-process crash recovers paused with the saved source/evidence and no duplicate model call',async t=>{
  const f=await fixture(t),thread=await f.enable();thread.status='reviewing';thread.history.push({id:'crash',kind:'review',completion});await f.supervisor.save();
  const restored=new ResearchSupervisor(f.options);await restored.tick();
  const saved=Object.values(restored.state.threads)[0];assert.equal(saved.status,'paused');assert.equal(f.reviewCount(),0);
  assert.equal(saved.history.find(h=>h.id==='crash').completion.turnId,'turn-1');
});
test('notifications expose only milestone/stop metadata, never objective, response, evidence, paths or account keys',()=>{
  for(const event of ['budget','pause','milestone','complete']){
    const normalized=normalizeResearchNotification({id:'d'.repeat(64),kind:'research',event,threadId:'e'.repeat(64),sessionId:session,name:'Fixture',
      completedAt:new Date(initial).toISOString(),text:'PRIVATE RESPONSE',objective:'PRIVATE OBJECTIVE',accountKey},initial);
    const payload=researchNotificationPayload(normalized,{}, {accountId:'paired',workspaceId:'workspace',hostId:'host'});
    assert.equal(payload.clawdad.kind,'research');assert.ok(!JSON.stringify(payload).includes('PRIVATE'));assert.ok(!JSON.stringify(payload).includes(accountKey));
    assert.equal(payload.aps.category,'RESEARCH_SUPERVISOR');
  }
  assert.throws(()=>normalizeResearchNotification({kind:'research',id:'d'.repeat(64),event:'ordinary-cycle',completedAt:new Date(initial).toISOString()},initial));
});
