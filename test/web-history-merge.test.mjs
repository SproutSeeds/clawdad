import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const repoRoot = path.resolve(import.meta.dirname, "..");
const webAppPath = path.join(repoRoot, "web", "app.js");

async function loadHistoryMergeHelpers() {
  const source = await readFile(webAppPath, "utf8");
  const start = source.indexOf("function normalizeHistoryItem");
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
  const start = source.indexOf("function normalizeHistoryItem");
  const end = source.indexOf("function cacheProjects");
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
    ["answered", "queued"],
  );
  assert.equal(
    context.state.historyThreads["/repo/clawdad::session-failed"].items[0].status,
    "failed",
  );
});

test("web dashboard queue visibility excludes failed cards still present in memory", async () => {
  const context = await loadThreadCacheHelpers();
  assert.equal(context.threadEntryVisibleInQueue({ status: "queued" }), true);
  assert.equal(context.threadEntryVisibleInQueue({ status: "answered" }), true);
  assert.equal(context.threadEntryVisibleInQueue({ status: "failed" }), false);
  assert.equal(context.threadEntryVisibleInQueue({ status: "FAILED" }), false);
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
