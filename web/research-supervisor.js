import {researchBudgetPanel} from './research-budget.js';
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
  const enable=document.createElement('button');enable.textContent='Enable for this exact thread';
  const save=document.createElement('button');save.textContent='Save setup with autonomy off';save.dataset.saveOnly='1';form.append(save,enable);
  const explanation=document.createElement('p');explanation.textContent='Off by default. Reviews completed work and sends bounded continuations within your approved objective. New automatic work follows the shared weekly stopping default or this supervisor’s approved override. Running tasks may consume more. A reset does not clear a pause.';
  dialog.append(title,close,state,explanation,form,controls,error,history);document.body.append(dialog);
  let target=null,thread=null,timer=null,pending=null,data=null,opener=null,draftKey=null;
  const drafts=new Map();
  const budgetPanel=researchBudgetPanel(mutate);dialog.insertBefore(budgetPanel.element,error);
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
      budgetPanel.render(data.budget,thread);
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
    const saveOnly=event.submitter===save;
    if(!saveOnly&&!confirm('Enable automatic research continuations for this exact agent, objective and scope, using its approved weekly stopping limit?'))return;
    const lines=value=>value.split('\n').map(s=>s.trim()).filter(Boolean);
    await mutate(saveOnly?'research.configure':'research.enable',{confirmed:true,...(saveOnly?{start:false}:{}),...(thread?{threadId:thread.id,expectedRevision:thread.revision}:{}),tabId:target.tabId,sessionId:target.sessionId,agentInstanceId:target.agentInstanceId,
      objective:fields.objective.value,scope:fields.scope.value,requirements:lines(fields.requirements.value),evidenceRoot:fields.evidenceRoot.value,evidencePaths:lines(fields.evidencePaths.value)});
  };
  dialog.addEventListener('close',()=>{
    clearInterval(timer);
    if(draftKey)drafts.set(draftKey,{fields:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value])),steering:dialog.dataset.steering||''});
    opener?.focus();
  });
  return async(tabId)=>{
    opener=document.activeElement;error.textContent='';history.replaceChildren();dialog.showModal();enable.disabled=true;save.disabled=true;
    try{
      ({researchTarget:target}=await call('research.target',{tabId}));
      draftKey=target.agentInstanceId+':'+target.sessionId;
      const saved=drafts.get(draftKey);
      for(const [key,input]of Object.entries(fields))input.value=saved?.fields[key]||(key==='evidenceRoot'?target.directory||'':'');
      dialog.dataset.steering=saved?.steering||'';
      enable.disabled=save.disabled=!target.sessionId;await refresh();
      if(thread&&!saved)for(const [key,input]of Object.entries(fields))input.value=Array.isArray(thread[key])?thread[key].join('\n'):thread[key]||input.value;
      timer=setInterval(refresh,5000);
    }
    catch(e){error.textContent=e.message;}
  };
}
