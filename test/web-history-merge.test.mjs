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
