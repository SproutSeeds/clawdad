import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Readable,Writable} from 'node:stream';
import {AssistantAppServer} from '../lib/assistant-app-server.mjs';
import {AssistantRuntime} from '../lib/assistant-runtime.mjs';
import {assistantTools,runAssistantMCP} from '../lib/assistant-mcp.mjs';
import {assistantWorkspaceInstructions} from '../lib/assistant-coordinator.mjs';
import {accountWorkEvidence} from '../lib/codex-account-work-evidence.mjs';
import {captureAccountAppServerLocal} from '../lib/codex-app-account-runtime.mjs';
import {CodexAppAccounts} from '../lib/codex-app-accounts.mjs';
import {readSharedControlGeneration} from '../lib/codex-thread-control.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-turn-control-test-'));
  const threadId=randomUUID(),turnId=randomUUID(),otherId=randomUUID();
  const thread={id:threadId,cwd:root,canAcceptDirectInput:true,status:{type:'active',activeFlags:[]},turns:[{id:turnId,status:'inProgress',items:[]}]};
  const other={id:otherId,cwd:root,canAcceptDirectInput:true,status:{type:'active'},turns:[{id:randomUUID(),status:'inProgress',items:[]}]};
  const threads=new Map([[threadId,thread],[otherId,other]]),calls=[],queue=[{id:randomUUID(),clientUserMessageId:randomUUID(),input:[{type:'text',text:'Future task'}]}];
  let owners=[{pid:40,tty:'??',socket:true,threads:[threadId,otherId]}],clock=100000;
  const generation={computer:'synthetic-Mac',uid:501,endpoint:'/fixture/socket',providerHome:'/fixture/home',pid:40,processLifetime:'lifetime-1',socketGeneration:'inode-1'};
  const f={root,threadId,turnId,thread,otherId,other,threads,calls,queue,generation,lose:false,visible:true,autoInterrupt:true,
    owners:()=>owners,setOwners:value=>{owners=value;},advance:ms=>{clock+=ms;},epoch:7};
  const client={connectionIdentity:{id:'connection-1'},socketPath:'/fixture/socket',close(){},discardServerRequest(id){f.discarded=id;},
    async request(method,args={}){
      calls.push({method,args:structuredClone(args)});
      if(f.readHook)await f.readHook(method,args);
      if(method==='thread/read')return {thread:structuredClone(threads.get(args.threadId))};
      if(method==='thread/loaded/list')return {data:[...threads.keys()],nextCursor:null};
      if(method==='thread/queue/list')return {data:structuredClone(queue),nextCursor:null};
      throw Error('Unexpected read RPC '+method);
    },async requestPinned(method,args,pin){
      const saved=JSON.parse(await fs.readFile(path.join(root,'state.json'),'utf8')).jobs.find(j=>j.id===args.clientUserMessageId||j.controlReceipt?.rpcRequestId===pin.requestId);
      assert.equal(saved.controlReceipt.state,'sent_unconfirmed','fsynced intent precedes wire dispatch');
      assert.equal(pin.connectionId,client.connectionIdentity.id);
      const enqueue=()=>({response:(async()=>{
        calls.push({method,args:structuredClone(args),pin});
        if(f.onWire)return f.onWire(method,args,pin);
        if(method==='turn/steer'){
          if(f.visible)thread.turns[0].items.push({id:randomUUID(),type:'userMessage',clientId:args.clientUserMessageId,content:args.input});
          if(f.lose)throw Object.assign(Error('Lost acknowledgment'),{uncertain:true});
          return {turnId:f.ackTurn||turnId};
        }
        if(method==='turn/interrupt'){
          if(f.autoInterrupt){thread.turns[0].status='interrupted';thread.status={type:'idle'};}
          if(f.lose)throw Object.assign(Error('Lost acknowledgment'),{uncertain:true});
          return {};
        }
        throw Error('Forbidden mutation '+method);
      })()});
      let handle;try{handle=await pin.dispatch(enqueue);}catch(error){error.notSent=true;throw error;}
      return handle.response;
    }};
  const options={root,client,readIndex:async()=>[],readOwners:async()=>owners,readControlGeneration:async()=>structuredClone(generation),now:()=>clock,
    lease:async()=>{f.leases=(f.leases||0)+1;return {release:async()=>{f.released=(f.released||0)+1;}};},
    deliveryLease:async()=>{throw Error('A live turn control must never wait on the delivery lease');},mayDispatch:()=>!f.paused};
  const make=()=>{const app=new AssistantAppServer(options);app.start=()=>{};return app;};
  const app=make();Object.assign(f,{client,options,app,make});
  f.args=async(action='steer')=>({threadId,...(action==='steer'?{expectedTurnId:turnId,text:'  Exact context\r\n🧪 e\u0301  '}:{turnId}),
    targetToken:(await app.inspect(threadId)).targetToken,approvalText:action==='steer'?'Steer that exact active turn now.':'Stop that exact active turn now.'});
  f.authorize=(args,action='appserver.steer')=>({authorize:async dispatch=>{const authority={source:'top_level_assistant',userRequestId:'current-user',
    userTextHash:hash(args.approvalText),approvalText:args.approvalText,action,threadId:args.threadId,turnId:args.expectedTurnId||args.turnId};return dispatch?dispatch(authority):authority;}});
  f.control=async(args,requestId=randomUUID(),action='appserver.steer',appInstance=app)=>appInstance.control(action,args,requestId,f.authorize(args,action));
  f.wire=()=>calls.filter(c=>c.method.startsWith('turn/'));
  t.after(async()=>{await app.close();await fs.rm(root,{recursive:true,force:true});});
  return f;
}

test('inspect exposes an exact active turn and generation-bound controls without a mutation',async t=>{
  const f=await fixture(t),i=await f.app.inspect(f.threadId);
  assert.equal(i.activeTurn.id,f.turnId);assert.equal(i.canSteer,true);assert.equal(i.canInterrupt,true);assert.equal(i.expiresInSeconds,45);
  assert.ok(i.observedAt);assert.deepEqual(i.activeFlags,[]);assert.deepEqual(f.wire(),[]);
  f.thread.canAcceptDirectInput=false;const blocked=await f.app.inspect(f.threadId);assert.equal(blocked.canSteer,false);assert.equal(blocked.canInterrupt,true);
  f.thread.turns.push({id:randomUUID(),status:'inProgress',items:[]});assert.equal((await f.app.inspect(f.threadId)).canInterrupt,false);
});

test('missing full history retains ordinary inspection but withholds exact-turn controls',async t=>{
  const f=await fixture(t);f.readHook=async(method,args)=>{if(method==='thread/read'&&args.includeTurns)throw Error('list_turns is not supported yet');};
  const inspected=await f.app.inspect(f.threadId);assert.equal(inspected.capabilities.read,true);assert.equal(inspected.canSteer,false);assert.equal(inspected.canInterrupt,false);
  assert.match(inspected.controlUnavailable,/list_turns/);assert.equal(f.app.inspections.get(inspected.targetToken).control,null);
});

test('recorded steering retains its delivery proof while the original turn outcome advances separately',async t=>{
  const f=await fixture(t),args=await f.args(),{job}=await f.control(args),evidence=job.controlReceipt.evidence;
  f.thread.turns[0].status='interrupted';f.thread.status={type:'idle'};
  const updated=(await f.app.reconcile(job.id)).job;
  assert.equal(updated.controlReceipt.state,'observed_in_turn');assert.equal(updated.result.targetTurnStatus,'interrupted');assert.deepEqual(updated.controlReceipt.evidence,evidence);
  assert.equal(updated.response,undefined);assert.equal(f.wire().length,1);
});

test('steer is recorded in the exact turn once; intent survives concurrent callers, token expiry and restart',async t=>{
  const f=await fixture(t),args=await f.args(),id=randomUUID();
  await f.app.load();f.app.state.drafts[f.threadId]={revision:3,text:'Untouched draft',images:[{path:'/fixture/image'}]};
  f.app.state.jobs.push({id:'waiting',action:'appserver.queue',threadId:f.threadId,status:'queued',settings:{model:'selected',effort:'high'}});
  const draft=structuredClone(f.app.state.drafts),queue=structuredClone(f.queue);
  const responses=await Promise.all([f.control(args,id),f.control(args,id)]);
  for(const {job} of responses){assert.equal(job.controlReceipt.state,'observed_in_turn');assert.equal(job.result.targetTurnStatus,'inProgress');assert.equal(job.response,undefined);}
  assert.equal(f.wire().length,1);assert.deepEqual(f.wire()[0].args.input,[{type:'text',text:args.text}]);
  assert.deepEqual(f.app.state.drafts,draft);assert.deepEqual(f.queue,queue);assert.deepEqual(responses[0].job.result.remainingWork.localWaitingRequestIds,['waiting']);
  assert.equal(f.leases,f.released);
  f.advance(100000);const reloaded=f.make();t.after(()=>reloaded.close());
  assert.equal((await f.control({...args,targetToken:'expired-token'},id,'appserver.steer',reloaded)).job.controlReceipt.state,'observed_in_turn');
  assert.equal(f.wire().length,1);
  await assert.rejects(f.control({...args,text:'Changed'},id),/different action/);
  assert.equal(f.app.state.jobs.find(j=>j.id==='waiting').settings.effort,'high');
});

test('expired, consumed, wrong-thread and wrong-turn inspections fail closed',async t=>{
  for(const kind of ['expired','consumed','thread','turn'])await t.test(kind,async t=>{
    const f=await fixture(t),args=await f.args();
    if(kind==='expired')f.advance(45001);
    if(kind==='consumed')f.app.inspections.delete(args.targetToken);
    if(kind==='thread')args.threadId=f.otherId;
    if(kind==='turn')args.expectedTurnId=f.other.turns[0].id;
    const {job}=await f.control(args);assert.equal(job.controlReceipt.state,'rejected');assert.equal(f.wire().length,0);
  });
});

test('process lifetime, socket, home, computer and account epoch changes fence dispatch even with the same PID',async t=>{
  for(const key of ['processLifetime','socketGeneration','providerHome','computer','epoch'])await t.test(key,async t=>{
    const f=await fixture(t);f.app.accountControls={admission:async()=>({epoch:f.epoch,allowed:true})};
    const args=await f.args();if(key==='epoch')f.epoch++;else f.generation[key]+='-replacement';
    const {job}=await f.control(args);assert.equal(job.controlReceipt.state,'rejected');assert.equal(job.reasonCode,'server_generation_changed');assert.equal(f.wire().length,0);
  });
});

test('Terminal, background, ambiguous and unavailable owner evidence forbid active control',async t=>{
  for(const kind of ['terminal','background','ambiguous','missing','failed'])await t.test(kind,async t=>{
    const f=await fixture(t),args=await f.args();
    if(kind==='missing')f.setOwners([]);
    else if(kind==='failed')f.app.readOwners=async()=>{throw Error('Census unavailable');};
    else f.setOwners([...f.owners(),{pid:81,tty:kind==='terminal'?'ttys002':'??',socket:kind==='ambiguous',threads:[f.threadId]}]);
    const {job}=await f.control(args);assert.equal(job.controlReceipt.state,'rejected');assert.equal(f.wire().length,0);
  });
});

test('natural completion and a successor between inspection and dispatch never receive replacement controls',async t=>{
  for(const operation of ['steer','interrupt'])for(const successor of [false,true])await t.test(operation+':'+successor,async t=>{
    const f=await fixture(t),args=await f.args(operation);f.thread.turns[0].status='completed';f.thread.status={type:'idle'};
    if(successor){f.thread.turns.push({id:randomUUID(),status:'inProgress',items:[]});f.thread.status={type:'active'};}
    const {job}=await f.control(args,randomUUID(),'appserver.'+operation);
    assert.equal(job.controlReceipt.state,operation==='interrupt'&&!successor?'already_finished':'rejected');assert.equal(f.wire().length,0);
  });
});

test('atomic provider rejection catches the final race and unsupported methods become unavailable',async t=>{
  for(const code of [-32600,-32601])await t.test(String(code),async t=>{
    const f=await fixture(t),args=await f.args();f.onWire=async()=>{throw Object.assign(Error('Provider rejected exact turn'),{rpcCode:code});};
    const {job}=await f.control(args);assert.equal(job.controlReceipt.state,'rejected');assert.equal(f.wire().length,1);
    assert.equal((await f.app.inspect(f.threadId)).canSteer,code!==-32601);
    assert.equal((await f.app.inspect(f.threadId)).canInterrupt,true);
  });
});

test('an interrupt rejected after natural completion records already_finished without touching a successor',async t=>{
  const f=await fixture(t),args=await f.args('interrupt');
  f.onWire=async()=>{f.thread.turns[0].status='completed';f.thread.turns.push({id:randomUUID(),status:'inProgress',items:[]});
    throw Object.assign(Error('The active turn changed'),{rpcCode:-32600});};
  const {job}=await f.control(args,randomUUID(),'appserver.interrupt');
  assert.equal(job.controlReceipt.state,'already_finished');assert.equal(job.result.interruptionObserved,false);
  assert.equal(job.controlReceipt.evidence.source,'thread/read_after_rejection');assert.equal(f.thread.turns[1].status,'inProgress');assert.equal(f.wire().length,1);
});

test('lost steer acknowledgment with initially absent history resolves after reconnect without another RPC',async t=>{
  const f=await fixture(t),args=await f.args(),id=randomUUID();f.lose=true;f.visible=false;
  assert.equal((await f.control(args,id)).job.controlReceipt.state,'uncertain');
  const reloaded=f.make();t.after(()=>reloaded.close());await reloaded.load();f.client.connectionIdentity.id='reconnected';
  assert.equal((await reloaded.reconcile(id)).job.controlReceipt.state,'uncertain');
  await f.control(args,id,'appserver.steer',reloaded);assert.equal(f.wire().length,1);
  f.thread.turns[0].items.push({id:'observed-context',type:'userMessage',clientId:id,content:[{type:'text',text:args.text}]});
  const recovered=await reloaded.reconcile(id);assert.equal(recovered.job.controlReceipt.state,'observed_in_turn');assert.equal(recovered.job.controlReceipt.evidence.itemId,'observed-context');assert.equal(f.wire().length,1);
});

test('accepted steering waits for input evidence; original turn completion alone never proves delivery',async t=>{
  const f=await fixture(t),args=await f.args(),id=randomUUID();f.visible=false;
  let result=await f.control(args,id);assert.equal(result.job.controlReceipt.state,'accepted_same_turn');assert.equal(result.job.result.recordedInput,false);
  f.thread.turns[0].status='completed';f.thread.status={type:'idle'};
  result=await f.app.reconcile(id);assert.equal(result.job.controlReceipt.state,'uncertain');assert.equal(result.job.controlReceipt.targetTurnStatus,'completed');
  assert.equal(f.wire().length,1);
});

test('wrong acknowledgment and duplicate, wrong-turn or altered input evidence remain uncertain',async t=>{
  for(const kind of ['ack','duplicate','wrong-turn','text'])await t.test(kind,async t=>{
    const f=await fixture(t),args=await f.args(),id=randomUUID();f.visible=false;
    if(kind==='ack')f.ackTurn=randomUUID();
    else {const item={id:'evidence',type:'userMessage',clientId:id,content:[{type:'text',text:kind==='text'?'Altered':args.text}]};
      f.thread.turns.push({id:kind==='wrong-turn'?randomUUID():f.turnId,status:'completed',items:kind==='duplicate'?[item,item]:[item]});}
    const {job}=await f.control(args,id);assert.equal(job.controlReceipt.state,'uncertain');assert.equal(f.wire().length,1);
  });
});

test('interrupt distinguishes acknowledgment, actual interruption, natural finish and unrelated events',async t=>{
  const f=await fixture(t),args=await f.args('interrupt'),id=randomUUID();f.autoInterrupt=false;
  let {job}=await f.control(args,id,'appserver.interrupt');assert.equal(job.controlReceipt.state,'interrupt_requested');
  assert.equal(job.result.cancellation.request,'acknowledged');
  assert.equal(job.result.cancellation.turn,'inProgress');
  assert.equal(job.result.cancellation.nativeCommandTermination,'unknown');
  assert.equal(job.result.cancellation.downstreamToolTermination,'unknown');
  f.client.onNotification({method:'turn/completed',params:{threadId:f.otherId,turn:{id:f.other.turns[0].id,status:'interrupted'}}});await f.app.polling;
  assert.equal(f.app.state.jobs.find(j=>j.id===id).controlReceipt.state,'interrupt_requested');
  f.thread.turns[0].status='interrupted';f.thread.status={type:'idle'};
  job=(await f.app.reconcile(id)).job;assert.equal(job.controlReceipt.state,'interrupted_observed');assert.equal(job.result.interruptionObserved,true);
  assert.equal(job.result.cancellation.turn,'interrupted');
  assert.equal(job.result.cancellation.nativeCommandTermination,'unknown');
  assert.equal(job.result.cancellation.downstreamToolTermination,'unknown');
  assert.equal(job.result.cancellation.rollbackPerformed,false);
  assert.match(job.result.summary,/termination are unverified/);
  assert.equal(f.wire().length,1);assert.equal(f.queue.length,1);
  const g=await fixture(t),naturalArgs=await g.args('interrupt');g.autoInterrupt=false;
  const natural=await g.control(naturalArgs,randomUUID(),'appserver.interrupt');g.thread.turns[0].status='completed';g.thread.status={type:'idle'};
  assert.equal((await g.app.reconcile(natural.job.id)).job.controlReceipt.state,'already_finished');
});

test('lost interrupt reply and idle timeout use exact terminal readback without a second interrupt',async t=>{
  for(const outcome of ['interrupted','completed','inProgress'])await t.test(outcome,async t=>{
    const f=await fixture(t),args=await f.args('interrupt'),id=randomUUID();f.autoInterrupt=false;f.lose=true;
    assert.equal((await f.control(args,id,'appserver.interrupt')).job.controlReceipt.state,'uncertain');
    f.thread.turns[0].status=outcome;
    const state=(await f.app.reconcile(id)).job.controlReceipt.state;
    assert.equal(state,outcome==='interrupted'?'interrupted_observed':outcome==='completed'?'already_finished':'uncertain');
    await f.control(args,id,'appserver.interrupt');assert.equal(f.wire().length,1);
  });
});

test('server generation change during uncertain recovery requires review and never replays',async t=>{
  const f=await fixture(t),args=await f.args(),id=randomUUID();f.lose=true;f.visible=false;await f.control(args,id);
  f.generation.socketGeneration='replacement-socket';
  const {job}=await f.app.reconcile(id);assert.equal(job.controlReceipt.state,'uncertain');assert.equal(job.controlReceipt.recoveryRequired,true);
  await f.control(args,id);assert.equal(f.wire().length,1);
});

test('steering cannot claim approvals for another client or cancel accepted work as waiting',async t=>{
  const f=await fixture(t),args=await f.args();f.visible=false;
  const {job}=await f.control(args);
  await f.app.recordApproval({id:'other-clients-permission',method:'item/commandExecution/requestApproval',params:{threadId:f.threadId,turnId:f.turnId}});
  assert.equal(f.discarded,'other-clients-permission');assert.equal(job.pendingApproval,undefined);
  await assert.rejects(f.app.cancelWaiting(job.id),/explicit interrupt/);assert.equal(f.wire().length,1);
});

test('manual pause, revoked authorization and attachments preserve the active turn and drafts',async t=>{
  const f=await fixture(t),args=await f.args();f.paused=true;
  assert.equal((await f.control(args)).job.controlReceipt.state,'rejected');assert.equal(f.wire().length,0);
  f.paused=false;let calls=0;const meta=f.authorize(args);const original=meta.authorize;
  meta.authorize=async()=>{if(++calls===2)throw Error('User cancelled current instruction');return original();};
  const again=await f.args();assert.equal((await f.app.control('appserver.steer',again,randomUUID(),meta)).job.controlReceipt.state,'rejected');
  await assert.rejects(f.control({...again,paths:['/fixture/image.png']}),/literal text only/);
  assert.equal(f.wire().length,0);
});

test('a pause at the durable wire boundary blocks dispatch under the final authorization check',async t=>{
  const f=await fixture(t),args=await f.args(),meta=f.authorize(args),authorize=meta.authorize;
  const save=f.app.save.bind(f.app);let paused=false;
  f.app.save=async()=>{await save();if(f.app.state.jobs.some(j=>j.controlReceipt?.state==='sent_unconfirmed'))paused=true;};
  meta.authorize=async dispatch=>{if(paused)throw Error('Mac control was paused before sending');return authorize(dispatch);};
  const {job}=await f.app.control('appserver.steer',args,randomUUID(),meta);
  assert.equal(job.controlReceipt.state,'rejected');assert.equal(job.controlReceipt.dispatchDisposition,'not_sent');assert.equal(f.wire().length,0);
});

test('failed durable preparation sends nothing and internal provider errors stay uncertain',async t=>{
  const f=await fixture(t),args=await f.args(),save=f.app.save.bind(f.app);let failed=false;
  f.app.save=async()=>{if(!failed&&f.app.state.jobs.some(j=>j.controlReceipt?.state==='sent_unconfirmed')){failed=true;throw Error('Synthetic fsync failure');}return save();};
  const {job}=await f.control(args);assert.equal(job.controlReceipt.state,'rejected');assert.equal(f.wire().length,0);
  const g=await fixture(t);g.onWire=async()=>{throw Object.assign(Error('Internal provider failure'),{rpcCode:-32603});};
  const internal=await g.control(await g.args());assert.equal(internal.job.controlReceipt.state,'uncertain');assert.equal(g.wire().length,1);
});

test('prepared and possibly-sent crash recovery never dispatches either receipt',async t=>{
  for(const sent of [false,true])await t.test(String(sent),async t=>{
    const f=await fixture(t),args=await f.args(),id=randomUUID();f.visible=false;await f.control(args,id);
    const job=f.app.state.jobs.find(j=>j.id===id);job.controlReceipt.state=sent?'sent_unconfirmed':'prepared';job.status='sending';
    if(!sent)delete job.controlReceipt.sentAt;
    await f.app.save();const reloaded=f.make();t.after(()=>reloaded.close());
    const saved=(await f.control(args,id,'appserver.steer',reloaded)).job;
    assert.equal(saved.controlReceipt.state,sent?'uncertain':'rejected');assert.equal(f.wire().length,1);
  });
});

test('unresolved controls hold app-only account activation; rejected controls do not hold it',async t=>{
  const f=await fixture(t),args=await f.args(),id=randomUUID();f.visible=false;f.lose=true;
  const {job}=await f.control(args,id);assert.equal(accountWorkEvidence(job).status,'sending');
  assert.equal((await captureAccountAppServerLocal(f.root,f.threadId)).receiptsResolved,false);
  const rejected=await f.control({...args,targetToken:'consumed'},randomUUID());assert.equal(accountWorkEvidence(rejected.job).status,'not_dispatched');
  f.thread.turns[0].items.push({type:'userMessage',clientId:id,content:[{type:'text',text:args.text}]});await f.app.reconcile(id);
  assert.equal((await captureAccountAppServerLocal(f.root,f.threadId)).receiptsResolved,true);
});

test('strict controls use app account admission with the inspected epoch and never accept held work',async t=>{
  const f=await fixture(t),admissions=[];
  f.app.accountControls={admission:async()=>({allowed:true,epoch:3}),withWorkAdmission:async(options,persist)=>{
    admissions.push(options);return persist({accountEpoch:3,accountWorkId:options.id});},assertDelivery:async()=>({allowed:true,epoch:3})};
  const args=await f.args();await f.control(args);
  assert.equal(admissions[0].expectedEpoch,3);assert.equal(admissions[0].allowHold,undefined);
  f.app.accountControls.withWorkAdmission=async()=>{throw Object.assign(Error('Account activation holds new work'),{code:'account_switch_pending'});};
  const blocked=await f.control(await f.args());assert.equal(blocked.job.controlReceipt.state,'rejected');assert.equal(f.wire().length,1);
});

test('accepted Assistant continuation can interrupt its old app epoch during preflight drain; Terminal stays independent',async t=>{
  const f=await fixture(t),parent=[];
  const accounts=new CodexAppAccounts({root:path.join(f.root,'Accounts'),lease:async()=>({release:async()=>{}}),
    readWork:async()=>({complete:true,jobs:[...parent,...(f.app.state?.jobs||[]).map(j=>({...j,...accountWorkEvidence(j)}))]})});
  f.app.accountControls=accounts;
  await accounts.withWorkAdmission({id:'current-user',action:'message',fingerprint:'current-user-fingerprint'},async stamp=>{
    const p={id:'current-user',action:'message',fingerprint:'current-user-fingerprint',status:'running',...stamp};parent.push(p);return p;
  });
  const args=await f.args('interrupt');
  await accounts.transaction(async(state,save)=>{state.operations.fixture={id:'fixture',phase:'preflight',fenced:true};state.activeOperationId='fixture';await save();});
  assert.equal((await accounts.admission()).allowed,false);
  const {job}=await f.app.control('appserver.interrupt',args,randomUUID(),{...f.authorize(args,'appserver.interrupt'),accountParentRequestId:'current-user'});
  assert.equal(job.controlReceipt.state,'interrupted_observed');assert.equal(job.accountEpoch,0);assert.equal((await accounts.admission()).epoch,0);
  assert.equal((await accounts.deliveryAdmission({action:'terminal.send'})).allowed,true);
  const drain=await accounts.workDrain();assert.deepEqual(drain.pending.map(j=>j.id),['current-user']);
});

test('Assistant runtime binds authorization to the active user request and blocks stale or non-user authority',async t=>{
  const f=await fixture(t),runtime=new AssistantRuntime({root:path.join(f.root,'Assistant'),coordinator:{stop(){}}});
  t.after(()=>runtime.close());await runtime.load();runtime.appServer=f.app;
  runtime.state.enabled=true;runtime.state.coordinator={activeRequestId:'current-user'};
  const user={id:'current-user',action:'message',status:'running',source:'user',runtimeInstanceId:runtime.instanceId,args:{text:'Stop that exact active turn now.'}};
  runtime.state.jobs.push(user);
  const args=await f.args('interrupt'),request={action:'appserver.interrupt',...args,requestId:randomUUID(),coordinatorRequestId:user.id};
  user.source='assistant';await assert.rejects(runtime.command(request,{tool:true}),/explicit current/);
  user.source='user';await assert.rejects(runtime.command({...request,approvalText:'Fabricated instruction'},{tool:true}),/explicit current/);
  const result=await runtime.command(request,{tool:true});assert.equal(result.job.controlReceipt.authorization.userRequestId,user.id);
  assert.equal(result.job.controlReceipt.state,'interrupted_observed');assert.equal(f.wire().length,1);
  runtime.state.paused=true;assert.equal((await runtime.command(request,{tool:true})).job.controlReceipt.state,'interrupted_observed');
  user.status='completed';await assert.rejects(runtime.command({...request,requestId:randomUUID()},{tool:true}),/no longer active/);
});

test('MCP schemas, dispatch and both instruction surfaces expose explicit exact-turn controls',async t=>{
  const f=await fixture(t);await fs.mkdir(path.join(f.root,'Assistant'));
  await fs.writeFile(path.join(f.root,'Assistant/connection.json'),JSON.stringify({baseURL:'http://127.0.0.1:4488'}));
  await fs.writeFile(path.join(f.root,'native-server.token'),'synthetic-token');
  const args=await f.args(),frames=[],requests=[];
  await runAssistantMCP({root:f.root,coordinatorRequestId:'source-user',input:Readable.from([
    JSON.stringify({id:1,method:'initialize'}),JSON.stringify({id:2,method:'tools/list'}),
    JSON.stringify({id:3,method:'tools/call',params:{name:'steer_thread',arguments:{...args,requestId:randomUUID()}}}),
    JSON.stringify({id:4,method:'tools/call',params:{name:'interrupt_thread',arguments:{...await f.args('interrupt'),requestId:randomUUID()}}})].map(s=>s+'\n')),
    output:new Writable({write(chunk,_,done){frames.push(JSON.parse(chunk));done();}}),fetchImpl:async(_,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({job:{id:'receipt'}})};}});
  assert.deepEqual(requests.map(r=>r.action),['appserver.steer','appserver.interrupt']);assert.ok(requests.every(r=>r.coordinatorRequestId==='source-user'));
  for(const name of ['steer_thread','interrupt_thread']){const tool=assistantTools.find(t=>t[0]===name);assert.equal(tool[2].additionalProperties,false);assert.ok(tool[2].required.includes('approvalText'));}
  assert.ok(assistantTools.find(t=>t[0]==='steer_thread')[2].required.includes('expectedTurnId'));
  assert.match(frames[0].result.instructions,/server does not deduplicate steer/);assert.match(assistantWorkspaceInstructions(),/interrupted_observed/);
});

test('generation evidence combines process start, connected PID, socket lifetime and provider home',async()=>{
  const socket={dev:2,ino:7,birthtimeMs:10,ctimeMs:11,uid:process.getuid(),mode:0o600,isSocket:()=>true,isSymbolicLink:()=>false};
  const client={socketPath:'/fixture/socket',connectionIdentity:{socketIdentity:'2:7:10:11'},info:{codexHome:'/fixture/home'},request:async()=>({process:{id:42}})};
  const options={run:async()=>({stdout:`42 ${process.getuid()} Thu Sep 17 12:34:56 2026 /fixture/codex\n`}),stat:async()=>socket,canonical:async value=>value};
  const first=await readSharedControlGeneration(client,{kind:'app_server',pid:42},options);
  const next=await readSharedControlGeneration(client,{kind:'app_server',pid:42},{...options,run:async()=>({stdout:`42 ${process.getuid()} Thu Sep 17 12:34:57 2026 /fixture/codex\n`})});
  assert.notEqual(first.processLifetime,next.processLifetime);
  client.request=async()=>({process:{id:43}});await assert.rejects(readSharedControlGeneration(client,{kind:'app_server',pid:42},options),/connected server/);
});
