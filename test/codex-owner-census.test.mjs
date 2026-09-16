import test from 'node:test';
import assert from 'node:assert/strict';
import {codexProcessOwners} from '../lib/codex-thread-control.mjs';

test('ownership census discards failed partial evidence and refreshes exited profile processes',async()=>{
  let ps=0,files=0;const id='00000000-0000-4000-8000-000000000001';
  const owners=await codexProcessOwners({socketPath:'/private/runtime.sock',run:async(command,args)=>{
    if(command==='/bin/ps')return {stdout:++ps===1?'1 ?? /bin/codex\n2 ?? /bin/codex\n':'1 ttys007 /bin/codex\n'};
    if(++files===1)throw Object.assign(Error('Process exited'),{code:1,stdout:'p2\nn/private/runtime.sock\n'});
    assert.equal(args[3],'1');return {stdout:`p1\nn/fixture/rollout-date-${id}.jsonl\n`};
  }});
  assert.deepEqual(owners,[{pid:1,tty:'ttys007',threads:[id],socket:false}]);assert.equal(ps,2);assert.equal(files,2);
});

test('persistent and nontransient census failures never use partial ownership evidence',async()=>{
  for(const code of [1,'EACCES']){
    let files=0;
    await assert.rejects(codexProcessOwners({run:async command=>{
      if(command==='/bin/ps')return {stdout:'1 ?? /bin/codex\n'};
      files++;throw Object.assign(Error('Inspection failed'),{code,stdout:'p1\nn/private/runtime.sock\n'});
    }}),/Inspection failed/);
    assert.equal(files,code===1?3:1);
  }
});
