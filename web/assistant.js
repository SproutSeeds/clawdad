const $ = (id) => document.getElementById(id);
const dialog = $('assistantDialog');
if (dialog) {
  let snapshot=null, timer=null, voice=false, muted=false, capture=null, context=null, stream=null;
  let audio=null, speechEpoch=0, speechAbort=null, spoken=new Set(), uploadQueue=[], uploading=null, transcript=[];
  let pendingMessage=null, sendTail=Promise.resolve(), voiceEpoch=0, startingVoice=false;
  const messageNodes=new Map(), taskNodes=new Map(), tabNodes=new Map();
  async function request(route, body, options={}) {
    const response=await fetch(route,{method:body?'POST':'GET',headers:body instanceof FormData?{}:{'content-type':'application/json'},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,...options});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'The Mac could not finish this request');return result;
  }
  function error(message=''){$('assistantError').textContent=message;}
  function status(message){$('assistantStatus').textContent=message;$('assistantCallStatus').textContent=message;}
  async function command(action,args={},id=crypto.randomUUID()) {
    const result=await request('/v1/assistant/request',{...args,action,requestId:id});render(result);return result;
  }
  async function ensureAssistant(){if(!snapshot?.coordinator&&!snapshot?.tasks?.some(t=>t.action==='start'&&['queued','running'].includes(t.status)))await command('start');}
  function button(text,handler){const element=document.createElement('button');element.type='button';element.textContent=text;element.onclick=handler;return element;}
  function open(){dialog.showModal();$('assistantCall').hidden=true;$('assistantDraft').focus();refresh();if(!timer)timer=setInterval(refresh,2500);}
  function close(){dialog.close();$('assistantCall').hidden=!voice;$('assistantOpen').focus();}
  async function watch(tabId){
    try{
      const id=crypto.randomUUID();let next=await command('terminal.focus',{tabId},id);
      for(let attempt=0;attempt<30;attempt++){
        const task=next.tasks?.find(t=>t.id===id);
        if(task?.status==='completed'){close();return;}
        if(task?.status==='attention')throw new Error(task.error||'The tab could not be selected');
        await new Promise(resolve=>setTimeout(resolve,500));next=await request('/v1/assistant/state');render(next);
      }
      throw new Error('Tab selection is still pending. Its status will update here.');
    }catch(e){error(e.message);}
  }
  $('assistantOpen').onclick=open;$('assistantBack').onclick=close;$('assistantReturn').onclick=open;
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  $('assistantWorkspaceToggle').onclick=()=>{const show=$('assistantWorkspace').hidden;$('assistantWorkspace').hidden=!show;$('assistantFeed').hidden=show;$('assistantWorkspaceToggle').setAttribute('aria-pressed',String(show));};
  $('assistantPause').onclick=()=>command('pause',{paused:!snapshot?.paused}).catch(e=>error(e.message));
  function render(next){
    snapshot=next;$('assistantPause').textContent=next.paused?'Resume control':'Pause control';
    $('assistantSend').disabled=!next.nativeOnline;$('assistantTalk').disabled=!voice&&!next.nativeOnline;$('assistantPause').disabled=!next.nativeOnline;
    if(!voice)status(next.nativeOnline?'Your Mac is connected':'Waiting for the Mac app…');
    const feed=$('assistantFeed'), nearBottom=feed.scrollHeight-feed.scrollTop-feed.clientHeight<100;
    for(const message of next.messages||[]){
      if(messageNodes.has(message.id))continue;
      const element=document.createElement('div');element.className='assistant-message';
      const label=document.createElement('strong');label.textContent=message.role==='user'?'You':'Assistant';
      element.append(label,document.createTextNode(message.text));feed.append(element);messageNodes.set(message.id,element);
    }
    $('assistantWelcome').hidden=Boolean(next.messages?.length);
    const liveMessages=new Set((next.messages||[]).map(m=>m.id));
    for(const [id,node] of messageNodes)if(!liveMessages.has(id)){node.remove();messageNodes.delete(id);}
    for(const task of (next.tasks||[]).filter(t=>t.action==='terminal.send'||t.status==='attention')){
      let entry=taskNodes.get(task.id);
      if(!entry){
        const element=document.createElement('section');element.className='assistant-task';
        const heading=document.createElement('strong'),prompt=document.createElement('p'),detail=document.createElement('p');
        element.append(heading,prompt,detail);
        if(task.args.tabId)element.append(button('Watch in Terminal',()=>watch(task.args.tabId)));
        const cancel=button('Cancel queued task',()=>command('cancel',{jobId:task.id}).catch(e=>error(e.message)));element.append(cancel);
        $('assistantTasks').append(element);entry={element,heading,prompt,detail,cancel};taskNodes.set(task.id,entry);
      }
      entry.heading.textContent=`${task.tabTitle||'Terminal task'} · ${task.status}`;
      entry.prompt.textContent=task.args.text||'';entry.detail.textContent=task.error||'';entry.cancel.hidden=task.status!=='queued';
    }
    const visibleTasks=new Set((next.tasks||[]).map(t=>t.id));
    for(const [id,entry] of taskNodes)if(!visibleTasks.has(id)){entry.element.remove();taskNodes.delete(id);}
    const tabs=next.catalog?.tabs||[],currentTabs=new Set(tabs.map(t=>t.id));
    for(const [id,node] of tabNodes)if(!currentTabs.has(id)){node.remove();tabNodes.delete(id);}
    for(const [index,tab] of tabs.entries()){
      let node=tabNodes.get(tab.id);
      if(!node){node=button('',()=>watch(tab.id));tabNodes.set(tab.id,node);}
      node.textContent=`${tab.title} — ${tab.detail}${tab.isBusy?' · Busy':''}`;
      const before=$('assistantWorkspace').children[index];if(before!==node)$('assistantWorkspace').insertBefore(node,before||null);
    }
    if(nearBottom)feed.scrollTop=feed.scrollHeight;
    const latest=next.messages?.filter(m=>m.role==='assistant').at(-1);
    if(voice&&latest&&!spoken.has(latest.id)){spoken.add(latest.id);speak(latest).catch(e=>{if(e.name!=='AbortError')error(e.message);});}
  }
  async function refresh(){try{render(await request('/v1/assistant/state'));}catch(e){if(dialog.open||voice)error(e.message);}}
  function send(text,id=null,epoch=null){
    const next=sendTail.then(async()=>{
      if(!text.trim())return true;
      if(epoch!==null&&epoch!==voiceEpoch)return false;
      const pending=id?{text,id}:pendingMessage?.text===text?pendingMessage:{text,id:crypto.randomUUID()};pendingMessage=pending;
      try{await ensureAssistant();await command('message',{text},pending.id);pendingMessage=null;error();return true;}catch(e){error(e.message);return false;}
    });sendTail=next.catch(()=>{});return next;
  }
  $('assistantComposer').onsubmit=async(event)=>{event.preventDefault();const text=$('assistantDraft').value;if(await send(text)&&$('assistantDraft').value===text)$('assistantDraft').value='';};
  $('assistantDraft').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();$('assistantComposer').requestSubmit();}};
  function stopSpeech(){speechEpoch++;speechAbort?.abort();speechAbort=null;if(audio){audio.pause();audio.src='';audio=null;}if(voice)status(muted?'Microphone muted':'Listening…');}
  async function speak(message){
    stopSpeech();const epoch=speechEpoch,abort=new AbortController();speechAbort=abort;
    const settings=await request('/v1/tts/voices',null,{signal:abort.signal});
    let played=0,poll=false;const deadline=Date.now()+180_000;
    while(voice&&epoch===speechEpoch&&Date.now()<deadline){
      const result=await request('/v1/tts/message',{source:'remote-assist',project:'',text:message.text,kind:'response',prepare:true,poll,requestId:message.id,voiceSelection:settings.selection,executionPreference:'paired-mac-first',allowRemoteFallback:false},{signal:abort.signal});
      if(result.audio?.state==='failed')throw new Error(result.audio.error||'Local speech is unavailable');
      const parts=result.audio?.parts||[];
      while(played<parts.length&&voice&&epoch===speechEpoch){
        status('Speaking…');const player=new Audio(parts[played].url);audio=player;
        await new Promise((resolve,reject)=>{
          const cancel=()=>{player.pause();reject(new DOMException('Interrupted','AbortError'));};
          abort.signal.addEventListener('abort',cancel,{once:true});
          player.onended=()=>{abort.signal.removeEventListener('abort',cancel);resolve();};
          player.onerror=()=>{abort.signal.removeEventListener('abort',cancel);reject(new Error('The Mac could not play this audio part'));};
          player.play().catch(reject);
        });played++;
      }
      if(result.audio?.state==='ready'&&played){status(muted?'Microphone muted':'Listening…');return;}
      poll=true;await new Promise(resolve=>setTimeout(resolve,700));
    }
  }
  function wav(samples,rate){
    const count=Math.floor(samples.length*16000/rate),buffer=new ArrayBuffer(44+count*2),view=new DataView(buffer);
    function text(offset,value){for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));}
    text(0,'RIFF');view.setUint32(4,36+count*2,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,count*2,true);
    for(let i=0;i<count;i++){const position=i*rate/16000,left=Math.floor(position),fraction=position-left,value=samples[left]*(1-fraction)+(samples[Math.min(left+1,samples.length-1)]||0)*fraction;view.setInt16(44+i*2,Math.max(-1,Math.min(1,value))*32767,true);}
    return new Blob([buffer],{type:'audio/wav'});
  }
  async function drain(){
    const epoch=voiceEpoch;if(uploading===epoch)return;uploading=epoch;
    try{
      while(voice&&voiceEpoch===epoch&&uploadQueue.length){
        const item=uploadQueue[0];
        try{
          if(item.samples.length){
            const form=new FormData();form.append('audio',wav(item.samples,item.sampleRate),'assistant.wav');
            const value=await request('/v1/stt/transcribe',form);if(!voice||voiceEpoch!==epoch)return;
            if(value.text?.trim())transcript.push(value.text.trim());
          }
          uploadQueue.shift();
          if(item.final){
            const text=transcript.join(' '),id=crypto.randomUUID();
            while(voice&&voiceEpoch===epoch){if(await send(text,id,epoch)){transcript=[];break;}await new Promise(r=>setTimeout(r,2000));}
          }
        }catch(e){if(voiceEpoch!==epoch)return;status('Waiting for local transcription…');await new Promise(r=>setTimeout(r,2000));}
      }
    }finally{if(uploading===epoch)uploading=null;}
  }
  async function startVoice(){
    if(voice||startingVoice)return;startingVoice=true;const epoch=++voiceEpoch;
    try{
      if(!window.dispatchEvent(new Event('clawdad:assistant-will-start-voice',{cancelable:true})))throw new Error('Finish the current dictation before starting a conversation.');
      await refresh();await ensureAssistant();spoken=new Set((snapshot?.messages||[]).map(m=>m.id));
      const acquired=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      if(voiceEpoch!==epoch){acquired.getTracks().forEach(t=>t.stop());return;}stream=acquired;
      context=new AudioContext();await context.audioWorklet.addModule('/assistant-audio-worklet.js');await context.resume();
      if(voiceEpoch!==epoch)return;
      capture=new AudioWorkletNode(context,'clawdad-assistant-capture');context.createMediaStreamSource(stream).connect(capture);capture.connect(context.destination);
      capture.port.onmessage=event=>{
        if(voiceEpoch!==epoch)return;
        if(event.data.type==='started')stopSpeech();
        if(event.data.type==='utterance'&&voice){
          uploadQueue.push(event.data);drain();
          if(uploadQueue.length>=30&&!muted){setMuted(true);error('The microphone is paused while your Mac catches up. Your recorded speech is retained.');}
        }
      };
      voice=true;muted=false;error();status('Listening…');$('assistantCall').hidden=dialog.open;$('assistantMuteInline').hidden=false;$('assistantTalk').textContent='End conversation';
      window.dispatchEvent(new CustomEvent('clawdad:assistant-voice',{detail:{active:true}}));
    }catch(e){if(voiceEpoch===epoch){endVoice();error(e.message);}}finally{startingVoice=false;}
  }
  function endVoice(){voiceEpoch++;voice=false;stopSpeech();stream?.getTracks().forEach(t=>t.stop());stream=null;capture?.disconnect();capture=null;context?.close();context=null;uploadQueue=[];transcript=[];$('assistantCall').hidden=true;$('assistantMuteInline').hidden=true;$('assistantTalk').textContent='Start talking';status('Conversation saved');window.dispatchEvent(new CustomEvent('clawdad:assistant-voice',{detail:{active:false}}));}
  function setMuted(value){muted=value;capture?.port.postMessage({muted});for(const id of ['assistantMute','assistantMuteInline'])$(id).textContent=muted?'Unmute':'Mute';status(muted?'Microphone muted':'Listening…');}
  $('assistantTalk').onclick=()=>voice?endVoice():startVoice();$('assistantEnd').onclick=endVoice;
  $('assistantMute').onclick=()=>setMuted(!muted);
  $('assistantMuteInline').onclick=()=>setMuted(!muted);
  window.addEventListener('beforeunload',endVoice);
}
