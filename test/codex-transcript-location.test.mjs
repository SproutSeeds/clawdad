import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {indexedCodexTranscriptPath,liveCodexProjectBinding} from '../lib/codex-transcript-location.mjs';

const exec=promisify(execFile);
test('shared index resolves account-profile transcripts and rejects wrong or archived identities',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-indexed-history-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const home=path.join(root,'canonical'),profile=path.join(root,'account-profile','sessions');
  await fs.mkdir(home);await fs.mkdir(profile,{recursive:true});
  const transcript=path.join(profile,'rollout-profile-thread.jsonl');
  await fs.writeFile(transcript,JSON.stringify({type:'session_meta',payload:{id:'profile-thread',cwd:root,source:'vscode'}})+'\n');
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  await exec(process.env.CLAWDAD_SQLITE3_PATH||'sqlite3',[path.join(home,'state_5.sqlite'),
    'CREATE TABLE threads(id TEXT, rollout_path TEXT, archived INTEGER); INSERT INTO threads VALUES '+
    ['profile-thread','wrong-thread','archived-thread'].map((id,i)=>`(${quote(id)},${quote(transcript)},${i===2?1:0})`).join(',')+';']);
  assert.equal(await indexedCodexTranscriptPath(home,'profile-thread'),transcript);
  assert.equal(await indexedCodexTranscriptPath(home,'wrong-thread'),'');
  assert.equal(await indexedCodexTranscriptPath(home,'archived-thread'),'');
  assert.equal(await indexedCodexTranscriptPath(home,"x' OR 1=1 --"),'');
  assert.equal(await indexedCodexTranscriptPath(path.join(root,'absent'),'profile-thread'),'');
  await fs.unlink(transcript);assert.equal(await indexedCodexTranscriptPath(home,'profile-thread'),'');
});

test('first turn requires exact live shared ownership and matching project',async()=>{
  const id='12345678-1234-1234-1234-123456789abc';let loaded=[id],cwd='/tmp/first-turn',threadId=id;
  const server={pid:42,socket:true,tty:'??',threads:[]};let owners=[server];
  const calls=[];const client={request:async(method,params)=>{calls.push(method);
    if(method==='thread/loaded/list')return {data:loaded};
    assert.equal(method,'thread/read');assert.equal(params.threadId,id);return {thread:{id:threadId,cwd,source:'vscode',path:null}};
  }};
  const check=()=>liveCodexProjectBinding(client,id,'/tmp/first-turn',async()=>owners);
  assert.equal((await check()).ok,true);
  cwd='/another-project';assert.equal(await check(),null);cwd='/tmp/first-turn';
  threadId='87654321-1234-1234-1234-123456789abc';assert.equal(await check(),null);threadId=id;
  loaded=[];assert.equal(await check(),null);loaded=[id];
  owners=[server,{pid:43,socket:false,tty:'ttys001',threads:[id]}];assert.equal(await check(),null);
  assert.ok(calls.every(method=>['thread/read','thread/loaded/list'].includes(method)));
});
