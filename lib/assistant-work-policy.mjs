// No total-turn deadline: long useful work may continue. Only a prolonged lack
// of observable progress stops the coordinator, with an honest uncertain state.
export const assistantWorkPolicy = Object.freeze({
  startupMs: 180_000,
  quietMs: 120_000,
  stalledMs: 30 * 60_000,
  checkMs: 1000,
});

export class AssistantWorkProgress {
  constructor({clock = performance.now.bind(performance), ...policy} = {}) {
    this.clock = clock; this.policy = {...assistantWorkPolicy, ...policy};
    this.startedAt = this.lastProgressAt = clock(); this.observed = false;
    this.previous = new Map(); this.stage = 'starting';
  }
  observe(event) {
    if (!['thread.started','turn.started','item.started','item.updated','item.completed','turn.completed','turn.failed'].includes(event?.type)) return false;
    const slot = `${event.type}:${event.item?.id || ''}`;
    const value = JSON.stringify(event);
    if (this.previous.get(slot) === value) return false;
    this.previous.set(slot, value);
    if (this.previous.size > 256) this.previous.delete(this.previous.keys().next().value);
    this.observed = true; this.lastProgressAt = this.clock();
    this.stage = event.item?.type === 'mcp_tool_call' || event.item?.type === 'command_execution' ? 'using_tools' : 'responding';
    return true;
  }
  status() {
    const silentMs = Math.max(0, this.clock() - this.lastProgressAt);
    return {stage: !this.observed ? 'starting' : silentMs >= this.policy.quietMs ? 'quiet' : this.stage,
      elapsedMs: Math.max(0, this.clock() - this.startedAt), silentMs,
      stalled: silentMs >= (this.observed ? this.policy.stalledMs : this.policy.startupMs)};
  }
}
