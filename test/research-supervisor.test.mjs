import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ResearchBudget} from '../lib/research-budget.mjs';
import {ResearchSupervisor} from '../lib/research-supervisor.mjs';
import {researchEvidence,validateResearchDecision} from '../lib/research-evidence.mjs';
import {AssistantRuntime} from '../lib/assistant-runtime.mjs';
import {normalizeResearchNotification,researchNotificationPayload} from '../cloud/push-notifications.mjs';

const accountKey='a'.repeat(64), instance='codex-process-'+ 'b'.repeat(64), session='11111111-1111-4111-8111-111111111111';
const initial=Date.parse('2026-09-09T12:00:00Z');
const config={objective:'Verify the two disposable calculations.',scope:'Only the disposable fixture directory. No external actions.',requirements:['Both calculations have verified evidence.'],evidencePaths:['report.txt']};
const completion={sessionId:session,turnId:'turn-1',text:'The first calculation is ready. See [report](report.txt).',completedAt:new Date(initial).toISOString(),inProgress:false};
const observation={verified:true,tabId:'tab-A',tty:'/dev/ttys099',sessionId:session,agentInstanceId:instance,conversationPath:'/fixture/rollout.jsonl',tabTitle:'Fixture',directory:'/fixture',isBusy:false,completion};
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
    state:{paused:false},async command(request){
      if(request.action==='terminal.observe')return {job:{status:'completed',result:structuredClone(observed)}};
      if(jobs.has(request.requestId))return {job:jobs.get(request.requestId)};
      const j={id:request.requestId,args:request,status:'queued'};jobs.set(j.id,j);deliveries.push(j);return {job:j};
    },async job(id){return jobs.get(id);},async researchHasManualWork(){return manual;},
    async cancelResearchWaiting(){for(const j of jobs.values())if(j.status==='queued')j.status='cancelled';},
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
