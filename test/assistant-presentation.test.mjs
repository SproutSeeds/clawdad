import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assistantPresentation,assistantTaskName} from '../lib/assistant-presentation.mjs';

const task=(id,extra={})=>({id,action:'terminal.send',args:{tabId:'one',text:'Please repair playback.'},status:'working',tabTitle:'/code/clawdad',createdAt:'2026-09-08T10:00:00Z',...extra});
const message=(id,text='Hello')=>({id,role:'assistant',text,createdAt:'2026-09-08T10:00:00Z'});

test('audited existing tests and future diagnostic messages are hidden before history limits',()=>{
  const genuine=message('real','I want to test my project; keep this real request.');
  const jobs=[task('old-test'),...Array.from({length:80},(_,i)=>task(`probe-${i}`,{visibility:'diagnostic'}))];
  const state={jobs,messages:[genuine,...jobs.map(j=>message(`assistant:${j.id}:1`))]};
  const original=structuredClone(state);
  const view=assistantPresentation(state,null,{jobIds:['old-test']});
  assert.deepEqual(view.messages,[{...genuine,requestId:undefined}]);assert.deepEqual(view.tasks,[]);
  assert.deepEqual(state,original,'diagnostics must preserve original records');
});

test('one genuine task updates in place and owns the readable Assistant result',()=>{
  const job=task('work');
  const state={jobs:[job],messages:[{...message('request','Please repair playback.'),role:'user'}]};
  assert.equal(assistantPresentation(state).tasks[0].displayName,'ClawDad');
  job.status='completed';job.response='Raw agent output';
  state.jobs.push(task('update:work',{action:'message',source:'task-update',response:'Playback is repaired.',args:{text:'Internal summarization prompt'}}));
  state.messages.push(message('assistant:update:work:1','Playback is repaired.'));
  for(let i=0;i<5;i++) {
    const view=assistantPresentation(state);
    assert.equal(view.tasks.length,1);assert.equal(view.tasks[0].id,'work');
    assert.equal(view.tasks[0].response,'Playback is repaired.');assert.equal(view.tasks[0].status,'completed');
    assert.equal(view.messages.length,1);assert.equal(view.taskUpdates.length,1,'voice still receives the associated result');
  }
});

test('internal polling and raw output are omitted while genuine failures remain readable',()=>{
  const state={jobs:[task('poll',{action:'terminal.inspect',status:'attention',error:'No accessible window',result:{screenText:'raw'}}),
    task('failed',{status:'attention',error:'spawn /Users/cody/private ENOENT',result:{raw:'STACK'}})],messages:[]};
  const view=assistantPresentation(state);
  assert.equal(view.tasks.length,1);assert.equal(view.tasks[0].id,'failed');
  assert.match(view.tasks[0].error,/could not finish/);assert.equal(view.tasks[0].result,undefined);
  assert.ok(!JSON.stringify(view).includes('STACK'));assert.ok(!JSON.stringify(view).includes('/Users/'));
});

test('full messages survive presentation for copying and attachments remain associated',()=>{
  const text='Phone: (415) 555-0100\n123 Main Street\n'+'Complete content 🦞 '.repeat(1000);
  const original={...message('long',text),images:[{id:'photo',fileName:'screenshot.png'}]};
  const view=assistantPresentation({jobs:[],messages:[original]});
  assert.equal(view.messages[0].text,text);assert.deepEqual(view.messages[0].images,original.images);
});

test('navigation receipts are available without becoming chat cards',()=>{
  const state={jobs:[task('focus',{action:'terminal.focus',status:'completed'})],messages:[]};
  const view=assistantPresentation(state);
  assert.deepEqual(view.tasks,[]);assert.equal(view.operations[0].id,'focus');assert.equal(view.operations[0].status,'completed');
});

test('resolved overlapping delivery failures stay in diagnostics without reappearing',()=>{
  const state={jobs:[task('superseded',{status:'attention'}),task('current')],messages:[]};
  assert.deepEqual(assistantPresentation(state,null,{resolvedJobIds:['superseded']}).tasks.map(t=>t.id),['current']);
  assert.equal(state.jobs[0].status,'attention');
});

test('directory names are readable and CLI commands never become card titles',()=>{
  assert.equal(assistantTaskName('/Volumes/Code_2TB/code/clawdad'),'ClawDad');
  assert.equal(assistantTaskName('RoomWave'),'RoomWave');
  assert.equal(assistantTaskName('cody — codex --sandbox read-only'),'Terminal agent');
});

test('exact-turn receipt rows remain readable without a final reply and preserve evidence stages',()=>{
  const jobs=[
    {id:'steer',action:'appserver.steer',status:'submitted',args:{text:'Literal clarification'},turnId:'same-turn',
      result:{summary:'Context accepted; recorded delivery awaits verification.'}},
    {id:'uncertain',action:'appserver.interrupt',status:'attention',args:{},turnId:'same-turn',
      result:{summary:'Outcome uncertain; reconcile this original receipt.'}},
    {id:'stopped',action:'appserver.interrupt',status:'completed',args:{},turnId:'same-turn',
      result:{summary:'Turn interrupted. Command and downstream tool termination are unverified. Completed effects remain.'}},
  ].map(job=>({...job,threadId:'synthetic-thread',controlReceipt:{targetIdentity:{providerHome:'/private/owner'},authorization:{quote:'private audit record'}}}));
  const state={jobs,messages:[]},before=structuredClone(state),view=assistantPresentation(state);
  assert.equal(view.tasks.length,3);
  assert.deepEqual(view.tasks.map(job=>job.status),['submitted','attention','completed']);
  assert.equal(view.tasks[0].requestText,'Literal clarification');
  assert.equal(view.tasks[1].requestText,'Stop the inspected ClawDad turn');
  for(let i=0;i<jobs.length;i++){
    assert.ok(view.tasks[i].response.startsWith(jobs[i].result.summary));
    assert.ok(view.tasks[i].response.includes('Turn: same-turn. Receipt: '+jobs[i].id));
    assert.equal(view.tasks[i].result,undefined);assert.equal(view.tasks[i].controlReceipt,undefined);
  }
  assert.deepEqual(state,before);assert.equal(view.messages.length,0);
});
