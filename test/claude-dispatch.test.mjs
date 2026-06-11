import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const claudeDispatch = path.join(rootDir, "lib", "claude-dispatch.mjs");

async function createFakeClaude(dir) {
  const binaryPath = path.join(dir, "fake-claude.mjs");
  await writeFile(
    binaryPath,
    `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const stdin = readFileSync(0, "utf8");

if (process.env.FAKE_CLAUDE_LOG) {
  appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args, stdin }) + "\\n");
}

const flagValue = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] || "" : "";
};
const sessionId = flagValue("--session-id") || flagValue("--resume");
const resumed = args.includes("--resume");

if (process.env.FAKE_CLAUDE_FAIL === "auth") {
  console.error("Invalid API key · Please run /login");
  process.exit(1);
}

if (process.env.FAKE_CLAUDE_FAIL === "is_error") {
  console.log(JSON.stringify([
    { type: "system", subtype: "init", session_id: sessionId },
    { type: "result", subtype: "error_during_execution", is_error: true, result: "stream closed early", session_id: sessionId },
  ]));
  process.exit(0);
}

if (process.env.FAKE_CLAUDE_RESUME_MISSING === "1" && resumed) {
  console.error("No conversation found with session ID: " + sessionId);
  process.exit(1);
}

const denials = process.env.FAKE_CLAUDE_DENIALS === "1"
  ? [{ tool_name: "Bash", tool_input: { command: "rm -rf /" } }]
  : [];

console.log(JSON.stringify([
  { type: "system", subtype: "init", session_id: sessionId },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Claude says hi",
    session_id: sessionId,
    num_turns: 1,
    permission_denials: denials,
  },
]));
`,
    "utf8",
  );
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function runDispatch(args, options = {}) {
  try {
    const result = await execFileAsync(process.execPath, [claudeDispatch, ...args], {
      env: { ...process.env, ...(options.env || {}) },
      cwd: options.cwd,
      maxBuffer: 1024 * 1024,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      exitCode: error.code || 1,
      stdout: error.stdout || "",
      stderr: error.stderr || "",
    };
  }
}

async function setupProject(prefix) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  const projectPath = path.join(tempDir, "project");
  await mkdir(projectPath, { recursive: true });
  return { tempDir, projectPath };
}

const sessionUuid = "8fca0e9f-6e4e-46d2-a5ab-0efd12edcbf0";

test("claude dispatch creates new sessions with --session-id and maps approve to bypassPermissions", async () => {
  const { tempDir, projectPath } = await setupProject("clawdad-claude-dispatch-");
  const fakeClaude = await createFakeClaude(tempDir);
  const logPath = path.join(tempDir, "args.log");

  const result = await runDispatch(
    [
      "--project-path", projectPath,
      "--message", "hello claude lane",
      "--session-id", sessionUuid,
      "--permission-mode", "approve",
      "--model", "sonnet",
      "--claude-binary", fakeClaude,
    ],
    { env: { FAKE_CLAUDE_LOG: logPath } },
  );

  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.session_id, sessionUuid);
  assert.equal(payload.session_seeded, true);
  assert.equal(payload.result_text, "Claude says hi");
  assert.ok(
    payload.warnings.some((warning) => warning.includes("bypassPermissions")),
    "expected bypassPermissions warning",
  );

  const calls = (await readFile(logPath, "utf8")).trim().split(/\r?\n/u).map((line) => JSON.parse(line));
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.stdin, "hello claude lane");
  assert.ok(call.args.includes("-p"));
  assert.deepEqual(
    call.args.slice(call.args.indexOf("--session-id"), call.args.indexOf("--session-id") + 2),
    ["--session-id", sessionUuid],
  );
  assert.equal(call.args.includes("--resume"), false);
  assert.deepEqual(
    call.args.slice(call.args.indexOf("--permission-mode"), call.args.indexOf("--permission-mode") + 2),
    ["--permission-mode", "bypassPermissions"],
  );
  assert.deepEqual(
    call.args.slice(call.args.indexOf("--model"), call.args.indexOf("--model") + 2),
    ["--model", "sonnet"],
  );
  assert.deepEqual(
    call.args.slice(call.args.indexOf("--output-format"), call.args.indexOf("--output-format") + 2),
    ["--output-format", "json"],
  );
});

test("claude dispatch resumes seeded sessions and maps plan mode through", async () => {
  const { tempDir, projectPath } = await setupProject("clawdad-claude-dispatch-resume-");
  const fakeClaude = await createFakeClaude(tempDir);
  const logPath = path.join(tempDir, "args.log");

  const result = await runDispatch(
    [
      "--project-path", projectPath,
      "--message", "follow up",
      "--session-id", sessionUuid,
      "--permission-mode", "plan",
      "--claude-binary", fakeClaude,
      "--session-seeded",
    ],
    { env: { FAKE_CLAUDE_LOG: logPath } },
  );

  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.session_id, sessionUuid);

  const calls = (await readFile(logPath, "utf8")).trim().split(/\r?\n/u).map((line) => JSON.parse(line));
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.deepEqual(
    call.args.slice(call.args.indexOf("--resume"), call.args.indexOf("--resume") + 2),
    ["--resume", sessionUuid],
  );
  assert.equal(call.args.includes("--session-id"), false);
  assert.deepEqual(
    call.args.slice(call.args.indexOf("--permission-mode"), call.args.indexOf("--permission-mode") + 2),
    ["--permission-mode", "plan"],
  );
  assert.equal(call.args.includes("--model"), false);
});

test("claude dispatch falls back to a fresh session when the resumed session is missing", async () => {
  const { tempDir, projectPath } = await setupProject("clawdad-claude-dispatch-missing-");
  const fakeClaude = await createFakeClaude(tempDir);
  const logPath = path.join(tempDir, "args.log");

  const result = await runDispatch(
    [
      "--project-path", projectPath,
      "--message", "are you there",
      "--session-id", sessionUuid,
      "--permission-mode", "approve",
      "--claude-binary", fakeClaude,
      "--session-seeded",
    ],
    { env: { FAKE_CLAUDE_LOG: logPath, FAKE_CLAUDE_RESUME_MISSING: "1" } },
  );

  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.session_id, sessionUuid);
  assert.ok(
    payload.warnings.some((warning) => warning.includes("not found on disk")),
    "expected fresh-session warning",
  );

  const calls = (await readFile(logPath, "utf8")).trim().split(/\r?\n/u).map((line) => JSON.parse(line));
  assert.equal(calls.length, 2);
  assert.ok(calls[0].args.includes("--resume"));
  assert.ok(calls[1].args.includes("--session-id"));
});

test("claude dispatch surfaces is_error results as failures", async () => {
  const { tempDir, projectPath } = await setupProject("clawdad-claude-dispatch-iserror-");
  const fakeClaude = await createFakeClaude(tempDir);

  const result = await runDispatch(
    [
      "--project-path", projectPath,
      "--message", "do a thing",
      "--session-id", sessionUuid,
      "--permission-mode", "approve",
      "--claude-binary", fakeClaude,
      "--session-seeded",
    ],
    { env: { FAKE_CLAUDE_FAIL: "is_error" } },
  );

  assert.notEqual(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.session_id, sessionUuid);
  assert.match(payload.error_text, /stream closed early/u);
});

test("claude dispatch explains authentication failures", async () => {
  const { tempDir, projectPath } = await setupProject("clawdad-claude-dispatch-auth-");
  const fakeClaude = await createFakeClaude(tempDir);

  const result = await runDispatch(
    [
      "--project-path", projectPath,
      "--message", "hello",
      "--session-id", sessionUuid,
      "--permission-mode", "plan",
      "--claude-binary", fakeClaude,
    ],
    { env: { FAKE_CLAUDE_FAIL: "auth" } },
  );

  assert.notEqual(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error_text, /claude setup-token/u);
  assert.match(payload.error_text, /CLAUDE_CODE_OAUTH_TOKEN/u);
});

test("claude dispatch explains a missing claude binary", async () => {
  const { projectPath } = await setupProject("clawdad-claude-dispatch-enoent-");

  const result = await runDispatch([
    "--project-path", projectPath,
    "--message", "hello",
    "--session-id", sessionUuid,
    "--permission-mode", "plan",
    "--claude-binary", "/nonexistent/claude-binary",
  ]);

  assert.notEqual(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error_text, /was not found/u);
  assert.match(payload.error_text, /CLAWDAD_CLAUDE/u);
});

test("claude dispatch reports permission denials as warnings", async () => {
  const { tempDir, projectPath } = await setupProject("clawdad-claude-dispatch-denials-");
  const fakeClaude = await createFakeClaude(tempDir);

  const result = await runDispatch(
    [
      "--project-path", projectPath,
      "--message", "try a guarded command",
      "--session-id", sessionUuid,
      "--permission-mode", "approve",
      "--claude-binary", fakeClaude,
      "--session-seeded",
    ],
    { env: { FAKE_CLAUDE_DENIALS: "1" } },
  );

  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.ok(
    payload.warnings.some((warning) => warning.includes("permission denial: Bash")),
    "expected permission denial warning",
  );
});
