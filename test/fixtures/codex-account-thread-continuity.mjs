// Bounded, user-authorized two-account continuity experiment. Production homes,
// Terminal tabs and project histories are outside this fixture's allowlist.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createHash,randomUUID} from 'node:crypto';
import {normalizeWeeklyUsage} from '../../lib/codex-weekly-usage.mjs';
import {researchSave} from '../../lib/research-budget.mjs';
import {acquireCodexDeliveryClaim} from '../../lib/codex-delivery-claim.mjs';

if(process.argv[2]!=='--approved-two-account-fixture')throw Error('Use only the approved disposable continuity plan.');
const base=path.join(os.homedir(),'Library/Application Support/ClawDad/Accounts/verification-2026-09-15');
const retained=JSON.parse(await fs.readFile(path.join(base,'account-retention-pair-1.json'),'utf8'));
if(retained.state!=='verified'||!retained.independentRetainedAccounts)throw Error('Verify both retained accounts first.');
const root=path.join(base,'thread-continuity-1'),project=path.join(root,'project'),index=path.join(root,'index');
const inspectOnly=process.argv.includes('--inspect-existing');
const reconcile=inspectOnly||process.argv.includes('--reconcile-existing');
const receiptName=inspectOnly?process.argv[process.argv.indexOf('--inspect-existing')+1]:null;
if(inspectOnly&&!/^inspection-after-[a-z0-9-]+$/.test(receiptName||''))throw Error('Use a new inspection-after-* receipt name.');
let previous;
if(reconcile){
  previous=JSON.parse(await fs.readFile(path.join(root,'evidence.json'),'utf8'));
  if(previous.project!==project||previous.modelTurns!==1||!previous.sourceThreadId||!previous.forkThreadId
    ||!previous.events.some(e=>e.method==='turn/completed'&&e.status==='completed'&&e.turnId===previous.turnId))throw Error('The accepted fixture turn needs inspection before reconciliation.');
}else{
  await fs.mkdir(root,{mode:0o700}); // A repeat must reconcile the existing receipt.
  for(const dir of [project,index,path.join(root,'sessions'),path.join(root,'archived_sessions')])await fs.mkdir(dir,{mode:0o700});
}
const file=path.join(root,inspectOnly?receiptName+'.json':reconcile?'reconciliation-1.json':'evidence.json'),ids=new Set(reconcile?[previous.sourceThreadId,previous.forkThreadId]:[]),marker='CLAWDAD_CONTINUITY_9F3A 🌿';
if(await fs.lstat(file).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))throw Error('This verification receipt exists; inspect it before repeating.');
const prompt=`This is a synthetic account-switch continuity test. Reply with exactly ${marker}. Do not use any tools.`;
const record={version:1,requestId:inspectOnly?receiptName:reconcile?'account-thread-continuity-reconcile-1':'account-thread-continuity-1',at:new Date().toISOString(),state:'preparing',root,project,
  model:'gpt-6-astra',effort:'low',prompt,clientUserMessageId:randomUUID(),events:[],methods:[],histories:[],accounts:[],modelTurns:0};
if(reconcile)Object.assign(record,{sourceThreadId:previous.sourceThreadId,forkThreadId:previous.forkThreadId,turnId:previous.turnId,
  sourceReceipt:previous.requestId,explicitFixtureSettings:true});
const save=()=>researchSave(file,record),sha=text=>createHash('sha256').update(text).digest('hex');
const claim=await acquireCodexDeliveryClaim(base,{threadId:'isolated-authentication',requestId:record.requestId,timeoutMs:250});
let golden=previous?.histories[0]?.sha256;

async function withConnection(profile,allowNewTurn,action){
  const home=path.join(base,profile),expected=retained.reads.find(r=>r.profileName===profile);
  const env=Object.fromEntries(['PATH','HOME','USER','LOGNAME','TMPDIR','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  env.CODEX_HOME=home;
  const child=spawn('/opt/homebrew/bin/codex',['app-server','--stdio','-c','cli_auth_credentials_store="keyring"','-c',`sqlite_home=${JSON.stringify(index)}`],
    {cwd:project,env,stdio:['pipe','pipe','ignore']});
  const lines=createInterface({input:child.stdout}),pending=new Map(),notifications=[];
  let serial=0,closed=false,bytes=0;
  const failure=()=>{closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Fixture connection ended; reconcile its receipt.'));}pending.clear();};
  child.on('error',failure);child.on('exit',failure);child.stdin.on('error',failure);
  child.stdout.on('data',buffer=>{bytes+=buffer.length;if(bytes>16*1024*1024){failure();child.kill();}});
  lines.on('line',line=>{
    try{
      const message=JSON.parse(line),p=pending.get(message.id);
      if(p){pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Object.assign(Error('Fixture RPC rejected: '+p.method),{code:message.error.code})):p.resolve(message.result);}
      else if(message.method&&message.id!=null)child.stdin.write(JSON.stringify({id:message.id,error:{code:-32601,message:'This text-only fixture cannot approve tool actions'}})+'\n');
      else if(message.method){
        notifications.push(message);
        if(['turn/started','turn/completed','error'].includes(message.method))record.events.push({profile,at:new Date().toISOString(),method:message.method,
          threadId:message.params?.threadId,turnId:message.params?.turn?.id,status:message.params?.turn?.status});
      }
    }catch{failure();}
  });
  const readOnly=new Set(['initialize','config/read','account/read','account/rateLimits/read','model/list','thread/read','thread/turns/list',...(inspectOnly?[]:['thread/resume','thread/unsubscribe'])]);
  const rpc=(method,params={})=>new Promise((resolve,reject)=>{
    if(closed||!readOnly.has(method)&&!(allowNewTurn&&['thread/start','turn/start','thread/fork'].includes(method)))return reject(Error('Fixture RPC is outside the approved scope.'));
    if(method.startsWith('thread/')&&method!=='thread/start'||method==='turn/start')if(!ids.has(params.threadId))return reject(Error('Only this fixture owns the requested thread.'));
    const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('Fixture RPC timed out; do not repeat a mutation.'));},30_000);
    record.methods.push({profile,method,at:new Date().toISOString()});pending.set(id,{resolve,reject,timer,method});
    child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });
  try{
    const info=await rpc('initialize',{clientInfo:{name:'clawdad_disposable_continuity',version:'1'},capabilities:{experimentalApi:true}});
    child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
    const config=await rpc('config/read',{cwd:project,includeLayers:false});
    if(config.config?.cli_auth_credentials_store!=='keyring')throw Error('Required Keychain storage missing.');
    const before=await rpc('account/read',{refreshToken:false}),limits=await rpc('account/rateLimits/read'),after=await rpc('account/read',{refreshToken:false});
    if(before.account?.type!=='chatgpt'||before.account.email!==expected.email||JSON.stringify(before.account)!==JSON.stringify(after.account))throw Error('Fixture account changed.');
    const usage=normalizeWeeklyUsage(limits,{account:after.account});
    if(usage.accountKey!==expected.accountKey)throw Error('Fixture entitlement changed.');
    if(allowNewTurn&&(profile!=='cody'||usage.ordinaryUsageAllowed!==true||usage.remainingPercent<=0))throw Error('The approved source account cannot run this test.');
    record.accounts.push({profile,email:expected.email,accountKey:usage.accountKey,remainingPercent:usage.remainingPercent,ordinaryUsageAllowed:usage.ordinaryUsageAllowed,userAgent:info.userAgent});await save();
    const models=await rpc('model/list',{limit:100}),model=models.data.find(m=>m.model===record.model);
    if(!model?.supportedReasoningEfforts.some(e=>e.reasoningEffort===record.effort))throw Error('The exact fixture model/effort is unavailable.');
    await action({rpc,notifications,isClosed:()=>closed});
  }finally{
    failure();lines.close();child.stdin.end();child.kill();
    if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>child.once('exit',resolve));
    record.events.push({profile,at:new Date().toISOString(),method:'owned_process_exited'});await save();
  }
}

async function inspect(rpc,id,stage){
  const meta=await rpc('thread/read',{threadId:id,includeTurns:false});
  if(meta.thread.id!==id||meta.thread.cwd!==project)throw Error('The exact fixture thread or directory changed.');
  const page=await rpc('thread/turns/list',{threadId:id,limit:100,itemsView:'full'});
  if(page.nextCursor)throw Error('Unexpected additional fixture history; inspect before continuing.');
  if(inspectOnly){
    const original=previous.histories.find(history=>history.threadId===id);
    if(!original||JSON.stringify(page.data.map(turn=>turn.id))!==JSON.stringify(original.turnIds))
      throw Error('The original accepted turn identities changed. Preserve the evidence before continuing.');
  }
  const messages=page.data.flatMap(turn=>(turn.items||[]).filter(item=>['userMessage','agentMessage'].includes(item.type)).map(item=>({type:item.type,text:item.text??item.content?.filter(c=>c.type==='text').map(c=>c.text).join('')??''})));
  if(!messages.some(m=>m.type==='userMessage'&&m.text===prompt)||!messages.some(m=>m.type==='agentMessage'&&m.text.trim()===marker))throw Error('Complete fixture text was not preserved.');
  const hash=sha(JSON.stringify(messages));if(golden&&hash!==golden)throw Error('Fixture message history changed across ownership.');golden||=hash;
  record.histories.push({stage,threadId:id,cwd:meta.thread.cwd,path:meta.thread.path,turnIds:page.data.map(t=>t.id),messages,sha256:hash});await save();
}

try{
  // These links expose only the newly created disposable history. No production
  // history, settings or credential file is linked, moved or copied.
  for(const profile of ['cody','sun'])for(const name of ['sessions','archived_sessions']){
    const home=path.join(base,profile);if(await fs.realpath(home)!==home)throw Error('The retained home changed.');
    if(reconcile){if(await fs.realpath(path.join(home,name))!==path.join(root,name))throw Error('The disposable history mapping changed.');}
    else await fs.symlink(path.join(root,name),path.join(home,name),'dir');
  }
  if(!reconcile){
   record.state='running_source_fixture';await save();
   await withConnection('cody',true,async({rpc,notifications,isClosed})=>{
    const thread=await rpc('thread/start',{cwd:project,model:record.model,historyMode:'paginated',sandbox:'read-only',approvalPolicy:'never',
      environments:[],dynamicTools:[],developerInstructions:'This is a disposable text continuity test. Answer only the requested text. Do not invoke tools, commands, external services or other agents.',
      config:{model_reasoning_effort:record.effort},allowProviderModelFallback:false});
    record.sourceThreadId=thread.thread.id;ids.add(record.sourceThreadId);await save();
    record.turnDispatchAt=new Date().toISOString();record.modelTurns=1;await save();
    const started=await rpc('turn/start',{threadId:record.sourceThreadId,clientUserMessageId:record.clientUserMessageId,model:record.model,effort:record.effort,
      input:[{type:'text',text:prompt}],environments:[]});
    record.turnId=started.turn.id;await save();
    const deadline=Date.now()+120_000;let completed;
    while(Date.now()<deadline&&!isClosed()){
      completed=notifications.find(n=>n.method==='turn/completed'&&n.params?.threadId===record.sourceThreadId&&n.params?.turn?.id===record.turnId);
      if(completed)break;await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(completed?.params?.turn?.status!=='completed')throw Error('The source test turn did not complete; its accepted receipt is preserved.');
    await inspect(rpc,record.sourceThreadId,'source-completed');
    const fork=await rpc('thread/fork',{threadId:record.sourceThreadId,lastTurnId:record.turnId,excludeTurns:true,deferGoalContinuation:true});
    record.forkThreadId=fork.thread.id;record.forkInitialSettings={model:fork.model,reasoningEffort:fork.reasoningEffort};ids.add(record.forkThreadId);await save();
    await inspect(rpc,record.forkThreadId,'source-fork');
    for(const id of ids)await rpc('thread/unsubscribe',{threadId:id});
   });
  }
  if(inspectOnly){
    for(const profile of ['cody','sun','cody'])await withConnection(profile,false,async({rpc})=>{
      for(const id of ids)await inspect(rpc,id,'read-only-after-terminal-'+profile);
    });
  } else {
  record.state='reading_with_second_account';await save();
  await withConnection('sun',false,async({rpc})=>{
    for(const id of ids){
      const resumed=await rpc('thread/resume',{threadId:id,excludeTurns:true,...(reconcile?{model:record.model,config:{model_reasoning_effort:record.effort}}:{})});
      record.events.push({profile:'sun',method:'resume_observation',threadId:resumed.thread.id,cwd:resumed.thread.cwd,model:resumed.model,effort:resumed.reasoningEffort,status:resumed.thread.status});await save();
      if(resumed.thread.id!==id||resumed.thread.cwd!==project||resumed.model!==record.model||resumed.reasoningEffort!==record.effort)throw Error('Resumed fixture identity or settings changed.');
      record.events.push({profile:'sun',method:'verified_idle_resume',threadId:id,model:resumed.model,effort:resumed.reasoningEffort,status:resumed.thread.status});
      await inspect(rpc,id,'second-account-resume');await rpc('thread/unsubscribe',{threadId:id});
    }
  });
  await withConnection('cody',false,async({rpc})=>{
    const resumed=await rpc('thread/resume',{threadId:record.forkThreadId,excludeTurns:true,...(reconcile?{model:record.model,config:{model_reasoning_effort:record.effort}}:{})});
    if(resumed.thread.id!==record.forkThreadId||resumed.model!==record.model||resumed.reasoningEffort!==record.effort)throw Error('The returning fixture settings changed.');
    record.events.push({profile:'cody',method:'return_resume_observation',threadId:resumed.thread.id,model:resumed.model,effort:resumed.reasoningEffort,status:resumed.thread.status});await save();
    await inspect(rpc,record.forkThreadId,'return-to-source-account');await rpc('thread/unsubscribe',{threadId:record.forkThreadId});
  });
  }
  record.state='verified_local_history_only';record.completedAt=new Date().toISOString();
  record.limitations=['Second account has no allowance; no model execution was attempted there.','This uses disposable app-server owners, not live Terminal process replacement.','Images, drafts, queues, real config and permissions migration remain unverified.'];
  await save();console.log(JSON.stringify({state:record.state,sourceThreadId:record.sourceThreadId,forkThreadId:record.forkThreadId,histories:record.histories.length,modelTurns:record.modelTurns,secondAccountModelTurns:0}));
}catch(error){record.state='needs_attention';record.failure=error.message;record.failureCode=error.code??null;await save();console.error(JSON.stringify({state:record.state,failure:record.failure,sourceThreadId:record.sourceThreadId,modelTurns:record.modelTurns}));process.exitCode=1;}
finally{await claim.release();}
