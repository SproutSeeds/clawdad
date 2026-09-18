import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {CodexAuxiliaryTasks} from '../lib/codex-auxiliary-tasks.mjs';
import {readAccountWork} from '../lib/codex-app-account-work.mjs';

test('summary helpers retain subscription admission and read-only shared execution receipts',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-aux-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let runs=0,allow=true;const accounts={withWorkAdmission:async(_request,persist)=>{if(!allow)throw Error('Account switch pending');return persist({accountEpoch:7});},assertDelivery:async()=>{}};
  const runner={run:async args=>{runs++;assert.equal(args.nativeTools,false);assert.equal(args.disableTools,true);assert.equal(args.policy.mode,'read-only');assert.equal(args.text,'Supplied evidence');
    await args.onSession('thread');const work=await readAccountWork({root});assert.equal(work.complete,true);assert.equal(work.jobs[0].status,'running');assert.equal(work.jobs[0].accountEpoch,7);
    await args.onMessage({text:'Verified summary'});return {sessionId:'thread',turnId:'turn'};}};
  const tasks=new CodexAuxiliaryTasks({root:path.join(root,'Auxiliary'),runner,accounts,resolveModel:async()=>({model:'test',reasoningEffort:'low'})});
  assert.equal(await tasks.run('project_summary',root,'Supplied evidence'),'Verified summary');
  const work=await readAccountWork({root});assert.equal(work.jobs[0].status,'completed');
  allow=false;await assert.rejects(tasks.run('delegate_plan',root,'Supplied evidence'),/switch pending/);assert.equal(runs,1);
  tasks.state.jobs[0].status='running';await fs.writeFile(tasks.file,JSON.stringify(tasks.state));
  const restarted=new CodexAuxiliaryTasks({root:path.join(root,'Auxiliary'),runner,accounts});await restarted.load();
  assert.equal(restarted.state.jobs[0].status,'attention');assert.equal(runs,1);
});
