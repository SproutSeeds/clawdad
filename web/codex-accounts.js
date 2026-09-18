// One computer-owned active account; the dropdown is a read-only preview.
export function codexAccountsPanel(root,{request=async body=>{
  const response=await fetch('/v1/assistant/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const value=await response.json();if(!response.ok)throw Error(value.error||'Connect to your Mac to check accounts.');return value;
},storage=localStorage}={}){
  const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
  const button=(text,fn)=>{const b=el('button',text);b.type='button';b.onclick=fn;return b;};
  const active=el('p'),picker=el('select'),label=el('label','Account to view'),usage=el('strong'),reset=el('p'),checked=el('p'),explanation=el('p');
  picker.id='codexAccountSelector';label.htmlFor=picker.id;label.append(picker);
  const card=el('section'),status=el('p'),error=el('p'),workspace=el('p');card.className='account-glass-card';
  status.id='codexAccountSwitchStatus';status.setAttribute('role','status');error.setAttribute('role','status');
  const activate=button('Activate',()=>send('accounts.activate',{accountId:selected,expectedRevision:state.revision,confirmed:true}));activate.id='codexAccountSwitch';
  const refresh=button('Refresh reading',()=>preview(true));refresh.className='account-secondary';
  const recover=button('Retry activation',()=>send('accounts.retry',{operationId:state.activeOperation.id,confirmed:true}));
  const cancel=button('Cancel activation',()=>send('accounts.cancel',{operationId:state.activeOperation.id}));
  const retry=button('Retry request',()=>send());
  const signIn=button('Sign in on Mac',()=>send('accounts.signin',{accountId:selected,confirmed:true,reauthenticate:true}));
  const signInCancel=button('Cancel sign-in',()=>send('accounts.cancel_signin',{operationId:account()?.authorization?.operation?.requestId}));
  const more=el('details'),summary=el('summary','Add account'),email=el('input'),emailLabel=el('label','Email');
  email.type='email';email.autocomplete='email';email.maxLength=254;emailLabel.append(email);
  const add=button('Save account',()=>send('accounts.add',{email:email.value,expectedRevision:state.revision}));
  more.append(summary,emailLabel,el('p','Complete subscription sign-in on your Mac after saving.'),add);
  const help=el('p','Active for this Mac’s ClawDad projects, Assistant and supervisor reviews.');help.className='account-scope';
  card.append(label,usage,reset,checked,explanation,workspace,refresh,signIn,signInCancel,activate);
  root.append(active,card,status,error,recover,cancel,retry,more,help);
  let state,selected='',busy=false,loading=false,pending;
  const key='clawdad.app-account.pending.v2';try{pending=JSON.parse(storage.getItem(key)||'null');}catch{}
  const account=()=>state?.accounts?.find(a=>a.id===selected);
  const date=value=>new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value));
  function render(){
    const entries=state?.accounts||[],activeAccount=entries.find(a=>a.id===state.activeAccountId);
    active.textContent=state?.current?.status==='unavailable'?'Active account unavailable':
      'Active · '+(state?.current?.email||activeAccount?.email||(state?.requiresActivation?'Choose an account':'Checking account…'));
    if(!entries.some(a=>a.id===selected))selected=state?.activeAccountId||state?.selectedAccountId||entries[0]?.id||'';
    const options=entries.map(a=>({id:a.id,label:a.email+(a.id===state.activeAccountId?' · Active':'')}));
    if(picker.dataset.options!==JSON.stringify(options)){picker.replaceChildren(...options.map(a=>{const o=el('option',a.label);o.value=a.id;return o;}));picker.dataset.options=JSON.stringify(options);}
    picker.value=selected;picker.disabled=!entries.length;
    const entry=account(),reading=entry?.usage,auth=entry?.authorization,ceremony=auth?.operation,op=state?.activeOperation;
    usage.textContent=reading?.remainingPercent==null?'Weekly allowance unavailable':`${reading.remainingPercent}% weekly remaining`;
    reset.textContent=reading?.resetsAt?'Resets '+date(reading.resetsAt*1000):'Reset time unavailable';
    checked.textContent=reading?.observedAt?'Last checked '+date(reading.observedAt):'No verified reading yet';
    workspace.textContent='Workspace: '+(auth?.subscription?.workspaceName||'Not exposed by Codex');
    const stale=reading?.status!=='current'||Date.now()-Date.parse(reading?.observedAt||'')>300000;
    explanation.textContent=stale?(reading?.message||'This is an older reading. Refresh to check the current allowance.'):
      reading?.ordinaryUsageAllowed===false?'Subscription access is currently limited. Activation is available; model work may need to wait for the applicable limit to reset.':'';
    const connecting=['checking','starting','awaiting_user','cancelling'].includes(ceremony?.status),isActive=selected===state?.activeAccountId;
    activate.textContent=isActive&&!op?.fenced?'Active':op?.fenced&&op.targetId===selected?
      op.status==='needs_attention'?'Needs attention':op.status==='waiting'?
        op.reasonCode==='app_process_reader_unavailable'?'Waiting for Mac…':op.reasonCode==='accepted_app_work'||op.reasonCode==='shared_thread_working'||op.reasonCode==='shared_thread_pending'?'Waiting for app work…':'Checking app state…'
        :'Activating…':'Activate';
    activate.disabled=busy||!!pending||isActive&&!op?.fenced||!!op?.fenced||entry?.authentication!=='verified'||state?.capabilities?.appOnly!==true;
    activate.setAttribute('aria-label',isActive?'Active ClawDad account':'Activate '+(entry?.email||'selected account'));
    status.textContent=op?.fenced?op.reason||'Checking activation…':!state?'Loading accounts…':state.requiresActivation?
      'Activate a saved account to start ClawDad work.':state.current?.status==='unavailable'?state.current.message||'Reconnect to verify the running app account.':
      state.capabilities?.appOnly!==true?'Update ClawDad on the Mac to use app-only account activation.':'';
    recover.hidden=op?.status!=='needs_attention';recover.disabled=busy||!!pending;
    cancel.hidden=!op?.fenced||!['preflight','authenticate'].includes(op.phase);cancel.disabled=busy||!!pending;
    refresh.disabled=busy||connecting||!selected;
    signIn.hidden=!entry||entry.authentication==='verified'||connecting;signIn.disabled=busy||!!pending;
    signInCancel.hidden=!connecting;signInCancel.disabled=busy||!!pending;
    if(connecting)explanation.textContent=ceremony.reason||'Checking saved sign-in…';
    retry.hidden=!pending;retry.disabled=busy;add.disabled=busy||!!pending||!state||!email.checkValidity()||!email.value.trim();
    root.setAttribute('aria-busy',String(busy));
  }
  function accept(value){
    const before=state?.activeAccountId;
    state=value.accounts||state;
    if(before!==state?.activeAccountId)window.dispatchEvent(new Event('clawdad-account-updated'));
    if(pending&&(value.accountReceipt?.requestId===pending.requestId||state?.operations?.some(o=>o.id===pending.requestId))){pending=null;storage.removeItem(key);}
    if(value.accountReceipt?.accepted===false)error.textContent=value.accountReceipt.error;
  }
  async function send(action,args){
    if(busy)return;if(!pending){pending={action,...args,requestId:crypto.randomUUID()};storage.setItem(key,JSON.stringify(pending));}
    busy=true;error.textContent='';render();
    try{const result=await request(pending);accept(result);if(result.accountReceipt?.account?.id)selected=result.accountReceipt.account.id;
      pending=null;storage.removeItem(key);window.dispatchEvent(new Event('clawdad-account-updated'));}
    catch(e){error.textContent=e.message+' Retry keeps this same request.';}finally{busy=false;render();}
  }
  async function preview(force=false){
    if(!selected)return;
    const id=selected;
    try{const result=await request({action:force?'accounts.refresh':'accounts.preview',accountId:id,requestId:crypto.randomUUID()});accept(result);render();}
    catch(e){error.textContent=e.message;}
  }
  async function load(){
    if(loading||busy)return;loading=true;
    try{accept(await request({action:'accounts.status',...(pending?{receiptId:pending.requestId}:{})}));render();}
    catch(e){error.textContent=e.message;}finally{loading=false;}
  }
  picker.onchange=()=>{selected=picker.value;render();void preview(true);};email.oninput=render;
  const poll=setInterval(()=>{if(root.isConnected&&root.closest('dialog')?.open!==false)void load();},2000);
  return {load:async()=>{await load();void preview(true);},render,dispose:()=>clearInterval(poll)};
}
const root=document.getElementById('codexAccounts');
if(root){const panel=codexAccountsPanel(root);window.addEventListener('clawdad-open-usage',()=>void panel.load());}
