import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = path.join(repoRoot, "lib", "server.mjs");
const dispatchQueueWorkerScript = path.join(repoRoot, "lib", "dispatch-queue-worker.mjs");
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

async function waitForFileText(filePath, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error(`file was not written: ${filePath}`);
}

async function waitForDirectoryEmpty(directoryPath, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await readdir(directoryPath).catch(() => [])).length === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`directory did not become empty: ${directoryPath}`);
}

async function waitForFileLines(filePath, count, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await readFile(filePath, "utf8").catch(() => "");
    const lines = text.trim() ? text.trim().split("\n") : [];
    if (lines.length >= count) {
      return lines;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`file did not reach ${count} lines: ${filePath}`);
}

async function stopServer(child) {
  if (child.exitCode != null) {
    return;
  }
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (child.exitCode == null) {
        child.kill("SIGKILL");
      }
      finish();
    }, 2_000);
    child.once("exit", finish);
    if (!child.kill("SIGTERM")) {
      finish();
    }
  });
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function startFakeDumpyServer() {
  const parties = [];
  const items = [];
  let partyIndex = 0;
  let itemIndex = 0;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/api/files") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ parties, items, files: items }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/parties") {
        const body = JSON.parse((await readRequestBody(request)).toString("utf8") || "{}");
        const party = {
          id: `party-${++partyIndex}`,
          kind: "party",
          name: String(body.name || "Dump Party"),
          createdAt: new Date().toISOString(),
          itemCount: 0,
        };
        parties.unshift(party);
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ party }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/files") {
        const body = await readRequestBody(request);
        const partyId = url.searchParams.get("partyId") || "";
        const item = {
          id: `item-${++itemIndex}`,
          kind: "file",
          name: url.searchParams.get("name") || "file",
          relativePath: url.searchParams.get("relativePath") || "",
          partyId,
          size: body.length,
          mimeType: request.headers["content-type"] || "application/octet-stream",
          uploadedAt: new Date().toISOString(),
          href: `/files/item-${itemIndex}`,
        };
        items.unshift(item);
        const party = parties.find((candidate) => candidate.id === partyId);
        if (party) {
          party.itemCount = items.filter((candidate) => candidate.partyId === partyId).length;
        }
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ file: item, item }));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    parties,
    items,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function runServerCli(args, { cwd = repoRoot, env = {} } = {}) {
  const child = spawn(process.execPath, [serverScript, ...args], {
    cwd,
    env: {
      ...process.env,
      CLAWDAD_TTS_ENABLED: "false",
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
      CLAWDAD_TTS_ENABLED: "false",
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
      CLAWDAD_TTS_ENABLED: "false",
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

async function runCommand(command, args, { cwd = repoRoot, env = {} } = {}) {
  const child = spawn(command, args, {
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

async function runGit(cwd, args) {
  return runCommand("git", args, { cwd });
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

test("Node state lock release checks owner token before removing lock directory", async () => {
  const source = await readFile(serverScript, "utf8");
  const start = source.indexOf("async function withStateLock");
  const end = source.indexOf("function sleep", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.ok(end > start);

  const body = source.slice(start, end);
  assert.match(body, /const ownerToken = `\$\{process\.pid\}:\$\{crypto\.randomUUID\(\)\}`;/u);
  assert.match(body, /writeAtomicTextFile\(\s*stateLockOwnerPath\(\),[\s\S]*ownerToken/u);
  assert.match(body, /const currentToken = owner\.trim\(\)\.split\(\/\\s\+\/u\)\[2\] \|\| "";/u);
  assert.match(body, /if \(currentToken === ownerToken\) \{\s*await rm\(stateLockDirPath\(\),/u);
});

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
      CLAWDAD_TTS_ENABLED: "false",
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
    assert.match(response.headers.get("cache-control") || "", /no-store/u);
    const html = await response.text();
    assert.doesNotMatch(html, /__CLAWDAD_APP_BUILD_VALUE__|__CLAWDAD_ASSET_VERSION__/u);
    assert.match(html, /window\.__CLAWDAD_APP_BUILD__ = "[^"]+"/u);
    assert.match(html, /\/app\.js\?v=[^"]+"/u);
    assert.match(html, /\/app\.css\?v=[^"]+"/u);
    assert.doesNotMatch(html, /id="sessionImportButton"/u);
    assert.doesNotMatch(html, /id="projectDelegateButton"/u);
    assert.match(html, /Auto-Claw/u);
    assert.match(html, /id="delegateOverview"/u);
    assert.match(html, /id="delegateSupervisorPanel"/u);
    assert.match(html, /id="quickPromptButton"/u);
    assert.match(html, /id="quickPromptModal"/u);
    assert.match(html, /id="workspaceRootChooseButton"/u);
    assert.match(html, /id="settingsButton"/u);
    assert.match(html, /id="settingsModal"/u);
    assert.match(html, /id="settingsScratchpadInput"/u);
    assert.match(html, /id="settingsScratchpadChooseButton"/u);
    assert.match(html, /id="settingsProjectRootsList"/u);
    assert.match(html, /id="settingsChooseRootButton"/u);
    assert.match(html, /id="directoryBrowserModal"/u);

    const jsPath = html.match(/src="([^"]*\/app\.js\?v=[^"]+)"/u)?.[1];
    assert.ok(jsPath, "expected app shell to reference versioned app.js");
    const jsResponse = await fetch(new URL(jsPath, baseUrl), {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    assert.equal(jsResponse.status, 200);
    assert.match(jsResponse.headers.get("cache-control") || "", /max-age=31536000/u);
    assert.match(jsResponse.headers.get("cache-control") || "", /immutable/u);
    assert.equal(jsResponse.headers.get("pragma"), null);

    const cssPath = html.match(/href="([^"]*\/app\.css\?v=[^"]+)"/u)?.[1];
    assert.ok(cssPath, "expected app shell to reference versioned app.css");
    const cssResponse = await fetch(new URL(cssPath, baseUrl), {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    assert.equal(cssResponse.status, 200);
    assert.match(cssResponse.headers.get("cache-control") || "", /max-age=31536000/u);
    assert.match(cssResponse.headers.get("cache-control") || "", /immutable/u);
    assert.equal(cssResponse.headers.get("pragma"), null);
    const css = await cssResponse.text();
    assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/u);

    const assetResponse = await fetch(`${baseUrl}/assets/clawdad-claw.svg?v=test-cache`, {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    assert.equal(assetResponse.status, 200);
    assert.match(assetResponse.headers.get("cache-control") || "", /max-age=31536000/u);
    assert.match(assetResponse.headers.get("cache-control") || "", /immutable/u);
    assert.equal(assetResponse.headers.get("pragma"), null);

    const healthResponse = await fetch(`${baseUrl}/healthz`, {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    assert.equal(healthResponse.status, 200);
    assert.equal(healthResponse.headers.get("cache-control"), "no-store");
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
      CLAWDAD_TTS_ENABLED: "false",
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

    const leanResponse = await fetch(`${baseUrl}/v1/projects?lean=1`, {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    assert.equal(leanResponse.status, 200);
    const leanPayload = await leanResponse.json();
    assert.equal(leanPayload.catalogLean, true);
    assert.equal(leanPayload.projects[0].delegateStatus.runId, "delegate-run-1");
    assert.deepEqual(leanPayload.projects[0].delegateLanes, []);

    await assert.rejects(readFile(invokedPath, "utf8"), { code: "ENOENT" });
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("session-terminal endpoint opens the tracked Codex resume session with configured launcher", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-terminal-"));
  const home = path.join(root, "home");
  const codexHome = path.join(root, "codex-home");
  const projectPath = path.join(root, "frg-site");
  const configPath = path.join(root, "server.json");
  const launcherPath = path.join(root, "terminal-launcher");
  const capturePath = path.join(root, "terminal-capture.json");
  const sessionId = "019d57e8-8947-7dd1-ba76-55a23c4e6292";

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeCodexSession(codexHome, projectPath, sessionId);
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
            registered_at: "2026-05-05T00:00:00Z",
            active_session_id: sessionId,
            sessions: {
              [sessionId]: {
                slug: "frg-site",
                provider: "codex",
                provider_session_seeded: "true",
                tracked_at: "2026-05-05T00:00:00Z",
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
  await writeFile(
    launcherPath,
    `#!/bin/sh
cat > "$CLAWDAD_TERMINAL_CAPTURE"
`,
    "utf8",
  );
  await chmod(launcherPath, 0o755);

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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_CODEX_HOME: codexHome,
      CLAWDAD_CODEX: "codex-fake",
      CLAWDAD_TERMINAL_LAUNCHER: launcherPath,
      CLAWDAD_TERMINAL_CAPTURE: capturePath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const response = await fetch(`${baseUrl}/v1/session-terminal`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "tailscale-user-login": "tester@example.com",
      },
      body: JSON.stringify({
        project: projectPath,
        sessionId,
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.project, projectPath);
    assert.equal(payload.sessionId, sessionId);
    assert.equal(payload.provider, "codex");
    assert.equal(payload.launcher, "configured");
    assert.equal(payload.launchMode, "resume");

    const launched = JSON.parse(await readFile(capturePath, "utf8"));
    assert.equal(launched.projectPath, projectPath);
    assert.equal(launched.provider, "codex");
    assert.equal(launched.sessionId, sessionId);
    assert.equal(launched.launchMode, "resume");
    assert.equal(
      launched.shellCommand,
      `exec bash -lc 'cd '\\''${projectPath}'\\'' && clear && exec '\\''codex-fake'\\'' '\\''resume'\\'' '\\''${sessionId}'\\'''`,
    );
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("session-terminal opens unsaved Codex placeholders as new project sessions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-terminal-placeholder-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "mtg-decklab");
  const configPath = path.join(root, "server.json");
  const launcherPath = path.join(root, "terminal-launcher");
  const capturePath = path.join(root, "terminal-capture.json");
  const sessionId = "3f47b67e-2a76-4e54-8916-8de4a17fe12c";

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
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
                slug: "mtg-decklab",
                provider: "codex",
                provider_session_seeded: "false",
                tracked_at: "2026-05-03T07:01:12Z",
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
    launcherPath,
    `#!/bin/sh
cat > "$CLAWDAD_TERMINAL_CAPTURE"
`,
    "utf8",
  );
  await chmod(launcherPath, 0o755);

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
        bodyLimitBytes: 65536,
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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_CODEX: "codex-fake",
      CLAWDAD_TERMINAL_LAUNCHER: launcherPath,
      CLAWDAD_TERMINAL_CAPTURE: capturePath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const response = await fetch(`${baseUrl}/v1/session-terminal`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "tailscale-user-login": "tester@example.com",
      },
      body: JSON.stringify({
        project: projectPath,
        sessionId,
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.launchMode, "new");

    const launched = JSON.parse(await readFile(capturePath, "utf8"));
    assert.equal(launched.projectPath, projectPath);
    assert.equal(launched.sessionId, sessionId);
    assert.equal(launched.launchMode, "new");
    assert.equal(
      launched.shellCommand,
      `exec bash -lc 'cd '\\''${projectPath}'\\'' && clear && exec '\\''codex-fake'\\'''`,
    );
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("session-terminal-log endpoint returns paged Codex events for a tracked request", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-terminal-log-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "clawdad");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const sessionId = "019e0000-2222-7000-8000-000000000001";
  const requestId = "terminal-log-request-1";
  const sentAt = "2026-05-06T15:00:00.000Z";
  const recordFile = path.join(
    projectPath,
    ".clawdad",
    "history",
    "sessions",
    sessionId,
    `20260506T150000.000Z--${requestId}.json`,
  );

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(path.dirname(recordFile), { recursive: true });
  await mkdir(path.join(projectPath, ".clawdad", "history", "requests"), { recursive: true });
  await mkdir(path.join(projectPath, ".clawdad", "history", "events"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectPath]: {
            status: "running",
            active_session_id: sessionId,
            sessions: {
              [sessionId]: {
                slug: "Main",
                provider: "codex",
                provider_session_seeded: "true",
                status: "running",
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
        dispatched_at: sentAt,
        heartbeat_at: new Date().toISOString(),
      },
      null,
      2,
    ),
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
        provider: "codex",
        message: "Run the terminal log check.",
        sentAt,
        answeredAt: null,
        status: "queued",
        response: "",
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    path.join(projectPath, ".clawdad", "history", "events", `${requestId}.codex-events.jsonl`),
    [
      JSON.stringify({ at: sentAt, type: "codex_turn_started", method: "turn/started", turnId: "turn-1" }),
      JSON.stringify({
        at: "2026-05-06T15:00:02.000Z",
        type: "codex_agent_message_delta",
        method: "item/agentMessage/delta",
        payload: { delta: "working live" },
      }),
      JSON.stringify({
        at: "2026-05-06T15:00:03.000Z",
        type: "codex_item",
        method: "item/started",
        itemType: "commandExecution",
        status: "in_progress",
        payload: { commandText: "npm test" },
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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = { "tailscale-user-login": "tester@example.com" };
    await waitForHealth(baseUrl, child);
    const firstResponse = await fetch(
      `${baseUrl}/v1/session-terminal-log?project=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}&requestId=${encodeURIComponent(requestId)}&cursor=0&limit=2`,
      { headers },
    );
    assert.equal(firstResponse.status, 200);
    const firstPayload = await firstResponse.json();
    assert.equal(firstPayload.ok, true);
    assert.equal(firstPayload.total, 3);
    assert.equal(firstPayload.nextCursor, "2");
    assert.equal(firstPayload.events.length, 2);
    assert.equal(firstPayload.events[0].label, "Turn started");
    assert.equal(firstPayload.events[1].text, "working live");
    assert.equal(firstPayload.requestStatus.status, "running");
    assert.equal(firstPayload.requestStatus.active, true);

    const secondResponse = await fetch(
      `${baseUrl}/v1/session-terminal-log?project=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}&requestId=${encodeURIComponent(requestId)}&cursor=${encodeURIComponent(firstPayload.nextCursor)}&limit=2`,
      { headers },
    );
    assert.equal(secondResponse.status, 200);
    const secondPayload = await secondResponse.json();
    assert.equal(secondPayload.events.length, 1);
    assert.equal(secondPayload.events[0].label, "Command started");
    assert.equal(secondPayload.events[0].text, "npm test");
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("session-terminal-log returns empty events with completed request status when no log exists", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-terminal-log-empty-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "frg-site");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const sessionId = "019e0000-2222-7000-8000-000000000002";
  const requestId = "terminal-log-missing";
  const sentAt = "2026-05-06T15:10:00.000Z";
  const answeredAt = "2026-05-06T15:11:00.000Z";
  const recordFile = path.join(
    projectPath,
    ".clawdad",
    "history",
    "sessions",
    sessionId,
    `20260506T151000.000Z--${requestId}.json`,
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
            active_session_id: sessionId,
            sessions: {
              [sessionId]: {
                slug: "Main",
                provider: "codex",
                provider_session_seeded: "true",
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
        provider: "codex",
        message: "Return without an event log.",
        sentAt,
        answeredAt,
        status: "answered",
        exitCode: 0,
        response: "Done.",
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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const response = await fetch(
      `${baseUrl}/v1/session-terminal-log?project=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}&requestId=${encodeURIComponent(requestId)}`,
      {
        headers: {
          "tailscale-user-login": "tester@example.com",
        },
      },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.events, []);
    assert.equal(payload.total, 0);
    assert.equal(payload.requestStatus.status, "completed");
    assert.equal(payload.requestStatus.terminal, true);
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("session-terminal-log rejects unsafe ids and wrong project/session bindings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-terminal-log-reject-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "clawdad");
  const otherProjectPath = path.join(root, "other");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const sessionId = "019e0000-2222-7000-8000-000000000003";
  const otherSessionId = "019e0000-2222-7000-8000-000000000004";
  const requestId = "terminal-log-bound";
  const sentAt = "2026-05-06T15:20:00.000Z";
  const recordFile = path.join(
    projectPath,
    ".clawdad",
    "history",
    "sessions",
    sessionId,
    `20260506T152000.000Z--${requestId}.json`,
  );

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(path.join(otherProjectPath, ".clawdad", "mailbox"), { recursive: true });
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
            active_session_id: sessionId,
            sessions: {
              [sessionId]: { slug: "Main", provider: "codex", provider_session_seeded: "true" },
              [otherSessionId]: { slug: "Other", provider: "codex", provider_session_seeded: "true" },
            },
          },
          [otherProjectPath]: {
            status: "idle",
            active_session_id: otherSessionId,
            sessions: {
              [otherSessionId]: { slug: "Other project", provider: "codex", provider_session_seeded: "true" },
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
    path.join(projectPath, ".clawdad", "history", "requests", `${requestId}.json`),
    JSON.stringify({ requestId, sessionId, sentAt, file: recordFile }, null, 2),
    "utf8",
  );
  await writeFile(
    recordFile,
    JSON.stringify({ requestId, projectPath, sessionId, provider: "codex", message: "Bound.", sentAt, status: "answered", response: "Done." }, null, 2),
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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = { "tailscale-user-login": "tester@example.com" };
    await waitForHealth(baseUrl, child);

    const unsafeResponse = await fetch(
      `${baseUrl}/v1/session-terminal-log?project=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}&requestId=${encodeURIComponent("../escape")}`,
      { headers },
    );
    assert.equal(unsafeResponse.status, 400);

    const wrongSessionResponse = await fetch(
      `${baseUrl}/v1/session-terminal-log?project=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(otherSessionId)}&requestId=${encodeURIComponent(requestId)}`,
      { headers },
    );
    assert.equal(wrongSessionResponse.status, 404);

    const wrongProjectResponse = await fetch(
      `${baseUrl}/v1/session-terminal-log?project=${encodeURIComponent(otherProjectPath)}&sessionId=${encodeURIComponent(otherSessionId)}&requestId=${encodeURIComponent(requestId)}`,
      { headers },
    );
    assert.equal(wrongProjectResponse.status, 404);
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("sessions endpoint creates a new local Codex placeholder for the dropdown", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-create-session-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "new-work");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const existingSessionId = "019df736-7a94-71a0-ba01-9b073f8c65bb";

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
            last_response: "2026-05-03T07:33:12Z",
            active_session_id: existingSessionId,
            sessions: {
              [existingSessionId]: {
                slug: "new-work",
                provider: "codex",
                provider_session_seeded: "false",
                tracked_at: "2026-05-03T07:01:12Z",
                last_selected_at: "2026-05-03T07:01:12Z",
                last_response: "2026-05-03T07:33:12Z",
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
  await writeFile(
    path.join(projectPath, ".clawdad", "mailbox", "status.json"),
    JSON.stringify(
      {
        state: "failed",
        request_id: "old-timeout",
        session_id: existingSessionId,
        completed_at: "2026-05-03T07:33:12Z",
        error: "codex turn did not complete within 1800s",
        pid: null,
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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const response = await fetch(`${baseUrl}/v1/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "tailscale-user-login": "tester@example.com",
      },
      body: JSON.stringify({
        project: projectPath,
        provider: "codex",
        model: "gpt-5.6-sol",
        reasoningEffort: "ultra",
      }),
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.project, projectPath);
    assert.equal(payload.provider, "codex");
    assert.equal(payload.model, "gpt-5.6-sol");
    assert.equal(payload.reasoningEffort, "ultra");
    assert.ok(payload.sessionId);
    assert.equal(payload.session.providerSessionSeeded, false);
    assert.equal(payload.session.localOnly, true);
    assert.equal(payload.codexIntegration.ok, true);
    assert.equal(payload.codexIntegration.failCount, 0);
    assert.ok(payload.codexIntegration.operationCount > 0);
    assert.equal(payload.projectDetails.status, "idle");
    assert.equal(payload.projectDetails.activeSessionId, payload.sessionId);
    assert.equal(payload.projectDetails.activeSession.sessionId, payload.sessionId);
    assert.equal(payload.projectDetails.activeSession.status, "idle");
    assert.equal(
      payload.projectDetails.sessions.find((session) => session.sessionId === payload.sessionId).active,
      true,
    );
    assert.equal(
      payload.projectDetails.sessions.find((session) => session.sessionId === existingSessionId).active,
      false,
    );

    const state = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
    assert.equal(state.projects[projectPath].status, "idle");
    assert.equal(state.projects[projectPath].active_session_id, payload.sessionId);
    assert.equal(state.projects[projectPath].sessions[payload.sessionId].provider_session_seeded, "false");
    assert.equal(state.projects[projectPath].sessions[existingSessionId].status, "failed");
    assert.match(
      await readFile(path.join(projectPath, "AGENTS.md"), "utf8"),
      /BEGIN CLAWDAD CODEX INTEGRATION/u,
    );
    assert.match(
      await readFile(path.join(projectPath, ".codex", "config.toml"), "utf8"),
      /hooks = true/u,
    );
    assert.match(
      await readFile(path.join(projectPath, ".codex", "hooks.json"), "utf8"),
      /clawdad-hook\.mjs/u,
    );
    assert.match(
      await readFile(
        path.join(projectPath, ".agents", "skills", "clawdad-incident-triage", "SKILL.md"),
        "utf8",
      ),
      /Clawdad failures/u,
    );
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("Terminal.app launcher sizes readable session windows", async () => {
  const source = await readFile(serverScript, "utf8");
  assert.match(source, /const terminalFontSizePt = boundedPositiveInteger\(process\.env\.CLAWDAD_TERMINAL_FONT_SIZE, 20/u);
  assert.match(source, /const terminalWindowScale = boundedNumber\(process\.env\.CLAWDAD_TERMINAL_WINDOW_SCALE, 0\.85/u);

  const start = source.indexOf("async function launchDarwinTerminal");
  const end = source.indexOf("async function launchConfiguredTerminal", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.ok(end > start);
  const body = source.slice(start, end);
  assert.match(body, /set targetFontSize to \$\{terminalFontSizePt\}/u);
  assert.match(body, /set targetScale to \$\{terminalWindowScale\}/u);
  assert.match(body, /set font size of targetTab to targetFontSize/u);
  assert.match(body, /set bounds of front window to \{leftEdge, topEdge, leftEdge \+ winWidth, topEdge \+ winHeight\}/u);
  assert.match(body, /set size of front window to \{winWidth, winHeight\}/u);
});

test("Terminal.app launcher defaults to open command without Automation prompts", async () => {
  const source = await readFile(serverScript, "utf8");
  assert.match(source, /const terminalLaunchMode = pickString\(process\.env\.CLAWDAD_TERMINAL_LAUNCH_MODE, "open"\)\.toLowerCase\(\)/u);
  assert.match(source, /const terminalOpenWindowScale = boundedNumber\(process\.env\.CLAWDAD_TERMINAL_OPEN_WINDOW_SCALE, 0\.75/u);
  assert.match(source, /const terminalWindowRows = normalizeOptionalPositiveInteger\(process\.env\.CLAWDAD_TERMINAL_ROWS/u);
  assert.match(source, /const terminalWindowColumns = normalizeOptionalPositiveInteger\(process\.env\.CLAWDAD_TERMINAL_COLUMNS/u);

  const start = source.indexOf("async function launchDarwinOpenTerminal");
  const end = source.indexOf("async function launchConfiguredTerminal", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.ok(end > start);
  const body = source.slice(start, end);
  assert.match(body, /detectDarwinActiveScreenFrame\(\)/u);
  assert.match(body, /terminalWindowCellsForScreen\(screen\)/u);
  assert.match(body, /darwinTerminalFontDataBase64\(\)/u);
  assert.match(body, /writeTerminalSettingsFile\(shellCommand, session, size, fontDataBase64\)/u);
  assert.match(body, /runExec\("open", \["-a", "Terminal", settingsPath\]/u);
  assert.match(body, /writeTerminalCommandFile\(shellCommand, session, size\)/u);
  assert.doesNotMatch(body, /osascript/u);

  const settingsStart = source.indexOf("async function writeTerminalSettingsFile");
  const settingsEnd = source.indexOf("async function writeTerminalCommandFile", settingsStart);
  assert.notEqual(settingsStart, -1);
  assert.notEqual(settingsEnd, -1);
  const settingsBody = source.slice(settingsStart, settingsEnd);
  assert.match(settingsBody, /\.terminal`/u);
  assert.match(settingsBody, /<key>CommandString<\/key>/u);
  assert.match(settingsBody, /<key>Font<\/key>/u);
  assert.match(settingsBody, /<key>columnCount<\/key>/u);
  assert.match(settingsBody, /<key>rowCount<\/key>/u);
  assert.match(settingsBody, /<key>RunCommandAsShell<\/key>[\s\S]*<false\/>/u);

  const screenStart = source.indexOf("async function detectDarwinActiveScreenFrame");
  const screenEnd = source.indexOf("function terminalWindowCellsForScreen", screenStart);
  assert.notEqual(screenStart, -1);
  assert.notEqual(screenEnd, -1);
  const screenBody = source.slice(screenStart, screenEnd);
  assert.match(screenBody, /NSEvent\.mouseLocation/u);
  assert.match(screenBody, /NSScreen\.mainScreen/u);
  assert.match(screenBody, /visibleFrame/u);
  assert.doesNotMatch(screenBody, /tell application/u);

  const cellStart = source.indexOf("function terminalWindowCellsForScreen");
  const cellEnd = source.indexOf("function safeTerminalLaunchSlug", cellStart);
  assert.notEqual(cellStart, -1);
  assert.notEqual(cellEnd, -1);
  const cellBody = source.slice(cellStart, cellEnd);
  assert.match(cellBody, /width \* terminalOpenWindowScale/u);
  assert.match(cellBody, /height \* terminalOpenWindowScale/u);

  const launchStart = source.indexOf("async function launchSessionTerminal");
  const launchEnd = source.indexOf("async function runTailscale", launchStart);
  assert.notEqual(launchStart, -1);
  assert.notEqual(launchEnd, -1);
  const launchBody = source.slice(launchStart, launchEnd);
  assert.match(launchBody, /terminalLaunchMode === "applescript"/u);
  assert.match(launchBody, /Terminal\.app\/open/u);
  assert.match(launchBody, /Terminal\.app\/AppleScript/u);
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
      CLAWDAD_TTS_ENABLED: "false",
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
    assert.equal(payload.recentThreads[0].projectPath, projectPath);
    assert.equal(payload.recentThreads[0].sessionId, externallyActiveSessionId);
    assert.equal(payload.recentThreads[0].lastActivityAt, "2026-05-01T02:30:00.000Z");
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("projects endpoint does not let import tracking time outrank real session activity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-session-tracked-at-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "fractal-research-group");
  const configPath = path.join(root, "server.json");
  const activeSessionId = "019d57e8-8947-7dd1-ba76-55a23c4e6292";
  const importedSessionId = "019db236-7068-71c3-8c01-15785e7396be";

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
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
                slug: "Fractal Research Group",
                provider: "codex",
                provider_session_seeded: "true",
                status: "idle",
                provider_last_activity: "2026-05-01T00:04:12.624Z",
                last_response: "2026-05-01T00:33:48Z",
                tracked_at: "2026-04-04T09:52:30.539Z",
              },
              [importedSessionId]: {
                slug: "yo, should I get a business line?",
                provider: "codex",
                provider_session_seeded: "true",
                status: "idle",
                provider_last_activity: "2026-04-24T03:31:12.333Z",
                provider_session_timestamp: "2026-04-21T22:43:25.422Z",
                tracked_at: "2026-05-01T00:51:06.926Z",
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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
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
    const importedSession = project.sessions.find((session) => session.sessionId === importedSessionId);
    assert.equal(project.sessions[0].sessionId, activeSessionId);
    assert.equal(project.sessions[0].lastActivityAt, "2026-05-01T00:33:48.000Z");
    assert.equal(importedSession.lastActivityAt, "2026-04-24T03:31:12.333Z");
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

test("Codex session discovery applies list limits after mtime ranking", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-codex-session-limit-"));
  const codexHome = path.join(root, "codex-home");
  const projectPath = path.join(root, "clawdad");
  const touchedOlderSessionId = "aa-touched-older-session";
  const olderMtime = new Date("2026-04-30T12:00:00.000Z");
  const newerMtime = new Date("2026-05-02T12:00:00.000Z");

  await mkdir(projectPath, { recursive: true });
  const files = [];
  for (let index = 0; index < 12; index += 1) {
    files.push(await writeCodexSession(codexHome, projectPath, `zz-${String(index).padStart(2, "0")}`, {
      timestamp: "2026-04-30T12:00:00.000Z",
    }));
  }
  const touchedFile = await writeCodexSession(codexHome, projectPath, touchedOlderSessionId, {
    timestamp: "2026-04-01T12:00:00.000Z",
  });

  for (const file of files) {
    await utimes(file, olderMtime, olderMtime);
  }
  await utimes(touchedFile, newerMtime, newerMtime);

  try {
    const result = await runCodexSessionDiscovery([
      "--cwd",
      projectPath,
      "--codex-home",
      codexHome,
      "--list",
      "--limit",
      "3",
    ]);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.sessions.length, 3);
    assert.equal(payload.sessions[0].sessionId, touchedOlderSessionId);
    assert.equal(payload.sessions[0].lastUpdatedAt, "2026-05-02T12:00:00.000Z");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex session discovery returns recent threads across configured roots only", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-codex-session-roots-"));
  const codexHome = path.join(root, "codex-home");
  const projectRoot = path.join(root, "code");
  const alphaPath = path.join(projectRoot, "alpha");
  const betaPath = path.join(projectRoot, "beta");
  const outsidePath = path.join(root, "outside");
  const alphaSessionId = "root-alpha-session";
  const betaSessionId = "root-beta-session";
  const outsideSessionId = "outside-session";

  await mkdir(alphaPath, { recursive: true });
  await mkdir(betaPath, { recursive: true });
  await mkdir(outsidePath, { recursive: true });
  const alphaFile = await writeCodexSession(codexHome, alphaPath, alphaSessionId);
  const betaFile = await writeCodexSession(codexHome, betaPath, betaSessionId);
  const outsideFile = await writeCodexSession(codexHome, outsidePath, outsideSessionId);
  await utimes(alphaFile, new Date("2026-05-02T12:00:00.000Z"), new Date("2026-05-02T12:00:00.000Z"));
  await utimes(betaFile, new Date("2026-05-03T12:00:00.000Z"), new Date("2026-05-03T12:00:00.000Z"));
  await utimes(outsideFile, new Date("2026-05-04T12:00:00.000Z"), new Date("2026-05-04T12:00:00.000Z"));

  try {
    const result = await runCodexSessionDiscovery([
      "--root",
      projectRoot,
      "--codex-home",
      codexHome,
      "--list",
      "--limit",
      "10",
    ]);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.deepEqual(
      payload.sessions.map((session) => session.sessionId),
      [betaSessionId, alphaSessionId],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex session discovery prefers the native recency index over rollout file mtime", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-codex-session-index-"));
  const codexHome = path.join(root, "codex-home");
  const projectPath = path.join(root, "code", "indexed-project");
  const indexedRecentSessionId = "indexed-recent-session";
  const touchedOlderSessionId = "touched-older-session";
  const databasePath = path.join(codexHome, "state_5.sqlite");

  await mkdir(projectPath, { recursive: true });
  const indexedRecentFile = await writeCodexSession(
    codexHome,
    projectPath,
    indexedRecentSessionId,
  );
  const touchedOlderFile = await writeCodexSession(
    codexHome,
    projectPath,
    touchedOlderSessionId,
  );
  await utimes(
    indexedRecentFile,
    new Date("2026-05-01T12:00:00.000Z"),
    new Date("2026-05-01T12:00:00.000Z"),
  );
  await utimes(
    touchedOlderFile,
    new Date("2026-05-04T12:00:00.000Z"),
    new Date("2026-05-04T12:00:00.000Z"),
  );

  const recentAtMs = Date.parse("2026-05-03T12:00:00.000Z");
  const olderAtMs = Date.parse("2026-05-02T12:00:00.000Z");
  const sql = `
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      cwd TEXT NOT NULL,
      source TEXT NOT NULL,
      rollout_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      created_at_ms INTEGER,
      updated_at INTEGER NOT NULL,
      updated_at_ms INTEGER,
      recency_at_ms INTEGER NOT NULL,
      name TEXT,
      title TEXT,
      preview TEXT,
      first_user_message TEXT,
      archived INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO threads VALUES (
      '${indexedRecentSessionId}', '${projectPath}', 'cli', '${indexedRecentFile}',
      ${Math.floor(recentAtMs / 1000)}, ${recentAtMs}, ${Math.floor(recentAtMs / 1000)},
      ${recentAtMs}, ${recentAtMs}, 'Indexed recent thread', '', '', '', 0
    );
    INSERT INTO threads VALUES (
      '${touchedOlderSessionId}', '${projectPath}', 'cli', '${touchedOlderFile}',
      ${Math.floor(olderAtMs / 1000)}, ${olderAtMs}, ${Math.floor(olderAtMs / 1000)},
      ${olderAtMs}, ${olderAtMs}, 'Touched older thread', '', '', '', 0
    );
  `;

  try {
    const sqliteResult = await runCommand("sqlite3", [databasePath, sql]);
    assert.equal(sqliteResult.exitCode, 0, sqliteResult.stderr);
    const result = await runCodexSessionDiscovery([
      "--root",
      path.join(root, "code"),
      "--codex-home",
      codexHome,
      "--list",
      "--limit",
      "2",
    ]);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.deepEqual(
      payload.sessions.map((session) => session.sessionId),
      [indexedRecentSessionId, touchedOlderSessionId],
    );
    assert.equal(payload.sessions[0].titleHint, "Indexed recent thread");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex session discovery uses the explicit user event instead of injected response items", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-codex-session-preview-provenance-"));
  const codexHome = path.join(root, "codex-home");
  const projectPath = path.join(root, "clawdad");
  const sessionId = "019f9cd2-7a08-7653-bb33-a004f5135c2e";
  const sessionDir = path.join(codexHome, "sessions", "2026", "07", "26");
  const sessionFile = path.join(sessionDir, `rollout-${sessionId}.jsonl`);
  const realMessage = "Hey there, what did we most recently work on?";

  await mkdir(projectPath, { recursive: true });
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    sessionFile,
    [
      JSON.stringify({
        timestamp: "2026-07-26T05:07:42.000Z",
        type: "session_meta",
        payload: {
          id: sessionId,
          timestamp: "2026-07-26T05:07:42.000Z",
          cwd: projectPath,
          source: "cli",
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-26T05:07:42.010Z",
        type: "event_msg",
        payload: { type: "task_started" },
      }),
      JSON.stringify({
        timestamp: "2026-07-26T05:07:42.020Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "<recommended_plugins>internal catalog</recommended_plugins>" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-26T05:07:42.030Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "A non-authoritative response item copy." }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-26T05:07:42.040Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: realMessage,
          images: [],
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );

  try {
    const result = await runCodexSessionDiscovery([
      "--cwd",
      projectPath,
      "--codex-home",
      codexHome,
      "--session-id",
      sessionId,
    ]);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.preview, realMessage);
    assert.ok(payload.titleHint.endsWith("…"));
    assert.ok(realMessage.startsWith(payload.titleHint.slice(0, -1)));
    assert.doesNotMatch(payload.preview, /recommended_plugins|non-authoritative/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("status endpoint auto-imports untracked Codex sessions for seeded projects", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-status-auto-import-"));
  const home = path.join(root, "home");
  const codexHome = path.join(root, "codex-home");
  const projectPath = path.join(root, "clawdad");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const trackedSessionId = "tracked-seeded-session";
  const untrackedSessionId = "untracked-local-session";

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeCodexSession(codexHome, projectPath, trackedSessionId, {
    timestamp: "2026-05-04T12:00:00.000Z",
  });
  const untrackedFile = await writeCodexSession(codexHome, projectPath, untrackedSessionId, {
    timestamp: "2026-05-04T13:00:00.000Z",
  });
  await utimes(untrackedFile, new Date("2026-05-04T14:00:00.000Z"), new Date("2026-05-04T14:00:00.000Z"));
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectPath]: {
            status: "completed",
            active_session_id: trackedSessionId,
            sessions: {
              [trackedSessionId]: {
                slug: "tracked",
                provider: "codex",
                provider_session_seeded: "true",
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
    JSON.stringify({ state: "idle", request_id: null, session_id: null }, null, 2),
    "utf8",
  );
  await writeFile(mockBinPath, "#!/bin/sh\nexit 2\n", "utf8");
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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_CODEX_HOME: codexHome,
      CLAWDAD_BIN_PATH: mockBinPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const response = await fetch(`${baseUrl}/v1/status?project=${encodeURIComponent(projectPath)}`, {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    assert.equal(response.status, 200);
    const state = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
    assert.ok(state.projects[projectPath].sessions[untrackedSessionId]);
    assert.equal(state.projects[projectPath].sessions[untrackedSessionId].provider_session_seeded, "true");
    assert.equal(state.projects[projectPath].sessions[untrackedSessionId].local_only, "true");
    assert.equal(state.projects[projectPath].active_session_id, trackedSessionId);
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("status exposes pending Codex approvals and the decision endpoint resolves them once", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-approval-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "approval-lab");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const approvalId = "0123456789abcdef0123456789abcdef";
  const approvalDir = path.join(projectPath, ".clawdad", "mailbox", "approvals");
  const approvalFile = path.join(approvalDir, `${approvalId}.json`);

  await mkdir(approvalDir, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify({
      version: 3,
      projects: {
        [projectPath]: {
          status: "running",
          active_session_id: "approval-session",
          sessions: {
            "approval-session": {
              slug: "approval session",
              provider: "codex",
              provider_session_seeded: "false",
              status: "running",
            },
          },
        },
      },
    }, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(projectPath, ".clawdad", "mailbox", "status.json"),
    JSON.stringify({
      state: "running",
      request_id: "approval-request",
      session_id: "approval-session",
      pid: process.pid,
      dispatched_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
    }, null, 2),
    "utf8",
  );
  await writeFile(
    approvalFile,
    JSON.stringify({
      approvalId,
      state: "pending",
      pid: process.pid,
      requestId: "server-request-1",
      method: "item/commandExecution/requestApproval",
      permissionMode: "approve",
      title: "Approve command",
      prompt: "Push the verified branch to origin.",
      questions: [],
      createdAt: "2026-07-25T20:00:00.000Z",
      updatedAt: "2026-07-25T20:00:00.000Z",
    }, null, 2),
    "utf8",
  );
  await writeFile(mockBinPath, "#!/bin/sh\nexit 2\n", "utf8");
  await chmod(mockBinPath, 0o755);

  const port = await freePort();
  await writeFile(
    configPath,
    JSON.stringify({
      host: "127.0.0.1",
      port,
      defaultProject: projectPath,
      authMode: "tailscale",
      allowedUsers: ["tester@example.com"],
    }, null, 2),
    "utf8",
  );

  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = {
      "Content-Type": "application/json",
      "tailscale-user-login": "tester@example.com",
    };
    await waitForHealth(baseUrl, child);

    const statusResponse = await fetch(
      `${baseUrl}/v1/status?project=${encodeURIComponent(projectPath)}`,
      { headers },
    );
    assert.equal(statusResponse.status, 200);
    const statusPayload = await statusResponse.json();
    assert.equal(statusPayload.mailboxStatus.phase, "awaiting_approval");
    assert.equal(statusPayload.mailboxStatus.pending_approval_count, 1);
    assert.equal(statusPayload.pendingApprovals.length, 1);
    assert.equal(statusPayload.pendingApprovals[0].approvalId, approvalId);
    assert.equal(statusPayload.pendingApprovals[0].prompt, "Push the verified branch to origin.");

    const decisionResponse = await fetch(`${baseUrl}/v1/approvals/decision`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: projectPath,
        approvalId,
        decision: "approve",
      }),
    });
    assert.equal(decisionResponse.status, 202);
    const decisionPayload = await decisionResponse.json();
    assert.equal(decisionPayload.ok, true);
    assert.equal(decisionPayload.decision, "approve");

    const decidedApproval = JSON.parse(await readFile(approvalFile, "utf8"));
    assert.equal(decidedApproval.state, "decided");
    assert.equal(decidedApproval.decision, "approve");
    assert.equal(decidedApproval.decidedBy, "tester@example.com");

    const duplicateResponse = await fetch(`${baseUrl}/v1/approvals/decision`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: projectPath,
        approvalId,
        decision: "approve",
      }),
    });
    assert.equal(duplicateResponse.status, 409);
  } finally {
    await stopServer(child);
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
      CLAWDAD_TTS_ENABLED: "false",
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
    assert.equal(payload.activeOk, true);
    assert.equal(payload.activeBlockerCount, 0);
    assert.equal(payload.repairableIssueCount, 0);
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

test("sessions-doctor leaves a healthy live session running", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-live-session-doctor-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "live-project");
  const sessionId = "live-session";
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
            active_session_id: sessionId,
            sessions: {
              [sessionId]: {
                slug: "live project",
                provider: "codex",
                provider_session_seeded: "false",
                status: "running",
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
        request_id: "live-request",
        session_id: sessionId,
        dispatched_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
        pid: process.pid,
      },
      null,
      2,
    ),
    "utf8",
  );

  try {
    const result = await runServerCli(["sessions-doctor", projectPath, "--json"], {
      env: {
        CLAWDAD_HOME: home,
      },
    });
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.issueCount, 0);

    const state = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
    assert.equal(state.projects[projectPath].sessions[sessionId].status, "running");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sessions-doctor retires a stale local placeholder in favor of the mailbox session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-placeholder-session-doctor-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "completed-project");
  const placeholderSessionId = "local-placeholder";
  const providerSessionId = "provider-session";
  const completedAt = "2026-07-27T21:10:25Z";
  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectPath]: {
            status: "completed",
            active_session_id: placeholderSessionId,
            sessions: {
              [placeholderSessionId]: {
                slug: "local placeholder",
                provider: "codex",
                provider_session_seeded: "false",
                status: "running",
              },
              [providerSessionId]: {
                slug: "provider session",
                provider: "codex",
                provider_session_seeded: "false",
                status: "completed",
                last_response: completedAt,
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
        request_id: "completed-request",
        session_id: providerSessionId,
        completed_at: completedAt,
        pid: null,
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
    assert.equal(payload.repairCount, 1);
    assert.equal(
      payload.projects[0].repairs[0].type,
      "busy_session_status_retired",
    );

    const state = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
    assert.equal(state.projects[projectPath].active_session_id, providerSessionId);
    assert.equal(
      state.projects[projectPath].sessions[placeholderSessionId].status,
      "idle",
    );

    const clean = await runServerCli(["sessions-doctor", projectPath, "--json"], {
      env: {
        CLAWDAD_HOME: home,
      },
    });
    assert.equal(clean.exitCode, 0, clean.stderr);
    assert.equal(JSON.parse(clean.stdout).issueCount, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sessions-doctor repairs stale active mirrored Codex goals on terminal lanes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-goal-doctor-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "goal-project");
  const delegateDir = path.join(projectPath, ".clawdad", "delegate");
  await mkdir(delegateDir, { recursive: true });
  await mkdir(home, { recursive: true });

  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectPath]: {
            status: "completed",
            active_session_id: "goal-session",
            sessions: {
              "goal-session": {
                slug: "goal-project",
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
    path.join(delegateDir, "delegate-status.json"),
    JSON.stringify(
      {
        version: 1,
        laneId: "default",
        state: "completed",
        runId: "goal-run",
        delegateSessionId: "goal-session",
        stepCount: 1,
        activeRequestId: null,
        activeStep: null,
        stopReason: null,
        codexGoal: {
          mode: "auto",
          supported: true,
          synced: true,
          status: "active",
          objective: "Finish goal project.",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  try {
    const doctor = await runServerCli(["sessions-doctor", projectPath, "--json"], {
      env: { CLAWDAD_HOME: home },
    });
    assert.equal(doctor.exitCode, 1, doctor.stderr || doctor.stdout);
    const report = JSON.parse(doctor.stdout);
    assert.equal(report.projects[0].issues.some((issue) => issue.type === "stale_codex_goal_active"), true);
    assert.equal(report.projects[0].issues.find((issue) => issue.type === "stale_codex_goal_active").repairable, true);

    const repaired = await runServerCli(["sessions-doctor", projectPath, "--repair", "--json"], {
      env: { CLAWDAD_HOME: home },
    });
    assert.equal(repaired.exitCode, 0, repaired.stderr || repaired.stdout);
    const status = JSON.parse(await readFile(path.join(delegateDir, "delegate-status.json"), "utf8"));
    assert.equal(status.codexGoal.status, "complete");
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
    assert.equal(auditPayload.projects[0].issues[0].activeBlocker, true);
    assert.equal(auditPayload.activeBlockerCount, 1);
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

test("sessions-doctor accepts a failed request mailbox for an otherwise idle reusable session", async () => {
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
    assert.equal(audit.exitCode, 0, audit.stderr);
    const auditPayload = JSON.parse(audit.stdout);
    assert.equal(auditPayload.ok, true);
    assert.equal(auditPayload.projects[0].issues.length, 0);

    const mailboxStatus = JSON.parse(
      await readFile(path.join(projectPath, ".clawdad", "mailbox", "status.json"), "utf8"),
    );
    assert.equal(mailboxStatus.state, "failed");
    assert.equal(mailboxStatus.request_id, "request-timeout");
    assert.match(mailboxStatus.error, /did not complete/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sessions-doctor repairs a stale failed mailbox from an old non-active session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-old-failed-mailbox-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "erdos-problems");
  const activeSessionId = "019dfe60-3e67-7b83-a0ae-b975c4752e19";
  const oldSessionId = "019eb6d0-612c-7821-a784-d6a289f74128";

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(projectPath, ".clawdad", "mailbox", "status.json"),
    JSON.stringify(
      {
        state: "failed",
        request_id: "request-timeout",
        session_id: oldSessionId,
        dispatched_at: "2026-06-11T17:01:51Z",
        completed_at: "2026-06-11T17:31:58Z",
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
            active_session_id: activeSessionId,
            sessions: {
              [activeSessionId]: {
                slug: "What do you think about the 848 progress and...",
                provider: "codex",
                provider_session_seeded: "false",
                status: "idle",
                local_only: "true",
              },
              [oldSessionId]: {
                slug: "Recent failed timeout",
                provider: "codex",
                provider_session_seeded: "false",
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

  try {
    const audit = await runServerCli([
      "sessions-doctor",
      projectPath,
      "--json",
    ], {
      env: {
        CLAWDAD_HOME: home,
      },
    });
    assert.equal(audit.exitCode, 1, audit.stderr);
    const auditPayload = JSON.parse(audit.stdout);
    assert.equal(auditPayload.projects[0].issues[0].type, "stale_failed_mailbox");
    assert.equal(auditPayload.projects[0].issues[0].sessionId, activeSessionId);
    assert.equal(auditPayload.projects[0].issues[0].mailboxSessionId, oldSessionId);

    const repair = await runServerCli([
      "sessions-doctor",
      projectPath,
      "--repair",
      "--json",
    ], {
      env: {
        CLAWDAD_HOME: home,
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

    const state = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
    assert.equal(state.projects[projectPath].status, "idle");
    assert.equal(state.projects[projectPath].active_session_id, activeSessionId);
    assert.equal(state.projects[projectPath].sessions[activeSessionId].status, "idle");
    assert.equal(state.projects[projectPath].sessions[oldSessionId].status, "failed");
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
    assert.equal(auditPayload.activeBlockerCount, 1);
    assert.equal(auditPayload.repairableIssueCount, 2);
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

test("sessions-doctor classifies inactive stale bindings as historical repairable issues", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-historical-doctor-"));
  const home = path.join(root, "home");
  const codexHome = path.join(root, "codex-home");
  const projectPath = path.join(root, "historical-project");
  const goodSessionId = "019e6000-0000-7000-8000-000000000001";
  const staleSessionId = "019e6000-0000-7000-8000-000000000002";

  await mkdir(projectPath, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeCodexSession(codexHome, projectPath, goodSessionId);
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectPath]: {
            status: "idle",
            active_session_id: goodSessionId,
            sessions: {
              [goodSessionId]: {
                slug: "Good",
                provider: "codex",
                provider_session_seeded: "true",
                status: "idle",
              },
              [staleSessionId]: {
                slug: "Old missing transcript",
                provider: "codex",
                provider_session_seeded: "true",
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

  try {
    const audit = await runServerCli(["sessions-doctor", projectPath, "--json"], {
      env: {
        CLAWDAD_HOME: home,
        CLAWDAD_CODEX_HOME: codexHome,
      },
    });
    assert.equal(audit.exitCode, 1, audit.stderr || audit.stdout);
    const payload = JSON.parse(audit.stdout);
    assert.equal(payload.activeOk, true);
    assert.equal(payload.activeBlockerCount, 0);
    assert.equal(payload.historicalIssueCount, 1);
    assert.equal(payload.repairableIssueCount, 1);
    assert.equal(payload.requiresHumanDecisionCount, 0);
    assert.equal(payload.projects[0].issues[0].severity, "historical");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prod-doctor emits live runtime and session health summary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-prod-doctor-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "prod-project");
  const configPath = path.join(root, "server.json");
  const port = await freePort();

  await mkdir(projectPath, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectPath]: {
            status: "idle",
            active_session_id: "local-placeholder",
            sessions: {
              "local-placeholder": {
                slug: "Local placeholder",
                provider: "codex",
                provider_session_seeded: "false",
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

  try {
    const result = await runServerCli(["prod-doctor", "--project", projectPath, "--config", configPath, "--json"], {
      env: {
        CLAWDAD_HOME: home,
      },
    });
    assert.equal(result.exitCode, 1, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    const currentPackage = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
    assert.equal(payload.version, currentPackage.version);
    assert.equal(payload.sessions.activeBlockerCount, 0);
    assert.ok(payload.checks.some((check) => check.label === "Installed binary"));
    assert.ok(payload.checks.some((check) => check.label === "Local health" && check.status === "fail"));
    assert.ok(payload.checks.some((check) => check.label === "App asset fingerprint"));
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
      CLAWDAD_TTS_ENABLED: "false",
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

test("dispatch endpoint saves multipart attachments and passes a manifest to clawdad dispatch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-attachments-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "dockside");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const argsPath = path.join(root, "dispatch-args.json");
  const manifestCopyPath = path.join(root, "manifest-copy.json");
  const sessionId = "attach-session";

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
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
                slug: "dockside codex",
                provider: "codex",
                provider_session_seeded: "false",
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
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(args, null, 2));
const projectPath = args[1];
const sessionIndex = args.indexOf("--session");
const manifestIndex = args.indexOf("--attachment-manifest");
if (manifestIndex >= 0) {
  fs.writeFileSync(${JSON.stringify(manifestCopyPath)}, fs.readFileSync(args[manifestIndex + 1]));
}
fs.mkdirSync(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
fs.writeFileSync(
  path.join(projectPath, ".clawdad", "mailbox", "status.json"),
  JSON.stringify({
    state: "running",
    request_id: "req-attachment",
    session_id: sessionIndex >= 0 ? args[sessionIndex + 1] : null,
    dispatched_at: new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
    completed_at: null,
    error: null,
    pid: process.pid,
  }, null, 2),
);
process.exit(0);
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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const formData = new FormData();
    formData.append("project", projectPath);
    formData.append("sessionId", sessionId);
    formData.append("message", "");
    const imageBytes = new Uint8Array(70 * 1024);
    imageBytes.set([137, 80, 78, 71]);
    formData.append("attachments", new Blob([imageBytes], { type: "image/png" }), "screen shot.png");

    const response = await fetch(`${baseUrl}/v1/dispatch`, {
      method: "POST",
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
      body: formData,
    });
    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.requestId, "req-attachment");
    assert.equal(payload.attachments.length, 1);
    assert.equal(payload.attachments[0].fileName, "screen shot.png");
    assert.equal(payload.attachments[0].kind, "image");
    assert.equal(payload.attachments[0].mimeType, "image/png");
    const savedImage = await readFile(payload.attachments[0].path);
    assert.equal(savedImage.subarray(0, 4).toString("latin1"), "\u0089PNG");
    assert.equal(savedImage.length, imageBytes.length);

    const args = JSON.parse(await readFile(argsPath, "utf8"));
    assert.deepEqual(args.slice(0, 3), [
      "dispatch",
      projectPath,
      "Please review the attached file(s).",
    ]);
    assert.ok(args.includes("--attachment-manifest"));
    assert.equal(args[args.indexOf("--session") + 1], sessionId);

    const manifest = JSON.parse(await readFile(manifestCopyPath, "utf8"));
    assert.equal(manifest.projectPath, projectPath);
    assert.equal(manifest.attachments.length, 1);
    assert.equal(manifest.attachments[0].path, payload.attachments[0].path);
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("requested artifacts sync into a stable Dumpy project party", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-dumpy-artifacts-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "dockside");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const sessionId = "dumpy-session";
  const fakeDumpy = await startFakeDumpyServer();

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
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
                slug: "dockside codex",
                provider: "codex",
                provider_session_seeded: "false",
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
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const projectPath = args[1];
const sessionIndex = args.indexOf("--session");
fs.mkdirSync(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
fs.writeFileSync(
  path.join(projectPath, ".clawdad", "mailbox", "status.json"),
  JSON.stringify({
    state: "running",
    request_id: "req-dumpy",
    session_id: sessionIndex >= 0 ? args[sessionIndex + 1] : null,
    dispatched_at: new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
    completed_at: null,
    error: null,
    pid: process.pid,
  }, null, 2),
);
process.exit(0);
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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
      CLAWDAD_DUMPY_API_URL: fakeDumpy.baseUrl,
      CLAWDAD_DUMPY_APP_URL: "https://dumpy.example.test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = { "tailscale-user-login": "tester@example.com" };
    await waitForHealth(baseUrl, child);

    const dispatchResponse = await fetch(`${baseUrl}/v1/dispatch`, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        message: "Create a shareable PDF file for this project.",
        wait: false,
      }),
    });
    assert.equal(dispatchResponse.status, 202);

    const artifactPath = path.join(projectPath, ".clawdad", "artifacts", "deck-note.md");
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, "# Deck note\n", "utf8");

    const artifactsResponse = await fetch(`${baseUrl}/v1/artifacts?project=${encodeURIComponent(projectPath)}`, {
      headers,
    });
    assert.equal(artifactsResponse.status, 200);
    const payload = await artifactsResponse.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.dumpy.partyId, "party-1");
    assert.equal(payload.dumpy.partyName, "dockside");
    assert.equal(payload.dumpy.partyUrl, "https://dumpy.example.test/?party=party-1");
    assert.equal(payload.dumpy.zipUrl, "https://dumpy.example.test/api/parties/party-1/download");
    assert.equal(fakeDumpy.parties.length, 1);
    assert.equal(fakeDumpy.items.length, 1);
    assert.equal(fakeDumpy.items[0].name, "deck-note.md");
    assert.equal(fakeDumpy.items[0].relativePath, "deck-note.md");

    const secondResponse = await fetch(`${baseUrl}/v1/artifacts?project=${encodeURIComponent(projectPath)}`, {
      headers,
    });
    assert.equal(secondResponse.status, 200);
    assert.equal(fakeDumpy.parties.length, 1);
    assert.equal(fakeDumpy.items.length, 1);
  } finally {
    await stopServer(child);
    await fakeDumpy.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("dispatch endpoint returns request id for delayed linear mailbox start", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-linear-delayed-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "linear-lab");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock.js");
  const capturePath = path.join(root, "linear-capture.json");
  const sessionId = "codex-linear";

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
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
                slug: "linear codex",
                provider: "codex",
                provider_session_seeded: "false",
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
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const projectPath = args[1];
const sessionIndex = args.indexOf("--session");
const sessionId = sessionIndex >= 0 ? args[sessionIndex + 1] : null;
const delayMs = Number(process.env.CLAWDAD_TEST_MAILBOX_DELAY_MS || "0");
fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ args }, null, 2));
const writeStatus = () => {
  fs.mkdirSync(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  fs.writeFileSync(
    path.join(projectPath, ".clawdad", "mailbox", "status.json"),
    JSON.stringify({
      state: "running",
      request_id: "linear-started",
      session_id: sessionId,
      dispatched_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      completed_at: null,
      error: null,
      pid: process.pid,
    }, null, 2),
  );
};
if (delayMs > 0) {
  setTimeout(writeStatus, delayMs);
} else {
  writeStatus();
}
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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
      CLAWDAD_REMOTE_DISPATCH_START_TIMEOUT_MS: "5000",
      CLAWDAD_TEST_MAILBOX_DELAY_MS: "3500",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const response = await fetch(`${baseUrl}/v1/dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "tailscale-user-login": "tester@example.com",
      },
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        message: "Run the linear prompt now.",
        wait: false,
        dispatchMode: "linear",
        permissionMode: "full",
        model: "gpt-5.6-sol",
        reasoningEffort: "ultra",
      }),
    });

    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.requestId, "linear-started");
    assert.equal(payload.dispatchMode, "direct");
    assert.equal(payload.queued, false);
    assert.equal(payload.interjected, false);

    const captured = JSON.parse(await waitForFileText(capturePath));
    assert.deepEqual(captured.args.slice(0, 3), [
      "dispatch",
      projectPath,
      "Run the linear prompt now.",
    ]);
    assert.equal(captured.args[captured.args.indexOf("--session") + 1], sessionId);
    assert.equal(captured.args[captured.args.indexOf("--permission-mode") + 1], "full");
    assert.equal(captured.args[captured.args.indexOf("--model") + 1], "gpt-5.6-sol");
    assert.equal(captured.args[captured.args.indexOf("--reasoning-effort") + 1], "ultra");
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("dispatch endpoint returns generated request id when linear handoff is still starting", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-linear-starting-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "linear-starting-lab");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock.js");
  const capturePath = path.join(root, "linear-starting-capture.json");
  const sessionId = "codex-linear-starting";

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
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
                slug: "linear starting",
                provider: "codex",
                provider_session_seeded: "false",
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
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const projectPath = args[1];
const sessionIndex = args.indexOf("--session");
const sessionId = sessionIndex >= 0 ? args[sessionIndex + 1] : null;
const requestId = process.env.CLAWDAD_DISPATCH_REQUEST_ID || "";
fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ args, requestId }, null, 2));
setTimeout(() => {
  fs.mkdirSync(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  fs.writeFileSync(
    path.join(projectPath, ".clawdad", "mailbox", "status.json"),
    JSON.stringify({
      state: "running",
      request_id: requestId,
      session_id: sessionId,
      dispatched_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      completed_at: null,
      error: null,
      pid: process.pid,
    }, null, 2),
  );
}, 250);
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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
      CLAWDAD_REMOTE_DISPATCH_START_TIMEOUT_MS: "25",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const response = await fetch(`${baseUrl}/v1/dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "tailscale-user-login": "tester@example.com",
      },
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        message: "Run the linear prompt now.",
        wait: false,
        dispatchMode: "linear",
      }),
    });

    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.match(payload.requestId, /^[0-9a-f-]{36}$/u);
    assert.equal(payload.queueId, null);
    assert.equal(payload.requestState, "starting");
    assert.equal(payload.handoffPending, true);
    assert.equal(payload.mailboxStatus, null);

    const captured = JSON.parse(await waitForFileText(capturePath));
    assert.equal(captured.requestId, payload.requestId);
    await new Promise((resolve) => setTimeout(resolve, 300));
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("dispatch endpoint treats legacy linear messages as Direct while a Codex session is busy", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-linear-busy-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "linear-busy-lab");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const mockTouchedPath = path.join(root, "mock-touched");
  const sessionId = "codex-active";

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
            active_session_id: sessionId,
            sessions: {
              [sessionId]: {
                slug: "busy codex",
                provider: "codex",
                provider_session_seeded: "false",
                status: "running",
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
        request_id: "active-request",
        session_id: sessionId,
        dispatched_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
        completed_at: null,
        error: null,
        pid: process.pid,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    mockBinPath,
    `#!/bin/sh
touch ${JSON.stringify(mockTouchedPath)}
exit 1
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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
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
        "Content-Type": "application/json",
        "tailscale-user-login": "tester@example.com",
      },
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        message: "Fold this legacy Direct message into the active turn.",
        wait: false,
        dispatchMode: "linear",
      }),
    });

    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.dispatchMode, "direct");
    assert.equal(payload.effectiveDispatchMode, "direct");
    assert.equal(payload.direct, true);
    assert.equal(payload.interjected, true);
    await assert.rejects(readFile(mockTouchedPath, "utf8"), { code: "ENOENT" });
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("dispatch endpoint records Direct messages while a Codex session is busy", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-interject-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "bayou-lab");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const mockTouchedPath = path.join(root, "mock-touched");
  const sessionId = "codex-active";

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
            active_session_id: sessionId,
            sessions: {
              [sessionId]: {
                slug: "bayou codex",
                provider: "codex",
                provider_session_seeded: "false",
                status: "running",
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
        request_id: "active-request",
        session_id: sessionId,
        dispatched_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
        completed_at: null,
        error: null,
        pid: process.pid,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    mockBinPath,
    `#!/bin/sh
touch ${JSON.stringify(mockTouchedPath)}
exit 1
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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
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
        "Content-Type": "application/json",
        "tailscale-user-login": "tester@example.com",
      },
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        message: "Please factor this into the current pass.",
        wait: false,
        dispatchMode: "direct",
      }),
    });

    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.dispatchMode, "direct");
    assert.equal(payload.effectiveDispatchMode, "direct");
    assert.equal(payload.direct, true);
    assert.equal(payload.interjected, true);
    assert.match(payload.requestId, /^[0-9a-f-]{36}$/u);

    const interjectionDir = path.join(projectPath, ".clawdad", "mailbox", "interjections");
    const interjectionFiles = await readdir(interjectionDir);
    assert.equal(interjectionFiles.length, 1);
    const interjection = JSON.parse(await readFile(path.join(interjectionDir, interjectionFiles[0]), "utf8"));
    assert.equal(interjection.state, "pending");
    assert.equal(interjection.requestId, payload.requestId);
    assert.equal(interjection.message, "Please factor this into the current pass.");

    const index = JSON.parse(
      await readFile(path.join(projectPath, ".clawdad", "history", "requests", `${payload.requestId}.json`), "utf8"),
    );
    assert.equal(index.sessionId, sessionId);
    const record = JSON.parse(await readFile(index.file, "utf8"));
    assert.equal(record.status, "working");
    assert.equal(record.scheduleMode, "direct");
    assert.equal(record.deliveryMechanism, "turn_steer");
    assert.equal(record.message, "Please factor this into the current pass.");
    await assert.rejects(readFile(mockTouchedPath, "utf8"));
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent Direct requests admit one turn and steer the other instead of launching twice", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-direct-race-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "direct-race");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock.js");
  const capturePath = path.join(root, "capture.jsonl");
  const sessionId = "codex-active";
  const statusPath = path.join(projectPath, ".clawdad", "mailbox", "status.json");

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify({
      version: 3,
      projects: {
        [projectPath]: {
          status: "completed",
          active_session_id: sessionId,
          sessions: {
            [sessionId]: {
              slug: "direct race",
              provider: "codex",
              provider_session_seeded: "false",
              status: "completed",
            },
          },
        },
      },
    }, null, 2),
    "utf8",
  );
  await writeFile(
    statusPath,
    JSON.stringify({ state: "completed", request_id: "previous", session_id: sessionId }, null, 2),
    "utf8",
  );
  await writeFile(
    mockBinPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const requestId = process.env.CLAWDAD_DISPATCH_REQUEST_ID || "";
fs.appendFileSync(${JSON.stringify(capturePath)}, requestId + "\\n");
fs.writeFileSync(${JSON.stringify(statusPath)}, JSON.stringify({
  state: "running",
  request_id: requestId,
  session_id: ${JSON.stringify(sessionId)},
  pid: process.pid,
  dispatched_at: new Date().toISOString(),
  heartbeat_at: new Date().toISOString(),
}, null, 2));
`,
    "utf8",
  );
  await chmod(mockBinPath, 0o755);
  const port = await freePort();
  await writeFile(
    configPath,
    JSON.stringify({
      host: "127.0.0.1",
      port,
      defaultProject: projectPath,
      authMode: "tailscale",
      allowedUsers: ["tester@example.com"],
    }, null, 2),
    "utf8",
  );
  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = {
      "Content-Type": "application/json",
      "tailscale-user-login": "tester@example.com",
    };
    await waitForHealth(baseUrl, child);
    const responses = await Promise.all([
      fetch(`${baseUrl}/v1/dispatch`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          project: projectPath,
          sessionId,
          message: "first direct message",
          wait: false,
          dispatchMode: "direct",
        }),
      }),
      fetch(`${baseUrl}/v1/dispatch`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          project: projectPath,
          sessionId,
          message: "second direct message",
          wait: false,
          dispatchMode: "direct",
        }),
      }),
    ]);
    assert.deepEqual(responses.map((response) => response.status), [202, 202]);
    const payloads = await Promise.all(responses.map((response) => response.json()));
    assert.equal(payloads.filter((payload) => payload.interjected).length, 1);
    assert.equal(payloads.filter((payload) => !payload.interjected && payload.direct).length, 1);
    assert.equal((await readFile(capturePath, "utf8")).trim().split("\n").length, 1);
    const interjectionDir = path.join(projectPath, ".clawdad", "mailbox", "interjections");
    assert.equal((await readdir(interjectionDir)).length, 1);
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("dispatch endpoint queues queue-mode messages behind an active session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-queue-busy-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "queue-lab");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock.js");
  const capturePath = path.join(root, "queue-capture.json");
  const sessionId = "codex-active";
  const statusPath = path.join(projectPath, ".clawdad", "mailbox", "status.json");

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
            active_session_id: sessionId,
            sessions: {
              [sessionId]: {
                slug: "active codex",
                provider: "codex",
                provider_session_seeded: "false",
                status: "running",
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
    statusPath,
    JSON.stringify(
      {
        state: "running",
        request_id: "active-request",
        session_id: sessionId,
        dispatched_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
        completed_at: null,
        error: null,
        pid: process.pid,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    mockBinPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({
  args: process.argv.slice(2),
  requestId: process.env.CLAWDAD_DISPATCH_REQUEST_ID || "",
}, null, 2));
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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
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
        "Content-Type": "application/json",
        "tailscale-user-login": "tester@example.com",
      },
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        message: "Run this after the current prompt finishes.",
        wait: false,
        dispatchMode: "queue",
      }),
    });

    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.dispatchMode, "queue");
    assert.equal(payload.queued, true);
    assert.equal(payload.interjected, false);
    assert.equal(payload.direct, false);
    assert.equal(payload.directDeferredReason, null);
    assert.equal(payload.interjectionFallbackReason, null);
    assert.match(payload.requestId, /^[0-9a-f-]{36}$/u);

    const queuedItem = JSON.parse(await readFile(payload.scheduleFile, "utf8"));
    assert.equal(queuedItem.state, "queued");
    assert.equal(queuedItem.requestId, payload.requestId);
    assert.equal(queuedItem.sessionId, sessionId);
    assert.equal(queuedItem.message, "Run this after the current prompt finishes.");

    const index = JSON.parse(
      await readFile(path.join(projectPath, ".clawdad", "history", "requests", `${payload.requestId}.json`), "utf8"),
    );
    const record = JSON.parse(await readFile(index.file, "utf8"));
    assert.equal(record.status, "queued");
    assert.equal(record.scheduleMode, "queue");

    await writeFile(
      statusPath,
      JSON.stringify({ state: "completed", request_id: "active-request", session_id: sessionId }, null, 2),
      "utf8",
    );
    const captured = JSON.parse(await waitForFileText(capturePath));
    assert.equal(captured.requestId, payload.requestId);
    assert.deepEqual(captured.args.slice(0, 3), [
      "dispatch",
      projectPath,
      "Run this after the current prompt finishes.",
    ]);
    assert.equal(captured.args[captured.args.indexOf("--session") + 1], sessionId);
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("Direct requests arriving behind a durable queue preserve backlog order", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-queue-backlog-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "queue-backlog");
  const queueDir = path.join(projectPath, ".clawdad", "mailbox", "queued");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock.js");
  const capturePath = path.join(root, "capture.jsonl");
  const sessionId = "codex-active";
  const statusPath = path.join(projectPath, ".clawdad", "mailbox", "status.json");

  await mkdir(queueDir, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify({
      version: 3,
      projects: {
        [projectPath]: {
          status: "completed",
          active_session_id: sessionId,
          sessions: {
            [sessionId]: {
              slug: "queue backlog",
              provider: "codex",
              provider_session_seeded: "false",
              status: "completed",
            },
          },
        },
      },
    }, null, 2),
    "utf8",
  );
  await writeFile(
    statusPath,
    JSON.stringify({ state: "completed", request_id: "previous", session_id: sessionId }, null, 2),
    "utf8",
  );
  await writeFile(
    mockBinPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const requestId = process.env.CLAWDAD_DISPATCH_REQUEST_ID || "";
fs.appendFileSync(${JSON.stringify(capturePath)}, JSON.stringify({
  requestId,
  message: process.argv[4] || "",
}) + "\\n");
fs.writeFileSync(${JSON.stringify(statusPath)}, JSON.stringify({
  state: "completed",
  request_id: requestId,
  session_id: ${JSON.stringify(sessionId)},
}, null, 2));
`,
    "utf8",
  );
  await chmod(mockBinPath, 0o755);
  const port = await freePort();
  await writeFile(
    configPath,
    JSON.stringify({
      host: "127.0.0.1",
      port,
      defaultProject: projectPath,
      authMode: "tailscale",
      allowedUsers: ["tester@example.com"],
    }, null, 2),
    "utf8",
  );
  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
      CLAWDAD_QUEUE_POLL_MS: "10",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = {
      "Content-Type": "application/json",
      "tailscale-user-login": "tester@example.com",
    };
    await waitForHealth(baseUrl, child);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await writeFile(
      path.join(queueDir, "existing.json"),
      JSON.stringify({
        requestId: "queued-existing",
        projectPath,
        sessionId,
        message: "existing queued message",
        state: "queued",
        createdAt: "2026-07-25T12:00:00.000Z",
        clawdadBin: mockBinPath,
        clawdadRoot: root,
        clawdadHome: home,
      }, null, 2),
      "utf8",
    );

    const response = await fetch(`${baseUrl}/v1/dispatch`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        message: "later direct message",
        wait: false,
        dispatchMode: "direct",
      }),
    });
    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.dispatchMode, "direct");
    assert.equal(payload.effectiveDispatchMode, "queue");
    assert.equal(payload.directDeferredReason, "queued_backlog");
    assert.equal(payload.queuedAhead, 1);

    const captures = (await waitForFileLines(capturePath, 2))
      .map((line) => JSON.parse(line));
    assert.deepEqual(captures.map((entry) => entry.message), [
      "existing queued message",
      "later direct message",
    ]);
    await waitForDirectoryEmpty(queueDir);
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("dispatch endpoint defers Direct requests for a different active Codex session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-interject-mismatch-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "bayou-lab");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock.js");
  const capturePath = path.join(root, "queue-capture.json");
  const activeSessionId = "codex-active";
  const selectedSessionId = "codex-selected";
  const statusPath = path.join(projectPath, ".clawdad", "mailbox", "status.json");

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
            active_session_id: activeSessionId,
            sessions: {
              [activeSessionId]: {
                slug: "active codex",
                provider: "codex",
                provider_session_seeded: "false",
                status: "running",
              },
              [selectedSessionId]: {
                slug: "selected codex",
                provider: "codex",
                provider_session_seeded: "false",
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
    statusPath,
    JSON.stringify(
      {
        state: "running",
        request_id: "active-request",
        session_id: activeSessionId,
        dispatched_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
        completed_at: null,
        error: null,
        pid: process.pid,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    mockBinPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({
  args: process.argv.slice(2),
  requestId: process.env.CLAWDAD_DISPATCH_REQUEST_ID || "",
}, null, 2));
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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
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
        "Content-Type": "application/json",
        "tailscale-user-login": "tester@example.com",
      },
      body: JSON.stringify({
        project: projectPath,
        sessionId: selectedSessionId,
        message: "Run this after the active session finishes.",
        wait: false,
        dispatchMode: "direct",
      }),
    });

    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.dispatchMode, "direct");
    assert.equal(payload.effectiveDispatchMode, "queue");
    assert.equal(payload.queued, true);
    assert.equal(payload.deferred, true);
    assert.equal(payload.direct, false);
    assert.equal(payload.interjected, false);
    assert.equal(payload.directDeferredReason, "active_session_mismatch");
    assert.equal(payload.interjectionFallbackReason, "active_session_mismatch");
    assert.match(payload.requestId, /^[0-9a-f-]{36}$/u);

    await writeFile(
      statusPath,
      JSON.stringify({ state: "completed", request_id: "active-request", session_id: activeSessionId }, null, 2),
      "utf8",
    );
    const captured = JSON.parse(await waitForFileText(capturePath));
    assert.equal(captured.requestId, payload.requestId);
    assert.deepEqual(captured.args.slice(0, 3), [
      "dispatch",
      projectPath,
      "Run this after the active session finishes.",
    ]);
    assert.equal(captured.args[captured.args.indexOf("--session") + 1], selectedSessionId);
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("dispatch queue worker launches queued messages with a stable request id", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-queue-worker-"));
  const projectPath = path.join(root, "queue-lab");
  const home = path.join(root, "home");
  const itemFile = path.join(root, "queued-item.json");
  const mockBinPath = path.join(root, "clawdad-mock.js");
  const capturePath = path.join(root, "capture.json");

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(projectPath, ".clawdad", "mailbox", "status.json"),
    JSON.stringify({ state: "completed", request_id: "previous" }, null, 2),
    "utf8",
  );
  await writeFile(
    mockBinPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({
  args: process.argv.slice(2),
  requestId: process.env.CLAWDAD_DISPATCH_REQUEST_ID || "",
}, null, 2));
`,
    "utf8",
  );
  await chmod(mockBinPath, 0o755);
  await writeFile(
    itemFile,
    JSON.stringify(
      {
        requestId: "queued-request-1",
        projectPath,
        sessionId: "session-queue",
        message: "Run this after the active turn.",
        permissionMode: "approve",
        model: "gpt-test",
        reasoningEffort: "ultra",
        clawdadBin: mockBinPath,
        clawdadRoot: root,
        clawdadHome: home,
      },
      null,
      2,
    ),
    "utf8",
  );

  try {
    const child = spawn(process.execPath, [dispatchQueueWorkerScript, "--item-file", itemFile], {
      cwd: repoRoot,
      env: {
        ...process.env,
      CLAWDAD_TTS_ENABLED: "false",
        CLAWDAD_HOME: home,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const result = await new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("exit", (code, signal) => {
        resolve({ code, signal, stdout, stderr });
      });
    });

    assert.equal(result.code, 0, result.stderr);
    const captured = JSON.parse(await readFile(capturePath, "utf8"));
    assert.deepEqual(captured.args.slice(0, 3), [
      "dispatch",
      projectPath,
      "Run this after the active turn.",
    ]);
    assert.equal(captured.args[captured.args.indexOf("--session") + 1], "session-queue");
    assert.equal(captured.args[captured.args.indexOf("--permission-mode") + 1], "approve");
    assert.equal(captured.args[captured.args.indexOf("--model") + 1], "gpt-test");
    assert.equal(captured.args[captured.args.indexOf("--reasoning-effort") + 1], "ultra");
    assert.equal(captured.requestId, "queued-request-1");
    await assert.rejects(readFile(itemFile, "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dispatch queue worker follows a provisional session alias before dispatch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-queue-worker-rekey-"));
  const projectPath = path.join(root, "queue-lab");
  const home = path.join(root, "home");
  const itemFile = path.join(root, "queued-item.json");
  const mockBinPath = path.join(root, "clawdad-mock.js");
  const capturePath = path.join(root, "capture.json");

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(projectPath, ".clawdad", "mailbox", "status.json"),
    JSON.stringify({ state: "completed", request_id: "direct-request" }, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify({
      projects: {
        [projectPath]: {
          session_aliases: {
            "provisional-session": "real-codex-session",
          },
        },
      },
    }, null, 2),
    "utf8",
  );
  await writeFile(
    mockBinPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({
  args: process.argv.slice(2),
  requestId: process.env.CLAWDAD_DISPATCH_REQUEST_ID || "",
}, null, 2));
`,
    "utf8",
  );
  await chmod(mockBinPath, 0o755);
  await writeFile(
    itemFile,
    JSON.stringify({
      requestId: "queued-after-first-turn",
      projectPath,
      sessionId: "provisional-session",
      message: "Run after the first turn.",
      state: "queued",
      clawdadBin: mockBinPath,
      clawdadRoot: root,
      clawdadHome: home,
    }, null, 2),
    "utf8",
  );

  try {
    const child = spawn(process.execPath, [dispatchQueueWorkerScript, "--item-file", itemFile], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CLAWDAD_HOME: home,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const result = await new Promise((resolve) => {
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("exit", (code, signal) => resolve({ code, signal, stderr }));
    });

    assert.equal(result.code, 0, result.stderr);
    const captured = JSON.parse(await readFile(capturePath, "utf8"));
    assert.equal(
      captured.args[captured.args.indexOf("--session") + 1],
      "real-codex-session",
    );
    assert.equal(captured.requestId, "queued-after-first-turn");
    await assert.rejects(readFile(itemFile, "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dispatch queue worker preserves a durable failed item and history record", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-queue-worker-failure-"));
  const projectPath = path.join(root, "queue-lab");
  const home = path.join(root, "home");
  const itemFile = path.join(projectPath, ".clawdad", "mailbox", "queued", "queued-request-failed.json");
  const mockBinPath = path.join(root, "clawdad-mock.js");
  const recordFile = path.join(projectPath, ".clawdad", "history", "sessions", "session-queue", "request.json");
  const indexFile = path.join(projectPath, ".clawdad", "history", "requests", "queued-request-failed.json");

  await mkdir(path.dirname(itemFile), { recursive: true });
  await mkdir(path.dirname(recordFile), { recursive: true });
  await mkdir(path.dirname(indexFile), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(projectPath, ".clawdad", "mailbox", "status.json"),
    JSON.stringify({ state: "completed", request_id: "previous" }, null, 2),
    "utf8",
  );
  await writeFile(mockBinPath, "#!/usr/bin/env node\nprocess.exitCode = 9;\n", "utf8");
  await chmod(mockBinPath, 0o755);
  await writeFile(
    recordFile,
    JSON.stringify({
      requestId: "queued-request-failed",
      projectPath,
      sessionId: "session-queue",
      message: "Run after the active turn.",
      status: "queued",
      scheduleMode: "queue",
    }, null, 2),
    "utf8",
  );
  await writeFile(
    indexFile,
    JSON.stringify({ requestId: "queued-request-failed", sessionId: "session-queue", file: recordFile }, null, 2),
    "utf8",
  );
  await writeFile(
    itemFile,
    JSON.stringify({
      requestId: "queued-request-failed",
      projectPath,
      sessionId: "session-queue",
      message: "Run after the active turn.",
      clawdadBin: mockBinPath,
      clawdadRoot: root,
      clawdadHome: home,
    }, null, 2),
    "utf8",
  );

  try {
    const child = spawn(process.execPath, [dispatchQueueWorkerScript, "--item-file", itemFile], {
      cwd: repoRoot,
      env: { ...process.env, CLAWDAD_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const result = await new Promise((resolve) => {
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("exit", (code, signal) => resolve({ code, signal, stderr }));
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /exited with code=9/u);
    const failedItem = JSON.parse(await readFile(itemFile, "utf8"));
    assert.equal(failedItem.state, "failed");
    assert.match(failedItem.error, /exited with code=9/u);
    const failedRecord = JSON.parse(await readFile(recordFile, "utf8"));
    assert.equal(failedRecord.status, "failed");
    assert.equal(failedRecord.exitCode, 1);
    assert.match(failedRecord.response, /exited with code=9/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dispatch queue pump preserves FIFO order and recovers a stale owner lock", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-queue-fifo-"));
  const projectPath = path.join(root, "queue-lab");
  const home = path.join(root, "home");
  const queueDir = path.join(projectPath, ".clawdad", "mailbox", "queued");
  const lockDir = path.join(projectPath, ".clawdad", "mailbox", "dispatch-queue.lock");
  const statusPath = path.join(projectPath, ".clawdad", "mailbox", "status.json");
  const mockBinPath = path.join(root, "clawdad-mock.js");
  const capturePath = path.join(root, "capture.jsonl");

  await mkdir(queueDir, { recursive: true });
  await mkdir(lockDir, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(lockDir, "owner.json"),
    JSON.stringify({ pid: 2147483647, startedAt: "2026-07-25T00:00:00.000Z" }, null, 2),
    "utf8",
  );
  await writeFile(
    statusPath,
    JSON.stringify({ state: "completed", request_id: "previous" }, null, 2),
    "utf8",
  );
  await writeFile(
    mockBinPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const requestId = process.env.CLAWDAD_DISPATCH_REQUEST_ID || "";
fs.appendFileSync(${JSON.stringify(capturePath)}, JSON.stringify({
  message: process.argv[4] || "",
  requestId,
}) + "\\n");
fs.writeFileSync(${JSON.stringify(statusPath)}, JSON.stringify({
  state: "completed",
  request_id: requestId,
  session_id: "session-queue",
}, null, 2));
`,
    "utf8",
  );
  await chmod(mockBinPath, 0o755);
  const baseItem = {
    projectPath,
    sessionId: "session-queue",
    clawdadBin: mockBinPath,
    clawdadRoot: root,
    clawdadHome: home,
  };
  await writeFile(
    path.join(queueDir, "z-first.json"),
    JSON.stringify({
      ...baseItem,
      requestId: "queued-first",
      message: "first queued message",
      state: "queued",
      createdAt: "2026-07-25T12:00:00.000Z",
      queueSequence: "0000000000001-00000001",
    }, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(queueDir, "a-second.json"),
    JSON.stringify({
      ...baseItem,
      requestId: "queued-second",
      message: "second queued message",
      state: "queued",
      createdAt: "2026-07-25T12:00:01.000Z",
      queueSequence: "0000000000002-00000002",
    }, null, 2),
    "utf8",
  );

  try {
    const child = spawn(process.execPath, [
      dispatchQueueWorkerScript,
      "--project-path",
      projectPath,
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CLAWDAD_HOME: home,
        CLAWDAD_QUEUE_POLL_MS: "10",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const result = await new Promise((resolve) => {
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("exit", (code, signal) => resolve({ code, signal, stderr }));
    });

    assert.equal(result.code, 0, result.stderr);
    const captures = (await readFile(capturePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(captures, [
      { message: "first queued message", requestId: "queued-first" },
      { message: "second queued message", requestId: "queued-second" },
    ]);
    assert.deepEqual(await readdir(queueDir), []);
    await assert.rejects(readFile(path.join(lockDir, "owner.json"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dispatch queue pump refuses to duplicate an accepted request without mailbox acknowledgement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-queue-no-duplicate-"));
  const projectPath = path.join(root, "queue-lab");
  const home = path.join(root, "home");
  const queueDir = path.join(projectPath, ".clawdad", "mailbox", "queued");
  const itemFile = path.join(queueDir, "queued-request.json");
  const statusPath = path.join(projectPath, ".clawdad", "mailbox", "status.json");
  const mockBinPath = path.join(root, "clawdad-mock.js");
  const capturePath = path.join(root, "capture.jsonl");
  const recordFile = path.join(projectPath, ".clawdad", "history", "sessions", "session-queue", "request.json");
  const indexFile = path.join(projectPath, ".clawdad", "history", "requests", "queued-request.json");

  await mkdir(queueDir, { recursive: true });
  await mkdir(path.dirname(recordFile), { recursive: true });
  await mkdir(path.dirname(indexFile), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(
    statusPath,
    JSON.stringify({ state: "completed", request_id: "previous" }, null, 2),
    "utf8",
  );
  await writeFile(
    mockBinPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(capturePath)}, (process.env.CLAWDAD_DISPATCH_REQUEST_ID || "") + "\\n");
`,
    "utf8",
  );
  await chmod(mockBinPath, 0o755);
  await writeFile(
    recordFile,
    JSON.stringify({
      requestId: "queued-request",
      projectPath,
      sessionId: "session-queue",
      message: "send exactly once",
      status: "queued",
      scheduleMode: "queue",
    }, null, 2),
    "utf8",
  );
  await writeFile(
    indexFile,
    JSON.stringify({ requestId: "queued-request", sessionId: "session-queue", file: recordFile }, null, 2),
    "utf8",
  );
  await writeFile(
    itemFile,
    JSON.stringify({
      requestId: "queued-request",
      projectPath,
      sessionId: "session-queue",
      message: "send exactly once",
      state: "queued",
      createdAt: new Date().toISOString(),
      clawdadBin: mockBinPath,
      clawdadRoot: root,
      clawdadHome: home,
    }, null, 2),
    "utf8",
  );

  try {
    const child = spawn(process.execPath, [
      dispatchQueueWorkerScript,
      "--project-path",
      projectPath,
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CLAWDAD_HOME: home,
        CLAWDAD_QUEUE_POLL_MS: "10",
        CLAWDAD_QUEUE_HANDOFF_TIMEOUT_MS: "50",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const result = await new Promise((resolve) => {
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("exit", (code, signal) => resolve({ code, signal, stderr }));
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal((await readFile(capturePath, "utf8")).trim(), "queued-request");
    const failedItem = JSON.parse(await readFile(itemFile, "utf8"));
    assert.equal(failedItem.state, "failed");
    assert.match(failedItem.error, /refusing to send a duplicate/u);
    const failedRecord = JSON.parse(await readFile(recordFile, "utf8"));
    assert.equal(failedRecord.status, "failed");
    assert.match(failedRecord.response, /refusing to send a duplicate/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("server startup resumes durable queued dispatches left by an earlier process", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-queue-resume-"));
  const projectPath = path.join(root, "queue-lab");
  const home = path.join(root, "home");
  const queueDir = path.join(projectPath, ".clawdad", "mailbox", "queued");
  const statusPath = path.join(projectPath, ".clawdad", "mailbox", "status.json");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock.js");
  const capturePath = path.join(root, "capture.json");

  await mkdir(queueDir, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify({
      version: 3,
      projects: {
        [projectPath]: {
          status: "completed",
          active_session_id: "session-queue",
          sessions: {
            "session-queue": {
              slug: "queue session",
              provider: "codex",
              provider_session_seeded: "false",
              status: "completed",
            },
          },
        },
      },
    }, null, 2),
    "utf8",
  );
  await writeFile(
    statusPath,
    JSON.stringify({ state: "completed", request_id: "previous" }, null, 2),
    "utf8",
  );
  await writeFile(
    mockBinPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const requestId = process.env.CLAWDAD_DISPATCH_REQUEST_ID || "";
fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({
  message: process.argv[4] || "",
  requestId,
}, null, 2));
fs.writeFileSync(${JSON.stringify(statusPath)}, JSON.stringify({
  state: "completed",
  request_id: requestId,
  session_id: "session-queue",
}, null, 2));
`,
    "utf8",
  );
  await chmod(mockBinPath, 0o755);
  await writeFile(
    path.join(queueDir, "queued-on-restart.json"),
    JSON.stringify({
      requestId: "queued-on-restart",
      projectPath,
      sessionId: "session-queue",
      message: "resume me after restart",
      state: "queued",
      createdAt: "2026-07-25T12:00:00.000Z",
      clawdadBin: mockBinPath,
      clawdadRoot: root,
      clawdadHome: home,
    }, null, 2),
    "utf8",
  );

  const port = await freePort();
  await writeFile(
    configPath,
    JSON.stringify({
      host: "127.0.0.1",
      port,
      defaultProject: projectPath,
      authMode: "tailscale",
      allowedUsers: ["tester@example.com"],
    }, null, 2),
    "utf8",
  );
  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
      CLAWDAD_QUEUE_POLL_MS: "10",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForHealth(`http://127.0.0.1:${port}`, child);
    const captured = JSON.parse(await waitForFileText(capturePath));
    assert.deepEqual(captured, {
      message: "resume me after restart",
      requestId: "queued-on-restart",
    });
    await waitForDirectoryEmpty(queueDir);
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
      CLAWDAD_TTS_ENABLED: "false",
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
        heartbeat_at: new Date().toISOString(),
        pid: null,
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
      CLAWDAD_TTS_ENABLED: "false",
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
      CLAWDAD_TTS_ENABLED: "false",
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

test("status endpoint stale-fails live pid mailboxes with no heartbeat after timeout", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-live-pid-no-heartbeat-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "nvidia");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const sessionId = "019d64ef-0f73-7423-9406-5266d6f7efee";
  const requestId = "45017928-ad44-4a91-a7b4-6d8fb6e2e1dc";
  const oldDispatch = "2026-05-04T00:00:00.000Z";

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
  const liveWorker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
    stdio: "ignore",
  });
  liveWorker.unref();

  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectPath]: {
            status: "running",
            active_session_id: sessionId,
            sessions: {
              [sessionId]: {
                slug: "main mind",
                provider: "codex",
                provider_session_seeded: "true",
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
        dispatched_at: oldDispatch,
        heartbeat_at: null,
        pid: liveWorker.pid,
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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
      CLAWDAD_STALE_DISPATCH_TIMEOUT_MS: "1000",
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
    assert.equal(payload.mailboxStatus.state, "failed");
    assert.match(payload.mailboxStatus.error, /no heartbeat/u);
  } finally {
    if (liveWorker.exitCode == null) {
      liveWorker.kill("SIGKILL");
    }
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
      CLAWDAD_TTS_ENABLED: "false",
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

test("read endpoint can fetch an exact completed request while latest mailbox is running", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-read-exact-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "global-mind");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const completedSessionId = "019d64ef-0f73-7423-9406-5266d6f7efee";
  const runningSessionId = "019d64ef-0f73-7423-9406-5266d6f7abcd";
  const completedRequestId = "45017928-ad44-4a91-a7b4-6d8fb6e2e1dc";
  const runningRequestId = "d57cdaaa-7371-447b-96e6-3af0992fc14a";
  const sentAt = "2026-04-29T00:00:34Z";
  const answeredAt = "2026-04-29T00:01:15Z";
  const runningAt = new Date().toISOString();
  const completedAnswer = "Exact completed answer.";
  const recordFile = path.join(
    projectPath,
    ".clawdad",
    "history",
    "sessions",
    completedSessionId,
    `20260429T000034Z--${completedRequestId}.json`,
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
            status: "running",
            last_dispatch: runningAt,
            last_response: answeredAt,
            dispatch_count: 2,
            registered_at: sentAt,
            active_session_id: runningSessionId,
            sessions: {
              [completedSessionId]: {
                slug: "completed mind",
                provider: "codex",
                provider_session_seeded: "true",
                tracked_at: sentAt,
                dispatch_count: 1,
                last_dispatch: sentAt,
                last_response: answeredAt,
                status: "completed",
                local_only: "false",
              },
              [runningSessionId]: {
                slug: "running mind",
                provider: "codex",
                provider_session_seeded: "true",
                tracked_at: sentAt,
                dispatch_count: 1,
                last_dispatch: runningAt,
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
        request_id: runningRequestId,
        session_id: runningSessionId,
        dispatched_at: runningAt,
        heartbeat_at: runningAt,
        pid: null,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    path.join(projectPath, ".clawdad", "history", "requests", `${completedRequestId}.json`),
    JSON.stringify({ requestId: completedRequestId, sessionId: completedSessionId, sentAt, file: recordFile }, null, 2),
    "utf8",
  );
  await writeFile(
    recordFile,
    JSON.stringify(
      {
        requestId: completedRequestId,
        projectPath,
        sessionId: completedSessionId,
        sessionSlug: "completed mind",
        provider: "codex",
        message: "Give me the exact completed answer.",
        sentAt,
        answeredAt,
        status: "answered",
        exitCode: 0,
        response: completedAnswer,
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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = { "tailscale-user-login": "tester@example.com" };
    await waitForHealth(baseUrl, child);

    const latestResponse = await fetch(
      `${baseUrl}/v1/read?project=${encodeURIComponent(projectPath)}&raw=1`,
      { headers },
    );
    assert.equal(latestResponse.status, 200);
    const latestPayload = await latestResponse.json();
    assert.equal(latestPayload.output, "");
    assert.equal(latestPayload.mailboxStatus.request_id, runningRequestId);

    const exactResponse = await fetch(
      `${baseUrl}/v1/read?project=${encodeURIComponent(projectPath)}&requestId=${encodeURIComponent(completedRequestId)}&raw=1`,
      { headers },
    );
    assert.equal(exactResponse.status, 200);
    const exactPayload = await exactResponse.json();
    assert.equal(exactPayload.source, "history");
    assert.equal(exactPayload.output, completedAnswer);
    assert.equal(exactPayload.historyItem.requestId, completedRequestId);
    assert.equal(exactPayload.historyItem.sessionId, completedSessionId);
    assert.equal(exactPayload.mailboxStatus.request_id, runningRequestId);
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("history endpoint merges delayed Queue requests with provider transcript handoff copies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-history-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "clawdad");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const sessionId = "019d564e-ec8d-7d80-8303-ed4f17090c35";
  const requestId = "ab126c08-6f1b-4da7-9162-6ec5ddb6f034";
  const message = "Please fix the duplicate card.";
  const providerMessage = `${message}

[Clawdad attachment handoff:
- screen.png (image/png, 123 bytes): ${projectPath}/.clawdad/attachments/upload/screen.png
Images are also attached to Codex directly when supported. For non-image files, use the local file paths above.]

<image name=[Image #1]>

</image>`;

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
        sentAt: "2026-04-16T21:50:32Z",
        answeredAt: "2026-04-16T21:58:11Z",
        status: "answered",
        exitCode: 0,
        response: "Final answer.",
        scheduleMode: "queue",
        deliveryMechanism: "queued_worker",
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
        timestamp: "2026-04-16T21:58:10.187Z",
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
      CLAWDAD_TTS_ENABLED: "false",
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
    assert.equal(payload.items[0].scheduleMode, "queue");
    assert.equal(payload.items[0].deliveryMechanism, "queued_worker");
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("history endpoint ignores Codex commentary when building provider transcript turns", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-history-phase-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "clawdad");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const sessionId = "019e0000-1111-7000-8000-000000000003";
  const provisionalSessionId = "e43a8ddb-58bb-4a99-b20f-087b1ddb0801";
  const completedMessage = "Please compare OpenClaw and Clawdad.";
  const liveMessage = "Are you still there?";

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(path.join(home, ".codex", "sessions", "2026", "05", "03"), { recursive: true });
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectPath]: {
            status: "completed",
            last_dispatch: "2026-05-03T15:00:00Z",
            last_response: "2026-05-03T15:05:00Z",
            dispatch_count: 2,
            registered_at: "2026-05-03T00:00:00Z",
            active_session_id: sessionId,
            session_aliases: {
              [provisionalSessionId]: sessionId,
            },
            sessions: {
              [sessionId]: {
                slug: "Main-claw",
                provider: "codex",
                provider_session_seeded: "true",
                tracked_at: "2026-05-03T00:00:00Z",
                dispatch_count: 2,
                last_dispatch: "2026-05-03T15:00:00Z",
                last_response: "2026-05-03T15:05:00Z",
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
    path.join(home, ".codex", "sessions", "2026", "05", "03", `rollout-${sessionId}.jsonl`),
    [
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-05-03T14:59:59.000Z",
        payload: { type: "task_started" },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-05-03T14:59:59.500Z",
        payload: {
          type: "message",
          role: "user",
          content: [{
            type: "input_text",
            text: "<recommended_plugins>internal plugin recommendations</recommended_plugins>",
          }],
        },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-05-03T15:00:00.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: completedMessage }],
        },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-05-03T15:00:00.010Z",
        payload: {
          type: "user_message",
          message: completedMessage,
          images: [],
        },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-05-03T15:09:59.000Z",
        payload: { type: "task_started" },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-05-03T15:09:59.500Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "# AGENTS.md instructions for /internal" }],
        },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-05-03T15:00:03.000Z",
        payload: {
          type: "message",
          role: "assistant",
          phase: "commentary",
          content: [{ type: "output_text", text: "I’ll verify public docs first." }],
        },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-05-03T15:05:00.000Z",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          content: [{ type: "output_text", text: "Detailed comparison result." }],
        },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-05-03T15:10:00.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: liveMessage }],
        },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-05-03T15:10:00.010Z",
        payload: {
          type: "user_message",
          message: liveMessage,
          images: [],
        },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-05-03T15:10:03.000Z",
        payload: {
          type: "message",
          role: "assistant",
          phase: "commentary",
          content: [{ type: "output_text", text: "I’m checking the app path now." }],
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
      CLAWDAD_TTS_ENABLED: "false",
      HOME: home,
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const response = await fetch(
      `${baseUrl}/v1/history?project=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(provisionalSessionId)}&cursor=0&limit=10`,
      {
        headers: {
          "tailscale-user-login": "tester@example.com",
        },
      },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.requestedSessionId, provisionalSessionId);
    assert.equal(payload.sessionId, sessionId);
    assert.equal(payload.sessionRekeyed, true);
    assert.equal(payload.total, 2);
    assert.doesNotMatch(JSON.stringify(payload.items), /recommended_plugins|AGENTS\.md instructions/u);

    const completed = payload.items.find((item) => item.message === completedMessage);
    assert.equal(completed?.status, "answered");
    assert.equal(completed.response, "Detailed comparison result.");
    assert.doesNotMatch(completed.response, /verify public docs/u);

    const live = payload.items.find((item) => item.message === liveMessage);
    assert.equal(live?.status, "working");
    assert.equal(live.response, "");
    assert.equal(live.answeredAt, null);
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("history endpoint bounds giant Codex transcripts to a recent readable window", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-history-bounded-tail-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "ascension-free-pick");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const sessionId = "019f763a-d5b5-7080-85c0-3cceae4b8c39";
  const sessionDir = path.join(home, ".codex", "sessions", "2026", "07", "18");
  const transcriptPath = path.join(sessionDir, `rollout-${sessionId}.jsonl`);

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectPath]: {
            status: "idle",
            registered_at: "2026-07-18T17:16:35Z",
            active_session_id: sessionId,
            sessions: {
              [sessionId]: {
                slug: "ascension-free-pick",
                provider: "codex",
                provider_session_seeded: "true",
                provider_last_activity: "2026-07-19T16:20:00Z",
                tracked_at: "2026-07-18T17:16:35Z",
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
    JSON.stringify(
      {
        state: "failed",
        request_id: "failed-before-native-recovery",
        session_id: sessionId,
        completed_at: "2026-07-19T14:50:03Z",
        error: "timed out waiting for thread/resume",
      },
      null,
      2,
    ),
    "utf8",
  );

  const messageLine = ({ timestamp, role, text, phase = "" }) => JSON.stringify({
    timestamp,
    type: "response_item",
    payload: {
      type: "message",
      role,
      ...(phase ? { phase } : {}),
      content: [{ type: role === "user" ? "input_text" : "output_text", text }],
    },
  });
  await writeFile(
    transcriptPath,
    [
      JSON.stringify({
        timestamp: "2026-07-18T17:16:35.125Z",
        type: "session_meta",
        payload: {
          id: sessionId,
          timestamp: "2026-07-18T17:16:35.125Z",
          cwd: projectPath,
          source: "cli",
        },
      }),
      messageLine({ timestamp: "2026-07-18T18:00:00Z", role: "user", text: "Old prompt outside the bounded tail." }),
      messageLine({ timestamp: "2026-07-18T18:01:00Z", role: "assistant", phase: "final_answer", text: "Old answer." }),
      JSON.stringify({
        timestamp: "2026-07-19T15:59:00Z",
        type: "compacted",
        payload: { replacement_history: [{ image_url: `data:image/png;base64,${"a".repeat(600_000)}` }] },
      }),
      messageLine({ timestamp: "2026-07-19T16:19:09Z", role: "user", text: "Recent prompt remains readable." }),
      messageLine({ timestamp: "2026-07-19T16:20:00Z", role: "assistant", phase: "final_answer", text: "Recent answer." }),
    ].join("\n") + "\n",
    "utf8",
  );
  await writeFile(mockBinPath, "#!/bin/sh\nexit 1\n", "utf8");
  await chmod(mockBinPath, 0o755);

  const port = await freePort();
  await writeFile(
    configPath,
    JSON.stringify({
      host: "127.0.0.1",
      port,
      defaultProject: projectPath,
      authMode: "tailscale",
      allowedUsers: ["tester@example.com"],
    }),
    "utf8",
  );

  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HISTORY_PROVIDER_TAIL_BYTES: "262144",
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
    const headers = { "tailscale-user-login": "tester@example.com" };
    const historyResponse = await fetch(
      `${baseUrl}/v1/history?project=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}&cursor=0&limit=10`,
      { headers },
    );
    assert.equal(historyResponse.status, 200, stderr.join(""));
    const historyPayload = await historyResponse.json();
    assert.equal(historyPayload.ok, true);
    assert.equal(historyPayload.total, 1);
    assert.equal(historyPayload.items[0]?.message, "Recent prompt remains readable.");
    assert.equal(historyPayload.items[0]?.response, "Recent answer.");

    const statusResponse = await fetch(
      `${baseUrl}/v1/status?project=${encodeURIComponent(projectPath)}`,
      { headers },
    );
    assert.equal(statusResponse.status, 200, stderr.join(""));
    const statusPayload = await statusResponse.json();
    assert.equal(statusPayload.mailboxStatus.state, "idle");
    assert.equal(statusPayload.mailboxStatus.last_request_state, "failed");
    assert.equal(statusPayload.mailboxStatus.superseded_by_provider_activity, true);
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("recent history keeps provider request ids stable when reading transcript tails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-recent-history-tail-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "clawdad");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const sessionId = "019e0000-1111-7000-8000-000000000004";
  const latestMessage = "This latest message should keep the same anchor.";

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(path.join(home, ".codex", "sessions", "2026", "05", "06"), { recursive: true });
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectPath]: {
            status: "completed",
            last_dispatch: "2026-05-06T03:49:41Z",
            last_response: "2026-05-06T03:51:08Z",
            dispatch_count: 1,
            registered_at: "2026-05-06T00:00:00Z",
            active_session_id: sessionId,
            sessions: {
              [sessionId]: {
                slug: "Main-claw",
                provider: "codex",
                provider_session_seeded: "true",
                tracked_at: "2026-05-06T00:00:00Z",
                dispatch_count: 1,
                last_dispatch: "2026-05-06T03:49:41Z",
                last_response: "2026-05-06T03:51:08Z",
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

  const codexMessageLine = ({ timestamp, role, text, phase = "" }) =>
    JSON.stringify({
      type: "response_item",
      timestamp,
      payload: {
        type: "message",
        role,
        ...(phase ? { phase } : {}),
        content: [
          {
            type: role === "user" ? "input_text" : "output_text",
            text,
          },
        ],
      },
    });
  const oldTurns = Array.from({ length: 900 }, (_item, index) => {
    const sentAt = new Date(Date.UTC(2026, 4, 5, 0, 0, index * 2)).toISOString();
    const answeredAt = new Date(Date.UTC(2026, 4, 5, 0, 0, index * 2 + 1)).toISOString();
    const filler = `old filler turn ${index} `.repeat(8);
    return [
      codexMessageLine({ timestamp: sentAt, role: "user", text: `Old prompt ${index}. ${filler}` }),
      codexMessageLine({
        timestamp: answeredAt,
        role: "assistant",
        phase: "final_answer",
        text: `Old answer ${index}. ${filler}`,
      }),
    ];
  }).flat();
  const latestLines = [
    codexMessageLine({
      timestamp: "2026-05-06T03:49:41.000Z",
      role: "user",
      text: latestMessage,
    }),
    codexMessageLine({
      timestamp: "2026-05-06T03:51:08.000Z",
      role: "assistant",
      phase: "final_answer",
      text: "Latest answer.",
    }),
  ];
  await writeFile(
    path.join(home, ".codex", "sessions", "2026", "05", "06", `rollout-${sessionId}.jsonl`),
    [...oldTurns, ...latestLines].join("\n") + "\n",
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
      CLAWDAD_TTS_ENABLED: "false",
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
    const historyResponse = await fetch(
      `${baseUrl}/v1/history?project=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}&cursor=0&limit=5`,
      {
        headers: {
          "tailscale-user-login": "tester@example.com",
        },
      },
    );
    assert.equal(historyResponse.status, 200, stderr.join(""));
    const historyPayload = await historyResponse.json();
    const fullLatest = historyPayload.items.find((item) => item.message === latestMessage);
    assert.ok(fullLatest?.requestId);

    const recentResponse = await fetch(
      `${baseUrl}/v1/history/recent?project=${encodeURIComponent(projectPath)}&limit=1&sessionLimit=1&perSessionLimit=1`,
      {
        headers: {
          "tailscale-user-login": "tester@example.com",
        },
      },
    );
    assert.equal(recentResponse.status, 200, stderr.join(""));
    const recentPayload = await recentResponse.json();
    assert.equal(recentPayload.items[0]?.message, latestMessage);
    assert.equal(recentPayload.items[0]?.requestId, fullLatest.requestId);
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("recent history endpoint returns server-backed prompt cards across tracked sessions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-recent-history-"));
  const home = path.join(root, "home");
  const projectAlpha = path.join(root, "alpha");
  const projectBeta = path.join(root, "beta");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const alphaSessionId = "019e0000-0000-7000-8000-000000000001";
  const betaSessionId = "019e0000-0000-7000-8000-000000000002";

  await mkdir(path.join(projectAlpha, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(path.join(projectBeta, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(path.join(projectAlpha, ".clawdad", "history", "sessions", alphaSessionId), { recursive: true });
  await mkdir(path.join(projectBeta, ".clawdad", "history", "sessions", betaSessionId), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify(
      {
        version: 3,
        projects: {
          [projectAlpha]: {
            status: "completed",
            last_dispatch: "2026-05-02T10:00:00Z",
            last_response: "2026-05-02T10:12:00Z",
            dispatch_count: 2,
            registered_at: "2026-05-02T00:00:00Z",
            active_session_id: alphaSessionId,
            sessions: {
              [alphaSessionId]: {
                slug: "Alpha",
                provider: "codex",
                provider_session_seeded: "true",
                tracked_at: "2026-05-02T00:00:00Z",
                dispatch_count: 2,
                last_dispatch: "2026-05-02T10:00:00Z",
                last_response: "2026-05-02T10:12:00Z",
                status: "completed",
              },
            },
          },
          [projectBeta]: {
            status: "completed",
            last_dispatch: "2026-05-02T10:05:00Z",
            last_response: "2026-05-02T10:08:00Z",
            dispatch_count: 1,
            registered_at: "2026-05-02T00:00:00Z",
            active_session_id: betaSessionId,
            sessions: {
              [betaSessionId]: {
                slug: "Beta",
                provider: "codex",
                provider_session_seeded: "true",
                tracked_at: "2026-05-02T00:00:00Z",
                dispatch_count: 1,
                last_dispatch: "2026-05-02T10:05:00Z",
                last_response: "2026-05-02T10:08:00Z",
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
    path.join(projectAlpha, ".clawdad", "history", "sessions", alphaSessionId, "20260502T100000Z--alpha-old.json"),
    JSON.stringify(
      {
        requestId: "alpha-old",
        projectPath: projectAlpha,
        sessionId: alphaSessionId,
        sessionSlug: "Alpha",
        provider: "codex",
        message: "older alpha prompt",
        sentAt: "2026-05-02T10:00:00Z",
        answeredAt: "2026-05-02T10:01:00Z",
        status: "answered",
        response: "older alpha answer",
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    path.join(projectAlpha, ".clawdad", "history", "sessions", alphaSessionId, "20260502T101000Z--alpha-new.json"),
    JSON.stringify(
      {
        requestId: "alpha-new",
        projectPath: projectAlpha,
        sessionId: alphaSessionId,
        sessionSlug: "Alpha",
        provider: "codex",
        message: "newest alpha prompt",
        sentAt: "2026-05-02T10:10:00Z",
        answeredAt: "2026-05-02T10:12:00Z",
        status: "answered",
        response: "newest alpha answer",
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    path.join(projectBeta, ".clawdad", "history", "sessions", betaSessionId, "20260502T100500Z--beta.json"),
    JSON.stringify(
      {
        requestId: "beta",
        projectPath: projectBeta,
        sessionId: betaSessionId,
        sessionSlug: "Beta",
        provider: "codex",
        message: "middle beta prompt",
        sentAt: "2026-05-02T10:05:00Z",
        answeredAt: "2026-05-02T10:08:00Z",
        status: "answered",
        response: "middle beta answer",
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
        defaultProject: projectAlpha,
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
      CLAWDAD_TTS_ENABLED: "false",
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
      `${baseUrl}/v1/history/recent?limit=2&sessionLimit=2&perSessionLimit=2`,
      {
        headers: {
          "tailscale-user-login": "tester@example.com",
        },
      },
    );
    assert.equal(response.status, 200, stderr.join(""));
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.items.map((item) => item.requestId), ["alpha-new", "beta"]);

    const projectResponse = await fetch(
      `${baseUrl}/v1/history/recent?project=${encodeURIComponent(projectBeta)}&limit=5`,
      {
        headers: {
          "tailscale-user-login": "tester@example.com",
        },
      },
    );
    assert.equal(projectResponse.status, 200);
    const projectPayload = await projectResponse.json();
    assert.equal(projectPayload.ok, true);
    assert.deepEqual(projectPayload.items.map((item) => item.requestId), ["beta"]);
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
      CLAWDAD_TTS_ENABLED: "false",
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

test("importable-sessions endpoint caches repeated local Codex discovery", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-importable-cache-"));
  const home = path.join(root, "home");
  const codexHome = path.join(root, "codex-home");
  const projectPath = path.join(root, "clawdad");
  const configPath = path.join(root, "server.json");
  const trackedSessionId = "019d57e8-8947-7dd1-ba76-55a23c4e6292";
  const importSessionId = "019d57e8-8947-7dd1-ba76-55a23c4e6293";

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeCodexSession(codexHome, projectPath, importSessionId, {
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
            active_session_id: trackedSessionId,
            sessions: {
              [trackedSessionId]: {
                slug: "clawdad",
                provider: "codex",
                provider_session_seeded: "true",
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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_CODEX_HOME: codexHome,
      CLAWDAD_IMPORTABLE_SESSION_LIST_CACHE_TTL_MS: "60000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const projectParam = encodeURIComponent(projectPath);
    const firstResponse = await fetch(`${baseUrl}/v1/importable-sessions?project=${projectParam}`, {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    assert.equal(firstResponse.status, 200);
    const firstPayload = await firstResponse.json();
    assert.equal(firstPayload.ok, true);
    assert.equal(firstPayload.cached, false);
    assert.deepEqual(firstPayload.sessions.map((session) => session.sessionId), [importSessionId]);

    await rm(path.join(codexHome, "sessions"), { recursive: true, force: true });

    const secondResponse = await fetch(`${baseUrl}/v1/importable-sessions?project=${projectParam}`, {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    assert.equal(secondResponse.status, 200);
    const secondPayload = await secondResponse.json();
    assert.equal(secondPayload.ok, true);
    assert.equal(secondPayload.cached, true);
    assert.deepEqual(secondPayload.sessions.map((session) => session.sessionId), [importSessionId]);

    const forceResponse = await fetch(`${baseUrl}/v1/importable-sessions?project=${projectParam}&force=1`, {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    assert.equal(forceResponse.status, 200);
    const forcePayload = await forceResponse.json();
    assert.equal(forcePayload.ok, true);
    assert.equal(forcePayload.cached, false);
    assert.deepEqual(forcePayload.sessions, []);
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
      CLAWDAD_TTS_ENABLED: "false",
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

test("projects endpoint synchronously adopts native Codex threads for the selected workspace project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-selected-project-sync-"));
  const home = path.join(root, "home");
  const codexHome = path.join(root, "codex-home");
  const projectRoot = path.join(root, "code");
  const projectPath = path.join(projectRoot, "Worldwrought");
  const configPath = path.join(root, "server.json");
  const sessionId = "019f5900-42ce-7e23-8680-855bdbfcddd3";

  await mkdir(projectPath, { recursive: true });
  await mkdir(home, { recursive: true });
  const canonicalProjectRoot = await realpath(projectRoot);
  const canonicalProjectPath = await realpath(projectPath);
  await writeCodexSession(codexHome, canonicalProjectPath, sessionId, {
    timestamp: "2026-07-13T01:03:37.166Z",
  });
  await writeFile(
    configPath,
    JSON.stringify(
      {
        host: "127.0.0.1",
        port: await freePort(),
        defaultProject: canonicalProjectRoot,
        primaryProjectRoot: canonicalProjectRoot,
        projectRoots: [canonicalProjectRoot],
        authMode: "tailscale",
        allowedUsers: ["tester@example.com"],
      },
      null,
      2,
    ),
    "utf8",
  );

  const config = JSON.parse(await readFile(configPath, "utf8"));
  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_CODEX_HOME: codexHome,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${config.port}`;
    await waitForHealth(baseUrl, child);
    const response = await fetch(
      `${baseUrl}/v1/projects?lean=1&syncProject=${encodeURIComponent(canonicalProjectPath)}`,
      {
        headers: {
          "tailscale-user-login": "tester@example.com",
        },
      },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.catalogLean, true);
    assert.equal(payload.sessionSyncProject, canonicalProjectPath);
    assert.equal(payload.sessionSyncFound, true);
    assert.equal(payload.sessionSyncCount, 1);

    const project = payload.projects.find((entry) => entry.path === canonicalProjectPath);
    assert.ok(project);
    assert.equal(project.untracked, undefined);
    assert.equal(project.activeSessionId, sessionId);
    assert.deepEqual(project.sessions.map((session) => session.sessionId), [sessionId]);

    const state = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
    assert.equal(state.projects[canonicalProjectPath].active_session_id, sessionId);
    assert.equal(state.projects[canonicalProjectPath].sessions[sessionId].provider, "codex");
    assert.equal(state.projects[canonicalProjectPath].sessions[sessionId].provider_session_seeded, "true");
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("projects endpoint cools down missed background Codex discovery for placeholder sessions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-auto-import-miss-"));
  const home = path.join(root, "home");
  const codexHome = path.join(root, "codex-home");
  const projectPath = path.join(root, "mtg-decklab");
  const configPath = path.join(root, "server.json");

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(path.join(codexHome, "sessions"), { recursive: true });
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
            registered_at: "2026-05-01T00:00:00Z",
            active_session_id: "placeholder-session",
            sessions: {
              "placeholder-session": {
                slug: "mtg-decklab",
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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_CODEX_HOME: codexHome,
      CLAWDAD_PROJECT_SESSION_AUTO_IMPORT_TTL_MS: "0",
      CLAWDAD_PROJECT_SESSION_AUTO_IMPORT_MISS_TTL_MS: "60000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const firstResponse = await fetch(`${baseUrl}/v1/projects`, {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    assert.equal(firstResponse.status, 200);
    const firstPayload = await firstResponse.json();
    assert.equal(firstPayload.ok, true);
    assert.equal(firstPayload.autoImportScheduled, true);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const secondResponse = await fetch(`${baseUrl}/v1/projects`, {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    assert.equal(secondResponse.status, 200);
    const secondPayload = await secondResponse.json();
    assert.equal(secondPayload.ok, true);
    assert.equal(secondPayload.autoImportScheduled, false);
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("projects endpoint skips background Codex discovery when sessions are already seeded", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-auto-import-skip-"));
  const home = path.join(root, "home");
  const codexHome = path.join(root, "codex-home");
  const projectPath = path.join(root, "clawdad");
  const configPath = path.join(root, "server.json");
  const seededSessionId = "019d57e8-8947-7dd1-ba76-55a23c4e6292";
  const importSessionId = "019d57e8-8947-7dd1-ba76-55a23c4e6293";

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeCodexSession(codexHome, projectPath, importSessionId, {
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
            active_session_id: seededSessionId,
            sessions: {
              [seededSessionId]: {
                slug: "clawdad",
                provider: "codex",
                provider_session_seeded: "true",
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
      CLAWDAD_TTS_ENABLED: "false",
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
    assert.equal(payload.autoImportScheduled, false);
    assert.equal(payload.projects[0].sessions.some((session) => session.sessionId === importSessionId), false);

    await new Promise((resolve) => setTimeout(resolve, 300));
    const state = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
    assert.equal(state.projects[projectPath].sessions[importSessionId], undefined);
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace setup saves a primary projects folder and exposes Scratchpad plus child directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-workspace-setup-"));
  const home = path.join(root, "home");
  const codexHome = path.join(root, "codex-home");
  const projectRoot = path.join(root, "code");
  const emptyProjectPath = path.join(projectRoot, "empty-idea");
  const extraRoot = path.join(root, "client-work");
  const extraProjectPath = path.join(extraRoot, "client-alpha");
  const configPath = path.join(root, "server.json");
  const emptyProjectSessionId = "workspace-empty-project-session";
  const extraProjectSessionId = "workspace-extra-project-session";

  await mkdir(emptyProjectPath, { recursive: true });
  await mkdir(extraProjectPath, { recursive: true });
  await mkdir(home, { recursive: true });
  const canonicalWorkspaceParent = await realpath(root);
  const canonicalProjectRoot = await realpath(projectRoot);
  const canonicalEmptyProjectPath = await realpath(emptyProjectPath);
  const canonicalExtraRoot = await realpath(extraRoot);
  const canonicalExtraProjectPath = await realpath(extraProjectPath);
  const emptyProjectSessionFile = await writeCodexSession(
    codexHome,
    canonicalEmptyProjectPath,
    emptyProjectSessionId,
  );
  const extraProjectSessionFile = await writeCodexSession(
    codexHome,
    canonicalExtraProjectPath,
    extraProjectSessionId,
  );
  await utimes(
    emptyProjectSessionFile,
    new Date("2026-05-02T12:00:00.000Z"),
    new Date("2026-05-02T12:00:00.000Z"),
  );
  await utimes(
    extraProjectSessionFile,
    new Date("2026-05-03T12:00:00.000Z"),
    new Date("2026-05-03T12:00:00.000Z"),
  );

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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_CODEX_HOME: codexHome,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = {
      "content-type": "application/json",
      "tailscale-user-login": "tester@example.com",
    };
    await waitForHealth(baseUrl, child);

    const firstProjectsResponse = await fetch(`${baseUrl}/v1/projects`, {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    assert.equal(firstProjectsResponse.status, 200);
    const firstProjectsPayload = await firstProjectsResponse.json();
    assert.equal(firstProjectsPayload.ok, true);
    assert.equal(firstProjectsPayload.workspace.setupRequired, true);
    assert.deepEqual(firstProjectsPayload.recentThreads, []);

    const setupResponse = await fetch(`${baseUrl}/v1/workspace`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ primaryRoot: projectRoot }),
    });
    assert.equal(setupResponse.status, 200);
    const setupPayload = await setupResponse.json();
    assert.equal(setupPayload.ok, true);
    assert.equal(setupPayload.workspace.setupRequired, false);
    assert.equal(setupPayload.workspace.primaryRoot, canonicalProjectRoot);

    const directoryResponse = await fetch(`${baseUrl}/v1/workspace/directories?path=${encodeURIComponent(projectRoot)}`, {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    assert.equal(directoryResponse.status, 200);
    const directoryPayload = await directoryResponse.json();
    assert.equal(directoryPayload.ok, true);
    assert.equal(directoryPayload.path, canonicalProjectRoot);
    assert.equal(directoryPayload.parent, canonicalWorkspaceParent);
    assert.ok(directoryPayload.roots.some((entry) => entry.path === canonicalProjectRoot));
    assert.ok(directoryPayload.entries.some((entry) => entry.path === canonicalEmptyProjectPath));

    let config = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(config.primaryProjectRoot, canonicalProjectRoot);
    assert.deepEqual(config.projectRoots, []);
    assert.equal(config.defaultProject, canonicalProjectRoot);
    assert.equal(setupPayload.workspace.primaryRoot, config.defaultProject);
    assert.deepEqual(setupPayload.workspace.roots.map((entry) => entry.path), []);

    const separateRootResponse = await fetch(`${baseUrl}/v1/workspace`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        primaryRoot: projectRoot,
        projectRoots: [extraRoot],
      }),
    });
    assert.equal(separateRootResponse.status, 200);
    const separateRootPayload = await separateRootResponse.json();
    assert.equal(separateRootPayload.ok, true);
    assert.equal(separateRootPayload.workspace.primaryRoot, canonicalProjectRoot);
    assert.deepEqual(
      separateRootPayload.workspace.roots.map((entry) => entry.path),
      [canonicalExtraRoot],
    );
    config = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(config.primaryProjectRoot, canonicalProjectRoot);
    assert.deepEqual(config.projectRoots, [canonicalExtraRoot]);

    const multiRootResponse = await fetch(`${baseUrl}/v1/workspace`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        primaryRoot: projectRoot,
        projectRoots: [projectRoot, extraRoot],
      }),
    });
    assert.equal(multiRootResponse.status, 200);
    const multiRootPayload = await multiRootResponse.json();
    assert.equal(multiRootPayload.ok, true);
    assert.equal(multiRootPayload.workspace.primaryRoot, canonicalProjectRoot);
    assert.deepEqual(
      multiRootPayload.workspace.roots.map((entry) => entry.path),
      [canonicalProjectRoot, canonicalExtraRoot],
    );
    config = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(config.primaryProjectRoot, canonicalProjectRoot);
    assert.deepEqual(config.projectRoots, [canonicalProjectRoot, canonicalExtraRoot]);
    assert.equal(config.defaultProject, canonicalProjectRoot);

    const projectsResponse = await fetch(`${baseUrl}/v1/projects`, {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    assert.equal(projectsResponse.status, 200);
    const projectsPayload = await projectsResponse.json();
    assert.equal(projectsPayload.workspace.primaryRoot, canonicalProjectRoot);
    assert.equal(projectsPayload.autoImportScheduled, false);
    assert.deepEqual(
      projectsPayload.recentThreads.slice(0, 2).map((thread) => thread.sessionId),
      [extraProjectSessionId, emptyProjectSessionId],
    );

    const scratchpad = projectsPayload.projects.find((project) => project.specialRole === "scratchpad");
    assert.ok(scratchpad);
    assert.equal(scratchpad.path, canonicalProjectRoot);
    assert.equal(scratchpad.displayName, "Scratchpad");
    assert.equal(scratchpad.activeSessionLabel, "Scratchpad Chat");
    assert.equal(scratchpad.workspaceRootPath, canonicalProjectRoot);

    const emptyProject = projectsPayload.projects.find((project) => project.path === canonicalEmptyProjectPath);
    assert.ok(emptyProject);
    assert.equal(emptyProject.untracked, true);
    assert.equal(emptyProject.displayName, "empty-idea");
    assert.equal(emptyProject.workspaceRootPath, canonicalProjectRoot);

    const extraProject = projectsPayload.projects.find((project) => project.path === canonicalExtraProjectPath);
    assert.ok(extraProject);
    assert.equal(extraProject.untracked, true);
    assert.equal(extraProject.displayName, "client-alpha");
    assert.equal(extraProject.workspaceRootPath, canonicalExtraRoot);

    const rootsResponse = await fetch(`${baseUrl}/v1/project-roots`, {
      headers: {
        "tailscale-user-login": "tester@example.com",
      },
    });
    assert.equal(rootsResponse.status, 200);
    const rootsPayload = await rootsResponse.json();
    assert.equal(rootsPayload.workspace.primaryRoot, canonicalProjectRoot);
    assert.equal(rootsPayload.roots.length, 2);
    assert.ok(
      rootsPayload.roots[0].repos.some(
        (repo) => repo.path === canonicalEmptyProjectPath && repo.name === "empty-idea" && repo.looksProject === false,
      ),
    );
    assert.ok(
      rootsPayload.roots[1].repos.some(
        (repo) => repo.path === canonicalExtraProjectPath && repo.name === "client-alpha" && repo.looksProject === false,
      ),
    );

    assert.match(
      await readFile(path.join(canonicalProjectRoot, ".clawdad", "mailbox", "status.json"), "utf8"),
      /"state": "idle"/u,
    );
    await assert.rejects(readFile(path.join(canonicalProjectRoot, "AGENTS.md"), "utf8"), { code: "ENOENT" });
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("token auth issues a loopback native session cookie for app assets and APIs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-native-session-"));
  const home = path.join(root, "home");
  const configPath = path.join(root, "server.json");
  const tokenFile = path.join(root, "server.token");
  const token = "native-session-token";
  await mkdir(home, { recursive: true });
  await writeFile(tokenFile, `${token}\n`, "utf8");

  const port = await freePort();
  await writeFile(
    configPath,
    JSON.stringify(
      {
        host: "127.0.0.1",
        port,
        authMode: "token",
        tokenFile,
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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);

    const unauthenticatedAsset = await fetch(`${baseUrl}/app.js`);
    assert.equal(unauthenticatedAsset.status, 401);

    const appResponse = await fetch(`${baseUrl}/`, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    assert.equal(appResponse.status, 200);
    const setCookie = appResponse.headers.get("set-cookie") || "";
    assert.match(setCookie, /clawdad_native_session=/u);
    const cookie = setCookie.split(";")[0];

    const assetResponse = await fetch(`${baseUrl}/app.js`, {
      headers: { cookie },
    });
    assert.equal(assetResponse.status, 200);
    assert.match(await assetResponse.text(), /window\.ClawDadNative/u);

    const whoamiResponse = await fetch(`${baseUrl}/v1/whoami`, {
      headers: { cookie },
    });
    assert.equal(whoamiResponse.status, 200);
    const whoami = await whoamiResponse.json();
    assert.equal(whoami.ok, true);
    assert.equal(whoami.actor.authType, "native-session");

    const nativeCapabilitiesResponse = await fetch(
      `${baseUrl}/v1/native/capabilities`,
      { headers: { cookie } },
    );
    assert.equal(nativeCapabilitiesResponse.status, 200);
    assert.deepEqual(await nativeCapabilitiesResponse.json(), {
      ok: true,
      nativeShellProtocol: 1,
      remoteAssist: true,
      nativeRuntimeVersion: "",
    });
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("project create bootstraps git, private remotes, and Codex wiring for manual and new directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-server-local-create-"));
  const home = path.join(root, "home");
  const projectRoot = path.join(root, "code");
  const trackedProjectPath = path.join(projectRoot, "tracked-project");
  const localProjectPath = path.join(projectRoot, "go-to-market");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-mock");
  const invokedPath = path.join(root, "clawdad-invoked");
  const mockGhDir = path.join(root, "mock-bin");
  const mockGhPath = path.join(mockGhDir, "gh");
  const githubInvokedPath = path.join(root, "gh-invoked");

  await mkdir(path.join(trackedProjectPath, ".clawdad", "mailbox"), { recursive: true });
  await mkdir(localProjectPath, { recursive: true });
  await mkdir(home, { recursive: true });
  await mkdir(mockGhDir, { recursive: true });
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
  await writeFile(
    mockGhPath,
    `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(githubInvokedPath)}
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  exit 0
fi
if [ "$1" = "repo" ] && [ "$2" = "create" ]; then
  repo="$3"
  git remote add origin "https://github.com/\${repo}.git"
  exit 0
fi
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  repo="$3"
  printf 'https://github.com/%s.git\\n' "$repo"
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 1
`,
    "utf8",
  );
  await chmod(mockGhPath, 0o755);

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
        projectGithubRemote: true,
        projectGithubOwner: "SproutSeeds",
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
      CLAWDAD_TTS_ENABLED: "false",
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
      PATH: `${mockGhDir}${path.delimiter}${process.env.PATH || ""}`,
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
    assert.equal(createPayload.codexIntegration.ok, true);
    assert.equal(createPayload.codexIntegration.failCount, 0);
    assert.ok(createPayload.codexIntegration.operationCount > 0);
    assert.equal(createPayload.gitBootstrap.ok, true);
    assert.equal(createPayload.gitBootstrap.initialized, true);
    assert.equal(createPayload.gitBootstrap.committed, true);
    assert.match(createPayload.gitBootstrap.commitHash, /^[0-9a-f]{40}$/u);
    assert.equal(createPayload.gitBootstrap.remote.enabled, true);
    assert.equal(createPayload.gitBootstrap.remote.visibility, "private");
    assert.equal(createPayload.gitBootstrap.remote.repo, "SproutSeeds/go-to-market");
    assert.equal(createPayload.gitBootstrap.remote.created, true);
    assert.equal(createPayload.gitBootstrap.remote.url, "https://github.com/SproutSeeds/go-to-market.git");

    const headResult = await runGit(canonicalLocalProjectPath, ["rev-parse", "--verify", "HEAD"]);
    assert.equal(headResult.exitCode, 0, headResult.stderr);
    assert.match(headResult.stdout.trim(), /^[0-9a-f]{40}$/u);
    const treeResult = await runGit(canonicalLocalProjectPath, ["ls-tree", "--name-only", "HEAD"]);
    assert.equal(treeResult.exitCode, 0, treeResult.stderr);
    assert.match(treeResult.stdout, /^README\.md$/mu);
    assert.match(treeResult.stdout, /^AGENTS\.md$/mu);
    assert.match(treeResult.stdout, /^\.agents$/mu);
    assert.match(treeResult.stdout, /^\.codex$/mu);
    assert.doesNotMatch(treeResult.stdout, /^\.clawdad$/mu);
    assert.match(
      await readFile(path.join(canonicalLocalProjectPath, ".git", "info", "exclude"), "utf8"),
      /^\.clawdad\/$/mu,
    );
    const statusResult = await runGit(canonicalLocalProjectPath, ["status", "--porcelain=v1", "-uall"]);
    assert.equal(statusResult.exitCode, 0, statusResult.stderr);
    assert.equal(statusResult.stdout.trim(), "");
    const remoteResult = await runGit(canonicalLocalProjectPath, ["remote", "get-url", "origin"]);
    assert.equal(remoteResult.exitCode, 0, remoteResult.stderr);
    assert.equal(remoteResult.stdout.trim(), "https://github.com/SproutSeeds/go-to-market.git");
    const ghInvocations = await readFile(githubInvokedPath, "utf8");
    assert.match(ghInvocations, /^auth status$/mu);
    assert.match(ghInvocations, /^repo create SproutSeeds\/go-to-market --private --source \. --remote origin --push$/mu);

    const state = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
    assert.equal(state.projects[canonicalLocalProjectPath].active_session_id, createPayload.sessionId);
    assert.equal(state.projects[canonicalLocalProjectPath].sessions[createPayload.sessionId].provider, "codex");
    assert.equal(state.projects[canonicalLocalProjectPath].sessions[createPayload.sessionId].local_only, "true");
    assert.match(
      await readFile(path.join(canonicalLocalProjectPath, "AGENTS.md"), "utf8"),
      /BEGIN CLAWDAD CODEX INTEGRATION/u,
    );
    assert.match(
      await readFile(path.join(canonicalLocalProjectPath, ".codex", "config.toml"), "utf8"),
      /hooks = true/u,
    );
    assert.match(
      await readFile(path.join(canonicalLocalProjectPath, ".codex", "hooks.json"), "utf8"),
      /clawdad-hook\.mjs/u,
    );
    assert.match(
      await readFile(
        path.join(canonicalLocalProjectPath, ".agents", "skills", "clawdad-incident-triage", "SKILL.md"),
        "utf8",
      ),
      /name: clawdad-incident-triage/u,
    );

    const scratchCreateResponse = await fetch(`${baseUrl}/v1/projects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "tailscale-user-login": "tester@example.com",
      },
      body: JSON.stringify({
        mode: "new",
        root: projectRoot,
        name: "scratch-seed",
        provider: "codex",
      }),
    });
    assert.equal(scratchCreateResponse.status, 201, stderr.join(""));
    const scratchCreatePayload = await scratchCreateResponse.json();
    const scratchProjectPath = await realpath(path.join(projectRoot, "scratch-seed"));
    assert.equal(scratchCreatePayload.ok, true);
    assert.equal(scratchCreatePayload.projectPath, scratchProjectPath);
    assert.equal(scratchCreatePayload.createdDirectory, true);
    assert.equal(scratchCreatePayload.gitBootstrap.ok, true);
    assert.equal(scratchCreatePayload.gitBootstrap.initialized, true);
    assert.equal(scratchCreatePayload.gitBootstrap.readmeCreated, true);
    assert.equal(scratchCreatePayload.gitBootstrap.committed, true);
    assert.equal(scratchCreatePayload.gitBootstrap.remote.repo, "SproutSeeds/scratch-seed");
    assert.equal(scratchCreatePayload.gitBootstrap.remote.created, true);
    assert.equal(scratchCreatePayload.gitBootstrap.remote.url, "https://github.com/SproutSeeds/scratch-seed.git");
    assert.equal(await readFile(path.join(scratchProjectPath, "README.md"), "utf8"), "# scratch-seed\n");
    const scratchHeadResult = await runGit(scratchProjectPath, ["rev-parse", "--verify", "HEAD"]);
    assert.equal(scratchHeadResult.exitCode, 0, scratchHeadResult.stderr);
    const scratchStatusResult = await runGit(scratchProjectPath, ["status", "--porcelain=v1", "-uall"]);
    assert.equal(scratchStatusResult.exitCode, 0, scratchStatusResult.stderr);
    assert.equal(scratchStatusResult.stdout.trim(), "");
    const scratchRemoteResult = await runGit(scratchProjectPath, ["remote", "get-url", "origin"]);
    assert.equal(scratchRemoteResult.exitCode, 0, scratchRemoteResult.stderr);
    assert.equal(scratchRemoteResult.stdout.trim(), "https://github.com/SproutSeeds/scratch-seed.git");

    const updatedGhInvocations = await readFile(githubInvokedPath, "utf8");
    assert.match(
      updatedGhInvocations,
      /^repo create SproutSeeds\/scratch-seed --private --source \. --remote origin --push$/mu,
    );
    await assert.rejects(readFile(invokedPath, "utf8"), { code: "ENOENT" });
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});
