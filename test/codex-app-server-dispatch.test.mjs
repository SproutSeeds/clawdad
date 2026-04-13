import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  const source = `#!/usr/bin/env node
const behavior = ${JSON.stringify(behavior)};
process.stdin.setEncoding("utf8");
process.on("SIGTERM", () => process.exit(0));
let buffer = "";
function send(value) {
  process.stdout.write(JSON.stringify(value) + "\\n");
}
function handle(message) {
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
  if (message.method === "turn/start") {
    send({ id: message.id, result: { turn: { id: "turn-test" } } });
    if (behavior === "complete") {
      setTimeout(() => {
        send({
          method: "item/completed",
          params: {
            threadId: "thread-test",
            turnId: "turn-test",
            item: { type: "agentMessage", phase: "final_answer", text: "fake response" },
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
                { type: "agentMessage", phase: "final_answer", text: "fake response" },
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
    ], { timeout: 5000 });

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
    ], { timeout: 5000 });

    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.ok, false);
    assert.match(payload.error_text, /timed out waiting for codex app-server initialize response after 1s/u);
  });
});

test("codex app-server dispatch keeps fast RPC responses attached to pending requests", async () => {
  await withTempDir(async (root) => {
    const fakeCodex = await writeFakeCodexBinary(root, "complete");
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
    ], { timeout: 5000 });

    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.ok, true);
    assert.equal(payload.result_text, "fake response");
  });
});
