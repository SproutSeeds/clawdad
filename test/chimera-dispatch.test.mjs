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
const chimeraDispatch = path.join(rootDir, "lib", "chimera-dispatch.mjs");

async function createFakeChimera(dir) {
  const binaryPath = path.join(dir, "fake-chimera.mjs");
  await writeFile(
    binaryPath,
    `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const home = process.env.HOME || os.homedir();
const sessionId = "11111111-2222-3333-4444-555555555555";
const sessionRoot = process.env.FAKE_CHIMERA_SESSION_ROOT || ".chimera-harness";
const sessionDir = path.join(home, sessionRoot, "sessions");
const sessionPath = path.join(sessionDir, sessionId + ".jsonl");
mkdirSync(sessionDir, { recursive: true });

if (process.env.FAKE_CHIMERA_LOG) {
  appendFileSync(process.env.FAKE_CHIMERA_LOG, JSON.stringify(args) + "\\n");
}
if (process.env.FAKE_CHIMERA_ENV_LOG) {
  appendFileSync(
    process.env.FAKE_CHIMERA_ENV_LOG,
    JSON.stringify({ args, ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "" }) + "\\n",
  );
}

if (!args.includes("--prompt")) {
  writeFileSync(sessionPath, JSON.stringify({ id: sessionId, message_count: 0 }) + "\\n");
  console.error("Saved session. Resume with: chimera --resume " + sessionId);
  process.exit(0);
}

if (process.env.FAKE_CHIMERA_FAIL === "ollama") {
  console.error("error sending request for url (http://localhost:11434/v1/chat/completions): Connection refused");
  process.exit(1);
}

if (process.env.FAKE_CHIMERA_FAIL === "model") {
  console.error("Ollama model qwen3:4b not found. Pull model before using it.");
  process.exit(1);
}

console.log(JSON.stringify({ type: "text_delta", text: "partial" }));
console.log(JSON.stringify({ type: "usage", input_tokens: 3, output_tokens: 4 }));
console.log(JSON.stringify({ type: "turn_complete", text: "Chimera says hi" }));
`,
    "utf8",
  );
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function runDispatch(args, options = {}) {
  try {
    const result = await execFileAsync(process.execPath, [chimeraDispatch, ...args], {
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

test("chimera dispatch seeds local sessions and uses Chimera approval-mode", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawdad-chimera-dispatch-"));
  const projectPath = path.join(tempDir, "project");
  const homeDir = path.join(tempDir, "home");
  await writeFile(path.join(tempDir, ".keep"), "", "utf8");
  await Promise.all([
    mkdir(projectPath, { recursive: true }),
    mkdir(homeDir, { recursive: true }),
  ]);
  const fakeChimera = await createFakeChimera(tempDir);
  const logPath = path.join(tempDir, "args.log");

  const result = await runDispatch(
    [
      "--project-path", projectPath,
      "--message", "hello local lane",
      "--session-id", "pending-session",
      "--permission-mode", "approve",
      "--model", "local-coder",
      "--chimera-binary", fakeChimera,
      "--home-dir", homeDir,
    ],
    { env: { HOME: homeDir, FAKE_CHIMERA_LOG: logPath } },
  );

  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.session_id, "11111111-2222-3333-4444-555555555555");
  assert.equal(payload.result_text, "Chimera says hi");

  const argLines = (await readFile(logPath, "utf8")).trim().split(/\r?\n/u).map((line) => JSON.parse(line));
  const promptArgs = argLines.find((line) => line.includes("--prompt"));
  assert.ok(promptArgs, "expected fake prompt invocation");
  assert.deepEqual(
    promptArgs.slice(promptArgs.indexOf("--approval-mode"), promptArgs.indexOf("--approval-mode") + 2),
    ["--approval-mode", "approve"],
  );
  assert.deepEqual(
    promptArgs.slice(promptArgs.indexOf("--model"), promptArgs.indexOf("--model") + 2),
    ["--model", "local-coder"],
  );
  assert.equal(promptArgs.includes("--auto-approve"), false);

  const sessionFile = await readFile(payload.session_path, "utf8");
  assert.match(sessionFile, /hello local lane/u);
  assert.match(sessionFile, /Chimera says hi/u);
});

test("chimera dispatch routes 4090 profiles to the configured workstation Ollama endpoint", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawdad-chimera-dispatch-4090-"));
  const projectPath = path.join(tempDir, "project");
  const homeDir = path.join(tempDir, "home");
  await Promise.all([
    mkdir(projectPath, { recursive: true }),
    mkdir(homeDir, { recursive: true }),
  ]);
  const fakeChimera = await createFakeChimera(tempDir);
  const envLogPath = path.join(tempDir, "env.log");

  const result = await runDispatch(
    [
      "--project-path", projectPath,
      "--message", "use the big card",
      "--session-id", "pending-session",
      "--permission-mode", "plan",
      "--model", "local-coder-4090",
      "--chimera-binary", fakeChimera,
      "--home-dir", homeDir,
    ],
    {
      env: {
        HOME: homeDir,
        FAKE_CHIMERA_ENV_LOG: envLogPath,
        CLAWDAD_CHIMERA_4090_OLLAMA_BASE_URL: "http://umbra-4090.tailnet.example:11434/v1",
        CLAWDAD_CHIMERA_LOCAL_OLLAMA_BASE_URL: "http://127.0.0.1:11434/v1",
        OLLAMA_BASE_URL: "http://127.0.0.1:11434/v1",
      },
    },
  );

  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ollama_base_url, "http://umbra-4090.tailnet.example:11434/v1");

  const records = (await readFile(envLogPath, "utf8")).trim().split(/\r?\n/u).map((line) => JSON.parse(line));
  assert.equal(records.every((record) => record.ollamaBaseUrl === "http://umbra-4090.tailnet.example:11434/v1"), true);
  assert.ok(records.some((record) => record.args.includes("--prompt")), "expected prompt invocation");
});

test("chimera dispatch reads current Chimera Sigil session files", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawdad-chimera-dispatch-sigil-"));
  const projectPath = path.join(tempDir, "project");
  const homeDir = path.join(tempDir, "home");
  await Promise.all([
    mkdir(projectPath, { recursive: true }),
    mkdir(homeDir, { recursive: true }),
  ]);
  const fakeChimera = await createFakeChimera(tempDir);

  const result = await runDispatch(
    [
      "--project-path", projectPath,
      "--message", "hello sigil session",
      "--session-id", "pending-session",
      "--permission-mode", "plan",
      "--model", "local",
      "--chimera-binary", fakeChimera,
      "--home-dir", homeDir,
    ],
    {
      env: {
        HOME: homeDir,
        FAKE_CHIMERA_SESSION_ROOT: ".chimera-sigil",
      },
    },
  );

  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.session_path, /\.chimera-sigil\/sessions/u);
  const sessionFile = await readFile(payload.session_path, "utf8");
  assert.match(sessionFile, /hello sigil session/u);
});

test("chimera dispatch explains Ollama connection failures", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawdad-chimera-failure-"));
  const projectPath = path.join(tempDir, "project");
  const homeDir = path.join(tempDir, "home");
  await Promise.all([
    mkdir(projectPath, { recursive: true }),
    mkdir(homeDir, { recursive: true }),
  ]);
  const fakeChimera = await createFakeChimera(tempDir);

  const result = await runDispatch(
    [
      "--project-path", projectPath,
      "--message", "hello local lane",
      "--session-id", "pending-session",
      "--permission-mode", "plan",
      "--model", "local",
      "--chimera-binary", fakeChimera,
      "--home-dir", homeDir,
    ],
    { env: { HOME: homeDir, FAKE_CHIMERA_FAIL: "ollama" } },
  );

  assert.notEqual(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error_text, /cannot reach the local Ollama endpoint/u);
  assert.match(payload.error_text, /clawdad chimera-doctor/u);
  assert.match(payload.error_text, /ollama pull qwen3:4b/u);
});

test("chimera dispatch explains missing local models without blaming the CLI", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawdad-chimera-model-"));
  const projectPath = path.join(tempDir, "project");
  const homeDir = path.join(tempDir, "home");
  await Promise.all([
    mkdir(projectPath, { recursive: true }),
    mkdir(homeDir, { recursive: true }),
  ]);
  const fakeChimera = await createFakeChimera(tempDir);

  const result = await runDispatch(
    [
      "--project-path", projectPath,
      "--message", "hello local lane",
      "--session-id", "pending-session",
      "--permission-mode", "plan",
      "--model", "local",
      "--chimera-binary", fakeChimera,
      "--home-dir", homeDir,
    ],
    { env: { HOME: homeDir, FAKE_CHIMERA_FAIL: "model" } },
  );

  assert.notEqual(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error_text, /local model/u);
  assert.match(payload.error_text, /ollama pull qwen3:4b/u);
  assert.doesNotMatch(payload.error_text, /CLI was not found/u);
});
