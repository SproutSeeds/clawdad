import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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

async function waitForApprovalFile(projectPath, timeoutMs = 5000) {
  const approvalDir = path.join(projectPath, ".clawdad", "mailbox", "approvals");
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const fileName = (await readdir(approvalDir).catch(() => []))
      .find((entry) => entry.endsWith(".json"));
    if (fileName) {
      return path.join(approvalDir, fileName);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for pending approval file");
}

async function writeFakeCodexBinary(root, behavior) {
  const fakePath = path.join(root, `fake-codex-${behavior}.mjs`);
  const jsonDecisionResponse = `${"long ".repeat(700)}
\`\`\`json
{"state":"continue","stop_reason":"none","next_action":"keep going","summary":"ok","checkpoint":{"progress_signal":"high","breakthroughs":"decision payload","blockers":"none","next_probe":"next","confidence":"high"}}
\`\`\``;
const source = `#!/usr/bin/env node
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
const behavior = ${JSON.stringify(behavior)};
const jsonDecisionResponse = ${JSON.stringify(jsonDecisionResponse)};
const requestLogFile = process.env.FAKE_CODEX_REQUEST_LOG || "";
process.stdin.setEncoding("utf8");
process.on("SIGTERM", () => process.exit(0));
let buffer = "";
let toolActive = false;
function send(value) {
  process.stdout.write(JSON.stringify(value) + "\\n");
}
function logRequest(message) {
  if (!requestLogFile) return;
  mkdirSync(path.dirname(requestLogFile), { recursive: true });
  appendFileSync(requestLogFile, JSON.stringify(message) + "\\n", "utf8");
}
function handle(message) {
  logRequest(message);
  if (behavior === "silent") {
    return;
  }
  if (behavior === "server-approval" && message.id === "approval-1" && !message.method) {
    if (message.result?.decision !== "accept") {
      send({
        method: "error",
        params: {
          threadId: "thread-test",
          turnId: "turn-test",
          error: { message: "approval was not accepted" },
        },
      });
      return;
    }
    send({
      method: "item/completed",
      params: {
        threadId: "thread-test",
        turnId: "turn-test",
        item: { id: "cmd-approval", type: "commandExecution", status: "completed" },
      },
    });
    send({
      method: "item/completed",
      params: {
        threadId: "thread-test",
        turnId: "turn-test",
        item: { type: "agentMessage", phase: "final_answer", text: "approved response" },
      },
    });
    send({
      method: "turn/completed",
      params: {
        threadId: "thread-test",
        turn: { id: "turn-test", status: "completed" },
      },
    });
    return;
  }
  if (message.method === "initialize") {
    send({ id: message.id, result: { ok: true } });
    return;
  }
  if (message.method === "thread/resume" || message.method === "thread/start") {
    const respond = () => {
      send({
        id: message.id,
        result: {
          thread: {
            id: behavior === "partial-stall" ? "thread-real" : message.params?.threadId || "thread-test",
          },
        },
      });
    };
    if (behavior === "slow-resume" && message.method === "thread/resume") {
      setTimeout(respond, 2500);
      return;
    }
    respond();
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
    if (behavior === "exit-during-turn") {
      setTimeout(() => process.exit(17), 20);
    }
    if (behavior === "retryable-error") {
      setTimeout(() => {
        send({
          method: "error",
          params: {
            threadId: "thread-test",
            turnId: "turn-test",
            error: {
              message: "Reconnecting... 2/5",
              codexErrorInfo: {
                responseStreamDisconnected: {
                  httpStatusCode: null,
                },
              },
              additionalDetails: "stream disconnected before completion",
            },
            willRetry: true,
          },
        });
      }, 10);
    }
    if (behavior === "terminal-error") {
      setTimeout(() => {
        send({
          method: "error",
          params: {
            threadId: "thread-test",
            turnId: "turn-test",
            error: {
              message: "response stream disconnected permanently",
            },
            willRetry: false,
          },
        });
      }, 10);
    }
    if (behavior === "unrelated-error") {
      setTimeout(() => {
        send({
          method: "error",
          params: {
            threadId: "thread-other",
            turnId: "turn-other",
            error: {
              message: "another turn failed",
            },
            willRetry: false,
          },
        });
      }, 10);
    }
    if (behavior === "steer") {
      setTimeout(() => {
        toolActive = true;
        send({
          method: "item/started",
          params: {
            threadId: "thread-test",
            turnId: "turn-test",
            item: { id: "cmd-live", type: "commandExecution", status: "in_progress" },
          },
        });
      }, 10);
      setTimeout(() => {
        toolActive = false;
        send({
          method: "item/completed",
          params: {
            threadId: "thread-test",
            turnId: "turn-test",
            item: { id: "cmd-live", type: "commandExecution", status: "completed" },
          },
        });
      }, 80);
      setTimeout(() => {
        send({
          method: "item/completed",
          params: {
            threadId: "thread-test",
            turnId: "turn-test",
            item: { type: "agentMessage", phase: "final_answer", text: "steered response" },
          },
        });
        send({
          method: "turn/completed",
          params: {
            threadId: "thread-test",
            turn: { id: "turn-test", status: "completed" },
          },
        });
      }, 650);
    }
    if (behavior === "partial-stall") {
      setTimeout(() => {
        send({
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread-real",
            turnId: "turn-test",
            itemId: "agent-live",
            delta: "partial progress before stall",
          },
        });
        send({
          method: "item/started",
          params: {
            threadId: "thread-real",
            turnId: "turn-test",
            item: { id: "tool-stuck", type: "mcpToolCall", status: "in_progress" },
          },
        });
      }, 10);
    }
    if (behavior === "server-approval") {
      setTimeout(() => {
        send({
          method: "item/started",
          params: {
            threadId: "thread-test",
            turnId: "turn-test",
            item: { id: "cmd-approval", type: "commandExecution", status: "in_progress" },
          },
        });
        send({
          id: "approval-1",
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: "thread-test",
            turnId: "turn-test",
            itemId: "cmd-approval",
            startedAtMs: Date.now(),
            reason: "Commit the verified project changes.",
            command: "git commit -m verified",
            cwd: process.cwd(),
            availableDecisions: ["accept", "decline"],
          },
        });
      }, 10);
    }
    if (behavior === "slow-tool-complete") {
      setTimeout(() => {
        send({
          method: "item/started",
          params: {
            threadId: "thread-test",
            turnId: "turn-test",
            item: { id: "tool-slow", type: "mcpToolCall", status: "in_progress" },
          },
        });
      }, 10);
      setTimeout(() => {
        send({
          method: "item/completed",
          params: {
            threadId: "thread-test",
            turnId: "turn-test",
            item: { id: "tool-slow", type: "mcpToolCall", status: "completed" },
          },
        });
      }, 110);
      setTimeout(() => {
        send({
          method: "item/completed",
          params: {
            threadId: "thread-test",
            turnId: "turn-test",
            item: { type: "agentMessage", phase: "final_answer", text: "tool completed response" },
          },
        });
        send({
          method: "turn/completed",
          params: {
            threadId: "thread-test",
            turn: { id: "turn-test", status: "completed" },
          },
        });
      }, 130);
    }
    if (
      behavior === "complete" ||
      behavior === "delta" ||
      behavior === "delta-json" ||
      behavior === "goal-unsupported" ||
      behavior === "turn-id-param" ||
      behavior === "slow-resume" ||
      behavior === "retryable-error" ||
      behavior === "unrelated-error"
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
      }, behavior === "retryable-error" || behavior === "unrelated-error" ? 40 : 10);
    }
    return;
  }
  if (message.method === "turn/steer") {
    if (toolActive) {
      send({ id: message.id, error: { message: "Direct message arrived before the active tool completed" } });
      return;
    }
    send({ id: message.id, result: { turn: { id: message.params?.expectedTurnId || "turn-test" } } });
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

test("codex app-server dispatch lets a healthy seeded thread resume beyond the ordinary request timeout", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "slow-resume");
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
      "--resume-timeout-ms",
      "0",
    ], { timeout: 10000 });

    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.ok, true);
    assert.equal(payload.session_id, "thread-test");
    assert.equal(payload.result_text, "fake response");
  });
});

test("codex app-server dispatch fails on confirmed app-server process death without a turn timer", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "exit-during-turn");
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
      "0",
      "--turn-idle-timeout-ms",
      "0",
      "--liveness-interval-ms",
      "25",
      "--request-timeout-ms",
      "2000",
    ], { timeout: 10000 });

    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.ok, false);
    assert.match(payload.error_text, /exited before the active turn completed/u);
  });
});

test("codex app-server dispatch waits through a retryable response stream disconnect", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "retryable-error");
    const eventLog = path.join(root, "events.jsonl");
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
      "0",
      "--turn-idle-timeout-ms",
      "0",
      "--event-log-file",
      eventLog,
      "--request-timeout-ms",
      "2000",
    ], { timeout: 10000 });

    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.ok, true);
    assert.equal(payload.result_text, "fake response");

    const events = (await readFile(eventLog, "utf8"))
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    const reconnect = events.find((event) => event.type === "codex_error");
    assert.equal(reconnect.payload.willRetry, true);
    assert.equal(reconnect.payload.retryable, true);
    assert.equal(
      reconnect.payload.codexErrorInfo.responseStreamDisconnected.httpStatusCode,
      null,
    );
    assert.equal(reconnect.payload.additionalDetails, "stream disconnected before completion");
  });
});

test("codex app-server dispatch still fails a terminal error for the active turn", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "terminal-error");
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
      "0",
      "--turn-idle-timeout-ms",
      "0",
      "--request-timeout-ms",
      "2000",
    ], { timeout: 10000 });

    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.ok, false);
    assert.match(payload.error_text, /response stream disconnected permanently/u);
  });
});

test("codex app-server dispatch ignores terminal errors from another turn", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "unrelated-error");
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
      "0",
      "--turn-idle-timeout-ms",
      "0",
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

test("codex app-server dispatch responds to server-initiated approval requests", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "server-approval");
    const requestLog = path.join(root, "requests.jsonl");
    const result = await execFileCapture(process.execPath, [
      dispatchScript,
      "--project-path",
      root,
      "--message",
      "commit the verified change",
      "--session-id",
      "thread-test",
      "--session-seeded",
      "--permission-mode",
      "full",
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
    assert.equal(payload.result_text, "approved response");
    const requests = (await readFile(requestLog, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const response = requests.find((entry) => entry.id === "approval-1" && !entry.method);
    assert.deepEqual(response, {
      id: "approval-1",
      result: {
        decision: "accept",
      },
    });
  });
});

test("repo-scoped codex dispatch waits for and applies an explicit approval decision", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "server-approval");
    const requestLog = path.join(root, "requests.jsonl");
    const eventLog = path.join(root, "events.jsonl");
    const child = spawn(process.execPath, [
      dispatchScript,
      "--project-path",
      root,
      "--message",
      "commit the verified change",
      "--session-id",
      "thread-test",
      "--session-seeded",
      "--permission-mode",
      "approve",
      "--codex-binary",
      fakeCodex,
      "--turn-timeout-ms",
      "5000",
      "--request-timeout-ms",
      "2000",
      "--liveness-interval-ms",
      "25",
      "--liveness-probe-timeout-ms",
      "500",
    ], {
      env: {
        ...process.env,
        FAKE_CODEX_REQUEST_LOG: requestLog,
        CLAWDAD_CODEX_EVENT_LOG_FILE: eventLog,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    try {
      const approvalFile = await waitForApprovalFile(root);
      const approval = JSON.parse(await readFile(approvalFile, "utf8"));
      assert.equal(approval.state, "pending");
      assert.equal(approval.method, "item/commandExecution/requestApproval");
      assert.equal(approval.permissionMode, "approve");
      assert.match(approval.prompt, /Commit the verified project changes/u);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const decided = {
        ...approval,
        state: "decided",
        decision: "approve",
        decidedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const tempFile = `${approvalFile}.test.tmp`;
      await writeFile(tempFile, `${JSON.stringify(decided, null, 2)}\n`, "utf8");
      await rename(tempFile, approvalFile);

      const exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => resolve(code));
      });
      assert.equal(exitCode, 0, stderr);
      const payload = JSON.parse(stdout.trim());
      assert.equal(payload.ok, true);
      assert.equal(payload.result_text, "approved response");

      const resolved = JSON.parse(await readFile(approvalFile, "utf8"));
      assert.equal(resolved.state, "resolved");
      const requests = (await readFile(requestLog, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        requests.find((entry) => entry.id === "approval-1" && !entry.method),
        {
          id: "approval-1",
          result: {
            decision: "accept",
          },
        },
      );
      const events = (await readFile(eventLog, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const approvalLiveness = events.find((event) => (
        event.method === "clawdad/turn/liveness" &&
        event.payload?.phase === "awaiting_approval"
      ));
      assert.ok(approvalLiveness);
      assert.equal(approvalLiveness.payload.pendingServerRequests, 1);
      assert.deepEqual(
        approvalLiveness.payload.serverRequestMethods,
        ["item/commandExecution/requestApproval"],
      );
    } finally {
      if (child.exitCode == null) {
        child.kill("SIGKILL");
      }
    }
  });
});

test("codex app-server dispatch fails with recovered partial text when a connector tool stops making progress", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "partial-stall");
    const result = await execFileCapture(process.execPath, [
      dispatchScript,
      "--project-path",
      root,
      "--message",
      "hello",
      "--session-id",
      "thread-placeholder",
      "--session-seeded",
      "--codex-binary",
      fakeCodex,
      "--turn-timeout-ms",
      "5000",
      "--turn-idle-timeout-ms",
      "5000",
      "--tool-idle-timeout-ms",
      "50",
      "--request-timeout-ms",
      "2000",
    ], { timeout: 10000 });

    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 124);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.ok, false);
    assert.equal(payload.recovered, true);
    assert.equal(payload.recovery_reason, "tool_idle_timeout");
    assert.equal(payload.session_id, "thread-real");
    assert.match(payload.result_text, /no live progress/u);
    assert.match(payload.result_text, /connector\/tool call/u);
    assert.match(payload.error_text, /connector\/tool call/u);
    assert.match(payload.result_text, /partial progress before stall/u);
  });
});

test("codex app-server dispatch allows quiet connector tools when tool idle timeout is disabled", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "slow-tool-complete");
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
      "5000",
      "--turn-idle-timeout-ms",
      "5000",
      "--tool-idle-timeout-ms",
      "0",
      "--request-timeout-ms",
      "2000",
    ], { timeout: 10000 });

    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.ok, true);
    assert.equal(payload.recovered, undefined);
    assert.equal(payload.result_text, "tool completed response");
  });
});

test("codex app-server liveness probes keep a quiet active turn alive beyond an idle window", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "slow-tool-complete");
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
      "0",
      "--turn-idle-timeout-ms",
      "50",
      "--tool-idle-timeout-ms",
      "0",
      "--liveness-interval-ms",
      "25",
      "--liveness-probe-timeout-ms",
      "500",
      "--request-timeout-ms",
      "2000",
    ], { timeout: 10000 });

    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.ok, true);
    assert.equal(payload.result_text, "tool completed response");
  });
});

test("codex app-server dispatch steers queued interjections into the active turn", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "steer");
    const requestLog = path.join(root, "requests.jsonl");
    const interjectionDir = path.join(root, ".clawdad", "mailbox", "interjections");
    const historySessionDir = path.join(root, ".clawdad", "history", "sessions", "thread-test");
    const historyRequestsDir = path.join(root, ".clawdad", "history", "requests");
    const recordFile = path.join(historySessionDir, "20260505T120000--interject-1.json");
    const indexFile = path.join(historyRequestsDir, "interject-1.json");
    await mkdir(interjectionDir, { recursive: true });
    await mkdir(historySessionDir, { recursive: true });
    await mkdir(historyRequestsDir, { recursive: true });
    await writeFile(
      path.join(interjectionDir, "interject-1.json"),
      JSON.stringify(
        {
          state: "pending",
          requestId: "interject-1",
          sessionId: "thread-test",
          message: "Fold this into the current loop.",
          createdAt: "2026-05-05T12:00:00.000Z",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(interjectionDir, "interject-other.json"),
      JSON.stringify(
        {
          state: "pending",
          requestId: "interject-other",
          sessionId: "other-thread",
          message: "This belongs to a different session.",
          createdAt: "2026-05-05T11:59:00.000Z",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      recordFile,
      JSON.stringify(
        {
          requestId: "interject-1",
          projectPath: root,
          sessionId: "thread-test",
          sessionSlug: "test",
          provider: "codex",
          message: "Fold this into the current loop.",
          sentAt: "2026-05-05T12:00:00.000Z",
          answeredAt: null,
          status: "queued",
          exitCode: null,
          response: "",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      indexFile,
      JSON.stringify(
        {
          requestId: "interject-1",
          sessionId: "thread-test",
          sentAt: "2026-05-05T12:00:00.000Z",
          file: recordFile,
        },
        null,
        2,
      ),
      "utf8",
    );

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
      "--interjection-dir",
      interjectionDir,
      "--turn-timeout-ms",
      "5000",
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
    assert.equal(payload.result_text, "steered response");

    const requests = (await readFile(requestLog, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const steerRequests = requests.filter((entry) => entry.method === "turn/steer");
    assert.ok(steerRequests.length >= 1);
    assert.ok(steerRequests.length <= 2);
    const steerRequest = steerRequests.at(-1);
    assert.equal(steerRequest.params.threadId, "thread-test");
    assert.equal(steerRequest.params.expectedTurnId, "turn-test");
    assert.equal(steerRequest.params.input[0].text, "Fold this into the current loop.");

    const interjection = JSON.parse(await readFile(path.join(interjectionDir, "interject-1.json"), "utf8"));
    assert.equal(interjection.state, "accepted");
    const skippedInterjection = JSON.parse(await readFile(path.join(interjectionDir, "interject-other.json"), "utf8"));
    assert.equal(skippedInterjection.state, "pending");
    const record = JSON.parse(await readFile(recordFile, "utf8"));
    assert.equal(record.status, "answered");
    assert.match(record.response, /Sent directly into the active Codex turn/u);
  });
});

test("codex app-server dispatch steers provisional-session interjections after thread remap", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "steer");
    const requestLog = path.join(root, "requests.jsonl");
    const interjectionDir = path.join(root, ".clawdad", "mailbox", "interjections");
    const historySessionDir = path.join(root, ".clawdad", "history", "sessions", "placeholder-thread");
    const historyRequestsDir = path.join(root, ".clawdad", "history", "requests");
    const recordFile = path.join(historySessionDir, "20260505T120000--interject-remap.json");
    const indexFile = path.join(historyRequestsDir, "interject-remap.json");
    await mkdir(interjectionDir, { recursive: true });
    await mkdir(historySessionDir, { recursive: true });
    await mkdir(historyRequestsDir, { recursive: true });
    await writeFile(
      path.join(interjectionDir, "interject-remap.json"),
      JSON.stringify(
        {
          state: "pending",
          requestId: "interject-remap",
          sessionId: "placeholder-thread",
          message: "Fold this into the real thread.",
          createdAt: "2026-05-05T12:00:00.000Z",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      recordFile,
      JSON.stringify(
        {
          requestId: "interject-remap",
          projectPath: root,
          sessionId: "placeholder-thread",
          sessionSlug: "test",
          provider: "codex",
          message: "Fold this into the real thread.",
          sentAt: "2026-05-05T12:00:00.000Z",
          answeredAt: null,
          status: "queued",
          exitCode: null,
          response: "",
          scheduleMode: "interject",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      indexFile,
      JSON.stringify(
        {
          requestId: "interject-remap",
          sessionId: "placeholder-thread",
          sentAt: "2026-05-05T12:00:00.000Z",
          file: recordFile,
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await execFileCapture(process.execPath, [
      dispatchScript,
      "--project-path",
      root,
      "--message",
      "hello",
      "--session-id",
      "placeholder-thread",
      "--codex-binary",
      fakeCodex,
      "--interjection-dir",
      interjectionDir,
      "--turn-timeout-ms",
      "5000",
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
    assert.equal(payload.session_id, "thread-test");

    const requests = (await readFile(requestLog, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const steerRequest = requests.find((entry) => entry.method === "turn/steer");
    assert.ok(steerRequest);
    assert.equal(steerRequest.params.threadId, "thread-test");
    assert.equal(steerRequest.params.input[0].text, "Fold this into the real thread.");

    const interjection = JSON.parse(await readFile(path.join(interjectionDir, "interject-remap.json"), "utf8"));
    assert.equal(interjection.state, "accepted");
    assert.equal(interjection.sessionId, "thread-test");
    const index = JSON.parse(await readFile(indexFile, "utf8"));
    assert.equal(index.sessionId, "thread-test");
    assert.match(index.file, /sessions\/thread-test\/20260505T120000\.000Z--interject-remap\.json$/u);
    const record = JSON.parse(await readFile(index.file, "utf8"));
    assert.equal(record.sessionId, "thread-test");
    assert.equal(record.status, "answered");
    assert.equal(record.scheduleMode, "interject");
    await assert.rejects(readFile(recordFile, "utf8"));
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

test("codex app-server dispatch applies model and reasoning effort to the thread and turn", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "delta");
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
      "--model",
      "gpt-5.6-sol",
      "--reasoning-effort",
      "ultra",
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
    const requests = (await readFile(requestLog, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const resume = requests.find((entry) => entry.method === "thread/resume");
    const turn = requests.find((entry) => entry.method === "turn/start");
    assert.equal(resume.params.model, "gpt-5.6-sol");
    assert.equal(resume.params.config.model_reasoning_effort, "ultra");
    assert.equal(turn.params.model, "gpt-5.6-sol");
    assert.equal(turn.params.effort, "ultra");
  });
});
