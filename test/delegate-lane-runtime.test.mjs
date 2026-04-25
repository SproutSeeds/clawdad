import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = path.join(repoRoot, "lib", "server.mjs");

function laneDir(projectPath, laneId = "default") {
  return laneId === "default"
    ? path.join(projectPath, ".clawdad", "delegate")
    : path.join(projectPath, ".clawdad", "delegate", "lanes", laneId);
}

function defaultLaneMirrorDir(projectPath) {
  return path.join(projectPath, ".clawdad", "delegate", "default");
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 5_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`server exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error("server did not become healthy");
}

async function stopServer(child) {
  if (child.exitCode != null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForValue(readValue, predicate, label, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;
  while (Date.now() < deadline) {
    try {
      lastValue = await readValue();
      if (predicate(lastValue)) {
        return lastValue;
      }
    } catch (_error) {
      lastValue = null;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`${label} did not settle in time: ${JSON.stringify(lastValue)}`);
}

async function cleanupFixture(fixture) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(fixture.root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!["ENOTEMPTY", "EBUSY", "EPERM"].includes(error?.code)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  await rm(fixture.root, { recursive: true, force: true });
}

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

const joined = args.join(" ");
if (joined === "hygiene --json") {
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

if (joined === "project refresh --json") {
  print({
    ok: true,
    action: "refreshed",
    project: { root: process.cwd() }
  });
}

if (joined === "frontier preflight-delegate --json") {
  print({
    ok: true,
    continuation: {
      ok: true,
      safe: true,
      next_action: "continue active local lane"
    },
    preflight: { ready: true }
  });
}

if (joined === "frontier continuation-status --json") {
  print({
    ok: true,
    summary: {
      active_primary_id: "delegate-lane-runtime",
      active_primary_status: "active"
    },
    next_action: "continue active local lane"
  });
}

if (
  args[0] === "--repo-root" &&
  args[2] === "frontier" &&
  args[3] === "additional" &&
  args[5] === "--json"
) {
  const command = args[4];
  if (command === "complete-active") {
    print({ ok: true, completed: true });
  }
  if (command === "activate-next") {
    print({ ok: true, activated: false });
  }
}

console.error("unexpected fake ORP command: " + joined);
process.exit(64);
`,
    "utf8",
  );
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function createFakeCodex(dir) {
  const binaryPath = path.join(dir, "fake-codex.mjs");
  await writeFile(
    binaryPath,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args[0] !== "exec") {
  console.error("unexpected fake codex command: " + args.join(" "));
  process.exit(64);
}

const outputIndex = args.indexOf("--output-last-message");
const outputFile = outputIndex >= 0 ? args[outputIndex + 1] || "" : "";
const prompt = args[args.length - 1] || "";
const text = prompt.includes("Run id:")
  ? [
      "**Status**",
      "Delegate run is lane-scoped and complete.",
      "",
      "**Recent Progress**",
      "- Captured the run events for this lane only.",
      "",
      "**Evidence**",
      "- Lane-specific request ids and run logs were recorded.",
      "",
      "**Current Edge**",
      "- Awaiting the next explicit lane step.",
      "",
      "**Next Move**",
      "- Review the saved lane snapshot.",
      "",
      "**Needs Human**",
      "No",
    ].join("\\n")
  : [
      "**North Star**",
      "Keep the delegate scoped to the active lane.",
      "",
      "**Current Objective**",
      "Finish the active lane cleanly.",
      "",
      "**Execution Tracks**",
      "- Track the current lane state and request ids.",
      "",
      "**Hard Stops**",
      "- needs_human",
      "",
      "**Next Steps**",
      "1. Finish the current lane.",
      "",
      "**Definition of Done**",
      "- Lane status and logs stay isolated.",
    ].join("\\n");

if (outputFile) {
  writeFileSync(outputFile, text, "utf8");
}
console.log(JSON.stringify({ ok: true }));
`,
    "utf8",
  );
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function createFakeClawdad(dir, sleepMs = 350) {
  const binaryPath = path.join(dir, "fake-clawdad.mjs");
  await writeFile(
    binaryPath,
    `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (args[0] !== "dispatch") {
  console.error("unexpected fake clawdad command: " + args.join(" "));
  process.exit(64);
}

const mailboxDir = process.env.CLAWDAD_MAILBOX_DIR || "";
if (!mailboxDir) {
  console.error("missing CLAWDAD_MAILBOX_DIR");
  process.exit(64);
}

const sessionIndex = args.indexOf("--session");
const sessionId = sessionIndex >= 0 ? args[sessionIndex + 1] || "" : "";
const mailboxParts = mailboxDir.split(path.sep).filter(Boolean);
const lanesIndex = mailboxParts.lastIndexOf("lanes");
const laneId = lanesIndex >= 0
  ? mailboxParts[lanesIndex + 1]
  : mailboxDir.includes(path.join("delegate", "default", "mailbox")) || mailboxDir.endsWith(path.join("delegate", "mailbox"))
    ? "default"
    : path.basename(path.dirname(mailboxDir)) || "default";
const requestId = laneId + "-request-" + process.pid;
const dispatchedAt = new Date().toISOString();
const statusFile = path.join(mailboxDir, "status.json");
const responseFile = path.join(mailboxDir, "response.md");

mkdirSync(mailboxDir, { recursive: true });
writeFileSync(
  statusFile,
  JSON.stringify({
    state: "running",
    request_id: requestId,
    session_id: sessionId,
    dispatched_at: dispatchedAt,
    pid: process.pid
  }, null, 2),
  "utf8",
);

await new Promise((resolve) => setTimeout(resolve, ${sleepMs}));

const content = [
  "Completed lane " + laneId + ".",
  "",
  "\`\`\`json",
  JSON.stringify({
    state: "completed",
    stop_reason: "none",
    next_action: "archive " + laneId + " lane result",
    summary: "Completed " + laneId + " lane without collisions.",
    checkpoint: {
      progress_signal: "medium",
      breakthroughs: laneId + " mailbox and status stayed isolated",
      blockers: "none",
      next_probe: "archive " + laneId + " lane result",
      confidence: "high"
    }
  }, null, 2),
  "\`\`\`"
].join("\\n");
const completedAt = new Date().toISOString();
writeFileSync(
  responseFile,
  [
    "# Response: " + requestId,
    "",
    "Completed: " + completedAt,
    "Session: " + sessionId,
    "Exit code: 0",
    "",
    "---",
    "",
    content
  ].join("\\n"),
  "utf8",
);
writeFileSync(
  statusFile,
  JSON.stringify({
    state: "completed",
    request_id: requestId,
    session_id: sessionId,
    dispatched_at: dispatchedAt,
    completed_at: completedAt,
    pid: null
  }, null, 2),
  "utf8",
);
`,
    "utf8",
  );
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function createFixture(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "delegate-runtime-project");
  const configPath = path.join(root, "server.json");
  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });

  await execFileAsync("git", ["init"], { cwd: projectPath });
  await execFileAsync("git", ["config", "user.name", "Clawdad Tests"], { cwd: projectPath });
  await execFileAsync("git", ["config", "user.email", "tests@example.com"], { cwd: projectPath });
  await writeFile(path.join(projectPath, "README.md"), "# Delegate runtime test\n", "utf8");
  await execFileAsync("git", ["add", "README.md"], { cwd: projectPath });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: projectPath });

  await writeJson(path.join(home, "state.json"), {
    version: 3,
    orp_workspace: "main",
    projects: {
      [projectPath]: {
        status: "idle",
        last_dispatch: null,
        last_response: null,
        dispatch_count: 0,
        registered_at: "2026-04-24T00:00:00Z",
        active_session_id: "main-session",
        sessions: {
          "main-session": {
            slug: "Main",
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
          "default-delegate-session": {
            slug: "Default Delegate",
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
          "lane-a-session": {
            slug: "Lane A Delegate",
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
          "lane-b-session": {
            slug: "Lane B Delegate",
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
  });
  await writeJson(path.join(projectPath, ".clawdad", "mailbox", "status.json"), {
    state: "idle",
    request_id: null,
    session_id: "main-session",
  });

  const fakeOrp = await createFakeOrp(root);
  const fakeCodex = await createFakeCodex(root);
  const fakeClawdad = await createFakeClawdad(root);
  return {
    root,
    home,
    projectPath,
    configPath,
    fakeOrp,
    fakeCodex,
    fakeClawdad,
  };
}

function testEnv(fixture) {
  return {
    ...process.env,
    HOME: fixture.home,
    CLAWDAD_HOME: fixture.home,
    CLAWDAD_ORP: fixture.fakeOrp,
    CLAWDAD_CODEX: fixture.fakeCodex,
    CLAWDAD_BIN_PATH: fixture.fakeClawdad,
  };
}

async function runServerCommand(fixture, args, { json = true } = {}) {
  const commandArgs = json && !args.includes("--json")
    ? [...args, "--json"]
    : args;
  try {
    const result = await execFileAsync(process.execPath, [serverScript, ...commandArgs], {
      cwd: repoRoot,
      env: testEnv(fixture),
      maxBuffer: 10 * 1024 * 1024,
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

async function seedLane(fixture, laneId, {
  displayName,
  objective,
  scopeGlobs,
  delegateSessionId,
} = {}) {
  if (laneId !== "default") {
    const laneArgs = [
      "lane-create",
      fixture.projectPath,
      laneId,
      "--display-name",
      displayName || laneId,
      "--objective",
      objective || `Objective for ${laneId}.`,
    ];
    for (const scope of scopeGlobs || []) {
      laneArgs.push("--scope", scope);
    }
    await runJsonCommand(fixture, laneArgs);
  } else {
    await mkdir(laneDir(fixture.projectPath, "default"), { recursive: true });
  }

  const dir = laneDir(fixture.projectPath, laneId);
  const now = new Date().toISOString();
  const config = {
    version: 2,
    laneId,
    displayName: displayName || laneId,
    objective: objective || `Objective for ${laneId}.`,
    projectPath: fixture.projectPath,
    scopeGlobs: scopeGlobs || [],
    delegateSessionId,
    delegateSessionSlug: displayName || laneId,
    enabled: true,
    hardStops: ["needs_human"],
    computeReservePercent: 20,
    maxStepsPerRun: 1,
    createdAt: now,
    updatedAt: now,
  };
  const status = {
    version: 1,
    laneId,
    state: "idle",
    runId: null,
    startedAt: null,
    completedAt: null,
    delegateSessionId,
    delegateSessionLabel: displayName || laneId,
    stepCount: 0,
    maxSteps: 1,
    activeRequestId: null,
    activeStep: null,
    lastRequestId: null,
    pauseRequested: false,
    error: "",
  };
  const planSnapshots = {
    version: 1,
    snapshots: [
      {
        id: `${laneId}-plan`,
        projectPath: fixture.projectPath,
        runId: null,
        createdAt: now,
        provider: "codex",
        sessionId: delegateSessionId,
        sessionLabel: displayName || laneId,
        stepCount: 0,
        sourceEntryCount: 0,
        summarySnapshotAt: now,
        statusSummary: "Ready for the next safe step.",
        nextAction: `archive ${laneId} lane result`,
        refreshReason: null,
        plan: "1. Stay within the lane scope.\n2. Finish the active task cleanly.",
      },
    ],
  };
  const runSummaries = { version: 1, snapshots: [] };
  const mailboxStatus = {
    state: "idle",
    request_id: null,
    session_id: delegateSessionId,
  };

  await writeJson(path.join(dir, "delegate-config.json"), config);
  await writeFile(path.join(dir, "delegate-brief.md"), "# North Star\n\nStay in lane scope.\n", "utf8");
  await writeJson(path.join(dir, "delegate-status.json"), status);
  await writeJson(path.join(dir, "delegate-plan-snapshots.json"), planSnapshots);
  await writeJson(path.join(dir, "delegate-run-summaries.json"), runSummaries);
  await writeJson(path.join(dir, "mailbox", "status.json"), mailboxStatus);

  if (laneId === "default") {
    const mirrorDir = defaultLaneMirrorDir(fixture.projectPath);
    await writeJson(path.join(mirrorDir, "delegate-config.json"), config);
    await writeFile(path.join(mirrorDir, "delegate-brief.md"), "# North Star\n\nStay in lane scope.\n", "utf8");
    await writeJson(path.join(mirrorDir, "delegate-status.json"), status);
    await writeJson(path.join(mirrorDir, "delegate-plan-snapshots.json"), planSnapshots);
    await writeJson(path.join(mirrorDir, "delegate-run-summaries.json"), runSummaries);
    await mkdir(path.join(mirrorDir, "runs"), { recursive: true });
    await mkdir(path.join(mirrorDir, "artifacts"), { recursive: true });
    await mkdir(path.join(mirrorDir, "mailbox"), { recursive: true });
  }
}

async function startApiServer(fixture) {
  const port = await freePort();
  await writeJson(fixture.configPath, {
    host: "127.0.0.1",
    port,
    defaultProject: fixture.projectPath,
    authMode: "tailscale",
    allowedUsers: ["tester@example.com"],
  });
  const child = spawn(process.execPath, [serverScript, "serve", "--config", fixture.configPath], {
    cwd: repoRoot,
    env: testEnv(fixture),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, child);
  return {
    child,
    baseUrl,
    headers: {
      "tailscale-user-login": "tester@example.com",
    },
  };
}

test("delegate-run keeps named lane runtime state isolated and lane APIs stay scoped", async () => {
  const fixture = await createFixture("clawdad-lane-runtime-");
  try {
    await seedLane(fixture, "lane-a", {
      displayName: "Lane A",
      objective: "Work only in src/lane-a.",
      scopeGlobs: ["src/lane-a/**"],
      delegateSessionId: "lane-a-session",
    });
    await seedLane(fixture, "lane-b", {
      displayName: "Lane B",
      objective: "Work only in src/lane-b.",
      scopeGlobs: ["src/lane-b/**"],
      delegateSessionId: "lane-b-session",
    });

    const laneAStart = await runJsonCommand(fixture, [
      "delegate-run",
      fixture.projectPath,
      "--lane",
      "lane-a",
    ]);
    const laneBStart = await runJsonCommand(fixture, [
      "delegate-run",
      fixture.projectPath,
      "--lane",
      "lane-b",
    ]);
    assert.equal(laneAStart.accepted, true);
    assert.equal(laneBStart.accepted, true);

    const laneAStatusFile = path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-status.json");
    const laneBStatusFile = path.join(laneDir(fixture.projectPath, "lane-b"), "delegate-status.json");
    const laneAActive = await waitForValue(
      () => readJson(laneAStatusFile),
      (status) => Boolean(status.activeRequestId),
      "lane-a active request",
    );
    const laneBActive = await waitForValue(
      () => readJson(laneBStatusFile),
      (status) => Boolean(status.activeRequestId),
      "lane-b active request",
    );
    assert.match(laneAActive.activeRequestId, /^lane-a-request-/u);
    assert.match(laneBActive.activeRequestId, /^lane-b-request-/u);
    assert.notEqual(laneAActive.activeRequestId, laneBActive.activeRequestId);

    const laneAFinal = await waitForValue(
      () => readJson(laneAStatusFile),
      (status) => status.state === "completed",
      "lane-a completion",
    );
    const laneBFinal = await waitForValue(
      () => readJson(laneBStatusFile),
      (status) => status.state === "completed",
      "lane-b completion",
    );
    assert.match(laneAFinal.lastRequestId, /^lane-a-request-/u);
    assert.match(laneBFinal.lastRequestId, /^lane-b-request-/u);
    assert.equal(laneAFinal.activeRequestId, null);
    assert.equal(laneBFinal.activeRequestId, null);

    const laneAMailbox = await readJson(path.join(laneDir(fixture.projectPath, "lane-a"), "mailbox", "status.json"));
    const laneBMailbox = await readJson(path.join(laneDir(fixture.projectPath, "lane-b"), "mailbox", "status.json"));
    assert.match(laneAMailbox.request_id, /^lane-a-request-/u);
    assert.match(laneBMailbox.request_id, /^lane-b-request-/u);
    assert.notEqual(laneAMailbox.request_id, laneBMailbox.request_id);

    const sharedMailbox = await readJson(path.join(fixture.projectPath, ".clawdad", "mailbox", "status.json"));
    assert.equal(sharedMailbox.state, "idle");

    const laneARunFiles = (await readdir(path.join(laneDir(fixture.projectPath, "lane-a"), "runs"))).filter((entry) => entry.endsWith(".jsonl"));
    const laneBRunFiles = (await readdir(path.join(laneDir(fixture.projectPath, "lane-b"), "runs"))).filter((entry) => entry.endsWith(".jsonl"));
    assert.deepEqual(laneARunFiles, [`${laneAFinal.runId}.jsonl`]);
    assert.deepEqual(laneBRunFiles, [`${laneBFinal.runId}.jsonl`]);

    const { child, baseUrl, headers } = await startApiServer(fixture);
    try {
      const laneALogResponse = await fetch(
        `${baseUrl}/v1/delegate/run-log?project=${encodeURIComponent(fixture.projectPath)}&lane=lane-a&runId=${encodeURIComponent(laneAFinal.runId)}`,
        { headers },
      );
      assert.equal(laneALogResponse.status, 200);
      const laneALogPayload = await laneALogResponse.json();
      assert.equal(laneALogPayload.ok, true);
      assert.equal(laneALogPayload.runId, laneAFinal.runId);
      assert.equal(laneALogPayload.events.some((event) => event.runId === laneBFinal.runId), false);

      const laneBLogResponse = await fetch(
        `${baseUrl}/v1/delegate/run-log?project=${encodeURIComponent(fixture.projectPath)}&lane=lane-b&runId=${encodeURIComponent(laneBFinal.runId)}`,
        { headers },
      );
      assert.equal(laneBLogResponse.status, 200);
      const laneBLogPayload = await laneBLogResponse.json();
      assert.equal(laneBLogPayload.ok, true);
      assert.equal(laneBLogPayload.runId, laneBFinal.runId);
      assert.equal(laneBLogPayload.events.some((event) => event.runId === laneAFinal.runId), false);

      const laneAFeedResponse = await fetch(
        `${baseUrl}/v1/delegate/feed?project=${encodeURIComponent(fixture.projectPath)}&lane=lane-a&mode=tail&limit=20`,
        { headers },
      );
      assert.equal(laneAFeedResponse.status, 200);
      const laneAFeedPayload = await laneAFeedResponse.json();
      assert.equal(laneAFeedPayload.ok, true);
      assert.equal(laneAFeedPayload.events.some((event) => event.runId === laneAFinal.runId), true);
      assert.equal(laneAFeedPayload.events.some((event) => event.runId === laneBFinal.runId), false);

      const laneBFeedResponse = await fetch(
        `${baseUrl}/v1/delegate/feed?project=${encodeURIComponent(fixture.projectPath)}&lane=lane-b&mode=tail&limit=20`,
        { headers },
      );
      assert.equal(laneBFeedResponse.status, 200);
      const laneBFeedPayload = await laneBFeedResponse.json();
      assert.equal(laneBFeedPayload.ok, true);
      assert.equal(laneBFeedPayload.events.some((event) => event.runId === laneBFinal.runId), true);
      assert.equal(laneBFeedPayload.events.some((event) => event.runId === laneAFinal.runId), false);

      const summaryHeaders = {
        ...headers,
        "content-type": "application/json",
      };
      const laneASummaryResponse = await fetch(`${baseUrl}/v1/delegate/run-summary`, {
        method: "POST",
        headers: summaryHeaders,
        body: JSON.stringify({
          project: fixture.projectPath,
          lane: "lane-a",
          runId: laneAFinal.runId,
        }),
      });
      assert.equal(laneASummaryResponse.status, 200);
      const laneASummaryPayload = await laneASummaryResponse.json();
      assert.equal(laneASummaryPayload.ok, true);
      assert.equal(laneASummaryPayload.latestRunSummarySnapshot.runId, laneAFinal.runId);

      const laneBSummaryResponse = await fetch(`${baseUrl}/v1/delegate/run-summary`, {
        method: "POST",
        headers: summaryHeaders,
        body: JSON.stringify({
          project: fixture.projectPath,
          lane: "lane-b",
          runId: laneBFinal.runId,
        }),
      });
      assert.equal(laneBSummaryResponse.status, 200);
      const laneBSummaryPayload = await laneBSummaryResponse.json();
      assert.equal(laneBSummaryPayload.ok, true);
      assert.equal(laneBSummaryPayload.latestRunSummarySnapshot.runId, laneBFinal.runId);
    } finally {
      await stopServer(child);
    }

    const laneASummaries = await readJson(path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-run-summaries.json"));
    const laneBSummaries = await readJson(path.join(laneDir(fixture.projectPath, "lane-b"), "delegate-run-summaries.json"));
    assert.deepEqual(laneASummaries.snapshots.map((snapshot) => snapshot.runId), [laneAFinal.runId]);
    assert.deepEqual(laneBSummaries.snapshots.map((snapshot) => snapshot.runId), [laneBFinal.runId]);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("unsafe overlapping lane scopes block the later delegate-run", async () => {
  const fixture = await createFixture("clawdad-lane-conflict-");
  try {
    await seedLane(fixture, "lane-a", {
      displayName: "Lane A",
      objective: "Own src/shared.",
      scopeGlobs: ["src/shared/**"],
      delegateSessionId: "lane-a-session",
    });
    await seedLane(fixture, "lane-b", {
      displayName: "Lane B",
      objective: "Also touches src/shared.",
      scopeGlobs: ["src/shared/utils/**"],
      delegateSessionId: "lane-b-session",
    });

    await writeJson(path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-status.json"), {
      version: 1,
      laneId: "lane-a",
      state: "running",
      runId: "lane-a-live-run",
      startedAt: "2026-04-24T12:00:00Z",
      completedAt: null,
      delegateSessionId: "lane-a-session",
      delegateSessionLabel: "Lane A",
      stepCount: 0,
      maxSteps: 1,
      activeRequestId: "lane-a-request-live",
      activeStep: 1,
      lastRequestId: "lane-a-request-live",
      pauseRequested: false,
      error: "",
    });

    const blocked = await runJsonCommand(fixture, [
      "delegate-run",
      fixture.projectPath,
      "--lane",
      "lane-b",
    ]);
    assert.equal(blocked.accepted, false);
    assert.equal(blocked.status.state, "blocked");
    assert.equal(blocked.status.stopReason, "needs_human");
    assert.match(blocked.status.error, /Unsafe delegate lane overlap: lane-a/u);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("default delegate-run stays on default delegate storage and leaves shared mailbox alone", async () => {
  const fixture = await createFixture("clawdad-default-lane-runtime-");
  try {
    await seedLane(fixture, "default", {
      displayName: "Default delegate",
      objective: "Default lane objective.",
      scopeGlobs: [],
      delegateSessionId: "default-delegate-session",
    });
    await seedLane(fixture, "lane-a", {
      displayName: "Lane A",
      objective: "Named lane should stay idle.",
      scopeGlobs: ["src/lane-a/**"],
      delegateSessionId: "lane-a-session",
    });

    const started = await runJsonCommand(fixture, [
      "delegate-run",
      fixture.projectPath,
    ]);
    assert.equal(started.accepted, true);
    assert.equal(started.status.laneId, "default");

    const defaultStatus = await waitForValue(
      () => readJson(path.join(laneDir(fixture.projectPath, "default"), "delegate-status.json")),
      (status) => status.state === "completed",
      "default lane completion",
    );
    const mirroredStatus = await readJson(path.join(defaultLaneMirrorDir(fixture.projectPath), "delegate-status.json"));
    const defaultMailbox = await readJson(path.join(laneDir(fixture.projectPath, "default"), "mailbox", "status.json"));
    const sharedMailbox = await readJson(path.join(fixture.projectPath, ".clawdad", "mailbox", "status.json"));
    const namedLaneStatus = await readJson(path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-status.json"));

    assert.match(defaultStatus.lastRequestId, /^default-request-/u);
    assert.equal(mirroredStatus.state, "completed");
    assert.equal(mirroredStatus.runId, defaultStatus.runId);
    assert.match(defaultMailbox.request_id, /^default-request-/u);
    assert.equal(sharedMailbox.state, "idle");
    assert.equal(namedLaneStatus.state, "idle");
  } finally {
    await cleanupFixture(fixture);
  }
});
