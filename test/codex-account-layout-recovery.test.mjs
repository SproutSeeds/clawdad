import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CodexAccountLayoutRecovery} from '../lib/codex-account-layout-recovery.mjs';
import {claimAccountProfile} from '../lib/codex-account-profile-guard.mjs';

async function fixture(t,options={}){
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-adoption-')),root=await fs.realpath(temporary);
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const canonicalHome=path.join(root,'canonical'),profileHome=path.join(root,'authorization'),journal=path.join(root,'journal');
  for(const directory of [canonicalHome,profileHome,journal])await fs.mkdir(directory,{mode:0o700});
  for(const name of ['sessions','archived_sessions','thread-writer-locks','skills','plugins'])await fs.mkdir(path.join(canonicalHome,name),{mode:0o700});
  await fs.writeFile(path.join(canonicalHome,'config.toml'),'model="source"\n',{mode:0o600});
  await fs.mkdir(path.join(profileHome,'skills'),{mode:0o700});
  await fs.writeFile(path.join(profileHome,'skills','keep.txt'),'local custom skill 🌿\n',{mode:0o600});
  await fs.writeFile(path.join(profileHome,'config.toml'),'private CONFIG_VALUE_MARKER\n',{mode:0o600});
  await fs.writeFile(path.join(profileHome,'auth.json'),'CREDENTIAL_MARKER',{mode:0o600});
  await fs.writeFile(path.join(profileHome,'models_cache.json'),'keep cache',{mode:0o600});
  await fs.writeFile(path.join(root,'manual-snapshot.json'),'unchanged named setup');
  const input={canonicalHome,profileHome},settings={root:journal,assertInactive:async home=>({home,complete:true,owners:[],observedAt:Date.now()}),...options};
  const recovery=new CodexAccountLayoutRecovery(settings),selection=await recovery.inspect(input);
  const args={input,requestId:'adopt-one',expectedFingerprint:selection.fingerprint,confirmed:true};
  return {root,journal,canonicalHome,profileHome,input,settings,recovery,selection,args};
}
test('adoption preserves original resources in a private recovery record and shares only canonical work resources',async t=>{
  const f=await fixture(t),originalAuth=await fs.stat(path.join(f.profileHome,'auth.json'));
  const result=await f.recovery.adopt(f.args);
  assert.equal(result.state,'verified');assert.equal(await fs.realpath(path.join(f.profileHome,'skills')),path.join(f.canonicalHome,'skills'));
  const journal=await f.recovery.journal(f.profileHome);
  assert.equal(await fs.readFile(path.join(journal.directory,'preserved/skills/keep.txt'),'utf8'),'local custom skill 🌿\n');
  assert.equal(await fs.readFile(path.join(journal.directory,'preserved/config.toml'),'utf8'),'private CONFIG_VALUE_MARKER\n');
  assert.equal((await fs.stat(path.join(f.profileHome,'auth.json'))).ino,originalAuth.ino);
  assert.equal(await fs.readFile(path.join(f.profileHome,'models_cache.json'),'utf8'),'keep cache');
  assert.equal(await fs.readFile(path.join(f.root,'manual-snapshot.json'),'utf8'),'unchanged named setup');
  assert.ok(!JSON.stringify(result).includes('CONFIG_VALUE_MARKER'));assert.ok(!JSON.stringify(result).includes('CREDENTIAL_MARKER'));
  assert.equal((await fs.stat(journal.directory)).mode&0o777,0o700);
  const restored=await f.recovery.rollback({profileHome:f.profileHome,requestId:'rollback',expectedFingerprint:f.selection.fingerprint,confirmed:true});
  assert.equal(restored.state,'rolled_back');assert.equal(await fs.readFile(path.join(f.profileHome,'skills/keep.txt'),'utf8'),'local custom skill 🌿\n');
  await assert.rejects(fs.lstat(path.join(f.profileHome,'sessions')),{code:'ENOENT'});
  assert.equal(await fs.readFile(path.join(f.profileHome,'auth.json'),'utf8'),'CREDENTIAL_MARKER');
});
test('a link to earlier synthetic history is retained as a link and is restored without copying or traversing history',async t=>{
  const f=await fixture(t),old=path.join(f.root,'synthetic-history');await fs.mkdir(old,{mode:0o700});
  await fs.writeFile(path.join(old,'history.jsonl'),'exact local history');await fs.symlink(old,path.join(f.profileHome,'sessions'));
  const selection=await f.recovery.inspect(f.input);await f.recovery.adopt({...f.args,expectedFingerprint:selection.fingerprint});
  assert.equal(await fs.readFile(path.join(old,'history.jsonl'),'utf8'),'exact local history');
  await f.recovery.rollback({profileHome:f.profileHome,requestId:'rollback',expectedFingerprint:selection.fingerprint,confirmed:true});
  assert.equal(await fs.readlink(path.join(f.profileHome,'sessions')),old);
});
test('concurrent requests and a lost reply converge on the original adoption without duplicate preservation',async t=>{
  const f=await fixture(t),other=new CodexAccountLayoutRecovery(f.settings);
  const [a,b]=await Promise.all([f.recovery.adopt(f.args),other.adopt({...f.args,requestId:'another-click'})]);
  assert.equal(a.layout.plan.fingerprint,b.layout.plan.fingerprint);
  const again=await new CodexAccountLayoutRecovery(f.settings).adopt(f.args);
  assert.equal(again.state,'verified');assert.deepEqual(again.requests.toSorted(),['adopt-one','another-click']);
  const location=await f.recovery.journal(f.profileHome);assert.deepEqual((await fs.readdir(path.join(location.directory,'preserved'))).sort(),['config.toml','skills']);
});
test('crash after preservation or linking reconciles actual inode/content before continuing',async t=>{
  for(const stop of ['preserved','linked']){
    let failed=false;const f=await fixture(t,{onStep:async stage=>{if(stage===stop&&!failed){failed=true;throw Error('simulated interruption');}}});
    await assert.rejects(f.recovery.adopt(f.args),/simulated interruption/);
    const resumed=new CodexAccountLayoutRecovery({...f.settings,onStep:async()=>{}});
    assert.equal((await resumed.adopt(f.args)).state,'verified');
    const location=await resumed.journal(f.profileHome);assert.equal(await fs.readFile(path.join(location.directory,'preserved/skills/keep.txt'),'utf8'),'local custom skill 🌿\n');
  }
});
test('active, stale or incomplete activity proof never permits moving profile resources',async t=>{
  for(const proof of [null,{complete:false,owners:[]},{complete:true,owners:[{pid:42}]},{complete:true,owners:[],observedAt:1}]){
    const f=await fixture(t,{assertInactive:async home=>({...proof,home,observedAt:proof?.observedAt??Date.now()})});
    await assert.rejects(f.recovery.adopt(f.args),{code:'profile_in_use'});
    assert.equal(await fs.readFile(path.join(f.profileHome,'skills/keep.txt'),'utf8'),'local custom skill 🌿\n');
  }
});
test('authorization, stale review and foreign write permissions block adoption while unrelated files do not',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.recovery.adopt({...f.args,confirmed:false}),{code:'layout_authorization_required'});
  await fs.writeFile(path.join(f.profileHome,'skills/keep.txt'),'user correction');
  await assert.rejects(f.recovery.adopt(f.args),{code:'profile_resource_changed'});
  assert.equal(await fs.readFile(path.join(f.profileHome,'skills/keep.txt'),'utf8'),'user correction');
  await fs.chmod(path.join(f.profileHome,'skills'),0o777);
  await assert.rejects(f.recovery.inspect(f.input),{code:'unsafe_profile_resource'});
  const g=await fixture(t,{onStep:async stage=>{if(stage==='preserved')await fs.writeFile(path.join(g.canonicalHome,'different'),'different');}});
  // In-place additions to an unrelated canonical file do not affect selected work resources.
  assert.equal((await g.recovery.adopt(g.args)).state,'verified');
});
test('changed canonical resource is preserved as a recoverable partial adoption',async t=>{
  let changed=false;
  const f=await fixture(t,{onStep:async stage=>{if(stage==='preserved'&&!changed){changed=true;
    await fs.rename(path.join(f.canonicalHome,'config.toml'),path.join(f.canonicalHome,'old-config'));
    await fs.writeFile(path.join(f.canonicalHome,'config.toml'),'new source',{mode:0o600});
  }}});
  await assert.rejects(f.recovery.adopt(f.args),{code:'canonical_layout_changed'});
  assert.equal(await fs.readFile(path.join(f.canonicalHome,'config.toml'),'utf8'),'new source');
  assert.equal((await f.recovery.rollback({profileHome:f.profileHome,requestId:'recover',expectedFingerprint:f.selection.fingerprint,confirmed:true})).state,'rolled_back');
  assert.equal(await fs.readFile(path.join(f.profileHome,'skills/keep.txt'),'utf8'),'local custom skill 🌿\n');
});
test('corrupt receipt, traversal, symlinked recovery and mismatched profile are rejected before restoring paths',async t=>{
  const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  for(const mode of ['hash','traversal','profile','backup-link']){
    const f=await fixture(t);await f.recovery.adopt(f.args);const location=await f.recovery.journal(f.profileHome);
    if(mode==='backup-link'){
      await fs.rename(path.join(location.directory,'preserved'),path.join(location.directory,'old-preserved'));
      await fs.symlink(path.join(location.directory,'old-preserved'),path.join(location.directory,'preserved'));
    }else{
      const record=JSON.parse(await fs.readFile(location.file,'utf8'));
      if(mode==='hash')record.selection.fingerprint='0'.repeat(64);
      if(mode==='profile')record.selection.plan.profileHome=f.canonicalHome;
      if(mode==='traversal'){
        record.selection.displaced[0].name='../untouched';
        const {fingerprint,...selection}=record.selection;record.selection.fingerprint=digest(selection);
      }
      await fs.writeFile(location.file,JSON.stringify(record));
    }
    await assert.rejects(f.recovery.rollback({profileHome:f.profileHome,requestId:'recover',expectedFingerprint:f.selection.fingerprint,confirmed:true}),mode==='backup-link'?/private, local/:{code:'adoption_receipt_invalid'});
    assert.equal(await fs.readlink(path.join(f.profileHome,'config.toml')),path.join(f.canonicalHome,'config.toml'));
    assert.equal(await fs.readFile(path.join(f.root,'manual-snapshot.json'),'utf8'),'unchanged named setup');
  }
});
test('launch gate serializes migration with managed startup and requires a fresh inactive observation after waiting',async t=>{
  const f=await fixture(t),gate=await claimAccountProfile(f.profileHome);let settled=false;
  const migrating=f.recovery.adopt(f.args).then(value=>{settled=true;return value;});
  await new Promise(resolve=>setTimeout(resolve,70));assert.equal(settled,false);
  assert.equal(await fs.readFile(path.join(f.profileHome,'skills/keep.txt'),'utf8'),'local custom skill 🌿\n');
  await gate.release();assert.equal((await migrating).state,'verified');
  const g=await fixture(t),launch=await claimAccountProfile(g.profileHome);
  g.recovery.assertInactive=async home=>({home,complete:true,owners:[{pid:42}],observedAt:Date.now()});
  const rejected=g.recovery.adopt(g.args);await launch.release();await assert.rejects(rejected,{code:'profile_in_use'});
});
test('changed preserved content and substituted post-adoption paths block rollback without overwriting either copy',async t=>{
  const f=await fixture(t);await f.recovery.adopt(f.args);const location=await f.recovery.journal(f.profileHome);
  await fs.writeFile(path.join(location.directory,'preserved/skills/keep.txt'),'changed recovery');
  await assert.rejects(f.recovery.rollback({profileHome:f.profileHome,requestId:'recover',expectedFingerprint:f.selection.fingerprint,confirmed:true}),{code:'preserved_resource_changed'});
  assert.equal(await fs.readlink(path.join(f.profileHome,'skills')),path.join(f.canonicalHome,'skills'));
  const g=await fixture(t);await g.recovery.adopt(g.args);
  await fs.unlink(path.join(g.profileHome,'config.toml'));await fs.writeFile(path.join(g.profileHome,'config.toml'),'new user config');
  await assert.rejects(g.recovery.rollback({profileHome:g.profileHome,requestId:'recover',expectedFingerprint:g.selection.fingerprint,confirmed:true}),{code:'rollback_resource_changed'});
  assert.equal(await fs.readFile(path.join(g.profileHome,'config.toml'),'utf8'),'new user config');
});
test('rollback can resume after an interruption and preserves pre-existing correct links',async t=>{
  const f=await fixture(t);await fs.symlink(path.join(f.canonicalHome,'sessions'),path.join(f.profileHome,'sessions'));
  const selection=await f.recovery.inspect(f.input),args={...f.args,expectedFingerprint:selection.fingerprint};
  await f.recovery.adopt(args);let failed=false;
  const interrupted=new CodexAccountLayoutRecovery({...f.settings,onStep:async stage=>{if(stage==='restored'&&!failed){failed=true;throw Error('crash in recovery');}}});
  const back={profileHome:f.profileHome,requestId:'rollback',expectedFingerprint:selection.fingerprint,confirmed:true};
  await assert.rejects(interrupted.rollback(back),/crash in recovery/);
  await assert.rejects(f.recovery.adopt(args),{code:'adoption_was_rolled_back'});
  assert.equal((await new CodexAccountLayoutRecovery(f.settings).rollback(back)).state,'rolled_back');
  assert.equal(await fs.readlink(path.join(f.profileHome,'sessions')),path.join(f.canonicalHome,'sessions'));
  assert.equal(await fs.readFile(path.join(f.profileHome,'skills/keep.txt'),'utf8'),'local custom skill 🌿\n');
  assert.equal((await f.recovery.rollback(back)).state,'rolled_back');
});
test('canonical links into a profile cannot be adopted into a cyclic layout',async t=>{
  const f=await fixture(t);await fs.rmdir(path.join(f.canonicalHome,'skills'));await fs.symlink(path.join(f.profileHome,'skills'),path.join(f.canonicalHome,'skills'));
  await assert.rejects(f.recovery.inspect(f.input),{code:'cyclic_runtime_resource'});
});
