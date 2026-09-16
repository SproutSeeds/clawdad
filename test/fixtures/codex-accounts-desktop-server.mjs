import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {AssistantRuntime,assistantHttp} from '../../lib/assistant-runtime.mjs';
import {CodexAccounts} from '../../lib/codex-accounts.mjs';
import {CodexAccountAuthorizations} from '../../lib/codex-account-authorizations.mjs';
const selected=process.argv[2];if(!selected||!path.basename(selected).startsWith('accounts-ui-fixture-'))throw Error('An isolated fixture path is required.');
const root=await fs.realpath(selected);
const runtime=new AssistantRuntime({root:path.join(root,'Assistant'),coordinator:{stop(){},prepare(){throw Error('Fixture cannot start Codex');}}});
const usage={snapshot:async()=>({status:'current',accountKey:'a'.repeat(64),remainingPercent:12,resetsAt:2000000000,validUntil:2000000000000,
  observedAt:new Date().toISOString(),alerts:[],subscription:{method:'chatgpt',email:'fixture@example.test',plan:'pro'}})};
usage.freshReading=usage.snapshot;
runtime.accounts=new CodexAccounts({root:path.join(root,'Accounts'),usage,inspectConsumers:async()=>({complete:false,consumers:[],reasons:['Synthetic inventory only.']})});
const saved=new Map();let completeSignIn;
runtime.accounts.authorizations=new CodexAccountAuthorizations({root:path.join(root,'Accounts'),binary:'/fixture-only/codex',
  open:async()=>queueMicrotask(()=>completeSignIn()),createProcess:({home})=>{
    const id=path.basename(home),listeners=new Set();
    return {connect:async()=>{},verifyStorage:async()=>{},close(){},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
      async request(method){
        if(method==='account/read')return {account:saved.has(id)?{type:'chatgpt',email:saved.get(id),planType:'pro'}:null};
        if(method==='account/rateLimits/read')return {accountId:id,rateLimits:{limitId:'codex',primary:{windowDurationMins:10080,usedPercent:88,resetsAt:2000000000}}};
        if(method==='account/login/start'){
          const account=await runtime.accounts.transaction(s=>s.accounts.find(a=>a.id===id));
          completeSignIn=()=>{saved.set(id,account.email);for(const fn of listeners)fn({method:'account/login/completed',params:{loginId:id,success:true}});for(const fn of listeners)fn({method:'account/updated',params:{authMode:'chatgpt'}});};
          return {type:'chatgpt',loginId:id,authUrl:'https://auth.openai.com/fixture-only'};
        }
        throw Error('Only synthetic account reads and sign-in are available');
      }};
  }});
await runtime.load();let requests=[],waiting=false,dropSwitch=false,targetKey='a'.repeat(64);
runtime.accounts.readWork=async()=>({complete:true,jobs:waiting?[{id:'fixture-pending-work',action:'legacy.dispatch',fingerprint:'fixture-request',status:'working'}]:[{id:'fixture-pending-work',action:'legacy.dispatch',fingerprint:'fixture-request',status:'completed'}]});
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
  if(url.pathname==='/fixture/ready'){
    waiting=true;dropSwitch=true;
    runtime.accounts.inspectConsumers=async()=>({complete:true,consumers:[{id:'fixture-room',kind:'terminal_codex',pid:99998,tty:'/dev/ttys098',processIdentity:'fixture-room-owner',title:'RoomWave',sessionId:null,busy:null,recoverable:false,pendingReceipts:[],reason:'No verified resumable conversation.'}],reasons:[]});
    runtime.accounts.adapter={capabilities:{ready:true,skipTerminalSessions:true},captureRecovery:async observation=>({fingerprint:observation.fingerprint,entries:[]}),
      authenticate:async({target})=>({state:'verified',email:target.email,accountKey:targetKey,method:'chatgpt',workspaceVerified:true}),
      verify:async()=>({accountKey:targetKey,allConsumersVerified:true,freshUsage:true})};
    runtime.accounts.start({intervalMs:50});return json(res,200,{ok:true});
  }
  if(url.pathname==='/fixture/finish'){waiting=false;return json(res,200,{ok:true});}
  if(url.pathname==='/fixture/evidence')return json(res,200,{requests,state:await runtime.accounts.snapshot(),jobs:runtime.state.jobs});
  if(await assistantHttp(req,res,url,runtime,{json,readBody:async r=>{let text='';for await(const chunk of r)text+=chunk;const body=JSON.parse(text);requests.push(body);if(body.action==='accounts.switch'&&dropSwitch){dropSwitch=false;res.end=()=>res.destroy();}return body;}}))return;
  json(res,404,{error:'Fixture route unavailable'});
});
server.listen(0,'127.0.0.1',async()=>{await fs.writeFile(path.join(root,'ready.json'),JSON.stringify({baseURL:`http://127.0.0.1:${server.address().port}`}));});
