import fs from 'node:fs/promises';
import path from 'node:path';
import {CodexAccountProfileProcess,privateAccountDirectory} from './codex-account-profile-process.mjs';
import {CodexManagedLogin} from './codex-managed-login.mjs';
import {CodexAccountLayout,compareAccountRuntimeConfiguration} from './codex-account-layout.mjs';
import {CodexAccountLayoutRecovery} from './codex-account-layout-recovery.mjs';
import {researchSave} from './research-budget.mjs';

// Profile adoption moves only enumerated work resources into recoverable local
// storage. Credential homes never move. Reading configuration cannot log in or
// submit work; destination identity uses a separate account-only connection.
export class CodexAccountSwitchProfiles {
  constructor({root,canonicalHome,binary,authorizations,runtime,permit,createProcess=options=>new CodexAccountProfileProcess(options)}={}){
    Object.assign(this,{root,canonicalHome,binary,authorizations,runtime,permit,createProcess});
    this.layout=new CodexAccountLayout({root});
  }
  file(id){if(!/^[A-Za-z0-9_.:-]{1,160}$/.test(id||''))throw Error('Invalid account operation');return path.join(this.root,'selected-'+id+'.json');}
  async saved(id){
    try{const file=this.file(id),stat=await fs.lstat(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||stat.mode&0o077||stat.size>2*1024*1024)throw Error();
      const value=JSON.parse(await fs.readFile(file,'utf8'));if(value.version!==1||value.operationId!==id)throw Error();return value;
    }catch(e){if(e.code==='ENOENT')return null;throw Error('The selected profile preparation receipt needs recovery.');}
  }
  async identities(){
    const snapshot=await this.authorizations.snapshot();
    return snapshot.profiles.filter(p=>p.authentication==='verified'&&p.subscription?.method==='chatgpt').map(p=>({
      email:p.email,accountKey:p.accountKey,method:'chatgpt',verified:true}));
  }
  async profile(accountId){
    const profile=(await this.authorizations.snapshot()).profiles.find(p=>p.accountId===accountId);
    return profile?{...profile,home:profile.home||path.join(this.authorizations.root,'profiles',accountId)}:null;
  }
  async check(home,email){
    const connection=this.createProcess({home,binary:this.binary});
    try{await connection.connect();return await new CodexManagedLogin({rpc:(...args)=>connection.request(...args)}).identity(email);}
    finally{connection.close();}
  }
  async configs(home,directories){
    const connection=this.createProcess({home,binary:this.binary,configurationOnly:true});
    try{await connection.connect();const results=[];
      for(const cwd of directories)results.push((await connection.request('config/read',{cwd,includeLayers:false})).config);
      return results;
    }finally{connection.close();}
  }
  async verifyModels(home,email,accountKey,entries){
    const selections=entries.flatMap(e=>[e.native,...(e.shared?.threads||[]).map(t=>t.settings)]).filter(v=>v?.model);
    if(!selections.length)return;
    const connection=this.createProcess({home,binary:this.binary}),models=[],seen=new Set();let cursor=null;
    try{
      await connection.connect();
      const login=new CodexManagedLogin({rpc:(...args)=>connection.request(...args)});
      if((await login.identity(email)).accountKey!==accountKey)throw Error('Selected model account changed.');
      do{
        const page=await connection.request('model/list',{cursor,limit:100,includeHidden:false});
        if(!Array.isArray(page?.data)||seen.size>=20)throw Error('The selected model catalog is incomplete.');
        models.push(...page.data);cursor=page.nextCursor||null;
        if(cursor&&seen.has(cursor))throw Error('The selected model catalog repeated a page.');if(cursor)seen.add(cursor);
      }while(cursor);
      for(const value of selections){
        const match=models.find(m=>m.model===value.model||m.id===value.model);
        if(!match)throw Object.assign(Error('The selected account does not offer a captured session model. Choose a compatible account or deliberately change that session model first.'),{code:'account_model_unavailable'});
        const efforts=(match.supportedReasoningEfforts||[]).map(e=>typeof e==='string'?e:e.reasoningEffort);
        if(!efforts.includes(value.reasoningEffort))throw Object.assign(Error('The selected account does not offer a captured reasoning setting. Preserve the current session and choose a supported setting.'),{code:'account_effort_unavailable'});
      }
      if((await login.identity(email)).accountKey!==accountKey)throw Error('Selected model account changed.');
    }finally{connection.close();}
  }
  async prepare({operation,target}){
    await this.permit({operationId:operation.id});await privateAccountDirectory(this.root);
    const profile=await this.profile(target.id);
    if(!profile||profile.authentication!=='verified')return {state:'waiting'};
    const identity=await this.check(profile.home,target.email);
    if(identity.accountKey!==profile.accountKey)throw Error('The selected saved sign-in changed its account identity.');
    await this.verifyModels(profile.home,target.email,identity.accountKey,operation.recovery.entries);
    // A live source using an independent history/configuration home cannot be
    // silently redirected into the canonical store. Require identical native
    // history/lock resources and compare configuration for every source home.
    const sourceHomes=[...new Set(operation.recovery.entries.map(e=>e.native?.authorizationHome||e.shared?.authorizationHome))];
    if(sourceHomes.some(home=>!home||!path.isAbsolute(home)))throw Error('A captured runtime has no verified authorization home.');
    for(const home of sourceHomes)for(const resource of ['sessions','archived_sessions','thread-writer-locks']){
      if(await fs.realpath(path.join(home,resource))!==await fs.realpath(path.join(this.canonicalHome,resource)))
        throw Error('A captured runtime uses independent conversation history or writer locks. Preserve it for review.');
    }
    const directories=[...new Set(operation.recovery.entries.flatMap(e=>[e.directory,...(e.shared?.threads||[]).map(t=>t.cwd)]).filter(Boolean))].sort();
    if(!directories.length)directories.push(this.canonicalHome);
    let record=await this.saved(operation.id);
    if(record&&(record.accountId!==target.id||record.accountKey!==identity.accountKey||record.authorizationHome!==profile.home))throw Error('Selected profile identity changed during preparation.');
    const recovery=new CodexAccountLayoutRecovery({root:this.root,assertInactive:async home=>{
      await this.permit({operationId:operation.id});return this.runtime.accountProfileActivity(home);
    }});
    const input={canonicalHome:this.canonicalHome,profileHome:profile.home,sqliteHome:this.canonicalHome};
    if(!record){
      // Already selected live profiles need no adoption while active. A verified
      // canonical receipt can be reused; new or conflicting layouts must first
      // pass fresh inactivity and preservation through the recovery controller.
      const selection=await recovery.inspect(input);
      record={version:1,operationId:operation.id,accountId:target.id,accountKey:identity.accountKey,authorizationHome:profile.home,
        email:target.email,input,selectionFingerprint:selection.fingerprint,state:'preparing',directories};
      await researchSave(this.file(operation.id),record);
    }
    if(!record.layout){
      const journal=await recovery.load(await recovery.journal(profile.home),profile.home);
      if(journal?.state==='verified'){
        if(journal.layout.plan.canonicalHome!==this.canonicalHome||journal.layout.plan.sqliteHome!==this.canonicalHome)
          throw Error('The retained profile layout belongs to a different canonical runtime.');
        await this.layout.verify(journal.layout);record.layout=journal.layout;
      }else {
        const adopted=await recovery.adopt({input,requestId:operation.id,expectedFingerprint:record.selectionFingerprint,confirmed:true});record.layout=adopted.layout;
      }
      await researchSave(this.file(operation.id),record);
    }
    await this.layout.verify(record.layout);
    // Configuration values stay transient. Store only equivalent hashes and
    // field names; no tokens, URLs, hook bodies or user instructions are logged.
    const before=await this.configs(this.canonicalHome,directories),after=await this.configs(profile.home,directories);
    for(const home of sourceHomes.filter(home=>home!==this.canonicalHome)){
      const source=await this.configs(home,directories);
      for(let n=0;n<directories.length;n++)if(!(await compareAccountRuntimeConfiguration(before[n],source[n])).equivalent)
        throw Error('A captured runtime has independent project configuration. Preserve its settings for review.');
    }
    const comparisons=[];
    for(let n=0;n<directories.length;n++){
      const proof=await compareAccountRuntimeConfiguration(before[n],after[n]);
      if(!proof.equivalent)throw Error('The selected profile configuration differs for a captured project. Preserve its runtime.');
      comparisons.push({directory:directories[n],...proof});
    }
    await this.permit({operationId:operation.id});const verified=await this.check(profile.home,target.email);
    if(verified.accountKey!==record.accountKey)throw Error('The selected account changed after profile preparation.');
    record.state='verified';record.comparisons=comparisons;record.verifiedAt=new Date().toISOString();await researchSave(this.file(operation.id),record);
    return {state:'verified',method:'chatgpt',email:target.email,accountKey:record.accountKey,workspaceVerified:true,workspaceName:null};
  }
  async target(operation){
    const record=await this.saved(operation.id),profile=await this.profile(operation.targetId);
    if(record?.state!=='verified'||profile?.authentication!=='verified'||record.accountKey!==operation.destinationAccountKey
      ||record.accountKey!==profile.accountKey||record.authorizationHome!==profile.home)throw Error('The prepared account profile is no longer verified.');
    await this.layout.verify(record.layout);
    return {accountKey:record.accountKey,authorizationHome:record.authorizationHome,accountVerified:true,configurationVerified:true,
      layoutFingerprint:record.layout.plan.fingerprint,configurationHash:record.comparisons[0].destinationHash,
      sqliteHome:record.layout.plan.sqliteHome,layout:record.layout};
  }
  async verify(operation){
    const target=await this.target(operation),profile=await this.profile(operation.targetId),reading=await this.check(profile.home,profile.email);
    if(reading.accountKey!==target.accountKey)throw Error('The final allowance reading belongs to another account.');
    return {accountKey:target.accountKey,freshUsage:true,runtime:{authorizationHome:target.authorizationHome,sqliteHome:target.sqliteHome,layout:target.layout}};
  }
}
