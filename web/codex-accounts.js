// Account actions use the existing authenticated Assistant transport. No model,
// call, microphone or sign-in starts merely by viewing this panel.
export function codexAccountsPanel(root,{request=async body=>{
  const r=await fetch('/v1/assistant/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const value=await r.json();if(!r.ok)throw Error(value.error||'Account controls are unavailable.');return value;
},storage=localStorage}={}){
  const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
  const title=el('h3','Codex accounts'),current=el('p'),status=el('p'),list=el('div'),error=el('p');error.setAttribute('role','status');
  const help=el('p','Subscription sign-in stays with Codex. Account switching does not enable API billing.');
  const details=el('details'),summary=el('summary','Add account'),email=el('input'),workspace=el('input');
  const emailLabel=el('label','Account email'),workspaceLabel=el('label','Workspace label (optional)');
  email.type='email';email.autocomplete='email';email.maxLength=254;workspace.maxLength=120;
  emailLabel.append(email);workspaceLabel.append(workspace);
  const button=(text,action)=>{const b=el('button',text);b.type='button';b.onclick=action;return b;};
  const picker=el('select'),pickerLabel=el('label','Account');picker.id='codexAccountSelector';pickerLabel.htmlFor=picker.id;pickerLabel.append(picker);
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.tabIndex=-1;
  status.id='codexAccountSwitchStatus';
  const actions=el('div');
  let state,busy=false,pending,preview,loading=false,selectedId=storage.getItem('clawdad.codex.accounts.selection.v1')||'';
  const storageKey='clawdad.codex.accounts.pending.v1';
  try{pending=JSON.parse(storage.getItem(storageKey)||'null');}catch{}
  const save=button('Save account entry',()=>send('accounts.add',{email:email.value,workspaceLabel:workspace.value,expectedRevision:state.revision}));
  const retry=button('Retry pending request',()=>send()),refresh=button('Refresh account status',()=>load());
  const explanation=el('p','An entry records your choice. It becomes authenticated only after supported sign-in is verified.');
  details.append(summary,emailLabel,workspaceLabel,explanation,save);
  root.append(title,status,error,retry,current,help,pickerLabel,list,actions,details,refresh);
  function render(){
    current.textContent=state?.current?.email?`${state.current.email} · ${state.current.plan||'Subscription'}${state.current.status==='current'?'':' · Last verified reading'}`:'Verified Codex account unavailable';
    const operation=state?.activeOperation,target=state?.accounts?.find(a=>a.id===operation?.targetId);
    status.textContent=(busy?(pending?.action==='accounts.switch'?'Requesting switch…':'Checking account…')+'\n':'')
      +(operation?.reason?(target?`Switch to ${target.email}\n`:'')+operation.reason:'Choose an account, then tap Switch to this account.');
    const entries=state?.accounts||[];
    if(!entries.some(a=>a.id===selectedId))selectedId=pending?.accountId||operation?.targetId||entries[0]?.id||'';
    // Keep the native selector node/options stable while the status polls.
    const options=entries.map(a=>({id:a.id,label:a.email+(a.workspaceLabel?' · '+a.workspaceLabel:'')}));
    if(picker.dataset.options!==JSON.stringify(options)){
      picker.replaceChildren(...options.map(a=>{const o=el('option',a.label);o.value=a.id;return o;}));picker.dataset.options=JSON.stringify(options);
    }
    picker.value=selectedId;picker.disabled=busy||!!pending||!entries.length;
    list.replaceChildren();actions.replaceChildren();
    for(const account of entries.filter(a=>a.id===selectedId)){
      const row=el('section'),name=el('strong',account.email),label=el('p',account.workspaceLabel?`${account.workspaceLabel} · label supplied by you`:'Codex does not provide a workspace name here.');
      const authorization=account.authorization,signIn=authorization?.operation;
      const auth=el('p',account.authentication==='verified'?'Saved subscription sign-in verified':'First sign-in or verification required');
      row.append(name,label,auth);
      if(authorization?.verifiedAt)row.append(el('p',`Last checked: ${new Date(authorization.verifiedAt).toLocaleString()}`));
      if(signIn?.reason)row.append(el('p',signIn.reason));
      const connecting=['checking','starting','awaiting_user','cancelling'].includes(signIn?.status);
      if(state.canConnectAccounts){
        const connect=button(account.authentication==='verified'?'Check saved sign-in':'Connect account on Mac',()=>send(
          account.authentication==='verified'?'accounts.verify_signin':'accounts.signin',{accountId:account.id,confirmed:true}));
        connect.disabled=busy||!!pending||connecting||!!operation?.fenced;row.append(connect);
        if(account.authentication!=='verified'){
          const check=button('Check saved sign-in',()=>send('accounts.verify_signin',{accountId:account.id}));
          check.disabled=busy||!!pending||connecting||!!operation?.fenced;row.append(check);
          if(signIn?.status==='needs_check'||signIn?.status==='needs_attention'){
            const reconnect=button('Reconnect account on Mac',()=>send('accounts.signin',{accountId:account.id,confirmed:true,reauthenticate:true}));
            reconnect.disabled=busy||!!pending||connecting||!!operation?.fenced;row.append(reconnect);
          }
        }
        if(connecting)row.append(button('Cancel sign-in',()=>send('accounts.cancel_signin',{operationId:signIn.requestId})));
      }
      const inspect=button('Review affected sessions',async()=>{
        if(busy||loading)return;busy=true;render();
        try{const result=await request({action:'accounts.preview',accountId:account.id});preview=result.accountPreview;error.textContent='';render();}
        catch(e){error.textContent=e.message;}finally{busy=false;render();}
      });
      const select=button(operation?.fenced?'Switch in progress':state?.capabilities?.ready?'Switch to this account':'Prepare account switch',()=>send('accounts.switch',{accountId:account.id,expectedRevision:state.revision,confirmed:true}));
      inspect.disabled=busy||!!pending;select.disabled=busy||!!pending||connecting||!!operation?.fenced;select.id='codexAccountSwitch';row.append(inspect,select);list.append(row);
    }
    if(preview){const box=el('details'),label=el('summary','Affected sessions');box.open=true;box.append(label);
      for(const c of preview.observation?.consumers||[])box.append(el('p',`${c.title||c.kind}${c.sessionId?' · '+c.sessionId:''}\n${c.reason||''}`));
      for(const reason of preview.observation?.reasons||[])box.append(el('p',reason));list.append(box);}
    if(state?.activeOperation?.fenced){actions.append(state.activeOperation.cancelRequested
      ?button('Continue original switch',()=>send('accounts.continue',{operationId:state.activeOperation.id,confirmed:true}))
      :button('Cancel switch',()=>send('accounts.cancel',{operationId:state.activeOperation.id})),
      button('Check recovery',()=>send('accounts.reconcile',{})));for(const b of actions.querySelectorAll('button'))b.disabled=busy||!!pending;}
    if(state?.activeOperation?.retainedReceipts?.length)list.append(el('p',`${state.activeOperation.retainedReceipts.length} earlier delivery receipts remain saved for review. Account switching will not retry those messages.`));
    save.disabled=busy||!!pending||!state||!email.checkValidity()||!email.value.trim();refresh.disabled=busy;
    retry.hidden=!pending;retry.disabled=busy;root.setAttribute('aria-busy',String(busy));
  }
  picker.onchange=()=>{selectedId=picker.value;storage.setItem('clawdad.codex.accounts.selection.v1',selectedId);preview=null;render();};
  function accept(value){
    state=value.accounts||state;
    const received=pending?.action==='accounts.switch'&&state?.operations?.some(o=>o.id===pending.requestId&&o.targetId===pending.accountId)
      ||['accounts.signin','accounts.verify_signin'].includes(pending?.action)&&state?.accounts?.some(a=>a.id===pending.accountId&&a.authorization?.operation?.requestId===pending.requestId);
    if(received||pending&&value.accountReceipt?.accepted===true&&value.accountReceipt.requestId===pending.requestId&&value.accountReceipt.accountId===pending.accountId){pending=null;storage.removeItem(storageKey);error.textContent='';}
  }
  async function send(action,args){
    if(busy)return;
    if(!pending){pending={action,...args,requestId:crypto.randomUUID()};storage.setItem(storageKey,JSON.stringify(pending));}
    busy=true;error.textContent='';render();status.scrollIntoView({block:'nearest'});status.focus({preventScroll:true});
    try{const value=await request(pending);accept(value);if(action==='accounts.add'&&value.accountReceipt?.account?.id){selectedId=value.accountReceipt.account.id;storage.setItem('clawdad.codex.accounts.selection.v1',selectedId);}error.textContent=value.accountReceipt?.accepted===false?value.accountReceipt.error:'';pending=null;storage.removeItem(storageKey);}
    catch(e){error.textContent=e.message+' Your pending selection is retained; Retry uses the same request.';}
    finally{busy=false;render();}
  }
  async function load(){if(busy||loading)return;loading=true;try{const result=await request({action:'accounts.status',...(pending?{receiptId:pending.requestId}:{})});
    if(!busy){accept(result);render();}
  }catch(e){error.textContent=e.message;}finally{loading=false;}}
  // Poll only an open panel with a pending ceremony. Rendering never starts
  // authentication; the Mac owns completion after the panel closes.
  const poll=setInterval(()=>{if(root.isConnected&&root.open!==false&&!busy
    &&(pending||state?.activeOperation?.fenced||state?.accounts?.some(a=>['checking','starting','awaiting_user','cancelling'].includes(a.authorization?.operation?.status))))void load();},1500);
  email.oninput=render;workspace.oninput=render;
  return {load,render,dispose:()=>clearInterval(poll)};
}

const root=document.getElementById('codexAccounts');
if(root){const panel=codexAccountsPanel(root);root.addEventListener('toggle',()=>{if(root.open)void panel.load();});}
