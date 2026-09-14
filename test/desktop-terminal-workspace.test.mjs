import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceProjection,workspaceWindows} from '../lib/main-terminal-workspace.mjs';
import {chooseWindow,reviewSnapshot,staleReview,restoreArguments,lineupChanges,pendingRequest} from '../web/main-terminal-workspace-state.mjs';
const tab=(id,group,tty,position)=>({tabId:id,group,tty,lifetime:`login-${tty}`,owner:`agent-${tty}`,position,name:id,directory:'/same',kind:'codex',sessionId:`thread-${tty}`});
test('window selection survives reordering but never silently adopts a rebuilt or changed window',()=>{
  const initial=[tab('a','one','001',1),tab('b','one','002',2),tab('c','two','003',1)];
  const groups=workspaceWindows(initial);assert.equal(groups.length,2);assert.deepEqual(groups[0].tabs.map(t=>t.tabId),['a','b']);
  const refreshed=workspaceWindows(initial.map(t=>({...t,group:t.group+'-new',position:3-t.position})));
  assert.equal(refreshed[0].id,groups[0].id);assert.equal(chooseWindow(refreshed,groups[0].id).window.tabId,'b');
  const rebuilt=workspaceWindows(initial.map(t=>({...t,tabId:t.tabId+'-new'})));
  assert.equal(chooseWindow(rebuilt,groups[0].id).window,null);
  const changed=workspaceWindows([initial[0],initial[2]]);
  assert.equal(chooseWindow(changed,groups[0].id,true).window,null);
  assert.equal(chooseWindow(changed,'',true).id,'');
  assert.equal(chooseWindow([groups[0]],'',true).window.count,2);
  assert.equal(chooseWindow(workspaceWindows([{...initial[0],lifetime:'new-login'}]),groups[0].id).window,null);
});
test('cold native topology includes unbound tabs and overrides partial process observations',()=>{
  const complete=workspaceWindows([tab('a','one','001',1),tab('b','one','002',2)]);
  complete[0].tabs[1]={tabId:'b',name:'Unvisited'};
  const state={revision:1,observations:[tab('a','one','001',1)],windowChoices:complete};
  const value=workspaceProjection(state);assert.equal(value.windows[0].count,2);
  assert.equal(value.windows[0].tabs[1].directory,undefined);
  assert.equal(value.windows[0].id,complete[0].id);
});
test('review holds text and exact revision across polling; restore rejects concurrent phone updates',()=>{
  const state={revision:3,selectedSnapshotId:'one',snapshotRevision:2,namedSnapshots:[{id:'one',name:'Research',revision:2}],entries:[{id:'tab',draftText:'Exact Ω\nsecond line'}]};
  const review=reviewSnapshot(state,'one');state.entries[0].draftText='changed on phone';
  assert.equal(review.entries[0].draftText,'Exact Ω\nsecond line');
  assert.deepEqual(restoreArguments(review,state),{snapshotId:'one',expectedSnapshotRevision:2});
  state.namedSnapshots[0].revision=3;assert.equal(staleReview(review,state),true);
  assert.throws(()=>restoreArguments(review,state),/changed/);
  assert.equal(reviewSnapshot(state,'other'),null);
});
test('lineup review distinguishes same-directory conversations and agent-to-shell changes',()=>{
  const previous=[{name:'Agent A',kind:'codex',directory:'/same',sessionId:'a'},{name:'Agent B',kind:'codex',directory:'/same',sessionId:'b'}];
  const current=[previous[1],{name:'Agent A',kind:'shell',directory:'/home',tty:'003'}];
  const diff=lineupChanges(previous,current);assert.equal(diff.removed[0].name,'Agent A');assert.equal(diff.added[0].kind,'shell');
});
test('pending request arguments are frozen for duplicate/reconnect receipt reconciliation',()=>{
  const args={snapshotId:'exact',expectedSnapshotRevision:3};const request=pendingRequest('mainworkspace.restore',args,'fixed');args.expectedSnapshotRevision=4;
  assert.equal(JSON.parse(JSON.stringify(request)).args.expectedSnapshotRevision,3);assert.equal(request.id,'fixed');
});
test('lightweight projection cannot mutate manual membership and flags incomplete drafts',()=>{
  const saved={version:2,revision:9,selectedSnapshotId:'one',snapshots:[{id:'one',name:'Research',revision:3,roster:{entries:[{id:'a',directory:'/actual',kind:'codex',sessionId:'exact',draft:{text:null}}]},previous:[]}],observations:[]};
  const before=JSON.stringify(saved);const view=workspaceProjection(saved);assert.equal(view.snapshotRevision,3);assert.equal(view.namedSnapshots[0].draftWarnings,1);
  assert.deepEqual(view.windows,[]);assert.equal(view.entries[0].directory,'/actual');assert.equal(JSON.stringify(saved),before);
});
