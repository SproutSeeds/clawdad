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

// One serialized admission ledger for every Terminal supervisor on this Mac.
// A reset updates usage, never this latch. Running Terminal work is untouched.
export class ResearchBudget {
  constructor({file, usage, clock = Date.now}) {
    Object.assign(this, {file, usage, clock}); this.state = null; this.lock = Promise.resolve();
  }
  transaction(fn) {
    const operation = this.lock.then(async () => {
      if (!this.state) {
        try { this.state = JSON.parse(await fs.readFile(this.file, 'utf8')); }
        catch (e) { if (e.code !== 'ENOENT') throw Error('The autonomy budget ledger needs repair.'); }
        this.state ||= {version:1, accounts:{}, events:[], receipts:{}};
        if (this.state.version !== 1 || !this.state.accounts || !Array.isArray(this.state.events)) throw Error('The autonomy budget ledger needs repair.');
      }
      return fn();
    });
    this.lock = operation.catch(()=>{}); return operation;
  }
  async save() { await researchSave(this.file, this.state); }
  async observe(accountKey, {fresh = true} = {}) {
    let reading;
    if (!fresh && this.usage.snapshot) {
      const status = await this.usage.snapshot();
      if (status.status !== 'current') throw Error(status.message || 'Weekly usage is stale. Autonomy is paused.');
      reading = structuredClone(this.usage.state.reading);
    } else reading = await this.usage.freshReading();
    if (accountKey && reading.accountKey !== accountKey) throw Error('The signed-in Codex account changed. Review this thread’s authorization.');
    let account = this.state.accounts[reading.accountKey];
    if (!account) account = this.state.accounts[reading.accountKey] = {threshold:20, latch:null, override:null, grants:{}};
    if (reading.remainingPercent <= 20 && !account.latch) {
      const id = researchHash(`${reading.accountKey}:autonomy:${randomUUID()}`);
      account.latch = {id, at:new Date(this.clock()).toISOString(), remainingPercent:reading.remainingPercent, cycle:reading.cycle};
      this.state.events.push({id, kind:'research', event:'budget', accountKey:reading.accountKey,
        completedAt:account.latch.at, remainingPercent:reading.remainingPercent, delivered:false});
    }
    account.reading = reading;
    await this.save();
    return {account, reading};
  }
  check({accountKey, threadId, kind = 'review', requestId, reviewId}) {
    return this.transaction(async () => {
      const {account, reading} = await this.observe(accountKey);
      let override = null;
      if (account.latch) {
        override = account.override;
        if (!override || !override.threadIds.includes(threadId) || override.cycle !== reading.cycle ||
            this.clock() >= override.expiresAt || reading.remainingPercent <= override.threshold ||
            (kind === 'review' ? override.remainingReviews < 1 && !account.grants[requestId] : !account.grants[reviewId] || account.grants[reviewId].overrideId !== override.id)) {
          throw Error('Autonomy is paused at the account’s 20% reserve. Explicitly approve a bounded budget override to continue. Running tasks may use additional allowance.');
        }
      }
      if (kind === 'review' && !account.grants[requestId]) {
        if (override) override.remainingReviews--;
        account.grants[requestId] = {accountKey:reading.accountKey, overrideId:override?.id || null, at:this.clock(), remainingPercent:reading.remainingPercent};
        await this.save();
      }
      return {...reading, grant:account.grants[requestId] || account.grants[reviewId] || null};
    });
  }
  // Merely viewing status never grants an override or lifts a reserve pause.
  async snapshot() {
    return this.transaction(() => ({accounts:Object.entries(this.state.accounts).map(([accountKey,a])=>({accountKey,
      reading:a.reading, latched:!!a.latch, latch:a.latch, override:a.override})), events:this.state.events.map(({delivered,...e})=>e)}));
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
      const override = {id:requestId, accountKey, threadIds, threshold, maxReviews, remainingReviews:maxReviews,
        cycle:reading.cycle, expiresAt:Math.min(reading.resetsAt*1000, this.clock()+86400_000), approvedAt:new Date(this.clock()).toISOString()};
      account.override = override;
      this.state.receipts[requestId] = {fingerprint, override:structuredClone(override)};
      await this.save(); return this.state.receipts[requestId];
    });
  }
  async outbox() { return this.transaction(()=>this.state.events.filter(e=>!e.delivered)); }
  async delivered(id) { return this.transaction(async()=>{const e=this.state.events.find(e=>e.id===id);if(e){e.delivered=true;await this.save();}}); }
}
