import test from 'node:test';
import assert from 'node:assert/strict';
import {accountWorkEvidence} from '../lib/codex-account-work-evidence.mjs';

test('failed read-only inspections cannot fence switching and original records are unchanged',()=>{
  const job={action:'terminal.inspect',status:'attention',error:'unsupported input'};
  const before=structuredClone(job);assert.equal(accountWorkEvidence(job).accountReadOnly,true);assert.deepEqual(job,before);
  assert.equal(accountWorkEvidence({...job,action:'mainworkspace.close.inspect'}).accountReadOnly,true);
});
test('a native failure before prepare is distinct from a prepared or uncertain delivery',()=>{
  for(const action of ['terminal.send','terminal.queue','terminal.insert','terminal.prompt']){
    const job={action,status:'attention',error:'Exact input unavailable'};
    assert.equal(accountWorkEvidence(job).status,'not_dispatched');
    assert.equal(accountWorkEvidence({...job,preparedAt:'2026-09-16T00:00:00Z'}).status,'retained_attention');
    assert.equal(accountWorkEvidence({...job,status:'running'}).status,'running');
  }
  const uncertain={action:'appserver.send',status:'attention',error:'connection failed',uncertain:true};
  assert.equal(accountWorkEvidence(uncertain).status,'retained_attention');assert.equal(uncertain.status,'attention');assert.equal(uncertain.uncertain,true);
});
test('explicit no-key receipts settle only when acceptance was not reported',()=>{
  const job={action:['terminal','key'].join('.'),args:{key:'enter',intent:'submit'},status:'attention',preparedAt:'time',result:{keySent:false}};
  assert.equal(accountWorkEvidence(job).status,'not_dispatched');
  assert.equal(accountWorkEvidence({...job,result:{keySent:false,turnAccepted:true}}).status,'retained_attention');
  assert.equal(accountWorkEvidence({...job,action:'terminal.queue',result:{tabSent:false}}).status,'not_dispatched');
  assert.equal(accountWorkEvidence({...job,action:'terminal.queue',result:{tabSent:false,queueAccepted:true}}).status,'retained_attention');
});
