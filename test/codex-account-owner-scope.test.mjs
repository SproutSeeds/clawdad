import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAccountProcessTree,classifyAccountOwnerScope,readAccountOwners} from '../lib/codex-account-owner-scope.mjs';
const row=(pid,parent,exe)=>`${pid} ${parent} Wed Sep 16 02:55:07 2026 ${exe}`;
test('a changing read-only census retries wholly and never treats exhausted failures as empty ownership',async()=>{
  let calls=0;assert.deepEqual(await readAccountOwners({},async()=>{if(++calls<2)throw Error('helper exited');return [{pid:10}];}),[{pid:10}]);
  calls=0;await assert.rejects(readAccountOwners({},async()=>{calls++;throw Error('unavailable');}),e=>e.code==='account_owner_inventory_unavailable');assert.equal(calls,3);
});
test('only verified foreground and managed socket owners transition; child and separate app owners retain scope',()=>{
  const tree=parseAccountProcessTree([row(10,1,'/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal'),
    row(20,10,'/bin/zsh'),row(30,20,'/opt/homebrew/bin/codex'),row(31,30,'/opt/homebrew/bin/codex'),
    row(40,1,'/opt/homebrew/bin/codex'),row(50,1,'/Applications/College Kid.app/Contents/MacOS/CollegeKid'),
    row(51,50,'/opt/homebrew/bin/codex'),row(60,1,'/opt/homebrew/bin/codex')].join('\n'));
  const native={complete:true,consumers:[{processId:30,tty:'/dev/ttys001'}]};
  const owners=[30,31,40,51,60].map(pid=>({pid,tty:pid<40?'ttys001':'??',socket:pid===40,threads:[]}));
  const result=classifyAccountOwnerScope({owners,native,tree,managedSocketPID:40});
  assert.deepEqual(result.selected.map(o=>o.pid),[30,40]);assert.deepEqual(result.helpers.map(o=>o.pid),[31]);
  assert.equal(result.foreign[0].application,'/Applications/College Kid.app');assert.equal(result.unknown[0].pid,60);assert.equal(result.complete,false);
  assert.equal(classifyAccountOwnerScope({owners:owners.filter(o=>o.pid!==60),native,tree,managedSocketPID:40}).complete,true);
});
test('same TTY, matching name, missing native owner, changed lifetime or malformed inventory grants no ownership',()=>{
  const native={complete:true,consumers:[{processId:30,tty:'/dev/ttys001'}]},owners=[{pid:31,tty:'ttys001',threads:[]}];
  const tree=parseAccountProcessTree(row(31,1,'/opt/homebrew/bin/codex'));
  const scope=classifyAccountOwnerScope({owners,native,tree});assert.equal(scope.complete,false);assert.equal(scope.selected.length,0);
  assert.equal(scope.unknown.length,2);
  assert.notEqual(tree.get(31).identity,parseAccountProcessTree(row(31,1,'/opt/homebrew/bin/codex').replace('02:55:07','02:55:08')).get(31).identity);
  assert.throws(()=>parseAccountProcessTree('31 /opt/homebrew/bin/codex'));
});
