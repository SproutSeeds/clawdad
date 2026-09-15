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
const emptyAccount = () => ({threshold:null, revision:0, latch:null, override:null, grants:{}, policies:{}});
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
        loaded ||= {version:2, accounts:{}, events:[], receipts:{}};
        if (![1,2].includes(loaded.version) || !loaded.accounts || !Array.isArray(loaded.events)) throw Error('The autonomy budget ledger needs repair.');
        const migrating = loaded.version === 1;
        // Retain the complete former account policies in this atomic checkpoint.
        // No default is copied onto a project and no supervisor is resumed here.
        if (migrating) loaded.retiredAccountDefaults = {at:iso(this.clock), accounts:structuredClone(loaded.accounts)};
        for (const account of Object.values(loaded.accounts)) {
          account.revision ??= 0; account.policies ||= {};
          if (!(migrating ? validThreshold(account.threshold) : account.threshold === null) || !Number.isSafeInteger(account.revision) || account.revision < 0 ||
              Object.values(account.policies).some(p=>!['none','default','override'].includes(p?.mode) ||
                (p.mode==='override'&&(!validThreshold(p.threshold)||!Number.isFinite(p.expiresAt)||!Number.isFinite(p.cycle)))))
            throw Error('The saved autonomy stopping percentage needs repair.');
          if (migrating) {
            // Legacy explicit grants were already limited to named threads,
            // review counts and expiry. Keep those exact authorizations bounded.
            const grant=account.override;
            account.legacyGrants=grant?{[grant.id]:structuredClone(grant)}:{};
            if(grant) for(const threadId of grant.threadIds || []) if(!account.policies[threadId])
              account.policies[threadId]={...structuredClone(grant),mode:'override',legacyGrantId:grant.id,latch:null};
            for(const policy of Object.values(account.policies)) if(policy.mode==='default') policy.mode='none';
            account.threshold=null; account.latch=null; account.override=null; account.revision++;
          }
        }
        loaded.version=2; loaded.receipts ||= {};
        this.state = loaded;
        if(migrating) {
          try { await this.save(); }
          catch(error) { this.state=null; throw error; }
        }
      }
      return fn();
    });
    this.lock = operation.catch(()=>{}); return operation;
  }
  async save() { await researchSave(this.file, this.state); }
  updateLimits(account, reading) {
    for (const [threadId,policy] of Object.entries(account.policies)) {
      if (policy.mode !== 'override' || policy.latch) continue;
      const expired = policy.cycle !== reading.cycle || this.clock() >= policy.expiresAt;
      if (expired || reading.remainingPercent <= policy.threshold) {
        const id=researchHash(`${reading.accountKey}:${threadId}:${policy.id}:budget`);
        policy.latch = {id,at:iso(this.clock), reason:expired?'expired':'threshold', cycle:reading.cycle, remainingPercent:reading.remainingPercent};
        if(!this.state.events.some(e=>e.id===id)) this.state.events.push({id,kind:'research',event:'budget',accountKey:reading.accountKey,
          threadId,threshold:policy.threshold,completedAt:policy.latch.at,remainingPercent:reading.remainingPercent,delivered:false});
      }
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
        reason:expired?'This supervisor’s override expired at the weekly reset. Explicitly approve a new project limit or choose no project limit.':
          paused?`This supervisor paused at its ${policy.threshold}% weekly allowance reserve. Explicitly approve a limit before resuming. Running tasks may use more.`:''};
    }
    return {mode:'none',threshold:null,paused:false,expired:false,reason:''};
  }
  check({accountKey, threadId, kind = 'review', requestId, reviewId}) {
    return this.transaction(async () => {
      const {account, reading} = await this.observe(accountKey);
      if(reading.ordinaryUsageAllowed===false) throw Error('Codex reports that subscription usage is unavailable. New research work is paused; check the account allowance.');
      const policy = this.policyStatus(account, reading, threadId);
      if (policy.paused) throw Error(policy.reason);
      const selected=account.policies[threadId];
      const override = selected?.legacyGrantId ? account.legacyGrants?.[selected.legacyGrantId] : null;
      const priorGrant=account.grants[requestId] || account.grants[reviewId];
      if(priorGrant?.threadId && priorGrant.threadId!==threadId) throw Error('That review receipt belongs to a different supervisor.');
      if (override && (kind === 'review'
          ? override.remainingReviews < 1 && !account.grants[requestId]
          : !account.grants[reviewId] || account.grants[reviewId].overrideId !== override.id))
        throw Error('The previous bounded review grant has ended. Approve a current project limit.');
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
      return {available:true,version:2,accountDefaultSupported:false,defaultPolicy:'none', currentAccountKey:currentReading?.accountKey || null, usage,
        accounts:Object.entries(accounts).map(([accountKey,a])=>({accountKey, threshold:a.threshold, revision:a.revision,
          reading:currentReading?.accountKey===accountKey?currentReading:a.reading,
          latched:false, latch:null, override:null, policies:structuredClone(a.policies)})),
        events:this.state.events.map(({delivered,...e})=>e)};
    });
  }
  change({requestId, accountKey, scope, threadId, mode, threshold, expectedBudgetRevision, confirmed, authorization}) {
    return this.transaction(async () => {
      const fingerprint = JSON.stringify({accountKey,scope,threadId,mode,threshold,expectedBudgetRevision,confirmed});
      if (this.state.receipts[requestId]) {
        if (this.state.receipts[requestId].fingerprint !== fingerprint) throw Error('That budget request ID was already used.');
        return structuredClone(this.state.receipts[requestId]);
      }
      if(scope==='account_default') throw Error('App-wide research stopping limits have been removed. Choose an exact supervisor and set its optional project limit.');
      // Older clients used default to remove an override. It now explicitly
      // means no project limit; it cannot restore the retired global reserve.
      if(mode==='default')mode='none';
      if (confirmed !== true || !/^[a-f0-9]{64}$/.test(accountKey || '') ||
          scope!=='supervisor' || !Number.isSafeInteger(expectedBudgetRevision) || expectedBudgetRevision < 0 ||
          !/^[a-f0-9]{64}$/.test(threadId || '') || !['none','override'].includes(mode) ||
          (mode === 'override' ? !validThreshold(threshold) : threshold !== undefined))
        throw Error('Confirm the exact supervisor and account, current budget revision, and no project limit or a stopping percentage from 0–100%.');
      const {account, reading} = await this.observe(accountKey);
      if (account.revision !== expectedBudgetRevision) throw Error('The allowance settings changed. Refresh research_status and use the current budget revision.');
      const previous = structuredClone(account.policies[threadId] || null);
      account.revision++;
      account.policies[threadId] = {id:requestId, mode, ...(mode === 'override' ? {threshold,cycle:reading.cycle,expiresAt:reading.resetsAt*1000} : {}),
          approvedAt:iso(this.clock), latch:null};
      this.updateLimits(account, reading);
      const receipt = {requestId, fingerprint, accountKey, scope, threadId, mode, threshold,
        revision:account.revision, previous, policy:structuredClone(account.policies[threadId]),
        reading:structuredClone(reading), authorization, approvedAt:iso(this.clock)};
      this.state.receipts[requestId] = receipt;
      await this.save();
      return structuredClone(receipt);
    });
  }
  authorize({requestId,accountKey,threadIds,threshold,maxReviews,confirmed}={}) {
    return this.transaction(()=>{
      // An old client may reconcile an accepted bounded grant after upgrading.
      // Returning its original receipt does not approve a new global reserve.
      const prior=this.state.receipts[requestId];
      if(prior){
        const fingerprint=JSON.stringify({accountKey,threadIds,threshold,maxReviews,confirmed});
        if(prior.fingerprint!==fingerprint)throw Error('That budget request ID was already used.');
        return structuredClone(prior);
      }
      throw Error('App-wide research reserves have been removed. Use the exact supervisor’s optional project limit.');
    });
  }
  activeEvents() { return (this.state?.events || []).filter(e=>this.state.accounts[e.accountKey]?.policies[e.threadId]?.latch?.id===e.id); }
  async outbox() { return this.transaction(()=>this.activeEvents().filter(e=>!e.delivered)); }
  async delivered(id) { return this.transaction(async()=>{const e=this.state.events.find(e=>e.id===id);if(e){e.delivered=true;await this.save();}}); }
}
