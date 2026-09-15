// Offline audit evidence only. No login, network, model, native-control or product writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {normalizeWeeklyUsage} from '../lib/codex-weekly-usage.mjs';

const artifacts=new URL('../native/macos/dist/candidates/codex-account-switch-audit-2026-09-14/',import.meta.url);
const schema=async(version,name)=>JSON.parse(await fs.readFile(new URL(`schema-${version}/${name}.json`,artifacts),'utf8'));
const sample=(usedPercent,{accountId='synthetic-workspace-A',minutes=10080,...rest}={})=>({accountId,
  rateLimits:{limitId:'codex',primary:{usedPercent,windowDurationMins:minutes,resetsAt:1_800_000_000}},...rest});

test('both installed schemas expose managed browser/device login; external tokens are explicitly restricted',async()=>{
  for(const version of ['0153','0154']){
    const d=await schema(version,'v2/LoginAccountParams');
    const variants=new Map(d.oneOf.map(x=>[x.properties.type.enum[0],x]));
    assert.ok(variants.has('chatgpt'));assert.ok(variants.has('chatgptDeviceCode'));
    assert.match(variants.get('chatgptAuthTokens').description,/INTERNAL USE ONLY.*DO NOT USE/);
    const request=await schema(version,'ClientRequest');
    const serialized=JSON.stringify(request);
    assert.ok(serialized.includes('account/login/cancel'));
    assert.ok(!serialized.includes('account/switch'));
    assert.ok(!serialized.includes('account/list'));
  }
});
test('installed quota precision is integer percent; only 0.154 exposes ordinaryUsageAllowed',async()=>{
  for(const version of ['0153','0154']){
    const d=await schema(version,'v2/GetAccountRateLimitsResponse');
    assert.equal(d.definitions.RateLimitWindow.properties.usedPercent.type,'integer');
    assert.equal(!!d.properties.ordinaryUsageAllowed,version==='0154');
  }
});
test('1 and 2 percent candidates are remaining allowance, independent of short windows',()=>{
  for(const [used,remaining] of [[98,2],[99,1],[100,0]])assert.equal(normalizeWeeklyUsage(sample(used)).remainingPercent,remaining);
  const d=sample(91);d.rateLimits.secondary=d.rateLimits.primary;d.rateLimits.primary={usedPercent:100,windowDurationMins:300,resetsAt:1_800_000_100};
  assert.equal(normalizeWeeklyUsage(d).remainingPercent,9);
});
test('different workspace/account IDs get separate allowance keys even with matching email metadata',()=>{
  const a=sample(50,{email:'synthetic@example.invalid'}),b=sample(50,{email:'synthetic@example.invalid',accountId:'synthetic-workspace-B'});
  assert.notEqual(normalizeWeeklyUsage(a).accountKey,normalizeWeeklyUsage(b).accountKey);
});
test('unknown identity or absent weekly window cannot become a zero reading',()=>{
  assert.throws(()=>normalizeWeeklyUsage(sample(100,{accountId:''})),/identify/);
  assert.throws(()=>normalizeWeeklyUsage(sample(100,{minutes:300})),/weekly/);
  assert.throws(()=>normalizeWeeklyUsage(sample(NaN)),/invalid/);
});
test('current projection loses backend exhaustion permission: a documented design gap, not a new repair',()=>{
  assert.deepEqual(normalizeWeeklyUsage(sample(100,{ordinaryUsageAllowed:true})),normalizeWeeklyUsage(sample(100,{ordinaryUsageAllowed:false})));
  assert.equal(normalizeWeeklyUsage(sample(100)).ordinaryUsageAllowed,undefined);
});
test('thread resume schemas do not establish an authentication principal or cross-account permission',async()=>{
  for(const version of ['0153','0154']){
    const d=await schema(version,'v2/ThreadResumeParams');
    assert.ok(d.properties.threadId);assert.ok(d.properties.cwd);assert.ok(d.properties.model);assert.ok(d.properties.config);
    assert.equal(d.properties.accountId,undefined);assert.equal(d.properties.workspaceId,undefined);
    const a=await schema(version,'v2/GetAccountResponse');
    const chatgpt=a.definitions.Account.oneOf.find(x=>x.properties.type.enum[0]==='chatgpt');
    assert.ok(chatgpt.properties.email);assert.equal(chatgpt.properties.workspaceName,undefined);
  }
});
