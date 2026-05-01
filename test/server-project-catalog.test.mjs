import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = path.join(repoRoot, "lib", "server.mjs");
const cliScript = path.join(repoRoot, "bin", "clawdad");
const codexSessionDiscoveryScript = path.join(repoRoot, "lib", "codex-session-discovery.mjs");

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

async function runServerCli(args, { cwd = repoRoot, env = {} } = {}) {
  const child = spawn(process.execPath, [serverScript, ...args], {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  return { exitCode, stdout, stderr };
}

async function runClawdadCli(args, { cwd = repoRoot, env = {} } = {}) {
  const child = spawn(cliScript, args, {
    cwd,
    env: {
      ...process.env,
      CLAWDAD_ROOT: repoRoot,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  return { exitCode, stdout, stderr };
}

async function runCodexSessionDiscovery(args, { cwd = repoRoot, env = {} } = {}) {
  const child = spawn(process.execPath, [codexSessionDiscoveryScript, ...args], {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  return { exitCode, stdout, stderr };
}

async function writeCodexSession(codexHome, projectPath, sessionId, {
  source = "cli",
  timestamp = "2026-04-30T12:00:00.000Z",
} = {}) {
  const sessionDir = path.join(codexHome, "sessions", "2026", "04", "30");
  const sessionFile = path.join(sessionDir, `rollout-2026-04-30T12-00-00-${sessionId}.jsonl`);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    sessionFile,
    [
      JSON.stringify({
        timestamp,
        type: "session_meta",
        payload: {
          id: sessionId,
          timestamp,
          cwd: projectPath,
          source,
        },
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Keep working in this project." }],
        },
      }),
    ].join("\n"),
    "utf8",
  );
  return sessionFile;
}

test("app shell injects a fresh build fingerprint for frontend assets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-app-shell-"));
  const home = path.join(root, "home");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify({ version: 3, projects: {} }, null, 2),
    "utf8",
  );
  await writeFile(mockBinPath, "#!/bin/sh\nexit 1\n", "utf8");
  await chmod(mockBinPath, 0o755);

  const port = await freePort();
  await writeFile(
    configPath,
    JSON.stringify(
      {
        host: "127.0.0.1",
        port,
        authMode: "tailscale",
        allowedUsers: ["tester@example.com"],
      },
      null,
      2,
    ),
    "utf8",
  );

  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const response = await fetch(`${baseUrl}/`, {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.doesNotMatch(html, /__CLAWDAD_APP_BUILD_VALUE__|__CLAWDAD_ASSET_VERSION__/u);
    assert.match(html, /window\.__CLAWDAD_APP_BUILD__ = "[^"]+"/u);
    assert.match(html, /\/app\.js\?v=[^"]+"/u);
    assert.match(html, /\/app\.css\?v=[^"]+"/u);
    assert.match(html, /id="sessionImportButton"[\s\S]*?hidden/u);
    assert.match(html, /id="projectDelegateButton"/u);
    assert.match(html, /Auto-Claw/u);
    assert.match(html, /id="delegateOverview"/u);
    assert.match(html, /id="delegateSupervisorPanel"/u);

    const cssPath = html.match(/href="([^"]*\/app\.css\?v=[^"]+)"/u)?.[1];
    assert.ok(cssPath, "expected app shell to reference versioned app.css");
    const cssResponse = await fetch(new URL(cssPath, baseUrl), {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    assert.equal(cssResponse.status, 200);
    const css = await cssResponse.text();
    assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/u);
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("projects endpoint reads local state without invoking the ORP-backed CLI", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-projects-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "AI-summer-camp");
  const missingProjectPath = path.join(root, "missing-smoke-project");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const invokedPath = path.join(root, "clawdad-invoked");
  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(path.join(projectPath, ".clawdad", "delegate"), { recursive: true });
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
            registered_at: "2026-04-14T00:00:00Z",
            active_session_id: "local-session",
            sessions: {
              "local-session": {
                slug: "AI-summer-camp",
                provider: "codex",
                provider_session_seeded: "false",
                tracked_at: "2026-04-14T00:00:00Z",
                last_selected_at: null,
                dispatch_count: 0,
                last_dispatch: null,
                last_response: null,
                status: "idle",
                local_only: "true",
                orp_error: "ORP notes limit",
              },
            },
          },
          [missingProjectPath]: {
            status: "idle",
            last_dispatch: null,
            last_response: null,
            dispatch_count: 0,
            registered_at: "2026-04-14T00:00:00Z",
            active_session_id: "missing-session",
            sessions: {
              "missing-session": {
                slug: "missing-smoke-project",
                provider: "codex",
                provider_session_seeded: "true",
                tracked_at: "2026-04-14T00:00:00Z",
                last_selected_at: null,
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
    JSON.stringify({ state: "idle", request_id: null, session_id: null }, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(projectPath, ".clawdad", "delegate", "delegate-status.json"),
    JSON.stringify(
      {
        state: "running",
        runId: "delegate-run-1",
        activeStep: 2,
        stepCount: 1,
        updatedAt: "2026-04-14T00:02:00Z",
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    mockBinPath,
    `#!/bin/sh
printf invoked > ${JSON.stringify(invokedPath)}
sleep 10
`,
    "utf8",
  );
  await chmod(mockBinPath, 0o755);

  const port = await freePort();
  await writeFile(
    configPath,
    JSON.stringify(
      {
        host: "127.0.0.1",
        port,
        defaultProject: projectPath,
        authMode: "tailscale",
        allowedUsers: ["tester@example.com"],
      },
      null,
      2,
    ),
    "utf8",
  );

  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderr = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderr.push(chunk));

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}/v1/projects`, {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(response.status, 200, stderr.join(""));
    assert.ok(elapsedMs < 1_000, `expected local catalog response under 1s, got ${elapsedMs}ms`);

    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.defaultProject, projectPath);
    assert.equal(payload.projects.length, 1);
    assert.equal(payload.projects[0].path, projectPath);
    assert.equal(payload.projects[0].activeSession.localOnly, true);
    assert.equal(payload.projects[0].delegateStatus.state, "running");
    assert.equal(payload.projects[0].delegateStatus.live, true);
    assert.equal(payload.projects[0].delegateStatus.runId, "delegate-run-1");
    assert.equal(payload.projects[0].delegateStatus.activeStep, 2);
    assert.equal(Array.isArray(payload.projects[0].delegateLanes), true);
    assert.equal(payload.projects[0].delegateLanes.length, 1);
    assert.equal(payload.projects[0].delegateLanes[0].laneId, "default");
    assert.equal(payload.projects[0].delegateLanes[0].displayName, "Default delegate");
    assert.equal(payload.projects[0].delegateLanes[0].status.runId, "delegate-run-1");

    await assert.rejects(readFile(invokedPath, "utf8"), { code: "ENOENT" });
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("projects endpoint orders sessions by latest provider activity while preserving active selection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-session-order-"));
  const home = path.join(root, "home");
  const codexHome = path.join(root, "codex-home");
  const projectPath = path.join(root, "clawdad");
  const configPath = path.join(root, "server.json");
  const activeSessionId = "019d564e-ec8d-7d80-8303-ed4f17090c35";
  const externallyActiveSessionId = "019d887f-33f0-7692-aef5-8a414c1a14f8";

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
  await mkdir(codexHome, { recursive: true });
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectPath]: {
            status: "idle",
            active_session_id: activeSessionId,
            sessions: {
              [activeSessionId]: {
                slug: "Main-claw",
                provider: "codex",
                provider_session_seeded: "true",
                status: "idle",
                provider_last_activity: "2026-04-30T12:00:00.000Z",
              },
              [externallyActiveSessionId]: {
                slug: "All right, Codex",
                provider: "codex",
                provider_session_seeded: "true",
                status: "idle",
                provider_last_activity: "2026-05-01T02:30:00.000Z",
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
    JSON.stringify({ state: "idle", request_id: null, session_id: activeSessionId }, null, 2),
    "utf8",
  );

  const port = await freePort();
  await writeFile(
    configPath,
    JSON.stringify(
      {
        host: "127.0.0.1",
        port,
        defaultProject: projectPath,
        authMode: "tailscale",
        allowedUsers: ["tester@example.com"],
      },
      null,
      2,
    ),
    "utf8",
  );

  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAWDAD_HOME: home,
      CLAWDAD_CODEX_HOME: codexHome,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const response = await fetch(`${baseUrl}/v1/projects`, {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    const project = payload.projects[0];
    assert.equal(project.activeSessionId, activeSessionId);
    assert.equal(project.activeSession.sessionId, activeSessionId);
    assert.equal(project.sessions[0].sessionId, externallyActiveSessionId);
    assert.equal(project.sessions[0].lastActivityAt, "2026-05-01T02:30:00.000Z");
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI sessions command falls back to local state when ORP emits malformed JSON", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-cli-local-state-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "fractal-research-group");
  const mockOrpPath = path.join(root, "orp-mock");

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectPath]: {
            status: "failed",
            active_session_id: "019d57e8-8947-7dd1-ba76-55a23c4e6292",
            sessions: {
              "019d57e8-8947-7dd1-ba76-55a23c4e6292": {
                slug: "Fractal Research Group",
                provider: "codex",
                provider_session_seeded: "true",
                status: "failed",
                local_only: "true",
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
  await writeFile(mockOrpPath, "#!/bin/sh\nprintf '{malformed json'\n", "utf8");
  await chmod(mockOrpPath, 0o755);

  try {
    const result = await runClawdadCli(["sessions", "fractal-research-group", "--json"], {
      env: {
        CLAWDAD_HOME: home,
        CLAWDAD_ORP: mockOrpPath,
      },
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /parse error/u);
    const sessions = JSON.parse(result.stdout);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].sessionId, "019d57e8-8947-7dd1-ba76-55a23c4e6292");
    assert.equal(sessions[0].active, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex session discovery ranks externally touched transcripts before newer created sessions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-codex-session-activity-"));
  const codexHome = path.join(root, "codex-home");
  const projectPath = path.join(root, "clawdad");
  const olderActiveSessionId = "019d564e-ec8d-7d80-8303-ed4f17090c35";
  const newerInactiveSessionId = "019d882d-3772-70f2-8287-a2d4b014197d";

  await mkdir(projectPath, { recursive: true });
  const olderFile = await writeCodexSession(codexHome, projectPath, olderActiveSessionId, {
    timestamp: "2026-04-01T12:00:00.000Z",
  });
  const newerFile = await writeCodexSession(codexHome, projectPath, newerInactiveSessionId, {
    timestamp: "2026-04-30T12:00:00.000Z",
  });
  await utimes(newerFile, new Date("2026-04-30T12:00:00.000Z"), new Date("2026-04-30T12:00:00.000Z"));
  await utimes(olderFile, new Date("2026-05-01T02:30:00.000Z"), new Date("2026-05-01T02:30:00.000Z"));

  try {
    const result = await runCodexSessionDiscovery([
      "--cwd",
      projectPath,
      "--codex-home",
      codexHome,
      "--list",
      "--limit",
      "2",
    ]);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.sessions[0].sessionId, olderActiveSessionId);
    assert.equal(payload.sessions[0].lastUpdatedAt, "2026-05-01T02:30:00.000Z");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("projects endpoint hides quarantined sessions from the app catalog", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-quarantine-catalog-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "AI-summer-camp");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectPath]: {
            status: "failed",
            active_session_id: "bad-session",
            quarantined_sessions: {
              "bad-session": {
                slug: "Stale Delegate",
                provider: "codex",
                reason: "stale_delegate_dispatch",
                detail: "No live progress.",
                quarantined_at: "2026-04-30T08:00:00Z",
              },
            },
            sessions: {
              "bad-session": {
                slug: "Stale Delegate",
                provider: "codex",
                status: "failed",
                local_only: "false",
                quarantined: "true",
              },
              "good-session": {
                slug: "AI-summer-camp",
                provider: "codex",
                status: "completed",
                dispatch_count: 1,
                last_dispatch: "2026-04-30T07:00:00Z",
                last_response: "2026-04-30T07:01:00Z",
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
    path.join(projectPath, ".clawdad", "mailbox", "status.json"),
    JSON.stringify({ state: "idle", request_id: null, session_id: "good-session" }, null, 2),
    "utf8",
  );
  await writeFile(mockBinPath, "#!/bin/sh\nexit 1\n", "utf8");
  await chmod(mockBinPath, 0o755);

  const port = await freePort();
  await writeFile(
    configPath,
    JSON.stringify(
      {
        host: "127.0.0.1",
        port,
        defaultProject: projectPath,
        authMode: "tailscale",
        allowedUsers: ["tester@example.com"],
      },
      null,
      2,
    ),
    "utf8",
  );

  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const response = await fetch(`${baseUrl}/v1/projects`, {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.projects.length, 1);
    assert.deepEqual(payload.projects[0].sessions.map((session) => session.sessionId), ["good-session"]);
    assert.equal(payload.projects[0].activeSessionId, "good-session");
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("sessions-doctor repairs quarantined pointers and orphaned delegate lanes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-sessions-doctor-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "life-ops");
  const defaultDelegateDir = path.join(projectPath, ".clawdad", "delegate");
  const staleLaneDir = path.join(defaultDelegateDir, "lanes", "stale-lane");
  await mkdir(defaultDelegateDir, { recursive: true });
  await mkdir(staleLaneDir, { recursive: true });
  await mkdir(home, { recursive: true });

  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectPath]: {
            status: "failed",
            active_session_id: "bad-session",
            quarantined_sessions: {
              "bad-session": {
                slug: "Delegate",
                provider: "codex",
                reason: "stale_delegate_dispatch",
                detail: "No live progress.",
                quarantined_at: "2026-04-30T08:00:00Z",
              },
            },
            sessions: {
              "bad-session": {
                slug: "Delegate",
                provider: "codex",
                status: "failed",
                quarantined: "true",
              },
              "good-session": {
                slug: "life-ops",
                provider: "codex",
                provider_session_seeded: "false",
                status: "completed",
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
    path.join(defaultDelegateDir, "delegate-config.json"),
    JSON.stringify(
      {
        version: 2,
        projectPath,
        laneId: "default",
        enabled: true,
        delegateSessionId: "bad-session",
        delegateSessionSlug: "Delegate",
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    path.join(defaultDelegateDir, "delegate-status.json"),
    JSON.stringify(
      {
        version: 1,
        projectPath,
        laneId: "default",
        state: "failed",
        runId: "run-default",
        activeRequestId: "request-stale",
        activeStep: 2,
        lastRequestId: null,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    path.join(staleLaneDir, "delegate-status.json"),
    JSON.stringify(
      {
        version: 1,
        projectPath,
        laneId: "stale-lane",
        state: "running",
        runId: "run-stale-lane",
        supervisorPid: 999999,
        activeRequestId: "request-orphaned",
        activeStep: 3,
      },
      null,
      2,
    ),
    "utf8",
  );

  try {
    const result = await runServerCli([
      "sessions-doctor",
      projectPath,
      "--repair",
      "--json",
    ], {
      env: {
        CLAWDAD_HOME: home,
      },
    });
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.projectCount, 1);
    assert.equal(payload.unresolvedIssueCount, 0);
    assert.ok(payload.issueCount >= 3);
    assert.ok(payload.repairCount >= 3);

    const state = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
    assert.equal(state.projects[projectPath].active_session_id, "good-session");

    const repairedConfig = JSON.parse(
      await readFile(path.join(defaultDelegateDir, "delegate-config.json"), "utf8"),
    );
    assert.equal(repairedConfig.enabled, false);
    assert.equal(repairedConfig.delegateSessionId, null);

    const repairedDefaultStatus = JSON.parse(
      await readFile(path.join(defaultDelegateDir, "delegate-status.json"), "utf8"),
    );
    assert.equal(repairedDefaultStatus.state, "failed");
    assert.equal(repairedDefaultStatus.activeRequestId, null);
    assert.equal(repairedDefaultStatus.activeStep, null);
    assert.equal(repairedDefaultStatus.lastRequestId, "request-stale");

    const repairedLaneStatus = JSON.parse(
      await readFile(path.join(staleLaneDir, "delegate-status.json"), "utf8"),
    );
    assert.equal(repairedLaneStatus.state, "failed");
    assert.equal(repairedLaneStatus.activeRequestId, null);
    assert.equal(repairedLaneStatus.activeStep, null);

    const cleanResult = await runServerCli([
      "sessions-doctor",
      projectPath,
      "--json",
    ], {
      env: {
        CLAWDAD_HOME: home,
      },
    });
    assert.equal(cleanResult.exitCode, 0, cleanResult.stderr);
    const cleanPayload = JSON.parse(cleanResult.stdout);
    assert.equal(cleanPayload.ok, true);
    assert.equal(cleanPayload.issueCount, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sessions-doctor flags and repairs a failed active session without quarantining a valid binding", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-active-failed-doctor-"));
  const home = path.join(root, "home");
  const codexHome = path.join(root, "codex-home");
  const projectPath = path.join(root, "fractal-research-group");
  const sessionId = "019d57e8-8947-7dd1-ba76-55a23c4e6292";

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeCodexSession(codexHome, projectPath, sessionId);
  await writeFile(
    path.join(projectPath, ".clawdad", "mailbox", "status.json"),
    JSON.stringify(
      {
        state: "failed",
        request_id: "request-timeout",
        session_id: sessionId,
        dispatched_at: "2026-05-01T00:03:42Z",
        completed_at: "2026-05-01T00:33:48Z",
        error: "codex turn did not complete within 1800s",
        pid: null,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectPath]: {
            status: "failed",
            active_session_id: sessionId,
            last_response: "2026-05-01T00:33:48Z",
            sessions: {
              [sessionId]: {
                slug: "Fractal Research Group",
                provider: "codex",
                provider_session_seeded: "true",
                status: "failed",
                last_response: "2026-05-01T00:33:48Z",
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

  try {
    const audit = await runServerCli([
      "sessions-doctor",
      projectPath,
      "--json",
    ], {
      env: {
        CLAWDAD_HOME: home,
        CLAWDAD_CODEX_HOME: codexHome,
      },
    });
    assert.equal(audit.exitCode, 1, audit.stderr);
    const auditPayload = JSON.parse(audit.stdout);
    assert.equal(auditPayload.projects[0].issues[0].type, "active_session_failed");
    assert.equal(auditPayload.projects[0].sessions[0].quarantined, false);

    const repair = await runServerCli([
      "sessions-doctor",
      projectPath,
      "--repair",
      "--json",
    ], {
      env: {
        CLAWDAD_HOME: home,
        CLAWDAD_CODEX_HOME: codexHome,
      },
    });
    assert.equal(repair.exitCode, 0, repair.stderr);
    const repairPayload = JSON.parse(repair.stdout);
    assert.equal(repairPayload.ok, true);
    assert.equal(repairPayload.projects[0].repairs[0].type, "active_failed_session_reset");
    assert.equal(repairPayload.projects[0].sessions[0].status, "idle");

    const state = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
    assert.equal(state.projects[projectPath].active_session_id, sessionId);
    assert.equal(state.projects[projectPath].sessions[sessionId].status, "idle");
    assert.equal(state.projects[projectPath].quarantined_sessions, undefined);
    const mailboxStatus = JSON.parse(
      await readFile(path.join(projectPath, ".clawdad", "mailbox", "status.json"), "utf8"),
    );
    assert.equal(mailboxStatus.state, "idle");
    assert.equal(mailboxStatus.request_id, null);
    assert.equal(mailboxStatus.error, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sessions-doctor repairs a stale failed mailbox for an otherwise idle active session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-stale-failed-mailbox-"));
  const home = path.join(root, "home");
  const codexHome = path.join(root, "codex-home");
  const projectPath = path.join(root, "fractal-research-group");
  const sessionId = "019d57e8-8947-7dd1-ba76-55a23c4e6292";

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeCodexSession(codexHome, projectPath, sessionId);
  await writeFile(
    path.join(projectPath, ".clawdad", "mailbox", "status.json"),
    JSON.stringify(
      {
        state: "failed",
        request_id: "request-timeout",
        session_id: sessionId,
        dispatched_at: "2026-05-01T00:03:42Z",
        completed_at: "2026-05-01T00:33:48Z",
        error: "codex turn did not complete within 1800s",
        pid: null,
      },
      null,
      2,
    ),
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
            active_session_id: sessionId,
            sessions: {
              [sessionId]: {
                slug: "Fractal Research Group",
                provider: "codex",
                provider_session_seeded: "true",
                status: "idle",
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

  try {
    const audit = await runServerCli([
      "sessions-doctor",
      projectPath,
      "--json",
    ], {
      env: {
        CLAWDAD_HOME: home,
        CLAWDAD_CODEX_HOME: codexHome,
      },
    });
    assert.equal(audit.exitCode, 1, audit.stderr);
    const auditPayload = JSON.parse(audit.stdout);
    assert.equal(auditPayload.projects[0].issues[0].type, "stale_failed_mailbox");

    const repair = await runServerCli([
      "sessions-doctor",
      projectPath,
      "--repair",
      "--json",
    ], {
      env: {
        CLAWDAD_HOME: home,
        CLAWDAD_CODEX_HOME: codexHome,
      },
    });
    assert.equal(repair.exitCode, 0, repair.stderr);
    const repairPayload = JSON.parse(repair.stdout);
    assert.equal(repairPayload.projects[0].repairs[0].type, "stale_failed_mailbox_reset");

    const mailboxStatus = JSON.parse(
      await readFile(path.join(projectPath, ".clawdad", "mailbox", "status.json"), "utf8"),
    );
    assert.equal(mailboxStatus.state, "idle");
    assert.equal(mailboxStatus.request_id, null);
    assert.equal(mailboxStatus.error, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sessions-doctor quarantines Codex sessions that do not belong to the project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-session-binding-doctor-"));
  const home = path.join(root, "home");
  const codexHome = path.join(root, "codex-home");
  const projectPath = path.join(root, "nvidia");
  const otherProjectPath = path.join(root, "cairn");
  const goodSessionId = "019d7a52-13ef-7e21-9432-a0d3303a9641";
  const wrongCwdSessionId = "019d8bcc-8a39-7531-adf9-69a63a7d7f02";
  const placeholderSessionId = "placeholder-session";

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(otherProjectPath, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeCodexSession(codexHome, projectPath, goodSessionId);
  await writeCodexSession(codexHome, otherProjectPath, wrongCwdSessionId);
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectPath]: {
            status: "idle",
            active_session_id: wrongCwdSessionId,
            sessions: {
              [goodSessionId]: {
                slug: "NVIDIA good",
                provider: "codex",
                provider_session_seeded: "true",
                status: "idle",
              },
              [wrongCwdSessionId]: {
                slug: "Cairn copied id",
                provider: "codex",
                provider_session_seeded: "true",
                status: "idle",
              },
              [placeholderSessionId]: {
                slug: "Fresh placeholder",
                provider: "codex",
                provider_session_seeded: "false",
                status: "idle",
              },
              "title-not-id": {
                slug: "Title accidentally saved as an id",
                provider: "",
                provider_session_seeded: "true",
                status: "idle",
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

  try {
    const audit = await runServerCli([
      "sessions-doctor",
      projectPath,
      "--json",
    ], {
      env: {
        CLAWDAD_HOME: home,
        CLAWDAD_CODEX_HOME: codexHome,
      },
    });
    assert.equal(audit.exitCode, 1, audit.stderr);
    const auditPayload = JSON.parse(audit.stdout);
    assert.equal(auditPayload.ok, false);
    const issueTypes = auditPayload.projects[0].issues.map((issue) => issue.type).sort();
    assert.deepEqual(issueTypes, ["codex_session_unbound", "session_provider_missing"]);

    const repair = await runServerCli([
      "sessions-doctor",
      projectPath,
      "--repair",
      "--json",
    ], {
      env: {
        CLAWDAD_HOME: home,
        CLAWDAD_CODEX_HOME: codexHome,
      },
    });
    assert.equal(repair.exitCode, 0, repair.stderr);
    const repairPayload = JSON.parse(repair.stdout);
    assert.equal(repairPayload.ok, true);
    assert.equal(repairPayload.unresolvedIssueCount, 0);

    const state = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
    const projectState = state.projects[projectPath];
    assert.equal(projectState.active_session_id, goodSessionId);
    assert.equal(
      projectState.quarantined_sessions[wrongCwdSessionId].reason,
      "codex_session_not_found_for_project",
    );
    assert.equal(
      projectState.quarantined_sessions["title-not-id"].reason,
      "missing_session_provider",
    );
    assert.equal(projectState.sessions[placeholderSessionId].quarantined, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dispatch rejects a seeded Codex session whose transcript belongs to another project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-dispatch-binding-"));
  const home = path.join(root, "home");
  const codexHome = path.join(root, "codex-home");
  const projectPath = path.join(root, "nvidia");
  const otherProjectPath = path.join(root, "cairn");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const invokedPath = path.join(root, "clawdad-invoked");
  const sessionId = "019d8bcc-8a39-7531-adf9-69a63a7d7f02";

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(otherProjectPath, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeCodexSession(codexHome, otherProjectPath, sessionId);
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectPath]: {
            status: "idle",
            active_session_id: sessionId,
            sessions: {
              [sessionId]: {
                slug: "NVIDIA copied id",
                provider: "codex",
                provider_session_seeded: "true",
                status: "idle",
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
    JSON.stringify({ state: "idle", request_id: null, session_id: null }, null, 2),
    "utf8",
  );
  await writeFile(
    mockBinPath,
    `#!/bin/sh
printf invoked > ${JSON.stringify(invokedPath)}
exit 0
`,
    "utf8",
  );
  await chmod(mockBinPath, 0o755);

  const port = await freePort();
  await writeFile(
    configPath,
    JSON.stringify(
      {
        host: "127.0.0.1",
        port,
        defaultProject: projectPath,
        authMode: "tailscale",
        allowedUsers: ["tester@example.com"],
      },
      null,
      2,
    ),
    "utf8",
  );

  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAWDAD_HOME: home,
      CLAWDAD_CODEX_HOME: codexHome,
      CLAWDAD_BIN_PATH: mockBinPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const response = await fetch(`${baseUrl}/v1/dispatch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "tailscale-user-login": "tester@example.com",
      },
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        message: "Run the next step.",
      }),
    });
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.reason, "cwd_mismatch");
    assert.match(payload.error, /belongs to/u);
    await assert.rejects(readFile(invokedPath, "utf8"), { code: "ENOENT" });
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("projects and delegate lanes endpoints expose explicit lane metadata with default fallback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-project-lanes-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "research-lab");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(path.join(projectPath, ".clawdad", "delegate", "lanes", "research"), { recursive: true });
  await mkdir(home, { recursive: true });
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
            registered_at: "2026-04-24T00:00:00Z",
            active_session_id: "delegate-session",
            sessions: {
              "delegate-session": {
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
    JSON.stringify({ state: "idle", request_id: null, session_id: "delegate-session" }, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(projectPath, ".clawdad", "delegate", "lanes", "research", "delegate-config.json"),
    JSON.stringify(
      {
        version: 2,
        laneId: "research",
        displayName: "Research lane",
        objective: "Compare the live benchmark cohorts.",
        projectPath,
        enabled: true,
        hardStops: ["needs_human"],
        computeReservePercent: 20,
        createdAt: "2026-04-24T00:00:00Z",
        updatedAt: "2026-04-24T00:00:00Z",
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    path.join(projectPath, ".clawdad", "delegate", "lanes", "research", "delegate-status.json"),
    JSON.stringify(
      {
        version: 1,
        laneId: "research",
        state: "running",
        runId: "lane-run-1",
        activeStep: 3,
        stepCount: 2,
        updatedAt: "2026-04-24T00:02:00Z",
        lastOutcomeSummary: "Benchmarked the first cohort against the control.",
        nextAction: "Run the second cohort and compare deltas.",
        computeBudget: {
          status: "observed",
          usedPercent: 45,
          remainingPercent: 55,
          reservePercent: 20,
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    path.join(projectPath, ".clawdad", "delegate", "lanes", "research", "delegate-run-summaries.json"),
    JSON.stringify(
      {
        version: 1,
        snapshots: [
          {
            runId: "lane-run-1",
            createdAt: "2026-04-24T00:02:00Z",
            summary: "Benchmarked the first cohort against the control.",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(mockBinPath, "#!/bin/sh\nexit 1\n", "utf8");
  await chmod(mockBinPath, 0o755);

  const port = await freePort();
  await writeFile(
    configPath,
    JSON.stringify(
      {
        host: "127.0.0.1",
        port,
        authMode: "tailscale",
        allowedUsers: ["tester@example.com"],
      },
      null,
      2,
    ),
    "utf8",
  );

  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = { "tailscale-user-login": "tester@example.com" };
    await waitForHealth(baseUrl, child);

    const projectsResponse = await fetch(`${baseUrl}/v1/projects`, { headers });
    assert.equal(projectsResponse.status, 200);
    const projectsPayload = await projectsResponse.json();
    assert.equal(projectsPayload.ok, true);
    assert.equal(projectsPayload.projects.length, 1);
    assert.equal(projectsPayload.projects[0].delegateLanes.length, 2);
    assert.equal(projectsPayload.projects[0].delegateLanes[0].laneId, "default");
    assert.equal(projectsPayload.projects[0].delegateLanes[0].displayName, "Default delegate");
    assert.equal(projectsPayload.projects[0].delegateLanes[1].laneId, "research");
    assert.equal(projectsPayload.projects[0].delegateLanes[1].displayName, "Research lane");
    assert.equal(projectsPayload.projects[0].delegateLanes[1].objective, "Compare the live benchmark cohorts.");
    assert.equal(projectsPayload.projects[0].delegateLanes[1].latestOutcome, "Benchmarked the first cohort against the control.");
    assert.equal(projectsPayload.projects[0].delegateLanes[1].nextAction, "Run the second cohort and compare deltas.");
    assert.equal(projectsPayload.projects[0].delegateLanes[1].hygieneState, "ok");
    assert.equal(projectsPayload.projects[0].delegateLanes[1].computeState.status, "observed");
    assert.equal(projectsPayload.projects[0].delegateLanes[1].status.runId, "lane-run-1");

    const lanesResponse = await fetch(
      `${baseUrl}/v1/delegate/lanes?project=${encodeURIComponent(projectPath)}`,
      { headers },
    );
    assert.equal(lanesResponse.status, 200);
    const lanesPayload = await lanesResponse.json();
    assert.equal(lanesPayload.ok, true);
    assert.deepEqual(
      lanesPayload.lanes.map((lane) => lane.laneId),
      ["default", "research"],
    );
    assert.equal(lanesPayload.lanes[1].status.state, "running");
    assert.equal(lanesPayload.lanes[1].nextAction, "Run the second cohort and compare deltas.");
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("projects endpoint does not keep serving a cached busy session after completion", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-project-cache-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "clawdad");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const sessionId = "019d564e-ec8d-7d80-8303-ed4f17090c35";
  const requestId = "busy-cache-request";
  const dispatchedAt = "2026-04-20T16:10:00Z";
  const completedAt = "2026-04-20T16:12:00Z";

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });

  const writeState = async ({ status, lastResponse }) => {
    await writeFile(
      path.join(home, "state.json"),
      JSON.stringify(
        {
          version: 3,
          projects: {
            [projectPath]: {
              status,
              last_dispatch: dispatchedAt,
              last_response: lastResponse,
              dispatch_count: 1,
              registered_at: "2026-04-20T00:00:00Z",
              active_session_id: sessionId,
              sessions: {
                [sessionId]: {
                  slug: "Main-claw",
                  provider: "codex",
                  provider_session_seeded: "true",
                  tracked_at: "2026-04-20T00:00:00Z",
                  dispatch_count: 1,
                  last_dispatch: dispatchedAt,
                  last_response: lastResponse,
                  status,
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
  };

  await writeState({ status: "running", lastResponse: null });
  await writeFile(
    path.join(projectPath, ".clawdad", "mailbox", "status.json"),
    JSON.stringify(
      {
        state: "running",
        request_id: requestId,
        session_id: sessionId,
        dispatched_at: dispatchedAt,
        pid: process.pid,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(mockBinPath, "#!/bin/sh\nexit 1\n", "utf8");
  await chmod(mockBinPath, 0o755);

  const port = await freePort();
  await writeFile(
    configPath,
    JSON.stringify(
      {
        host: "127.0.0.1",
        port,
        defaultProject: projectPath,
        authMode: "tailscale",
        allowedUsers: ["tester@example.com"],
      },
      null,
      2,
    ),
    "utf8",
  );

  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderr = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderr.push(chunk));

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = {
      "tailscale-user-login": "tester@example.com",
    };
    await waitForHealth(baseUrl, child);

    const runningResponse = await fetch(`${baseUrl}/v1/projects`, { headers });
    assert.equal(runningResponse.status, 200, stderr.join(""));
    const runningPayload = await runningResponse.json();
    assert.equal(runningPayload.projects[0].sessions[0].status, "running");

    await writeState({ status: "completed", lastResponse: completedAt });
    await writeFile(
      path.join(projectPath, ".clawdad", "mailbox", "status.json"),
      JSON.stringify(
        {
          state: "completed",
          request_id: requestId,
          session_id: sessionId,
          dispatched_at: dispatchedAt,
          completed_at: completedAt,
          pid: null,
        },
        null,
        2,
      ),
      "utf8",
    );

    const completedResponse = await fetch(`${baseUrl}/v1/projects`, { headers });
    assert.equal(completedResponse.status, 200, stderr.join(""));
    const completedPayload = await completedResponse.json();
    assert.equal(completedPayload.projects[0].sessions[0].status, "completed");
    assert.equal(completedPayload.projects[0].sessions[0].lastResponse, completedAt);
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("status endpoint does not stale-fail a dead child pid during recent heartbeat finalization grace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-stale-grace-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "global-mind");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const sessionId = "019d64ef-0f73-7423-9406-5266d6f7efee";
  const requestId = "45017928-ad44-4a91-a7b4-6d8fb6e2e1dc";
  const now = new Date().toISOString();

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectPath]: {
            status: "running",
            last_dispatch: now,
            last_response: null,
            dispatch_count: 1,
            registered_at: now,
            active_session_id: sessionId,
            sessions: {
              [sessionId]: {
                slug: "main mind",
                provider: "codex",
                provider_session_seeded: "true",
                tracked_at: now,
                dispatch_count: 1,
                last_dispatch: now,
                last_response: null,
                status: "running",
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
    path.join(projectPath, ".clawdad", "mailbox", "status.json"),
    JSON.stringify(
      {
        state: "running",
        request_id: requestId,
        session_id: sessionId,
        dispatched_at: now,
        heartbeat_at: now,
        pid: 999999,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(mockBinPath, "#!/bin/sh\nexit 1\n", "utf8");
  await chmod(mockBinPath, 0o755);

  const port = await freePort();
  await writeFile(
    configPath,
    JSON.stringify(
      {
        host: "127.0.0.1",
        port,
        defaultProject: projectPath,
        authMode: "tailscale",
        allowedUsers: ["tester@example.com"],
      },
      null,
      2,
    ),
    "utf8",
  );

  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
      CLAWDAD_STALE_DISPATCH_DEAD_WORKER_GRACE_MS: "120000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const response = await fetch(
      `${baseUrl}/v1/status?project=${encodeURIComponent(projectPath)}`,
      {
        headers: {
          "tailscale-user-login": "tester@example.com",
        },
      },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.mailboxStatus.state, "running");

    const statusAfter = JSON.parse(
      await readFile(path.join(projectPath, ".clawdad", "mailbox", "status.json"), "utf8"),
    );
    assert.equal(statusAfter.state, "running");
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("read endpoint heals a stale mailbox response from answered history", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-read-heal-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "global-mind");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const sessionId = "019d64ef-0f73-7423-9406-5266d6f7efee";
  const requestId = "45017928-ad44-4a91-a7b4-6d8fb6e2e1dc";
  const sentAt = "2026-04-29T00:00:34Z";
  const answeredAt = "2026-04-29T00:01:15Z";
  const staleText = "Clawdad marked this dispatch failed because it went stale. Dispatch worker 25888 is no longer running.";
  const realAnswer = "Actual Verizon networking answer.";
  const recordFile = path.join(
    projectPath,
    ".clawdad",
    "history",
    "sessions",
    sessionId,
    `20260429T000034Z--${requestId}.json`,
  );

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(path.dirname(recordFile), { recursive: true });
  await mkdir(path.join(projectPath, ".clawdad", "history", "requests"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectPath]: {
            status: "completed",
            last_dispatch: sentAt,
            last_response: answeredAt,
            dispatch_count: 1,
            registered_at: sentAt,
            active_session_id: sessionId,
            sessions: {
              [sessionId]: {
                slug: "main mind",
                provider: "codex",
                provider_session_seeded: "true",
                tracked_at: sentAt,
                dispatch_count: 1,
                last_dispatch: sentAt,
                last_response: answeredAt,
                status: "completed",
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
    path.join(projectPath, ".clawdad", "mailbox", "status.json"),
    JSON.stringify(
      {
        state: "completed",
        request_id: requestId,
        session_id: sessionId,
        dispatched_at: sentAt,
        completed_at: answeredAt,
        heartbeat_at: "2026-04-29T00:01:06Z",
        error: null,
        pid: null,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    path.join(projectPath, ".clawdad", "mailbox", "response.md"),
    [
      `# Response: ${requestId}`,
      "",
      `Completed: ${answeredAt}`,
      `Session: ${sessionId}`,
      "Exit code: 124",
      "",
      "---",
      "",
      staleText,
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(projectPath, ".clawdad", "history", "requests", `${requestId}.json`),
    JSON.stringify({ requestId, sessionId, sentAt, file: recordFile }, null, 2),
    "utf8",
  );
  await writeFile(
    recordFile,
    JSON.stringify(
      {
        requestId,
        projectPath,
        sessionId,
        sessionSlug: "main mind",
        provider: "codex",
        message: "How does Verizon wireless internet affect hosting?",
        sentAt,
        answeredAt,
        status: "answered",
        exitCode: 0,
        response: realAnswer,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(mockBinPath, "#!/bin/sh\nexit 1\n", "utf8");
  await chmod(mockBinPath, 0o755);

  const port = await freePort();
  await writeFile(
    configPath,
    JSON.stringify(
      {
        host: "127.0.0.1",
        port,
        defaultProject: projectPath,
        authMode: "tailscale",
        allowedUsers: ["tester@example.com"],
      },
      null,
      2,
    ),
    "utf8",
  );

  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const response = await fetch(
      `${baseUrl}/v1/read?project=${encodeURIComponent(projectPath)}&raw=1`,
      {
        headers: {
          "tailscale-user-login": "tester@example.com",
        },
      },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.output, realAnswer);

    const healedResponse = await readFile(
      path.join(projectPath, ".clawdad", "mailbox", "response.md"),
      "utf8",
    );
    assert.match(healedResponse, /Actual Verizon networking answer\./u);
    assert.doesNotMatch(healedResponse, /went stale/u);
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("history endpoint merges mirrored requests with provider transcript handoff copies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-history-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "clawdad");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const sessionId = "019d564e-ec8d-7d80-8303-ed4f17090c35";
  const requestId = "ab126c08-6f1b-4da7-9162-6ec5ddb6f034";
  const message = "Please fix the duplicate card.";
  const providerMessage = `${message}\n\n[Clawdad artifact handoff: If you create a deliverable file the user may need to download or share, save it under '${projectPath}/.clawdad/artifacts' using a clear filename.]`;

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(path.join(projectPath, ".clawdad", "history", "sessions", sessionId), { recursive: true });
  await mkdir(path.join(home, ".codex", "sessions", "2026", "04", "16"), { recursive: true });
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectPath]: {
            status: "completed",
            last_dispatch: "2026-04-16T21:54:32Z",
            last_response: "2026-04-16T21:58:11Z",
            dispatch_count: 1,
            registered_at: "2026-04-16T00:00:00Z",
            active_session_id: sessionId,
            sessions: {
              [sessionId]: {
                slug: "Main-claw",
                provider: "codex",
                provider_session_seeded: "true",
                tracked_at: "2026-04-16T00:00:00Z",
                dispatch_count: 1,
                last_dispatch: "2026-04-16T21:54:32Z",
                last_response: "2026-04-16T21:58:11Z",
                status: "completed",
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
    path.join(projectPath, ".clawdad", "mailbox", "status.json"),
    JSON.stringify({ state: "completed", request_id: requestId, session_id: sessionId }, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(
      projectPath,
      ".clawdad",
      "history",
      "sessions",
      sessionId,
      `20260416T215432Z--${requestId}.json`,
    ),
    JSON.stringify(
      {
        requestId,
        projectPath,
        sessionId,
        sessionSlug: "Main-claw",
        provider: "codex",
        message,
        sentAt: "2026-04-16T21:54:32Z",
        answeredAt: "2026-04-16T21:58:11Z",
        status: "answered",
        exitCode: 0,
        response: "Final answer.",
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    path.join(home, ".codex", "sessions", "2026", "04", "16", `rollout-${sessionId}.jsonl`),
    [
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-04-16T21:54:50.724Z",
        payload: {
          type: "message",
          role: "user",
          content: providerMessage,
        },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-04-16T21:58:09.187Z",
        payload: {
          type: "message",
          role: "assistant",
          content: "Working notes.\n\nFinal answer.",
        },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-04-16T22:58:09.187Z",
        payload: {
          type: "message",
          role: "assistant",
          content: "Working notes.\n\nFinal answer.\n\nLate transcript noise.",
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  await writeFile(mockBinPath, "#!/bin/sh\nexit 1\n", "utf8");
  await chmod(mockBinPath, 0o755);

  const port = await freePort();
  await writeFile(
    configPath,
    JSON.stringify(
      {
        host: "127.0.0.1",
        port,
        defaultProject: projectPath,
        authMode: "tailscale",
        allowedUsers: ["tester@example.com"],
      },
      null,
      2,
    ),
    "utf8",
  );

  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderr = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderr.push(chunk));

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const response = await fetch(
      `${baseUrl}/v1/history?project=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}&cursor=0&limit=10`,
      {
        headers: {
          "tailscale-user-login": "tester@example.com",
        },
      },
    );
    assert.equal(response.status, 200, stderr.join(""));
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.total, 1);
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].requestId, requestId);
    assert.equal(payload.items[0].message, message);
    assert.equal(payload.items[0].answeredAt, "2026-04-16T21:58:11Z");
    assert.equal(payload.items[0].response, "Final answer.");
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("import-session registers a local Codex session without invoking the ORP-backed CLI", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-import-"));
  const home = path.join(root, "home");
  const codexHome = path.join(root, "codex-home");
  const projectPath = path.join(root, "AI-summer-camp");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const invokedPath = path.join(root, "clawdad-invoked");
  const importSessionId = "019d8d26-7d4e-75e3-8da3-3c35053079a5";

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(path.join(codexHome, "sessions", "2026", "04", "14"), { recursive: true });
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
            registered_at: "2026-04-14T00:00:00Z",
            active_session_id: "placeholder-session",
            sessions: {
              "placeholder-session": {
                slug: "AI-summer-camp",
                provider: "codex",
                provider_session_seeded: "false",
                tracked_at: "2026-04-14T00:00:00Z",
                last_selected_at: null,
                dispatch_count: 0,
                last_dispatch: null,
                last_response: null,
                status: "idle",
                local_only: "true",
                orp_error: "ORP notes limit",
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
    path.join(codexHome, "sessions", "2026", "04", "14", `${importSessionId}.jsonl`),
    [
      JSON.stringify({
        type: "session_meta",
        timestamp: "2026-04-14T18:00:00.000Z",
        payload: {
          id: importSessionId,
          timestamp: "2026-04-14T18:00:00.000Z",
          cwd: projectPath,
          source: "cli",
        },
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Build the AI summer camp signup plan." }],
        },
      }),
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    mockBinPath,
    `#!/bin/sh
printf invoked > ${JSON.stringify(invokedPath)}
sleep 10
`,
    "utf8",
  );
  await chmod(mockBinPath, 0o755);

  const port = await freePort();
  await writeFile(
    configPath,
    JSON.stringify(
      {
        host: "127.0.0.1",
        port,
        defaultProject: projectPath,
        authMode: "tailscale",
        allowedUsers: ["tester@example.com"],
      },
      null,
      2,
    ),
    "utf8",
  );

  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAWDAD_HOME: home,
      CLAWDAD_CODEX_HOME: codexHome,
      CLAWDAD_BIN_PATH: mockBinPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderr = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderr.push(chunk));

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);

    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}/v1/import-session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "tailscale-user-login": "tester@example.com",
      },
      body: JSON.stringify({
        project: projectPath,
        sessionId: importSessionId,
      }),
    });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(response.status, 201, stderr.join(""));
    assert.ok(elapsedMs < 1_000, `expected local import response under 1s, got ${elapsedMs}ms`);

    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.sessionId, importSessionId);
    assert.equal(payload.projectDetails.activeSessionId, importSessionId);
    assert.equal(payload.projectDetails.activeSession.localOnly, true);
    assert.equal(payload.projectDetails.activeSession.providerSessionSeeded, true);

    const state = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
    assert.equal(state.projects[projectPath].active_session_id, importSessionId);
    assert.equal(state.projects[projectPath].sessions[importSessionId].provider, "codex");
    assert.equal(state.projects[projectPath].sessions[importSessionId].local_only, "true");

    await assert.rejects(readFile(invokedPath, "utf8"), { code: "ENOENT" });
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("projects endpoint auto-registers local Codex sessions for the project dropdown", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-auto-import-"));
  const home = path.join(root, "home");
  const codexHome = path.join(root, "codex-home");
  const projectPath = path.join(root, "fractal-research-group");
  const configPath = path.join(root, "server.json");
  const sessionId = "019d57e8-8947-7dd1-ba76-55a23c4e6292";

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeCodexSession(codexHome, projectPath, sessionId, {
    timestamp: "2026-05-01T00:03:51.000Z",
  });
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
            registered_at: "2026-05-01T00:00:00Z",
            active_session_id: "placeholder-session",
            sessions: {
              "placeholder-session": {
                slug: "fractal-research-group",
                provider: "codex",
                provider_session_seeded: "false",
                tracked_at: "2026-05-01T00:00:00Z",
                last_selected_at: null,
                dispatch_count: 0,
                last_dispatch: null,
                last_response: null,
                status: "idle",
                local_only: "true",
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

  const port = await freePort();
  await writeFile(
    configPath,
    JSON.stringify(
      {
        host: "127.0.0.1",
        port,
        defaultProject: projectPath,
        authMode: "tailscale",
        allowedUsers: ["tester@example.com"],
      },
      null,
      2,
    ),
    "utf8",
  );

  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAWDAD_HOME: home,
      CLAWDAD_CODEX_HOME: codexHome,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}/v1/projects`, {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(response.status, 200);
    assert.ok(elapsedMs < 1_000, `expected projects response not to wait on session discovery, got ${elapsedMs}ms`);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.autoImportScheduled, true);
    assert.equal(payload.autoImportedSessionCount, 0);
    assert.equal(payload.projects[0].sessions.some((session) => session.sessionId === sessionId), false);
    assert.equal(payload.projects[0].activeSessionId, "placeholder-session");

    let state = null;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      state = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
      if (state.projects[projectPath].sessions[sessionId]) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(state.projects[projectPath].sessions[sessionId], "expected background auto-import to register the session");
    assert.equal(state.projects[projectPath].active_session_id, "placeholder-session");
    assert.equal(state.projects[projectPath].sessions[sessionId].provider_session_seeded, "true");
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("existing README-only directories can be selected and registered locally", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-local-create-"));
  const home = path.join(root, "home");
  const projectRoot = path.join(root, "code");
  const trackedProjectPath = path.join(projectRoot, "tracked-project");
  const localProjectPath = path.join(projectRoot, "go-to-market");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const invokedPath = path.join(root, "clawdad-invoked");

  await mkdir(path.join(trackedProjectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(localProjectPath, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(path.join(localProjectPath, "README.md"), "# Go to Market\n", "utf8");
  const canonicalProjectRoot = await realpath(projectRoot);
  const canonicalLocalProjectPath = await realpath(localProjectPath);
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        orp_workspace: "main",
        projects: {
          [trackedProjectPath]: {
            status: "idle",
            last_dispatch: null,
            last_response: null,
            dispatch_count: 0,
            registered_at: "2026-04-14T00:00:00Z",
            active_session_id: "tracked-session",
            sessions: {
              "tracked-session": {
                slug: "tracked-project",
                provider: "codex",
                provider_session_seeded: "false",
                tracked_at: "2026-04-14T00:00:00Z",
                last_selected_at: null,
                dispatch_count: 0,
                last_dispatch: null,
                last_response: null,
                status: "idle",
                local_only: "true",
                orp_error: "ORP notes limit",
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
    mockBinPath,
    `#!/bin/sh
printf invoked > ${JSON.stringify(invokedPath)}
sleep 10
`,
    "utf8",
  );
  await chmod(mockBinPath, 0o755);

  const port = await freePort();
  await writeFile(
    configPath,
    JSON.stringify(
      {
        host: "127.0.0.1",
        port,
        defaultProject: trackedProjectPath,
        authMode: "tailscale",
        allowedUsers: ["tester@example.com"],
        projectRoots: [projectRoot],
      },
      null,
      2,
    ),
    "utf8",
  );

  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderr = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderr.push(chunk));

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);

    const rootsResponse = await fetch(`${baseUrl}/v1/project-roots`, {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    assert.equal(rootsResponse.status, 200, stderr.join(""));
    const rootsPayload = await rootsResponse.json();
    const rootEntry = rootsPayload.roots.find((entry) => entry.path === canonicalProjectRoot);
    assert.ok(rootEntry, "expected configured project root");
    assert.ok(
      rootEntry.repos.some((repo) => repo.path === canonicalLocalProjectPath && repo.name === "go-to-market"),
      "expected README-only go-to-market directory in repo picker",
    );

    const createResponse = await fetch(`${baseUrl}/v1/projects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "tailscale-user-login": "tester@example.com",
      },
      body: JSON.stringify({
        mode: "existing",
        root: projectRoot,
        repoPath: localProjectPath,
        provider: "codex",
      }),
    });
    assert.equal(createResponse.status, 201, stderr.join(""));
    const createPayload = await createResponse.json();
    assert.equal(createPayload.ok, true);
    assert.equal(createPayload.projectPath, canonicalLocalProjectPath);
    assert.equal(createPayload.projectDetails.activeSession.localOnly, true);
    assert.equal(createPayload.projectDetails.activeSession.providerSessionSeeded, false);

    const state = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
    assert.equal(state.projects[canonicalLocalProjectPath].active_session_id, createPayload.sessionId);
    assert.equal(state.projects[canonicalLocalProjectPath].sessions[createPayload.sessionId].provider, "codex");
    assert.equal(state.projects[canonicalLocalProjectPath].sessions[createPayload.sessionId].local_only, "true");
    await assert.rejects(readFile(invokedPath, "utf8"), { code: "ENOENT" });
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});
