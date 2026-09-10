import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createServer} from 'node:http';
import {AssistantRuntime,assistantHttp} from '../lib/assistant-runtime.mjs';
import {assistantChatTextBytes as maximum,validateAssistantChatText} from '../lib/assistant-chat-capacity.mjs';

const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
function brief(bytes) {
  const start='  BEGIN_EXACT\r\nResearch 🧪 中文 e\u0301\n```js\nconst x = "\\value";\n```\nhttps://example.org/?a=1&b=2\n';
  const middle='\nMIDDLE_EXACT\n',end='\nEND_EXACT\t \r\n';
  const padding=bytes-Buffer.byteLength(start+middle+end);
  return start+'x'.repeat(Math.floor(padding/2))+middle+'y'.repeat(Math.ceil(padding/2))+end;
}
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-chat-capacity-')),calls=[];
  const coordinator={prepare:async()=>({}),stop(){},run:async input=>{
    calls.push(input);
    if(input.text==='fixture-context-limit')throw Error('Input exceeds model context window limit');
    await input.onSession('01a07d6d-4359-7361-a94b-8a651ca9858b');
    await input.onMessage({id:'exact-response',text:input.text});
  }};
  const runtime=new AssistantRuntime({root,coordinator});
  await runtime.command({action:'start',requestId:'start'});
  const server=createServer(async(req,res)=>{
    await assistantHttp(req,res,new URL(req.url,'http://localhost'),runtime,{
      readBody:async request=>{let data=Buffer.alloc(0);for await(const chunk of request){data=Buffer.concat([data,chunk]);if(data.length>2*1024*1024)throw Error('Body too large');}return JSON.parse(data);},
      json:(response,status,body)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(body));},
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const send=async body=>{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/assistant/request`,{method:'POST',body:JSON.stringify(body)});
    return {status:response.status,value:await response.json()};
  };
  t.after(async()=>{await runtime.close();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
  return {root,runtime,coordinator,calls,send};
}
test('HTTP accepts old, above-old and new byte boundaries with exact Unicode text, one turn and complete response storage',async t=>{
  const {runtime,root,calls,send}=await fixture(t);
  await runtime.nativePoll({catalog:{revision:1,tabs:[]}});
  for(const size of [16_384,16_385,65_536,maximum]){
    const text=brief(size),request={action:'message',requestId:crypto.randomUUID(),text};
    assert.equal(Buffer.byteLength(text),size);
    const [first,retry]=await Promise.all([send(request),send(request)]);
    assert.equal(first.status,200);assert.equal(retry.status,200);
    await runtime.drainTask;
    assert.equal(calls.filter(c=>c.id===request.requestId).length,1);
    assert.equal(hash(calls.at(-1).text),hash(text));
    const stored=JSON.parse(await fs.readFile(path.join(root,'state.json'),'utf8'));
    assert.equal(stored.messages.filter(m=>m.id===request.requestId).length,1);
    assert.equal(stored.messages.find(m=>m.id===request.requestId).text,text);
    assert.equal(stored.messages.at(-1).text,text,'No 100,000-code-unit clipping of saved responses');
    assert.equal((await runtime.job(request.requestId)).status,'completed');
    assert.equal((await send({...request,text:text+'changed'})).status,400);
  }
});
test('over-limit and invalid Unicode rejection creates no job or clipped substitute',async t=>{
  const {send,runtime,calls}=await fixture(t);
  for(const text of [brief(maximum+1),'🧪'.repeat(maximum/4)+'x']){
    const result=await send({action:'message',requestId:crypto.randomUUID(),text});
    assert.equal(result.status,400);assert.match(result.value.error,/131,072 bytes.*kept/);
  }
  for(const text of ['bad\0text','bad\ud800text'])assert.throws(()=>validateAssistantChatText(text),/invalid text/);
  assert.equal(runtime.state.messages.length,0);assert.equal(calls.length,0);
  // JSON escaping is separate from text size; even the worst valid control
  // encoding fits the unchanged 1 MiB decoded payload / 2 MiB HTTP ceilings.
  const escaped='\u0001'.repeat(maximum);
  assert.equal(validateAssistantChatText(escaped),escaped);
  assert.ok(Buffer.byteLength(JSON.stringify({action:'message',requestId:crypto.randomUUID(),text:escaped}))<1024*1024);
});
test('large queued message and actual image bytes survive restart and same-ID retries',async t=>{
  const {send,root,runtime,coordinator,calls}=await fixture(t);
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  const upload={id:crypto.randomUUID(),fileName:'synthetic.png',mimeType:'image/png',size:bytes.length,sha256:hash(bytes)};
  for(const [action,extra] of [['uploadBegin',{}],['uploadChunk',{offset:0,bytes:bytes.toString('base64')}],['uploadFinish',{}]])
    await runtime.images.request({action,upload,owner:'fixture',...extra});
  const request={action:'message',requestId:crypto.randomUUID(),text:brief(maximum),images:[upload],imageOwner:'fixture'};
  assert.equal((await send(request)).status,200);await runtime.close();
  const restarted=new AssistantRuntime({root,coordinator});t.after(()=>restarted.close());
  await restarted.command(request);
  await restarted.nativePoll({catalog:{revision:1,tabs:[]}});await restarted.drainTask;
  assert.equal(calls.length,1);assert.equal(calls[0].text,request.text);
  assert.deepEqual(await fs.readFile(calls[0].images[0]),bytes);
  assert.deepEqual((await restarted.command({action:'state'})).messages[0].images,[upload]);
});
test('history revisions omit unchanged text, detect even middle edits and still return full text on reconnect',async t=>{
  const {runtime}=await fixture(t);
  await runtime.command({action:'message',requestId:'large-history',text:brief(maximum)});
  const first=await runtime.command({action:'state'});
  const repeated=await runtime.command({action:'state',historyRevision:first.historyRevision});
  assert.equal(repeated.historyUnchanged,true);assert.deepEqual(repeated.messages,[]);
  assert.ok(JSON.stringify(repeated).length<JSON.stringify(first).length/20);
  runtime.state.messages[0].text=first.messages[0].text.replace('MIDDLE_EXACT','MIDDLE_EDITED');
  const changed=await runtime.command({action:'state',historyRevision:first.historyRevision});
  assert.equal(changed.historyUnchanged,false);assert.match(changed.messages[0].text,/MIDDLE_EDITED/);
  assert.equal((await runtime.command({action:'state'})).messages[0].text,changed.messages[0].text);
});
test('context rejection is actionable and preserves complete request and receipt without replay',async t=>{
  const {runtime,calls}=await fixture(t);
  await runtime.nativePoll({catalog:{revision:1,tabs:[]}});
  const request={action:'message',requestId:'context',text:'fixture-context-limit'};
  await runtime.command(request);await runtime.drainTask;
  const retried=await runtime.command(request);
  assert.equal(retried.job.status,'attention');assert.match(retried.job.error,/remaining context.*complete text.*No automatic resend/);
  assert.equal(retried.messages[0].text,request.text);assert.equal(calls.length,1);
  assert.equal(retried.messageReceipts[0].status,'attention');
});
