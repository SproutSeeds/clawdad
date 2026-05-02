import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileP = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dispatchScript = path.join(repoRoot, "lib", "codex-app-server-dispatch.mjs");

async function execFileCapture(command, args, options = {}) {
  try {
    const result = await execFileP(command, args, options);
    return {
      exitCode: 0,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    };
  } catch (error) {
    return {
      exitCode: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout || "",
      stderr: error.stderr || "",
    };
  }
}

async function withTempDir(work) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-codex-dispatch-test-"));
  try {
    return await work(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeFakeCodexBinary(root, behavior) {
  const fakePath = path.join(root, `fake-codex-${behavior}.mjs`);
  const jsonDecisionResponse = `${"long ".repeat(700)}
\`\`\`json
{"state":"continue","stop_reason":"none","next_action":"keep going","summary":"ok","checkpoint":{"progress_signal":"high","breakthroughs":"decision payload","blockers":"none","next_probe":"next","confidence":"high"}}
\`\`\``;
const source = `#!/usr/bin/env node
const behavior = ${JSON.stringify(behavior)};
const jsonDecisionResponse = ${JSON.stringify(jsonDecisionResponse)};
const requestLogFile = process.env.FAKE_CODEX_REQUEST_LOG || "";
process.stdin.setEncoding("utf8");
process.on("SIGTERM", () => process.exit(0));
let buffer = "";
function send(value) {
  process.stdout.write(JSON.stringify(value) + "\\n");
}
async function logRequest(message) {
  if (!requestLogFile) return;
  const { appendFile, mkdir } = await import("node:fs/promises");
  const path = await import("node:path");
  await mkdir(path.dirname(requestLogFile), { recursive: true });
  await appendFile(requestLogFile, JSON.stringify(message) + "\\n", "utf8");
}
function handle(message) {
  void logRequest(message);
  if (behavior === "silent") {
    return;
  }
  if (message.method === "initialize") {
    send({ id: message.id, result: { ok: true } });
    return;
  }
  if (message.method === "thread/resume" || message.method === "thread/start") {
    send({ id: message.id, result: { thread: { id: message.params?.threadId || "thread-test" } } });
    return;
  }
  if (message.method === "thread/goal/set") {
    if (behavior === "goal-unsupported") {
      send({ id: message.id, error: { message: "method not found: thread/goal/set" } });
      return;
    }
    const objective = message.params?.objective || "";
    const status = message.params?.status || "active";
    send({
      id: message.id,
      result: {
        goal: {
          threadId: message.params?.threadId || "thread-test",
          objective,
          status,
          tokenBudget: message.params?.tokenBudget ?? null,
          tokensUsed: 3,
          timeUsedSeconds: 1,
          createdAt: 1,
          updatedAt: 2,
        },
      },
    });
    send({
      method: "thread/goal/updated",
      params: {
        threadId: message.params?.threadId || "thread-test",
        turnId: null,
        goal: {
          threadId: message.params?.threadId || "thread-test",
          objective,
          status,
          tokenBudget: message.params?.tokenBudget ?? null,
          tokensUsed: 3,
          timeUsedSeconds: 1,
          createdAt: 1,
          updatedAt: 2,
        },
      },
    });
    return;
  }
  if (message.method === "thread/goal/clear") {
    send({ id: message.id, result: { cleared: true } });
    send({
      method: "thread/goal/cleared",
      params: {
        threadId: message.params?.threadId || "thread-test",
      },
    });
    return;
  }
  if (message.method === "turn/start") {
    send({ id: message.id, result: { turn: { id: "turn-test" } } });
    if (
      behavior === "complete" ||
      behavior === "delta" ||
      behavior === "delta-json" ||
      behavior === "goal-unsupported" ||
      behavior === "turn-id-param"
    ) {
      setTimeout(() => {
        if (behavior === "delta" || behavior === "delta-json") {
          send({
            method: "item/agentMessage/delta",
            params: {
              threadId: "thread-test",
              turnId: "turn-test",
              itemId: "agent-live",
              delta: "working live",
            },
          });
        }
        send({
          method: "item/completed",
          params: {
            threadId: "thread-test",
            turnId: "turn-test",
            item: { type: "agentMessage", phase: "final_answer", text: behavior === "delta-json" ? jsonDecisionResponse : behavior === "delta" ? "live final response" : "fake response" },
          },
        });
        send({
          method: "turn/completed",
          params: behavior === "turn-id-param"
            ? {
                threadId: "thread-test",
                turnId: "turn-test",
                turn: { status: "completed" },
              }
            : {
                threadId: "thread-test",
                turn: { id: "turn-test", status: "completed" },
              },
        });
      }, 10);
    }
    return;
  }
  if (message.method === "thread/read") {
    send({
      id: message.id,
      result: {
        thread: {
          turns: [
            {
              id: "turn-test",
              items: [
                { type: "agentMessage", phase: "final_answer", text: behavior === "delta-json" ? jsonDecisionResponse : behavior === "delta" ? "live final response" : "fake response" },
              ],
            },
          ],
        },
      },
    });
  }
}
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const index = buffer.indexOf("\\n");
    if (index < 0) break;
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) handle(JSON.parse(line));
  }
});
setInterval(() => {}, 1000);
`;
  await writeFile(fakePath, source, "utf8");
  await chmod(fakePath, 0o755);
  return fakePath;
}

test("codex app-server dispatch times out a turn that never completes", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "never-complete");
    const result = await execFileCapture(process.execPath, [
      dispatchScript,
      "--project-path",
      root,
      "--message",
      "hello",
      "--session-id",
      "thread-test",
      "--session-seeded",
      "--codex-binary",
      fakeCodex,
      "--turn-timeout-ms",
      "50",
      "--request-timeout-ms",
      "2000",
    ], { timeout: 10000 });

    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.ok, false);
    assert.match(payload.error_text, /codex turn did not complete within 1s/u);
  });
});

test("codex app-server dispatch times out a missing RPC response", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "silent");
    const result = await execFileCapture(process.execPath, [
      dispatchScript,
      "--project-path",
      root,
      "--message",
      "hello",
      "--session-id",
      "thread-test",
      "--session-seeded",
      "--codex-binary",
      fakeCodex,
      "--turn-timeout-ms",
      "1000",
      "--request-timeout-ms",
      "50",
    ], { timeout: 10000 });

    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.ok, false);
    assert.match(payload.error_text, /timed out waiting for codex app-server initialize response after 1s/u);
  });
});

test("codex app-server dispatch keeps fast RPC responses attached to pending requests", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "complete");
    const requestLog = path.join(root, "requests.jsonl");
    const result = await execFileCapture(process.execPath, [
      dispatchScript,
      "--project-path",
      root,
      "--message",
      "hello",
      "--session-id",
      "thread-test",
      "--session-seeded",
      "--codex-binary",
      fakeCodex,
      "--turn-timeout-ms",
      "1000",
      "--request-timeout-ms",
      "2000",
    ], {
      env: {
        ...process.env,
        FAKE_CODEX_REQUEST_LOG: requestLog,
      },
      timeout: 10000,
    });

    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.ok, true);
    assert.equal(payload.result_text, "fake response");

    const requests = (await readFile(requestLog, "utf8"))
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    const initialize = requests.find((entry) => entry.method === "initialize");
    assert.equal(initialize.params.capabilities.experimentalApi, false);
    assert.equal(requests.some((entry) => String(entry.method || "").startsWith("thread/goal/")), false);
  });
});

test("codex app-server dispatch accepts turn/completed events keyed by params.turnId", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "turn-id-param");
    const result = await execFileCapture(process.execPath, [
      dispatchScript,
      "--project-path",
      root,
      "--message",
      "hello",
      "--session-id",
      "thread-test",
      "--session-seeded",
      "--codex-binary",
      fakeCodex,
      "--turn-timeout-ms",
      "1000",
      "--request-timeout-ms",
      "2000",
    ], { timeout: 10000 });

    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.ok, true);
    assert.equal(payload.result_text, "fake response");
  });
});

test("codex app-server dispatch writes throttled live delegate events", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "delta");
    const eventFile = path.join(root, "events.jsonl");
    const result = await execFileCapture(process.execPath, [
      dispatchScript,
      "--project-path",
      root,
      "--message",
      "hello",
      "--session-id",
      "thread-test",
      "--session-seeded",
      "--codex-binary",
      fakeCodex,
      "--turn-timeout-ms",
      "1000",
      "--request-timeout-ms",
      "2000",
    ], {
      env: {
        ...process.env,
        CLAWDAD_CODEX_LIVE_EVENT_FILE: eventFile,
        CLAWDAD_CODEX_LIVE_RUN_ID: "run-live",
        CLAWDAD_CODEX_LIVE_STEP: "2",
      },
      timeout: 10000,
    });

    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.ok, true);
    assert.equal(payload.result_text, "live final response");

    const lines = (await readFile(eventFile, "utf8")).trim().split(/\r?\n/u);
    assert.ok(lines.length >= 1);
    const latest = JSON.parse(lines.at(-1));
    assert.equal(latest.id, "live-run-live-2");
    assert.equal(latest.type, "agent_live");
    assert.equal(latest.runId, "run-live");
    assert.equal(latest.step, 2);
    assert.equal(latest.text, "live final response");
  });
});

test("codex app-server dispatch stores recoverable decision payload on truncated live checkpoints", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "delta-json");
    const eventFile = path.join(root, "events.jsonl");
    const result = await execFileCapture(process.execPath, [
      dispatchScript,
      "--project-path",
      root,
      "--message",
      "hello",
      "--session-id",
      "thread-test",
      "--session-seeded",
      "--codex-binary",
      fakeCodex,
      "--turn-timeout-ms",
      "1000",
      "--request-timeout-ms",
      "2000",
    ], {
      env: {
        ...process.env,
        CLAWDAD_CODEX_LIVE_EVENT_FILE: eventFile,
        CLAWDAD_CODEX_LIVE_RUN_ID: "run-live",
        CLAWDAD_CODEX_LIVE_STEP: "3",
      },
      timeout: 10000,
    });

    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);

    const lines = (await readFile(eventFile, "utf8")).trim().split(/\r?\n/u);
    const latest = JSON.parse(lines.at(-1));
    assert.equal(latest.title, "Live stream checkpoint");
    assert.equal(latest.payload.truncated, true);
    assert.equal(latest.payload.decision.state, "continue");
    assert.equal(latest.payload.decision.next_action, "keep going");
    assert.equal(latest.payload.decision.checkpoint.progress_signal, "high");
  });
});

test("codex app-server dispatch syncs an optional thread goal", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "complete");
    const requestLog = path.join(root, "requests.jsonl");
    const result = await execFileCapture(process.execPath, [
      dispatchScript,
      "--project-path",
      root,
      "--message",
      "hello",
      "--session-id",
      "thread-test",
      "--session-seeded",
      "--thread-goal",
      "Advance the app-server migration without breaking the mobile path.",
      "--codex-binary",
      fakeCodex,
      "--turn-timeout-ms",
      "1000",
      "--request-timeout-ms",
      "2000",
    ], {
      env: {
        ...process.env,
        FAKE_CODEX_REQUEST_LOG: requestLog,
      },
      timeout: 10000,
    });

    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.ok, true);
    assert.equal(payload.thread_goal_synced, true);
    assert.equal(payload.thread_goal_error, "");

    const requests = (await readFile(requestLog, "utf8"))
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    const initialize = requests.find((entry) => entry.method === "initialize");
    assert.equal(initialize.params.capabilities.experimentalApi, true);
    const goalSet = requests.find((entry) => entry.method === "thread/goal/set");
    assert.equal(goalSet.params.threadId, "thread-test");
    assert.equal(goalSet.params.objective, "Advance the app-server migration without breaking the mobile path.");
    assert.equal(goalSet.params.status, "active");
  });
});

test("codex app-server dispatch treats unsupported thread goals as auto-mode fallback", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "goal-unsupported");
    const result = await execFileCapture(process.execPath, [
      dispatchScript,
      "--project-path",
      root,
      "--message",
      "hello",
      "--session-id",
      "thread-test",
      "--session-seeded",
      "--thread-goal",
      "Keep going.",
      "--goal-mode",
      "auto",
      "--codex-binary",
      fakeCodex,
      "--turn-timeout-ms",
      "1000",
      "--request-timeout-ms",
      "2000",
    ], { timeout: 10000 });

    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.ok, true);
    assert.equal(payload.thread_goal_supported, false);
    assert.equal(payload.thread_goal_synced, false);
    assert.equal(payload.thread_goal_skipped, true);
    assert.match(payload.thread_goal_error, /method not found/u);
  });
});

test("codex app-server dispatch fails required mode when thread goals are unsupported", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "goal-unsupported");
    const result = await execFileCapture(process.execPath, [
      dispatchScript,
      "--project-path",
      root,
      "--message",
      "hello",
      "--session-id",
      "thread-test",
      "--session-seeded",
      "--thread-goal",
      "Keep going.",
      "--goal-mode",
      "required",
      "--codex-binary",
      fakeCodex,
      "--turn-timeout-ms",
      "1000",
      "--request-timeout-ms",
      "2000",
    ], { timeout: 10000 });

    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.ok, false);
    assert.equal(payload.thread_goal_supported, false);
    assert.equal(payload.thread_goal_synced, false);
    assert.match(payload.error_text, /method not found/u);
  });
});

test("codex app-server dispatch can update only thread goal status", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "complete");
    const result = await execFileCapture(process.execPath, [
      dispatchScript,
      "--goal-only",
      "--project-path",
      root,
      "--session-id",
      "thread-test",
      "--session-seeded",
      "--thread-goal",
      "Finish cleanly.",
      "--thread-goal-status",
      "complete",
      "--codex-binary",
      fakeCodex,
      "--request-timeout-ms",
      "2000",
    ], { timeout: 10000 });

    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.ok, true);
    assert.equal(payload.thread_goal_status, "complete");
    assert.equal(payload.thread_goal_objective, "Finish cleanly.");
    assert.equal(payload.thread_goal_synced, true);
  });
});

test("codex app-server dispatch writes normalized app-server event logs", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "delta");
    const eventLog = path.join(root, "codex-events.jsonl");
    const result = await execFileCapture(process.execPath, [
      dispatchScript,
      "--project-path",
      root,
      "--message",
      "hello",
      "--session-id",
      "thread-test",
      "--session-seeded",
      "--event-log-file",
      eventLog,
      "--codex-binary",
      fakeCodex,
      "--turn-timeout-ms",
      "1000",
      "--request-timeout-ms",
      "2000",
    ], { timeout: 10000 });

    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);

    const events = (await readFile(eventLog, "utf8"))
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.type === "codex_agent_message_delta" && event.payload.delta === "working live"));
    assert.ok(events.some((event) => event.type === "codex_agent_message" && event.payload.text === "live final response"));
    assert.ok(events.some((event) => event.type === "codex_turn_completed" && event.status === "completed"));
  });
});

test("codex app-server dispatch records normalized thread goal events", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "complete");
    const eventLog = path.join(root, "codex-events.jsonl");
    const result = await execFileCapture(process.execPath, [
      dispatchScript,
      "--project-path",
      root,
      "--message",
      "hello",
      "--session-id",
      "thread-test",
      "--session-seeded",
      "--thread-goal",
      "Record the goal event.",
      "--event-log-file",
      eventLog,
      "--codex-binary",
      fakeCodex,
      "--turn-timeout-ms",
      "1000",
      "--request-timeout-ms",
      "2000",
    ], { timeout: 10000 });

    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);

    const events = (await readFile(eventLog, "utf8"))
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    const sync = events.find((event) => event.type === "codex_goal_sync");
    assert.equal(sync.payload.synced, true);
    assert.equal(sync.payload.goal.status, "active");
    assert.equal(sync.payload.goal.objective, "Record the goal event.");
    assert.ok(events.some((event) => event.type === "codex_thread_goal_updated"));
  });
});
