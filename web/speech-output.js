const key='clawdad.speech-output.v1';
let state={boostDB:0,revision:0,deviceId:'web-'+crypto.randomUUID(),receipts:[]},failure='';
try {const saved=JSON.parse(localStorage.getItem(key)||'null');if(!saved)localStorage.setItem(key,JSON.stringify(state));if(saved){if(!Number.isInteger(saved.boostDB)||saved.boostDB<0||saved.boostDB>20||!Number.isInteger(saved.revision)||typeof saved.deviceId!=='string')throw Error();state=saved;}}
catch{failure='Saved speech boost could not be read. Reset to repair it.';}
let context,processor,initializing;
const sources=new WeakMap();
const activePlayers=new Set();let idleTimer;
function updateActive(){
  clearTimeout(idleTimer);processor?.port.postMessage({type:'active',value:activePlayers.size>0});
  if(!activePlayers.size)idleTimer=setTimeout(()=>{if(!activePlayers.size)void context?.suspend();},2000);
}
export const speechDeviceId=()=>state.deviceId;
export const speechOutputState=()=>({boostDB:state.boostDB,revision:state.revision,scope:'browser-origin-profile',policy:'speech-output-v1',supported:!failure,error:failure});
export function setSpeechBoost(db,id=crypto.randomUUID(),expectedRevision){
  if(!Number.isInteger(db)||db<0||db>20||typeof id!=='string'||!id||id.length>128)throw Error('Choose a whole-number speech boost from 0 to +20 dB.');
  const fingerprint=JSON.stringify([db,expectedRevision??null]);
  const prior=state.receipts.find(r=>r.id===id);
  if(prior){if(prior.fingerprint!==fingerprint)throw Error('Speech request ID was reused.');return prior;}
  if(expectedRevision!==undefined&&state.revision!==expectedRevision)throw Error('Speech boost changed. Read its current value before retrying.');
  const receipt={id,fingerprint,revision:state.revision+1,boostDB:db};
  const next={...state,boostDB:db,revision:receipt.revision,receipts:[...state.receipts,receipt].slice(-128)};
  try{localStorage.setItem(key,JSON.stringify(next));if(localStorage.getItem(key)!==JSON.stringify(next))throw Error();}
  catch{throw Error('Speech boost could not be saved in this browser.');}
  state=next;failure='';processor?.port.postMessage({type:'boost',db});
  window.dispatchEvent(new Event('clawdad:speech-boost'));return receipt;
}
async function graph(){
  if(!initializing)initializing=(async()=>{
    context=new AudioContext();await context.audioWorklet.addModule('/speech-output-worklet.js');
    processor=new AudioWorkletNode(context,'clawdad-speech-output',{outputChannelCount:[2]});
    processor.port.postMessage({type:'boost',db:state.boostDB});processor.connect(context.destination);
    processor.onprocessorerror=()=>{failure='Speech processing stopped. Reload ClawDad and retry.';for(const player of activePlayers){player.pause();player.dispatchEvent(new Event('error'));}};
  })().catch(error=>{initializing=null;context?.close();context=null;throw error;});
  await initializing;await context.resume();
  if(context.state!=='running')throw Error('Tap Preview or the message speaker to enable speech on this device.');
}
export function createSpeechAudio(){
  const audio=new Audio(),play=audio.play.bind(audio),pause=audio.pause.bind(audio);let generation=0;
  audio.play=async()=>{
    const attempt=++generation;activePlayers.add(audio);updateActive();
    try{await graph();}catch{activePlayers.delete(audio);updateActive();throw Error('Speech loudness processing is unavailable. Update this browser or reconnect audio, then retry.');}
    if(attempt!==generation)throw new DOMException('Speech was cancelled','AbortError');
    let source=sources.get(audio);
    if(!source){source=context.createMediaElementSource(audio);sources.set(audio,source);}
    source.disconnect();source.connect(processor);
    updateActive();
    try{return await play();}catch(error){if(attempt===generation){activePlayers.delete(audio);updateActive();}throw error;}
  };
  audio.pause=()=>{generation++;activePlayers.delete(audio);updateActive();return pause();};
  audio.addEventListener('ended',()=>{activePlayers.delete(audio);updateActive();sources.get(audio)?.disconnect();});
  audio.addEventListener('error',()=>{activePlayers.delete(audio);updateActive();});
  audio.addEventListener('emptied',()=>sources.get(audio)?.disconnect());
  // One source per element; cached audio is never modified or amplified twice.
  return audio;
}
let syncing=false;
export async function syncSpeechOutput(request){
  if(syncing)return;syncing=true;
  try{
    let result=await request('/v1/assistant/request',{action:'speech.sync',requestId:crypto.randomUUID(),deviceId:state.deviceId,label:window.ClawDadNative?'Mac app':'Browser profile',state:speechOutputState()});
    const pending=result.speechOutput?.pending;
    if(pending&&Date.now()<pending.expiresAt){
      let ack;
      try{const receipt=setSpeechBoost(pending.boostDB,pending.requestId,pending.expectedRevision);ack={requestId:pending.requestId,status:'applied',appliedRevision:receipt.revision,appliedBoostDB:receipt.boostDB};}
      catch(e){ack={requestId:pending.requestId,status:'rejected',error:e.message};}
      await request('/v1/assistant/request',{action:'speech.sync',requestId:crypto.randomUUID(),deviceId:state.deviceId,label:window.ClawDadNative?'Mac app':'Browser profile',state:speechOutputState(),ack});
    }
  }finally{syncing=false;}
}
export function installSpeechBoostSettings(preview){
  const slider=document.getElementById('speechBoost');if(!slider)return;
  const render=()=>{slider.value=state.boostDB;document.getElementById('speechBoostValue').textContent=state.boostDB?`+${state.boostDB} dB`:'0 dB';slider.setAttribute('aria-valuetext',`${state.boostDB} decibels`);document.getElementById('speechBoostStatus').textContent=failure;};
  const change=db=>{let problem='';try{setSpeechBoost(db);}catch(e){problem=e.message;}render();if(problem)document.getElementById('speechBoostStatus').textContent=problem;};
  slider.oninput=()=>change(Number(slider.value));
  document.getElementById('speechBoostReset').onclick=()=>change(0);
  document.getElementById('speechBoostPreview').onclick=preview;
  window.addEventListener('clawdad:speech-boost',render);render();
}
window.addEventListener('storage',event=>{
  if(event.key!==key||!event.newValue)return;
  try{const next=JSON.parse(event.newValue);if(!Number.isInteger(next.boostDB)||next.boostDB<0||next.boostDB>20||!Number.isInteger(next.revision)||next.deviceId!==state.deviceId)return;
    state=next;processor?.port.postMessage({type:'boost',db:state.boostDB});window.dispatchEvent(new Event('clawdad:speech-boost'));
  }catch{}
});
