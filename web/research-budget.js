// Persistent inputs: status polling must not replace a percentage being edited.
export function researchBudgetPanel(mutate) {
  const root=document.createElement('section');
  const heading=document.createElement('h3');heading.textContent='Weekly allowance';
  const reading=document.createElement('p'),current=document.createElement('p'),reason=document.createElement('p');
  const explanation=document.createElement('p');explanation.textContent='Project limits are optional. Pause this supervisor at a chosen percentage of the shared weekly allowance remaining. 0% permits using the remaining allowance until exhausted. All supervisors and manual work share this account pool. Running tasks may consume more after new work pauses.';
  const choices=document.createElement('div'),label=document.createElement('label'),mode=document.createElement('select');
  label.textContent='This supervisor';
  for(const [value,text]of [['none','No project limit'],['override','Custom stopping percentage']]){const option=document.createElement('option');option.value=value;option.textContent=text;mode.append(option);}label.append(mode);
  const input=(name)=>{const label=document.createElement('label'),field=document.createElement('input');label.textContent=name;field.type='number';field.min='0';field.max='100';field.step='1';field.required=true;label.append(field,document.createTextNode('% remaining'));return {label,field};};
  const custom=input('Pause this supervisor at ');
  const button=text=>{const b=document.createElement('button');b.type='button';b.textContent=text;return b;};
  const customButton=button('Review project limit');
  const expiry=document.createElement('p');expiry.textContent='Project limits end at the current weekly reset and never renew automatically. A reset alone never clears a pause.';
  choices.append(label,custom.label,customButton,expiry);
  const unavailable=document.createElement('p');unavailable.setAttribute('role','status');
  root.append(heading,reading,explanation,current,reason,choices,unavailable);
  let budget,thread,account,identity;
  const valid=field=>field.value.trim()!==''&&Number.isInteger(field.valueAsNumber)&&field.valueAsNumber>=0&&field.valueAsNumber<=100;
  const available=()=>budget?.available&&account&&budget.currentAccountKey===account.accountKey&&budget.usage?.status==='current'&&budget.usage.validUntil>Date.now();
  function buttons(){custom.label.hidden=mode.value!=='override';customButton.disabled=!available()||mode.value==='override'&&!valid(custom.field);}
  mode.onchange=buttons;custom.field.oninput=buttons;
  function approve(scope){
    if(!available())return;
    const args={scope,accountKey:account.accountKey,expectedBudgetRevision:account.revision,confirmed:true};
    let text;
    args.threadId=thread.id;args.expectedRevision=thread.revision;args.mode=mode.value;
    if(mode.value==='override'){
      if(!valid(custom.field))return;
      args.threshold=custom.field.valueAsNumber;
      text=`Approve this exact supervisor to run until ${args.threshold}% weekly allowance remains, through the current weekly cycle?`;
    }else text='Remove this supervisor’s project allowance limit? No automatic app-wide reserve will apply.';
    if(confirm(text+' Stopped and manually paused supervisors stay stopped. Enabled work paused only by allowance may become eligible. Running tasks may use more after pausing. This does not purchase usage.'))void mutate('research.budget',args);
  }
  customButton.onclick=()=>approve('supervisor');
  return {element:root,render(nextBudget,nextThread){
    budget=nextBudget;thread=nextThread;
    const accountKey=thread?.accountKey||budget?.currentAccountKey;
    account=budget?.accounts?.find(a=>a.accountKey===accountKey);
    const nextIdentity=accountKey+':'+(thread?.id||'');
    if(identity!==nextIdentity){identity=nextIdentity;custom.field.value=thread?.budgetPolicy?.threshold==null?'':String(thread.budgetPolicy.threshold);mode.value=['override','legacy_override'].includes(thread?.budgetPolicy?.mode)?'override':'none';}
    const usage=budget?.usage;
    reading.textContent=usage?.remainingPercent!=null?`${usage.remainingPercent}% weekly remaining${available()?'':' · stale or unavailable'}`:'Checking weekly allowance…';
    const policy=thread?.budgetPolicy;
    current.textContent=policy?.threshold!=null?`Current: pause at ${policy.threshold}% weekly remaining`:'No project allowance limit';
    reason.textContent=(policy?.reason||'')+(policy?.expiresAt?' Limit ends '+new Date(policy.expiresAt).toLocaleString()+'.':'');
    choices.hidden=!thread;
    unavailable.textContent=!budget?.available?'Update ClawDad on your Mac to edit allowance settings.':!available()?'A current reading for this signed-in account is required. Refresh to check again.':!thread?'Save the setup with autonomy off to choose a custom limit before starting.':'';
    buttons();
  }};
}
