import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
export const weeklyUsageFreshMs = 10 * 60_000;

// Account RPCs only. This short-lived connection never lists, resumes, creates,
// or submits a thread, and never shares ownership of a Terminal conversation.
export async function readCodexAccountUsage({binary = process.env.CLAWDAD_CODEX || 'codex', launch = spawn, timeoutMs = 15_000, accountLaunch = null} = {}) {
  const child = launch(binary, [...(accountLaunch?.configArgs||[]),'app-server'], {cwd: os.homedir(), stdio: ['pipe', 'pipe', 'ignore'],...(accountLaunch?{env:accountLaunch.env}:{})});
  const lines = createInterface({input: child.stdout});
  const pending = new Map(); let nextId = 0, bytes = 0;
  const fail = () => { for (const item of pending.values()) item.reject(new Error('Codex account usage is unavailable.')); pending.clear(); };
  const timer = setTimeout(() => { fail(); child.kill(); }, timeoutMs);
  child.on('error', fail); child.on('exit', fail);
  child.stdin.on('error', fail);
  lines.on('line', line => {
    bytes += line.length;
    if (bytes > 2 * 1024 * 1024) { fail(); child.kill(); return; }
    try {
      const message = JSON.parse(line), item = pending.get(message.id);
      if (item) { pending.delete(message.id); message.error ? item.reject(new Error('Codex account usage is unavailable.')) : item.resolve(message.result); }
      else if (message.id != null && message.method) child.stdin.write(JSON.stringify({id: message.id, error: {code: -32601, message: 'Account-only connection'}}) + '\n');
    } catch { fail(); }
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    if (child.exitCode != null || child.killed) { reject(new Error('Codex account usage is unavailable.')); return; }
    const id = ++nextId; pending.set(id, {resolve, reject});
    child.stdin.write(JSON.stringify({id, method, params}) + '\n');
  });
  try {
    await request('initialize', {clientInfo: {name: 'clawdad_usage', version: '0.7.0'}});
    child.stdin.write(JSON.stringify({method: 'initialized', params: {}}) + '\n');
    const before = await request('account/read', {refreshToken: false});
    if (before.account?.type !== 'chatgpt') throw new Error('Sign in to Codex with a ChatGPT account to see its weekly allowance.');
    const result = await request('account/rateLimits/read');
    const after = await request('account/read', {refreshToken: false});
    if (JSON.stringify(before.account) !== JSON.stringify(after.account)) throw new Error('The Codex account changed. Checking again.');
    const reading=normalizeWeeklyUsage(result, {account:after.account});
    if(accountLaunch&&reading.accountKey!==accountLaunch.account?.key)throw new Error('The selected Codex account no longer matches its verified allowance identity. Check the saved sign-in.');
    return reading;
  } finally { clearTimeout(timer); lines.close(); child.stdin.end(); child.kill(); }
}

export function normalizeWeeklyUsage(value, {account} = {}) {
  // New servers identify the account that produced these limits. Do not infer
  // identity from a tab, directory, plan, or an unbound cached transcript.
  if (typeof value?.accountId !== 'string' || !value.accountId.trim()) throw new Error('Codex did not identify the account for this allowance. Update Codex and retry.');
  const bucket = value.rateLimitsByLimitId?.codex ?? value.rateLimits;
  if (bucket?.limitId !== 'codex') throw new Error('The Codex weekly allowance is unavailable.');
  const windows = [bucket.primary, bucket.secondary].filter(window => window?.windowDurationMins === 10080);
  if (windows.length !== 1) throw new Error('Codex did not return a single weekly allowance window.');
  const {usedPercent, resetsAt} = windows[0];
  if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100 ||
      !Number.isSafeInteger(resetsAt) || resetsAt <= 0 || resetsAt >= 100_000_000_000) throw new Error('Codex returned an invalid weekly allowance.');
  const safe = (text,max=254) => typeof text==='string' && text.length<=max && !/[\x00-\x1f\x7f]/.test(text) ? text : null;
  const short=[bucket.primary,bucket.secondary].find(w=>Number.isSafeInteger(w?.windowDurationMins)&&w.windowDurationMins>0&&w.windowDurationMins<10080);
  const detail=account ? {
    subscription:{method:account.type==='chatgpt'?'chatgpt':'unknown',email:safe(account.email),plan:safe(account.planType,80),
      workspaceName:null,workspaceStatus:'not_exposed',identitySource:'account/read + account/rateLimits/read'},
    ordinaryUsageAllowed:typeof value.ordinaryUsageAllowed==='boolean'?value.ordinaryUsageAllowed:null,
    rateLimitReachedType:safe(bucket.rateLimitReachedType,100),spendControlReached:typeof bucket.spendControlReached==='boolean'?bucket.spendControlReached:null,
    shortWindow:short&&Number.isFinite(short.usedPercent)&&short.usedPercent>=0&&short.usedPercent<=100&&Number.isSafeInteger(short.resetsAt)
      ? {remainingPercent:100-short.usedPercent,resetsAt:short.resetsAt,windowDurationMins:short.windowDurationMins}:null,
  } : {};
  return {accountKey: hash('codex-account:' + value.accountId), remainingPercent: 100 - usedPercent, resetsAt,...detail};
}

export class CodexWeeklyUsageMonitor {
  constructor({statePath, read = readCodexAccountUsage, clock = Date.now, intervalMs = 120_000}) {
    Object.assign(this, {statePath, read, clock, intervalMs});
    this.state = null; this.pending = null; this.lastAttempt = 0; this.current = false; this.error = ''; this.timer = null;
    this.loading = null;
  }
  async load() {
    if (this.state) return;
    if (!this.loading) this.loading = (async () => {
      let state;
      try { state = JSON.parse(await fs.readFile(this.statePath, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw new Error('The weekly allowance checkpoint needs repair.'); }
      state ||= {version: 1, reading: null, accounts: {}, alerts: []};
      if (state.version !== 1 || !state.accounts || !Array.isArray(state.alerts)) throw new Error('The weekly allowance checkpoint needs repair.');
      this.state = state;
    })().finally(() => { this.loading = null; });
    return this.loading;
  }
  async save() {
    await fs.mkdir(path.dirname(this.statePath), {recursive: true, mode: 0o700});
    const temp = this.statePath + '.' + process.pid + '.tmp';
    await fs.writeFile(temp, JSON.stringify(this.state), {mode: 0o600}); await fs.rename(temp, this.statePath);
  }
  async sample() {
    await this.load(); this.lastAttempt = this.clock();
    const checkpoint = structuredClone(this.state);
    try {
      const reading = await this.read(), now = this.clock();
      if (reading.resetsAt * 1000 > now + 8 * 86400_000) throw new Error('Codex returned an invalid weekly reset date.');
      if (reading.resetsAt * 1000 <= now) throw new Error('Waiting for Codex to confirm the weekly reset.');
      const previous = this.state.accounts[reading.accountKey];
      // The account endpoint can correct a still-future reset in either
      // direction. Use that authoritative reading without rearming alerts.
      // A reset date correction or an early bonus reset alone does not rearm
      // the weekly alerts. A later cycle after the observed boundary does.
      const newCycle = !previous || (now >= previous.resetsAt * 1000 && reading.resetsAt > previous.resetsAt);
      const cycle = newCycle ? {resetsAt: reading.resetsAt, cycle: reading.resetsAt, low: false, empty: false} : {...previous, resetsAt: reading.resetsAt};
      let threshold;
      if (reading.remainingPercent === 0 && !cycle.empty) { threshold = 0; cycle.empty = true; cycle.low = true; }
      else if (reading.remainingPercent > 0 && reading.remainingPercent <= 5 && !cycle.low) { threshold = 5; cycle.low = true; }
      if (threshold != null) {
        const id = hash(`${reading.accountKey}:${cycle.cycle}:${threshold}`);
        if (!this.state.alerts.some(alert => alert.id === id)) this.state.alerts.push({id, kind: 'codex_weekly', threshold,
          accountKey: reading.accountKey, cycle: cycle.cycle, remainingPercent: reading.remainingPercent, resetsAt: reading.resetsAt,
          completedAt: new Date(now).toISOString(), delivered: false});
      }
      this.state.accounts[reading.accountKey] = cycle;
      this.state.reading = {...reading, observedAt: new Date(now).toISOString(), cycle: cycle.cycle};
      await this.save(); this.current = true; this.error = '';
    } catch (error) { this.state = checkpoint; this.current = false; this.error = error.message || 'Weekly allowance is unavailable.'; }
  }
  tick() {
    if (!this.pending) this.pending = this.sample().catch(() => {
      this.current = false; this.error = 'The weekly allowance checkpoint needs repair.';
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
  async freshReading() {
    await this.tick();
    const reading = this.state?.reading;
    if (!this.current || !reading || this.clock() - Date.parse(reading.observedAt) > weeklyUsageFreshMs || this.clock() >= reading.resetsAt * 1000) {
      throw new Error(this.error || 'A fresh weekly Codex allowance is required.');
    }
    return structuredClone(reading);
  }
  async snapshot() {
    await this.load();
    if (!this.lastAttempt || this.clock() - this.lastAttempt >= this.intervalMs) void this.tick();
    const reading = this.state.reading;
    const fresh = this.current && reading && this.clock() - Date.parse(reading.observedAt) <= weeklyUsageFreshMs && this.clock() < reading.resetsAt * 1000;
    return {status: fresh ? 'current' : reading ? 'stale' : 'unavailable', source: 'account/rateLimits/read',
      accountKey:reading?.accountKey??null,subscription:reading?.subscription??null,
      ordinaryUsageAllowed:reading?.ordinaryUsageAllowed??null,rateLimitReachedType:reading?.rateLimitReachedType??null,
      shortWindow:reading?.shortWindow??null,
      remainingPercent: reading?.remainingPercent ?? null, resetsAt: reading?.resetsAt ?? null,
      observedAt: reading?.observedAt ?? null, validUntil: reading ? Math.min(Date.parse(reading.observedAt) + weeklyUsageFreshMs, reading.resetsAt * 1000) : null,
      message: fresh ? '' : this.error || 'Checking the signed-in Codex account…',
      alerts: this.state.alerts.filter(alert => reading && alert.accountKey === reading.accountKey && alert.cycle === reading.cycle)
        .map(({delivered, accountKey, ...alert}) => alert)};
  }
  async outbox() {
    if (this.pending) await this.pending;
    await this.load();
    return this.state.alerts.filter(alert => !alert.delivered && this.clock() - Date.parse(alert.completedAt) < 86400_000)
      .filter(alert => alert.threshold !== 5 || !this.state.alerts.some(later => later.accountKey === alert.accountKey && later.cycle === alert.cycle && later.threshold === 0))
      .map(({accountKey, delivered, ...alert}) => alert);
  }
  async delivered(id) {
    if (this.pending) await this.pending;
    await this.load(); const alert = this.state.alerts.find(alert => alert.id === id);
    if (alert && !alert.delivered) { alert.delivered = true; await this.save(); }
  }
  start() { void this.tick(); this.timer = setInterval(() => { void this.tick(); }, this.intervalMs); this.timer.unref?.(); }
  stop() { clearInterval(this.timer); }
}
