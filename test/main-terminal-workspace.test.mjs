import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readMainWorkspace,workspaceProjection,MainWorkspaceResumeClaims} from '../lib/main-terminal-workspace.mjs';
import {assistantTools} from '../lib/assistant-mcp.mjs';
test('named snapshots expose exact membership and independent progress without rewriting captures',()=>{
  const first={id:'one',name:'Research',revision:2,roster:{savedAt:5,entries:[{id:'a',kind:'codex',sessionId:'thread-a',directory:'/same',draft:{text:'Exact Ω'}}]},previous:[]};
  const second={id:'two',name:'Other',revision:1,roster:{entries:[{id:'b',kind:'shell',directory:'/home',identityIssue:'Legacy shell needs review'}]},previous:[]};
  const state={version:2,revision:9,status:'restored',message:'Research restored',activeRequest:'research-restore',selectedSnapshotId:'one',snapshots:[first,second],operations:{one:{progress:{a:{phase:'already_open'}}}}};
  const bytes=JSON.stringify(state),a=workspaceProjection(state),b=workspaceProjection(state,'two');
  assert.equal(a.entries[0].draftText,'Exact Ω');assert.equal(a.entries[0].status,'already_open');
  assert.equal(a.namedSnapshots[1].needsReview,true);assert.equal(b.entries.length,1);assert.equal(b.entries[0].identityIssue,'Legacy shell needs review');
  assert.equal(b.status,'needs_review');assert.equal(b.message,null);assert.equal(b.activeRequest,null);
  assert.equal(JSON.stringify(state),bytes);assert.equal(workspaceProjection(state,'missing').status,'needs_attention');
  assert.equal(workspaceProjection(state,'missing').namedSnapshots.length,2);
  assert.equal(workspaceProjection(state,'missing').selectedSnapshotId,'missing');
});
test('Assistant exposes named save/update, exact restore, and separate inspect/confirmed close tools',()=>{
  const tool=name=>{const t=assistantTools.find(t=>t[0]===name);return t&&{name:t[0],description:t[1],inputSchema:t[2]};};
  for(const name of ['main_terminal_workspace','save_main_terminal_workspace','restore_main_terminal_workspace','inspect_terminal_window_close','close_terminal_window'])assert.ok(tool(name),name);
  assert.ok(tool('save_main_terminal_workspace').inputSchema.properties.snapshotId);
  assert.ok(tool('save_main_terminal_workspace').inputSchema.properties.windowId);
  assert.ok(!tool('save_main_terminal_workspace').inputSchema.required.includes('windowToken'));
  assert.ok(tool('restore_main_terminal_workspace').inputSchema.required.includes('snapshotId'));
  assert.deepEqual(tool('close_terminal_window').inputSchema.required,['confirmationToken','confirm','requestId']);
  assert.match(tool('save_main_terminal_workspace').description,/NEVER authorizes closing/);
});
test('workspace projection preserves exact separate conversations and exposes recoverable drafts and progress',()=>{
  const state={revision:7,status:'waiting',activeRequest:'restore',observedAt:100,roster:{savedAt:1,fullScreen:true,entries:[
    {id:'a',name:'One',directory:'/same',sessionId:'session-one',kind:'codex',draft:{text:'Exact Ω\nsecond line'}},
    {id:'b',name:'Two',directory:'/same',sessionId:'session-two',kind:'codex',draft:{limitation:'Hidden paste is unavailable'}}]},
    progress:{a:{phase:'restored'},b:{phase:'waiting',message:'Mount the drive'}},previous:[{savedAt:0,entries:[{id:'old'}]}]};
  const view=workspaceProjection(state);
  assert.equal(view.savedAt,'2001-01-01T00:00:01.000Z');assert.equal(view.fullScreen,false);
  assert.equal(view.capturedFullScreen,true);assert.equal(view.windowPresentation,'fillAvailableDisplay');
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
test('capture progress is readable without mutating snapshots and ignores malformed progress',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workspace-save-progress-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const folder=path.join(root,'MainTerminalWorkspace');await fs.mkdir(folder);
  const file=path.join(folder,'main-workspace.json'),progress=path.join(folder,'capture-progress.json');
  const bytes=JSON.stringify({revision:7,status:'saved',roster:{entries:[]},snapshots:[]});await fs.writeFile(file,bytes);
  await fs.writeFile(progress,JSON.stringify({requestId:'one-save',current:2,total:14}));
  assert.deepEqual((await readMainWorkspace(path.join(root,'Assistant'))).captureProgress,{requestId:'one-save',current:2,total:14});
  assert.equal(await fs.readFile(file,'utf8'),bytes);
  await fs.writeFile(progress,JSON.stringify({requestId:'one-save',current:15,total:14}));
  assert.equal((await readMainWorkspace(path.join(root,'Assistant'))).captureProgress,undefined);
  await fs.writeFile(progress,'interrupted write');
  assert.equal((await readMainWorkspace(path.join(root,'Assistant'))).status,'saved');
});
test('a resume ownership claim requires a live authorized restore and never enables a runtime',async()=>{
  const claims=new MainWorkspaceResumeClaims({job:async()=>({action:'message',status:'running'})});
  await assert.rejects(claims.claim({id:'not-restore',sessionId:'01a0817d-c8ca-7aa3-9153-74c69e51841d'}),/authorized workspace restore/);
  assert.throws(()=>claims.check({token:'missing'}),/expired/);
  await claims.release({token:'missing'});await claims.close();
});
