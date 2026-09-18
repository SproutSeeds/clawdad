// Explicit release acceptance: two actual subscription turns and native reads.
// The fixture only proxies computer inspection and capture to the installed
// native worker; it cannot authorize input or other mutations.
import fs from 'node:fs/promises';import http from 'node:http';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import {CodexSharedTurnRunner} from '../../lib/codex-shared-turn-runner.mjs';
import {accountRoutingController} from '../../lib/codex-account-runtime-routing.mjs';
import {readAgentToolOrigin} from '../../lib/agent-tool-context.mjs';
const base=await fs.mkdtemp('/tmp/clawdad-shared-tools-'),root=path.join(base,'Assistant');await fs.mkdir(root);
const localToken=crypto.randomUUID(),nativeRoot=path.join(os.homedir(),'Library/Application Support/ClawDad');
const nativeToken=(await fs.readFile(path.join(nativeRoot,'native-server.token'),'utf8')).trim();
const {baseURL}=JSON.parse(await fs.readFile(path.join(nativeRoot,'Assistant/connection.json'),'utf8'));
await fs.writeFile(path.join(base,'native-server.token'),localToken,{mode:0o600});
const observations=[],completed=[];
const proxy=async(route,body)=>{const r=await fetch(new URL(route,baseURL),{method:body?'POST':'GET',headers:{authorization:'Bearer '+nativeToken,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,value:await r.json()};};
const server=http.createServer(async(req,res)=>{try{
  if(req.headers.authorization!=='Bearer '+localToken)throw Error('Local authentication rejected');
  let body='';for await(const b of req)body+=b;const args=body?JSON.parse(body):null;let result;
  if(req.url==='/v1/assistant/tool'){
    const origin=await readAgentToolOrigin(root,args.toolContextId);
    if(!['computer.displays','computer.inspect','computer.capture'].includes(args.action))throw Error('Verification permits computer reads only');
    const {toolContextId,...rest}=args;result=await proxy('/v1/assistant/tool',{...rest,diagnostic:true});
    observations.push({action:args.action,threadId:origin.threadId,requestId:origin.requestId,status:result.status,jobId:result.value.job?.id});
  }else if(req.url.startsWith('/v1/assistant/job')){
    result=await proxy(req.url);
    if(result.value.job?.status==='completed')completed.push({id:result.value.job.id,action:result.value.job.action});
  }else throw Error('Unsupported verification route');
  res.writeHead(result.status,{'content-type':'application/json'});res.end(JSON.stringify(result.value));
}catch(e){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
await fs.writeFile(path.join(root,'connection.json'),JSON.stringify({baseURL:'http://127.0.0.1:'+server.address().port}));
const accounts=accountRoutingController('/opt/homebrew/bin/codex');
const runner=new CodexSharedTurnRunner({root,resolveAccountLaunch:()=>accounts.selectedLaunch()});
try{
  let sessionId;
  for(let i=0;i<2;i++){
    const result=await runner.run({id:crypto.randomUUID(),sessionId,
      text:i===0?'For this authorized release check, use the clawdad_assistant computer tool with action displays to read the actual Mac displays. Do not change anything. Reply with only the number of displays and their names.':
        'Repeat the authorized display read with clawdad_assistant computer, then capture one of those displays using its returned displayId. Inspect the screenshot without clicking or changing anything. Report only whether capture succeeded; omit private screen contents.',
      modelConfig:{model:'gpt-6-astra',reasoningEffort:'low'},signal:AbortSignal.timeout(120000),onMessage:async m=>console.log('response',m.text)});
    sessionId=result.sessionId;
  }
  const passed=observations.every(o=>o.status===200)&&new Set(observations.map(o=>o.requestId)).size===2
    &&observations.some(o=>o.action==='computer.capture')&&completed.length>=3;
  console.log(JSON.stringify({passed,observations,completed,root}));if(!passed)process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}finally{runner.stop();server.close();}
