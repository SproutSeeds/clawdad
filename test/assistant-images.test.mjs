import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {AssistantRuntime, assistantHttp} from '../lib/assistant-runtime.mjs';
import {assistantExecArguments} from '../lib/assistant-coordinator.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const describe = bytes => ({id:crypto.randomUUID(),fileName:'Screenshot with spaces.png',mimeType:'image/png',size:bytes.length,
  sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'assistant-images-'));
  const calls=[];
  const coordinator={prepare:async()=>({}),stop(){},run:async request=>{
    calls.push({...request,bytes:await Promise.all(request.images.map(file=>fs.readFile(file)))});
    await request.onSession('01a07d6d-4359-7361-a94b-8a651ca9858b');
    await request.onMessage({id:'reply',text:'Image received'});
  }};
  const runtime=new AssistantRuntime({root,coordinator});
  t.after(async()=>{await runtime.close();await fs.rm(root,{recursive:true,force:true});});
  await runtime.command({action:'start',requestId:'start'});
  await runtime.nativePoll({catalog:{revision:1,tabs:[]}});
  async function upload(bytes=png,owner='phone-a') {
    const image=describe(bytes);
    const send=(action,extra={})=>runtime.images.request({action,owner,upload:image,...extra});
    await send('uploadBegin');
    for(let offset=0;offset<bytes.length;offset+=128*1024)await send('uploadChunk',{offset,bytes:bytes.subarray(offset,offset+128*1024).toString('base64')});
    await send('uploadFinish');
    return image;
  }
  return {runtime,root,calls,upload,coordinator};
}
test('chat images reach the coordinator as verified local bytes, with exact text and one accepted turn',async t=>{
  const {runtime,calls,upload,root}=await fixture(t);
  const bytes=Buffer.concat([png,crypto.randomBytes(140_000)]),image=await upload(bytes);
  const request={action:'message',requestId:crypto.randomUUID(),text:'Inspect this image. `literal` $(words)',images:[image],imageOwner:'phone-a'};
  await Promise.all([runtime.command(request),runtime.command(request)]);
  await runtime.command({images:[image],imageOwner:'phone-a',text:request.text,requestId:request.requestId,action:'message'});
  await runtime.drainTask;
  assert.equal(calls.length,1);assert.equal(calls[0].text,request.text);
  assert.deepEqual(calls[0].bytes,[bytes]);
  assert.ok(calls[0].images[0].startsWith(path.join(root,'Images','received')));
  const state=await runtime.command({action:'state'});
  assert.deepEqual(state.messages[0].images,[image]);
  assert.equal((await runtime.job(request.requestId)).status,'completed');
  assert.equal(JSON.stringify(state).includes(root),false);
  assert.equal(JSON.stringify(state).includes('phone-a'),false);
  await assert.rejects(runtime.command({...request,images:[await upload()]}),/different action/);
});
test('saved request fingerprints from earlier builds accept reordered equivalent retries',async t=>{
  const {runtime}=await fixture(t);
  const request={action:'terminal.insert',requestId:'legacy-draft',tabId:'exact-tab',text:'Original text'};
  // Simulate a receipt persisted by the build before session-bound insertion.
  const job={id:request.requestId,action:request.action,args:{tabId:request.tabId,text:request.text},status:'completed'};
  runtime.state.jobs.push(job);
  job.fingerprint=JSON.stringify({action:request.action,args:{tabId:request.tabId,text:request.text}});
  const replay=await runtime.command({text:request.text,tabId:request.tabId,action:request.action,requestId:request.requestId},{tool:true});
  assert.equal(replay.job.id,job.id);
  await assert.rejects(runtime.command({...request,text:'Changed text'},{tool:true}),/different action/);
});
test('missing, unfinished, other-device, corrupted and forged images cannot enqueue a text-only substitute',async t=>{
  const {runtime,upload,calls}=await fixture(t);
  const command=images=>runtime.command({action:'message',requestId:crypto.randomUUID(),text:'Look',images,imageOwner:'phone-a'});
  await assert.rejects(command([describe(png)]),/not finished/);
  const unfinished=describe(png);
  await runtime.images.request({action:'uploadBegin',owner:'phone-a',upload:unfinished});
  await assert.rejects(command([unfinished]),/not finished/);
  await assert.rejects(command([await upload(png,'phone-b')]),/not finished/);
  const image=await upload();
  await assert.rejects(command([{...image,fileName:'../../escape.png'}]),/PNG or JPEG/);
  await assert.rejects(command([{...image,sha256:'0'.repeat(64)}]),/changed/);
  await assert.rejects(command([{...image,fileName:'Forged.png'}]),/changed/);
  await assert.rejects(command([image,image]),/totaling/);
  const {images}=await runtime.images.resolve({owner:'phone-a',uploadIds:[image.id]});
  await fs.writeFile(images[0].path,Buffer.alloc(png.length));
  await assert.rejects(command([image]),/changed/);
  await runtime.drainTask;
  assert.equal(calls.length,0);
  assert.equal((await runtime.command({action:'state'})).messages.length,0);
});
test('queued image-only message survives a host restart and revalidates its saved bytes',async t=>{
  const {runtime,root,upload,coordinator,calls}=await fixture(t);
  await runtime.nativePoll({});
  const image=await upload();
  await runtime.command({action:'message',requestId:'image-only',text:'',images:[image],imageOwner:'phone-a'});
  await runtime.close();
  const next=new AssistantRuntime({root,coordinator});
  t.after(()=>next.close());
  await next.nativePoll({catalog:{revision:1,tabs:[]}});
  await next.drainTask;
  assert.equal(calls.length,1);assert.deepEqual(calls[0].bytes,[png]);assert.equal(calls[0].text,'');
});
test('the local Assistant HTTP upload route only accepts validated image operations',async t=>{
  const {runtime}=await fixture(t);
  let status,payload;
  const post=async body=>assistantHttp({method:'POST'},null,new URL('http://localhost/v1/assistant/image'),runtime,
    {readBody:async()=>body,json:(_,s,b)=>{status=s;payload=b;}});
  const image=describe(png);
  await post({action:'uploadBegin',upload:image,owner:'paired-phone'});
  assert.equal(status,200);assert.equal(payload.offset,0);
  await post({action:'terminal.send',upload:image,owner:'paired-phone'});
  assert.equal(status,400);
});
test('image flags reach both fresh and resumed Codex turns without changing text or shell restrictions',()=>{
  for(const sessionId of [null,'01a07d6d-4359-7361-a94b-8a651ca9858b']){
    const images=['/Users/test/Assistant/Images/received/a/Screenshot with spaces.png'];
    const args=assistantExecArguments({root:'/Users/test/Assistant',sessionId,images});
    assert.equal(args.at(-1),'-');
    assert.equal(args[args.indexOf('--image')+1],images[0]);
    if(sessionId)assert.ok(args.indexOf('--image')>args.indexOf('resume'));
    assert.ok(args.includes('sandbox_mode="read-only"'));
  }
});
