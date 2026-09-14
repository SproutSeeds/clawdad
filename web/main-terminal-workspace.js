import {chooseWindow, reviewSnapshot, staleReview, restoreArguments, lineupChanges, pendingRequest} from './main-terminal-workspace-state.mjs';

// This view sends only explicit user actions. All identity checks, snapshots and
// restore journals remain in the existing native workspace implementation.
const $ = id => document.getElementById(id);
const dialog = $('mainWorkspaceDialog');
if (dialog) {
  let state = {}, selected = '', chosenWindow = '', reuseWindow = '', pending = null;
  let reviewed = null, preview = null, updating = null, mode = 'open', opener;
  let timer, refreshing = false, sending = false, renderKey = '', previewKey = '';
  let preferencesLoaded = false, nativeStorage = false, persistChain = Promise.resolve();
  const storeKey = 'clawdad.workspace.desktop.v1';
  const error = message => { $('mainWorkspaceError').textContent = message || ''; };
  const tabsLabel = count => `${count} ${count === 1 ? 'tab' : 'tabs'}`;
  const time = value => value ? new Date(value).toLocaleString() : 'Unavailable';
  const windowNow = () => chooseWindow(state.windows || [], chosenWindow).window;
  const readyPreview = () => preview && windowNow() && Date.parse(preview.expiresAt) > Date.now();
  const busy = () => !!pending || !preferencesLoaded;

  async function loadPreferences() {
    if (preferencesLoaded) return;
    nativeStorage = !!window.ClawDadNative?.isAvailable();
    const saved = nativeStorage ? (await window.ClawDadNative.call('workspaceUIState')).state : JSON.parse(localStorage.getItem(storeKey) || '{}');
    selected = saved.selected || ''; chosenWindow = saved.windowId || ''; pending = saved.pending || null;
    $('mainWorkspaceName').value = saved.name || '';
    // Reconcile a request from the previous desktop flow without dispatching it.
    if (!pending) { try { pending = JSON.parse(localStorage.getItem('clawdad.main-workspace.pending') || 'null'); } catch {} }
    await persist();
    preferencesLoaded = true;
    localStorage.removeItem('clawdad.main-workspace.pending');
  }
  function persist() {
    const value = {selected, windowId: chosenWindow, name: $('mainWorkspaceName').value, pending};
    persistChain = persistChain.catch(() => {}).then(async () => {
      if (nativeStorage) await window.ClawDadNative.call('workspaceUIState', {state: value});
      else localStorage.setItem(storeKey, JSON.stringify(value));
    });
    return persistChain;
  }
  async function request(action, args = {}, id = crypto.randomUUID()) {
    const response = await fetch('/v1/assistant/request', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({action, ...args, requestId: id})});
    const value = await response.json();
    if (!response.ok) throw Error(value.error || 'The Mac could not finish this request.');
    return value;
  }
  function options(element, choices, value, prompt) {
    const signature = JSON.stringify([choices, value, prompt]);
    if (element.dataset.signature === signature) return;
    element.dataset.signature = signature;
    element.replaceChildren(new Option(prompt, ''), ...choices.map(c => new Option(c.title, c.id)));
    if (value && !choices.some(c => c.id === value)) element.add(new Option('Previously chosen target is unavailable — choose explicitly', value));
    element.value = value;
  }
  function renderRows(container, entries, saved = false) {
    container.replaceChildren();
    for (const [index, entry] of entries.entries()) {
      const row = document.createElement('details'), title = document.createElement('summary'), info = document.createElement('p');
      const label = document.createElement('span'), directory = document.createElement('span');
      label.textContent = `${index + 1}. ${entry.name} · ${entry.kind === 'codex' ? 'Codex thread' : 'Shell only'}`;
      directory.className = 'workspace-directory'; directory.textContent = entry.directory || 'Directory unavailable';
      label.append(directory); title.append(label);
      const draft = saved ? entry.draftText : entry.draft?.text;
      const limitation = saved ? entry.draftLimitation : entry.draft?.limitation;
      info.textContent = [entry.directory, entry.sessionId && `Conversation ${entry.sessionId}`, entry.identityIssue,
        limitation, draft == null && 'Draft contents are not fully recoverable.',
        entry.pendingReceipts?.length && 'Pending or uncertain deliveries need review; queues are never replayed.'].filter(Boolean).join('\n');
      const progress = document.createElement('p'); progress.dataset.entryStatus = entry.id || ''; progress.className = 'workspace-note';
      row.append(title, info, progress);
      if (draft) {
        const text = document.createElement('pre'), copy = document.createElement('button');
        text.textContent = draft; copy.type = 'button'; copy.textContent = 'Copy saved draft';
        copy.onclick = async () => { try { await navigator.clipboard.writeText(draft); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy saved draft'; }, 1200); } catch { error('Select the draft text and use Copy.'); } };
        row.append(text, copy);
      }
      if (saved) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.workspaceMutation = 'true'; remove.textContent = 'Remove from this saved setup…';
        remove.onclick = () => {
          if (staleReview(reviewed, state)) return error('Review the latest saved version before changing its lineup.');
          if (confirm(`Remove ${entry.name} from ${reviewed.name}? Its live tab and files remain intact; a previous version is retained.`)) void perform('mainworkspace.remove', {entryId: entry.id, snapshotId: reviewed.id, expectedRevision: state.revision});
        };
        row.append(remove);
      }
      container.append(row);
    }
  }
  function render() {
    const stale = staleReview(reviewed, state), window = windowNow();
    $('mainWorkspaceTitle').textContent = mode === 'save' ? (updating ? `Update ${updating.name}` : 'Save Terminal Setup') : 'Saved Terminal Setups';
    const savePane = $('mainWorkspaceSavePane'), savedPane = $('mainWorkspaceSavedPane');
    savePane.hidden = mode !== 'save'; savedPane.hidden = mode !== 'open';
    if (dialog.dataset.workspacePane !== mode) {
      // WebKit can retain an ignored AX subtree when a previously hidden pane
      // reappears in a reopened dialog. Reattach the same nodes on mode changes
      // so accessibility rebuilds them; keep inputs, handlers and draft values.
      const activePane = mode === 'save' ? savePane : savedPane;
      activePane.remove(); dialog.append(activePane);
      dialog.dataset.workspacePane = mode;
    }
    $('mainWorkspaceBack').hidden = !updating;
    $('mainWorkspaceStatus').textContent = pending ? 'Request saved · checking progress…' : (state.status === 'restored' && mode === 'open' ? 'Setup is open. Continue when you’re ready.' : (state.message || (mode === 'save' ? 'Choose one window and review its tabs before saving.' : 'Choose a setup to see its saved tabs.')));
    $('mainWorkspaceRetry').hidden = !pending;
    options($('mainWorkspaceNamed'), (state.namedSnapshots || []).map(s => ({id: s.id, title: `${s.name} · ${tabsLabel(s.count)}${s.needsReview ? ' · Identity review needed' : ''}${s.draftWarnings ? ` · ${s.draftWarnings} draft warnings` : ''}`})), selected, 'Choose a saved setup');
    const choices = (state.windows || []).map(w => ({id: w.id, title: `${w.title} · ${tabsLabel(w.count)} · ${w.tabs.slice(0, 3).map(t => t.name).join(', ')}`}));
    options($('mainWorkspaceWindow'), choices, chosenWindow, 'Choose a Terminal window');
    options($('mainWorkspaceReuseWindow'), choices, reuseWindow, 'Choose a Terminal window');
    $('mainWorkspaceWindowState').textContent = chosenWindow && !window ? 'The reviewed window changed or is unavailable. Choose and review its current lineup; your proposed name is preserved.' : `Window list last observed: ${time(state.observedAt)}. Refresh if needed.`;
    const observedKey = JSON.stringify(window?.tabs || []);
    if ($('mainWorkspaceObserved').dataset.signature !== observedKey) {
      $('mainWorkspaceObserved').dataset.signature = observedKey;
      $('mainWorkspaceObserved').textContent = window ? window.tabs.map((t, i) => `${i + 1}. ${t.name} · ${t.directory || 'Directory awaiting inspection'}`).join('\n') : '';
      $('mainWorkspaceObserved').style.whiteSpace = 'pre-wrap';
    }
    const captureKey = JSON.stringify(preview);
    if (captureKey !== previewKey) { previewKey = captureKey; renderRows($('mainWorkspacePreview'), preview?.windowPreview?.tabs || []); }
    $('mainWorkspaceObserved').hidden = !!preview;
    if (preview && !readyPreview()) $('mainWorkspaceWindowState').textContent = 'Window review expired or the window changed. Review it again; your name is preserved.';
    const changes = updating && preview ? lineupChanges(updating.entries, preview.windowPreview.tabs) : null;
    $('mainWorkspaceChanges').textContent = changes ? `Update replaces the lineup. Removed: ${changes.removed.map(e => e.name).join(', ') || 'none'}. Added or changed identity: ${changes.added.map(e => e.name).join(', ') || 'none'}. The previous version stays recoverable.` : '';
    $('mainWorkspaceSave').textContent = updating ? 'Update this saved setup' : 'Save as new setup';
    $('mainWorkspaceSave').disabled = busy() || !readyPreview() || !$('mainWorkspaceName').value.trim() || !!(updating && staleReview(updating, state));
    $('mainWorkspaceReview').disabled = busy() || !window;
    $('mainWorkspaceScan').disabled = busy();
    $('mainWorkspaceNamed').disabled = busy(); $('mainWorkspaceWindow').disabled = busy();
    $('mainWorkspaceStale').hidden = !stale; $('mainWorkspaceReviewLatest').hidden = !stale;
    $('mainWorkspaceRestore').disabled = busy() || stale || !reviewed?.entries.length;
    $('mainWorkspaceUpdate').disabled = busy() || stale || !reviewed;
    $('mainWorkspaceReuse').disabled = busy() || stale || !reviewed?.entries.length || !(state.windows || []).some(w => w.id === reuseWindow);
    $('mainWorkspaceSeparate').disabled = busy() || stale || !reviewed?.entries.length;
    const savedKey = JSON.stringify(reviewed);
    if (savedKey !== renderKey) {
      renderKey = savedKey;
      renderRows($('mainWorkspaceEntries'), reviewed?.entries || [], true);
      $('mainWorkspaceSavedMeta').textContent = reviewed ? `${tabsLabel(reviewed.entries.length)} · Saved ${time(reviewed.savedAt)} · Version ${reviewed.revision}` : 'No setup selected. Save a Terminal window to add one.';
      $('mainWorkspaceSnapshots').replaceChildren();
      for (const version of reviewed?.snapshots || []) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.workspaceMutation = 'true';
        button.textContent = `Recover version from ${time(version.savedAt)} · ${tabsLabel(version.count)}…`;
        button.onclick = () => { if (confirm('Recover this previous saved lineup? Live windows stay intact.')) void perform('mainworkspace.recover', {snapshotId: reviewed.id, snapshotIndex: version.index, expectedRevision: state.revision}); };
        $('mainWorkspaceSnapshots').append(button);
      }
    }
    for (const button of dialog.querySelectorAll('[data-workspace-mutation]')) button.disabled = busy() || stale;
    // Status updates do not replace selectable text or collapse an open row.
    for (const p of dialog.querySelectorAll('[data-entry-status]')) {
      const entry = state.entries?.find(e => e.id === p.dataset.entryStatus);
      p.textContent = entry ? [(entry.status || 'saved').replaceAll('_', ' '), entry.message].filter(Boolean).join(' · ') : '';
    }
  }
  async function refresh() {
    if (refreshing) return; refreshing = true;
    const target = selected;
    try {
      const result = await request('mainworkspace.status', {...(target ? {snapshotId: target} : {}), ...(pending ? {jobId: pending.id} : {})});
      if (selected !== target) return;
      state = result.mainWorkspace || {};
      if (!selected) selected = state.selectedSnapshotId || '';
      if (!chosenWindow && mode === 'save') chosenWindow = chooseWindow(state.windows || [], '', true).id;
      if (!reviewed && selected) reviewed = reviewSnapshot(state, selected);
      if (result.job && pending?.id === result.job.id && !['queued', 'running'].includes(result.job.status)) {
        const job = result.job, finished = pending; pending = null;
        if (job.result?.windowPreview) { preview = job.result; }
        if (job.result?.selectedSnapshotId && finished.action === 'mainworkspace.save' && !job.error) {
          selected = job.result.selectedSnapshotId; reviewed = null; updating = null; preview = null; mode = 'open';
        }
        if (['mainworkspace.recover','mainworkspace.remove'].includes(finished.action) && !job.error) reviewed = null;
        error(job.error); await persist();
        if (finished.action === 'mainworkspace.save' && !job.error) setTimeout(refresh, 0);
      }
      if (result.paused && pending) error('Mac control is paused. Resume control to continue this saved request.');
      render();
    } catch (e) { error(e.message); } finally { refreshing = false; }
  }
  async function resend() {
    if (!pending || sending) return; sending = true;
    try { await request(pending.action, pending.args, pending.id); error(''); await refresh(); }
    catch (e) { error(`Request retained. Check its receipt before another attempt: ${e.message}`); }
    finally { sending = false; }
  }
  async function perform(action, args = {}) {
    if (!preferencesLoaded) return error('Reopen this window after native request storage is available. No action was sent.');
    if (pending) return;
    pending = pendingRequest(action, args); render();
    try { await persist(); } catch (e) { pending = null; error(`No action sent: ${e.message}`); render(); return; }
    await resend();
  }
  async function open(modeValue, button) {
    opener = button; mode = modeValue; updating = null;
    try { await loadPreferences(); } catch (e) { error(`Workspace request storage is unavailable: ${e.message}`); }
    // Expose the intended pane before WebKit constructs the modal accessibility
    // tree and chooses initial focus, including Open -> Done -> Save navigation.
    render();
    if (!dialog.open) dialog.showModal();
    await refresh(); clearInterval(timer); timer = setInterval(refresh, 2000);
  }
  function close() { dialog.close(); clearInterval(timer); opener?.focus(); }
  $('mainWorkspaceOpen').onclick = event => void open('open', event.currentTarget);
  $('mainWorkspaceSaveOpen').onclick = event => void open('save', event.currentTarget);
  $('mainWorkspaceClose').onclick = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  $('mainWorkspaceBack').onclick = () => { mode = 'open'; updating = null; render(); };
  $('mainWorkspaceScan').onclick = () => void perform('mainworkspace.windows');
  $('mainWorkspaceReview').onclick = () => { preview = null; void perform('mainworkspace.preview', {tabId: windowNow().tabId, windowId: chosenWindow}); };
  $('mainWorkspaceWindow').onchange = () => { chosenWindow = $('mainWorkspaceWindow').value; preview = null; void persist().catch(e => error(e.message)); render(); };
  $('mainWorkspaceReuseWindow').onchange = () => { reuseWindow = $('mainWorkspaceReuseWindow').value; render(); };
  $('mainWorkspaceName').oninput = () => { void persist().catch(e => error(e.message)); render(); };
  $('mainWorkspaceNamed').onchange = () => { selected = $('mainWorkspaceNamed').value; reviewed = null; void persist().catch(e => error(e.message)); void refresh(); render(); };
  $('mainWorkspaceReviewLatest').onclick = () => { reviewed = reviewSnapshot(state, selected); render(); };
  $('mainWorkspaceUpdate').onclick = () => { updating = structuredClone(reviewed); preview = null; mode = 'save'; $('mainWorkspaceName').value = updating.name; render(); };
  $('mainWorkspaceSave').onclick = () => {
    if (!readyPreview()) return error('Review the window again before saving.');
    const name = $('mainWorkspaceName').value.trim();
    if (!updating && state.namedSnapshots?.some(s => s.name.toLocaleLowerCase() === name.toLocaleLowerCase()) && !confirm(`A setup named “${name}” exists. Save a separate setup with that name? To replace its lineup, use Update from Open Saved Setup.`)) return;
    if (updating && !confirm(`Replace ${updating.name} with exactly the reviewed lineup? Its previous version stays recoverable.`)) return;
    void perform('mainworkspace.save', {tabId: windowNow().tabId, windowToken: preview.windowPreview.token, name, expectedRevision: state.revision, ...(updating ? {snapshotId: updating.id} : {})});
  };
  function restore(extra = {}) { try { void perform('mainworkspace.restore', restoreArguments(reviewed, state, extra)); } catch (e) { error(e.message); } }
  $('mainWorkspaceRestore').onclick = () => restore();
  $('mainWorkspaceReuse').onclick = () => { if (confirm('Add only missing saved tabs to the chosen window, preserving all of its existing tabs and drafts?')) restore({reuseWindowTabId: state.windows.find(w => w.id === reuseWindow).tabId}); };
  $('mainWorkspaceSeparate').onclick = () => { if (confirm('Allow a separate window for missing saved conversations? Existing windows stay open; live conversations are never duplicated.')) restore({newWindowConfirmed: true}); };
  $('mainWorkspaceRetry').onclick = async () => { await refresh(); if (pending) await resend(); };
}
