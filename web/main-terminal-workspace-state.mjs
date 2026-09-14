// Pure view policy; native code remains the authority for identity and writes.
export function chooseWindow(windows, selected, allowSingle = false) {
  if (selected) return {id: selected, window: windows.find(w => w.id === selected) || null};
  return allowSingle && windows.length === 1 ? {id: windows[0].id, window: windows[0]} : {id: '', window: null};
}
export function reviewSnapshot(state, id) {
  if (!id || state.selectedSnapshotId !== id || !Number.isInteger(state.snapshotRevision)) return null;
  return structuredClone({id, revision: state.snapshotRevision, libraryRevision: state.revision,
    name: state.namedSnapshots?.find(s => s.id === id)?.name || 'Saved setup',
    entries: state.entries || [], snapshots: state.snapshots || [], savedAt: state.savedAt});
}
export function staleReview(review, state) {
  return !!review && state.namedSnapshots?.find(s => s.id === review.id)?.revision !== review.revision;
}
export function restoreArguments(review, state, extra = {}) {
  if (!review || staleReview(review, state)) throw Error('This setup changed. Review the latest saved version before restoring.');
  return {...extra, snapshotId: review.id, expectedSnapshotRevision: review.revision};
}
const identity = row => row.kind === 'codex' ? `codex:${row.sessionId}:${row.directory}` : `shell:${row.tty || row.originTTY}:${row.directory}`;
export function lineupChanges(previous, current) {
  const prior = new Set(previous.map(identity)), next = new Set(current.map(identity));
  return {removed: previous.filter(e => !next.has(identity(e))), added: current.filter(e => !prior.has(identity(e)))};
}
export function pendingRequest(action, args, id = crypto.randomUUID()) {
  return {action, args: structuredClone(args), id};
}
