import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readMainWorkspace,workspaceProjection,MainWorkspaceResumeClaims} from '../lib/main-terminal-workspace.mjs';
test('workspace projection preserves exact separate conversations and exposes recoverable drafts and progress',()=>{
  const state={revision:7,status:'waiting',activeRequest:'restore',observedAt:100,roster:{savedAt:1,fullScreen:true,entries:[
    {id:'a',name:'One',directory:'/same',sessionId:'session-one',kind:'codex',draft:{text:'Exact Ω\nsecond line'}},
    {id:'b',name:'Two',directory:'/same',sessionId:'session-two',kind:'codex',draft:{limitation:'Hidden paste is unavailable'}}]},
    progress:{a:{phase:'restored'},b:{phase:'waiting',message:'Mount the drive'}},previous:[{savedAt:0,entries:[{id:'old'}]}]};
  const view=workspaceProjection(state);
  assert.equal(view.savedAt,'2001-01-01T00:00:01.000Z');assert.equal(view.fullScreen,true);
  assert.equal(view.entries[0].draftText,'Exact Ω\nsecond line');assert.equal(view.entries[1].draftText,null);
  assert.equal(view.entries[1].message,'Mount the drive');assert.equal(view.snapshots[0].count,1);
});
test('missing or corrupt workspace remains explicit and preserves the file',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'main-workspace-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const assistant=path.join(root,'Assistant');await fs.mkdir(assistant);
  assert.equal((await readMainWorkspace(assistant)).status,'not_saved');
  const folder=path.join(root,'MainTerminalWorkspace');await fs.mkdir(folder);const file=path.join(folder,'main-workspace.json');await fs.writeFile(file,'broken');
  assert.equal((await readMainWorkspace(assistant)).status,'needs_attention');assert.equal(await fs.readFile(file,'utf8'),'broken');
});
test('a resume ownership claim requires a live authorized restore and never enables a runtime',async()=>{
  const claims=new MainWorkspaceResumeClaims({job:async()=>({action:'message',status:'running'})});
  await assert.rejects(claims.claim({id:'not-restore',sessionId:'01a0817d-c8ca-7aa3-9153-74c69e51841d'}),/authorized workspace restore/);
  assert.throws(()=>claims.check({token:'missing'}),/expired/);
  await claims.release({token:'missing'});await claims.close();
});
