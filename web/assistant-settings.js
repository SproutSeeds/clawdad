const section=document.getElementById('assistantModelSettings');
if(section){
  let configuration=null,loading=false;
  const rows=section.querySelector('[data-rows]'),status=section.querySelector('[role=status]');
  const request=async(action,args={})=>{
    const response=await fetch('/v1/assistant/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,requestId:crypto.randomUUID(),...args})});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Assistant settings could not be saved.');return result.settings;
  };
  const text=(tag,value)=>{const e=document.createElement(tag);e.textContent=value;return e;};
  function editor(title,scope,selection,supervisor){
    const form=document.createElement('form');form.className='assistant-model-form';form.append(text('h4',title));
    if(supervisor)form.append(text('small',`${supervisor.project||''} · ${supervisor.sessionId}`));
    const inheritance=document.createElement('input');inheritance.type='checkbox';inheritance.checked=!!supervisor?.inherited;
    if(supervisor){const label=text('label','Use research defaults ');label.prepend(inheritance);form.append(label);}
    const model=document.createElement('select'),effort=document.createElement('select');model.setAttribute('aria-label',`${title} model`);effort.setAttribute('aria-label',`${title} reasoning effort`);
    for(const entry of configuration.models)model.add(new Option(entry.displayName,entry.model));
    if(!configuration.models.some(m=>m.model===selection.model))model.add(new Option(`${selection.model} · Unavailable`,selection.model));
    model.value=selection.model;
    function efforts(preferred=effort.value,preserve=false){
      const selected=configuration.models.find(m=>m.model===model.value);effort.replaceChildren();
      for(const value of selected?.supportedReasoningEfforts||[])effort.add(new Option(value,value));
      if(preserve && !selected?.supportedReasoningEfforts.includes(preferred))effort.add(new Option(`${preferred} · Unavailable`,preferred));
      effort.value=preserve||selected?.supportedReasoningEfforts.includes(preferred)?preferred:selected?.defaultReasoningEffort||'';
    }
    efforts(selection.reasoningEffort,true);
    const save=text('button','Save settings');save.type='submit';save.className='detail-action-button';
    const note=text('div',selection.error||'');note.setAttribute('role','status');
    const validate=()=>{model.disabled=effort.disabled=inheritance.checked;save.disabled=inheritance.checked?configuration.researchDefault.available!==true:!configuration.models.some(m=>m.model===model.value&&m.supportedReasoningEfforts.includes(effort.value));};
    model.onchange=()=>{efforts();validate();};effort.onchange=validate;inheritance.onchange=validate;
    form.append(text('label','Model'),model,text('label','Reasoning effort'),effort,save,note);validate();
    let pending=null;
    form.onsubmit=async event=>{
      event.preventDefault();save.disabled=true;
      const args={scope,threadId:supervisor?.id||null,inherit:inheritance.checked,selection:inheritance.checked?null:{model:model.value,reasoningEffort:effort.value},expectedRevision:configuration.revision};
      const fingerprint=JSON.stringify(args);if(pending?.fingerprint!==fingerprint)pending={fingerprint,requestId:crypto.randomUUID()};
      try{configuration=await request('settings.update',{...args,requestId:pending.requestId});render();status.textContent='Saved. Applies to subsequent turns or reviews.';}
      catch(error){note.textContent=error.message;validate();}
    };return form;
  }
  function render(){
    rows.replaceChildren(editor('Main Assistant','main',configuration.main),text('h3','Research Supervisors'),editor('Research defaults','researchDefault',configuration.researchDefault));
    for(const supervisor of configuration.supervisors)rows.append(editor(supervisor.name,'supervisor',supervisor.selection,supervisor));
    if(!configuration.supervisors.length)rows.append(text('p','No configured research supervisors.'));
  }
  async function refresh(){
    if(loading)return;loading=true;status.textContent='Loading available models…';
    try{configuration=await request('settings.read');render();status.textContent=configuration.catalogError||'';}catch(error){status.textContent=error.message;}
    finally{loading=false;}
  }
  section.querySelector('[data-refresh]').onclick=refresh;
  const modal=document.getElementById('settingsModal');
  new MutationObserver(()=>{if(!modal.hidden&&!configuration)refresh();}).observe(modal,{attributes:true,attributeFilter:['hidden']});
}
