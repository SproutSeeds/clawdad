import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

export const researchHash = value => createHash('sha256').update(value).digest('hex');
export async function researchSave(file, value) {
  await fs.mkdir(path.dirname(file), {recursive:true, mode:0o700});
  const temp = file + '.' + randomUUID() + '.tmp';
  const handle = await fs.open(temp, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temp, file);
}

const validThreshold = value => Number.isInteger(value) && value >= 0 && value <= 100;
const emptyAccount = () => ({threshold:20, revision:0, latch:null, override:null, grants:{}, policies:{}});
const iso = clock => new Date(clock()).toISOString();

// One serialized ledger for the actual signed-in account. Percentages are
// stopping levels of the SHARED weekly allowance, never private usage pools.
export class ResearchBudget {
  constructor({file, usage, clock = Date.now}) {
    Object.assign(this, {file, usage, clock}); this.state = null; this.lock = Promise.resolve();
  }
  transaction(fn) {
    const operation = this.lock.then(async () => {
      if (!this.state) {
        let loaded;
        try { loaded = JSON.parse(await fs.readFile(this.file, 'utf8')); }
        catch (e) { if (e.code !== 'ENOENT') throw Error('The autonomy budget ledger needs repair.'); }
        loaded ||= {version:1, accounts:{}, events:[], receipts:{}};
        if (loaded.version !== 1 || !loaded.accounts || !Array.isArray(loaded.events)) throw Error('The autonomy budget ledger needs repair.');
        for (const account of Object.values(loaded.accounts)) {
          account.revision ??= 0; account.policies ||= {};
          if (!validThreshold(account.threshold) || !Number.isSafeInteger(account.revision) || account.revision < 0 ||
              Object.values(account.policies).some(p=>!['default','override'].includes(p?.mode) ||
                (p.mode==='override'&&(!validThreshold(p.threshold)||!Number.isFinite(p.expiresAt)||!Number.isFinite(p.cycle)))))
            throw Error('The saved autonomy stopping percentage needs repair.');
        }
        this.state = loaded;
      }
      return fn();
    });
    this.lock = operation.catch(()=>{}); return operation;
  }
  async save() { await researchSave(this.file, this.state); }
  updateLimits(account, reading) {
    if (reading.remainingPercent <= account.threshold && !account.latch) {
      const id = researchHash(`${reading.accountKey}:autonomy:${randomUUID()}`);
      account.latch = {id, at:iso(this.clock), remainingPercent:reading.remainingPercent, threshold:account.threshold, cycle:reading.cycle};
      this.state.events.push({id, kind:'research', event:'budget', accountKey:reading.accountKey,
        completedAt:account.latch.at, remainingPercent:reading.remainingPercent, delivered:false});
    }
    for (const policy of Object.values(account.policies)) {
      if (policy.mode !== 'override' || policy.latch) continue;
      const expired = policy.cycle !== reading.cycle || this.clock() >= policy.expiresAt;
      if (expired || reading.remainingPercent <= policy.threshold) policy.latch = {
        at:iso(this.clock), reason:expired?'expired':'threshold', cycle:reading.cycle, remainingPercent:reading.remainingPercent};
    }
  }
  async observe(accountKey, {fresh = true} = {}) {
    let reading;
    if (!fresh && this.usage.snapshot) {
      const status = await this.usage.snapshot();
      if (status.status !== 'current') throw Error(status.message || 'Weekly usage is stale. Autonomy is paused.');
      reading = structuredClone(this.usage.state.reading);
    } else reading = await this.usage.freshReading();
    if (accountKey && reading.accountKey !== accountKey) throw Error('The signed-in Codex account changed. Review this thread’s authorization.');
    const account = this.state.accounts[reading.accountKey] ||= emptyAccount();
    account.reading = reading;
    this.updateLimits(account, reading);
    await this.save();
    return {account, reading};
  }
  policyStatus(account, reading, threadId) {
    const policy = account.policies?.[threadId];
    if (policy?.mode === 'override') {
      const expired = policy.latch?.reason === 'expired' || policy.cycle !== reading?.cycle || this.clock() >= policy.expiresAt;
      const paused = expired || !!policy.latch || reading?.remainingPercent <= policy.threshold;
      return {mode:'override', threshold:policy.threshold, paused, expired, cycle:policy.cycle, expiresAt:policy.expiresAt,
        approvedAt:policy.approvedAt, requestId:policy.id,
        reason:expired?'This supervisor’s override expired at the weekly reset. Explicitly approve a new limit or choose the shared default.':
          paused?`This supervisor paused at its ${policy.threshold}% weekly allowance reserve. Explicitly approve a limit before resuming. Running tasks may use more.`:''};
    }
    // Preserve legacy, time/review-bounded grants for older installed clients.
    const legacy = !policy && account.override?.threadIds.includes(threadId) ? account.override : null;
    if (legacy && account.latch) {
      const expired = legacy.cycle !== reading?.cycle || this.clock() >= legacy.expiresAt;
      return {mode:'legacy_override', threshold:legacy.threshold, paused:expired || reading?.remainingPercent <= legacy.threshold,
        expired, cycle:legacy.cycle, expiresAt:legacy.expiresAt, remainingReviews:legacy.remainingReviews,
        reason:expired?'The previous bounded allowance override expired. Approve a current stopping percentage.':
          reading?.remainingPercent <= legacy.threshold?'The previous allowance override reached its reserve. Approve a current stopping percentage.':''};
    }
    const paused = !!account.latch || reading?.remainingPercent <= account.threshold;
    return {mode:'default', threshold:account.threshold, paused, expired:false,
      reason:paused?`Autonomy is paused at the account’s ${account.threshold}% reserve. Explicitly approve the shared limit or a per-supervisor override to continue. Running tasks may use additional allowance.`:''};
  }
  check({accountKey, threadId, kind = 'review', requestId, reviewId}) {
    return this.transaction(async () => {
      const {account, reading} = await this.observe(accountKey);
      const policy = this.policyStatus(account, reading, threadId);
      if (policy.paused) throw Error(policy.reason);
      const override = policy.mode === 'legacy_override' ? account.override : null;
      if (override && (kind === 'review'
          ? override.remainingReviews < 1 && !account.grants[requestId]
          : !account.grants[reviewId] || account.grants[reviewId].overrideId !== override.id))
        throw Error(`Autonomy is paused at the account’s ${account.threshold}% reserve. The previous bounded review grant has ended; approve a current limit.`);
      if (kind === 'review' && !account.grants[requestId]) {
        if (override) override.remainingReviews--;
        account.grants[requestId] = {accountKey:reading.accountKey, threadId, overrideId:override?.id || null, at:this.clock(), remainingPercent:reading.remainingPercent};
        await this.save();
      }
      const grant = account.grants[requestId] || account.grants[reviewId] || null;
      if (grant?.threadId && grant.threadId !== threadId) throw Error('That review receipt belongs to a different supervisor.');
      return {...reading, policy, grant};
    });
  }
  // Viewing status never approves listening, work, or a budget. Include a
  // virtual default for a newly observed account without creating a grant.
  async snapshot() {
    const usage = this.usage.snapshot ? await this.usage.snapshot() : null;
    const currentReading = this.usage.state?.reading;
    return this.transaction(() => {
      const accounts = {...this.state.accounts};
      if (currentReading && !accounts[currentReading.accountKey]) accounts[currentReading.accountKey] = {...emptyAccount(), reading:currentReading};
      return {available:true, currentAccountKey:currentReading?.accountKey || null, usage,
        accounts:Object.entries(accounts).map(([accountKey,a])=>({accountKey, threshold:a.threshold, revision:a.revision,
          reading:currentReading?.accountKey===accountKey?currentReading:a.reading,
          latched:!!a.latch, latch:a.latch, override:a.override, policies:structuredClone(a.policies)})),
        events:this.state.events.map(({delivered,...e})=>e)};
    });
  }
  change({requestId, accountKey, scope, threadId, mode, threshold, expectedBudgetRevision, confirmed, authorization}) {
    return this.transaction(async () => {
      if (confirmed !== true || !/^[a-f0-9]{64}$/.test(accountKey || '') ||
          !['account_default','supervisor'].includes(scope) || !Number.isSafeInteger(expectedBudgetRevision) || expectedBudgetRevision < 0 ||
          (scope === 'account_default' ? threadId !== undefined || mode !== undefined || !validThreshold(threshold)
            : !/^[a-f0-9]{64}$/.test(threadId || '') || !['default','override'].includes(mode) ||
              (mode === 'override' ? !validThreshold(threshold) : threshold !== undefined)))
        throw Error('Confirm the exact account, shared default or supervisor, current budget revision, and a stopping percentage from 0–100%.');
      const fingerprint = JSON.stringify({accountKey,scope,threadId,mode,threshold,expectedBudgetRevision,confirmed});
      if (this.state.receipts[requestId]) {
        if (this.state.receipts[requestId].fingerprint !== fingerprint) throw Error('That budget request ID was already used.');
        return structuredClone(this.state.receipts[requestId]);
      }
      const {account, reading} = await this.observe(accountKey);
      if (account.revision !== expectedBudgetRevision) throw Error('The allowance settings changed. Refresh research_status and use the current budget revision.');
      const previous = scope === 'account_default' ? {threshold:account.threshold,latch:structuredClone(account.latch)} : structuredClone(account.policies[threadId] || null);
      account.revision++;
      if (scope === 'account_default') {
        account.threshold = threshold;
        // Only this explicit account-scoped approval releases the shared latch.
        // Reset, reconnect, resume and installation never do so.
        if (reading.remainingPercent > threshold) account.latch = null;
      } else {
        account.policies[threadId] = {id:requestId, mode, ...(mode === 'override' ? {threshold,cycle:reading.cycle,expiresAt:reading.resetsAt*1000} : {}),
          approvedAt:iso(this.clock), latch:null};
      }
      this.updateLimits(account, reading);
      const receipt = {requestId, fingerprint, accountKey, scope, threadId, mode, threshold,
        revision:account.revision, previous, policy:scope === 'supervisor'?structuredClone(account.policies[threadId]):{threshold:account.threshold},
        reading:structuredClone(reading), authorization, approvedAt:iso(this.clock)};
      this.state.receipts[requestId] = receipt;
      await this.save();
      return structuredClone(receipt);
    });
  }
  authorize({requestId, accountKey, threadIds, threshold, maxReviews, confirmed}) {
    return this.transaction(async () => {
      if (confirmed !== true || !/^[a-f0-9]{64}$/.test(accountKey || '') || !Array.isArray(threadIds) || !threadIds.length || threadIds.length > 30 ||
          new Set(threadIds).size !== threadIds.length || threadIds.some(id=>typeof id!=='string') || !Number.isInteger(threshold) || threshold < 0 || threshold > 20 ||
          !Number.isInteger(maxReviews) || maxReviews < 1 || maxReviews > 20) throw Error('Confirm an account, selected threads, reserve from 0–20%, and a limit of 1–20 reviews.');
      const fingerprint = JSON.stringify({accountKey,threadIds,threshold,maxReviews,confirmed});
      if (this.state.receipts[requestId]) {
        if (this.state.receipts[requestId].fingerprint !== fingerprint) throw Error('That budget request ID was already used.');
        return this.state.receipts[requestId];
      }
      const {account, reading} = await this.observe(accountKey);
      if (reading.remainingPercent <= threshold) throw Error('Choose a reserve below the current remaining allowance, or wait for more allowance.');
      if (!account.latch) throw Error('The reserve has not paused autonomy; no override is needed.');
      if (threadIds.some(id=>account.policies[id])) throw Error('Use the updated shared-default and per-supervisor allowance controls for this thread.');
      const override = {id:requestId, accountKey, threadIds, threshold, maxReviews, remainingReviews:maxReviews,
        cycle:reading.cycle, expiresAt:Math.min(reading.resetsAt*1000, this.clock()+86400_000), approvedAt:iso(this.clock)};
      account.override = override; account.revision++;
      this.state.receipts[requestId] = {fingerprint, override:structuredClone(override)};
      await this.save(); return this.state.receipts[requestId];
    });
  }
  activeEvents() { return (this.state?.events || []).filter(e=>this.state.accounts[e.accountKey]?.latch?.id===e.id); }
  async outbox() { return this.transaction(()=>this.activeEvents().filter(e=>!e.delivered)); }
  async delivered(id) { return this.transaction(async()=>{const e=this.state.events.find(e=>e.id===id);if(e){e.delivered=true;await this.save();}}); }
}
