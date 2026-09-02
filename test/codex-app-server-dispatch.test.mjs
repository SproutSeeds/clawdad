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
const fakeSharedAppServerScript = path.join(repoRoot, "test", "fixtures", "fake-shared-app-server.mjs");

async function execFileCapture(command, args, options = {}) {
  const env = {
    ...process.env,
    CLAWDAD_CODEX_APP_SERVER_MODE: "isolated",
    ...(options.env || {}),
  };
  try {
    const result = await execFileP(command, args, { ...options, env });
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
    if (behavior === "secret-command") {
      setTimeout(() => {
        const command = [
          "/bin/zsh",
          "-lc",
          "SERVICE_TOKEN=environment-secret-value git -c http.extraHeader='Authorization: Bearer art_v1_commandsecret1234567890' push 'https://user:password@example.com/repo.git?access_token=query-secret-value' HEAD:main --api-key sk-commandsecret1234567890",
        ];
        send({
          method: "item/started",
          params: {
            threadId: "thread-test",
            turnId: "turn-test",
            item: { id: "cmd-secret", type: "commandExecution", status: "in_progress", command },
          },
        });
        send({
          method: "item/completed",
          params: {
            threadId: "thread-test",
            turnId: "turn-test",
            item: { id: "cmd-secret", type: "commandExecution", status: "completed", command },
          },
        });
        send({
          method: "item/completed",
          params: {
            threadId: "thread-test",
            turnId: "turn-test",
            item: { type: "agentMessage", phase: "final_answer", text: "secret command completed" },
          },
        });
        send({
          method: "turn/completed",
          params: {
            threadId: "thread-test",
            turn: { id: "turn-test", status: "completed" },
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

async function withFakeSharedAppServer(root, { active = false, scenario = "" } = {}, work) {
  const socketDir = path.join("/tmp", `cd-${path.basename(root).replace(/^clawdad-codex-dispatch-test-/u, "")}`);
  const socketPath = path.join(socketDir, "app-server.sock");
  const requestLog = path.join(root, "shared-app-server-events.jsonl");
  await mkdir(socketDir, { recursive: true, mode: 0o700 });
  const child = spawn(process.execPath, [
    fakeSharedAppServerScript,
    socketPath,
    requestLog,
    scenario || (active ? "active" : "idle"),
  ], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let childStdout = "";
  let childStderr = "";
  child.stdout.on("data", (chunk) => {
    childStdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    childStderr += chunk;
  });

  await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`fake shared app-server did not become ready: ${childStderr}`));
    }, 5000);
    const ready = () => {
      if (!childStdout.includes("READY\n")) {
        return;
      }
      clearTimeout(timeoutId);
      child.stdout.off("data", ready);
      resolve();
    };
    child.stdout.on("data", ready);
    child.once("exit", (code, signal) => {
      clearTimeout(timeoutId);
      reject(new Error(`fake shared app-server exited before ready (code=${code}, signal=${signal}): ${childStderr}`));
    });
    ready();
  });

  async function snapshot() {
    const entries = (await readFile(requestLog, "utf8").catch(() => ""))
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return {
      entries,
      requests: entries
        .filter((entry) => entry.type === "request")
        .map((entry) => entry.message),
      connectionCount: entries.filter((entry) => entry.type === "connection").length,
      closeCount: entries.filter((entry) => entry.type === "close").length,
      queueInsertionCount: entries.filter((entry) => entry.type === "queueInserted").length,
      queuedClientMessageIds: new Set(
        entries
          .filter((entry) => entry.type === "queueInserted")
          .map((entry) => entry.clientUserMessageId),
      ),
    };
  }

  try {
    return await work({ socketPath, snapshot });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once("exit", resolve);
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, 1000).unref?.();
    });
    await rm(socketDir, { recursive: true, force: true });
  }
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
        CLAWDAD_CODEX_APP_SERVER_MODE: "isolated",
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

test("codex app-server dispatch redacts credentials from persisted event logs", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "secret-command");
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

    const eventText = await readFile(eventLog, "utf8");
    assert.doesNotMatch(eventText, /environment-secret-value/u);
    assert.doesNotMatch(eventText, /commandsecret/u);
    assert.doesNotMatch(eventText, /query-secret-value/u);
    assert.doesNotMatch(eventText, /user:password/u);
    assert.match(eventText, /\[REDACTED\]/u);
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

test("shared app-server dispatch reuses the listening runtime without spawning a per-dispatch Codex process", async () => {
  await withTempDir(async (root) => {
    await withFakeSharedAppServer(root, {}, async ({ socketPath, snapshot }) => {
      const unavailableCodex = path.join(root, "codex-must-not-be-spawned");
      const commonArgs = [
        dispatchScript,
        "--project-path",
        root,
        "--message",
        "hello from a shared client",
        "--session-id",
        "thread-test",
        "--session-seeded",
        "--app-server-mode",
        "shared",
        "--app-server-socket",
        socketPath,
        "--dispatch-mode",
        "direct",
        "--codex-binary",
        unavailableCodex,
        "--turn-timeout-ms",
        "2000",
        "--request-timeout-ms",
        "1000",
      ];

      const first = await execFileCapture(
        process.execPath,
        [...commonArgs, "--request-id", "request-shared-runtime-1"],
        { timeout: 10000 },
      );
      const second = await execFileCapture(
        process.execPath,
        [...commonArgs, "--request-id", "request-shared-runtime-2"],
        { timeout: 10000 },
      );

      assert.equal(first.stderr, "");
      assert.equal(first.exitCode, 0);
      assert.equal(JSON.parse(first.stdout.trim()).result_text, "shared start response");
      assert.equal(second.stderr, "");
      assert.equal(second.exitCode, 0);
      assert.equal(JSON.parse(second.stdout.trim()).result_text, "shared start response");
      await new Promise((resolve) => setTimeout(resolve, 25));
      const state = await snapshot();
      assert.equal(state.connectionCount, 4);
      assert.equal(state.closeCount, 4);
      assert.equal(
        state.requests.filter((entry) => (
          entry.method === "initialize" && entry.params?.clientInfo?.name === "clawdad"
        )).length,
        2,
      );
      assert.equal(
        state.requests.filter((entry) => (
          entry.method === "initialize" && entry.params?.clientInfo?.name === "clawdad-runtime-probe"
        )).length,
        2,
      );
      assert.equal(state.requests.filter((entry) => entry.method === "turn/start").length, 2);
    });
  });
});

test("shared direct dispatch steers an active thread with the expected turn and stable request id", async () => {
  await withTempDir(async (root) => {
    await withFakeSharedAppServer(root, { active: true }, async ({ socketPath, snapshot }) => {
      const result = await execFileCapture(process.execPath, [
        dispatchScript,
        "--project-path",
        root,
        "--message",
        "Fold this phone message into the active CLI turn.",
        "--session-id",
        "thread-test",
        "--session-seeded",
        "--app-server-mode",
        "shared",
        "--app-server-socket",
        socketPath,
        "--dispatch-mode",
        "direct",
        "--request-id",
        "request-direct-active",
        "--codex-binary",
        path.join(root, "codex-must-not-be-spawned"),
        "--turn-timeout-ms",
        "2000",
        "--request-timeout-ms",
        "1000",
      ], { timeout: 10000 });

      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(JSON.parse(result.stdout.trim()).result_text, "shared steer response");
      const state = await snapshot();
      assert.equal(state.requests.some((entry) => entry.method === "turn/start"), false);
      const steer = state.requests.find((entry) => entry.method === "turn/steer");
      assert.ok(steer);
      assert.equal(steer.params.threadId, "thread-test");
      assert.equal(steer.params.expectedTurnId, "turn-active");
      assert.equal(steer.params.clientUserMessageId, "request-direct-active");
      assert.deepEqual(steer.params.input, [
        {
          type: "text",
          text: "Fold this phone message into the active CLI turn.",
          text_elements: [],
        },
      ]);
    });
  });
});

test("shared direct dispatch starts an idle turn with the stable request id", async () => {
  await withTempDir(async (root) => {
    await withFakeSharedAppServer(root, {}, async ({ socketPath, snapshot }) => {
      const result = await execFileCapture(process.execPath, [
        dispatchScript,
        "--project-path",
        root,
        "--message",
        "Start this from the phone.",
        "--session-id",
        "thread-test",
        "--session-seeded",
        "--app-server-mode",
        "shared",
        "--app-server-socket",
        socketPath,
        "--dispatch-mode",
        "direct",
        "--request-id",
        "request-direct-idle",
        "--codex-binary",
        path.join(root, "codex-must-not-be-spawned"),
        "--turn-timeout-ms",
        "2000",
        "--request-timeout-ms",
        "1000",
      ], { timeout: 10000 });

      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      const state = await snapshot();
      const turnStart = state.requests.find((entry) => entry.method === "turn/start");
      assert.ok(turnStart);
      assert.equal(turnStart.params.threadId, "thread-test");
      assert.equal(turnStart.params.clientUserMessageId, "request-direct-idle");
      assert.equal(state.requests.some((entry) => entry.method === "turn/steer"), false);
    });
  });
});

test("shared dispatch falls back to summary reads when Codex turn history is unavailable", async () => {
  await withTempDir(async (root) => {
    await withFakeSharedAppServer(root, { scenario: "history-unavailable" }, async ({ socketPath, snapshot }) => {
      const result = await execFileCapture(process.execPath, [
        dispatchScript,
        "--project-path",
        root,
        "--message",
        "Start this while persisted turn history is unavailable.",
        "--session-id",
        "thread-test",
        "--session-seeded",
        "--app-server-mode",
        "shared",
        "--app-server-socket",
        socketPath,
        "--dispatch-mode",
        "direct",
        "--request-id",
        "request-history-unavailable",
        "--codex-binary",
        path.join(root, "codex-must-not-be-spawned"),
        "--turn-timeout-ms",
        "2000",
        "--request-timeout-ms",
        "1000",
        "--liveness-interval-ms",
        "50",
      ], { timeout: 10000 });

      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0, result.stdout || result.stderr);
      const output = JSON.parse(result.stdout.trim());
      assert.equal(output.result_text, "shared start response");
      assert.equal(output.delivery_mode, "start");
      const state = await snapshot();
      const threadReads = state.requests.filter((entry) => entry.method === "thread/read");
      assert.equal(threadReads[0]?.params?.includeTurns, true);
      assert.ok(threadReads.some((entry) => entry.params?.includeTurns === undefined));
      assert.equal(state.requests.filter((entry) => entry.method === "turn/start").length, 1);
    });
  });
});

test("summary-only shared dispatch waits for an active thread before starting", async () => {
  await withTempDir(async (root) => {
    await withFakeSharedAppServer(root, { scenario: "history-unavailable-active" }, async ({ socketPath, snapshot }) => {
      const result = await execFileCapture(process.execPath, [
        dispatchScript,
        "--project-path",
        root,
        "--message",
        "Run after the hidden active turn becomes idle.",
        "--session-id",
        "thread-test",
        "--session-seeded",
        "--app-server-mode",
        "shared",
        "--app-server-socket",
        socketPath,
        "--dispatch-mode",
        "direct",
        "--request-id",
        "request-history-unavailable-active",
        "--codex-binary",
        path.join(root, "codex-must-not-be-spawned"),
        "--turn-timeout-ms",
        "3000",
        "--request-timeout-ms",
        "1000",
        "--liveness-interval-ms",
        "50",
      ], { timeout: 10000 });

      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0, result.stdout || result.stderr);
      const output = JSON.parse(result.stdout.trim());
      assert.equal(output.result_text, "shared start response");
      assert.equal(output.delivery_mode, "deferred_start");
      const state = await snapshot();
      const activeTurnCompletedIndex = state.entries.findIndex((entry) => (
        entry.type === "historyUnavailableTurnCompleted"
      ));
      const ownStartIndex = state.entries.findIndex((entry) => (
        entry.type === "request" && entry.message?.method === "turn/start"
      ));
      assert.ok(activeTurnCompletedIndex >= 0);
      assert.ok(ownStartIndex > activeTurnCompletedIndex);
      assert.equal(state.requests.some((entry) => entry.method === "turn/steer"), false);
      assert.equal(state.requests.filter((entry) => entry.method === "turn/start").length, 1);
    });
  });
});

test("shared direct dispatch defers a structured non-steerable turn and starts safely when idle", async () => {
  await withTempDir(async (root) => {
    await withFakeSharedAppServer(root, { scenario: "non-steerable" }, async ({ socketPath, snapshot }) => {
      const result = await execFileCapture(process.execPath, [
        dispatchScript,
        "--project-path",
        root,
        "--message",
        "Run this phone message after review finishes.",
        "--session-id",
        "thread-test",
        "--session-seeded",
        "--app-server-mode",
        "shared",
        "--app-server-socket",
        socketPath,
        "--dispatch-mode",
        "direct",
        "--request-id",
        "request-direct-deferred",
        "--codex-binary",
        path.join(root, "codex-must-not-be-spawned"),
        "--turn-timeout-ms",
        "3000",
        "--request-timeout-ms",
        "1000",
        "--liveness-interval-ms",
        "50",
      ], { timeout: 10000 });

      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0, result.stdout || result.stderr);
      const output = JSON.parse(result.stdout.trim());
      assert.equal(output.result_text, "shared start response");
      assert.equal(output.delivery_mode, "deferred_start");
      const state = await snapshot();
      assert.equal(state.requests.filter((entry) => entry.method === "turn/steer").length, 1);
      assert.equal(state.requests.filter((entry) => entry.method === "turn/start").length, 1);
    });
  });
});

test("shared dispatch abstains from another client's approval and answers only its owned turn", async () => {
  await withTempDir(async (root) => {
    await withFakeSharedAppServer(root, { scenario: "foreign-approval" }, async ({ socketPath, snapshot }) => {
      const result = await execFileCapture(process.execPath, [
        dispatchScript,
        "--project-path",
        root,
        "--message",
        "Run after the Terminal-owned turn finishes.",
        "--session-id",
        "thread-test",
        "--session-seeded",
        "--app-server-mode",
        "shared",
        "--app-server-socket",
        socketPath,
        "--dispatch-mode",
        "queue",
        "--request-id",
        "request-owned-approval",
        "--permission-mode",
        "full",
        "--codex-binary",
        path.join(root, "codex-must-not-be-spawned"),
        "--turn-timeout-ms",
        "3000",
        "--request-timeout-ms",
        "1000",
        "--liveness-interval-ms",
        "50",
      ], { timeout: 10000 });

      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0, result.stdout || result.stderr);
      const state = await snapshot();
      const foreignResponses = state.requests.filter((entry) => (
        entry.id === "approval-terminal" && !entry.method
      ));
      const ownedResponse = state.requests.find((entry) => (
        entry.id === "approval-clawdad" && !entry.method
      ));
      assert.equal(foreignResponses.length, 0);
      assert.deepEqual(ownedResponse?.result, { decision: "accept" });
      const foreignCompletionIndex = state.entries.findIndex((entry) => (
        entry.type === "foreignTurnCompleted"
      ));
      const ownStartIndex = state.entries.findIndex((entry) => (
        entry.type === "request" && entry.message?.method === "turn/start"
      ));
      assert.ok(ownStartIndex >= 0);
      assert.ok(foreignCompletionIndex >= 0);
      assert.ok(ownStartIndex > foreignCompletionIndex);
    });
  });
});

test("shared dispatch reconnects and reconciles a turn after its client socket drops", async () => {
  await withTempDir(async (root) => {
    await withFakeSharedAppServer(root, { scenario: "disconnect-once" }, async ({ socketPath, snapshot }) => {
      const result = await execFileCapture(process.execPath, [
        dispatchScript,
        "--project-path",
        root,
        "--message",
        "Keep this request exactly once across reconnect.",
        "--session-id",
        "thread-test",
        "--session-seeded",
        "--app-server-mode",
        "shared",
        "--app-server-socket",
        socketPath,
        "--dispatch-mode",
        "direct",
        "--request-id",
        "request-reconnect-stable",
        "--codex-binary",
        path.join(root, "codex-must-not-be-spawned"),
        "--turn-timeout-ms",
        "3000",
        "--request-timeout-ms",
        "1000",
        "--liveness-interval-ms",
        "100",
      ], { timeout: 10000 });

      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0, result.stdout || result.stderr);
      assert.equal(JSON.parse(result.stdout.trim()).result_text, "shared reconnect response");
      const state = await snapshot();
      assert.equal(state.requests.filter((entry) => entry.method === "turn/start").length, 1);
      assert.ok(
        state.requests.filter((entry) => (
          entry.method === "thread/resume" && entry.params?.threadId === "thread-test"
        )).length >= 2,
      );
    });
  });
});

test("shared dispatch recovers a dead delivery owner after server acceptance without sending twice", async (t) => {
  await withTempDir(async (root) => {
    await withFakeSharedAppServer(root, { scenario: "crash-after-accept" }, async ({ socketPath, snapshot }) => {
      const args = [
        dispatchScript,
        "--project-path",
        root,
        "--message",
        "Keep this accepted phone request exactly once after a worker crash.",
        "--session-id",
        "thread-test",
        "--session-seeded",
        "--app-server-mode",
        "shared",
        "--app-server-socket",
        socketPath,
        "--dispatch-mode",
        "queue",
        "--request-id",
        "request-crash-stable",
        "--codex-binary",
        path.join(root, "codex-must-not-be-spawned"),
        "--turn-timeout-ms",
        "3000",
        "--request-timeout-ms",
        "1000",
        "--liveness-interval-ms",
        "50",
      ];
      const first = spawn(process.execPath, args, {
        cwd: repoRoot,
        env: {
          ...process.env,
          CLAWDAD_CODEX_APP_SERVER_MODE: "isolated",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      t.after(() => {
        if (first.exitCode == null && first.signalCode == null) first.kill("SIGKILL");
      });

      const acceptedDeadline = Date.now() + 5000;
      for (;;) {
        const state = await snapshot();
        if (state.entries.some((entry) => (
          entry.type === "turnAccepted" && entry.clientUserMessageId === "request-crash-stable"
        ))) {
          break;
        }
        if (Date.now() >= acceptedDeadline) {
          throw new Error("timed out waiting for fake app-server acceptance");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      first.kill("SIGKILL");
      await new Promise((resolve) => first.once("exit", resolve));

      const recovered = await execFileCapture(process.execPath, args, { timeout: 10000 });
      assert.equal(recovered.stderr, "");
      assert.equal(recovered.exitCode, 0, recovered.stdout || recovered.stderr);
      assert.equal(
        JSON.parse(recovered.stdout.trim()).result_text,
        "shared crash recovery response",
      );
      const state = await snapshot();
      assert.equal(state.requests.filter((entry) => entry.method === "turn/start").length, 1);
    });
  });
});

test("shared queued dispatch starts a fully configured idle turn and reconciles a duplicate request id", async () => {
  await withTempDir(async (root) => {
    const imagePath = path.join(root, "phone-photo.jpg");
    const manifestPath = path.join(root, "attachments.json");
    await writeFile(imagePath, "fake image", "utf8");
    await writeFile(
      manifestPath,
      JSON.stringify({
        attachments: [
          {
            path: imagePath,
            kind: "image",
            mimeType: "image/jpeg",
          },
        ],
      }),
      "utf8",
    );

    await withFakeSharedAppServer(root, {}, async ({ socketPath, snapshot }) => {
      const args = [
        dispatchScript,
        "--project-path",
        root,
        "--message",
        "Inspect this phone attachment.",
        "--session-id",
        "thread-test",
        "--session-seeded",
        "--attachment-manifest",
        manifestPath,
        "--app-server-mode",
        "shared",
        "--app-server-socket",
        socketPath,
        "--dispatch-mode",
        "queue",
        "--request-id",
        "request-queue-stable",
        "--permission-mode",
        "approve",
        "--model",
        "gpt-test",
        "--reasoning-effort",
        "high",
        "--codex-binary",
        path.join(root, "codex-must-not-be-spawned"),
        "--turn-timeout-ms",
        "2000",
        "--request-timeout-ms",
        "1000",
      ];

      const [first, second] = await Promise.all([
        execFileCapture(process.execPath, args, { timeout: 10000 }),
        execFileCapture(process.execPath, args, { timeout: 10000 }),
      ]);

      assert.equal(first.stderr, "");
      assert.equal(first.exitCode, 0);
      assert.equal(JSON.parse(first.stdout.trim()).result_text, "shared start response");
      assert.equal(second.stderr, "");
      assert.equal(second.exitCode, 0);
      assert.equal(JSON.parse(second.stdout.trim()).result_text, "shared start response");
      const state = await snapshot();
      assert.equal(state.queueInsertionCount, 0);
      assert.equal(state.queuedClientMessageIds.size, 0);
      const queueAdds = state.requests.filter((entry) => entry.method === "thread/queue/add");
      assert.equal(queueAdds.length, 0);
      assert.equal(state.requests.filter((entry) => entry.method === "thread/queue/start").length, 0);
      const turnStarts = state.requests.filter((entry) => entry.method === "turn/start");
      assert.equal(turnStarts.length, 1);
      assert.equal(turnStarts[0].params.threadId, "thread-test");
      assert.equal(turnStarts[0].params.cwd, root);
      assert.equal(turnStarts[0].params.approvalPolicy, "never");
      assert.equal(turnStarts[0].params.clientUserMessageId, "request-queue-stable");
      assert.equal(turnStarts[0].params.model, "gpt-test");
      assert.equal(turnStarts[0].params.effort, "high");
      assert.deepEqual(turnStarts[0].params.sandboxPolicy, {
        type: "workspaceWrite",
        networkAccess: true,
        writableRoots: [root],
      });
      assert.deepEqual(turnStarts[0].params.input, [
        {
          type: "text",
          text: "Inspect this phone attachment.",
          text_elements: [],
        },
        {
          type: "localImage",
          path: imagePath,
        },
      ]);
      const initialize = state.requests.find((entry) => (
        entry.method === "initialize" && entry.params?.clientInfo?.name === "clawdad"
      ));
      assert.equal(initialize.params.capabilities.experimentalApi, false);
    });
  });
});
