import {researchSupervisorPanel} from './research-supervisor.js';
const $ = (id) => document.getElementById(id);
const dialog = $('assistantDialog');
if (dialog) {
  let snapshot=null, timer=null, voice=false, muted=false, capture=null, context=null, stream=null;
  let audio=null, speechEpoch=0, speechAbort=null, spoken=new Set(), uploadQueue=[], uploading=null, transcript=[];
  let pendingMessage=null, sendTail=Promise.resolve(), voiceEpoch=0, startingVoice=false, callVisible=false;
  let speechQueue=[], speechRunner=null;
  const messageNodes=new Map(), taskNodes=new Map(), tabNodes=new Map();
  const hasMessageSelection=()=>{const selection=window.getSelection();return !!selection&&!selection.isCollapsed&&
    (selection.anchorNode?.parentElement?.closest('.assistant-message,.assistant-task')||selection.focusNode?.parentElement?.closest('.assistant-message,.assistant-task'));};
  let deferredHistory=null;
  document.addEventListener('selectionchange',()=>{if(!hasMessageSelection()&&deferredHistory){const next=deferredHistory;deferredHistory=null;render(next);}});
  async function request(route, body, options={}) {
    const response=await fetch(route,{method:body?'POST':'GET',headers:body instanceof FormData?{}:{'content-type':'application/json'},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,...options});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'The Mac could not finish this request');return result;
  }
  function error(message=''){$('assistantError').textContent=message;}
  const openResearch=researchSupervisorPanel(request);
  window.openClawDadResearch=()=>{open();$('assistantWorkspace').hidden=false;$('assistantFeed').hidden=true;};
  function status(message){$('assistantStatus').textContent=message;$('assistantCallStatus').textContent=message;}
  async function command(action,args={},id=crypto.randomUUID()) {
    const result=await request('/v1/assistant/request',{...args,action,requestId:id});render(result);return result;
  }
  async function ensureAssistant(){await refresh();if(snapshot?.conversationMode!=='background')throw new Error('Update ClawDad on your Mac to use Assistant calls.');await command('start');}
  function button(text,handler){const element=document.createElement('button');element.type='button';element.textContent=text;element.onclick=handler;return element;}
  function copyButton(readText,label){
    const node=button('⧉',async()=>{
      try{await navigator.clipboard.writeText(readText());node.textContent='Copied';setTimeout(()=>{node.textContent='⧉';},1500);}
      catch{error('Copy could not finish. Select the message text to copy it.');}
    });
    node.className='assistant-copy';node.title=label;node.setAttribute('aria-label',label);return node;
  }
  function open(){if(!dialog.open)dialog.showModal();$('assistantCall').hidden=true;$('assistantDraft').focus();refresh();if(!timer)timer=setInterval(refresh,700);}
  function close(){dialog.close();$('assistantCall').hidden=!callVisible;$('assistantOpen').focus();}
  function goBack(){if(!$('assistantWorkspace').hidden){$('assistantWorkspace').hidden=true;$('assistantFeed').hidden=false;$('assistantWorkspaceToggle').setAttribute('aria-pressed','false');$('assistantWorkspaceToggle').focus();}else close();}
  async function watch(tabId){
    try{
      const id=crypto.randomUUID();let next=await command('terminal.focus',{tabId},id);
      for(let attempt=0;attempt<30;attempt++){
        const task=[...(next.operations||[]),...(next.tasks||[])].find(t=>t.id===id);
        if(task?.status==='completed'){close();return;}
        if(task?.status==='attention')throw new Error(task.error||'The tab could not be selected');
        await new Promise(resolve=>setTimeout(resolve,500));next=await request('/v1/assistant/state');render(next);
      }
      throw new Error('Tab selection is still pending. Its status will update here.');
    }catch(e){error(e.message);}
  }
  $('assistantOpen').onclick=()=>callVisible?open():startVoice();$('assistantBack').onclick=goBack;$('assistantReturn').onclick=open;
  dialog.addEventListener('cancel',event=>{event.preventDefault();goBack();});
  $('assistantWorkspaceToggle').onclick=()=>{const show=$('assistantWorkspace').hidden;$('assistantWorkspace').hidden=!show;$('assistantFeed').hidden=show;$('assistantWorkspaceToggle').setAttribute('aria-pressed',String(show));};
  $('assistantPause').onclick=()=>command('pause',{paused:!snapshot?.paused}).catch(e=>error(e.message));
  function render(next){
    snapshot=next;$('assistantPause').textContent=next.paused?'Resume control':'Pause control';
    $('assistantSend').disabled=!next.nativeOnline;$('assistantTalk').disabled=!voice&&!next.nativeOnline;$('assistantPause').disabled=!next.nativeOnline;
    if(!voice&&!startingVoice&&!callVisible)status(next.nativeOnline?'Your Mac is connected':'Waiting for the Mac app…');
    const feed=$('assistantFeed'), nearBottom=feed.scrollHeight-feed.scrollTop-feed.clientHeight<100;
    const held=hasMessageSelection();
    if(held)deferredHistory=next;
    if(!held){
    for(const message of next.messages||[]){
      let entry=messageNodes.get(message.id);
      if(!entry){
        const element=document.createElement('div');element.className='assistant-message';
        const label=document.createElement('strong'),body=document.createElement('span');
        const copy=copyButton(()=>body.textContent,`Copy ${message.role} message`);
        element.append(label,copy,body);feed.append(element);entry={element,label,body};messageNodes.set(message.id,entry);
      }
      entry.label.textContent=message.role==='user'?'You':'Assistant';
      if(entry.body.textContent!==message.text)entry.body.textContent=message.text;
    }
    $('assistantWelcome').hidden=Boolean(next.messages?.length);
    const liveMessages=new Set((next.messages||[]).map(m=>m.id));
    for(const [id,node] of messageNodes)if(!liveMessages.has(id)){node.element.remove();messageNodes.delete(id);}
    for(const task of next.tasks||[]){
      let entry=taskNodes.get(task.id);
      if(!entry){
        const element=document.createElement('section');element.className='assistant-task';
        const heading=document.createElement('strong'),prompt=document.createElement('p'),detail=document.createElement('p'),response=document.createElement('p');
        const copy=copyButton(()=>prompt.textContent,'Copy task request'),resultCopy=copyButton(()=>response.textContent,'Copy Assistant result');
        element.append(heading,copy,prompt,detail,response,resultCopy);
        if(task.args.tabId)element.append(button('Watch in Terminal',()=>watch(task.args.tabId)));
        const cancel=button('Cancel queued task',()=>command('cancel',{jobId:task.id}).catch(e=>error(e.message)));element.append(cancel);
        $('assistantTasks').append(element);entry={element,heading,prompt,detail,cancel,response,resultCopy};taskNodes.set(task.id,entry);
      }
      const label={queued:'Waiting for delivery',inserted:'Draft inserted',running:'Delivering',agent_queued:'Queued in agent',submitted:'Submitted',working:'Working',completed:'Completed',attention:'Needs attention'}[task.status]||task.status;
      entry.heading.textContent=`${task.displayName||'Terminal agent'} · ${label}`;
      entry.prompt.textContent=task.requestText||task.args.text||'';entry.detail.textContent=task.error||'';entry.cancel.hidden=task.status!=='queued';
      entry.response.textContent=task.response||'';entry.resultCopy.hidden=!task.response;
    }
    const visibleTasks=new Set((next.tasks||[]).map(t=>t.id));
    for(const [id,entry] of taskNodes)if(!visibleTasks.has(id)){entry.element.remove();taskNodes.delete(id);}
    }
    const tabs=next.catalog?.tabs||[],currentTabs=new Set(tabs.map(t=>t.id));
    for(const [id,node] of tabNodes)if(!currentTabs.has(id)){node.remove();tabNodes.delete(id);}
    for(const [index,tab] of tabs.entries()){
      let node=tabNodes.get(tab.id);
      if(!node){node=document.createElement('div');node.append(button('',()=>watch(tab.id)),button('Research autonomy',()=>openResearch(tab.id)));tabNodes.set(tab.id,node);}
      node.firstChild.textContent=`${tab.title} — ${tab.detail}${tab.isBusy?' · Busy':''}`;
      const before=$('assistantWorkspace').children[index];if(before!==node)$('assistantWorkspace').insertBefore(node,before||null);
    }
    if(nearBottom&&!held)feed.scrollTop=feed.scrollHeight;
    if(voice){
      for(const message of [...(next.messages||[]),...(next.taskUpdates||[])])if(message.role==='assistant'&&!spoken.has(message.id)){
        spoken.add(message.id);speechQueue.push(message);
      }
      drainSpeech();
    }
    if($('assistantModel'))$('assistantModel').textContent=next.coordinator?.model?`${next.coordinator.model} · Quick conversation`:'';
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
  function stopSpeech(){speechQueue=[];speechEpoch++;speechAbort?.abort();speechAbort=null;if(audio){audio.pause();audio.src='';audio=null;}if(voice)status(muted?'Microphone muted':'Listening…');}
  function drainSpeech(){
    if(speechRunner||!voice||!speechQueue.length)return;
    speechRunner=(async()=>{
      while(voice&&speechQueue.length){
        const message=speechQueue.shift();
        try{await speak(message);}catch(e){if(e.name!=='AbortError')error(e.message);}
      }
    })().finally(()=>{speechRunner=null;if(voice&&speechQueue.length)drainSpeech();});
  }
  async function speak(message){
    const epoch=speechEpoch,abort=new AbortController();speechAbort=abort;
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
    if(voice||startingVoice)return;startingVoice=true;callVisible=true;const epoch=++voiceEpoch;
    $('assistantCall').hidden=dialog.open;status('Connecting Assistant…');error();
    if(!timer)timer=setInterval(refresh,700);
    try{
      if(!window.dispatchEvent(new Event('clawdad:assistant-will-start-voice',{cancelable:true})))throw new Error('Finish the current dictation before starting a conversation.');
      await refresh();spoken=new Set([...(snapshot?.messages||[]),...(snapshot?.taskUpdates||[])].map(m=>m.id));await ensureAssistant();
      const deadline=Date.now()+60_000;
      while(!snapshot?.nativeOnline||!snapshot?.catalog){
        if(voiceEpoch!==epoch)return;
        if(Date.now()>deadline)throw new Error('Assistant is waiting for the Mac workspace. Your conversation is saved.');
        await new Promise(resolve=>setTimeout(resolve,350));await refresh();
      }
      if(voiceEpoch!==epoch)return;
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
    }catch(e){if(voiceEpoch===epoch){endVoice();callVisible=true;$('assistantCall').hidden=dialog.open;error(e.message);status('Assistant could not connect. Open Messages to retry.');}}finally{if(voiceEpoch===epoch)startingVoice=false;}
  }
  function endVoice(){voiceEpoch++;voice=false;startingVoice=false;callVisible=false;stopSpeech();stream?.getTracks().forEach(t=>t.stop());stream=null;capture?.disconnect();capture=null;context?.close();context=null;uploadQueue=[];transcript=[];$('assistantCall').hidden=true;$('assistantMuteInline').hidden=true;$('assistantTalk').textContent='Call Assistant';status('Conversation saved');window.dispatchEvent(new CustomEvent('clawdad:assistant-voice',{detail:{active:false}}));}
  function setMuted(value){muted=value;capture?.port.postMessage({muted});for(const id of ['assistantMute','assistantMuteInline'])$(id).textContent=muted?'Unmute':'Mute';status(muted?'Microphone muted':'Listening…');}
  $('assistantTalk').onclick=()=>voice?endVoice():startVoice();$('assistantEnd').onclick=endVoice;
  $('assistantMute').onclick=()=>setMuted(!muted);
  $('assistantMuteInline').onclick=()=>setMuted(!muted);
  window.addEventListener('beforeunload',endVoice);
}
