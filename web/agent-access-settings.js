const section=document.getElementById('agentAccessSettings');
if(section){
  const form=section.querySelector('[data-form]'),status=section.querySelector('[role=status]'),decisions=section.querySelector('[data-decisions]');
  const field=name=>form.querySelector(`[name="${name}"]`);
  const modal=document.getElementById('settingsModal');let state,loading=false,pending=null;
  const request=async(action,args={})=>{
    const response=await fetch('/v1/assistant/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,requestId:crypto.randomUUID(),...args})});
    const value=await response.json();if(!response.ok)throw Error(value.error||'Agent settings are unavailable.');return value;
  };
  const node=(tag,text)=>{const element=document.createElement(tag);element.textContent=text;return element;};
  function renderQuestions(items){
    decisions.replaceChildren();
    for(const item of items){
      const card=document.createElement('div');card.className='assistant-model-form';card.append(node('h4','Agent needs your decision'));
      const params=item.params||{};card.append(node('p',params.reason||params.message||params.command||item.method));
      const questions=params.questions||[],fields=new Map();
      for(const question of questions){
        const label=node('label',question.question||question.header);const input=document.createElement('input');input.type='text';input.required=true;
        if(question.options?.length)label.append(node('small',question.options.map(o=>o.label+' — '+(o.description||'')).join('\n')));
        label.append(input);card.append(label);fields.set(question.id,input);
      }
      let content;
      if(item.method==='mcpServer/elicitation/request'){
        card.append(node('pre',JSON.stringify(params.requestedSchema||params.schema||params,null,2)));
        content=document.createElement('textarea');content.setAttribute('aria-label','Connected tool response as JSON');content.placeholder='{}';card.append(content);
      }else if(!questions.length)card.append(node('pre',JSON.stringify(params,null,2)));
      const allow=node('button',questions.length?'Submit answers':'Allow once'),decline=node('button','Decline');allow.type='button';decline.type='button';
      for(const b of [allow,decline]){b.className='detail-action-button';card.append(b);}
      const send=async decision=>{
        allow.disabled=decline.disabled=true;
        try{await request('access.decide',{approvalId:item.id,decision,
          ...(questions.length?{answers:Object.fromEntries([...fields].map(([id,input])=>[id,{answers:[input.value]}]))}:{}),
          ...(content&&decision==='approve'?{content:JSON.parse(content.value||'{}')}:{})});await refresh();}
        catch(error){status.textContent=error.message;allow.disabled=decline.disabled=false;}
      };
      allow.onclick=()=>{if([...fields.values()].every(input=>input.reportValidity()))void send('approve');};decline.onclick=()=>void send('decline');decisions.append(card);
    }
  }
  async function refresh(){
    if(loading)return;loading=true;
    try{const value=await request('access.read');state=value.access;
      for(const key of ['mode','reviewer'])field(key).value=state.policy[key];
      for(const key of ['nativeTools','computerUse'])field(key).checked=state.policy[key];
      renderQuestions(value.pendingDecisions||[]);status.textContent=value.nativeOnline?'Settings apply to new requests. Current work keeps its permissions.':'Native control is offline. Keep the desktop app open.';
    }catch(error){status.textContent=error.message;}finally{loading=false;}
  }
  form.querySelector('[data-save]').onclick=async event=>{
    event.preventDefault();if(!state)return;
    const policy={mode:field('mode').value,reviewer:field('reviewer').value,nativeTools:field('nativeTools').checked,computerUse:field('computerUse').checked};
    const args={policy,expectedRevision:state.revision},fingerprint=JSON.stringify(args);
    if(pending?.fingerprint!==fingerprint)pending={fingerprint,requestId:crypto.randomUUID()};
    const save=form.querySelector('button');save.disabled=true;
    try{state=(await request('access.update',{...args,requestId:pending.requestId})).access;pending=null;status.textContent='Saved for subsequent requests on this computer.';}
    catch(error){status.textContent=error.message;}finally{save.disabled=false;}
  };
  section.querySelector('[data-refresh]').onclick=refresh;
  new MutationObserver(()=>{if(!modal.hidden)void refresh();}).observe(modal,{attributes:true,attributeFilter:['hidden']});
}
