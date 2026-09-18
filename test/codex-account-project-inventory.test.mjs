import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {readLegacyAccountRequest,readLegacyAccountInventory} from '../lib/codex-account-project-inventory.mjs';
import {accountRouteForLegacyRequest} from '../lib/codex-account-runtime-routing.mjs';
import {CodexAccountLegacyWork} from '../lib/codex-account-legacy-work.mjs';
import {CodexAccounts} from '../lib/codex-accounts.mjs';
import {researchSave} from '../lib/research-budget.mjs';
async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-old-project-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const project=path.join(root,'project'),mailbox=path.join(project,'.clawdad/mailbox'),history=path.join(project,'.clawdad/history');
  const record={requestId:'existing',projectPath:project,sessionId:'exact-session',provider:'codex',message:'Approved synthetic 🌿',
    sentAt:'2026-09-16T00:00:00Z',scheduleMode:'queue',status:'queued'};
  const file=path.join(history,'sessions/exact-session/record.json'),item=path.join(mailbox,'queued/item.json');
  await researchSave(file,record);await researchSave(path.join(history,'requests/existing.json'),{requestId:'existing',sessionId:'exact-session',file,sentAt:record.sentAt});
  await researchSave(item,{state:'queued',requestId:'existing',projectPath:project});
  return {root,project,record,file,item,mailbox,history,projects:[{path:project}]};
}
test('old queued work retains one immutable request through progress and completion, without storing its message in the account journal',async t=>{
  const f=await fixture(t),first=await readLegacyAccountInventory(f.projects);assert.equal(first.complete,true);assert.equal(first.jobs.length,1);
  await researchSave(f.file,{...f.record,status:'running',response:'partial'});
  const second=await readLegacyAccountInventory(f.projects);assert.equal(first.jobs[0].fingerprint,second.jobs[0].fingerprint);
  await fs.unlink(f.item);await researchSave(f.file,{...f.record,status:'answered',response:'done'});
  const done=await readLegacyAccountInventory(f.projects,{known:first.jobs});assert.equal(done.complete,true);assert.equal(done.jobs[0].status,'completed');
  assert.equal(done.jobs[0].fingerprint,first.jobs[0].fingerprint);assert.ok(!JSON.stringify(done).includes(f.record.message));
});
test('changed identity, escaped histories and missing retained receipts keep inventory incomplete',async t=>{
  const f=await fixture(t),known=(await readLegacyAccountInventory(f.projects)).jobs;
  await researchSave(f.file,{...f.record,sessionId:'wrong'});assert.equal((await readLegacyAccountInventory(f.projects)).complete,false);
  await researchSave(path.join(f.history,'requests/existing.json'),{requestId:'existing',sessionId:'exact-session',file:path.join(f.root,'outside.json')});
  await assert.rejects(readLegacyAccountRequest(f.project,'existing'),/outside/);
  await fs.unlink(path.join(f.history,'requests/existing.json'));assert.equal((await readLegacyAccountInventory(f.projects,{known})).complete,false);
});
test('a pre-ledger accepted queue drains on the original epoch and settles after service reconstruction',async t=>{
  const f=await fixture(t);let work;
  const options={root:path.join(f.root,'accounts'),adapter:{capabilities:{ready:true}},
    usage:{snapshot:async()=>({}),freshReading:async()=>({accountKey:'a'})},readWork:()=>work.snapshot(),inspectConsumers:async()=>({complete:true,consumers:[]})};
  const accounts=new CodexAccounts(options);
  work=new CodexAccountLegacyWork({root:path.join(options.root,'ProjectWork'),accounts,readProjects:async()=>f.projects});
  const target=(await accounts.add({email:'fixture@example.test',requestId:'entry',expectedRevision:0})).account;
  await accounts.request({accountId:target.id,requestId:'switch',expectedRevision:1,confirmed:true});
  assert.equal((await accounts.workDrain()).ready,false);
  const route=await accountRouteForLegacyRequest({accounts,requestId:'existing',projectPath:f.project});assert.equal(route.receipt.id,'existing');
  const before=JSON.parse(await fs.readFile(accounts.file));assert.equal(before.work.existing.legacyImported,true);assert.ok(!JSON.stringify(before).includes(f.record.message));
  await fs.unlink(f.item);await researchSave(f.file,{...f.record,status:'completed'});
  const restored=new CodexAccounts(options);assert.equal((await restored.workDrain()).ready,true);
  await assert.rejects(accountRouteForLegacyRequest({accounts:restored,requestId:'existing',projectPath:f.project}),/holding new work/);
});
test('a native legacy worker reserves unregistered accepted work before launch and cannot duplicate it',async t=>{
  const f=await fixture(t),accounts=new CodexAccounts({root:path.join(f.root,'accounts')});
  const route=await accountRouteForLegacyRequest({accounts,requestId:'existing',projectPath:f.project});
  assert.equal(route.receipt.id,'existing');
  const saved=JSON.parse(await fs.readFile(path.join(accounts.root,'ProjectWork/existing.json')));
  assert.equal(saved.effectPrepared,true);assert.equal(saved.accountEpoch,0);
  const ledger=new CodexAccountLegacyWork({root:path.join(accounts.root,'ProjectWork'),accounts});
  await assert.rejects(ledger.reserve(await readLegacyAccountRequest(f.project,'existing')),/already has a receipt/);
});
