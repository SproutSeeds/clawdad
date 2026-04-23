import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = path.join(repoRoot, "lib", "server.mjs");
const clawdadBin = path.join(repoRoot, "bin", "clawdad");

async function createFakeOrp(dir) {
  const binaryPath = path.join(dir, "fake-orp.mjs");
  await writeFile(
    binaryPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);

function print(payload, code = 0) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(code);
}

if (args.join(" ") === "frontier continuation-status --json") {
  print({
    ok: true,
    summary: {
      active_primary_id: "sector-pressure-map",
      active_primary_status: "active",
      additional: {
        active_item_id: "paper-fills-review",
        active_item_status: "active"
      }
    },
    next_action: "Review paper fills after sector pressure map."
  });
}

if (args.join(" ") === "hygiene --json") {
  print({
    schema: "orp.worktree_hygiene/1",
    status: "clean",
    clean: true,
    unclassified_count: 0,
    stop_condition: false,
    safe_to_expand: true
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

async function createFixture(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "research-project");
  const runId = "watchtower-run-1";
  const sessionId = "delegate-session-1";
  await mkdir(path.join(projectPath, ".clawdad", "delegate", "runs"), { recursive: true });
  await mkdir(path.join(projectPath, "src", "payment"), { recursive: true });
  await mkdir(home, { recursive: true });
  await execFileAsync("git", ["init"], { cwd: projectPath });
  await writeFile(
    path.join(projectPath, "src", "payment", "token.js"),
    "export const token = 'placeholder';\n",
    "utf8",
  );
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectPath]: {
            status: "idle",
            last_dispatch: null,
            last_response: null,
            dispatch_count: 0,
            registered_at: "2026-04-23T00:00:00Z",
            active_session_id: sessionId,
            sessions: {
              [sessionId]: {
                slug: "Delegate",
                provider: "codex",
                provider_session_seeded: "true",
                tracked_at: "2026-04-23T00:00:00Z",
                dispatch_count: 0,
                status: "idle",
                local_only: "false",
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
        state: "completed",
        runId,
        startedAt: "2026-04-23T12:00:00Z",
        completedAt: "2026-04-23T12:04:00Z",
        delegateSessionId: sessionId,
        delegateSessionLabel: "Delegate",
        stepCount: 1,
        pauseRequested: false,
        error: "",
      },
      null,
      2,
    ),
    "utf8",
  );
  const events = [
    {
      id: "evt-paper-fills",
      at: "2026-04-23T12:01:00Z",
      type: "step_completed",
      runId,
      step: 1,
      title: "Paper fills checkpoint",
      summary: "Created paper fills after the sector pressure map review.",
      nextAction: "Compare fills against the active ORP item.",
      state: "continue",
      checkpoint: {
        progressSignal: "paper fills were generated",
        breakthroughs: "sector pressure map is now connected to paper results",
        blockers: "none",
        nextProbe: "audit fills",
        confidence: "medium",
      },
    },
    {
      id: "evt-tests-failed",
      at: "2026-04-23T12:02:00Z",
      type: "agent_response",
      runId,
      step: 1,
      title: "Gate result",
      text: "npm test failed in the broker/payment boundary smoke test.",
    },
  ];
  await writeFile(
    path.join(projectPath, ".clawdad", "delegate", "runs", `${runId}.jsonl`),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );
  const fakeOrp = await createFakeOrp(root);
  return { root, home, projectPath, fakeOrp, runId };
}

async function runServer(fixture, args) {
  const env = {
    ...process.env,
    HOME: fixture.home,
    CLAWDAD_HOME: fixture.home,
    CLAWDAD_ORP: fixture.fakeOrp,
  };
  try {
    const result = await execFileAsync(process.execPath, [serverScript, ...args], {
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

async function runBin(fixture, args) {
  const env = {
    ...process.env,
    HOME: fixture.home,
    CLAWDAD_HOME: fixture.home,
    CLAWDAD_ORP: fixture.fakeOrp,
  };
  const result = await execFileAsync(clawdadBin, args, {
    cwd: repoRoot,
    env,
    maxBuffer: 1024 * 1024,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

test("watchtower indexes delegate events into a searchable review feed", async () => {
  const fixture = await createFixture("clawdad-watchtower-feed-");
  try {
    const scanResult = await runServer(fixture, ["watchtower", fixture.projectPath, "--once", "--json"]);
    assert.equal(scanResult.exitCode, 0, scanResult.stderr || scanResult.stdout);
    const scanPayload = JSON.parse(scanResult.stdout);
    assert.equal(scanPayload.ok, true);
    assert.equal(scanPayload.scan.activeOrpItem, "sector-pressure-map");
    assert.ok(scanPayload.scan.indexedEvents >= 2);
    await stat(path.join(fixture.projectPath, ".clawdad", "feed", "watchtower.sqlite"));

    const searchResult = await runServer(fixture, [
      "feed",
      "search",
      fixture.projectPath,
      "paper fills",
      "--json",
    ]);
    assert.equal(searchResult.exitCode, 0, searchResult.stderr || searchResult.stdout);
    const searchPayload = JSON.parse(searchResult.stdout);
    assert.equal(searchPayload.ok, true);
    assert.ok(searchPayload.events.some((event) => /paper fills/iu.test(event.body)));

    const reviewResult = await runServer(fixture, ["feed", "review", fixture.projectPath, "--json"]);
    assert.equal(reviewResult.exitCode, 0, reviewResult.stderr || reviewResult.stdout);
    const reviewPayload = JSON.parse(reviewResult.stdout);
    const triggers = new Set(reviewPayload.cards.map((card) => card.trigger));
    assert.equal(reviewPayload.ok, true);
    assert.ok(triggers.has("tests_failed"));
    assert.ok(triggers.has("sensitive_files"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("clawdad watch <project> routes to the read-only watchtower sidecar", async () => {
  const fixture = await createFixture("clawdad-watchtower-watch-alias-");
  try {
    const result = await runBin(fixture, ["watch", fixture.projectPath, "--once", "--json"]);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.project, fixture.projectPath);
    assert.ok(payload.scan.indexedEvents >= 2);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

