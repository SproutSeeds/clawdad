import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';
import {acquireCodexAccountClaim} from '../lib/codex-account-claim.mjs';
import {codexDeliveryClaimKey} from '../lib/codex-delivery-claim.mjs';
import {CodexAccounts} from '../lib/codex-accounts.mjs';
async function fixture(t){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-account-lock-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
const identity={threadId:'account-switch-journal',requestId:'journal',timeoutMs:300};
test('published account owner is complete before another contender can observe it; exclusion and release remain exact',async t=>{
  const root=await fixture(t),first=await acquireCodexAccountClaim(root,identity);
  const owner=JSON.parse(await fs.readFile(first.ownerFile,'utf8'));assert.equal(owner.pid,process.pid);assert.equal(owner.threadId,identity.threadId);
  await assert.rejects(acquireCodexAccountClaim(root,{...identity,timeoutMs:50}),{code:'CLAWDAD_CODEX_DELIVERY_CLAIM_TIMEOUT'});
  assert.equal(await first.release(),true);const next=await acquireCodexAccountClaim(root,identity);await next.release();
});
test('a child exiting after publication leaves a verifiable dead owner recoverable without a new account action',async t=>{
  const root=await fixture(t),module=new URL('../lib/codex-account-claim.mjs',import.meta.url).href;
  const child=spawn(process.execPath,['--input-type=module','-e',`import {acquireCodexAccountClaim} from ${JSON.stringify(module)};await acquireCodexAccountClaim(${JSON.stringify(root)},${JSON.stringify(identity)});process.exit(0);`],{stdio:'ignore'});
  await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('fixture exit '+code)));});
  const claim=await acquireCodexAccountClaim(root,identity);assert.equal(claim.mode,'recovered');await claim.release();
});
test('incomplete unpublished staging cannot obstruct a claim; malformed published claims remain protected',async t=>{
  const root=await fixture(t),key=codexDeliveryClaimKey(identity.threadId,identity.requestId),dir=path.join(root,'.clawdad/mailbox/delivery-claims');
  const orphan=path.join(dir,'.'+key+'.prepare-fixture');await fs.mkdir(orphan,{recursive:true});await fs.writeFile(path.join(orphan,'owner.json'),'');
  const claim=await acquireCodexAccountClaim(root,identity);await claim.release();
  assert.equal(await fs.readFile(path.join(orphan,'owner.json'),'utf8'),'');
  const broken=path.join(dir,key);await fs.mkdir(broken);await fs.writeFile(path.join(broken,'owner.json'),'');
  await assert.rejects(acquireCodexAccountClaim(root,{...identity,timeoutMs:30}),{code:'CLAWDAD_CODEX_DELIVERY_CLAIM_TIMEOUT'});
  assert.equal(await fs.readFile(path.join(broken,'owner.json'),'utf8'),'');
});
test('an unselected runtime route read creates no lock or account storage',async t=>{
  const parent=await fixture(t),root=path.join(parent,'absent');
  const accounts=new CodexAccounts({root,lease:async()=>{assert.fail('Pure route read must not acquire a claim');}});
  assert.equal(await accounts.selectedLaunch(),null);await assert.rejects(fs.stat(root),{code:'ENOENT'});
});
