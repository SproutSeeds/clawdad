import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {researchSave} from './research-budget.mjs';
import {privateAccountDirectory} from './codex-account-profile-process.mjs';

const begin='# BEGIN CLAWDAD SELECTED CODEX ACCOUNT';
const end='# END CLAWDAD SELECTED CODEX ACCOUNT';
const sha=value=>createHash('sha256').update(value).digest('hex');
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const legacyFunction=/codex\(\)\s*\{\s*\/opt\/homebrew\/bin\/codex -c features\.code_mode_host=true "\$@"\s*\}/;

export function accountShellScript({node,entry,binary,prefixArgs=[]}){
  for(const p of [node,entry,binary])if(!path.isAbsolute(p)||/[\x00-\x1f\x7f]/.test(p))throw Error('Use absolute launcher paths.');
  if(prefixArgs.some(v=>typeof v!=='string'||/[\x00-\x1f\x7f]/.test(v)))throw Error('Invalid preserved CLI options.');
  return `# ClawDad subscription preference for new interactive shells.\n# Existing agent processes and the original CLI installation stay unchanged.\ncodex() {\n  if [[ ! -x ${quote(node)} || ! -f ${quote(entry)} ]]; then\n    print -u2 'ClawDad needs its account-launcher update. Open ClawDad or deliberately use command codex for the original CLI.'\n    return 127\n  fi\n  command ${quote(node)} --disable-warning=ExperimentalWarning ${quote(entry)} ${quote(binary)} -- ${prefixArgs.map(quote).join(' ')} "$@"\n}\n`;
}

async function readOwned(file,{missing=false}={}){
  try{const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||s.mode&0o022||s.size>1024*1024)throw Error();
    return {text:await fs.readFile(file,'utf8'),mode:s.mode&0o777};
  }catch(e){if(missing&&e.code==='ENOENT')return {text:'',mode:0o600};throw Error('Preserve and review the shell configuration before installing the launcher.');}
}
function splitManaged(text){
  const starts=text.split(begin).length-1,ends=text.split(end).length-1;
  if(starts!==ends||starts>1)throw Error('The existing ClawDad shell block needs review.');
  if(!starts)return {before:text,block:'',after:''};
  const a=text.indexOf(begin),b=text.indexOf(end,a)+end.length;
  if(b<a||a>0&&text[a-1]!=='\n')throw Error('The shell integration markers changed.');
  return {before:text.slice(0,a),block:text.slice(a,b),after:text.slice(b)};
}
async function replaceExact(file,expected,next,mode){
  if((await readOwned(file,{missing:true})).text!==expected)throw Error('The shell configuration changed during installation; your edits were preserved.');
  const temp=file+'.clawdad-'+randomUUID();
  const h=await fs.open(temp,'wx',mode);try{await h.writeFile(next);await h.sync();}finally{await h.close();}
  try{
    if((await readOwned(file,{missing:true})).text!==expected)throw Error('The shell configuration changed; inspect the preserved backup.');
    await fs.rename(temp,file);const d=await fs.open(path.dirname(file),'r');try{await d.sync();}finally{await d.close();}
  }finally{await fs.rm(temp,{force:true});}
}
async function durableBackup(file,text){
  const handle=await fs.open(file,'wx',0o600);
  try{await handle.writeFile(text);await handle.sync();}finally{await handle.close();}
  const directory=await fs.open(path.dirname(file),'r');try{await directory.sync();}finally{await directory.close();}
}

export async function installAccountShellLauncher({home=os.homedir(),root=path.join(home,'Library/Application Support/ClawDad/Accounts/Shell'),
  shellFile=path.join(home,'.zshrc'),app='/Applications/ClawDad.app',binary='/opt/homebrew/bin/codex'}={}){
  const node=path.join(app,'Contents/Resources/runtime/bin/node'),entry=path.join(app,'Contents/Resources/runtime/bin/clawdad-codex');
  for(const file of [node,entry,binary])await fs.access(file);
  if(process.env.ZDOTDIR&&path.resolve(process.env.ZDOTDIR)!==path.resolve(home))throw Error('This shell uses a custom ZDOTDIR. Choose its startup file explicitly before installing.');
  const original=await readOwned(shellFile,{missing:true}),parts=splitManaged(original.text);
  const unowned=parts.before+parts.after;
  const definitions=unowned.match(/(?:^|\n)\s*(?:function\s+codex\b|codex\s*\(\)|alias\s+codex=)/g)||[];
  if(definitions.length&&(definitions.length!==1||!legacyFunction.test(unowned)))throw Error('An existing custom codex alias or function needs review; it has been preserved.');
  const prefixArgs=legacyFunction.test(unowned)?['-c','features.code_mode_host=true']:[];
  const script=accountShellScript({node,entry,binary,prefixArgs});
  await privateAccountDirectory(root);const scriptFile=path.join(root,'codex.zsh'),recordFile=path.join(root,'installation.json');
  const block=`${begin}\nsource ${quote(scriptFile)}\n${end}`;
  let record;try{record=JSON.parse((await readOwned(recordFile)).text);}catch(e){if(parts.block)throw e;}
  if(parts.block){
    if(!record||record.version!==1||record.shellFile!==shellFile||parts.block!==record.block||sha((await readOwned(scriptFile)).text)!==record.scriptSHA256)
      throw Error('The installed launcher changed; preserve it for review.');
    if(parts.block===block&&record.scriptSHA256===sha(script)){
      if(record.state==='prepared')await researchSave(recordFile,{...record,state:'installed'});
      return {installed:true,alreadyInstalled:true,shellFile,scriptFile,backup:record.backup};
    }
  }
  const backup=path.join(root,'zshrc-before-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.txt');
  await durableBackup(backup,original.text);
  const next=parts.block?parts.before+block+parts.after:original.text+(original.text.endsWith('\n')||!original.text?'':'\n')+block+'\n';
  const nextRecord={version:1,shellFile,scriptFile,block,scriptSHA256:sha(script),beforeSHA256:sha(original.text),afterSHA256:sha(next),backup,
    separatorAdded:parts.block?record.separatorAdded:!!original.text&&!original.text.endsWith('\n'),separatorBeforeSHA256:parts.block?record.separatorBeforeSHA256:sha(original.text),
    preservedPrefixArgs:prefixArgs,binary,installedAt:new Date().toISOString(),state:'prepared'};
  await researchSave(recordFile,nextRecord);
  const oldScript=await readOwned(scriptFile,{missing:true});await replaceExact(scriptFile,oldScript.text,script,0o600);
  await replaceExact(shellFile,original.text,next,original.mode);
  await researchSave(recordFile,{...nextRecord,state:'installed'});
  return {installed:true,alreadyInstalled:false,shellFile,scriptFile,backup};
}

export async function removeAccountShellLauncher({home=os.homedir(),root=path.join(home,'Library/Application Support/ClawDad/Accounts/Shell')}={}){
  const recordFile=path.join(root,'installation.json'),r=JSON.parse((await readOwned(recordFile)).text);
  if(r.version!==1||r.shellFile!==path.join(home,'.zshrc')||r.scriptFile!==path.join(root,'codex.zsh'))throw Error('The original shell installation needs review.');
  const original=await readOwned(r.shellFile),parts=splitManaged(original.text);
  if(parts.block!==r.block)throw Error('The shell integration changed; preserve it for review.');
  const backup=path.join(root,'zshrc-before-removal-'+randomUUID()+'.txt');await durableBackup(backup,original.text);
  let before=parts.before;
  if(r.separatorAdded&&before.endsWith('\n')&&sha(before.slice(0,-1))===r.separatorBeforeSHA256)before=before.slice(0,-1);
  await replaceExact(r.shellFile,original.text,before+parts.after.replace(/^\n/,''),original.mode);
  await researchSave(recordFile,{...r,state:'removed',removedAt:new Date().toISOString(),removalBackup:backup});return {removed:true,backup};
}
