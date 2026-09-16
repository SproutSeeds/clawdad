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
  let state,busy=false,pending,preview;
  const storageKey='clawdad.codex.accounts.pending.v1';
  try{pending=JSON.parse(storage.getItem(storageKey)||'null');}catch{}
  const save=button('Save account entry',()=>send('accounts.add',{email:email.value,workspaceLabel:workspace.value,expectedRevision:state.revision}));
  const retry=button('Retry pending request',()=>send()),refresh=button('Refresh account status',()=>load());
  const explanation=el('p','An entry records your choice. It becomes authenticated only after supported sign-in is verified.');
  details.append(summary,emailLabel,workspaceLabel,explanation,save);
  root.append(title,current,help,status,list,details,error,retry,refresh);
  function render(){
    current.textContent=state?.current?.email?`${state.current.email} · ${state.current.plan||'Subscription'}${state.current.status==='current'?'':' · Last verified reading'}`:'Verified Codex account unavailable';
    status.textContent=state?.activeOperation?.reason||state?.capabilities?.reasons?.map(r=>r.message).join(' ')||'';
    list.replaceChildren();
    for(const account of state?.accounts||[]){
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
        connect.disabled=busy||!!pending||connecting;row.append(connect);
        if(account.authentication!=='verified'){
          const check=button('Check saved sign-in',()=>send('accounts.verify_signin',{accountId:account.id}));
          check.disabled=busy||!!pending||connecting;row.append(check);
          if(signIn?.status==='needs_check'||signIn?.status==='needs_attention'){
            const reconnect=button('Reconnect account on Mac',()=>send('accounts.signin',{accountId:account.id,confirmed:true,reauthenticate:true}));
            reconnect.disabled=busy||!!pending||connecting;row.append(reconnect);
          }
        }
        if(connecting)row.append(button('Cancel sign-in',()=>send('accounts.cancel_signin',{operationId:signIn.requestId})));
      }
      const inspect=button('Review affected sessions',async()=>{
        try{const result=await request({action:'accounts.preview',accountId:account.id});preview=result.accountPreview;error.textContent='';render();}
        catch(e){error.textContent=e.message;}
      });
      const select=button(state?.capabilities?.ready?'Switch to this account':'Prepare account switch',()=>send('accounts.switch',{accountId:account.id,expectedRevision:state.revision,confirmed:true}));
      inspect.disabled=busy||!!pending;select.disabled=busy||!!pending;row.append(inspect,select);list.append(row);
    }
    if(preview){const box=el('details'),label=el('summary','Affected sessions');box.open=true;box.append(label);
      for(const c of preview.observation?.consumers||[])box.append(el('p',`${c.title||c.kind}${c.sessionId?' · '+c.sessionId:''}\n${c.reason||''}`));
      for(const reason of preview.observation?.reasons||[])box.append(el('p',reason));list.append(box);}
    if(state?.activeOperation?.fenced){list.append(button('Cancel switch',()=>send('accounts.cancel',{operationId:state.activeOperation.id})),
      button('Check recovery',()=>send('accounts.reconcile',{})));}
    save.disabled=busy||!!pending||!state||!email.checkValidity()||!email.value.trim();refresh.disabled=busy;
    retry.hidden=!pending;retry.disabled=busy;root.setAttribute('aria-busy',String(busy));
  }
  async function send(action,args){
    if(busy)return;
    if(!pending){pending={action,...args,requestId:crypto.randomUUID()};storage.setItem(storageKey,JSON.stringify(pending));}
    busy=true;error.textContent='';render();
    try{const value=await request(pending);state=value.accounts;error.textContent=value.accountReceipt?.accepted===false?value.accountReceipt.error:'';pending=null;storage.removeItem(storageKey);}
    catch(e){error.textContent=e.message+' Your pending selection is retained; Retry uses the same request.';}
    finally{busy=false;render();}
  }
  async function load(){if(busy)return;try{const result=await request({action:'accounts.status'});
    if(JSON.stringify(state)!==JSON.stringify(result.accounts)){state=result.accounts;render();}
  }catch(e){error.textContent=e.message;}}
  // Poll only an open panel with a pending ceremony. Rendering never starts
  // authentication; the Mac owns completion after the panel closes.
  const poll=setInterval(()=>{if(root.isConnected&&root.open!==false&&!busy&&!pending
    &&state?.accounts?.some(a=>['checking','starting','awaiting_user','cancelling'].includes(a.authorization?.operation?.status)))void load();},1500);
  email.oninput=render;workspace.oninput=render;
  return {load,render,dispose:()=>clearInterval(poll)};
}

const root=document.getElementById('codexAccounts');
if(root){const panel=codexAccountsPanel(root);root.addEventListener('toggle',()=>{if(root.open)void panel.load();});}
