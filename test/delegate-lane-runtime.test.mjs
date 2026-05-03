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

function processIsLive(pid) {
  const normalizedPid = Number.parseInt(String(pid || "0"), 10);
  if (!Number.isFinite(normalizedPid) || normalizedPid <= 0) {
    return false;
  }
  try {
    process.kill(normalizedPid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
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
const scenario = process.env.ORP_SCENARIO || "success";

function print(payload, code = 0) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(code);
}

const joined = args.join(" ");
if (joined === "hygiene --json") {
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

if (joined === "project refresh --json") {
  print({
    ok: true,
    action: "refreshed",
    project: { root: process.cwd() }
  });
}

if (joined === "frontier preflight-delegate --json") {
  if (scenario === "preflight_block") {
    print({
      ok: false,
      issues: [
        { severity: "error", code: "needs_human", message: "Continuation requires human approval." }
      ],
      preflight: { ready: false }
    }, 1);
  }
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
const prompt = args[2] || "";
const envLogFile = process.env.CLAWDAD_FAKE_DISPATCH_ENV_LOG || "";
if (envLogFile) {
  mkdirSync(path.dirname(envLogFile), { recursive: true });
  writeFileSync(
    envLogFile,
    JSON.stringify({
      threadGoal: process.env.CLAWDAD_CODEX_THREAD_GOAL || "",
      threadGoalStatus: process.env.CLAWDAD_CODEX_THREAD_GOAL_STATUS || "",
      goalMode: process.env.CLAWDAD_CODEX_GOALS || "",
      eventLogFile: process.env.CLAWDAD_CODEX_EVENT_LOG_FILE || "",
      liveEventFile: process.env.CLAWDAD_CODEX_LIVE_EVENT_FILE || ""
    }) + "\\n",
    { flag: "a" }
  );
}

const mailboxDir = process.env.CLAWDAD_MAILBOX_DIR || "";
if (!mailboxDir) {
  console.error("missing CLAWDAD_MAILBOX_DIR");
  process.exit(64);
}
const mode = process.env.CLAWDAD_FAKE_DISPATCH_MODE || "";
if (mode === "early_exit_before_mailbox") {
  console.error("mktemp: mkstemp failed on /Users/codymitchell/.clawdad/state.json.tmp.XXXXXX: Operation not permitted");
  process.exit(73);
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

if (mode === "codex_events_complete_mailbox_stays_running") {
  const codexEventLogFile = process.env.CLAWDAD_CODEX_EVENT_LOG_FILE || "";
  const turnId = "turn-recovered-" + process.pid;
  const content = [
    "Recovered from Codex app-server events.",
    "",
    "\`\`\`json",
    JSON.stringify({
      state: "completed",
      stop_reason: "none",
      next_action: "archive " + laneId + " lane result",
      summary: "Completed " + laneId + " lane from Codex app-server events.",
      checkpoint: {
        progress_signal: "high",
        breakthroughs: "codex events carried the completed decision",
        blockers: "none",
        next_probe: "archive " + laneId + " lane result",
        confidence: "high"
      }
    }, null, 2),
    "\`\`\`"
  ].join("\\n");
  if (codexEventLogFile) {
    mkdirSync(path.dirname(codexEventLogFile), { recursive: true });
    const at = new Date().toISOString();
    for (const event of [
      {
        at,
        type: "codex_goal_sync",
        method: "clawdad/goal/sync",
        threadId: sessionId,
        turnId: null,
        payload: {
          mode: "required",
          supported: true,
          synced: true,
          skipped: false,
          error: "",
          goal: { threadId: sessionId, objective: "fake synced goal", status: "active" }
        }
      },
      {
        at,
        type: "codex_agent_message",
        method: "item/completed",
        threadId: sessionId,
        turnId,
        itemType: "agentMessage",
        payload: { phase: "final_answer", text: content }
      },
      {
        at,
        type: "codex_turn_completed",
        method: "turn/completed",
        threadId: sessionId,
        turnId,
        status: "completed",
        payload: { status: "completed", error: null }
      }
    ]) {
      writeFileSync(codexEventLogFile, JSON.stringify(event) + "\\n", { flag: "a" });
    }
  }
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}

if (mode === "stall") {
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}

await new Promise((resolve) => setTimeout(resolve, ${sleepMs}));

const isWatchtowerRepairStep = prompt.includes("repair failing validation") || prompt.includes("repair validation");
const decision = mode === "watchtower_validation_soft" && !isWatchtowerRepairStep
  ? {
      state: "continue",
      stop_reason: "none",
      next_action: "continue " + laneId + " after fixing validation",
      summary: "Implemented the first slice, but npm test failed in the validation gate.",
      checkpoint: {
        progress_signal: "medium",
        breakthroughs: laneId + " first slice is in place",
        blockers: "validation failed",
        next_probe: "repair failing validation",
        confidence: "medium"
      }
    }
  : {
      state: "completed",
      stop_reason: "none",
      next_action: "archive " + laneId + " lane result",
      summary: mode === "watchtower_validation_soft"
        ? "Repaired validation and completed " + laneId + "."
        : "Completed " + laneId + " lane without collisions.",
      checkpoint: {
        progress_signal: "medium",
        breakthroughs: laneId + " mailbox and status stayed isolated",
        blockers: "none",
        next_probe: "archive " + laneId + " lane result",
        confidence: "high"
      }
    };
const content = [
  mode === "watchtower_validation_soft" && !isWatchtowerRepairStep
    ? "npm test failed in the validation gate."
    : "Completed lane " + laneId + ".",
  "",
  "\`\`\`json",
  JSON.stringify(decision, null, 2),
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

function testEnv(fixture, overrides = {}) {
  return {
    ...process.env,
    HOME: fixture.home,
    CLAWDAD_HOME: fixture.home,
    CLAWDAD_CODEX_HOME: path.join(fixture.home, ".codex"),
    CLAWDAD_ORP: fixture.fakeOrp,
    CLAWDAD_CODEX: fixture.fakeCodex,
    CLAWDAD_BIN_PATH: fixture.fakeClawdad,
    ...overrides,
  };
}

async function runServerCommand(fixture, args, { json = true, env = {} } = {}) {
  const commandArgs = json && !args.includes("--json")
    ? [...args, "--json"]
    : args;
  try {
    const result = await execFileAsync(process.execPath, [serverScript, ...commandArgs], {
      cwd: repoRoot,
      env: testEnv(fixture, env),
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
  directionCheckMode,
  watchtowerReviewMode,
  computeReservePercent,
  maxStepsPerRun,
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
    computeReservePercent: computeReservePercent ?? 20,
    directionCheckMode: directionCheckMode || "observe",
    watchtowerReviewMode: watchtowerReviewMode || "off",
    maxStepsPerRun: maxStepsPerRun || 1,
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

async function writeCompletedLaneStatus(fixture, laneId, {
  runId = `${laneId}-completed-run`,
  nextAction = `Continue ${laneId} safely with a concrete follow-up task.`,
  lastOutcomeSummary = `Completed the previous ${laneId} task cleanly.`,
  stopReason = "none",
  error = "",
} = {}) {
  const completedAt = "2026-04-27T14:00:00.000Z";
  await writeJson(path.join(laneDir(fixture.projectPath, laneId), "delegate-status.json"), {
    version: 1,
    laneId,
    state: "completed",
    runId,
    startedAt: "2026-04-27T13:55:00.000Z",
    completedAt,
    delegateSessionId: `${laneId}-session`,
    delegateSessionLabel: laneId,
    stepCount: 1,
    maxSteps: 1,
    activeRequestId: null,
    activeStep: null,
    lastRequestId: `${laneId}-request-previous`,
    supervisorPid: null,
    supervisorStartedAt: null,
    pauseRequested: false,
    lastOutcomeSummary,
    nextAction,
    stopReason,
    error,
  });
}

async function writeTightComputeTelemetry(fixture) {
  const sessionsDir = path.join(fixture.home, ".codex", "sessions", "2026", "04", "27");
  await mkdir(sessionsDir, { recursive: true });
  const reset = Math.floor((Date.now() + 5 * 24 * 60 * 60 * 1000) / 1000);
  await writeFile(
    path.join(sessionsDir, "tight.jsonl"),
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      type: "event_msg",
      payload: {
        type: "token_count",
        rate_limits: {
          limit_id: "codex",
          primary: {
            used_percent: 20,
            window_minutes: 300,
            resets_at: reset,
          },
          secondary: {
            used_percent: 95,
            window_minutes: 10080,
            resets_at: reset,
          },
          credits: {
            unlimited: false,
          },
        },
      },
    })}\n`,
    "utf8",
  );
}

async function startApiServer(fixture, env = {}) {
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
    env: testEnv(fixture, env),
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
      assert.equal(laneALogPayload.events.some((event) => String(event.type || "").startsWith("watchtower_")), false);

      const laneBLogResponse = await fetch(
        `${baseUrl}/v1/delegate/run-log?project=${encodeURIComponent(fixture.projectPath)}&lane=lane-b&runId=${encodeURIComponent(laneBFinal.runId)}`,
        { headers },
      );
      assert.equal(laneBLogResponse.status, 200);
      const laneBLogPayload = await laneBLogResponse.json();
      assert.equal(laneBLogPayload.ok, true);
      assert.equal(laneBLogPayload.runId, laneBFinal.runId);
      assert.equal(laneBLogPayload.events.some((event) => event.runId === laneAFinal.runId), false);
      assert.equal(laneBLogPayload.events.some((event) => String(event.type || "").startsWith("watchtower_")), false);

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

test("delegate-run stale-fails heartbeat-only lane dispatches instead of leaving running sessions", async () => {
  const fixture = await createFixture("clawdad-stalled-lane-runtime-");
  try {
    await seedLane(fixture, "lane-a", {
      displayName: "Lane A",
      objective: "Work only in src/lane-a.",
      scopeGlobs: ["src/lane-a/**"],
      delegateSessionId: "lane-a-session",
    });

    const started = await runServerCommand(fixture, [
      "delegate-run",
      fixture.projectPath,
      "--lane",
      "lane-a",
    ], {
      env: {
        CLAWDAD_FAKE_DISPATCH_MODE: "stall",
        CLAWDAD_DELEGATE_DISPATCH_STALL_TIMEOUT_MS: "100",
      },
    });
    assert.equal(started.exitCode, 0, started.stderr || started.stdout);
    const startPayload = JSON.parse(started.stdout);
    assert.equal(startPayload.accepted, true);

    const statusFile = path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-status.json");
    const failedStatus = await waitForValue(
      () => readJson(statusFile),
      (status) => status.state === "failed",
      "stalled lane failure",
      8_000,
    );
    assert.match(failedStatus.error, /no live progress/u);
    assert.equal(failedStatus.activeRequestId, null);
    assert.equal(failedStatus.activeStep, null);
    assert.equal(failedStatus.pauseRequested, false);

    const mailboxStatus = await readJson(path.join(laneDir(fixture.projectPath, "lane-a"), "mailbox", "status.json"));
    assert.equal(mailboxStatus.state, "failed");
    assert.match(mailboxStatus.error, /no live progress/u);

    const sharedMailbox = await readJson(path.join(fixture.projectPath, ".clawdad", "mailbox", "status.json"));
    assert.equal(sharedMailbox.state, "idle");
  } finally {
    await cleanupFixture(fixture);
  }
});

test("delegate-run captures detached worker stderr when it exits before mailbox request", async () => {
  const fixture = await createFixture("clawdad-dispatch-early-exit-");
  try {
    await seedLane(fixture, "lane-a", {
      displayName: "Lane A",
      objective: "Work only in src/lane-a.",
      scopeGlobs: ["src/lane-a/**"],
      delegateSessionId: "lane-a-session",
    });

    const started = await runServerCommand(fixture, [
      "delegate-run",
      fixture.projectPath,
      "--lane",
      "lane-a",
    ], {
      env: {
        CLAWDAD_FAKE_DISPATCH_MODE: "early_exit_before_mailbox",
        CLAWDAD_DELEGATE_DISPATCH_START_TIMEOUT_MS: "500",
        CLAWDAD_DELEGATE_DISPATCH_START_RECONCILE_MS: "100",
      },
    });
    assert.equal(started.exitCode, 0, started.stderr || started.stdout);
    const startPayload = JSON.parse(started.stdout);
    assert.equal(startPayload.accepted, true);

    const statusFile = path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-status.json");
    const failedStatus = await waitForValue(
      () => readJson(statusFile),
      (status) => status.state === "failed",
      "early dispatch exit failure",
      8_000,
    );
    assert.match(failedStatus.error, /Detached worker exited before creating the mailbox request/u);
    assert.match(failedStatus.error, /Operation not permitted/u);

    const runEvents = await readFile(
      path.join(laneDir(fixture.projectPath, "lane-a"), "runs", `${failedStatus.runId}.jsonl`),
      "utf8",
    );
    assert.match(runEvents, /dispatch_process_failed/u);
    assert.match(runEvents, /mktemp: mkstemp failed/u);
    assert.match(runEvents, /startupLogFile/u);

    const startupLog = await readFile(
      path.join(laneDir(fixture.projectPath, "lane-a"), "runs", `${failedStatus.runId}.dispatch-start.log`),
      "utf8",
    );
    assert.match(startupLog, /Operation not permitted/u);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("delegate-run preflights host state access before detached dispatch", async () => {
  const fixture = await createFixture("clawdad-dispatch-preflight-");
  try {
    await seedLane(fixture, "lane-a", {
      displayName: "Lane A",
      objective: "Work only in src/lane-a.",
      scopeGlobs: ["src/lane-a/**"],
      delegateSessionId: "lane-a-session",
    });
    await chmod(fixture.home, 0o500);

    const doctor = await runServerCommand(fixture, ["sessions-doctor", fixture.projectPath]);
    assert.equal(doctor.exitCode, 1);
    const doctorPayload = JSON.parse(doctor.stdout);
    assert.equal(doctorPayload.ok, false);
    assert.ok(doctorPayload.environment.issues.some((issue) => issue.type === "sandbox_host_access"));
    assert.ok(
      doctorPayload.environment.issues.some((issue) =>
        /Atomic write Clawdad state file|Write Codex sessions directory/u.test(issue.message),
      ),
    );

    const started = await runServerCommand(fixture, [
      "delegate-run",
      fixture.projectPath,
      "--lane",
      "lane-a",
    ]);
    assert.equal(started.exitCode, 0, started.stderr || started.stdout);
    const startPayload = JSON.parse(started.stdout);
    assert.equal(startPayload.accepted, true);

    const statusFile = path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-status.json");
    const failedStatus = await waitForValue(
      () => readJson(statusFile),
      (status) => status.state === "failed",
      "host access preflight failure",
      8_000,
    );
    assert.match(failedStatus.error, /host-level access to ~\/\.clawdad and ~\/\.codex/u);
    assert.match(failedStatus.error, /Atomic write Clawdad state file|Write Codex sessions directory/u);

    const runEvents = await readFile(
      path.join(laneDir(fixture.projectPath, "lane-a"), "runs", `${failedStatus.runId}.jsonl`),
      "utf8",
    );
    assert.match(runEvents, /dispatch_preflight_failed/u);
    assert.doesNotMatch(runEvents, /dispatch_process_started/u);
  } finally {
    await chmod(fixture.home, 0o700).catch(() => {});
    await cleanupFixture(fixture);
  }
});

test("delegate-run recovers completed Codex app-server events when mailbox stays running", async () => {
  const fixture = await createFixture("clawdad-codex-events-recovery-");
  let recoveredWorkerPid = null;
  try {
    await seedLane(fixture, "lane-a", {
      displayName: "Lane A",
      objective: "Finish lane A from Codex app-server completion events.",
      scopeGlobs: ["src/lane-a/**"],
      delegateSessionId: "lane-a-session",
    });

    const started = await runServerCommand(fixture, [
      "delegate-run",
      fixture.projectPath,
      "--lane",
      "lane-a",
    ], {
      env: {
        CLAWDAD_FAKE_DISPATCH_MODE: "codex_events_complete_mailbox_stays_running",
        CLAWDAD_CODEX_GOALS: "required",
      },
    });
    assert.equal(started.exitCode, 0, started.stderr || started.stdout);
    const startPayload = JSON.parse(started.stdout);
    assert.equal(startPayload.accepted, true);

    const statusFile = path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-status.json");
    const finalStatus = await waitForValue(
      () => readJson(statusFile),
      (status) => status.state === "completed",
      "codex event recovered completion",
      8_000,
    );
    assert.equal(finalStatus.codexGoal.synced, true);
    assert.equal(finalStatus.codexGoal.status, "complete");
    assert.equal(finalStatus.codexGoal.error, null);

    const mailboxStatus = await readJson(path.join(laneDir(fixture.projectPath, "lane-a"), "mailbox", "status.json"));
    assert.equal(mailboxStatus.state, "completed");

    const response = await readFile(path.join(laneDir(fixture.projectPath, "lane-a"), "mailbox", "response.md"), "utf8");
    assert.match(response, /Recovered from Codex app-server events/u);

    const runEvents = await readFile(
      path.join(laneDir(fixture.projectPath, "lane-a"), "runs", `${finalStatus.runId}.jsonl`),
      "utf8",
    );
    assert.match(runEvents, /agent_response_recovered/u);
    assert.match(runEvents, /step_completed/u);
    assert.match(runEvents, /run_completed/u);
    const workerPidMatch = runEvents.match(/Worker pid (?<pid>\d+)/u);
    assert.ok(workerPidMatch?.groups?.pid);
    recoveredWorkerPid = Number.parseInt(workerPidMatch.groups.pid, 10);
    await waitForValue(
      () => Promise.resolve(processIsLive(recoveredWorkerPid)),
      (live) => live === false,
      "recovered dispatch worker termination",
      5_000,
    );
  } finally {
    if (recoveredWorkerPid && processIsLive(recoveredWorkerPid)) {
      try {
        process.kill(recoveredWorkerPid, "SIGKILL");
      } catch (_error) {
        // Best-effort cleanup for a failed assertion path.
      }
    }
    await cleanupFixture(fixture);
  }
});

test("supervise retargets a completed lane with nextAction and restarts after clean gates", async () => {
  const fixture = await createFixture("clawdad-supervise-restart-");
  try {
    await seedLane(fixture, "lane-a", {
      displayName: "Lane A",
      objective: "Finish lane A.",
      scopeGlobs: ["src/lane-a/**"],
      delegateSessionId: "lane-a-session",
    });
    const nextAction = "Refresh the lane A report and checkpoint the verified result.";
    const latestOutcome = "Patched lane A and verified the focused test target.";
    await writeCompletedLaneStatus(fixture, "lane-a", {
      runId: "lane-a-finished-1",
      nextAction,
      lastOutcomeSummary: latestOutcome,
    });

    const result = await runJsonCommand(fixture, [
      "supervise",
      fixture.projectPath,
      "--lane",
      "lane-a",
      "--once",
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.action, "restart");
    assert.equal(result.started, true);
    assert.equal(result.accepted, true);
    assert.equal(result.status.state, "running");
    assert.equal(result.supervisor.state, "stopped");
    assert.equal(result.supervisor.enabled, false);
    assert.equal(result.supervisor.restartCount, 1);
    assert.equal(result.supervisor.lastConsumedNextAction, nextAction);
    assert.equal(result.gate.lastGateResult.code, "safe_to_continue");
    assert.equal(result.gate.directionCheck.decision, "aligned");
    assert.equal(result.supervisor.lastDirectionCheck.decision, "aligned");

    const config = await readJson(path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-config.json"));
    assert.equal(config.objective, nextAction);
    assert.equal(config.watchtowerReviewMode, "off");
    assert.equal(config.directionCheckMode, "observe");
    const brief = await readFile(path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-brief.md"), "utf8");
    assert.match(brief, /# Supervisor Continuation/u);
    assert.match(brief, /Patched lane A and verified/u);
    assert.match(brief, /Refresh the lane A report/u);

    const delegatePayload = await runJsonCommand(fixture, [
      "delegate",
      fixture.projectPath,
      "--lane",
      "lane-a",
    ]);
    assert.ok(Array.isArray(delegatePayload.supervisorEvents));
    const restartEvent = delegatePayload.supervisorEvents.at(-1);
    assert.equal(restartEvent.type, "supervisor_restarted_lane");
    assert.equal(restartEvent.action, "restart");
    assert.equal(restartEvent.restartCount, 1);
    assert.equal(restartEvent.nextAction, nextAction);

    await waitForValue(
      () => readJson(path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-status.json")),
      (status) => status.state === "completed",
      "supervised lane completion",
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

test("supervise observes direction caution without blocking in observe mode", async () => {
  const fixture = await createFixture("clawdad-supervise-direction-observe-");
  try {
    await seedLane(fixture, "lane-a", {
      displayName: "Lane A",
      objective: "Maintain the lane A report.",
      scopeGlobs: ["src/lane-a/**"],
      delegateSessionId: "lane-a-session",
      directionCheckMode: "observe",
    });
    const repeatedNextAction = "Refresh the lane A report after the next checkpoint.";
    await writeCompletedLaneStatus(fixture, "lane-a", {
      runId: "lane-a-finished-repeat",
      nextAction: repeatedNextAction,
      lastOutcomeSummary: "No progress: still waiting for the next checkpoint.",
    });
    await writeJson(path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-supervisor.json"), {
      version: 1,
      laneId: "lane-a",
      projectPath: fixture.projectPath,
      enabled: false,
      state: "stopped",
      restartCount: 1,
      lastConsumedNextAction: repeatedNextAction,
      lastOutcome: "No progress: still waiting for the next checkpoint.",
    });

    const result = await runJsonCommand(fixture, [
      "supervise",
      fixture.projectPath,
      "--lane",
      "lane-a",
      "--once",
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.started, true);
    assert.equal(result.gate.directionCheck.mode, "observe");
    assert.equal(result.gate.directionCheck.decision, "caution");
    assert.match(result.gate.directionCheck.reason, /repeats|waiting|little progress/u);
    assert.equal(result.supervisor.lastDirectionCheck.decision, "caution");
  } finally {
    await cleanupFixture(fixture);
  }
});

test("supervise enforces direction pause before widening against the handoff", async () => {
  const fixture = await createFixture("clawdad-supervise-direction-enforce-");
  try {
    await seedLane(fixture, "lane-a", {
      displayName: "Lane A",
      objective: "Hold the standing handoff and do not widen.",
      scopeGlobs: ["src/lane-a/**"],
      delegateSessionId: "lane-a-session",
      directionCheckMode: "enforce",
    });
    await writeFile(
      path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-brief.md"),
      "# North Star\n\nHold the standing handoff. Do not widen until the boundary fires.\n",
      "utf8",
    );
    await writeCompletedLaneStatus(fixture, "lane-a", {
      runId: "lane-a-finished-widen",
      nextAction: "Expand into a new feature implementation and broaden the lane.",
      lastOutcomeSummary: "Standing handoff says do not widen until the boundary fires.",
    });

    const result = await runServerCommand(fixture, [
      "supervise",
      fixture.projectPath,
      "--lane",
      "lane-a",
      "--once",
    ]);

    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.action, "blocked");
    assert.equal(payload.started, false);
    assert.equal(payload.gate.code, "direction_check");
    assert.equal(payload.gate.directionCheck.mode, "enforce");
    assert.equal(payload.gate.directionCheck.decision, "pause");
    assert.match(payload.error, /widens work/u);
    assert.equal(payload.supervisor.state, "blocked");
    assert.equal(payload.supervisor.lastDirectionCheck.decision, "pause");

    const status = await readJson(path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-status.json"));
    assert.equal(status.runId, "lane-a-finished-widen");
    assert.equal(status.state, "completed");
  } finally {
    await cleanupFixture(fixture);
  }
});

test("delegate supervise API previews launch checks without starting the worker", async () => {
  const fixture = await createFixture("clawdad-supervise-api-preview-");
  try {
    await seedLane(fixture, "lane-a", {
      displayName: "Lane A",
      objective: "Finish lane A.",
      scopeGlobs: ["src/lane-a/**"],
      delegateSessionId: "lane-a-session",
    });
    const nextAction = "Refresh the lane A report and checkpoint the verified result.";
    await writeCompletedLaneStatus(fixture, "lane-a", {
      runId: "lane-a-finished-preview",
      nextAction,
      lastOutcomeSummary: "Patched lane A and verified the focused test target.",
    });

    const { child, baseUrl, headers } = await startApiServer(fixture);
    try {
      const response = await fetch(`${baseUrl}/v1/delegate/supervise`, {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          project: fixture.projectPath,
          lane: "lane-a",
          action: "preview",
        }),
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.previewOk, true);
      assert.equal(payload.supervisorPreview.action, "dry_run");
      assert.equal(payload.supervisorPreview.started, false);
      assert.equal(payload.supervisorPreview.gate.code, "ok");
      assert.equal(payload.supervisorPreview.gate.lastGateResult.code, "safe_to_continue");
      assert.equal(payload.supervisorPreview.supervisor.lastConsumedNextAction, nextAction);
    } finally {
      await stopServer(child);
    }

    const status = await readJson(path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-status.json"));
    assert.equal(status.runId, "lane-a-finished-preview");
    assert.equal(status.state, "completed");
    const config = await readJson(path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-config.json"));
    assert.equal(config.objective, "Finish lane A.");
  } finally {
    await cleanupFixture(fixture);
  }
});

test("delegate supervise API returns preview blockers as checklist data", async () => {
  const fixture = await createFixture("clawdad-supervise-api-blocker-");
  try {
    await seedLane(fixture, "lane-a", {
      displayName: "Lane A",
      objective: "Finish lane A.",
      scopeGlobs: ["src/lane-a/**"],
      delegateSessionId: "lane-a-session",
    });
    await writeCompletedLaneStatus(fixture, "lane-a", {
      runId: "lane-a-finished-blocked-preview",
      nextAction: "Refresh lane A after the checkpoint lands cleanly.",
    });

    const { child, baseUrl, headers } = await startApiServer(fixture, { ORP_SCENARIO: "hygiene_block" });
    try {
      const response = await fetch(`${baseUrl}/v1/delegate/supervise`, {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          project: fixture.projectPath,
          lane: "lane-a",
          action: "preview",
        }),
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.previewOk, false);
      assert.equal(payload.supervisorPreview.action, "blocked");
      assert.equal(payload.supervisorPreview.started, false);
      assert.equal(payload.supervisorPreview.gate.code, "hygiene");
      assert.match(payload.supervisorPreview.error, /Classify dirty paths/u);
    } finally {
      await stopServer(child);
    }

    const status = await readJson(path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-status.json"));
    assert.equal(status.runId, "lane-a-finished-blocked-preview");
    assert.equal(status.state, "completed");
  } finally {
    await cleanupFixture(fixture);
  }
});

test("supervise waits on a running lane and does not duplicate the worker run", async () => {
  const fixture = await createFixture("clawdad-supervise-running-");
  try {
    await seedLane(fixture, "lane-a", {
      displayName: "Lane A",
      objective: "Finish lane A.",
      scopeGlobs: ["src/lane-a/**"],
      delegateSessionId: "lane-a-session",
    });
    await writeJson(path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-status.json"), {
      version: 1,
      laneId: "lane-a",
      state: "running",
      runId: "lane-a-live-run",
      startedAt: "2026-04-27T13:00:00.000Z",
      completedAt: null,
      delegateSessionId: "lane-a-session",
      delegateSessionLabel: "Lane A",
      stepCount: 1,
      maxSteps: 1,
      activeRequestId: "lane-a-request-live",
      activeStep: 2,
      lastRequestId: "lane-a-request-live",
      supervisorPid: process.pid,
      pauseRequested: false,
      error: "",
    });

    const result = await runJsonCommand(fixture, [
      "supervise",
      fixture.projectPath,
      "--lane",
      "lane-a",
      "--once",
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.action, "wait");
    assert.equal(result.started, false);
    assert.equal(result.status.runId, "lane-a-live-run");
    assert.equal(result.supervisor.restartCount, 0);
    const status = await readJson(path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-status.json"));
    assert.equal(status.runId, "lane-a-live-run");
  } finally {
    await cleanupFixture(fixture);
  }
});

test("supervise stops cleanly when a completed lane has no nextAction", async () => {
  const fixture = await createFixture("clawdad-supervise-no-next-");
  try {
    await seedLane(fixture, "lane-a", {
      displayName: "Lane A",
      objective: "Finish lane A.",
      scopeGlobs: ["src/lane-a/**"],
      delegateSessionId: "lane-a-session",
    });
    await writeCompletedLaneStatus(fixture, "lane-a", {
      runId: "lane-a-finished-no-next",
      nextAction: "",
      lastOutcomeSummary: "Lane A is complete.",
    });

    const result = await runJsonCommand(fixture, [
      "supervise",
      fixture.projectPath,
      "--lane",
      "lane-a",
      "--once",
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.action, "completed");
    assert.equal(result.started, false);
    assert.equal(result.supervisor.state, "completed");
    assert.equal(result.supervisor.enabled, false);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("supervise blocks dirty_unclassified ORP hygiene and does not restart", async () => {
  const fixture = await createFixture("clawdad-supervise-dirty-");
  try {
    await seedLane(fixture, "lane-a", {
      displayName: "Lane A",
      objective: "Finish lane A.",
      scopeGlobs: ["src/lane-a/**"],
      delegateSessionId: "lane-a-session",
    });
    await writeCompletedLaneStatus(fixture, "lane-a", {
      runId: "lane-a-finished-dirty",
      nextAction: "Refresh lane A after the checkpoint lands cleanly.",
    });

    const result = await runServerCommand(
      fixture,
      [
        "supervise",
        fixture.projectPath,
        "--lane",
        "lane-a",
        "--once",
      ],
      { env: { ORP_SCENARIO: "hygiene_block" } },
    );
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.action, "blocked");
    assert.equal(payload.started, false);
    assert.equal(payload.supervisor.state, "blocked");
    assert.match(payload.error, /Classify dirty paths/u);

    const status = await readJson(path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-status.json"));
    assert.equal(status.runId, "lane-a-finished-dirty");
    assert.equal(status.state, "completed");
  } finally {
    await cleanupFixture(fixture);
  }
});

test("supervise blocks compute reserve pressure and does not restart", async () => {
  const fixture = await createFixture("clawdad-supervise-compute-");
  try {
    await seedLane(fixture, "lane-a", {
      displayName: "Lane A",
      objective: "Finish lane A.",
      scopeGlobs: ["src/lane-a/**"],
      delegateSessionId: "lane-a-session",
    });
    await writeCompletedLaneStatus(fixture, "lane-a", {
      runId: "lane-a-finished-compute",
      nextAction: "Refresh lane A after the checkpoint lands cleanly.",
    });
    await writeTightComputeTelemetry(fixture);

    const result = await runServerCommand(fixture, [
      "supervise",
      fixture.projectPath,
      "--lane",
      "lane-a",
      "--once",
    ]);
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.action, "blocked");
    assert.equal(payload.started, false);
    assert.equal(payload.gate.code, "compute_limit");
    assert.equal(payload.supervisor.state, "blocked");

    const status = await readJson(path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-status.json"));
    assert.equal(status.runId, "lane-a-finished-compute");
    assert.equal(status.state, "completed");
  } finally {
    await cleanupFixture(fixture);
  }
});

test("delegate-run remains bounded and does not enable continuity supervisor", async () => {
  const fixture = await createFixture("clawdad-delegate-run-bounded-");
  try {
    await seedLane(fixture, "lane-a", {
      displayName: "Lane A",
      objective: "Finish lane A.",
      scopeGlobs: ["src/lane-a/**"],
      delegateSessionId: "lane-a-session",
    });

    const started = await runJsonCommand(fixture, [
      "delegate-run",
      fixture.projectPath,
      "--lane",
      "lane-a",
    ]);
    assert.equal(started.ok, true);
    assert.equal(started.action, "start");
    assert.equal(started.accepted, true);
    assert.equal(started.config.watchtowerReviewMode, "off");
    assert.equal(started.supervisor.state, "stopped");
    assert.equal(started.supervisor.restartCount, 0);

    const finalStatus = await waitForValue(
      () => readJson(path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-status.json")),
      (status) => status.state === "completed",
      "bounded delegate-run completion",
    );
    assert.equal(finalStatus.stepCount, 1);
    assert.match(finalStatus.nextAction, /archive lane-a lane result/u);
    const supervisor = await readJson(path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-supervisor.json"));
    assert.equal(supervisor.state, "stopped");
    assert.equal(supervisor.restartCount, 0);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("delegate-run passes a Codex thread goal and mirrors terminal goal status", async () => {
  const fixture = await createFixture("clawdad-delegate-codex-goal-");
  try {
    await seedLane(fixture, "lane-a", {
      displayName: "Lane A",
      objective: "Finish lane A with a synced Codex goal.",
      scopeGlobs: ["src/lane-a/**"],
      delegateSessionId: "lane-a-session",
    });
    const envLog = path.join(fixture.root, "dispatch-env.jsonl");

    const started = await runServerCommand(
      fixture,
      ["delegate-run", fixture.projectPath, "--lane", "lane-a"],
      { env: { CLAWDAD_FAKE_DISPATCH_ENV_LOG: envLog } },
    );
    assert.equal(started.exitCode, 0, started.stderr || started.stdout);

    const finalStatus = await waitForValue(
      () => readJson(path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-status.json")),
      (status) => status.state === "completed",
      "codex goal delegate-run completion",
    );
    assert.equal(finalStatus.codexGoal.status, "complete");
    assert.match(finalStatus.codexGoal.objective, /Finish lane A with a synced Codex goal/u);

    const envEntries = (await readFile(envLog, "utf8"))
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    assert.ok(envEntries.some((entry) => entry.goalMode === "auto"));
    assert.ok(envEntries.some((entry) => entry.threadGoalStatus === "active"));
    assert.ok(envEntries.some((entry) => /Clawdad delegate lane goal/u.test(entry.threadGoal)));
    assert.ok(envEntries.some((entry) => /Lane A/u.test(entry.threadGoal)));
    assert.ok(envEntries.some((entry) => /Current brief:/u.test(entry.threadGoal)));
    assert.ok(envEntries.some((entry) => /Cycle: bounded delegate-run step/u.test(entry.threadGoal)));
    assert.ok(envEntries.some((entry) => /Compute reserve: 20%/u.test(entry.threadGoal)));
    assert.ok(envEntries.some((entry) => /Hard boundaries: .*needs human/u.test(entry.threadGoal)));
  } finally {
    await cleanupFixture(fixture);
  }
});

test("delegate-run explains zero compute reserve as exhaustion-or-hard-stop", async () => {
  const fixture = await createFixture("clawdad-zero-reserve-runtime-");
  try {
    await seedLane(fixture, "lane-a", {
      displayName: "Lane A",
      objective: "Finish lane A with zero compute reserve.",
      scopeGlobs: ["src/lane-a/**"],
      delegateSessionId: "lane-a-session",
      computeReservePercent: 0,
    });
    await writeTightComputeTelemetry(fixture);

    const started = await runServerCommand(
      fixture,
      ["delegate-run", fixture.projectPath, "--lane", "lane-a"],
    );
    assert.equal(started.exitCode, 0, started.stderr || started.stdout);

    const finalStatus = await waitForValue(
      () => readJson(path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-status.json")),
      (status) => status.state === "completed",
      "zero reserve delegate-run completion",
    );
    const runEvents = await readFile(
      path.join(laneDir(fixture.projectPath, "lane-a"), "runs", `${finalStatus.runId}.jsonl`),
      "utf8",
    );
    assert.match(runEvents, /reserve is 0%; continue until compute exhaustion or hard stop/u);
    assert.doesNotMatch(runEvents, /0% reserve still protected/u);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("watchtower enforce queues validation repair instead of pausing the delegate", async () => {
  const fixture = await createFixture("clawdad-watchtower-enforce-soft-");
  try {
    await seedLane(fixture, "lane-a", {
      displayName: "Lane A",
      objective: "Finish lane A while repairing validation locally.",
      scopeGlobs: ["src/lane-a/**"],
      delegateSessionId: "lane-a-session",
      watchtowerReviewMode: "enforce",
      maxStepsPerRun: 3,
    });

    const result = await runServerCommand(
      fixture,
      ["delegate-run", fixture.projectPath, "--lane", "lane-a"],
      { env: { CLAWDAD_FAKE_DISPATCH_MODE: "watchtower_validation_soft" } },
    );
    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.config.watchtowerReviewMode, "enforce");

    const finalStatus = await waitForValue(
      () => readJson(path.join(laneDir(fixture.projectPath, "lane-a"), "delegate-status.json")),
      (status) => status.state === "completed",
      "watchtower soft enforcement completion",
      20_000,
    );
    assert.equal(finalStatus.stepCount, 2);
    assert.equal(finalStatus.stopReason, null);

    const eventsText = await readFile(
      path.join(laneDir(fixture.projectPath, "lane-a"), "runs", `${finalStatus.runId}.jsonl`),
      "utf8",
    );
    const events = eventsText
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const corrective = events.find((event) => event.type === "watchtower_corrective_step_queued");
    assert.ok(corrective, eventsText);
    assert.match(corrective.nextAction, /repair failing validation/u);
    assert.equal(events.some((event) => event.type === "run_paused" && event.stopReason === "review_recommended"), false);
  } finally {
    await cleanupFixture(fixture);
  }
});
