import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = path.join(repoRoot, "lib", "server.mjs");

async function createProjectFixture(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "project");
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
            registered_at: "2026-04-24T00:00:00Z",
            active_session_id: sessionId,
            sessions: {
              [sessionId]: {
                slug: "Delegate",
                provider: "codex",
                provider_session_seeded: "true",
                tracked_at: "2026-04-24T00:00:00Z",
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
    path.join(projectPath, ".clawdad", "mailbox", "status.json"),
    JSON.stringify({ state: "idle", request_id: null, session_id: sessionId }, null, 2),
    "utf8",
  );
  return { root, home, projectPath };
}

async function runServerCommand(fixture, args) {
  const commandArgs = [...args];
  if (!commandArgs.includes("--json")) {
    commandArgs.push("--json");
  }
  try {
    const result = await execFileAsync(process.execPath, [serverScript, ...commandArgs], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: fixture.home,
        CLAWDAD_HOME: fixture.home,
      },
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

async function runJsonCommand(fixture, args) {
  const result = await runServerCommand(fixture, args);
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function assertExists(filePath) {
  await access(filePath);
}

test("lane-create initializes durable lane storage and lanes lists them", async () => {
  const fixture = await createProjectFixture("clawdad-lanes-create-");
  try {
    const frontend = await runJsonCommand(fixture, [
      "lane-create",
      fixture.projectPath,
      "frontend",
      "--display-name",
      "Frontend lane",
      "--objective",
      "Ship the mobile shell.",
      "--scope",
      "web/**",
      "--scope",
      "assets/**",
    ]);
    assert.equal(frontend.ok, true);
    assert.equal(frontend.lane.laneId, "frontend");
    assert.deepEqual(frontend.lane.scopeGlobs, ["web/**", "assets/**"]);

    const backend = await runJsonCommand(fixture, [
      "lane-create",
      fixture.projectPath,
      "backend",
      "--display-name",
      "Backend lane",
      "--objective",
      "Stabilize delegate storage.",
      "--scope",
      "lib/**",
    ]);
    assert.equal(backend.ok, true);
    assert.equal(backend.lane.laneId, "backend");

    const frontendDir = path.join(fixture.projectPath, ".clawdad", "delegate", "lanes", "frontend");
    const backendDir = path.join(fixture.projectPath, ".clawdad", "delegate", "lanes", "backend");
    for (const laneDir of [frontendDir, backendDir]) {
      await assertExists(path.join(laneDir, "delegate-config.json"));
      await assertExists(path.join(laneDir, "delegate-brief.md"));
      await assertExists(path.join(laneDir, "delegate-status.json"));
      await assertExists(path.join(laneDir, "delegate-plan-snapshots.json"));
      await assertExists(path.join(laneDir, "delegate-run-summaries.json"));
      await assertExists(path.join(laneDir, "runs"));
      await assertExists(path.join(laneDir, "artifacts"));
      await assertExists(path.join(laneDir, "mailbox"));
    }

    const frontendConfig = await readJson(path.join(frontendDir, "delegate-config.json"));
    const frontendStatus = await readJson(path.join(frontendDir, "delegate-status.json"));
    const backendConfig = await readJson(path.join(backendDir, "delegate-config.json"));
    assert.equal(frontendConfig.laneId, "frontend");
    assert.equal(frontendConfig.displayName, "Frontend lane");
    assert.deepEqual(frontendConfig.scopeGlobs, ["web/**", "assets/**"]);
    assert.equal(frontendStatus.laneId, "frontend");
    assert.equal(frontendStatus.state, "idle");
    assert.equal(backendConfig.laneId, "backend");

    assert.notEqual(path.join(frontendDir, "runs"), path.join(backendDir, "runs"));
    assert.notEqual(path.join(frontendDir, "artifacts"), path.join(backendDir, "artifacts"));
    assert.notEqual(path.join(frontendDir, "mailbox"), path.join(backendDir, "mailbox"));

    const lanes = await runJsonCommand(fixture, ["lanes", fixture.projectPath]);
    assert.equal(lanes.ok, true);
    assert.deepEqual(
      lanes.lanes.map((lane) => lane.laneId),
      ["default", "backend", "frontend"],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("lane-aware delegate commands keep default lane compatibility intact", async () => {
  const fixture = await createProjectFixture("clawdad-lanes-commands-");
  try {
    await runJsonCommand(fixture, [
      "lane-create",
      fixture.projectPath,
      "frontend",
      "--display-name",
      "Frontend lane",
      "--objective",
      "Own the web shell.",
      "--scope",
      "web/**",
    ]);

    await runJsonCommand(fixture, [
      "delegate-set",
      fixture.projectPath,
      "Default lane brief.",
    ]);
    await runJsonCommand(fixture, [
      "delegate-set",
      fixture.projectPath,
      "Frontend lane brief.",
      "--lane",
      "frontend",
    ]);

    const legacyDefaultDir = path.join(fixture.projectPath, ".clawdad", "delegate");
    const mirroredDefaultDir = path.join(legacyDefaultDir, "default");
    const frontendDir = path.join(legacyDefaultDir, "lanes", "frontend");

    const defaultBrief = await readFile(path.join(legacyDefaultDir, "delegate-brief.md"), "utf8");
    const mirroredDefaultBrief = await readFile(path.join(mirroredDefaultDir, "delegate-brief.md"), "utf8");
    const frontendBrief = await readFile(path.join(frontendDir, "delegate-brief.md"), "utf8");
    assert.match(defaultBrief, /Default lane brief\./u);
    assert.match(mirroredDefaultBrief, /Default lane brief\./u);
    assert.match(frontendBrief, /Frontend lane brief\./u);

    const defaultPayload = await runJsonCommand(fixture, ["delegate", fixture.projectPath]);
    const frontendPayload = await runJsonCommand(fixture, [
      "delegate",
      fixture.projectPath,
      "--lane",
      "frontend",
    ]);
    assert.equal(defaultPayload.config.laneId, "default");
    assert.equal(frontendPayload.config.laneId, "frontend");
    assert.match(defaultPayload.brief, /Default lane brief\./u);
    assert.match(frontendPayload.brief, /Frontend lane brief\./u);

    const pausePayload = await runJsonCommand(fixture, [
      "delegate-pause",
      fixture.projectPath,
      "--lane",
      "frontend",
    ]);
    assert.equal(pausePayload.status.laneId, "frontend");
    assert.equal(pausePayload.status.state, "paused");

    const defaultStatus = await readJson(path.join(legacyDefaultDir, "delegate-status.json"));
    const mirroredDefaultStatus = await readJson(path.join(mirroredDefaultDir, "delegate-status.json"));
    const frontendStatus = await readJson(path.join(frontendDir, "delegate-status.json"));
    assert.equal(defaultStatus.laneId, "default");
    assert.equal(defaultStatus.state, "idle");
    assert.equal(mirroredDefaultStatus.laneId, "default");
    assert.equal(frontendStatus.laneId, "frontend");
    assert.equal(frontendStatus.state, "paused");

    await runJsonCommand(fixture, [
      "delegate-reset",
      fixture.projectPath,
      "--lane",
      "frontend",
    ]);
    const resetFrontendBrief = await readFile(path.join(frontendDir, "delegate-brief.md"), "utf8");
    const unchangedDefaultBrief = await readFile(path.join(legacyDefaultDir, "delegate-brief.md"), "utf8");
    assert.match(resetFrontendBrief, /# North Star/u);
    assert.doesNotMatch(resetFrontendBrief, /Frontend lane brief\./u);
    assert.match(unchangedDefaultBrief, /Default lane brief\./u);

    const defaultConfig = await readJson(path.join(legacyDefaultDir, "delegate-config.json"));
    const mirroredDefaultConfig = await readJson(path.join(mirroredDefaultDir, "delegate-config.json"));
    assert.equal(defaultConfig.laneId, "default");
    assert.equal(mirroredDefaultConfig.laneId, "default");

    for (const directory of [
      path.join(mirroredDefaultDir, "runs"),
      path.join(mirroredDefaultDir, "artifacts"),
      path.join(mirroredDefaultDir, "mailbox"),
    ]) {
      const info = await stat(directory);
      assert.equal(info.isDirectory(), true);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
