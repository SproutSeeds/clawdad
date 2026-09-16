import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable,Readable} from 'node:stream';
import {CodexAccountAuthorizations} from '../lib/codex-account-authorizations.mjs';
import {CodexAccountProfileProcess} from '../lib/codex-account-profile-process.mjs';
import {CodexAccounts} from '../lib/codex-accounts.mjs';
import {AssistantRuntime,assistantHttp} from '../lib/assistant-runtime.mjs';
import {runAssistantMCP} from '../lib/assistant-mcp.mjs';

const a={id:'11111111-1111-4111-8111-111111111111',email:'a@example.test'},b={id:'22222222-2222-4222-8222-222222222222',email:'b@example.test'};
const tick=()=>new Promise(r=>setTimeout(r,5));
async function until(fn){for(let n=0;n<200;n++){if(await fn())return;await tick();}assert.fail('The account connection did not reach the expected state');}
async function fixture(t,{complete=true,email,openFailure=false}={}) {
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-signin-')),root=await fs.realpath(temporary);
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const credentials=new Map(),calls=[],connections=[],opened=[];
  const options={root,binary:'/fixture/codex',timeoutMs:10_000,open:async handoff=>{
    opened.push(handoff);if(openFailure)throw Error('private provider body');
    if(complete)queueMicrotask(()=>connections.at(-1).complete());
  },createProcess:({home})=>{
    const id=path.basename(home),expected=id===a.id?a.email:b.email,listeners=new Set();
    const connection={home,closed:false,connect:async()=>{},verifyStorage:async()=>{},
      subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
      complete(){credentials.set(id,{email:email||expected,entitlement:id});for(const fn of listeners)fn({method:'account/login/completed',params:{loginId:'login-'+id,success:true}});for(const fn of listeners)fn({method:'account/updated',params:{authMode:'chatgpt'}});},
      close(){if(connection.closed)return;connection.closed=true;for(const fn of listeners)fn({method:'clawdad/accountConnectionClosed'});},
      async request(method,args){calls.push({id,method,args});const auth=credentials.get(id);
        if(method==='account/read')return {account:auth?{type:'chatgpt',email:auth.email,planType:'pro'}:null};
        if(method==='account/rateLimits/read')return {accountId:auth.entitlement,ordinaryUsageAllowed:false,rateLimits:{limitId:'codex',primary:{windowDurationMins:10080,usedPercent:100,resetsAt:2000000000}}};
        if(method==='account/login/start')return {type:'chatgpt',loginId:'login-'+id,authUrl:'https://auth.openai.com/login?private=NEVER_PERSIST'};
        if(method==='account/login/cancel')return {};
        assert.fail('Unexpected RPC '+method);
      }};connections.push(connection);return connection;
  }};
  const service=new CodexAccountAuthorizations(options);t.after(()=>service.close());
  const finish=async()=>{await until(()=>service.tasks.size===0);return service.snapshot();};
  return {root,options,service,finish,calls,connections,credentials,opened};
}

test('account connection retains two identities at zero allowance; new service verifies both without another login',async t=>{
  const f=await fixture(t);
  for(const account of [a,b]){await f.service.request({account,requestId:'connect-'+account.id,confirmed:true});await f.finish();}
  const first=await f.service.snapshot();assert.equal(first.profiles.length,2);
  assert.ok(first.profiles.every(p=>p.authentication==='verified'&&p.remainingPercent===0));
  assert.notEqual(first.profiles[0].accountKey,first.profiles[1].accountKey);
  await f.service.close();const reopened=new CodexAccountAuthorizations(f.options);t.after(()=>reopened.close());
  for(const account of [a,b]){await reopened.request({account,requestId:'read-'+account.id,mode:'verify'});await until(()=>reopened.tasks.size===0);}
  assert.equal(f.calls.filter(c=>c.method==='account/login/start').length,2);assert.equal(f.opened.length,2);
  assert.ok(f.calls.every(c=>c.method.startsWith('account/')));
  const contents=await fs.readFile(f.service.file,'utf8');assert.ok(!contents.includes('NEVER_PERSIST'));
  assert.ok(!contents.includes('authUrl'));assert.equal((await fs.stat(f.service.file)).mode&0o777,0o600);
});
test('duplicates, concurrent selections and settings reconnect do not repeat a browser ceremony',async t=>{
  const f=await fixture(t,{complete:false}),args={account:a,requestId:'one',confirmed:true};
  await f.service.request(args);await until(()=>f.opened.length===1);
  await f.service.request(args);const duplicate=await f.service.request({...args,requestId:'two'});
  assert.equal(duplicate.requestId,'one');
  await assert.rejects(f.service.request({account:b,requestId:'other',confirmed:true}),/Finish or cancel/);
  await assert.rejects(f.service.request({...args,account:b}),/another account/);
  assert.equal(f.calls.filter(c=>c.method==='account/login/start').length,1);
  f.connections[0].complete();await f.finish();assert.equal((await f.service.request(args)).status,'verified');
  const later=await f.service.request({...args,requestId:'two'});assert.equal(later.requestId,'one');assert.equal(later.status,'verified');
  assert.equal(f.connections.length,1);
});
test('failed browser opening preserves receipt and reconciliation never starts another sign-in',async t=>{
  const f=await fixture(t,{openFailure:true});await f.service.request({account:a,requestId:'one',confirmed:true});await f.finish();
  assert.equal((await f.service.snapshot()).profiles[0].operation.status,'needs_check');
  await f.service.request({account:a,requestId:'check',mode:'verify'});await f.finish();
  assert.equal((await f.service.snapshot()).profiles[0].authentication,'needs_sign_in');
  assert.equal(f.opened.length,1);assert.ok(!(await fs.readFile(f.service.file,'utf8')).includes('private provider body'));
});
test('a second controller observes a live ceremony and cannot replace it with a new verification owner',async t=>{
  const f=await fixture(t,{complete:false}),args={account:a,requestId:'one',confirmed:true};
  await f.service.request(args);await until(()=>f.opened.length===1);
  const other=new CodexAccountAuthorizations(f.options);t.after(()=>other.close());
  const coalesced=await other.request({...args,requestId:'second-controller'});assert.equal(coalesced.requestId,'one');
  await assert.rejects(other.request({account:a,requestId:'check-from-other',mode:'verify'}),/Finish or cancel/);
  assert.equal((await other.snapshot()).profiles[0].operation.status,'awaiting_user');
  f.connections[0].complete();await f.finish();assert.equal(f.opened.length,1);
});
test('service interruption after browser handoff can reconcile completed authorization without replay',async t=>{
  const f=await fixture(t,{complete:false});await f.service.request({account:a,requestId:'one',confirmed:true});await until(()=>f.opened.length===1);
  f.credentials.set(a.id,{email:a.email,entitlement:a.id});await f.service.close();
  const next=new CodexAccountAuthorizations(f.options);t.after(()=>next.close());
  await next.request({account:a,requestId:'verify',mode:'verify'});await until(()=>next.tasks.size===0);
  assert.equal((await next.snapshot()).profiles[0].authentication,'verified');assert.equal(f.opened.length,1);
});
test('wrong principal and changed entitlement never become usable saved authorizations',async t=>{
  const wrong=await fixture(t,{email:b.email});await wrong.service.request({account:a,requestId:'wrong',confirmed:true});await wrong.finish();
  assert.notEqual((await wrong.service.snapshot()).profiles[0].authentication,'verified');
  const f=await fixture(t);await f.service.request({account:a,requestId:'one',confirmed:true});await f.finish();
  f.credentials.set(a.id,{email:a.email,entitlement:'different-workspace'});
  await f.service.request({account:a,requestId:'check',mode:'verify'});await f.finish();
  assert.equal((await f.service.snapshot()).profiles[0].authentication,'identity_changed');
});
test('cancel leaves production owners untouched and reconciles possible successful authorization',async t=>{
  const f=await fixture(t,{complete:false});await f.service.request({account:a,requestId:'one',confirmed:true});await until(()=>f.opened.length===1);
  await f.service.cancel({operationId:'one',requestId:'cancel'});await f.finish();
  await f.service.cancel({operationId:'one',requestId:'cancel'});
  assert.ok(f.connections[0].closed);assert.equal(f.calls.filter(c=>c.method==='account/login/cancel').length,1);
  assert.equal((await f.service.snapshot()).profiles[0].operation.status,'needs_check');
  assert.ok(!f.calls.some(c=>c.method.includes('logout')||c.method.startsWith('thread/')));
});
test('missing explicit sign-in intent and unsafe account identities are rejected before process creation',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.service.request({account:a,requestId:'one'}),/explicitly/);
  await assert.rejects(f.service.request({account:{...a,id:'..'},requestId:'two',confirmed:true}),/explicitly/);
  assert.equal(f.connections.length,0);
});
test('an approved retained home is registered only after exact verification and survives controller restart',async t=>{
  const f=await fixture(t),home=path.join(f.root,'retained-cody');await fs.mkdir(home,{mode:0o700});
  f.credentials.set('retained-cody',{email:a.email,entitlement:a.id});
  const args={account:a,requestId:'register',mode:'verify',confirmed:true,retainedHome:home};
  await f.service.request(args);await f.finish();
  const saved=(await f.service.snapshot()).profiles[0];assert.equal(saved.home,home);assert.equal(saved.authentication,'verified');assert.ok(saved.retainedVerifiedAt);
  await f.service.request(args);assert.equal(f.connections.length,1);
  await f.service.close();const next=new CodexAccountAuthorizations(f.options);t.after(()=>next.close());
  await next.request({account:a,requestId:'reopen-registered',mode:'verify'});await until(()=>next.tasks.size===0);
  assert.equal(f.connections.at(-1).home,home);assert.equal((await next.snapshot()).profiles[0].authentication,'verified');
  assert.equal(f.opened.length,0);assert.ok(!f.calls.some(c=>c.method==='account/login/start'));
  await assert.rejects(next.request({account:b,requestId:'alias-home',mode:'verify',confirmed:true,retainedHome:home}),/another saved account/);
});
test('retained registration rejects external, missing and symlinked homes or a wrong account without adopting the path',async t=>{
  const f=await fixture(t),home=path.join(f.root,'retained-wrong');await fs.mkdir(home,{mode:0o700});
  const args={account:a,requestId:'register',mode:'verify',confirmed:true};
  await assert.rejects(f.service.request({...args,retainedHome:os.homedir()}),/inside ClawDad/);
  await assert.rejects(f.service.request({...args,retainedHome:path.join(f.root,'missing')}),/ENOENT/);
  const link=path.join(f.root,'linked');await fs.symlink(home,link,'dir');
  await assert.rejects(f.service.request({...args,retainedHome:link}),/private, local/);
  await assert.rejects(f.service.request({...args,confirmed:false,retainedHome:home}),/explicit/);
  f.credentials.set('retained-wrong',{email:b.email,entitlement:b.id});
  await f.service.request({...args,retainedHome:home});await f.finish();
  const p=(await f.service.snapshot()).profiles[0];assert.equal(p.home,undefined);assert.notEqual(p.authentication,'verified');assert.equal(f.opened.length,0);
});
test('account-only process enforces private homes, keyring storage, RPC boundary and sanitized environment',async t=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-profile-')),root=await fs.realpath(temporary);
  t.after(()=>fs.rm(root,{recursive:true,force:true}));let invocation,child;
  const launch=(...args)=>{invocation=args;child=new EventEmitter();child.stdout=new PassThrough();child.kill=()=>{};
    child.stdin=new Writable({write(buffer,encoding,done){const m=JSON.parse(String(buffer));
      if(m.id)queueMicrotask(()=>child.stdout.write(JSON.stringify({id:m.id,result:m.method==='config/read'?{config:{cli_auth_credentials_store:'keyring'}}:{}})+'\n'));done();}});return child;};
  const client=new CodexAccountProfileProcess({home:path.join(root,'home'),binary:'/fixture/codex',launch});
  await client.connect();assert.deepEqual(invocation[1],['app-server','--stdio','-c','cli_auth_credentials_store="keyring"']);
  assert.equal(invocation[2].env.CODEX_HOME,path.join(root,'home'));assert.equal(invocation[2].env.OPENAI_API_KEY,undefined);
  await assert.rejects(client.request('turn/start',{input:'never'}),/separate Codex/);
  await fs.writeFile(path.join(root,'home','auth.json'),'synthetic fallback',{mode:0o600});
  await assert.rejects(client.verifyStorage(),/Keychain/);client.close();
});
test('account controls expose saved sign-in distinctly from production selected account or complete switching',async t=>{
  const f=await fixture(t),usage={snapshot:async()=>({subscription:{email:'current@example.test',method:'chatgpt'},accountKey:'current'})};
  const controller=new CodexAccounts({root:f.root,usage,authorizations:f.service});
  const entry=(await controller.add({email:a.email,requestId:'add',expectedRevision:0})).account;
  const result=await controller.control('accounts.signin',{accountId:entry.id,requestId:'signin',confirmed:true});
  assert.equal(result.accounts.canConnectAccounts,true);assert.equal(result.accounts.capabilities.ready,false);
  assert.equal((await controller.admission()).allowed,true);
  assert.equal(result.accounts.current.email,'current@example.test');
  await f.finish();assert.equal((await controller.snapshot()).current.email,'current@example.test');
});
test('Assistant MCP connects only the explicitly authorized saved account using the real service control path',async t=>{
  const f=await fixture(t),usage={snapshot:async()=>({subscription:{email:'current@example.test',method:'chatgpt'},accountKey:'current'})};
  const controller=new CodexAccounts({root:f.root,usage,authorizations:f.service});
  const entry=(await controller.add({email:a.email,requestId:'add',expectedRevision:0})).account;
  f.credentials.set(entry.id,{email:a.email,entitlement:entry.id});
  const runtime=new AssistantRuntime({root:path.join(f.root,'Assistant'),coordinator:{stop(){},prepare(){throw Error('No model in account controls');}}});
  runtime.accounts=controller;await runtime.load();t.after(()=>runtime.close());
  const text='Connect the saved a@example.test Codex subscription account.';
  runtime.state.coordinator={activeRequestId:'authorized'};
  runtime.state.jobs.push({id:'authorized',action:'message',status:'running',source:'user',args:{text},runtimeInstanceId:runtime.instanceId});
  await fs.writeFile(path.join(runtime.root,'connection.json'),JSON.stringify({baseURL:'http://127.0.0.1:4487'}));
  await fs.writeFile(path.join(f.root,'native-server.token'),'fixture');
  const call=async approvalText=>{
    const output=[];
    await runAssistantMCP({root:f.root,input:Readable.from([JSON.stringify({id:1,method:'tools/call',params:{name:'connect_codex_account',
      arguments:{action:'signin',accountId:entry.id,approvalText,requestId:'connect'}}})+'\n']),
      output:new Writable({write(chunk,enc,done){output.push(JSON.parse(chunk));done();}}),fetchImpl:async(url,options)=>{
        let code,result;await assistantHttp({method:'POST'},null,new URL(url),runtime,{readBody:async()=>JSON.parse(options.body),json:(res,c,data)=>{code=c;result=data;}});
        return {ok:code===200,json:async()=>result};
      }});return output[0];
  };
  assert.equal((await call('Text not authorized by Cody')).result.isError,true);assert.equal(f.connections.length,0);
  assert.equal((await call(text)).result.isError,undefined);await f.finish();
  assert.equal((await controller.snapshot()).accounts[0].authentication,'verified');
  assert.equal((await call(text)).result.isError,undefined);assert.equal(f.connections.length,1);
  assert.equal(runtime.state.jobs.length,1);assert.equal((await controller.admission()).allowed,true);
});
