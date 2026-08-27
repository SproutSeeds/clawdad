import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createRequire } from "node:module";
import { WebSocketServer } from "ws";

import {
  codexSharedRemoteUrl,
  codexSharedRuntimeStatus,
  codexSharedSocketPath,
  codexSharedWebSocketUrl,
  ensureCodexSharedRuntime,
  normalizeCodexAppServerMode,
  probeCodexSharedRuntime,
} from "../lib/codex-shared-runtime.mjs";

const require = createRequire(import.meta.url);
const wsModuleUrl = pathToFileURL(require.resolve("ws")).href;

async function listen(server, socketPath) {
  await mkdir(path.dirname(socketPath), { recursive: true });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(httpServer, webSocketServer) {
  for (const client of webSocketServer.clients) {
    client.terminate();
  }
  await new Promise((resolve) => webSocketServer.close(() => resolve()));
  await new Promise((resolve) => httpServer.close(() => resolve()));
}

async function startProbeServer(socketPath) {
  const requests = [];
  const httpServer = createServer();
  const webSocketServer = new WebSocketServer({ server: httpServer });
  webSocketServer.on("connection", (socket) => {
    socket.on("message", (payload) => {
      const message = JSON.parse(Buffer.from(payload).toString("utf8"));
      requests.push(message);
      if (message.method === "initialize") {
        socket.send(JSON.stringify({
          id: message.id,
          result: {
            serverInfo: { name: "fake-codex", version: "1.0.0" },
          },
        }));
      }
    });
  });
  await listen(httpServer, socketPath);
  return {
    requests,
    async close() {
      await closeServer(httpServer, webSocketServer);
    },
  };
}

async function waitForProcessExit(pid, timeoutMs = 3_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function stopOwnedProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  await waitForProcessExit(pid);
}

async function writeFakeCodexBinary(root) {
  const binaryPath = path.join(root, "fake-codex.mjs");
  const source = `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import wsPackage from ${JSON.stringify(wsModuleUrl)};
const { WebSocketServer } = wsPackage;

const args = process.argv.slice(2);
if (args[0] === "app-server" && args[1] === "--help") {
  process.stdout.write("--listen <URL> supports unix://\\n");
  process.exit(0);
}

if (args[0] !== "app-server" || args[1] !== "--listen") {
  process.stderr.write("unexpected fake Codex invocation\\n");
  process.exit(2);
}
if (process.env.FAKE_CODEX_PID_PATH) {
  writeFileSync(process.env.FAKE_CODEX_PID_PATH, String(process.pid));
}
if (process.env.FAKE_CODEX_NEVER_READY === "1") {
  process.on("SIGTERM", () => process.exit(0));
  setInterval(() => {}, 1_000);
} else {
const listenUrl = args[2];
const socketPath = listenUrl === "unix://"
  ? path.join(process.env.CODEX_HOME || path.join(process.env.HOME, ".codex"), "app-server-control", "app-server-control.sock")
  : decodeURIComponent(new URL(listenUrl).pathname);
mkdirSync(path.dirname(socketPath), { recursive: true });
if (process.env.FAKE_CODEX_START_COUNTER) {
  appendFileSync(process.env.FAKE_CODEX_START_COUNTER, "start\\n");
}
const httpServer = createServer();
const webSocketServer = new WebSocketServer({ server: httpServer });
webSocketServer.on("connection", (socket) => {
  socket.on("message", (payload) => {
    const message = JSON.parse(Buffer.from(payload).toString("utf8"));
    if (message.method === "initialize") {
      socket.send(JSON.stringify({ id: message.id, result: { serverInfo: { name: "fake-codex", version: "1.0.0" } } }));
    }
  });
});
httpServer.listen(socketPath);
process.on("SIGTERM", () => {
  for (const client of webSocketServer.clients) client.terminate();
  webSocketServer.close(() => httpServer.close(() => process.exit(0)));
});
}
`;
  await writeFile(binaryPath, source, "utf8");
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function leaveStaleUnixSocket(root, socketPath) {
  const scriptPath = path.join(root, "leave-stale-socket.mjs");
  await writeFile(scriptPath, `
import { createServer } from "node:net";
const server = createServer();
server.listen(process.argv[2], () => process.stdout.write("ready\\n"));
`, "utf8");
  const child = spawn(process.execPath, [scriptPath, socketPath], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.stdout.once("data", resolve);
  });
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("close", resolve));
  assert.equal((await stat(socketPath)).isSocket(), true);
}

test("normalizes shared runtime modes and derives private default socket URLs", () => {
  assert.equal(normalizeCodexAppServerMode(undefined), "auto");
  assert.equal(normalizeCodexAppServerMode(" SHARED "), "shared");
  assert.equal(normalizeCodexAppServerMode("isolated"), "isolated");
  assert.throws(() => normalizeCodexAppServerMode("sometimes"), /expected auto, shared, or isolated/u);

  const socketPath = codexSharedSocketPath({ HOME: "/Users/example" });
  assert.equal(socketPath, "/Users/example/.codex/app-server-control/app-server-control.sock");
  assert.equal(codexSharedRemoteUrl(socketPath), `unix://${socketPath}`);
  assert.equal(codexSharedWebSocketUrl(socketPath), `ws+unix://${socketPath}`);
});

test("probe completes the initialize handshake over a Unix WebSocket", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-shared-probe-"));
  const socketPath = path.join(root, "codex.sock");
  const server = await startProbeServer(socketPath);
  t.after(() => server.close());

  const result = await probeCodexSharedRuntime({ socketPath, timeoutMs: 1_000 });

  assert.equal(result.ready, true);
  assert.equal(result.state, "ready");
  assert.equal(result.serverInfo.name, "fake-codex");
  assert.equal(server.requests[0].method, "initialize");
  assert.equal(server.requests[0].params.capabilities.experimentalApi, true);
  for (let attempt = 0; attempt < 20 && !server.requests.some((entry) => entry.method === "initialized"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(server.requests.some((entry) => entry.method === "initialized"), true);
});

test("explicit isolated mode performs no shared capability or startup work", async () => {
  let checked = false;
  const result = await ensureCodexSharedRuntime({
    mode: "isolated",
    capabilityCheck: async () => {
      checked = true;
      return { supported: true };
    },
  });

  assert.equal(result.mode, "isolated");
  assert.equal(result.state, "isolated");
  assert.equal(result.ready, true);
  assert.equal(checked, false);
});

test("auto falls back only after a conclusive unsupported capability result", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-shared-unsupported-"));
  const socketPath = path.join(root, "codex.sock");
  const options = {
    socketPath,
    probeTimeoutMs: 50,
    capabilityCheck: async () => ({ supported: false, reason: "Unix listener unavailable" }),
  };

  const automatic = await ensureCodexSharedRuntime({ ...options, mode: "auto" });
  assert.equal(automatic.mode, "isolated");
  assert.equal(automatic.state, "unsupported");
  assert.match(automatic.reason, /Unix listener unavailable/u);

  await assert.rejects(
    ensureCodexSharedRuntime({ ...options, mode: "shared" }),
    (error) => error?.code === "CODEX_SHARED_RUNTIME_UNSUPPORTED",
  );
});

test("ensure reuses a live server without running a capability check or spawning", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-shared-reuse-"));
  const socketPath = path.join(root, "codex.sock");
  const server = await startProbeServer(socketPath);
  t.after(() => server.close());
  let checked = false;

  const result = await ensureCodexSharedRuntime({
    mode: "shared",
    socketPath,
    clawdadHome: path.join(root, "clawdad"),
    capabilityCheck: async () => {
      checked = true;
      return { supported: true };
    },
  });

  assert.equal(result.mode, "shared");
  assert.equal(result.reused, true);
  assert.equal(result.started, false);
  assert.equal(checked, false);
  assert.equal((await stat(socketPath)).mode & 0o777, 0o600);
  assert.equal((await stat(path.dirname(socketPath))).mode & 0o777, 0o700);
});

test("concurrent ensures use one atomic startup owner and one detached server", async (t) => {
  const root = await mkdtemp("/tmp/clawdad-shared-start-");
  const codexHome = path.join(root, "codex-home");
  const clawdadHome = path.join(root, "clawdad-home");
  const counterPath = path.join(root, "starts.txt");
  const codexBinary = await writeFakeCodexBinary(root);
  const env = {
    ...process.env,
    HOME: root,
    CODEX_HOME: codexHome,
    CLAWDAD_HOME: clawdadHome,
    FAKE_CODEX_START_COUNTER: counterPath,
  };
  const options = {
    mode: "shared",
    env,
    codexBinary,
    cwd: root,
    startupTimeoutMs: 5_000,
    probeTimeoutMs: 200,
    pollIntervalMs: 25,
  };

  const results = await Promise.all([
    ensureCodexSharedRuntime(options),
    ensureCodexSharedRuntime(options),
  ]);
  const owner = results.find((entry) => entry.started);
  t.after(() => stopOwnedProcess(owner?.pid));

  assert.ok(owner);
  assert.equal(results.every((entry) => entry.mode === "shared" && entry.ready), true);
  assert.equal(results.filter((entry) => entry.started).length, 1);
  assert.equal((await readFile(counterPath, "utf8")).trim().split("\n").length, 1);
  assert.equal((await stat(codexSharedSocketPath(env))).mode & 0o777, 0o600);
  assert.equal((await stat(path.join(clawdadHome, "logs", "codex-app-server.log"))).mode & 0o777, 0o600);

  const status = await codexSharedRuntimeStatus({ mode: "shared", env, probeTimeoutMs: 500 });
  assert.equal(status.ready, true);
  assert.equal(status.managed, true);
  assert.equal(status.pid, owner.pid);
});

test("ensure refuses to replace a non-socket path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-shared-nonsocket-"));
  const socketPath = path.join(root, "codex.sock");
  await writeFile(socketPath, "preserve me", "utf8");

  await assert.rejects(
    ensureCodexSharedRuntime({
      mode: "shared",
      socketPath,
      clawdadHome: path.join(root, "clawdad"),
      probeTimeoutMs: 100,
      capabilityCheck: async () => ({ supported: true }),
    }),
    /refusing to replace non-socket path/u,
  );
  assert.equal(await readFile(socketPath, "utf8"), "preserve me");
});

test("ensure refuses a symlinked custom socket parent before probing or changing permissions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-shared-parent-link-"));
  const realParent = path.join(root, "real-parent");
  const linkedParent = path.join(root, "linked-parent");
  await mkdir(realParent, { recursive: true });
  await symlink(realParent, linkedParent, "dir");

  await assert.rejects(
    ensureCodexSharedRuntime({
      mode: "shared",
      socketPath: path.join(linkedParent, "codex.sock"),
      clawdadHome: path.join(root, "clawdad"),
      capabilityCheck: async () => ({ supported: true }),
    }),
    /socket parent symlink/u,
  );
});

test("ensure refuses a symlinked custom socket even when its target is live", async (t) => {
  const root = await mkdtemp("/tmp/clawdad-socket-link-");
  const realParent = path.join(root, "real-parent");
  const linkedParent = path.join(root, "linked-parent");
  const realSocketPath = path.join(realParent, "codex.sock");
  const linkedSocketPath = path.join(linkedParent, "codex.sock");
  await mkdir(realParent, { recursive: true });
  await mkdir(linkedParent, { recursive: true });
  const server = await startProbeServer(realSocketPath);
  t.after(() => server.close());
  await symlink(realSocketPath, linkedSocketPath);

  await assert.rejects(
    ensureCodexSharedRuntime({
      mode: "shared",
      socketPath: linkedSocketPath,
      clawdadHome: path.join(root, "clawdad"),
    }),
    /socket symlink/u,
  );
});

test("ensure replaces a repeatedly refused stale socket only after verifying its inode", async (t) => {
  const root = await mkdtemp("/tmp/clawdad-shared-stale-");
  const socketPath = path.join(root, "codex.sock");
  const clawdadHome = path.join(root, "clawdad-home");
  const codexBinary = await writeFakeCodexBinary(root);
  await leaveStaleUnixSocket(root, socketPath);

  const result = await ensureCodexSharedRuntime({
    mode: "shared",
    env: { ...process.env, HOME: root, CLAWDAD_HOME: clawdadHome },
    socketPath,
    codexBinary,
    cwd: root,
    startupTimeoutMs: 5_000,
    probeTimeoutMs: 200,
    staleSocketProbeDelayMs: 25,
  });
  t.after(() => stopOwnedProcess(result.pid));

  assert.equal(result.started, true);
  assert.equal(result.ready, true);
  assert.equal((await probeCodexSharedRuntime({ socketPath, timeoutMs: 500 })).ready, true);
});

test("startup timeout terminates only the runtime child spawned by that ensure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-shared-timeout-"));
  const pidPath = path.join(root, "runtime.pid");
  const codexBinary = await writeFakeCodexBinary(root);
  const env = {
    ...process.env,
    HOME: root,
    CLAWDAD_HOME: path.join(root, "clawdad-home"),
    FAKE_CODEX_PID_PATH: pidPath,
    FAKE_CODEX_NEVER_READY: "1",
  };

  await assert.rejects(
    ensureCodexSharedRuntime({
      mode: "shared",
      env,
      socketPath: path.join(root, "socket-parent", "codex.sock"),
      codexBinary,
      cwd: root,
      startupTimeoutMs: 200,
      probeTimeoutMs: 25,
      pollIntervalMs: 10,
      ownedChildTerminationTimeoutMs: 500,
    }),
    /did not become ready/u,
  );

  const pid = Number.parseInt(await readFile(pidPath, "utf8"), 10);
  assert.equal(Number.isSafeInteger(pid), true);
  assert.equal(await waitForProcessExit(pid, 2_000), true);
});

test("a missing Codex executable is a conclusive auto-mode capability fallback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-shared-missing-bin-"));
  const result = await ensureCodexSharedRuntime({
    mode: "auto",
    socketPath: path.join(root, "codex.sock"),
    codexBinary: path.join(root, "missing-codex"),
    probeTimeoutMs: 50,
  });

  assert.equal(result.mode, "isolated");
  assert.equal(result.state, "unsupported");
  assert.match(result.reason, /was not found/u);
});
