import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {TerminalNotificationMonitor,discoverTerminalConversations,resolveTerminalNotification} from '../lib/terminal-notifications.mjs';

const first='11111111-1111-4111-8111-111111111111', second='22222222-2222-4222-8222-222222222222';
const timestamp=Date.parse('2026-09-07T12:00:00.000Z');
const event=(type,text='',time=timestamp+1000,turn='turn-1')=>({type:'event_msg',timestamp:new Date(time).toISOString(),payload:{type,turn_id:turn,last_agent_message:text}});
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-notification-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let now=timestamp;
  const sources=[]; const received=[];
  const create=async (id,projectPath='/projects/code')=>{
    const file=path.join(root,`rollout-${id}.jsonl`);
    await fs.writeFile(file,JSON.stringify({type:'session_meta',payload:{source:'cli',id,cwd:projectPath}})+'\n');
    const value={file,sessionId:id,projectPath,directory:path.basename(projectPath),tty:'/dev/ttys002'}; sources.push(value); return value;
  };
  const statePath=path.join(root,'terminal-notifications.json');
  const monitor=new TerminalNotificationMonitor({statePath,discover:async()=>sources,deliver:async value=>{received.push(value);},clock:()=>now});
  const append=(file,record,newline=true)=>fs.appendFile(file.file,JSON.stringify(record)+(newline?'\n':''));
  return {root,sources,received,monitor,create,append,statePath,advance:ms=>{now+=ms;}};
}
test('completion alerts ignore history, busy/focus/output and aborted turns',async t=>{
  const f=await fixture(t), file=await f.create(first);
  await f.append(file,event('task_complete','An old answer',timestamp-1000));
  await f.monitor.tick();
  await f.append(file,event('task_started'));
  await f.append(file,{type:'response_item',payload:{type:'function_call_output',output:'task_complete'}});
  await f.append(file,event('turn_aborted','An interrupted answer'));
  await f.monitor.tick();
  assert.equal(f.received.length,0);
  f.advance(2000);
  await f.append(file,event('task_complete','Complete answer'));
  await f.monitor.tick();
  assert.equal(f.received.length,1);
  assert.equal(f.received[0].directory,'code');
  assert.equal(f.received[0].completedAt,'2026-09-07T12:00:01.000Z');
  assert.equal('projectPath' in f.received[0],false);
  assert.equal('response' in f.received[0],false);
});
test('all discovered tabs notify without visits and same-directory conversations keep distinct identities',async t=>{
  const f=await fixture(t), a=await f.create(first), b=await f.create(second);
  await f.monitor.tick(); f.advance(2000);
  await f.append(a,event('task_complete','One'));
  await f.append(b,event('task_complete','Two'));
  await f.monitor.tick();
  assert.equal(f.received.length,2); assert.notEqual(f.received[0].id,f.received[1].id);
  const target=await resolveTerminalNotification({configPath:path.join(f.root,'cloud.json')},f.received[1].id);
  assert.equal(target.sessionId,second); assert.equal(target.projectPath,'/projects/code');
});
test('partial records wait for newline, final-answer fallback works, retry and restart do not lose a completion',async t=>{
  const f=await fixture(t), file=await f.create(first);
  await f.monitor.tick(); f.advance(2000);
  await f.append(file,{type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{text:'Done.'}]}});
  await f.append(file,event('task_complete'),false);
  await f.monitor.tick(); assert.equal(f.received.length,0);
  await fs.appendFile(file.file,'\n');
  f.monitor.deliver=async()=>{throw new Error('Network offline');};
  await f.monitor.tick();
  assert.equal(f.monitor.state.events[0].delivered,false);
  f.advance(31_000);
  const replacement=new TerminalNotificationMonitor({statePath:f.statePath,discover:async()=>[],clock:()=>timestamp+33_000,deliver:async v=>f.received.push(v)});
  await replacement.tick(); assert.equal(f.received.length,1);
  await replacement.tick(); assert.equal(f.received.length,1);
  assert.equal((await fs.stat(f.statePath)).mode & 0o777,0o600);
});
test('overlapping samples serialize delivery and duplicate lifecycle records stay one event',async t=>{
  const f=await fixture(t), file=await f.create(first);
  await f.monitor.tick(); f.advance(2000);
  await f.append(file,event('task_complete','Done'));
  await f.append(file,event('task_complete','Done'));
  await Promise.all([f.monitor.tick(),f.monitor.tick(),f.monitor.tick()]);
  assert.equal(f.received.length,1);
});
test('discovery accepts only open CLI-owned transcripts inside the session root',async t=>{
  const f=await fixture(t), file=await f.create(first);
  const headless=await f.create(second);
  await fs.writeFile(headless.file,JSON.stringify({type:'session_meta',payload:{source:'exec',id:second,cwd:'/projects/code'}})+'\n');
  const calls=[];
  const result=await discoverTerminalConversations({sessionRoot:f.root,execute:async(command,args)=>{
    calls.push([command,args]);
    return {stdout:command==='/bin/ps'?'101 ttys002 /opt/homebrew/bin/codex\n102 ?? codex\n103 ttys003 zsh\n':`p101\nn${file.file}\nn${headless.file}\nn/etc/passwd.jsonl\n`};
  }});
  assert.equal(result.length,1); assert.equal(result[0].sessionId,first);
  assert.deepEqual(calls[1][1],['-a','-p','101','-Fn']);
});
