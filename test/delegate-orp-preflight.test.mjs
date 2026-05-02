import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = path.join(repoRoot, "lib", "server.mjs");

async function createFakeOrp(dir) {
  const binaryPath = path.join(dir, "fake-orp.mjs");
  await writeFile(
    binaryPath,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const scenario = process.env.ORP_SCENARIO || "success";
if (process.env.ORP_LOG) {
  let entries = [];
  try {
    entries = JSON.parse(readFileSync(process.env.ORP_LOG, "utf8"));
  } catch {
    entries = [];
  }
  entries.push({ args, cwd: process.cwd() });
  writeFileSync(process.env.ORP_LOG, JSON.stringify(entries, null, 2));
}

function print(payload, code = 0) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(code);
}

function printRaw(text, code = 0) {
  process.stdout.write(text);
  process.exit(code);
}

if (args.join(" ") === "hygiene --json") {
  if (scenario === "hygiene_block") {
    print({
      schema: "orp.worktree_hygiene/1",
      status: "dirty",
      clean: false,
      unclassified_count: 2,
      unclassifiedCount: 2,
      stop_condition: true,
      stopCondition: true,
      safe_to_expand: false,
      safeToExpand: false,
      required_action: "Classify dirty paths before delegation.",
      requiredAction: "Classify dirty paths before delegation."
    });
  }
  print({
    schema: "orp.worktree_hygiene/1",
    status: "clean",
    clean: true,
    unclassified_count: 0,
    unclassifiedCount: 0,
    stop_condition: false,
    stopCondition: false,
    safe_to_expand: true,
    safeToExpand: true
  });
}

if (args.join(" ") === "project refresh --json") {
  print({
    ok: true,
    action: "refreshed",
    project: { name: "Research Project", root: process.cwd() },
    research_policy: { default_timing: "after_local_decomposition_before_action" }
  });
}

if (args.join(" ") === "frontier preflight-delegate --json") {
  if (scenario === "invalid_json") {
    printRaw("not json\\n");
  }
  if (scenario === "missing_frontier") {
    print({
      ok: false,
      issues: [
        { severity: "error", code: "missing_stack", message: "frontier version stack is missing." },
        { severity: "error", code: "missing_state", message: "frontier state is missing." }
      ],
      preflight: { ready: false }
    }, 1);
  }
  if (scenario === "preflight_block") {
    print({
      ok: false,
      issues: [
        { severity: "error", code: "paid_human_gate", message: "Paid research lane requires human approval." }
      ],
      preflight: { ready: false }
    }, 1);
  }
  print({
    ok: true,
    continuation: {
      ok: true,
      safe: true,
      next_action: "continue active research-system task"
    },
    preflight: { ready: true }
  });
}

console.error("unexpected fake ORP command: " + args.join(" "));
process.exit(64);
`,
    "utf8",
  );
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function createProjectFixture(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "research-project");
  const sessionId = "delegate-session-1";
  await mkdir(path.join(projectPath, ".clawdad", "delegate"), { recursive: true });
  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        orp_workspace: "main",
        projects: {
          [projectPath]: {
            status: "idle",
            last_dispatch: null,
            last_response: null,
            dispatch_count: 0,
            registered_at: "2026-04-20T00:00:00Z",
            active_session_id: sessionId,
            sessions: {
              [sessionId]: {
                slug: "Delegate",
                provider: "codex",
                provider_session_seeded: "true",
                tracked_at: "2026-04-20T00:00:00Z",
                dispatch_count: 0,
                last_dispatch: null,
                last_response: null,
                status: "idle",
                local_only: "false",
                orp_error: "",
              },
            },
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    path.join(projectPath, ".clawdad", "delegate", "delegate-status.json"),
    JSON.stringify(
      {
        version: 1,
        state: "running",
        runId: "already-running",
        startedAt: "2026-04-20T00:01:00Z",
        delegateSessionId: sessionId,
        delegateSessionLabel: "Delegate",
        supervisorPid: process.pid,
        pauseRequested: false,
        error: "",
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    path.join(projectPath, ".clawdad", "mailbox", "status.json"),
    JSON.stringify({ state: "idle", request_id: null, session_id: sessionId }, null, 2),
    "utf8",
  );
  const orpLog = path.join(root, "orp.log");
  const fakeOrp = await createFakeOrp(root);
  return { root, home, projectPath, fakeOrp, orpLog };
}

async function readOrpLog(logPath) {
  const raw = await readFile(logPath, "utf8");
  return JSON.parse(raw);
}

async function runServerCommand(fixture, command, { scenario = "success", extraArgs = [] } = {}) {
  const args = [serverScript, command, fixture.projectPath, ...extraArgs, "--json"];
  const env = {
    ...process.env,
    HOME: fixture.home,
    CLAWDAD_HOME: fixture.home,
    CLAWDAD_ORP: fixture.fakeOrp,
    ORP_LOG: fixture.orpLog,
    ORP_SCENARIO: scenario,
  };
  try {
    const result = await execFileAsync(process.execPath, args, {
      cwd: repoRoot,
      env,
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

test("go routes into delegate-run behavior after ORP preflight", async () => {
  const fixture = await createProjectFixture("clawdad-go-preflight-");
  try {
    const result = await runServerCommand(fixture, "go");
    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.action, "start");
    assert.equal(payload.status.state, "running");

    const log = await readOrpLog(fixture.orpLog);
    assert.deepEqual(log.map((entry) => entry.args.join(" ")), [
      "hygiene --json",
      "project refresh --json",
      "frontier preflight-delegate --json",
    ]);
    const projectRealpath = await realpath(fixture.projectPath);
    assert.equal(log.every((entry) => entry.cwd === projectRealpath), true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("delegate-run preflight success allows delegation", async () => {
  const fixture = await createProjectFixture("clawdad-delegate-preflight-");
  try {
    const result = await runServerCommand(fixture, "delegate-run");
    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.action, "start");
    assert.equal(payload.accepted, false);
    assert.equal(payload.status.runId, "already-running");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("delegate-run --dry-run previews without starting delegation", async () => {
  const fixture = await createProjectFixture("clawdad-delegate-dry-run-");
  try {
    const statusFile = path.join(fixture.projectPath, ".clawdad", "delegate", "delegate-status.json");
    await writeFile(
      statusFile,
      JSON.stringify(
        {
          version: 1,
          state: "idle",
          runId: null,
          startedAt: null,
          delegateSessionId: "delegate-session-1",
          delegateSessionLabel: "Delegate",
          supervisorPid: null,
          pauseRequested: false,
          error: "",
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await runServerCommand(fixture, "delegate-run", { extraArgs: ["--dry-run"] });
    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.action, "dry_run");
    assert.equal(payload.accepted, false);
    assert.equal(payload.status.state, "idle");

    const persisted = JSON.parse(await readFile(statusFile, "utf8"));
    assert.equal(persisted.state, "idle");
    assert.equal(persisted.runId, null);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("missing ORP frontier returns the bootstrap command", async () => {
  const fixture = await createProjectFixture("clawdad-missing-frontier-");
  try {
    const result = await runServerCommand(fixture, "go", { scenario: "missing_frontier" });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.accepted, false);
    assert.equal(payload.bootstrapCommand, "orp init --research-system --project-startup --current-codex --json");
    assert.match(payload.error, /frontier/i);
    assert.equal(payload.orpPreflight.bootstrapRequired, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("failed hygiene blocks delegation with the ORP reason", async () => {
  const fixture = await createProjectFixture("clawdad-hygiene-block-");
  try {
    const result = await runServerCommand(fixture, "delegate-run", { scenario: "hygiene_block" });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Classify dirty paths before delegation/u);
    assert.equal(payload.orpPreflight.step, "hygiene");

    const log = await readOrpLog(fixture.orpLog);
    assert.deepEqual(log.map((entry) => entry.args.join(" ")), ["hygiene --json"]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("failed frontier preflight blocks delegation with the ORP reason", async () => {
  const fixture = await createProjectFixture("clawdad-frontier-block-");
  try {
    const result = await runServerCommand(fixture, "delegate-run", { scenario: "preflight_block" });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Paid research lane requires human approval/u);
    assert.equal(payload.orpPreflight.step, "frontier_preflight");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("invalid ORP preflight JSON blocks delegation", async () => {
  const fixture = await createProjectFixture("clawdad-invalid-json-");
  try {
    const result = await runServerCommand(fixture, "delegate-run", { scenario: "invalid_json" });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /invalid or empty JSON/u);
    assert.equal(payload.orpPreflight.step, "frontier_preflight");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
