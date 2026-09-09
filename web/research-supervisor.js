export function researchSupervisorPanel(request) {
  const dialog=document.createElement('dialog');dialog.className='assistant-dialog research-dialog';
  const title=document.createElement('h2');title.textContent='Research autonomy';
  const close=document.createElement('button');close.textContent='Done';close.onclick=()=>dialog.close();
  const state=document.createElement('p'),error=document.createElement('p');error.setAttribute('role','status');
  const form=document.createElement('form'),controls=document.createElement('div'),history=document.createElement('div');
  const fields={};
  for(const [key,label] of Object.entries({objective:'Objective',scope:'Allowed scope',requirements:'Verification requirements, one per line',evidenceRoot:'Evidence directory on your Mac',evidencePaths:'Reports/checkpoints, one path per line'})){
    const container=document.createElement('label'),input=document.createElement(key==='evidenceRoot'?'input':'textarea');
    container.textContent=label;input.name=key;input.required=key!=='evidencePaths';container.append(input);form.append(container);fields[key]=input;
  }
  const enable=document.createElement('button');enable.textContent='Enable for this exact thread';form.append(enable);
  const explanation=document.createElement('p');explanation.textContent='Off by default. Reviews completed work and sends bounded continuations within your approved objective. At 20% weekly allowance, new automatic work pauses until you explicitly approve a bounded override. Running tasks may consume more. A reset does not clear the pause.';
  dialog.append(title,close,state,explanation,form,controls,error,history);document.body.append(dialog);
  let target=null,thread=null,timer=null,pending=null,data=null,opener=null,draftKey=null;
  const drafts=new Map();
  const call=(action,args={},id=crypto.randomUUID())=>request('/v1/assistant/request',{action,...args,requestId:id});
  const button=(name,action)=>{const b=document.createElement('button');b.type='button';b.textContent=name;b.onclick=action;return b;};
  async function mutate(action,args){
    const fingerprint=JSON.stringify({action,args});
    if(!pending||pending.fingerprint!==fingerprint)pending={fingerprint,id:crypto.randomUUID()};
    try{await call(action,args,pending.id);pending=null;error.textContent='';await refresh();}catch(e){error.textContent=e.message+' Retry the same control to check its original request.';}
  }
  async function refresh(){
    try{
      ({research:data}=await call('research.status'));
      thread=data.threads.find(t=>t.sessionId===target?.sessionId&&t.agentInstanceId===target?.agentInstanceId)||null;
      state.textContent=`${target?.tabTitle||'Selected agent'} · ${thread?.status||'Off'}${thread?.reason?' · '+thread.reason:''}`;
      form.hidden=!!thread?.enabled;
      if(controls.contains(document.activeElement)&&['TEXTAREA','INPUT'].includes(document.activeElement.tagName))return;
      const selection=window.getSelection();if(selection&&!selection.isCollapsed&&controls.contains(selection.anchorNode))return;
      controls.replaceChildren();
      if(thread?.enabled){
        const objective=document.createElement('p');objective.textContent=thread.objective;controls.append(objective);
        for(const [label,action]of [['Pause automatic work','pause'],['Resume approved objective','resume'],['Turn autonomy off','off']])controls.append(button(label,()=>mutate('research.'+action,{threadId:thread.id,...(action==='resume'?{confirmed:true}:{})})));
        const steering=document.createElement('textarea');steering.placeholder='Steer the next review within the approved scope';steering.setAttribute('aria-label','Manual steering');
        // Preserve an unsent steering draft across polling and navigation.
        steering.value=dialog.dataset.steering||'';steering.oninput=()=>dialog.dataset.steering=steering.value;
        controls.append(steering,button('Apply steering',async()=>{if(steering.value.trim()){await mutate('research.steer',{threadId:thread.id,text:steering.value,confirmed:true});if(!pending){dialog.dataset.steering='';steering.value='';}}}));
        const account=data.budget.accounts.find(a=>a.accountKey===thread.accountKey);
        if(account?.latched){
          const reserve=document.createElement('input'),limit=document.createElement('input');
          reserve.type=limit.type='number';reserve.min='0';reserve.max='20';reserve.value=dialog.dataset.reserve||'10';limit.min='1';limit.max='20';limit.value=dialog.dataset.limit||'3';
          reserve.setAttribute('aria-label','Revised percent reserve');limit.setAttribute('aria-label','Maximum additional reviews');
          reserve.oninput=()=>dialog.dataset.reserve=reserve.value;limit.oninput=()=>dialog.dataset.limit=limit.value;
          controls.append(reserve,limit,button('Review budget override',()=>{
            if(confirm(`Approve up to ${limit.value} reviews for this exact thread and account, with a ${reserve.value}% reserve, until the next weekly cycle or 24 hours? This does not purchase usage.`))void mutate('research.override',{accountKey:thread.accountKey,threadIds:[thread.id],threshold:Number(reserve.value),maxReviews:Number(limit.value),confirmed:true});
          }));
        }
      }
      if(thread&&!history.childElementCount)history.append(button('Open decision history',()=>loadHistory(0)));
    }catch(e){error.textContent=e.message;}
  }
  async function loadHistory(cursor){
    try{
      const {researchHistory:page}=await call('research.history',{threadId:thread.id,cursor});
      if(!cursor)history.replaceChildren();
      for(const entry of page.entries){const row=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('pre');summary.textContent=`${entry.at} · ${entry.text}`;body.textContent=JSON.stringify(entry,null,2);row.append(summary,body);history.append(row);}
      if(page.nextCursor!==null)history.append(button('More history',event=>loadHistory(page.nextCursor)));
    }catch(e){error.textContent=e.message;}
  }
  form.onsubmit=async event=>{
    event.preventDefault();if(!target?.sessionId)return;
    if(!confirm('Enable automatic research continuations for this exact agent, objective and scope?'))return;
    const lines=value=>value.split('\n').map(s=>s.trim()).filter(Boolean);
    await mutate('research.enable',{confirmed:true,tabId:target.tabId,sessionId:target.sessionId,agentInstanceId:target.agentInstanceId,
      objective:fields.objective.value,scope:fields.scope.value,requirements:lines(fields.requirements.value),evidenceRoot:fields.evidenceRoot.value,evidencePaths:lines(fields.evidencePaths.value)});
  };
  dialog.addEventListener('close',()=>{
    clearInterval(timer);
    if(draftKey)drafts.set(draftKey,{fields:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value])),steering:dialog.dataset.steering||''});
    opener?.focus();
  });
  return async(tabId)=>{
    opener=document.activeElement;error.textContent='';history.replaceChildren();dialog.showModal();enable.disabled=true;
    try{
      ({researchTarget:target}=await call('research.target',{tabId}));
      draftKey=target.agentInstanceId+':'+target.sessionId;
      const saved=drafts.get(draftKey);
      for(const [key,input]of Object.entries(fields))input.value=saved?.fields[key]||(key==='evidenceRoot'?target.directory||'':'');
      dialog.dataset.steering=saved?.steering||'';
      enable.disabled=!target.sessionId;await refresh();timer=setInterval(refresh,5000);
    }
    catch(e){error.textContent=e.message;}
  };
}
