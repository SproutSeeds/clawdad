import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("projects endpoint reads local state without invoking the ORP-backed CLI", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-projects-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "AI-summer-camp");
  const missingProjectPath = path.join(root, "missing-smoke-project");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const invokedPath = path.join(root, "clawdad-invoked");
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

    await assert.rejects(readFile(invokedPath, "utf8"), { code: "ENOENT" });
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
