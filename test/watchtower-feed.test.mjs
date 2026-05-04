import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
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

async function runServer(fixture, args, extraEnv = {}) {
  const env = {
    ...process.env,
    HOME: fixture.home,
    CLAWDAD_HOME: fixture.home,
    CLAWDAD_ORP: fixture.fakeOrp,
    ...extraEnv,
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function holdSqliteWriteLock(dbFile) {
  const child = spawn("sqlite3", ["-batch", dbFile], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.write("PRAGMA busy_timeout=0;\nBEGIN IMMEDIATE;\nSELECT 'locked';\n");
  const startedAt = Date.now();
  while (!stdout.includes("locked")) {
    if (Date.now() - startedAt > 3000) {
      child.kill("SIGKILL");
      throw new Error(`sqlite lock was not acquired: ${stderr || stdout}`);
    }
    await sleep(20);
  }
  return {
    release() {
      child.stdin.write("COMMIT;\n.quit\n");
    },
    kill() {
      child.kill("SIGKILL");
    },
  };
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

    const secondScanResult = await runServer(fixture, ["watchtower", fixture.projectPath, "--once", "--json"]);
    assert.equal(secondScanResult.exitCode, 0, secondScanResult.stderr || secondScanResult.stdout);
    const secondScanPayload = JSON.parse(secondScanResult.stdout);
    assert.equal(secondScanPayload.ok, true);
    assert.equal(secondScanPayload.scan.indexedEvents, 0);
    assert.ok(secondScanPayload.scan.scannedEvents >= 2);
    assert.ok(secondScanPayload.scan.skippedEvents >= 2);

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

test("watchtower waits for transient sqlite writer locks", async () => {
  const fixture = await createFixture("clawdad-watchtower-sqlite-lock-");
  try {
    const firstScanResult = await runServer(fixture, ["watchtower", fixture.projectPath, "--once", "--json"]);
    assert.equal(firstScanResult.exitCode, 0, firstScanResult.stderr || firstScanResult.stdout);
    const dbFile = path.join(fixture.projectPath, ".clawdad", "feed", "watchtower.sqlite");
    const lock = await holdSqliteWriteLock(dbFile);
    try {
      const scanPromise = runServer(
        fixture,
        ["watchtower", fixture.projectPath, "--once", "--json"],
        {
          CLAWDAD_WATCHTOWER_SQLITE_BUSY_TIMEOUT_MS: "3000",
          CLAWDAD_WATCHTOWER_SQLITE_EXEC_TIMEOUT_MS: "8000",
        },
      );
      await sleep(250);
      lock.release();
      const scanResult = await scanPromise;
      assert.equal(scanResult.exitCode, 0, scanResult.stderr || scanResult.stdout);
      const scanPayload = JSON.parse(scanResult.stdout);
      assert.equal(scanPayload.ok, true);
    } finally {
      lock.kill();
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("watchtower ignores paid and credential terms inside guardrail sections", async () => {
  const fixture = await createFixture("clawdad-watchtower-guardrails-");
  try {
    const sourceEventId = "evt-guardrail-brief";
    const paidBlockerEvents = [
      {
        id: sourceEventId,
        at: "2026-04-23T12:01:00Z",
        type: "run_blocked",
        runId: fixture.runId,
        step: 1,
        title: "Delegate blocked",
        state: "blocked",
        stopReason: "paid",
        summary: "The next action is blocked because a paid API entitlement is required.",
      },
    ];
    await writeFile(
      path.join(fixture.projectPath, ".clawdad", "delegate", "runs", `${fixture.runId}.jsonl`),
      `${paidBlockerEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );

    const firstScanResult = await runServer(fixture, ["watchtower", fixture.projectPath, "--once", "--json"]);
    assert.equal(firstScanResult.exitCode, 0, firstScanResult.stderr || firstScanResult.stdout);
    const firstReviewResult = await runServer(fixture, ["feed", "review", fixture.projectPath, "--json"]);
    assert.equal(firstReviewResult.exitCode, 0, firstReviewResult.stderr || firstReviewResult.stdout);
    const firstReviewPayload = JSON.parse(firstReviewResult.stdout);
    assert.ok(firstReviewPayload.cards.some((card) => card.trigger === "paid_data_or_api"));

    const events = [
      {
        id: sourceEventId,
        at: "2026-04-23T12:01:00Z",
        type: "plan_snapshot_saved",
        runId: fixture.runId,
        step: 1,
        title: "Delegate plan snapshot",
        summary: [
          "**Hard Stops**",
          "- Paid service, paid API, remote GPU, or other paid compute is required.",
          "- Credentials, MFA, billing, account decisions, external approval, or another human decision is required.",
          "",
          "**Hard Boundaries**",
          "- Do not perform live order routing.",
          "- Broker credentials stay outside the delegate lane.",
          "",
          "**Next Steps**",
          "1. Continue the local proof packet.",
          "2. Do not spend money or use credentials.",
        ].join("\n"),
      },
    ];
    await writeFile(
      path.join(fixture.projectPath, ".clawdad", "delegate", "runs", `${fixture.runId}.jsonl`),
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );

    const scanResult = await runServer(fixture, ["watchtower", fixture.projectPath, "--once", "--json"]);
    assert.equal(scanResult.exitCode, 0, scanResult.stderr || scanResult.stdout);
    const reviewResult = await runServer(fixture, ["feed", "review", fixture.projectPath, "--json"]);
    assert.equal(reviewResult.exitCode, 0, reviewResult.stderr || reviewResult.stdout);
    const reviewPayload = JSON.parse(reviewResult.stdout);
    const triggers = new Set(reviewPayload.cards.map((card) => card.trigger));
    assert.equal(triggers.has("paid_data_or_api"), false);
    assert.equal(triggers.has("credential_boundary"), false);
    assert.equal(triggers.has("broker_payment_live_order_boundary"), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("watchtower still flags actual paid API blockers outside guardrails", async () => {
  const fixture = await createFixture("clawdad-watchtower-paid-blocker-");
  try {
    const events = [
      {
        id: "evt-paid-blocker",
        at: "2026-04-23T12:01:00Z",
        type: "run_blocked",
        runId: fixture.runId,
        step: 1,
        title: "Delegate blocked",
        state: "blocked",
        stopReason: "paid",
        summary: "The next action is blocked because a paid API entitlement is required.",
      },
    ];
    await writeFile(
      path.join(fixture.projectPath, ".clawdad", "delegate", "runs", `${fixture.runId}.jsonl`),
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );

    const scanResult = await runServer(fixture, ["watchtower", fixture.projectPath, "--once", "--json"]);
    assert.equal(scanResult.exitCode, 0, scanResult.stderr || scanResult.stdout);
    const reviewResult = await runServer(fixture, ["feed", "review", fixture.projectPath, "--json"]);
    assert.equal(reviewResult.exitCode, 0, reviewResult.stderr || reviewResult.stdout);
    const reviewPayload = JSON.parse(reviewResult.stdout);
    const paidCard = reviewPayload.cards.find((card) => card.trigger === "paid_data_or_api");
    assert.ok(paidCard);
    assert.equal(paidCard.reviewStatus, "hard_stop");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("watchtower flags patient-data boundaries as hard stops", async () => {
  const fixture = await createFixture("clawdad-watchtower-patient-data-");
  try {
    const events = [
      {
        id: "evt-patient-data",
        at: "2026-04-23T12:01:00Z",
        type: "agent_response",
        runId: fixture.runId,
        step: 1,
        title: "Boundary finding",
        text: "Found patient data/PHI in a local fixture and stopped for review.",
      },
    ];
    await writeFile(
      path.join(fixture.projectPath, ".clawdad", "delegate", "runs", `${fixture.runId}.jsonl`),
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );

    const scanResult = await runServer(fixture, ["watchtower", fixture.projectPath, "--once", "--json"]);
    assert.equal(scanResult.exitCode, 0, scanResult.stderr || scanResult.stdout);
    const reviewResult = await runServer(fixture, ["feed", "review", fixture.projectPath, "--json"]);
    assert.equal(reviewResult.exitCode, 0, reviewResult.stderr || reviewResult.stdout);
    const reviewPayload = JSON.parse(reviewResult.stdout);
    const card = reviewPayload.cards.find((entry) => entry.trigger === "patient_data_boundary");
    assert.ok(card);
    assert.equal(card.reviewStatus, "hard_stop");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("watchtower current-state output hides stale cards from older runs", async () => {
  const fixture = await createFixture("clawdad-watchtower-current-scope-");
  try {
    const oldRunId = "old-paid-run";
    const events = [
      {
        id: "evt-old-paid-blocker",
        at: "2026-04-22T12:01:00Z",
        type: "run_blocked",
        runId: oldRunId,
        step: 1,
        title: "Old delegate blocked",
        state: "blocked",
        stopReason: "paid",
        summary: "The old lane needed a paid API entitlement.",
      },
    ];
    await writeFile(
      path.join(fixture.projectPath, ".clawdad", "delegate", "runs", `${oldRunId}.jsonl`),
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );

    const scanResult = await runServer(fixture, ["watchtower", fixture.projectPath, "--once", "--json"]);
    assert.equal(scanResult.exitCode, 0, scanResult.stderr || scanResult.stdout);
    const scanPayload = JSON.parse(scanResult.stdout);
    assert.ok(scanPayload.historicalReviewCardCount > 0);
    assert.equal(scanPayload.reviewCards.some((card) => card.runId === oldRunId), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("watchtower flags generic suspicious worktree state and ignores Clawdad runtime files", async () => {
  const fixture = await createFixture("clawdad-watchtower-generic-hygiene-");
  try {
    await writeFile(path.join(fixture.projectPath, "="), "", "utf8");

    const scanResult = await runServer(fixture, ["watchtower", fixture.projectPath, "--once", "--json"]);
    assert.equal(scanResult.exitCode, 0, scanResult.stderr || scanResult.stdout);
    const scanPayload = JSON.parse(scanResult.stdout);
    assert.equal(scanPayload.ok, true);
    assert.equal(scanPayload.scan.filesChanged.some((filePath) => filePath.startsWith(".clawdad/")), false);

    const excludeText = await readFile(path.join(fixture.projectPath, ".git", "info", "exclude"), "utf8");
    assert.match(excludeText, /^\.clawdad\/$/mu);

    const reviewResult = await runServer(fixture, ["feed", "review", fixture.projectPath, "--json"]);
    assert.equal(reviewResult.exitCode, 0, reviewResult.stderr || reviewResult.stdout);
    const reviewPayload = JSON.parse(reviewResult.stdout);
    const triggers = new Set(reviewPayload.cards.map((card) => card.trigger));
    assert.ok(triggers.has("worktree_hygiene_suspicious"));
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
