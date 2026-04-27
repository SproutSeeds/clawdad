import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = path.join(repoRoot, "lib", "server.mjs");

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
    assert.match(html, /id="projectDelegateButton"/u);
    assert.match(html, /Auto-Claw/u);
    assert.match(html, /id="delegateOverview"/u);
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
