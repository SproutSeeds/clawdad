import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const repoRoot = path.resolve(import.meta.dirname, "..");
const webAppPath = path.join(repoRoot, "web", "app.js");
const webIndexPath = path.join(repoRoot, "web", "index.html");

async function loadHistoryMergeHelpers() {
  const source = await readFile(webAppPath, "utf8");
  const start = source.indexOf("function normalizeHistoryAttachments");
  const end = source.indexOf("function threadEntryFromHistoryItem");
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.ok(end > start);

  const context = {
    Date,
  };
  vm.createContext(context);
  vm.runInContext(
    `
const historyDuplicateWindowMs = 2 * 60 * 1000;
const threadEntryCacheLimit = 80;
function makeEntryId() { return "generated-id"; }
function fallbackProjectLabel(projectPath) { return String(projectPath || "project").split("/").filter(Boolean).pop() || "project"; }
function sessionForEntry() { return null; }
function providerLabel(provider) { return String(provider || "session"); }
function sessionFingerprint(sessionId) { return String(sessionId || "").slice(-4); }
${source.slice(start, end)}
globalThis.mergeHistoryItems = mergeHistoryItems;
`,
    context,
  );
  return context;
}

async function loadThreadCacheHelpers() {
  const source = await readFile(webAppPath, "utf8");
  const start = source.indexOf("function normalizeHistoryAttachments");
  const end = source.indexOf("function decorateCopyButton");
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.ok(end > start);

  const store = new Map();
  const context = {
    Date,
    state: { threadEntries: [], historyThreads: {} },
    threadCacheKey: "clawdad-thread-log-test",
    localStorage: {
      get length() {
        return store.size;
      },
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      },
      key(index) {
        return [...store.keys()][index] || null;
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `
const historyDuplicateWindowMs = 2 * 60 * 1000;
const threadEntryCacheLimit = 80;
const queuedDispatchGraceMs = 15000;
const queuedDispatchAttachGraceMs = 2 * 60 * 1000;
const staleLocalPendingBlockMs = queuedDispatchAttachGraceMs;
function makeEntryId() { return "generated-id"; }
function fallbackProjectLabel(projectPath) { return String(projectPath || "project").split("/").filter(Boolean).pop() || "project"; }
function sessionForEntry() { return null; }
function providerLabel(provider) { return String(provider || "session"); }
function sessionFingerprint(sessionId) { return String(sessionId || "").slice(-4); }
function entrySessionLabel(entry) { return entry?.sessionLabel || "codex • test"; }
function historyKey(projectPath, sessionId) { return String(projectPath || "") + "::" + String(sessionId || ""); }
function historyStateFor(projectPath, sessionId) {
  return state.historyThreads[historyKey(projectPath, sessionId)] || {
    items: [],
    nextCursor: "0",
    loading: false,
    initialized: false,
    prefetchedAt: 0,
    error: "",
  };
}
function setHistoryState(projectPath, sessionId, nextState) {
  const key = historyKey(projectPath, sessionId);
  state.historyThreads[key] = {
    ...historyStateFor(projectPath, sessionId),
    ...nextState,
  };
}
${source.slice(start, end)}
globalThis.persistThreadEntries = persistThreadEntries;
globalThis.restoreThreadEntries = restoreThreadEntries;
globalThis.purgeLegacyThreadEntryCaches = purgeLegacyThreadEntryCaches;
globalThis.hydrateThreadEntriesFromHistoryItems = hydrateThreadEntriesFromHistoryItems;
globalThis.threadEntryVisibleInQueue = threadEntryVisibleInQueue;
globalThis.queueEntries = queueEntries;
globalThis.entryCopyKey = entryCopyKey;
`,
    context,
  );
  return context;
}

async function loadProjectSortHelpers() {
  const source = await readFile(webAppPath, "utf8");
  const start = source.indexOf("function timestampToMs");
  const end = source.indexOf("function hydrateProjectVisuals", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.ok(end > start);

  const context = {
    Date,
    state: { threadEntries: [] },
  };
  vm.createContext(context);
  vm.runInContext(
    `
function projectHasLiveDelegate() { return false; }
${source.slice(start, end)}
globalThis.compareProjects = compareProjects;
globalThis.projectActivityTimestampMs = projectActivityTimestampMs;
`,
    context,
  );
  return context;
}

test("web history merge clears stale cached synthetic answered transcript cards", async () => {
  const { mergeHistoryItems } = await loadHistoryMergeHelpers();
  const staleCached = {
    requestId: "codex:019ddf17-7e93-7840-a89b-cc2702c32a02:54",
    projectPath: "/repo/clawdad",
    sessionId: "019ddf17-7e93-7840-a89b-cc2702c32a02",
    provider: "codex",
    message: "Please compare OpenClaw and Clawdad.",
    sentAt: "2026-05-03T15:35:13.537Z",
    answeredAt: "2026-05-03T15:35:16.000Z",
    status: "answered",
    exitCode: 0,
    response: "I will verify public docs first.",
  };
  const authoritativeServerItem = {
    ...staleCached,
    answeredAt: null,
    status: "queued",
    exitCode: null,
    response: "",
  };

  const merged = mergeHistoryItems([staleCached], [authoritativeServerItem]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].requestId, authoritativeServerItem.requestId);
  assert.equal(merged[0].status, "queued");
  assert.equal(merged[0].response, "");
  assert.equal(merged[0].answeredAt, null);
  assert.equal(merged[0].exitCode, null);
});

test("web thread cache never persists or restores failed cards", async () => {
  const context = await loadThreadCacheHelpers();
  const failed = {
    requestId: "failed-request",
    projectPath: "/repo/clawdad",
    sessionId: "session-failed",
    provider: "codex",
    message: "This stale local card should not survive reload.",
    sentAt: "2026-05-04T12:00:00.000Z",
    answeredAt: "2026-05-04T12:01:00.000Z",
    status: "failed",
    exitCode: 1,
    response: "Failed.",
  };
  const answered = {
    ...failed,
    requestId: "answered-request",
    sessionId: "session-answered",
    status: "answered",
    exitCode: 0,
    response: "Answered.",
  };
  const queued = {
    ...failed,
    requestId: "queued-request",
    sessionId: "session-queued",
    status: "queued",
    exitCode: null,
    sentAt: new Date().toISOString(),
    answeredAt: null,
    response: "",
  };

  context.state.threadEntries = [failed, answered, queued];
  context.persistThreadEntries();
  const persisted = JSON.parse(context.localStorage.getItem(context.threadCacheKey));
  assert.deepEqual(persisted.map((entry) => entry.status).sort(), ["answered", "queued"]);

  context.localStorage.setItem(context.threadCacheKey, JSON.stringify([failed, answered, queued]));
  context.state.threadEntries = [];
  context.restoreThreadEntries();
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.state.threadEntries.map((entry) => entry.status).sort())),
    ["answered", "queued"],
  );
});

test("web recent history hydration keeps failed cards out of the dashboard queue state", async () => {
  const context = await loadThreadCacheHelpers();
  const failed = {
    requestId: "failed-request",
    projectPath: "/repo/clawdad",
    sessionId: "session-failed",
    provider: "codex",
    message: "This failed card belongs in thread history, not the queue.",
    sentAt: "2026-05-04T12:00:00.000Z",
    answeredAt: "2026-05-04T12:01:00.000Z",
    status: "failed",
    exitCode: 1,
    response: "Failed.",
  };
  const answered = {
    ...failed,
    requestId: "answered-request",
    sessionId: "session-answered",
    status: "answered",
    exitCode: 0,
    response: "Answered.",
  };
  const queued = {
    ...failed,
    requestId: "queued-request",
    sessionId: "session-queued",
    status: "queued",
    exitCode: null,
    answeredAt: null,
    response: "",
  };

  context.hydrateThreadEntriesFromHistoryItems([failed, answered, queued]);

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.state.threadEntries.map((entry) => entry.status).sort())),
    ["answered"],
  );
  assert.equal(
    context.state.historyThreads["/repo/clawdad::session-failed"].items[0].status,
    "failed",
  );
  assert.equal(
    context.state.historyThreads["/repo/clawdad::session-queued"].items[0].status,
    "queued",
  );
});

test("web dashboard queue visibility excludes failed cards still present in memory", async () => {
  const context = await loadThreadCacheHelpers();
  assert.equal(context.threadEntryVisibleInQueue({ status: "queued" }), true);
  assert.equal(context.threadEntryVisibleInQueue({ status: "answered" }), true);
  assert.equal(context.threadEntryVisibleInQueue({ status: "failed" }), false);
  assert.equal(context.threadEntryVisibleInQueue({ status: "FAILED" }), false);
});

test("web dashboard queue visibility excludes stale history queued transcript rows", async () => {
  const context = await loadThreadCacheHelpers();
  const staleQueued = {
    id: "history:codex:session-a:0",
    requestId: "codex:session-a:0",
    projectPath: "/repo/clawdad",
    sessionId: "session-a",
    status: "queued",
    sentAt: "2026-05-04T12:00:00.000Z",
    answeredAt: null,
    response: "",
  };
  const laterAnswer = {
    ...staleQueued,
    id: "history:codex:session-a:1",
    requestId: "codex:session-a:1",
    status: "answered",
    sentAt: "2026-05-04T12:01:00.000Z",
    answeredAt: "2026-05-04T12:02:00.000Z",
    response: "Done.",
  };

  context.state.threadEntries = [staleQueued, laterAnswer];

  assert.equal(context.threadEntryVisibleInQueue(staleQueued), false);
  assert.deepEqual(context.queueEntries().map((entry) => entry.requestId), [laterAnswer.requestId]);
});

test("web dashboard queue visibility only trusts local pending queue rows by default", async () => {
  const context = await loadThreadCacheHelpers();
  const historyQueued = {
    id: "history:codex:session-a:2",
    requestId: "codex:session-a:2",
    projectPath: "/repo/clawdad",
    sessionId: "session-a",
    status: "queued",
    sentAt: new Date().toISOString(),
    answeredAt: null,
    response: "",
  };
  const localQueued = {
    ...historyQueued,
    id: "local-pending",
    requestId: "local-pending",
  };

  context.state.threadEntries = [historyQueued, localQueued];

  assert.equal(context.threadEntryVisibleInQueue(historyQueued), false);
  assert.equal(context.threadEntryVisibleInQueue(localQueued), true);
  assert.deepEqual(context.queueEntries().map((entry) => entry.requestId), [localQueued.requestId]);
});

test("web dashboard queue renders one canonical card per session thread", async () => {
  const context = await loadThreadCacheHelpers();
  const olderAnswer = {
    id: "history:older-answer",
    requestId: "older-answer",
    projectPath: "/repo/clawdad",
    sessionId: "session-a",
    status: "answered",
    sentAt: "2026-05-04T12:00:00.000Z",
    answeredAt: "2026-05-04T12:01:00.000Z",
    response: "Older answer.",
  };
  const newerAnswer = {
    ...olderAnswer,
    id: "history:newer-answer",
    requestId: "newer-answer",
    sentAt: "2026-05-04T12:02:00.000Z",
    answeredAt: "2026-05-04T12:03:00.000Z",
    response: "Newer answer.",
  };
  const activeQueued = {
    ...olderAnswer,
    id: "local-queued",
    requestId: "local-queued",
    status: "queued",
    sentAt: new Date().toISOString(),
    answeredAt: null,
    response: "",
  };
  const otherThread = {
    ...newerAnswer,
    id: "history:other-thread",
    requestId: "other-thread",
    sessionId: "session-b",
  };

  context.state.threadEntries = [olderAnswer, newerAnswer, otherThread];
  assert.deepEqual(
    context.queueEntries().map((entry) => entry.requestId),
    ["newer-answer", "other-thread"],
  );

  context.state.threadEntries = [olderAnswer, newerAnswer, activeQueued, otherThread];
  assert.deepEqual(
    context.queueEntries().map((entry) => entry.requestId),
    ["local-queued", "other-thread"],
  );
});

test("web project dropdown orders projects by latest session thread activity", async () => {
  const context = await loadProjectSortHelpers();
  const alpha = {
    path: "/repo/alpha",
    displayName: "Alpha",
    sessions: [{ lastResponse: "2026-05-04T12:00:00.000Z" }],
  };
  const beta = {
    path: "/repo/beta",
    displayName: "Beta",
    sessions: [{ lastDispatch: "2026-05-04T13:00:00.000Z" }],
  };
  const gamma = {
    path: "/repo/gamma",
    displayName: "Gamma",
    sessions: [],
  };

  context.state.threadEntries = [
    {
      projectPath: "/repo/gamma",
      sessionId: "session-gamma",
      sentAt: "2026-05-04T14:00:00.000Z",
      answeredAt: "",
    },
  ];

  assert.equal(
    context.projectActivityTimestampMs(gamma),
    new Date("2026-05-04T14:00:00.000Z").getTime(),
  );
  assert.deepEqual(
    [alpha, beta, gamma].sort(context.compareProjects).map((project) => project.displayName),
    ["Gamma", "Beta", "Alpha"],
  );
});

test("web project dropdown render key tracks activity sort changes", async () => {
  const source = await readFile(webAppPath, "utf8");
  const groupedStart = source.indexOf("function groupedProjectOptions");
  const renderStart = source.indexOf("function renderProjectOptions", groupedStart);
  const renderEnd = source.indexOf("function updateProjectControlAppearance", renderStart);
  assert.notEqual(groupedStart, -1);
  assert.notEqual(renderStart, -1);
  assert.notEqual(renderEnd, -1);

  const groupedBody = source.slice(groupedStart, renderStart);
  assert.match(groupedBody, /featured: featured\.sort\(compareProjects\)/u);
  assert.match(groupedBody, /liveDelegates: liveDelegates\.sort\(compareProjects\)/u);
  assert.match(groupedBody, /projects: projects\.sort\(compareProjects\)/u);

  const renderBody = source.slice(renderStart, renderEnd);
  assert.match(renderBody, /projectActivityTimestampMs\(project\)/u);
});

test("web entry copy keys stay scoped to a single card", async () => {
  const context = await loadThreadCacheHelpers();
  const base = {
    projectPath: "/repo/clawdad",
    sessionId: "session-a",
    requestId: "",
    id: "",
    status: "answered",
    answeredAt: "2026-05-04T12:02:00.000Z",
  };

  const first = {
    ...base,
    sentAt: "2026-05-04T12:00:00.000Z",
    message: "First card",
  };
  const second = {
    ...base,
    sentAt: "2026-05-04T12:01:00.000Z",
    message: "Second card",
  };

  assert.notEqual(
    context.entryCopyKey(first, "queue-message", first.message),
    context.entryCopyKey(second, "queue-message", second.message),
  );
  assert.notEqual(
    context.entryCopyKey(first, "history-message", first.message),
    context.entryCopyKey(first, "history-response", "Response"),
  );
});

test("web boot purges legacy thread caches", async () => {
  const context = await loadThreadCacheHelpers();
  context.localStorage.setItem("clawdad-thread-log-v1-old", "[]");
  context.localStorage.setItem("clawdad-thread-log-v2-old", "[]");
  context.localStorage.setItem(context.threadCacheKey, "[]");

  context.purgeLegacyThreadEntryCaches();

  assert.equal(context.localStorage.getItem("clawdad-thread-log-v1-old"), null);
  assert.equal(context.localStorage.getItem("clawdad-thread-log-v2-old"), null);
  assert.equal(context.localStorage.getItem(context.threadCacheKey), "[]");
});

test("web project switch leaves Codex session import discovery lazy", async () => {
  const source = await readFile(webAppPath, "utf8");
  const projectSelectStart = source.indexOf('elements.projectSelect.addEventListener("change"');
  const sessionSelectStart = source.indexOf('elements.sessionSelect.addEventListener("change"', projectSelectStart);
  assert.notEqual(projectSelectStart, -1);
  assert.notEqual(sessionSelectStart, -1);
  assert.ok(sessionSelectStart > projectSelectStart);

  const projectSelectHandler = source.slice(projectSelectStart, sessionSelectStart);
  assert.doesNotMatch(projectSelectHandler, /refreshImportableSessions/u);

  const importModalStart = source.indexOf("async function openSessionImportModal");
  const titleModalStart = source.indexOf("function openSessionTitleModal", importModalStart);
  assert.notEqual(importModalStart, -1);
  assert.notEqual(titleModalStart, -1);
  const importModal = source.slice(importModalStart, titleModalStart);
  assert.match(importModal, /refreshImportableSessions\(project\.path,\s*\{\s*force:\s*true\s*\}\)/u);

  const importButtonStart = source.indexOf("function updateImportButtonAvailability");
  const renameButtonStart = source.indexOf("function updateSessionRenameAvailability", importButtonStart);
  assert.notEqual(importButtonStart, -1);
  assert.notEqual(renameButtonStart, -1);
  assert.ok(renameButtonStart > importButtonStart);
  const importButton = source.slice(importButtonStart, renameButtonStart);
  assert.match(importButton, /if \(!elements\.sessionImportButton\) \{\s*return;\s*\}/u);

  const refreshProjectsStart = source.indexOf("async function refreshProjects");
  const refreshThreadsStart = source.indexOf("async function refreshThreads", refreshProjectsStart);
  assert.notEqual(refreshProjectsStart, -1);
  assert.notEqual(refreshThreadsStart, -1);
  assert.ok(refreshThreadsStart > refreshProjectsStart);
  const refreshProjects = source.slice(refreshProjectsStart, refreshThreadsStart);
  assert.match(
    refreshProjects,
    /if \(state\.sessionImportModalProject === state\.selectedProject\) \{\s*void refreshImportableSessions\(state\.selectedProject\)/u,
  );
  assert.doesNotMatch(refreshProjects, /refreshImportableSessions\(state\.selectedProject,\s*\{\s*force:\s*true/u);
});

test("web queue cards open terminal while thread cards keep message audio downloads", async () => {
  const source = await readFile(webAppPath, "utf8");

  const renderQueueStart = source.indexOf("function renderQueueList");
  const buildThreadCardStart = source.indexOf("function buildThreadCard", renderQueueStart);
  assert.notEqual(renderQueueStart, -1);
  assert.notEqual(buildThreadCardStart, -1);
  assert.ok(buildThreadCardStart > renderQueueStart);
  const renderQueue = source.slice(renderQueueStart, buildThreadCardStart);
  assert.match(renderQueue, /buildOpenTerminalButton\(entry\)/u);
  assert.doesNotMatch(renderQueue, /buildAudioButton\(/u);

  const buildThreadCardEnd = source.indexOf("function buildHistoryGroup", buildThreadCardStart);
  assert.notEqual(buildThreadCardEnd, -1);
  assert.ok(buildThreadCardEnd > buildThreadCardStart);
  const buildThreadCard = source.slice(buildThreadCardStart, buildThreadCardEnd);
  assert.match(buildThreadCard, /buildAudioButton\(/u);
  assert.match(buildThreadCard, /messageAudioPayload\(entry, audioKind, audioText\)/u);

  const decorateAudioStart = source.indexOf("function decorateAudioButton");
  const ttsFallbackStart = source.indexOf("function ttsFallbackText", decorateAudioStart);
  assert.notEqual(decorateAudioStart, -1);
  assert.notEqual(ttsFallbackStart, -1);
  const decorateAudio = source.slice(decorateAudioStart, ttsFallbackStart);
  assert.match(decorateAudio, /button\.innerHTML = downloadIconMarkup\(\);/u);
});

test("web composer exposes open terminal for the selected session", async () => {
  const [source, html] = await Promise.all([
    readFile(webAppPath, "utf8"),
    readFile(webIndexPath, "utf8"),
  ]);

  assert.match(html, /id="currentTerminalButton"/u);
  assert.match(html, /class="thread-button composer-terminal-button open-terminal-button"/u);
  assert.match(html, /aria-label="Open selected session in terminal"/u);

  assert.match(source, /currentTerminalButton: document\.querySelector\("#currentTerminalButton"\)/u);
  assert.match(source, /function currentSessionTerminalEntry\(\)/u);
  assert.match(source, /function updateComposerTerminalButtonAvailability\(\)/u);
  assert.match(source, /decorateOpenTerminalButton\(elements\.currentTerminalButton, launchKey\)/u);
  assert.match(source, /openSessionInTerminal\(currentSessionTerminalEntry\(\)\)/u);

  const renderAllStart = source.indexOf("function renderAll");
  const reconcileStart = source.indexOf("async function reconcileThreadEntries", renderAllStart);
  assert.notEqual(renderAllStart, -1);
  assert.notEqual(reconcileStart, -1);
  const renderAll = source.slice(renderAllStart, reconcileStart);
  assert.match(renderAll, /refreshCopyButtons\(\);\s*updateComposerTerminalButtonAvailability\(\);/u);
});

test("web session dropdown exposes a start-new-session option", async () => {
  const source = await readFile(webAppPath, "utf8");

  assert.match(source, /const newSessionSelectValue = "__clawdad_new_session__";/u);
  assert.match(source, /newOption\.value = newSessionSelectValue/u);
  assert.match(source, /Start new Codex session/u);
  assert.match(source, /async function handleSessionCreate\(\)/u);
  assert.match(source, /fetchJson\("\/v1\/sessions"/u);
  assert.match(source, /if \(sessionId === newSessionSelectValue\) \{\s*await handleSessionCreate\(\);/u);

  const renderStart = source.indexOf("function renderSessionOptions");
  const repoStart = source.indexOf("function repoOptionLabel", renderStart);
  assert.notEqual(renderStart, -1);
  assert.notEqual(repoStart, -1);
  const renderSessionOptions = source.slice(renderStart, repoStart);
  assert.match(renderSessionOptions, /state\.sessionCreatePending/u);
  assert.match(renderSessionOptions, /elements\.sessionSelect\.disabled = disabled;/u);

  const createStart = source.indexOf("async function handleSessionCreate");
  const loadHistoryStart = source.indexOf("async function loadSessionHistory", createStart);
  assert.notEqual(createStart, -1);
  assert.notEqual(loadHistoryStart, -1);
  const createBody = source.slice(createStart, loadHistoryStart);
  assert.match(createBody, /state\.sessionCreatePending = true;/u);
  assert.match(createBody, /provider: project\.provider \|\| "codex"/u);
  assert.match(createBody, /projectWithActiveSession\(payload\.projectDetails, payload\.sessionId\)/u);
  assert.match(createBody, /state\.selectedSessionId = payload\.sessionId;/u);
  assert.match(createBody, /syncSelectedSession\(payload\.sessionId/u);
});

test("web quick chats render as a composer dropdown instead of a modal or linear tray", async () => {
  const [source, html] = await Promise.all([
    readFile(webAppPath, "utf8"),
    readFile(webIndexPath, "utf8"),
  ]);

  const actionsStart = html.indexOf('class="composer-actions"');
  const quickButtonStart = html.indexOf('id="quickPromptButton"', actionsStart);
  const quickStart = html.indexOf('id="quickPromptModal"', actionsStart);
  const terminalStart = html.indexOf('id="currentTerminalButton"', actionsStart);
  assert.notEqual(actionsStart, -1);
  assert.notEqual(quickButtonStart, -1);
  assert.notEqual(quickStart, -1);
  assert.notEqual(terminalStart, -1);
  assert.ok(quickButtonStart > actionsStart);
  assert.ok(quickStart > quickButtonStart);
  assert.ok(quickStart < terminalStart);

  const quickMarkupEnd = html.indexOf('id="currentTerminalButton"', quickStart);
  const quickMarkup = html.slice(quickStart, quickMarkupEnd);
  assert.match(quickMarkup, /class="quick-prompt-dropdown quick-prompt-panel"/u);
  assert.match(quickMarkup, />Quick Chats</u);
  assert.doesNotMatch(quickMarkup, /detail-modal/u);
  assert.doesNotMatch(quickMarkup, /aria-modal="true"/u);
  assert.doesNotMatch(quickMarkup, /role="dialog"/u);
  assert.doesNotMatch(quickMarkup, /<form id="quickPromptForm"/u);
  assert.match(quickMarkup, /<div id="quickPromptForm" class="quick-prompt-form" hidden>/u);
  assert.match(quickMarkup, /id="quickPromptSaveButton"[\s\S]*type="button"/u);
  assert.match(html.slice(quickButtonStart, quickStart), /aria-controls="quickPromptModal"/u);
  assert.match(html.slice(quickButtonStart, quickStart), /aria-haspopup="true"/u);

  assert.match(source, /function renderQuickPromptModal\(\)/u);
  assert.match(source, /function saveQuickPromptDraft\(\)/u);

  const bodyModalStart = source.indexOf("function updateBodyModalState");
  const projectModalStart = source.indexOf("function renderProjectModal", bodyModalStart);
  assert.notEqual(bodyModalStart, -1);
  assert.notEqual(projectModalStart, -1);
  const bodyModal = source.slice(bodyModalStart, projectModalStart);
  assert.doesNotMatch(bodyModal, /quickPromptModalOpen/u);

  const openStart = source.indexOf("function openQuickPromptModal");
  const closeStart = source.indexOf("function closeQuickPromptModal", openStart);
  assert.notEqual(openStart, -1);
  assert.notEqual(closeStart, -1);
  const openBody = source.slice(openStart, closeStart);
  assert.doesNotMatch(openBody, /state\.modalThread = null/u);
  assert.doesNotMatch(openBody, /state\.projectModalOpen = false/u);

  const quickButtonListenerStart = source.indexOf("elements.quickPromptButton?.addEventListener");
  const quickBackdropListenerStart = source.indexOf("elements.quickPromptBackdrop", quickButtonListenerStart);
  assert.notEqual(quickButtonListenerStart, -1);
  assert.notEqual(quickBackdropListenerStart, -1);
  const quickButtonListener = source.slice(quickButtonListenerStart, quickBackdropListenerStart);
  assert.match(quickButtonListener, /if \(state\.quickPromptModalOpen\) \{\s*closeQuickPromptModal\(\);/u);
  assert.match(source, /function isQuickPromptTarget\(target\)/u);
  assert.match(source, /elements\.quickPromptModal\?\.contains\(target\)/u);
  assert.match(source, /elements\.quickPromptButton\?\.contains\(target\)/u);
  assert.match(quickButtonListener, /document\.addEventListener\("pointerdown"/u);
  assert.match(quickButtonListener, /isQuickPromptTarget\(event\.target\)/u);
  assert.match(quickButtonListener, /closeQuickPromptModal\(\{ focusComposer: false \}\)/u);

  const quickEscapeStart = source.indexOf('if (event.key === "Escape" && state.quickPromptModalOpen)');
  const projectEscapeStart = source.indexOf('if (event.key === "Escape" && state.projectModalOpen)', quickEscapeStart);
  assert.notEqual(quickEscapeStart, -1);
  assert.notEqual(projectEscapeStart, -1);
  const quickEscapeHandler = source.slice(quickEscapeStart, projectEscapeStart);
  assert.match(quickEscapeHandler, /event\.preventDefault\(\);/u);
  assert.match(quickEscapeHandler, /closeQuickPromptModal\(\);/u);

  const saveListenerStart = source.indexOf("elements.quickPromptSaveButton?.addEventListener");
  const titleListenerStart = source.indexOf("elements.quickPromptTitleInput?.addEventListener", saveListenerStart);
  assert.notEqual(saveListenerStart, -1);
  assert.notEqual(titleListenerStart, -1);
  const saveListenerBody = source.slice(saveListenerStart, titleListenerStart);
  assert.doesNotMatch(saveListenerBody, /quickPromptForm\?\.addEventListener\("submit"/u);
  assert.match(saveListenerBody, /quickPromptSaveButton\?\.addEventListener\("click"/u);
  assert.match(saveListenerBody, /quickPromptForm\?\.addEventListener\("keydown"/u);

  const css = await readFile(path.join(repoRoot, "web", "app.css"), "utf8");
  const dropdownStart = css.indexOf(".quick-prompt-dropdown");
  const listStart = css.indexOf(".quick-prompt-list", dropdownStart);
  assert.notEqual(dropdownStart, -1);
  assert.notEqual(listStart, -1);
  const dropdownCss = css.slice(dropdownStart, listStart);
  assert.match(dropdownCss, /position: absolute;/u);
  assert.match(dropdownCss, /bottom: calc\(100% \+ 8px\);/u);
  assert.match(dropdownCss, /width: min\(420px, calc\(100vw - 40px\)\);/u);
});

test("web composer can attach files and dispatch them with FormData", async () => {
  const [source, html] = await Promise.all([
    readFile(webAppPath, "utf8"),
    readFile(webIndexPath, "utf8"),
  ]);

  assert.match(html, /id="composerAttachmentInput"[^>]*type="file"[^>]*multiple/u);
  assert.match(html, /id="composerAttachmentList"[^>]*class="composer-attachment-list"/u);
  assert.match(html, /id="composerAttachmentButton"/u);
  assert.match(html, /aria-label="Attach files"/u);

  const actionsStart = html.indexOf('class="composer-actions"');
  const quickButtonStart = html.indexOf('id="quickPromptButton"', actionsStart);
  const attachmentButtonStart = html.indexOf('id="composerAttachmentButton"', actionsStart);
  const terminalButtonStart = html.indexOf('id="currentTerminalButton"', actionsStart);
  assert.ok(quickButtonStart > actionsStart);
  assert.ok(attachmentButtonStart > quickButtonStart);
  assert.ok(terminalButtonStart > attachmentButtonStart);

  assert.match(source, /composerAttachments: \[\]/u);
  assert.match(source, /composerAttachmentButton: document\.querySelector\("#composerAttachmentButton"\)/u);
  assert.match(source, /function renderComposerAttachments\(\)/u);
  assert.match(source, /function addComposerFiles\(files\)/u);
  assert.match(source, /function clearComposerAttachments\(\)/u);
  assert.match(source, /new FormData\(\)/u);
  assert.match(source, /formData\.append\("attachments", attachment\.file, attachment\.fileName\)/u);
  assert.match(source, /message: dispatchMessage/u);
  assert.match(source, /clearComposerAttachments\(\);/u);
  assert.match(source, /buildMessageAttachmentList\(entry\.attachments\)/u);
  assert.match(source, /attachments: composerAttachments\.map\(composerAttachmentSummary\)/u);

  const updateSendStart = source.indexOf("function updateSendAvailability");
  const updateThreadStart = source.indexOf("function updateThreadButtonAvailability", updateSendStart);
  assert.notEqual(updateSendStart, -1);
  assert.notEqual(updateThreadStart, -1);
  const updateSend = source.slice(updateSendStart, updateThreadStart);
  assert.match(updateSend, /state\.composerAttachments\.length > 0/u);
  assert.match(updateSend, /hasDraft/u);
});

test("web history merge preserves outbound attachment summaries", async () => {
  const { mergeHistoryItems } = await loadHistoryMergeHelpers();
  const queued = {
    requestId: "req-attach",
    projectPath: "/repo/clawdad",
    sessionId: "session-1",
    message: "Please review the attached file(s).",
    sentAt: "2026-05-05T12:00:00.000Z",
    status: "queued",
    attachments: [
      {
        id: "att-1",
        fileName: "screen.png",
        size: 4,
        mimeType: "image/png",
        kind: "image",
      },
    ],
  };
  const answered = {
    ...queued,
    status: "answered",
    answeredAt: "2026-05-05T12:01:00.000Z",
    response: "I can see the screenshot.",
    attachments: [],
  };

  const merged = mergeHistoryItems([queued], [answered]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "answered");
  assert.deepEqual(JSON.parse(JSON.stringify(merged[0].attachments)), [
    {
      id: "att-1",
      fileName: "screen.png",
      relativePath: "",
      path: "",
      size: 4,
      mimeType: "image/png",
      kind: "image",
    },
  ]);
});

test("web artifact refresh only polls explicit files surfaces", async () => {
  const source = await readFile(webAppPath, "utf8");
  assert.match(source, /const artifactRefreshFreshMs = 60 \* 1000;/u);

  const artifactTargetsStart = source.indexOf("function artifactProjectsNeedingRefresh");
  const refreshArtifactsStart = source.indexOf("async function refreshArtifacts", artifactTargetsStart);
  assert.notEqual(artifactTargetsStart, -1);
  assert.notEqual(refreshArtifactsStart, -1);
  assert.ok(refreshArtifactsStart > artifactTargetsStart);

  const artifactTargets = source.slice(artifactTargetsStart, refreshArtifactsStart);
  assert.match(artifactTargets, /state\.workspaceMode === "files"/u);
  assert.match(artifactTargets, /state\.artifactModalProject/u);
  assert.doesNotMatch(artifactTargets, /state\.selectedProject/u);
  assert.doesNotMatch(artifactTargets, /state\.delegateModalProject/u);
  assert.doesNotMatch(artifactTargets, /threadEntryStatus/u);
  assert.doesNotMatch(artifactTargets, /threadEntryVisibleInQueue/u);

  const renderShelfStart = source.indexOf("function renderArtifactShelf");
  const projectLabelStart = source.indexOf("function projectLabelForPath", renderShelfStart);
  assert.notEqual(renderShelfStart, -1);
  assert.notEqual(projectLabelStart, -1);
  const renderShelf = source.slice(renderShelfStart, projectLabelStart);
  assert.match(renderShelf, /elements\.artifactShelf\.hidden = true;/u);
  assert.doesNotMatch(renderShelf, /elements\.artifactShelf\.hidden = false;/u);
  assert.doesNotMatch(renderShelf, /buildArtifactCard\(artifact, \{ compact: true \}\)/u);

  const loadArtifactsStart = source.indexOf("async function loadProjectArtifacts");
  const openArtifactsStart = source.indexOf("async function openArtifactsModal", loadArtifactsStart);
  assert.notEqual(loadArtifactsStart, -1);
  assert.notEqual(openArtifactsStart, -1);
  const loadArtifacts = source.slice(loadArtifactsStart, openArtifactsStart);
  assert.match(loadArtifacts, /Date\.now\(\) - Number\(existing\.loadedAt \|\| 0\) < artifactRefreshFreshMs/u);
  assert.match(loadArtifacts, /loadedAt: Date\.now\(\)/u);
});

test("web history merge replaces stale cached synthetic answer with fresh synthetic final answer", async () => {
  const { mergeHistoryItems } = await loadHistoryMergeHelpers();
  const staleCached = {
    requestId: "codex:019ddf17-7e93-7840-a89b-cc2702c32a02:54",
    projectPath: "/repo/clawdad",
    sessionId: "019ddf17-7e93-7840-a89b-cc2702c32a02",
    provider: "codex",
    message: "Please compare OpenClaw and Clawdad.",
    sentAt: "2026-05-03T15:35:13.537Z",
    answeredAt: "2026-05-03T15:35:16.000Z",
    status: "answered",
    exitCode: 0,
    response: "I will verify public docs first.",
  };
  const freshSyntheticFinal = {
    ...staleCached,
    answeredAt: "2026-05-03T15:40:14.000Z",
    response: "Detailed final comparison.",
  };

  const merged = mergeHistoryItems([staleCached], [freshSyntheticFinal]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].requestId, freshSyntheticFinal.requestId);
  assert.equal(merged[0].status, "answered");
  assert.equal(merged[0].response, freshSyntheticFinal.response);
  assert.equal(merged[0].answeredAt, freshSyntheticFinal.answeredAt);
});

test("web history merge prefers concrete answered request over synthetic transcript answer", async () => {
  const { mergeHistoryItems } = await loadHistoryMergeHelpers();
  const synthetic = {
    requestId: "codex:019ddf17-7e93-7840-a89b-cc2702c32a02:54",
    projectPath: "/repo/clawdad",
    sessionId: "019ddf17-7e93-7840-a89b-cc2702c32a02",
    provider: "codex",
    message: "Please compare OpenClaw and Clawdad.",
    sentAt: "2026-05-03T15:35:13.537Z",
    answeredAt: "2026-05-03T15:35:16.000Z",
    status: "answered",
    exitCode: 0,
    response: "I will verify public docs first.",
  };
  const concrete = {
    ...synthetic,
    requestId: "2f66a266-6b05-441f-8e80-32d2e15224fd",
    answeredAt: "2026-05-03T15:40:14.000Z",
    response: "Detailed final comparison.",
  };

  const merged = mergeHistoryItems([synthetic], [concrete]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].requestId, concrete.requestId);
  assert.equal(merged[0].status, "answered");
  assert.equal(merged[0].response, concrete.response);
  assert.equal(merged[0].answeredAt, concrete.answeredAt);
});

test("web history merge lets a real transcript answer replace a cached failed card", async () => {
  const { mergeHistoryItems } = await loadHistoryMergeHelpers();
  const cachedFailed = {
    requestId: "2f66a266-6b05-441f-8e80-32d2e15224fd",
    projectPath: "/repo/clawdad",
    sessionId: "019ddf17-7e93-7840-a89b-cc2702c32a02",
    provider: "codex",
    message: "Please compare OpenClaw and Clawdad.",
    sentAt: "2026-05-03T15:35:13.537Z",
    answeredAt: "2026-05-03T15:37:16.000Z",
    status: "failed",
    exitCode: 1,
    response: "Failed.",
  };
  const transcriptAnswer = {
    requestId: "codex:019ddf17-7e93-7840-a89b-cc2702c32a02:54",
    projectPath: "/repo/clawdad",
    sessionId: cachedFailed.sessionId,
    provider: "codex",
    message: cachedFailed.message,
    sentAt: "2026-05-03T15:35:18.000Z",
    answeredAt: "2026-05-03T15:37:20.000Z",
    status: "answered",
    exitCode: 0,
    response: "Detailed final comparison.",
  };

  const merged = mergeHistoryItems([cachedFailed], [transcriptAnswer]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "answered");
  assert.equal(merged[0].response, transcriptAnswer.response);
  assert.equal(merged[0].answeredAt, transcriptAnswer.answeredAt);
});
