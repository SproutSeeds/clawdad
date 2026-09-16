// Offline/runtime-only fixture. No login, model turn, production history,
// Terminal window, or user draft is touched. The caller supplies a NEW folder.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {CodexAccountLayout,accountRuntimeLaunchOptions,compareAccountRuntimeConfiguration} from '../../lib/codex-account-layout.mjs';
import {researchSave} from '../../lib/research-budget.mjs';

const candidate=path.resolve('native/macos/dist/candidates/codex-account-switch-2026-09-15');
const name=process.argv[2];
if(!name||!/^layout-probe-[a-z0-9-]+$/.test(name))throw Error('Supply a new layout-probe-* fixture name.');
const root=path.join(candidate,name);await fs.mkdir(root,{mode:0o700});
const canonicalHome=path.join(root,'canonical'),profileHome=path.join(root,'profile'),project=path.join(root,'project');
for(const directory of [canonicalHome,profileHome,project])await fs.mkdir(directory,{mode:0o700});
for(const name of ['sessions','archived_sessions','thread-writer-locks','rules','skills','hooks'])await fs.mkdir(path.join(canonicalHome,name),{mode:0o700});
await fs.writeFile(path.join(canonicalHome,'AGENTS.md'),'Synthetic fixture. Do not run tools or submit a turn.\n',{mode:0o600});
await fs.writeFile(path.join(canonicalHome,'config.toml'),
  'model = "gpt-6-astra"\nmodel_reasoning_effort = "low"\nsandbox_mode = "read-only"\napproval_policy = "never"\nmodel_instructions_file = "AGENTS.md"\nweb_search = "disabled"\n[features]\nmulti_agent = false\nplugins = false\n',{mode:0o600});
const layout=new CodexAccountLayout({root}),receipt=await layout.prepare({canonicalHome,profileHome});
const record={version:1,state:'running',at:new Date().toISOString(),modelCalls:0,logins:0,methods:[],results:[]};
const output=path.join(root,'evidence.json');

async function connect(home,args,fn){
  const env=Object.fromEntries(['PATH','HOME','USER','LOGNAME','TMPDIR','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  const options=home===profileHome?accountRuntimeLaunchOptions({layout:receipt,baseEnvironment:env,arguments:args}):
    {env:{...env,CODEX_HOME:home},arguments:[...args,'-c',`sqlite_home=${JSON.stringify(canonicalHome)}`,'-c','cli_auth_credentials_store="ephemeral"']};
  const child=spawn('/opt/homebrew/bin/codex',options.arguments,{cwd:project,env:options.env,stdio:['pipe','pipe','ignore']});
  const lines=createInterface({input:child.stdout}),pending=new Map();let serial=0,closed=false,bytes=0;
  const fail=()=>{closed=true;for(const row of pending.values()){clearTimeout(row.timer);row.reject(Error('Fixture transport ended.'));}pending.clear();};
  child.on('error',fail);child.on('exit',fail);child.stdin.on('error',fail);
  child.stdout.on('data',b=>{bytes+=b.length;if(bytes>8*1024*1024){fail();child.kill();}});
  lines.on('line',line=>{
    try{const m=JSON.parse(line),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Object.assign(Error('Fixture RPC rejected.'),{rpcCode:m.error.code})):p.resolve(m.result);}
      else if(m.method&&m.id!=null)child.stdin.write(JSON.stringify({id:m.id,error:{code:-32601,message:'Fixture cannot authorize actions'}})+'\n');
    }catch{fail();}
  });
  const rpc=(method,params={})=>new Promise((resolve,reject)=>{
    if(closed||!['initialize','config/read','configRequirements/read','account/read','thread/loaded/list'].includes(method))return reject(Error('Only inspection is authorized.'));
    const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('Fixture RPC timeout'));},15000);
    pending.set(id,{resolve,reject,timer});record.methods.push({profile:home===profileHome?'retained':'canonical',method});
    child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });
  try{
    const info=await rpc('initialize',{clientInfo:{name:'clawdad_layout_probe',version:'1'},capabilities:{experimentalApi:true}});
    child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
    record.results.push({profile:home===profileHome?'retained':'canonical',version:info.userAgent});
    return await fn(rpc);
  }finally{fail();lines.close();child.stdin.end();child.kill();if(child.exitCode===null&&child.signalCode===null)await new Promise(r=>child.once('exit',r));}
}
try{
  const before=await connect(canonicalHome,['app-server','--stdio'],rpc=>rpc('config/read',{cwd:project,includeLayers:true}));
  await layout.verify(receipt);
  const after=await connect(profileHome,['app-server','--stdio'],rpc=>rpc('config/read',{cwd:project,includeLayers:true}));
  record.comparison=await compareAccountRuntimeConfiguration(before.config,after.config);
  record.sourceInstructions=before.config.model_instructions_file;
  record.destinationInstructions=after.config.model_instructions_file;
  record.sourceStore=before.config.cli_auth_credentials_store;record.destinationStore=after.config.cli_auth_credentials_store;
  record.sharedWriterLocks=await fs.realpath(path.join(profileHome,'thread-writer-locks'))===path.join(canonicalHome,'thread-writer-locks');
  record.state=record.comparison.equivalent&&record.destinationStore==='keyring'&&record.sharedWriterLocks?'verified_configuration_only':'needs_attention';
  await researchSave(output,record);console.log(JSON.stringify(record));if(record.state!=='verified_configuration_only')process.exitCode=1;
}catch(error){record.state='needs_attention';record.failureCode=error.code||error.rpcCode||'probe_failed';await researchSave(output,record);throw error;}
