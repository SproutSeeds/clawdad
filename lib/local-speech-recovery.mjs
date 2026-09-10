import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const exec = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Recover only the existing, user-installed local service. launchd remains its
// sole process owner. Never kill a live service, create a second one, or modify
// its environment/credentials/model installation to satisfy a health check.
export async function ensureOwnedDocReaderService({run=exec,home=os.homedir(),uid=process.getuid?.(),platform=process.platform}={}) {
  if(platform!=='darwin'||uid==null)return {state:'unsupported_host'};
  const plist=path.join(home,'Library/LaunchAgents/com.docreader.tts-local.plist');
  let config;
  try { config=JSON.parse((await run('/usr/bin/plutil',['-convert','json','-o','-',plist],{timeout:2000})).stdout); }
  catch { return {state:'installation_unavailable'}; }
  const args=config.ProgramArguments||[];
  if(config.Label!=='com.docreader.tts-local'||args[0]!==path.join(home,'.doc-reader-managed/tts-local/.venv/bin/python')
    ||!args.includes('doc_reader.tts_service')||args[args.indexOf('--port')+1]!=='8772'
    ||args[args.indexOf('--host')+1]!=='127.0.0.1')return {state:'ownership_unverified'};
  const label=`gui/${uid}/com.docreader.tts-local`;
  let loaded=false;
  try {
    const status=(await run('/bin/launchctl',['print',label],{timeout:2000})).stdout;
    loaded=true;
    if(/\bpid = [1-9]\d*/.test(status))return {state:'running'};
  } catch {}
  try { await access(args[0]); await access(config.WorkingDirectory); }
  catch { return {state:'dependencies_unavailable'}; }
  await run('/bin/launchctl',loaded?['kickstart',label]:['bootstrap',`gui/${uid}`,plist],{timeout:5000});
  return {state:'start_requested'};
}

// One bounded recovery attempt per host, with no user text, audio cache, model
// turn or playback. The constant warm-up WAV is consumed and discarded.
export class LocalSpeechRecovery {
  constructor({config,fetchImpl=fetch,ensureService=ensureOwnedDocReaderService,now=Date.now,onEvent=()=>{},wait=sleep}={}) {
    Object.assign(this,{config,fetchImpl,ensureService,now,onEvent,wait});
    this.state={state:'unchecked',attempts:0};this.nextAt=0;this.failures=0;this.pending=null;this.timer=null;this.closed=false;
  }
  snapshot(){return {...this.state,retryAfterMs:Math.max(0,this.nextAt-this.now())};}
  start(){if(this.timer)return;this.closed=false;void this.check();this.timer=setInterval(()=>void this.check(),5000);this.timer.unref?.();}
  stop(){this.closed=true;clearInterval(this.timer);this.timer=null;this.abort?.abort();}
  check(){
    if(this.closed)return Promise.resolve(this.snapshot());
    if(this.pending)return this.pending;
    if(this.now()<this.nextAt)return Promise.resolve(this.snapshot());
    this.pending=this.attempt().catch(error=>{
      this.failures++;this.nextAt=this.now()+Math.min(120_000,2000*2**Math.min(6,this.failures-1));
      this.state={...this.state,state:'recovering',reason:error.code||'service_unavailable',retryAt:this.nextAt};
      this.onEvent(this.snapshot());return this.snapshot();
    }).finally(()=>{this.pending=null;});
    return this.pending;
  }
  async attempt(){
    const config=await this.config();
    if(this.closed)return this.snapshot();
    const url=String(config?.baseUrl||'').replace(/\/$/,'');
    if(config?.enabled===false||config?.provider!=='doc-reader'||url!=='http://127.0.0.1:8772'){
      this.state={state:'unmanaged_destination',attempts:this.state.attempts};this.nextAt=this.now()+30_000;return this.snapshot();
    }
    const started=this.now(),engine=config.engine||'kokoro';
    this.state={state:'checking',engine,attempts:this.state.attempts+1};
    const json=async()=>{
      const r=await this.fetchImpl(`${url}/healthz`,{signal:AbortSignal.timeout(2000)});
      if(!r.ok)throw Error('health_unavailable');return r.json();
    };
    let health;
    try{health=await json();}catch{
      const service=await this.ensureService();
      this.state.service=service.state;
      if(service.state!=='start_requested')throw Error('health_unavailable');
      await this.wait(700);health=await json();
    }
    if(this.closed)return this.snapshot();
    const model=health?.engines?.[engine];
    if(health?.ok===false||!model||model.enabled===false)throw Object.assign(Error('engine unavailable'),{code:'engine_unavailable'});
    if(model.loaded!==true){
      // available means installed/can-load, not model-ready. Wait for the drive
      // instead of initiating a download or repeatedly restarting the process.
      if(model.available!==true)throw Object.assign(Error('local model unavailable'),{code:'model_files_unavailable'});
      this.state.state='warming';this.abort=new AbortController();
      const timeout=setTimeout(()=>this.abort?.abort(),12_000);
      try {
        const response=await this.fetchImpl(`${url}/v1/audio/speech`,{method:'POST',headers:{'content-type':'application/json'},signal:this.abort.signal,
          body:JSON.stringify({engine,voice:config.voiceId||'af_heart',text:'Ready.',speed:1})});
        if(!response.ok)throw Error('warmup_failed');
        const data=await response.arrayBuffer();if(data.byteLength<44)throw Error('warmup_audio_empty');
        this.state.firstSynthesisMs=this.now()-started;
      }finally{clearTimeout(timeout);this.abort=null;}
      health=await json();if(health?.engines?.[engine]?.loaded!==true)throw Error('model_not_ready');
    }
    this.failures=0;this.nextAt=this.now()+30_000;
    this.state={...this.state,state:'ready',readyAt:this.now(),readinessMs:this.now()-started};
    this.onEvent(this.snapshot());return this.snapshot();
  }
}
