import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';
import {installAccountShellLauncher,removeAccountShellLauncher,accountShellScript} from '../lib/codex-account-shell-install.mjs';
async function fixture(t,text){
  const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-shell-install-')));t.after(()=>fs.rm(home,{recursive:true,force:true}));
  const root=path.join(home,'Accounts/Shell'),app=path.join(home,"app with ' spaces.app"),binary=path.join(home,'codex');
  const runtime=path.join(app,'Contents/Resources/runtime');await fs.mkdir(path.join(runtime,'bin'),{recursive:true});
  for(const f of [binary,path.join(runtime,'bin/node'),path.join(runtime,'bin/clawdad-codex')])await fs.writeFile(f,'',{mode:0o700});
  await fs.writeFile(path.join(home,'.zshrc'),text,{mode:0o600});return {home,root,app,binary};
}
test('install preserves the existing code-mode workaround, unrelated configuration and a private exact backup',async t=>{
  const original='# Other configuration\nexport SYNTHETIC_SETTING="keep"\ncodex() {\n  /opt/homebrew/bin/codex -c features.code_mode_host=true "$@"\n}\n';
  const f=await fixture(t,original),r=await installAccountShellLauncher(f);
  assert.equal(await fs.readFile(r.backup,'utf8'),original);assert.equal((await fs.stat(r.backup)).mode&0o777,0o600);
  assert.ok((await fs.readFile(path.join(f.home,'.zshrc'),'utf8')).startsWith(original));assert.ok((await fs.readFile(r.scriptFile,'utf8')).includes("'features.code_mode_host=true'"));
  execFileSync('/bin/zsh',['-n',r.scriptFile]);assert.equal((await installAccountShellLauncher(f)).alreadyInstalled,true);
  await fs.appendFile(path.join(f.home,'.zshrc'),'# Later manual addition\n');await removeAccountShellLauncher(f);
  assert.equal(await fs.readFile(path.join(f.home,'.zshrc'),'utf8'),original+'# Later manual addition\n');
});
test('uninstall restores exact original text without an original final newline',async t=>{
  const f=await fixture(t,'# no newline');await installAccountShellLauncher(f);await removeAccountShellLauncher(f);assert.equal(await fs.readFile(path.join(f.home,'.zshrc'),'utf8'),'# no newline');
});
test('unknown functions, edited managed scripts and malformed markers preserve user files',async t=>{
  const f=await fixture(t,'codex() { echo custom; }\n');await assert.rejects(installAccountShellLauncher(f),/custom/);assert.equal(await fs.readFile(path.join(f.home,'.zshrc'),'utf8'),'codex() { echo custom; }\n');
  await fs.writeFile(path.join(f.home,'.zshrc'),'# clean\n');const r=await installAccountShellLauncher(f);await fs.appendFile(r.scriptFile,'# user edit\n');await assert.rejects(installAccountShellLauncher(f),/changed/);
  await fs.appendFile(path.join(f.home,'.zshrc'),'# BEGIN CLAWDAD SELECTED CODEX ACCOUNT\n');await assert.rejects(installAccountShellLauncher(f),/markers|block/);
});
test('quoted paths and arguments are passed literally through the generated zsh function',async t=>{
  const f=await fixture(t,'# safe\n'),capture=path.join(f.home,'capture'),node=path.join(f.app,'Contents/Resources/runtime/bin/node');
  await fs.writeFile(node,'#!/bin/zsh\nprintf "%s\\0" "$@" > '+"'"+capture+"'"+'\n',{mode:0o700});
  const r=await installAccountShellLauncher(f),payload='quotes \' " $HOME `noexecute` 🌿\nsecond line';
  execFileSync('/bin/zsh',['-f','-c','source "$1"; codex "$2" "$3"','fixture',r.scriptFile,'-C',payload]);
  const args=(await fs.readFile(capture,'utf8')).split('\0').slice(0,-1);assert.deepEqual(args.slice(-2),['-C',payload]);assert.equal(args[0],'--disable-warning=ExperimentalWarning');assert.ok(args.includes(f.binary));
});
