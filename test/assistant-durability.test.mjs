import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {AssistantRuntime,assistantHttp} from '../lib/assistant-runtime.mjs';
import {AssistantWorkProgress} from '../lib/assistant-work-policy.mjs';
import {deliverNotificationOutboxes} from '../lib/notification-outbox-delivery.mjs';

const conversation='11111111-1111-4111-8111-111111111111';
const catalog={revision:1,tabs:[]};
async function fixture(t,run) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'assistant-durable-'));
  const coordinator={prepare:async()=>({}),run,stop(){}};
  const runtime=new AssistantRuntime({root,coordinator,notificationIdentity:async()=>({accountId:'account',workspaceId:'work',hostId:'mac'})});
  t.after(async()=>{await runtime.close();await fs.rm(root,{recursive:true,force:true});});
  await runtime.command({action:'start',requestId:'start'});
  await runtime.nativePoll({catalog});
  return runtime;
}
const immediate=()=>new Promise(r=>setImmediate(r));

test('unavailable allowance outbox cannot block Assistant or research alerts, and only relay acceptance is acknowledged',async()=>{
  const sent=[],ack=[];let accepted=false;
  const deps={hostName:'Studio',local:async(route,body)=>{
    if(route.includes('weekly-usage'))throw Error('temporarily unavailable');
    if(body){ack.push([route,JSON.parse(body.body).id]);return {};}
    return {events:[{id:route.includes('/research/')?'research':'assistant'}]};
  },relay:async event=>{sent.push(event.id);return {accepted};}};
  await deliverNotificationOutboxes(deps);assert.deepEqual(sent,['research','assistant']);assert.deepEqual(ack,[]);
  accepted=true;await deliverNotificationOutboxes(deps);
  assert.deepEqual(ack,[['/v1/assistant/research/delivered','research'],['/v1/assistant/notifications/delivered','assistant']]);
});

test('useful work outlives three minutes; repeated events and invalid bytes do not renew progress',()=>{
  let clock=0;const p=new AssistantWorkProgress({clock:()=>clock});
  p.observe({type:'thread.started',thread_id:conversation});clock=190_000;
  assert.equal(p.status().stalled,false);assert.equal(p.status().stage,'quiet');
  p.observe({type:'item.started',item:{id:'tool',type:'mcp_tool_call'}});
  clock+=600_000;assert.equal(p.observe({type:'item.started',item:{id:'tool',type:'mcp_tool_call'}}),false);
  assert.equal(p.observe({type:'heartbeat'}),false);
  clock+=1_200_001;assert.equal(p.status().stalled,true);
  const startup=new AssistantWorkProgress({clock:()=>clock});clock+=180_001;assert.equal(startup.status().stalled,true);
});

test('accepted turn finishes independently of phone state and creates one final saved outbox event',async t=>{
  let finish,entered=false,calls=0;
  const r=await fixture(t,async({onSession,onMessage})=>{
    calls++;await onSession(conversation);await onMessage({id:'commentary',text:'Checking…'});entered=true;
    await new Promise(resolve=>{finish=resolve;});await onMessage({id:'final',text:'Exact final Ω reply'});
  });
  const request={action:'message',requestId:'a',text:'One authorized request'};
  await r.command(request);while(!entered)await immediate();
  assert.deepEqual(await r.notificationOutbox(),[]);
  const disk=JSON.parse(await fs.readFile(path.join(r.root,'state.json'),'utf8'));
  assert.equal(disk.jobs.find(j=>j.id==='a').status,'running');
  // No phone, native heartbeat, call or foreground callback is required to finish.
  r.nativeSeen=0;r.observation=null;finish();await r.drainTask;
  const [event]=await r.notificationOutbox();assert.equal(event.kind,'assistant_reply');
  assert.equal(event.replyId,'assistant:a:final');
  assert.equal((await r.command(request)).job.status,'completed');assert.equal(calls,1);
  const reply=await r.command({action:'reply',requestId:'open',conversationId:r.state.conversationId,messageRequestId:'a',replyId:event.replyId});
  assert.equal(reply.assistantReply.message.text,'Exact final Ω reply');
  await assert.rejects(r.command({action:'reply',requestId:'bad',conversationId:conversation,messageRequestId:'a',replyId:event.replyId}),/different/);
  await assert.rejects(r.command({action:'reply',requestId:'bad',conversationId:r.state.conversationId,messageRequestId:'a',replyId:'assistant:a:commentary'}),/exact saved/);
  assert.deepEqual(await r.notificationOutbox(),[event]);
  r.notificationIdentity=async()=>({accountId:'new-account',workspaceId:'other-work',hostId:'other-host'});
  assert.equal((await r.notificationOutbox())[0].accountId,'account','Changing the paired account cannot retarget an accepted completion');
  const recovered=new AssistantRuntime({root:r.root,coordinator:{stop(){}}});
  assert.deepEqual(await recovered.notificationOutbox(),[event]);
  await recovered.notificationDelivered(event.id);await recovered.notificationDelivered(event.id);
  assert.deepEqual(await recovered.notificationOutbox(),[]);await recovered.close();
});

test('failed acceptance persistence never exposes a queued receipt or launches unsaved work',async t=>{
  let calls=0;const r=await fixture(t,async({onSession,onMessage})=>{calls++;await onSession(conversation);await onMessage({id:'final',text:'once'});});
  const request={action:'message',requestId:'save-failure',text:'Keep this original draft'};
  const save=r.save.bind(r);r.save=async()=>{throw Error('Synthetic storage failure');};
  await assert.rejects(r.command(request),/storage failure/);
  assert.equal(r.state.jobs.some(j=>j.id===request.requestId),false);assert.equal(calls,0);
  r.save=save;await r.command(request);await r.drainTask;
  assert.equal((await r.job(request.requestId)).status,'completed');assert.equal(calls,1);
});
test('a failed final checkpoint never emits a completion notification or replays the work',async t=>{
  let calls=0;const r=await fixture(t,async({onSession,onMessage})=>{calls++;await onSession(conversation);await onMessage({id:'final',text:'Retain the saved result'});});
  const save=r.save.bind(r);r.save=async()=>{
    if(r.state.jobs.some(j=>j.id==='final-save'&&j.status==='completed'))throw Error('Synthetic final checkpoint failure');
    return save();
  };
  await r.command({action:'message',requestId:'final-save',text:'Once'});await r.drainTask;
  assert.equal((await r.job('final-save')).status,'interrupted');assert.equal(calls,1);
  assert.deepEqual(await r.notificationOutbox(),[]);
  assert.equal(r.state.messages.at(-1).text,'Retain the saved result');
});

test('explicit cancel stops only the main request, preserves accepted project work, and rejects late tools',async t=>{
  let started=false;
  const r=await fixture(t,async({signal,onMessage})=>{
    started=true;await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
    await onMessage({id:'late',text:'Must not become a completed reply'});
  });
  await r.command({action:'message',requestId:'cancel-me',text:'Work'});while(!started)await immediate();
  const context={coordinatorRequestId:'cancel-me'};
  await r.command({action:'terminal.send',requestId:'pending-tool',tabId:'one',text:'authorized',...context},{tool:true});
  r.state.jobs.push({id:'already-working',action:'terminal.send',status:'working',parentRequestId:'cancel-me',args:{text:'existing'}});
  await r.command({action:'cancel',requestId:'cancel',jobId:'cancel-me'});await r.drainTask;
  assert.equal((await r.job('cancel-me')).status,'cancelled');
  assert.equal((await r.job('pending-tool')).status,'cancelled');
  assert.equal((await r.job('already-working')).status,'working');
  assert.deepEqual(await r.notificationOutbox(),[]);
  assert.equal(r.state.messages.some(m=>m.text==='Must not become a completed reply'),false);
  await assert.rejects(r.command({action:'terminal.send',requestId:'late-tool',tabId:'one',text:'late',...context},{tool:true}),/no longer active/);
});

test('restart marks an executing request interrupted without replay and preserves queued acceptance',async t=>{
  const r=await fixture(t,async()=>{});
  r.nativeSeen=0;
  await r.command({action:'message',requestId:'queued',text:'Accepted before phone left'});await r.drainTask;
  r.state.jobs.push({id:'interrupted',action:'message',status:'running',args:{text:'Original'},source:'user'});await r.save();
  let calls=0;const next=new AssistantRuntime({root:r.root,coordinator:{prepare:async()=>({}),run:async({onSession,onMessage})=>{
    calls++;await onSession(conversation);await onMessage({id:'final',text:'Recovered queued work'});
  },stop(){}}});t.after(()=>next.close());
  await next.command({action:'state'});assert.equal((await next.job('interrupted')).status,'interrupted');
  await next.nativePoll({catalog});await next.drainTask;
  assert.equal(calls,1);assert.equal((await next.job('queued')).status,'completed');
  assert.equal((await next.job('interrupted')).status,'interrupted');
});

test('actual HTTP disconnect after durable acceptance cannot cancel work or duplicate a retried message',async t=>{
  let finish,entered=false,calls=0,dropReceipt=true;
  const r=await fixture(t,async({onSession,onMessage})=>{
    calls++;await onSession(conversation);entered=true;
    await new Promise(resolve=>{finish=resolve;});await onMessage({id:'final',text:'HTTP disconnected but saved'});
  });
  const server=http.createServer((req,res)=>assistantHttp(req,res,new URL(req.url,'http://fixture'),r,{
    readBody:async request=>{let body='';for await(const chunk of request)body+=chunk;return JSON.parse(body);},
    json:(response,status,value)=>{
      if(req.url==='/v1/assistant/request'&&dropReceipt){dropReceipt=false;response.destroy();return;}
      response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify(value));
    },
  }));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const url=`http://127.0.0.1:${server.address().port}/v1/assistant/request`;
  const request={action:'message',requestId:'lost-http-receipt',text:'Only once'};
  const send=body=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  await assert.rejects(send(request));while(!entered)await immediate();
  const receipt=await (await send({action:'receipt',requestId:'read',messageRequestId:request.requestId})).json();
  assert.equal(receipt.messageReceipt.status,'running');
  r.nativeSeen=0;finish();await r.drainTask;
  assert.equal((await(await send(request)).json()).job.status,'completed');
  assert.equal(calls,1);assert.equal((await r.notificationOutbox()).length,1);
});
