import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SpeechOutputControls} from '../lib/speech-output-controls.mjs';
import {SpeechOutputDSP} from '../web/speech-output-dsp.js';
import {AssistantRuntime} from '../lib/assistant-runtime.mjs';
import {assistantTools,runAssistantMCP} from '../lib/assistant-mcp.mjs';
import {Readable,Writable} from 'node:stream';

async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-speech-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return {root,hub:new SpeechOutputControls({root})};}
const state=(boostDB=0,revision=0)=>({boostDB,revision,supported:true,policy:'speech-output-v1'});
const auth={originDeviceId:'phone-a',authorize:async()=>{}};
async function acknowledge(hub,id='phone-a'){
  for(let i=0;i<100;i++){
    const read=await hub.read(id),current=read.speechOutput.state;
    const {speechOutput}=await hub.sync({deviceId:id,state:current});
    if(speechOutput.pending){const p=speechOutput.pending;await hub.sync({deviceId:id,state:state(p.boostDB,p.expectedRevision+1),ack:{requestId:p.requestId,status:'applied',appliedBoostDB:p.boostDB,appliedRevision:p.expectedRevision+1}});return p;}
    await new Promise(r=>setTimeout(r,5));
  }
  throw Error('Fixture did not receive the pending command');
}
test('device persistence acknowledgment, relative changes, reset, stable IDs and independent device scope',async t=>{
  const {root,hub}=await fixture(t);await hub.sync({deviceId:'phone-a',state:state()});await hub.sync({deviceId:'phone-b',state:state(4,2)});
  for(const [id,operation,boostDB,deltaDB,expectedRevision,want] of [['set-6','set',6,undefined,0,6],['plus-2','increase',undefined,2,1,8],['reset','reset',undefined,undefined,2,0]]){
    const args={requestId:id,operation,boostDB,deltaDB,expectedRevision};
    const pending=hub.set(args,auth);await acknowledge(hub);
    assert.equal((await pending).speechOutput.receipt.status,'applied');
    assert.equal((await hub.read('phone-a')).speechOutput.state.boostDB,want);
    assert.equal((await hub.set(args,auth)).speechOutput.receipt.status,'applied');
    assert.equal((await hub.read('phone-a')).speechOutput.state.revision,expectedRevision+1);
  }
  assert.equal((await hub.read('phone-b')).speechOutput.state.boostDB,4);
  const restarted=new SpeechOutputControls({root});assert.equal((await restarted.receipt('plus-2')).speechOutput.receipt.status,'applied');
  assert.equal((await restarted.read('phone-a')).speechOutput.status,'offline');
  await assert.rejects(hub.set({requestId:'plus-2',operation:'increase',deltaDB:3,expectedRevision:1},auth),/reused/);
});
test('offline, unsupported, invalid, stale and failed authorization never queue a gain change',async t=>{
  const {hub}=await fixture(t);
  const args={requestId:'offline',operation:'set',boostDB:10,expectedRevision:0};
  assert.equal((await hub.set(args,auth)).speechOutput.receipt.status,'offline');
  await hub.sync({deviceId:'phone-a',state:{...state(),supported:false}});
  assert.equal((await hub.set({...args,requestId:'unsupported'},auth)).speechOutput.receipt.status,'unsupported');
  await hub.sync({deviceId:'phone-a',state:state(0,2)});
  await assert.rejects(hub.set({...args,boostDB:21},auth),/whole numbers/);
  await assert.rejects(hub.set({...args,boostDB:NaN},auth),/whole numbers/);
  await assert.rejects(hub.set(args,auth),/changed/);
  await assert.rejects(hub.set({...args,expectedRevision:2},{...auth,authorize:async()=>{throw Error('no authorization');}}),/no authorization/);
  assert.equal((await hub.sync({deviceId:'phone-a',state:state(0,2)})).speechOutput.pending,null);
});
test('uncertain timeout and host restart preserve receipt without replaying or compounding gain',async t=>{
  const {root}=await fixture(t);let now=10000;
  const hub=new SpeechOutputControls({root,clock:()=>now});await hub.sync({deviceId:'phone-a',state:state()});
  const args={requestId:'uncertain',operation:'increase',deltaDB:2,expectedRevision:0};
  const delivery=hub.set(args,auth);
  let pending;for(let i=0;i<100&&!pending;i++){pending=(await hub.sync({deviceId:'phone-a',state:state()})).speechOutput.pending;await new Promise(r=>setTimeout(r,2));}
  assert.ok(pending);now+=6000;
  assert.equal((await delivery).speechOutput.receipt.status,'unverified');
  const restarted=new SpeechOutputControls({root,clock:()=>now});
  assert.equal((await restarted.sync({deviceId:'phone-a',state:state(2,1)})).speechOutput.pending,null);
  assert.equal((await restarted.set(args,auth)).speechOutput.receipt.status,'unverified');
  assert.equal((await restarted.read('phone-a')).speechOutput.state.boostDB,2);
});
test('wrong device ack, competing settings change and duplicate concurrent request are bounded',async t=>{
  const {hub}=await fixture(t);await hub.sync({deviceId:'phone-a',state:state()});
  const args={requestId:'same',operation:'set',boostDB:6,expectedRevision:0};
  const first=hub.set(args,auth),second=hub.set(args,auth);
  let p;for(let i=0;i<100&&!p;i++){p=(await hub.sync({deviceId:'phone-a',state:state()})).speechOutput.pending;await new Promise(r=>setTimeout(r,2));}
  await assert.rejects(hub.sync({deviceId:'phone-b',state:state(6,1),ack:{requestId:'same',status:'applied'}}),/another device/);
  await hub.sync({deviceId:'phone-a',state:state(4,1),ack:{requestId:'same',status:'rejected',error:'Local setting changed.'}});
  assert.equal((await first).speechOutput.receipt.status,'rejected');
  assert.ok(['pending','rejected'].includes((await second).speechOutput.receipt.status));
  assert.equal((await hub.read('phone-a')).speechOutput.state.boostDB,4);
});
test('actual MCP read/set schema and runtime route require current user authorization and originating device',async t=>{
  const {root}=await fixture(t);const runtime=new AssistantRuntime({root});t.after(()=>runtime.close());
  await runtime.load();runtime.state.enabled=true;
  const job={id:'user-turn',action:'message',status:'running',source:'user',runtimeInstanceId:runtime.instanceId,args:{text:'Set speech boost to 6 dB',speechDeviceId:'phone-a'}};
  runtime.state.jobs.push(job);runtime.state.coordinator={activeRequestId:job.id};
  await runtime.command({action:'speech.sync',deviceId:'phone-a',state:state()});
  assert.equal((await runtime.command({action:'speech.read'},{tool:true})).speechOutput.deviceId,'phone-a');
  await assert.rejects(runtime.command({action:'speech.sync',deviceId:'phone-a',state:state(20,1)},{tool:true}),/actual playback client/);
  await assert.rejects(runtime.command({action:'speech.set',operation:'set',boostDB:6,expectedRevision:0,requestId:'no',approvalText:'unrelated'},{tool:true}),/explicit request/);
  const changed=runtime.command({action:'speech.set',operation:'set',boostDB:6,expectedRevision:0,requestId:'yes',approvalText:job.args.text,coordinatorRequestId:job.id},{tool:true});
  for(let i=0;i<100;i++){
    const result=await runtime.command({action:'speech.sync',deviceId:'phone-a',state:state()});
    if(result.speechOutput.pending){await runtime.command({action:'speech.sync',deviceId:'phone-a',state:state(6,1),ack:{requestId:'yes',status:'applied',appliedBoostDB:6,appliedRevision:1}});break;}
    await new Promise(r=>setTimeout(r,5));
  }
  assert.equal((await changed).speechOutput.receipt.status,'applied');
  const connectionRoot=path.join(root,'mcp');await fs.mkdir(path.join(connectionRoot,'Assistant'),{recursive:true});
  await fs.writeFile(path.join(connectionRoot,'Assistant/connection.json'),JSON.stringify({baseURL:'http://127.0.0.1:1/'}));
  await fs.writeFile(path.join(connectionRoot,'native-server.token'),'synthetic-token');
  async function mcp(name,args){
    const frames=[];
    await runAssistantMCP({root:connectionRoot,coordinatorRequestId:job.id,
      input:Readable.from([JSON.stringify({id:1,method:'tools/call',params:{name,arguments:args}})+'\n']),
      output:new Writable({write(chunk,_encoding,done){frames.push(JSON.parse(chunk));done();}}),
      fetchImpl:async(url,options)=>{assert.equal(url.pathname,'/v1/assistant/tool');assert.equal(options.headers.authorization,'Bearer synthetic-token');
        const result=await runtime.command(JSON.parse(options.body),{tool:true});return {ok:true,json:async()=>result};}});
    assert.equal(frames[0].result.isError,undefined,JSON.stringify(frames[0]));return JSON.parse(frames[0].result.content[0].text);
  }
  assert.equal((await mcp('read_speech_boost',{})).speechOutput.state.boostDB,6);
  const repeat=await mcp('set_speech_boost',{operation:'set',boostDB:6,expectedRevision:0,requestId:'yes',approvalText:job.args.text});
  assert.equal(repeat.speechOutput.receipt.status,'applied');
  assert.equal(repeat.speechOutput.device.state.revision,1);

  assert.ok(assistantTools.find(t=>t[0]==='read_speech_boost'));assert.ok(assistantTools.find(t=>t[0]==='set_speech_boost'));
});

test('speech DSP preserves 0 dB, silence and noise; bounded high gain and smooth live change',()=>{
  const rate=24000,dsp=new SpeechOutputDSP(rate),input=Float64Array.from({length:rate},(_,i)=>.01*Math.sin(2*Math.PI*220*i/rate));
  const output=[];for(let i=0;i<input.length+dsp.latencyFrames;i++)output.push(dsp.process(input[i]||0,input[i]||0,0)[0]);
  for(let i=0;i<input.length;i++)assert.equal(output[i+dsp.latencyFrames],input[i]);
  for(const value of [0,1e-5]){const quiet=new SpeechOutputDSP(rate,20);for(let i=0;i<rate;i++)assert.ok(Math.abs(quiet.process(value,value,20)[0])<=value+1e-12);}
  const dynamic=new SpeechOutputDSP(rate);let previous=0,maxJump=0,peak=0;
  for(let i=0;i<rate*2;i++){const v=.9*Math.sin(i*.031);const y=dynamic.process(v,v,i>rate/2?20:0)[0];maxJump=Math.max(maxJump,Math.abs(y-previous));peak=Math.max(peak,Math.abs(y));previous=y;}
  assert.ok(peak<=10**(-3/20)+1e-10);assert.ok(maxJump<.1);
  assert.ok(dynamic.maximumReductionDB>15);
});
