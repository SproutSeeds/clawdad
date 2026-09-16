import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CodexAccountLayout,inspectCodexAccountLayout,accountRuntimeLaunchOptions,compareAccountRuntimeConfiguration} from '../lib/codex-account-layout.mjs';

async function fixture(t){
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-account-layout-'));
  const root=await fs.realpath(temporary);t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const canonicalHome=path.join(root,'history'),profileHome=path.join(root,'authorization');
  for(const directory of [canonicalHome,profileHome])await fs.mkdir(directory,{mode:0o700});
  for(const name of ['sessions','archived_sessions','thread-writer-locks','skills','rules','hooks'])await fs.mkdir(path.join(canonicalHome,name),{mode:0o700});
  await fs.writeFile(path.join(canonicalHome,'config.toml'),'model = "gpt-6-astra"\n',{mode:0o600});
  await fs.writeFile(path.join(canonicalHome,'auth.json'),'DO_NOT_COPY_PRIVATE_FIXTURE',{mode:0o600});
  const input={canonicalHome,profileHome},layout=new CodexAccountLayout({root});
  return {root,input,layout,canonicalHome,profileHome};
}
test('runtime layout keeps latest history and exact writer locks while leaving credentials and caches separate',async t=>{
  const f=await fixture(t),before=await fs.readdir(f.profileHome);
  const plan=await inspectCodexAccountLayout(f.input);assert.deepEqual(await fs.readdir(f.profileHome),before);
  const receipt=await f.layout.prepare(f.input);assert.equal(receipt.state,'verified');
  assert.equal((await f.layout.verify(receipt)).fingerprint,plan.fingerprint);
  for(const name of ['sessions','archived_sessions','thread-writer-locks','config.toml','skills','rules','hooks'])
    assert.equal(await fs.realpath(path.join(f.profileHome,name)),path.join(f.canonicalHome,name));
  await fs.writeFile(path.join(f.canonicalHome,'sessions','later.jsonl'),'latest 🌿\n');
  assert.equal(await fs.readFile(path.join(f.profileHome,'sessions','later.jsonl'),'utf8'),'latest 🌿\n');
  await fs.writeFile(path.join(f.canonicalHome,'thread-writer-locks','one.lock'),'owner');
  await assert.rejects(fs.open(path.join(f.profileHome,'thread-writer-locks','one.lock'),'wx'),{code:'EEXIST'});
  for(const name of ['auth.json','models_cache.json','app-server-control','installation_id'])
    await assert.rejects(fs.lstat(path.join(f.profileHome,name)),{code:'ENOENT'});
  assert.ok(!JSON.stringify(receipt).includes('DO_NOT_COPY_PRIVATE_FIXTURE'));
});
test('independent history or configuration in a retained home is preserved before any adoption',async t=>{
  for(const name of ['sessions','config.toml','AGENTS.md']){
    const f=await fixture(t);await fs.writeFile(path.join(f.profileHome,name),'keep this');
    await assert.rejects(f.layout.prepare(f.input),{code:'profile_resource_conflict'});
    assert.deepEqual(await fs.readdir(f.profileHome),[name]);assert.equal(await fs.readFile(path.join(f.profileHome,name),'utf8'),'keep this');
  }
});
test('concurrent layout requests and restart after a partially applied layout converge without overwriting resources',async t=>{
  const f=await fixture(t),other=new CodexAccountLayout({root:f.root});
  const [a,b]=await Promise.all([f.layout.prepare(f.input),other.prepare(f.input)]);
  assert.deepEqual(a.plan,b.plan);
  // Simulate crash/missing link only inside the fixture, preserving the journal.
  await fs.unlink(path.join(f.profileHome,'skills'));
  await assert.rejects(other.verify(a),{code:'layout_incomplete'});
  assert.equal((await other.prepare(f.input)).state,'verified');
  assert.equal(await fs.realpath(path.join(f.profileHome,'skills')),path.join(f.canonicalHome,'skills'));
});
test('changed canonical files, missing external state and substituted links block launch with recoverable receipts',async t=>{
  const f=await fixture(t),receipt=await f.layout.prepare(f.input);
  await fs.writeFile(path.join(f.canonicalHome,'replacement'),'model="different"');
  await fs.rename(path.join(f.canonicalHome,'replacement'),path.join(f.canonicalHome,'config.toml'));
  await assert.rejects(f.layout.verify(receipt),{code:'layout_changed'});
  await assert.rejects(f.layout.prepare(f.input),{code:'layout_changed'});
  const g=await fixture(t),other=await g.layout.prepare(g.input);
  await fs.unlink(path.join(g.profileHome,'sessions'));await fs.symlink(g.root,path.join(g.profileHome,'sessions'));
  await assert.rejects(g.layout.verify(other),{code:'profile_resource_conflict'});
});
test('private ownership, missing history and overlapping homes are validated without creating directories',async t=>{
  const f=await fixture(t);await fs.chmod(f.profileHome,0o755);
  await assert.rejects(inspectCodexAccountLayout(f.input),{code:'unsafe_runtime_directory'});
  await fs.chmod(f.profileHome,0o700);
  await assert.rejects(inspectCodexAccountLayout({...f.input,profileHome:f.canonicalHome}),{code:'overlapping_runtime_homes'});
  await fs.rmdir(path.join(f.canonicalHome,'thread-writer-locks'));
  await assert.rejects(inspectCodexAccountLayout(f.input),{code:'missing_canonical_history'});
  assert.deepEqual(await fs.readdir(f.profileHome),[]);
});
test('effective configuration comparison preserves permissions, workspace policy, provider, tools and literal values',async t=>{
  const f=await fixture(t);await f.layout.prepare(f.input);
  const original={model:'gpt-6-astra',model_reasoning_effort:'high',sandbox_mode:'read-only',approval_policy:'never',
    forced_chatgpt_workspace_id:null,model_provider:'openai',cli_auth_credentials_store:'file',
    instructions:path.join(f.canonicalHome,'config.toml'),mcp_servers:{local:{command:'fixture',env:{SECRET:'private-test-value'}}}};
  const expected={...original,cli_auth_credentials_store:'keyring',instructions:path.join(f.profileHome,'config.toml')};
  const same=await compareAccountRuntimeConfiguration(original,expected);assert.equal(same.equivalent,true);
  for(const key of ['sandbox_mode','approval_policy','forced_chatgpt_workspace_id','model_provider','model_reasoning_effort','mcp_servers']){
    const changed=await compareAccountRuntimeConfiguration(original,{...expected,[key]:'changed'});
    assert.equal(changed.equivalent,false);assert.deepEqual(changed.changedFields,[key]);assert.ok(!JSON.stringify(changed).includes('private-test-value'));
  }
  assert.equal((await compareAccountRuntimeConfiguration({}, {new_permission:true})).equivalent,false);
  assert.equal(original.cli_auth_credentials_store,'file');
});
test('child launch uses the verified Keychain home and common index without changing parent environment or enabling API billing',async t=>{
  const f=await fixture(t),layout=await f.layout.prepare(f.input),env={PATH:'/fixture',CODEX_HOME:'/original'};
  const launch=accountRuntimeLaunchOptions({layout,baseEnvironment:env,arguments:['app-server','--stdio']});
  assert.equal(env.CODEX_HOME,'/original');assert.equal(launch.env.CODEX_HOME,f.profileHome);
  assert.ok(launch.arguments.includes('cli_auth_credentials_store="keyring"'));
  assert.ok(launch.arguments.includes('sqlite_home='+JSON.stringify(f.canonicalHome)));
  assert.throws(()=>accountRuntimeLaunchOptions({layout,baseEnvironment:{OPENAI_API_KEY:'do-not-log'}}),{code:'alternate_authentication_present'});
  assert.throws(()=>accountRuntimeLaunchOptions({layout:{state:'preparing'}}),{code:'layout_unverified'});
  for(const args of [['resume','fixture','--','old prompt'],['--remote','unix://other'],['--oss'],['--local-provider=ollama']])
    assert.throws(()=>accountRuntimeLaunchOptions({layout,arguments:args}),{code:'unsupported_launch_mode'});
});
