import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {AgentAccessSettings,agentPermissionParams} from '../lib/agent-access-settings.mjs';
test('host access persists, revisions reject stale edits and active snapshots stay fixed',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'agent-access-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file=path.join(root,'access.json'),settings=new AgentAccessSettings({file});
  const active=await settings.resolve();assert.equal(active.mode,'full');assert.equal(active.reviewer,'auto_review');
  const edit={expectedRevision:0,policy:{...active,mode:'workspace',computerUse:false}};
  await settings.update(edit,'one');assert.equal((await settings.update(edit,'one')).access.revision,1);
  assert.equal((await new AgentAccessSettings({file}).resolve()).mode,'workspace');assert.equal(active.mode,'full');
  await assert.rejects(settings.update({...edit,policy:{...edit.policy,mode:'full'}},'two'),/changed elsewhere/);
  await assert.rejects(settings.update({...edit,policy:{...edit.policy,reviewer:'never'}},'bad'),/valid agent/);
  assert.equal((await settings.resolve('plan')).mode,'read-only');
  assert.deepEqual(agentPermissionParams(active,'/tmp').turn,{sandboxPolicy:{type:'dangerFullAccess'},approvalPolicy:'on-request',approvalsReviewer:'auto_review'});
});
