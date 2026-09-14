// Isolated XCTest service. It can never instantiate native Terminal control.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Readable,Writable} from 'node:stream';
import {AssistantRuntime} from '../../lib/assistant-runtime.mjs';
import {runAssistantMCP} from '../../lib/assistant-mcp.mjs';
const root=process.argv[2];
if(!root || !path.basename(root).startsWith('workspace-desktop-test-'))throw Error('Dedicated fixture root required');
await fs.mkdir(path.join(root,'Assistant'),{recursive:true});
const runtime=new AssistantRuntime({root:path.join(root,'Assistant'),coordinator:{stop(){},prepare:async()=>{throw Error('No model work in workspace tests')}}});
await runtime.load();
const html=await fs.readFile(new URL('../../web/index.html',import.meta.url),'utf8');
const start=html.indexOf('      <section class="terminal-setups"'),end=html.indexOf('      <dialog id="weeklyUsageDialog"');
const requests=[];
const server=http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://fixture');
  if(req.method==='GET'&&url.pathname==='/'){
   res.setHeader('Content-Type','text/html; charset=utf-8');
   return res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/main-terminal-workspace.css"></head><body style="background:#260404;color:#ffedc2;font:17px system-ui">'+html.slice(start,end)+'<script type="module" src="/main-terminal-workspace.js"></script></body></html>');
  }
  if(['/main-terminal-workspace.js','/main-terminal-workspace-state.mjs','/main-terminal-workspace.css'].includes(url.pathname)){
   res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript');return res.end(await fs.readFile(new URL('../../web'+url.pathname,import.meta.url)));
  }
  let args={};if(req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;args=JSON.parse(body);}
  let result;
  if(url.pathname==='/fixture/mcp'){
   const frames=[];await runAssistantMCP({root,input:Readable.from([JSON.stringify({id:1,method:'tools/call',params:args})+'\n']),output:new Writable({write(chunk,encoding,done){frames.push(JSON.parse(chunk));done();}})});
   if(frames[0].result.isError)throw Error(frames[0].result.content[0].text);result=JSON.parse(frames[0].result.content[0].text);
  }else if(url.pathname==='/v1/assistant/native/poll')result=await runtime.nativePoll(args);
  else if(url.pathname==='/v1/assistant/native/result')result=await runtime.nativeResult(args);
  else if(url.pathname==='/v1/assistant/job')result={job:await runtime.job(url.searchParams.get('id'))};
  else if(['/v1/assistant/request','/v1/assistant/tool'].includes(url.pathname)) {requests.push(args);result=await runtime.command(args,{tool:req.headers.authorization==='Bearer fixture-token'});}
  else if(url.pathname==='/fixture/evidence')result={requests,jobs:runtime.state.jobs};
  else {res.statusCode=404;return res.end();}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
 }catch(error){res.statusCode=400;res.end(JSON.stringify({error:error.message}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const baseURL=`http://127.0.0.1:${server.address().port}`;
await fs.writeFile(path.join(root,'Assistant/connection.json'),JSON.stringify({baseURL}));
await fs.writeFile(path.join(root,'native-server.token'),'fixture-token');
await fs.writeFile(path.join(root,'ready.json'),JSON.stringify({baseURL}));
process.on('SIGTERM',()=>{runtime.close();server.close();process.exit(0)});
