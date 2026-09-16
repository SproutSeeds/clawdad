// Explicit disposable, unauthenticated installed-CLI experiment. No production
// paths, credentials, symlinks, Terminal windows or model-turn RPCs are allowed.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {randomUUID,createHash} from 'node:crypto';
const root=path.resolve(process.argv[2]||'');
const paginated=process.argv.includes('--paginated');
const sharedHistory=process.argv.includes('--shared-history');
if(!path.basename(root).startsWith('account-history-probe-'))throw Error('Choose a new disposable account-history-probe directory.');
await fs.mkdir(root,{recursive:false,mode:0o700});
const shared=path.join(root,'index'),project=path.join(root,'project'),a=path.join(root,'a'),b=path.join(root,'b');
for(const directory of [shared,project,a,b])await fs.mkdir(directory,{mode:0o700});
const id=randomUUID(),timestamp=new Date().toISOString(),date=timestamp.slice(0,10),clock=timestamp.slice(11,19).replaceAll(':','-');
const dir=path.join(a,'sessions',...date.split('-'));await fs.mkdir(dir,{recursive:true,mode:0o700});
// This optional experiment links only synthetic, disposable history. It is
// evidence for a proposed layout, never permission to link production state.
if(sharedHistory)await fs.symlink(path.join(a,'sessions'),path.join(b,'sessions'),'dir');
const file=path.join(dir,`rollout-${date}T${clock}-${id}.jsonl`);
const marker='SYNTHETIC_ACCOUNT_HISTORY_BEGIN 🌿\nFixture history only. END_4281';
const events=[{type:'session_meta',payload:{id,timestamp,cwd:project,originator:'codex_cli_rs',cli_version:'0.154.0',source:'cli',model_provider:'openai'}},
  {type:'event_msg',payload:{type:'task_started',turn_id:'fixture-turn',model_context_window:128000}},
  {type:'event_msg',payload:{type:'user_message',message:marker,images:[],local_images:[],text_elements:[]}},
  {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:marker}]}},
  {type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic retained result.'}]}},
  {type:'event_msg',payload:{type:'agent_message',message:'Synthetic retained result.',phase:'final_answer'}},
  {type:'event_msg',payload:{type:'task_complete',turn_id:'fixture-turn',last_agent_message:'Synthetic retained result.'}}];
if(paginated){
  const baseId=randomUUID(),prefixFile=path.join(dir,`rollout-${date}T${clock}-${baseId}.jsonl`);
  const prefix=events.map((event,ordinal)=>JSON.stringify({timestamp,ordinal,...event,
    ...(ordinal===0?{payload:{...event.payload,id:baseId,session_id:baseId,history_mode:'paginated'}}:{})})).join('\n')+'\n';
  await fs.writeFile(prefixFile,prefix,{mode:0o600});
  await fs.writeFile(file,JSON.stringify({timestamp,ordinal:events.length,type:'session_meta',payload:{...events[0].payload,
    session_id:baseId,history_mode:'paginated',history_base:{thread_id:baseId,end_ordinal_exclusive:events.length,end_byte_offset:Buffer.byteLength(prefix)}}})+'\n',{mode:0o600});
}else await fs.writeFile(file,events.map(event=>JSON.stringify({timestamp,...event})).join('\n')+'\n',{mode:0o600});
const before=createHash('sha256').update(await fs.readFile(file)).digest('hex');
const allowed=new Set(['initialize','account/read','config/read','thread/read','thread/turns/list','thread/resume','thread/unsubscribe']);
const records=[];
async function connection(home,actions) {
  const env=Object.fromEntries(['PATH','HOME','USER','LOGNAME','TMPDIR','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));env.CODEX_HOME=home;
  const child=spawn('/opt/homebrew/bin/codex',['app-server','--stdio','-c','cli_auth_credentials_store="ephemeral"','-c',`sqlite_home=${JSON.stringify(shared)}`],{cwd:project,env,stdio:['pipe','pipe','ignore']});
  const lines=createInterface({input:child.stdout}),pending=new Map();let next=0,closed=false;
  const fail=()=>{closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Disposable connection ended'));}pending.clear();};
  child.on('error',fail);child.on('exit',fail);child.stdin.on('error',fail);
  lines.on('line',line=>{try{const m=JSON.parse(line),p=pending.get(m.id);
    if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}
    else if(m.method&&m.id!=null)child.stdin.write(JSON.stringify({id:m.id,error:{code:-32601,message:'No fixture tool actions'}})+'\n');
  }catch{fail();}});
  const rpc=(method,params={})=>new Promise((resolve,reject)=>{
    if(!allowed.has(method)||closed)return reject(Error('Unsupported fixture RPC'));const rpcId=++next;
    const timer=setTimeout(()=>{pending.delete(rpcId);reject(Error('Fixture RPC timeout'));},15_000);
    pending.set(rpcId,{resolve,reject,timer});child.stdin.write(JSON.stringify({id:rpcId,method,params})+'\n');
  });
  try{
    const initialized=await rpc('initialize',{clientInfo:{name:'clawdad_history_probe',version:'1'},capabilities:{experimentalApi:true}});
    child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
    const account=await rpc('account/read',{refreshToken:false});if(account.account)throw Error('Fixture unexpectedly authenticated');
    records.push({home:path.basename(home),userAgent:initialized.userAgent,accountAbsent:true});
    await actions(rpc);
  }finally{fail();lines.close();child.stdin.end();child.kill();await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)return resolve();child.once('exit',resolve);});}
}
const observed=(stage,result)=>{
  const thread=result.thread||result;
  records.push({stage,threadId:thread.id,path:thread.path,cwd:thread.cwd,status:thread.status,
    markerPresent:JSON.stringify(thread).includes('END_4281'),turns:thread.turns?.length,model:result.model,reasoningEffort:result.reasoningEffort});
};
const readHistory=async(rpc,stage)=>{
  const result=await rpc('thread/read',{threadId:id,includeTurns:!paginated});
  if(paginated){const turns=await rpc('thread/turns/list',{threadId:id,limit:100,itemsView:'full'});result.thread.turns=turns.data;}
  observed(stage,result);
};
let error;
try{
  await connection(a,async rpc=>{
    await readHistory(rpc,'a-read');
    if(paginated){
      observed('a-resume-linked-history',await rpc('thread/resume',{threadId:id,cwd:project,excludeTurns:true,model:'gpt-6-astra',config:{model_reasoning_effort:'low'}}));
      await rpc('thread/unsubscribe',{threadId:id});
    }
  });
  await connection(b,async rpc=>{
    await readHistory(rpc,'b-shared-index-read');
    observed('b-resume-exact-id',await rpc('thread/resume',{threadId:id,cwd:project,model:'gpt-6-astra',config:{model_reasoning_effort:'low'},...(paginated?{excludeTurns:true}:{})}));
    await readHistory(rpc,'b-after-resume-read');
    await rpc('thread/unsubscribe',{threadId:id});
  });
  await connection(a,async rpc=>readHistory(rpc,'a-read-after-b-exit'));
}catch(e){error=e.message;}
const evidence={at:new Date().toISOString(),threadId:id,root,paginated,sharedHistory,records,error,modelCalled:false,loginAttempted:false,
  originalRolloutHash:before,finalRolloutHash:createHash('sha256').update(await fs.readFile(file)).digest('hex'),
  scope:'Synthetic unauthenticated local history only. No cross-account inference, real session or model request.'};
await fs.writeFile(path.join(root,'evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});
console.log(JSON.stringify(evidence,null,2));if(error)process.exitCode=1;
