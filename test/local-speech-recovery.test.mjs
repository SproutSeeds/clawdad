import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalSpeechRecovery,ensureOwnedDocReaderService} from '../lib/local-speech-recovery.mjs';
const config=()=>({provider:'doc-reader',enabled:true,baseUrl:'http://127.0.0.1:8772',engine:'kokoro',voiceId:'af_heart'});
const health=({loaded=true,available=true,enabled=true}={})=>Response.json({ok:true,engines:{kokoro:{loaded,available,enabled}}});
test('healthy polling is lightweight and deduplicates concurrent requests',async()=>{
  let reads=0,time=0,events=[];
  const s=new LocalSpeechRecovery({config,now:()=>time,fetchImpl:async()=>{reads++;return health();},onEvent:e=>events.push(e),ensureService:()=>assert.fail('Do not restart healthy service')});
  await Promise.all([s.check(),s.check(),s.check()]);assert.equal(reads,1);assert.equal(s.snapshot().state,'ready');
  await s.check();assert.equal(reads,1);time=30_001;await s.check();assert.equal(reads,2);
  assert.ok(events.every(e=>!('text'in e)&&!('audio'in e)));
});
test('mount/model unavailability backs off without generating or downloading speech',async()=>{
  let time=0,calls=0;const s=new LocalSpeechRecovery({config,now:()=>time,fetchImpl:async(_u,o)=>{assert.notEqual(o?.method,'POST');calls++;return health({loaded:false,available:false});}});
  await s.check();assert.equal(s.snapshot().reason,'model_files_unavailable');await s.check();assert.equal(calls,1);
  time=2001;await s.check();assert.equal(calls,2);assert.equal(s.snapshot().retryAfterMs,4000);
});
test('failed preload recovers through one discarded constant synthesis then primary readiness',async()=>{
  let loaded=false,warm=0;const s=new LocalSpeechRecovery({config,fetchImpl:async(u,o)=>{
    if(u.endsWith('/healthz'))return health({loaded});
    warm++;assert.equal(JSON.parse(o.body).text,'Ready.');loaded=true;return new Response(Buffer.alloc(100));
  }});
  const result=await s.check();assert.equal(result.state,'ready');assert.equal(warm,1);assert.equal(typeof result.firstSynthesisMs,'number');
});
test('failure after warming stays recovering and successful later attempt rearms primary',async()=>{
  let time=0,loaded=false,fail=true;
  const s=new LocalSpeechRecovery({config,now:()=>time,fetchImpl:async(u)=>u.endsWith('/healthz')?health({loaded}):fail?new Response('',{status:503}):(loaded=true,new Response(Buffer.alloc(100)))});
  assert.equal((await s.check()).state,'recovering');fail=false;time=2001;assert.equal((await s.check()).state,'ready');
});
test('unreachable service asks existing owner once and never loops rapidly',async()=>{
  let starts=0;const s=new LocalSpeechRecovery({config,wait:async()=>{},fetchImpl:async()=>{throw Error('offline');},ensureService:async()=>{starts++;return {state:'start_requested'};}});
  await s.check();await s.check();assert.equal(starts,1);assert.equal(s.snapshot().state,'recovering');
});
test('external URLs and disabled speech are never managed',async()=>{
  for(const c of [{...config(),baseUrl:'http://some-other-host:8772'},{...config(),enabled:false}]){
    const s=new LocalSpeechRecovery({config:()=>c,fetchImpl:()=>assert.fail(),ensureService:()=>assert.fail()});assert.equal((await s.check()).state,'unmanaged_destination');
  }
});
test('existing launchd PID is left intact and unknown installations remain protected',async()=>{
  const home='/tmp/fixture';const args=[home+'/.doc-reader-managed/tts-local/.venv/bin/python','-m','doc_reader.tts_service','--host','127.0.0.1','--port','8772'];
  let commands=[];const run=async(bin,argv)=>{commands.push(argv);return {stdout:bin.endsWith('plutil')?JSON.stringify({Label:'com.docreader.tts-local',ProgramArguments:args}):'state = running\npid = 1234\n'};};
  assert.equal((await ensureOwnedDocReaderService({run,home,uid:501,platform:'darwin'})).state,'running');
  assert.equal(commands.length,2);assert.ok(!commands.some(a=>a.includes('kickstart')));
  assert.equal((await ensureOwnedDocReaderService({run:async()=>({stdout:'{}'}),home,uid:501,platform:'darwin'})).state,'ownership_unverified');
});
