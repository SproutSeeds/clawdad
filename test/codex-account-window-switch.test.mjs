import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CodexAccounts} from '../lib/codex-accounts.mjs';
import {CodexAccountSwitchAdapter} from '../lib/codex-account-switch-adapter.mjs';
import {readAccountWindow} from '../lib/codex-account-window-switch.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');

async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'clawdad-window-switch-')));
  let busy=false,failCapture=false,account=hash('old'),working=true,worker,prepared;
  const effects=[],nativeActions=[];
  const choice={id:hash('physical window'),tabId:'tab-one',title:'Terminal window 1',count:2,tabs:[{tabId:'tab-one',name:'First'},{tabId:'tab-two',name:'Second'}]};
  const outside={id:'outside',kind:'terminal_codex',tabId:'tab-outside',tty:'/dev/ttys998',pid:98,processIdentity:'unrelated',sessionId:'unrelated',busy:true};
  const owners=choice.tabs.map((tab,i)=>({id:'pid:'+i,kind:'terminal_codex',pid:i+10,processIdentity:'owner-'+i,
    tabId:tab.tabId,tty:'/dev/ttys99'+i,sessionId:'00000000-0000-4000-8000-00000000000'+i,directory:'/same',busy:false,pendingReceipts:[],reason:''}));
  const accounts=new CodexAccounts({root,usage:{snapshot:async()=>({accountKey:account}),freshReading:async()=>({accountKey:account})}});
  const entry=(await accounts.add({email:'destination@example.test',requestId:'add',expectedRevision:0})).account;
  const target={accountKey:hash('new'),authorizationHome:'/new-profile',sqliteHome:'/canonical'};
  const profiles={identities:async()=>[],prepare:async()=>{effects.push('authenticate');prepared=true;return {state:'verified',method:'chatgpt',email:entry.email,accountKey:target.accountKey,workspaceVerified:true};},target:async()=>{assert.ok(prepared);return target;},verify:async()=>{account=target.accountKey;return {...target,freshUsage:true};}};
  const adapter=new CodexAccountSwitchAdapter({root,accounts,runtime:{state:{}},windowRebuild:true,
    inventory:async()=>({complete:true,reasons:[],windows:[choice],consumers:[...owners.map(o=>({...o,busy})),outside]}),profiles,
    sharedDriver:{},verifyPending:async()=>true});
  adapter.capabilities.selectedRuntimeRouting=false;accounts.adapter=adapter;accounts.inspectConsumers=args=>adapter.inspect(args);
  const timer=setInterval(()=>{
    if(!working||worker)return;
    worker=(async()=>{
      const {job}=await adapter.transport.poll({workerId:'fixture-worker'});if(!job)return;
      nativeActions.push(job.action);const envelope={id:job.id,workerId:job.workerId,dispatchId:job.dispatchId};
      await adapter.transport.prepare(envelope);
      if(job.action==='window.capture'){
        if(failCapture){await adapter.transport.complete({...envelope,reasonCode:'native_account_control_unavailable',message:'The original draft cannot be recovered. Its window remains open.'});return;}
        const record={version:1,operationId:job.operationId,selection:choice.id,captureHash:hash('exact capture'),stage:'captured',
          tabs:owners.map(o=>({tty:o.tty,owner:o.processIdentity})),launches:{},
          entries:owners.map((o,i)=>({id:'entry-'+i,directory:o.directory,kind:'codex',sessionId:o.sessionId,
            conversationPath:'/fixtures/'+o.sessionId,executable:'/codex',draft:{text:'Exact 🌿\n'+('word '.repeat(1000))},pendingReceipts:[]}))};
        await fs.mkdir(path.join(root,'WindowSwitches'),{mode:0o700});
        await fs.writeFile(path.join(root,'WindowSwitches',job.operationId+'.json'),JSON.stringify(record),{mode:0o600});
        await adapter.transport.complete({...envelope,result:{stage:'captured',captureHash:record.captureHash}});
      }else if(job.action==='window.restore'){
        assert.ok(prepared,'Destination authentication must precede closing');effects.push('close-and-recreate');
        await adapter.transport.complete({...envelope,result:{stage:'verified'}});
      }else if(job.action==='window.verify')await adapter.transport.complete({...envelope,result:{stage:'verified'}});
      else assert.fail('Unexpected input/status command: '+job.action);
    })().finally(()=>{worker=null;});worker.catch(e=>{working=false;effects.push('ERROR '+e.message);});
  },2);
  t.after(async()=>{working=false;clearInterval(timer);await worker;await fs.rm(root,{recursive:true,force:true});});
  return {root,accounts,adapter,choice,entry,effects,nativeActions,setBusy:v=>{busy=v;},setFailCapture:v=>{failCapture=v;},
    request:()=>accounts.request({accountId:entry.id,requestId:'window-switch',expectedRevision:1,confirmed:true,windowSelection:{id:choice.id,tabId:choice.tabId}})};
}

test('window switch waits silently for busy work, captures once, authenticates before closure and never issues status or agent prompts',async t=>{
  const f=await fixture(t);f.setBusy(true);await f.request();
  for(let i=0;i<4;i++)await f.accounts.advance();
  assert.deepEqual(f.nativeActions,[]);assert.deepEqual(f.effects,[]);
  f.setBusy(false);await f.accounts.advance();
  let op=(await f.accounts.snapshot()).activeOperation;
  assert.equal(op.status,'completed',JSON.stringify({reason:op.reason,observation:op.observation}));assert.deepEqual(f.effects,['authenticate','close-and-recreate']);
  assert.deepEqual(f.nativeActions,['window.capture','window.restore','window.verify']);
  assert.equal(op.consumers.length,1);assert.equal(op.consumers[0].kind,'terminal_window');
  assert.equal(op.recovery.entries[0].window.entries.length,2);
  assert.equal(op.recovery.entries[0].window.entries[0].draft.text,'Exact 🌿\n'+('word '.repeat(1000)));
  await f.request();await f.accounts.advance();assert.equal(f.nativeActions.length,3);
  assert.equal((await readAccountWindow(f.root,'window-switch')).entries.length,2);
});
test('failed capture pauses without repeated tab sweeps; explicit recovery retains operation and draft',async t=>{
  const f=await fixture(t);f.setFailCapture(true);await f.request();await f.accounts.advance();
  let op=(await f.accounts.snapshot()).activeOperation;
  assert.equal(op.status,'needs_attention');assert.match(op.reason,/draft cannot be recovered/);
  for(let i=0;i<3;i++)await f.accounts.advance();assert.deepEqual(f.nativeActions,['window.capture']);assert.deepEqual(f.effects,[]);
  f.setFailCapture(false);await f.accounts.control('accounts.reconcile',{});
  op=(await f.accounts.snapshot()).activeOperation;assert.equal(op.status,'completed',JSON.stringify({reason:op.reason,observation:op.observation}));
  assert.equal(f.nativeActions.filter(a=>a==='window.capture').length,2);
});
test('ambiguous or changed window selection is rejected before accepting an account transition',async t=>{
  const f=await fixture(t),original=f.adapter.inventory;
  f.adapter.inventory=async()=>{const x=await original();return {...x,windows:[f.choice,{...f.choice,id:'other-window',tabId:'other'}]};};
  await assert.rejects(f.accounts.request({accountId:f.entry.id,requestId:'missing-window',expectedRevision:1,confirmed:true}),/Choose the exact Terminal window/);
  assert.deepEqual(f.effects,[]);assert.deepEqual(f.nativeActions,[]);
  await f.request();
  await assert.rejects(f.accounts.request({accountId:f.entry.id,requestId:'different-window',expectedRevision:1,confirmed:true,windowSelection:{id:'other-window',tabId:'other'}}),/another Terminal window/);
});
test('legacy preflight is paused rather than running another status sweep under the new installed adapter',async t=>{
  const f=await fixture(t);await f.request();
  await f.accounts.transaction(async(s,save)=>{delete s.operations['window-switch'].strategy;await save();});
  await f.accounts.advance();const op=(await f.accounts.snapshot()).activeOperation;
  assert.equal(op.reasonCode,'legacy_switch_review');assert.deepEqual(f.nativeActions,[]);assert.deepEqual(f.effects,[]);
});
test('private window recovery rejects public files and incomplete drafts',async t=>{
  const f=await fixture(t);await f.request();await f.accounts.advance();
  const file=path.join(f.root,'WindowSwitches/window-switch.json');await fs.chmod(file,0o644);
  await assert.rejects(readAccountWindow(f.root,'window-switch'),/recovery record needs inspection/);
  await fs.chmod(file,0o600);const v=JSON.parse(await fs.readFile(file,'utf8'));delete v.entries[0].draft.text;
  await fs.writeFile(file,JSON.stringify(v));await assert.rejects(readAccountWindow(f.root,'window-switch'),/recovery record needs inspection/);
});

test('cancelled legacy inspections reconcile empty status input without replaying keys or discarding uncertain receipts',async t=>{
  const f=await fixture(t);f.setBusy(true);await f.request();
  f.adapter.transport.authorize=async()=>true;
  const op=(await f.accounts.snapshot()).activeOperation;
  // Construct receipts from the previous installed dispatcher; the new adapter
  // never emits this action during a window switch.
  const receipt={operationId:op.id,requestId:'legacy-status',action:'status',args:{source:{processIdentity:'owner-original'}}};
  await f.adapter.transport.enqueue(receipt);
  // The fixture worker must not execute the legacy operation.
  const journal=JSON.parse(await fs.readFile(f.adapter.transport.file,'utf8'));
  const stored=journal.requests.find(r=>r.id===receipt.requestId);stored.state='attention';stored.preparedAt=new Date().toISOString();
  await fs.writeFile(f.adapter.transport.file,JSON.stringify(journal));
  const directory=path.join(f.root,'NativeRecovery');await fs.mkdir(directory,{mode:0o700});
  const file=path.join(directory,receipt.requestId+'.json');
  const recovery={requestId:receipt.requestId,command:'/status',stage:'local_command_enter_prepared',source:{processIdentity:'owner-original',draft:{text:'existing draft'}}};
  await fs.writeFile(file,JSON.stringify(recovery),{mode:0o600});
  assert.equal((await f.adapter.reconcileCancellation({operation:op})).pendingEffectsResolved,false);
  recovery.source.draft.text='';await fs.writeFile(file,JSON.stringify(recovery));
  assert.equal((await f.adapter.reconcileCancellation({operation:op})).pendingEffectsResolved,true);
  const saved=await f.adapter.transport.inspect(receipt.requestId);
  assert.equal(saved.state,'attention');assert.equal(saved.cancellationReconciled.deliveryStillUncertain,true);
  assert.deepEqual(f.nativeActions,[]);
});
