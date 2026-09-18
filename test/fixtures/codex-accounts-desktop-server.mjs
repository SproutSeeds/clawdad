import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {AssistantRuntime,assistantHttp} from '../../lib/assistant-runtime.mjs';
import {CodexAppAccounts as CodexAccounts} from '../../lib/codex-app-accounts.mjs';
import {CodexAccountLayout} from '../../lib/codex-account-layout.mjs';
import {CodexAccountAuthorizations} from '../../lib/codex-account-authorizations.mjs';
const selected=process.argv[2];if(!selected||!path.basename(selected).startsWith('accounts-ui-fixture-'))throw Error('An isolated fixture path is required.');
const root=await fs.realpath(selected);await fs.chmod(root,0o700);
const runtime=new AssistantRuntime({root:path.join(root,'Assistant'),coordinator:{stop(){},prepare(){throw Error('Fixture cannot start Codex');}}});
const usage={snapshot:async()=>({status:'current',accountKey:'a'.repeat(64),remainingPercent:12,resetsAt:2000000000,validUntil:2000000000000,
  observedAt:new Date().toISOString(),alerts:[],subscription:{method:'chatgpt',email:'fixture@example.test',plan:'pro'}})};
usage.freshReading=usage.snapshot;
runtime.accounts=new CodexAccounts({root:path.join(root,'Accounts'),usage,inspectConsumers:async()=>({complete:false,consumers:[],reasons:['Synthetic inventory only.']})});
const profiles=[],jobs=[],requests=[];let drops=0,actualProfile=null,identityMismatch=false,identityUnavailable=false,nativeUnavailable=false;
runtime.accounts.readActive=async()=>{
  if(identityUnavailable)throw Error('Fixture server offline');
  const p=identityMismatch?profiles[1]:actualProfile;
  return p?{email:p.email,status:'current',accountKey:p.accountKey,authorizationHome:p.home}:null;
};
runtime.accounts.authorizations={snapshot:async()=>({profiles}),request:async()=>({status:'verified'})};
const canonical=path.join(root,'History');await fs.mkdir(canonical,{mode:0o700});
for(const name of ['sessions','archived_sessions','thread-writer-locks'])await fs.mkdir(path.join(canonical,name),{mode:0o700});
const layouts=new Map();
for(const [index,email] of ['fixture@example.test','second@example.test'].entries()){
  const entry=(await runtime.accounts.add({email,requestId:'add-'+index,expectedRevision:index})).account;
  const home=path.join(root,entry.id);await fs.mkdir(home,{mode:0o700});
  layouts.set(entry.id,await new CodexAccountLayout({root}).prepare({canonicalHome:canonical,profileHome:home}));
  profiles.push({accountId:entry.id,email,home,authentication:'verified',accountKey:(index?'b':'a').repeat(64),verifiedAt:new Date().toISOString(),remainingPercent:index?0:65,resetsAt:2e9});
}
runtime.accounts.readWork=async()=>({complete:true,jobs});
runtime.accounts.adapter={capture:async()=>{if(nativeUnavailable)throw Object.assign(Error('Native reader starting'),{code:'app_process_reader_unavailable'});return {kind:'absent'};},prepare:async(op,target)=>({method:'chatgpt',email:target.email,accountKey:profiles.find(p=>p.accountId===target.id).accountKey}),transition:async()=>({}),
  verify:async op=>{const p=profiles.find(p=>p.accountId===op.targetId);actualProfile=p;return {accountKey:p.accountKey,runtime:{authorizationHome:p.home,sqliteHome:canonical,layout:layouts.get(p.accountId)}};}};
await runtime.load();await runtime.accounts.request({accountId:profiles[0].accountId,requestId:'initial',expectedRevision:2,confirmed:true});await runtime.accounts.advance();
runtime.accounts.start({intervalMs:30});
const page=await fs.readFile(new URL('../../web/index.html',import.meta.url),'utf8');
const dialog=page.match(/<dialog id="weeklyUsageDialog"[\s\S]*?<\/dialog>/)?.[0];
if(!dialog)throw Error('The production allowance dialog is missing.');
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const json=(r,c,v)=>{r.writeHead(c,{'content-type':'application/json'});r.end(JSON.stringify(v));};
  if(url.pathname==='/'){
    res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css">
      <button id="weeklyUsage">Weekly allowance</button><button id="weeklyUsageNotice" hidden></button>
      ${dialog}
      <script src="/weekly-usage.js"></script><script type="module" src="/codex-accounts.js"></script>`);return;
  }
  if(['/app.css','/weekly-usage.js','/codex-accounts.js'].includes(url.pathname)){
    res.setHeader('content-type',url.pathname.endsWith('.css')?'text/css; charset=utf-8':'application/javascript; charset=utf-8');res.end(await fs.readFile(new URL('../../web'+url.pathname,import.meta.url)));return;
  }
  if(url.pathname==='/v1/codex/weekly-usage')return json(res,200,await usage.snapshot());
  if(url.pathname==='/fixture/drop'){drops=1;return json(res,200,{ok:true});}
  if(url.pathname==='/fixture/native-wait'){nativeUnavailable=true;return json(res,200,{ok:true});}
  if(url.pathname==='/fixture/native-ready'){nativeUnavailable=false;return json(res,200,{ok:true});}
  if(url.pathname==='/fixture/identity-mismatch'){identityMismatch=true;return json(res,200,{ok:true});}
  if(url.pathname==='/fixture/identity-unavailable'){identityUnavailable=true;return json(res,200,{ok:true});}
  if(url.pathname==='/fixture/identity-reset'){identityMismatch=false;identityUnavailable=false;return json(res,200,{ok:true});}
  if(url.pathname==='/fixture/evidence')return json(res,200,{requests,state:await runtime.accounts.snapshot(),jobs:runtime.state.jobs});
  if(await assistantHttp(req,res,url,runtime,{json,readBody:async r=>{let text='';for await(const chunk of r)text+=chunk;const body=JSON.parse(text);requests.push(body);if(body.action==='accounts.activate'&&drops){drops--;res.end=()=>res.destroy();}return body;}}))return;
  json(res,404,{error:'Fixture route unavailable'});
});
server.listen(0,'127.0.0.1',async()=>{await fs.writeFile(path.join(root,'ready.json'),JSON.stringify({baseURL:`http://127.0.0.1:${server.address().port}`}));});
