// Explicit, disposable TUI test. Projects and global account preference are
// untouched. Only the selected-profile projection is injected; admission,
// durable launch receipt, exact execve and actual CLI all use production code.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {CodexAccounts} from '../../lib/codex-accounts.mjs';
import {CodexAccountProfileProcess} from '../../lib/codex-account-profile-process.mjs';
import {CodexManagedLogin} from '../../lib/codex-managed-login.mjs';
import {selectedCodexLaunch} from '../../lib/codex-account-launch.mjs';
import {launchSelectedCodex} from '../../lib/codex-account-shell-launch.mjs';
import {researchSave} from '../../lib/research-budget.mjs';

const [profile,name,separator,...args]=process.argv.slice(2);
if(!['cody','sun'].includes(profile)||!/^tui-status-[a-z0-9-]+$/.test(name||'')||separator!=='--')throw Error('Use the approved disposable account TUI fixture.');
const base=path.join(os.homedir(),'Library/Application Support/ClawDad/Accounts/verification-2026-09-15');
const fixture=path.join(base,'thread-continuity-1'),folder=path.join(fixture,name),project=path.join(fixture,'project');
const evidence=JSON.parse(await fs.readFile(path.join(fixture,'evidence.json'),'utf8'));
if(args[0]!=='resume'||args[1]!==evidence.sourceThreadId||process.cwd()!==project||evidence.project!==project)throw Error('The exact synthetic thread and directory are required.');
const root=path.join(folder,'launcher-journal');await fs.mkdir(root,{mode:0o700});
const home=path.join(base,profile),binary='/opt/homebrew/bin/codex',connection=new CodexAccountProfileProcess({home,binary});
let identity;
try{await connection.connect();identity=await new CodexManagedLogin({rpc:(...values)=>connection.request(...values)}).identity(profile==='cody'?'codyshanemitchell@gmail.com':'playinthesunwithme@gmail.com');}
finally{connection.close();}
const accounts=new CodexAccounts({root});
accounts.selectedLaunch=async()=>selectedCodexLaunch({verified:true,layoutVerified:true,method:'chatgpt',operationId:name,accountId:profile,
  accountKey:identity.accountKey,authorizationHome:home,sqliteHome:path.join(fixture,'index')});
await researchSave(path.join(folder,'launcher-evidence.json'),{profile,email:identity.subscription.email,accountKey:identity.accountKey,
  pid:process.pid,modelPrompts:0,globalSelectionChanged:false,sourceModule:fileURLToPath(new URL('../../lib/codex-account-shell-launch.mjs',import.meta.url)),startedAt:new Date().toISOString()});
await launchSelectedCodex({binary,args,root,accounts,id:name});
