import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough, Writable} from 'node:stream';
import {readCodexAccountUsage, normalizeWeeklyUsage, CodexWeeklyUsageMonitor} from '../lib/codex-weekly-usage.mjs';
import {selectedCodexLaunch} from '../lib/codex-account-launch.mjs';
import {normalizeWeeklyNotification, weeklyNotificationPayload, PushNotificationService} from '../cloud/push-notifications.mjs';

const start = Date.parse('2026-09-09T15:00:00Z');
const reset = Date.parse('2026-09-14T22:47:11Z') / 1000;
const provider = (used = 67, accountId = 'signed-in-account', resetsAt = reset) => ({accountId,
  rateLimitsByLimitId: {codex: {limitId: 'codex', primary: {usedPercent: used, windowDurationMins: 10080, resetsAt}},
    codex_bengalfox: {limitId: 'codex_bengalfox', secondary: {usedPercent: 0, windowDurationMins: 10080, resetsAt}}}});

function accountProcess({changeAccount = false, stall = false} = {}) {
  const methods = []; let reads = 0;
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.exitCode = null; child.killed = false;
  child.kill = () => { child.killed = true; };
  child.stdin = new Writable({write(chunk, _encoding, done) {
    const message = JSON.parse(chunk); methods.push(message.method);
    if (message.id && !stall) {
      let result = {};
      if (message.method === 'account/read') result = {account: {type: 'chatgpt', email: changeAccount && reads++ ? 'different' : 'original'}};
      if (message.method === 'account/rateLimits/read') result = provider();
      queueMicrotask(() => child.stdout.write(JSON.stringify({id: message.id, result}) + '\n'));
    }
    done();
  }});
  return {child, methods, launch: (_binary, args, options) => {
    assert.deepEqual(args, ['app-server']); assert.equal(options.stdio[2], 'ignore'); return child;
  }};
}

test('account monitoring performs only account RPCs and terminates its owned reader', async () => {
  const process = accountProcess();
  assert.equal((await readCodexAccountUsage({launch: process.launch})).remainingPercent, 33);
  assert.deepEqual(process.methods, ['initialize', 'initialized', 'account/read', 'account/rateLimits/read', 'account/read']);
  assert.equal(process.child.killed, true);
});

test('selected subscription usage is read from its own launch and rejects changed account identity',async()=>{
  const key=normalizeWeeklyUsage(provider()).accountKey;
  const route=selectedCodexLaunch({verified:true,operationId:'selected',accountId:'fixture',accountKey:key,method:'chatgpt',
    authorizationHome:'/private/selected',sqliteHome:'/private/history',layoutVerified:true},{env:{HOME:'/Users/fixture',PATH:'/bin'}});
  const process=accountProcess();
  const launch=(_binary,args,options)=>{
    assert.deepEqual(args,[...route.configArgs,'app-server']);assert.equal(options.env.CODEX_HOME,'/private/selected');return process.child;
  };
  assert.equal((await readCodexAccountUsage({launch,accountLaunch:route})).accountKey,key);
  assert.equal(process.methods.some(method=>method?.startsWith('thread/')),false);
  const changed=accountProcess();
  await assert.rejects(readCodexAccountUsage({launch:()=>changed.child,accountLaunch:{...route,account:{...route.account,key:'f'.repeat(64)}}}),/allowance identity/);
  assert.equal(changed.child.killed,true);
});

test('account changes during a read and stalled providers never become current readings', async () => {
  const changed = accountProcess({changeAccount: true});
  await assert.rejects(readCodexAccountUsage({launch: changed.launch}), /account changed/);
  assert.equal(changed.child.killed, true);
  const stalled = accountProcess({stall: true});
  await assert.rejects(readCodexAccountUsage({launch: stalled.launch, timeoutMs: 20}), /unavailable/);
  assert.equal(stalled.child.killed, true);
});

test('weekly account bucket uses duration, percent-used inversion, and provider identity', () => {
  const value = provider(); const parsed = normalizeWeeklyUsage(value);
  assert.equal(parsed.remainingPercent, 33); assert.equal(parsed.resetsAt, reset);
  assert.match(parsed.accountKey, /^[a-f0-9]{64}$/); assert.ok(!JSON.stringify(parsed).includes('signed-in-account'));
  value.rateLimitsByLimitId.codex.secondary = value.rateLimitsByLimitId.codex.primary;
  value.rateLimitsByLimitId.codex.primary = {usedPercent: 99, windowDurationMins: 300, resetsAt: reset};
  assert.equal(normalizeWeeklyUsage(value).remainingPercent, 33);
  for (const bad of [{}, {...provider(), accountId: ''}, {accountId: 'x', rateLimits: {limitId: 'codex_bengalfox'}},
    provider(NaN), provider(-1), provider(101), provider(1, 'x', reset * 1000.1)]) assert.throws(() => normalizeWeeklyUsage(bad));
  value.rateLimitsByLimitId.codex.primary.windowDurationMins = 10080;
  assert.throws(() => normalizeWeeklyUsage(value), /single weekly/);
});

test('account details keep weekly and short windows distinct without inventing workspace identity or denial',()=>{
  const value=provider(88);value.ordinaryUsageAllowed=false;
  value.rateLimitsByLimitId.codex.secondary={usedPercent:100,windowDurationMins:300,resetsAt:reset-86400};
  const parsed=normalizeWeeklyUsage(value,{account:{type:'chatgpt',email:'fixture@example.test',planType:'pro'}});
  assert.equal(parsed.remainingPercent,12);assert.equal(parsed.shortWindow.remainingPercent,0);
  assert.equal(parsed.subscription.email,'fixture@example.test');assert.equal(parsed.subscription.plan,'pro');
  assert.equal(parsed.subscription.workspaceName,null);assert.equal(parsed.subscription.workspaceStatus,'not_exposed');
  assert.equal(parsed.ordinaryUsageAllowed,false);
  const older=normalizeWeeklyUsage(provider(100),{account:{type:'chatgpt',email:'fixture@example.test'}});
  assert.equal(older.remainingPercent,0);assert.equal(older.ordinaryUsageAllowed,null);assert.equal(older.shortWindow,null);
  assert.equal(normalizeWeeklyUsage(value,{account:{email:'invalid\nidentity',planType:'pro'}}).subscription.email,null);
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clawdad-weekly-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  let now = start, value = provider(), fail = false, reads = 0;
  const options = {statePath: path.join(root, 'usage.json'), clock: () => now,
    read: async () => { reads++; if (fail) throw Error('Offline'); return normalizeWeeklyUsage(value); }};
  return {options, monitor: new CodexWeeklyUsageMonitor(options), set: x => { value = x; }, time: x => { now = x; },
    fail: x => { fail = x; }, reads: () => reads};
}

test('low then empty alerts persist once each across polls and process restarts', async t => {
  const f = await fixture(t); let m = f.monitor;
  await m.tick(); assert.equal((await m.snapshot()).alerts.length, 0);
  f.set(provider(95)); await m.tick(); await m.tick();
  assert.deepEqual((await m.snapshot()).alerts.map(x => x.threshold), [5]);
  const first = (await m.outbox())[0]; await m.delivered(first.id);
  m = new CodexWeeklyUsageMonitor(f.options); await m.tick();
  assert.equal((await m.outbox()).length, 0);
  f.set(provider(100)); await m.tick(); await m.tick();
  assert.deepEqual((await m.snapshot()).alerts.map(x => x.threshold), [5, 0]);
  assert.equal((await m.outbox()).length, 1);
  assert.equal((await fs.stat(f.options.statePath)).mode & 0o777, 0o600);
});

test('first zero and skipped readings emit only zero; verified weekly reset rearms', async t => {
  const f = await fixture(t), m = f.monitor;
  f.set(provider(100)); await m.tick();
  assert.deepEqual((await m.snapshot()).alerts.map(x => x.threshold), [0]);
  f.set(provider(98)); await m.tick(); assert.equal((await m.snapshot()).alerts.length, 1);
  // Date adjustment before reset does not create a new weekly cycle.
  f.set(provider(100, 'signed-in-account', reset + 30)); await m.tick(); assert.equal((await m.snapshot()).alerts.length, 1);
  f.time((reset + 31) * 1000); f.set(provider(96, 'signed-in-account', reset + 604800)); await m.tick();
  assert.deepEqual((await m.snapshot()).alerts.map(x => x.threshold), [5]);
  assert.notEqual((await m.snapshot()).alerts[0].id, m.state.alerts[0].id);
});

test('account changes have independent thresholds, returning account preserves its receipts', async t => {
  const f = await fixture(t), m = f.monitor;
  f.set(provider(97, 'A')); await m.tick(); const first = (await m.snapshot()).alerts[0].id;
  f.set(provider(100, 'B')); await m.tick(); assert.deepEqual((await m.snapshot()).alerts.map(x => x.threshold), [0]);
  f.set(provider(97, 'A')); await m.tick(); assert.equal((await m.snapshot()).alerts[0].id, first);
  assert.equal(m.state.alerts.length, 2);
});

test('future reset corrections stay authoritative without rearming; failures and passed resets stay stale', async t => {
  const f = await fixture(t), m = f.monitor;
  f.fail(true); await m.tick(); assert.equal((await m.snapshot()).status, 'unavailable');
  f.fail(false); await m.tick(); assert.equal((await m.snapshot()).status, 'current');
  f.fail(true); await m.tick(); assert.equal((await m.snapshot()).status, 'stale');
  f.fail(false); f.set(provider(99, 'signed-in-account', reset - 10)); await m.tick();
  assert.equal((await m.snapshot()).status, 'current'); assert.equal(m.state.alerts.length, 1);
  assert.equal((await m.freshReading()).resetsAt, reset - 10);
  f.time(reset * 1000); f.set(provider(100)); await m.tick();
  assert.equal((await m.snapshot()).status, 'stale'); assert.equal(m.state.alerts.length, 1);
});

test('concurrent polling is coalesced without new model turns or duplicate delivery', async t => {
  const f = await fixture(t); f.set(provider(100));
  await Promise.all(Array.from({length: 20}, () => f.monitor.tick()));
  assert.equal(f.reads(), 1); assert.equal((await f.monitor.outbox()).length, 1);
  await Promise.all(Array.from({length: 20}, () => f.monitor.snapshot())); assert.equal(f.reads(), 1);
});

test('notification payload contains exact local reset and usage navigation, never conversation content', () => {
  const event = normalizeWeeklyNotification({id: 'a'.repeat(64), kind: 'codex_weekly', threshold: 5,
    remainingPercent: 4, resetsAt: reset, completedAt: new Date(start).toISOString(), privateText: 'do not transmit'}, start);
  const payload = weeklyNotificationPayload(event, {locale: 'en-US', timeZone: 'America/Chicago'}, {accountId: 'paired-account', workspaceId: 'workspace', hostId: 'mac'});
  assert.match(payload.aps.alert.body, /Monday, Sep 14, 2026, 5:47 PM CDT/);
  assert.equal(payload.clawdad.kind, 'codex_weekly'); assert.ok(!JSON.stringify(payload).includes('do not transmit'));
  assert.throws(() => normalizeWeeklyNotification({...event, remainingPercent: NaN}, start));
  assert.throws(() => normalizeWeeklyNotification({...event, resetsAt: start / 1000}, start));
});

test('disabled notification registration delivers nothing; enabled registration deduplicates persisted events', async () => {
  const data = new Map(); const state = {storage: {get: async k => data.get(k), put: async (k,v) => data.set(k,structuredClone(v)),
    list: async ({prefix}) => new Map([...data].filter(([k]) => k.startsWith(prefix))), setAlarm: async () => {}, delete: async k => data.delete(k)}};
  const env = {CLAWDAD_APNS_PRIVATE_KEY: 'configured', CLAWDAD_APNS_KEY_ID: 'ABCDEFGHIJ', CLAWDAD_APNS_TEAM_ID: 'ABCDEFGHIJ'};
  const event = {id: 'b'.repeat(64), kind: 'codex_weekly', threshold: 0, remainingPercent: 0, resetsAt: reset, completedAt: new Date(start).toISOString()};
  let service = new PushNotificationService(state, env, {clock: () => start});
  assert.equal((await service.submit(event, {})).recipients, 0);
  await service.register('phone', {enabled: true, token: 'a'.repeat(64), environment: 'production'});
  assert.equal((await service.submit(event, {})).recipients, 1);
  service = new PushNotificationService(state, env, {clock: () => start});
  assert.equal((await service.submit(event, {})).duplicate, true);
  await service.revoke('phone'); assert.equal((await service.submit({...event,id:'c'.repeat(64)}, {})).recipients, 0);
});
