// Persistent inputs: status polling must not replace a percentage being edited.
export function researchBudgetPanel(mutate) {
  const root=document.createElement('section');
  const heading=document.createElement('h3');heading.textContent='Weekly allowance';
  const reading=document.createElement('p'),current=document.createElement('p'),reason=document.createElement('p');
  const explanation=document.createElement('p');explanation.textContent='Pause at a percentage of the shared weekly allowance remaining. 0% permits using the remaining allowance until exhausted. All supervisors and manual work share this account pool. Running tasks may consume more after new work pauses.';
  const choices=document.createElement('div'),label=document.createElement('label'),mode=document.createElement('select');
  label.textContent='This supervisor';
  for(const [value,text]of [['default','Use shared default'],['override','Custom stopping percentage']]){const option=document.createElement('option');option.value=value;option.textContent=text;mode.append(option);}label.append(mode);
  const input=(name)=>{const label=document.createElement('label'),field=document.createElement('input');label.textContent=name;field.type='number';field.min='0';field.max='100';field.step='1';field.required=true;label.append(field,document.createTextNode('% remaining'));return {label,field};};
  const custom=input('Pause this supervisor at '),shared=input('Pause default supervisors at ');
  const button=text=>{const b=document.createElement('button');b.type='button';b.textContent=text;return b;};
  const customButton=button('Review supervisor limit'),sharedButton=button('Review shared default');
  const expiry=document.createElement('p');expiry.textContent='Custom overrides end at the current weekly reset and never renew automatically. A reset alone never clears a pause.';
  choices.append(label,custom.label,customButton,expiry);
  const details=document.createElement('details'),summary=document.createElement('summary'),sharedHelp=document.createElement('p');
  sharedHelp.textContent='The shared default is saved for this Codex account. Supervisors with custom overrides keep their limits. Reapproving the shared limit can release its account reserve pause.';
  details.append(summary,shared.label,sharedButton,sharedHelp);
  const unavailable=document.createElement('p');unavailable.setAttribute('role','status');
  root.append(heading,reading,explanation,current,reason,choices,details,unavailable);
  let budget,thread,account,identity;
  const valid=field=>field.value.trim()!==''&&Number.isInteger(field.valueAsNumber)&&field.valueAsNumber>=0&&field.valueAsNumber<=100;
  const available=()=>budget?.available&&account&&budget.currentAccountKey===account.accountKey&&budget.usage?.status==='current'&&budget.usage.validUntil>Date.now();
  function buttons(){custom.label.hidden=mode.value!=='override';customButton.disabled=!available()||mode.value==='override'&&!valid(custom.field);sharedButton.disabled=!available()||!valid(shared.field);}
  mode.onchange=buttons;custom.field.oninput=buttons;shared.field.oninput=buttons;
  function approve(scope){
    if(!available())return;
    const args={scope,accountKey:account.accountKey,expectedBudgetRevision:account.revision,confirmed:true};
    let text;
    if(scope==='account_default'){
      if(!valid(shared.field))return;
      args.threshold=shared.field.valueAsNumber;
      text=`Set this account’s shared default to pause at ${args.threshold}% weekly allowance remaining? Custom overrides keep their limits.`;
    }else{
      args.threadId=thread.id;args.expectedRevision=thread.revision;args.mode=mode.value;
      if(mode.value==='override'){
        if(!valid(custom.field))return;
        args.threshold=custom.field.valueAsNumber;
        text=`Approve this exact supervisor to run until ${args.threshold}% weekly allowance remains, overriding the ${account.threshold}% default through the current weekly cycle?`;
      }else text=`Remove this supervisor’s override and use the ${account.threshold}% shared default? An existing shared reserve pause remains in force.`;
    }
    if(confirm(text+' Stopped and manually paused supervisors stay stopped. Enabled work paused only by allowance may become eligible. Running tasks may use more after pausing. This does not purchase usage.'))void mutate('research.budget',args);
  }
  customButton.onclick=()=>approve('supervisor');sharedButton.onclick=()=>approve('account_default');
  return {element:root,render(nextBudget,nextThread){
    budget=nextBudget;thread=nextThread;
    const accountKey=thread?.accountKey||budget?.currentAccountKey;
    account=budget?.accounts?.find(a=>a.accountKey===accountKey);
    const nextIdentity=accountKey+':'+(thread?.id||'');
    if(identity!==nextIdentity){identity=nextIdentity;shared.field.value=String(account?.threshold??20);custom.field.value=String(thread?.budgetPolicy?.threshold??account?.threshold??20);mode.value=['override','legacy_override'].includes(thread?.budgetPolicy?.mode)?'override':'default';}
    const usage=budget?.usage;
    reading.textContent=usage?.remainingPercent!=null?`${usage.remainingPercent}% weekly remaining${available()?'':' · stale or unavailable'}`:'Checking weekly allowance…';
    const policy=thread?.budgetPolicy;
    current.textContent=policy?`Current: pause at ${policy.threshold}% remaining · ${policy.mode==='default'?'shared default':'custom override'}`:'';
    reason.textContent=(policy?.reason||'')+(policy?.expiresAt?' Override ends '+new Date(policy.expiresAt).toLocaleString()+'.':'');
    choices.hidden=!thread;
    summary.textContent=`Shared default: ${account?.threshold??20}% remaining`;
    unavailable.textContent=!budget?.available?'Update ClawDad on your Mac to edit allowance settings.':!available()?'A current reading for this signed-in account is required. Refresh to check again.':!thread?'Save the setup with autonomy off to choose a custom limit before starting.':'';
    buttons();
  }};
}
