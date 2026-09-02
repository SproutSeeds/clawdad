import { spawn as spawnChild } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const validModes = new Set(["auto", "shared", "isolated"]);
const defaultProbeTimeoutMs = 1_500;
const defaultStartupTimeoutMs = 15_000;
const defaultCapabilityTimeoutMs = 5_000;
const defaultPollIntervalMs = 100;
const defaultStaleLockMs = 30_000;
const defaultStaleSocketProbeDelayMs = 200;
const defaultOwnedChildTerminationTimeoutMs = 1_000;
const defaultUnhealthyOwnerTerminationTimeoutMs = 3_000;

function pickString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return "";
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveHomePath(value, homeDir) {
  const text = pickString(value);
  if (!text) return "";
  if (text === "~") return homeDir;
  if (text.startsWith("~/")) return path.join(homeDir, text.slice(2));
  return path.resolve(text);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runtimeSocketKey(socketPath) {
  return createHash("sha256")
    .update(normalizeSocketPath(socketPath))
    .digest("hex")
    .slice(0, 16);
}

function runtimePaths(options = {}, socketPath) {
  const env = options.env || process.env;
  const homeDir = resolveHomePath(env.HOME, os.homedir()) || os.homedir();
  const clawdadHome = resolveHomePath(
    pickString(options.clawdadHome, env.CLAWDAD_HOME),
    homeDir,
  ) || path.join(homeDir, ".clawdad");
  const runtimeDir = resolveHomePath(options.runtimeDir, homeDir) || path.join(clawdadHome, "runtime");
  const logsDir = resolveHomePath(options.logsDir, homeDir) || path.join(clawdadHome, "logs");
  const socketKey = runtimeSocketKey(socketPath);
  return {
    clawdadHome,
    runtimeDir,
    logsDir,
    lockPath: resolveHomePath(options.lockPath, homeDir) || path.join(runtimeDir, `codex-app-server-start-${socketKey}.lock`),
    metadataPath: resolveHomePath(options.metadataPath, homeDir) || path.join(runtimeDir, `codex-app-server-runtime-${socketKey}.json`),
    legacyMetadataPath: path.join(runtimeDir, "codex-app-server-runtime.json"),
    logPath: resolveHomePath(options.logPath, homeDir) || path.join(logsDir, "codex-app-server.log"),
  };
}

export function normalizeCodexAppServerMode(value) {
  const normalized = pickString(value).toLowerCase() || "auto";
  if (!validModes.has(normalized)) {
    throw new TypeError(
      `invalid Codex app-server mode '${pickString(value) || String(value)}'; expected auto, shared, or isolated`,
    );
  }
  return normalized;
}

export function codexSharedSocketPath(env = process.env) {
  const homeDir = resolveHomePath(env?.HOME, os.homedir()) || os.homedir();
  const override = resolveHomePath(env?.CLAWDAD_CODEX_APP_SERVER_SOCKET, homeDir);
  if (override) return override;
  const codexHome = resolveHomePath(
    pickString(env?.CLAWDAD_CODEX_HOME, env?.CODEX_HOME),
    homeDir,
  ) || path.join(homeDir, ".codex");
  return path.join(codexHome, "app-server-control", "app-server-control.sock");
}

function normalizeSocketPath(socketPath) {
  const value = pickString(socketPath);
  if (!value) {
    throw new TypeError("a Codex shared app-server socket path is required");
  }
  return path.resolve(value);
}

function unixSocketPathLimit() {
  if (process.platform === "darwin") return 103;
  if (process.platform === "linux") return 107;
  return 103;
}

function unixSocketPathTooLong(socketPath) {
  return Buffer.byteLength(socketPath, "utf8") > unixSocketPathLimit();
}

export function codexSharedRemoteUrl(socketPath) {
  return `unix://${normalizeSocketPath(socketPath)}`;
}

export function codexSharedWebSocketUrl(socketPath) {
  return `ws+unix://${normalizeSocketPath(socketPath)}`;
}

function errorMessage(error) {
  return pickString(error?.message, String(error || "")) || "unknown error";
}

function errorCode(error) {
  return pickString(error?.code, error?.cause?.code) || null;
}

function isDefinitiveDeadSocketError(error) {
  return ["ECONNREFUSED", "ENOENT", "ENOTSOCK"].includes(errorCode(error));
}

function currentUnixUid() {
  if (process.platform === "win32" || typeof process.getuid !== "function") {
    return null;
  }
  return process.getuid();
}

function assertPathOwnedByCurrentUser(filePath, fileStat, label) {
  const uid = currentUnixUid();
  if (uid == null) return;
  if (fileStat.uid !== uid) {
    throw new Error(
      `refusing unsafe Codex shared ${label} at ${filePath}: owned by uid ${fileStat.uid}, expected ${uid}`,
    );
  }
}

async function lstatIfPresent(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

async function validateSocketPathSafety(socketPath, {
  allowMissingParent = false,
  allowMissingSocket = true,
} = {}) {
  const parentPath = path.dirname(socketPath);
  const parentStat = await lstatIfPresent(parentPath);
  if (!parentStat) {
    if (allowMissingParent) return { parentStat: null, socketStat: null };
    throw new Error(`refusing unsafe Codex shared socket parent at ${parentPath}: path does not exist`);
  }
  if (parentStat.isSymbolicLink()) {
    throw new Error(`refusing unsafe Codex shared socket parent symlink at ${parentPath}`);
  }
  if (!parentStat.isDirectory()) {
    throw new Error(`refusing unsafe Codex shared socket parent at ${parentPath}: path is not a directory`);
  }
  assertPathOwnedByCurrentUser(parentPath, parentStat, "socket parent");

  const socketStat = await lstatIfPresent(socketPath);
  if (!socketStat) {
    if (allowMissingSocket) return { parentStat, socketStat: null };
    throw new Error(`refusing unsafe Codex shared socket at ${socketPath}: path does not exist`);
  }
  if (socketStat.isSymbolicLink()) {
    throw new Error(`refusing unsafe Codex shared socket symlink at ${socketPath}`);
  }
  if (!socketStat.isSocket()) {
    throw new Error(`refusing to replace non-socket path at ${socketPath}`);
  }
  assertPathOwnedByCurrentUser(socketPath, socketStat, "socket");
  return { parentStat, socketStat };
}

function childHasExited(child) {
  return child?.exitCode != null || child?.signalCode != null;
}

async function waitForOwnedChildExit(child, timeoutMs) {
  if (!child || childHasExited(child)) return true;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off?.("exit", onExit);
      child.off?.("close", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(childHasExited(child)), timeoutMs);
    child.once?.("exit", onExit);
    child.once?.("close", onExit);
    if (childHasExited(child)) finish(true);
  });
}

async function terminateOwnedRuntimeChild(child, timeoutMs) {
  if (!child || !Number.isSafeInteger(child.pid) || child.pid <= 0 || childHasExited(child)) {
    return;
  }
  const graceMs = positiveInteger(timeoutMs, defaultOwnedChildTerminationTimeoutMs);
  try {
    child.kill("SIGTERM");
  } catch (error) {
    if (errorCode(error) !== "ESRCH") throw error;
    return;
  }
  if (await waitForOwnedChildExit(child, graceMs)) return;
  try {
    child.kill("SIGKILL");
  } catch (error) {
    if (errorCode(error) !== "ESRCH") throw error;
    return;
  }
  if (!(await waitForOwnedChildExit(child, graceMs))) {
    throw new Error(`could not terminate owned Codex shared app-server child pid ${child.pid}`);
  }
}

async function defaultWebSocketImpl() {
  const module = await import("ws");
  return module.WebSocket || module.default;
}

/**
 * Connects to the private Unix WebSocket and completes the Codex app-server
 * initialize handshake. This is deliberately a read-only liveness probe: it
 * closes its client connection and never stops the server.
 */
export async function probeCodexSharedRuntime(options = {}) {
  const env = options.env || process.env;
  const socketPath = normalizeSocketPath(options.socketPath || codexSharedSocketPath(env));
  const remoteUrl = codexSharedRemoteUrl(socketPath);
  const webSocketUrl = codexSharedWebSocketUrl(socketPath);
  if (unixSocketPathTooLong(socketPath)) {
    return {
      ready: false,
      state: "unavailable",
      socketPath,
      remoteUrl,
      webSocketUrl,
      error: `Codex shared app-server socket path exceeds the ${unixSocketPathLimit()}-byte platform limit`,
      errorCode: "ENAMETOOLONG",
      connectionFailure: false,
    };
  }
  const timeoutMs = positiveInteger(options.timeoutMs, defaultProbeTimeoutMs);
  let WebSocketImpl;
  try {
    WebSocketImpl = options.WebSocketImpl || await defaultWebSocketImpl();
  } catch (error) {
    return {
      ready: false,
      state: "unavailable",
      socketPath,
      remoteUrl,
      webSocketUrl,
      error: `unable to load the WebSocket client: ${errorMessage(error)}`,
      errorCode: errorCode(error),
      connectionFailure: false,
    };
  }

  return new Promise((resolve) => {
    let socket;
    let settled = false;
    let opened = false;
    const requestId = 1;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (socket?.readyState === WebSocketImpl.OPEN) {
          socket.close();
        } else {
          socket?.terminate?.();
        }
      } catch {
        // The probe result is already known.
      }
      resolve({
        socketPath,
        remoteUrl,
        webSocketUrl,
        ...result,
      });
    };
    const timer = setTimeout(() => {
      const timeoutError = new Error(`timed out after ${timeoutMs}ms`);
      timeoutError.code = "ETIMEDOUT";
      finish({
        ready: false,
        state: "unavailable",
        error: `Codex shared app-server probe ${errorMessage(timeoutError)}`,
        errorCode: timeoutError.code,
        connectionFailure: !opened,
      });
    }, timeoutMs);

    try {
      socket = new WebSocketImpl(webSocketUrl, {
        handshakeTimeout: timeoutMs,
        perMessageDeflate: false,
      });
    } catch (error) {
      finish({
        ready: false,
        state: "unavailable",
        error: errorMessage(error),
        errorCode: errorCode(error),
        connectionFailure: isDefinitiveDeadSocketError(error),
      });
      return;
    }

    socket.once("open", () => {
      opened = true;
      try {
        socket.send(JSON.stringify({
          id: requestId,
          method: "initialize",
          params: {
            clientInfo: {
              name: "clawdad-runtime-probe",
              title: "Clawdad Runtime Probe",
              version: "0.0.0",
            },
            capabilities: {
              experimentalApi: true,
            },
          },
        }));
      } catch (error) {
        finish({
          ready: false,
          state: "unavailable",
          error: errorMessage(error),
          errorCode: errorCode(error),
          connectionFailure: false,
        });
      }
    });

    socket.on("message", (payload) => {
      let message;
      try {
        message = JSON.parse(Buffer.from(payload).toString("utf8"));
      } catch {
        return;
      }
      if (message?.id !== requestId) return;
      if (message.error) {
        finish({
          ready: false,
          state: "unavailable",
          error: `Codex app-server rejected initialize: ${pickString(message.error?.message) || JSON.stringify(message.error)}`,
          errorCode: pickString(message.error?.code) || null,
          connectionFailure: false,
        });
        return;
      }
      const finishReady = () => finish({
        ready: true,
        state: "ready",
        error: null,
        errorCode: null,
        connectionFailure: false,
        serverInfo: message?.result?.serverInfo || null,
      });
      try {
        socket.send(
          JSON.stringify({ method: "initialized", params: {} }),
          (error) => {
            if (error) {
              finish({
                ready: false,
                state: "unavailable",
                error: `could not complete the Codex initialized notification: ${errorMessage(error)}`,
                errorCode: errorCode(error),
                connectionFailure: false,
              });
              return;
            }
            finishReady();
          },
        );
      } catch (error) {
        finish({
          ready: false,
          state: "unavailable",
          error: `could not complete the Codex initialized notification: ${errorMessage(error)}`,
          errorCode: errorCode(error),
          connectionFailure: false,
        });
      }
    });

    socket.once("error", (error) => {
      finish({
        ready: false,
        state: "unavailable",
        error: errorMessage(error),
        errorCode: errorCode(error),
        connectionFailure: !opened && isDefinitiveDeadSocketError(error),
      });
    });

    socket.once("close", () => {
      if (settled) return;
      finish({
        ready: false,
        state: "unavailable",
        error: "Codex shared app-server closed before initialize completed",
        errorCode: null,
        connectionFailure: !opened,
      });
    });
  });
}

async function captureCommand(command, args, {
  env,
  cwd,
  timeoutMs = defaultCapabilityTimeoutMs,
  spawnImpl = spawnChild,
} = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(command, args, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      const error = new Error(`timed out checking Codex app-server support after ${timeoutMs}ms`);
      error.code = "ETIMEDOUT";
      try {
        child.kill("SIGTERM");
      } catch {
        // The short-lived capability check may have exited concurrently.
      }
      finish(reject, error);
    }, timeoutMs);
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on?.("data", (chunk) => {
      if (stdout.length < 1024 * 1024) stdout += chunk;
    });
    child.stderr?.on?.("data", (chunk) => {
      if (stderr.length < 1024 * 1024) stderr += chunk;
    });
    child.once("error", (error) => finish(reject, error));
    child.once("close", (code, signal) => finish(resolve, {
      code,
      signal,
      stdout,
      stderr,
    }));
  });
}

function parseLsofSocketOwners(output) {
  const owners = [];
  let current = null;
  for (const rawLine of String(output || "").split(/\r?\n/u)) {
    if (!rawLine) continue;
    const field = rawLine[0];
    const value = rawLine.slice(1).trim();
    if (field === "p") {
      const pid = Number.parseInt(value, 10);
      current = Number.isSafeInteger(pid) && pid > 0 ? { pid } : null;
      if (current) owners.push(current);
    } else if (field === "c" && current) {
      current.name = value;
    } else if (field === "u" && current) {
      const uid = Number.parseInt(value, 10);
      current.uid = Number.isSafeInteger(uid) ? uid : null;
    }
  }
  return [...new Map(owners.map((owner) => [owner.pid, owner])).values()];
}

async function defaultSocketOwnerResolver(socketPath, options = {}) {
  if (process.platform !== "darwin") return null;
  const env = options.env || process.env;
  const timeoutMs = positiveInteger(options.ownerResolveTimeoutMs, defaultCapabilityTimeoutMs);
  let lsofResult;
  try {
    lsofResult = await captureCommand(
      "/usr/sbin/lsof",
      ["-nP", "-Fpcu", "--", socketPath],
      { env, timeoutMs, spawnImpl: spawnChild },
    );
  } catch {
    return null;
  }
  if (lsofResult.code !== 0) return null;
  const owners = parseLsofSocketOwners(lsofResult.stdout);
  if (owners.length !== 1) return null;
  const owner = owners[0];

  let processResult;
  try {
    processResult = await captureCommand(
      "/bin/ps",
      ["-p", String(owner.pid), "-o", "uid=", "-o", "command="],
      { env, timeoutMs, spawnImpl: spawnChild },
    );
  } catch {
    return null;
  }
  if (processResult.code !== 0) return null;
  const processLine = String(processResult.stdout || "").trim();
  const processMatch = processLine.match(/^(\d+)\s+(.+)$/u);
  if (!processMatch) return null;

  let executable = "";
  try {
    const executableResult = await captureCommand(
      "/usr/sbin/lsof",
      ["-nP", "-a", "-p", String(owner.pid), "-d", "txt", "-Fn"],
      { env, timeoutMs, spawnImpl: spawnChild },
    );
    if (executableResult.code === 0) {
      executable = String(executableResult.stdout || "")
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("n"))
        .map((line) => line.slice(1).trim())
        .find((candidate) => path.basename(candidate) === "codex") || "";
    }
  } catch {
    // The command line plus socket ownership can still prove the owner.
  }

  return {
    ...owner,
    uid: Number.parseInt(processMatch[1], 10),
    command: processMatch[2].trim(),
    executable,
  };
}

function verifiedCodexSocketOwner(owner, socketPath, codexBinary) {
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || owner.pid === process.pid) {
    return false;
  }
  const uid = currentUnixUid();
  if (uid != null && owner.uid !== uid) return false;

  const command = pickString(owner.command);
  const tokens = command.split(/\s+/u);
  const appServerIndex = tokens.indexOf("app-server");
  if (appServerIndex !== 1 || tokens.length < 3) return false;
  const commandBinary = tokens[0];
  const configuredBinary = pickString(codexBinary, "codex");
  const commandBinaryMatches = path.basename(commandBinary) === "codex" || (
    configuredBinary.includes(path.sep) && path.resolve(commandBinary) === path.resolve(configuredBinary)
  );
  const executableMatches = !owner.executable || path.basename(owner.executable) === "codex" || (
    configuredBinary.includes(path.sep) && path.resolve(owner.executable) === path.resolve(configuredBinary)
  );
  if (!commandBinaryMatches || !executableMatches) return false;

  const listenIndex = tokens.findIndex((token, index) => index > appServerIndex && token === "--listen");
  const inlineListen = tokens.find((token, index) => index > appServerIndex && token.startsWith("--listen="));
  const listenValue = listenIndex >= 0 ? tokens[listenIndex + 1] : inlineListen?.slice("--listen=".length);
  return listenValue === "unix://" || listenValue === codexSharedRemoteUrl(socketPath);
}

async function resolveSocketOwner(socketPath, options) {
  if (typeof options.socketOwnerResolver === "function") {
    return options.socketOwnerResolver(socketPath, options);
  }
  return defaultSocketOwnerResolver(socketPath, options);
}

async function waitForProcessStop(pid, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!processIsAlive(pid)) return true;
    await sleep(50);
  }
  return !processIsAlive(pid);
}

async function signalProcess(pid, signal, options) {
  const signalImpl = options.signalProcessImpl || process.kill.bind(process);
  try {
    signalImpl(pid, signal);
  } catch (error) {
    if (errorCode(error) !== "ESRCH") throw error;
  }
}

async function terminateVerifiedSocketOwner(owner, socketPath, codexBinary, options) {
  const timeoutMs = positiveInteger(
    options.unhealthyOwnerTerminationTimeoutMs,
    defaultUnhealthyOwnerTerminationTimeoutMs,
  );
  await signalProcess(owner.pid, "SIGTERM", options);
  if (await waitForProcessStop(owner.pid, timeoutMs)) return;

  const currentOwner = await resolveSocketOwner(socketPath, options);
  if (
    currentOwner?.pid !== owner.pid ||
    !verifiedCodexSocketOwner(currentOwner, socketPath, codexBinary)
  ) {
    throw new Error(
      `the Codex shared socket owner changed while pid ${owner.pid} was stopping; refusing to force-terminate it`,
    );
  }
  await signalProcess(owner.pid, "SIGKILL", options);
  if (!(await waitForProcessStop(owner.pid, timeoutMs))) {
    throw new Error(`could not stop the unhealthy Codex shared app-server pid ${owner.pid}`);
  }
}

async function recoverVerifiedUnhealthySocket(socketPath, initialProbe, options, probeOptions, codexBinary) {
  let firstStat;
  try {
    firstStat = await lstat(socketPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
  if (!firstStat.isSocket()) {
    throw new Error(`refusing to replace non-socket path at ${socketPath}`);
  }

  await sleep(positiveInteger(options.staleSocketProbeDelayMs, defaultStaleSocketProbeDelayMs));
  const secondStat = await lstatIfPresent(socketPath);
  if (
    !secondStat?.isSocket() ||
    secondStat.dev !== firstStat.dev ||
    secondStat.ino !== firstStat.ino
  ) {
    return null;
  }
  const secondProbe = await probeCodexSharedRuntime(probeOptions);
  if (secondProbe.ready) return null;

  const owner = await resolveSocketOwner(socketPath, options);
  if (!verifiedCodexSocketOwner(owner, socketPath, codexBinary)) return null;

  await terminateVerifiedSocketOwner(owner, socketPath, codexBinary, options);
  const remainingStat = await lstatIfPresent(socketPath);
  let socketReleased = !remainingStat;
  if (
    remainingStat?.isSocket() &&
    remainingStat.dev === firstStat.dev &&
    remainingStat.ino === firstStat.ino
  ) {
    await unlink(socketPath);
    socketReleased = true;
  }
  return {
    pid: owner.pid,
    socketReleased,
    firstError: initialProbe?.error || null,
    secondError: secondProbe.error || null,
  };
}

async function sharedCapability(options = {}) {
  if (typeof options.capabilityCheck === "function") {
    return options.capabilityCheck(options);
  }
  const env = options.env || process.env;
  const codexBinary = pickString(options.codexBinary, env.CLAWDAD_CODEX_BIN, "codex");
  let result;
  try {
    result = await captureCommand(codexBinary, ["app-server", "--help"], {
      env,
      cwd: options.cwd,
      timeoutMs: positiveInteger(options.capabilityTimeoutMs, defaultCapabilityTimeoutMs),
      spawnImpl: options.spawnImpl || spawnChild,
    });
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return { supported: false, reason: `Codex binary '${codexBinary}' was not found` };
    }
    throw new Error(`could not determine Codex shared app-server support: ${errorMessage(error)}`, {
      cause: error,
    });
  }
  if (result.code !== 0) {
    throw new Error(
      `could not determine Codex shared app-server support: ${pickString(result.stderr, result.stdout) || `exit ${result.code}`}`,
    );
  }
  const output = `${result.stdout}\n${result.stderr}`;
  const supported = /--listen(?:\s|=|<)/u.test(output) && /unix:\/\//u.test(output);
  return {
    supported,
    reason: supported
      ? null
      : "this Codex CLI does not advertise a Unix-socket app-server listener",
  };
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, filePath);
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

async function releaseStartupLock(lockPath, ownerToken) {
  const ownerPath = path.join(lockPath, "owner.json");
  const owner = await readJson(ownerPath);
  if (owner?.token !== ownerToken) return;
  await unlink(ownerPath).catch(() => {});
  await rmdir(lockPath).catch(() => {});
}

async function clearConfirmedDeadStartupLock(lockPath, staleLockMs) {
  const ownerPath = path.join(lockPath, "owner.json");
  const owner = await readJson(ownerPath);
  if (owner && Number.isSafeInteger(owner.pid)) {
    if (processIsAlive(owner.pid)) return false;
  } else {
    let lockStat;
    try {
      lockStat = await stat(lockPath);
    } catch {
      return true;
    }
    if (Date.now() - lockStat.mtimeMs < staleLockMs) return false;
  }
  await unlink(ownerPath).catch(() => {});
  try {
    await rmdir(lockPath);
    return true;
  } catch {
    return false;
  }
}

async function acquireStartupLock(paths, options, probeOptions) {
  const timeoutMs = positiveInteger(options.startupTimeoutMs, defaultStartupTimeoutMs);
  const staleLockMs = positiveInteger(options.staleLockMs, defaultStaleLockMs);
  const pollIntervalMs = positiveInteger(options.pollIntervalMs, defaultPollIntervalMs);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const token = randomUUID();
    try {
      await mkdir(paths.lockPath, { mode: 0o700 });
      try {
        await atomicWriteJson(path.join(paths.lockPath, "owner.json"), {
          pid: process.pid,
          token,
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        await rmdir(paths.lockPath).catch(() => {});
        throw error;
      }
      return { acquired: true, token, runtime: null };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }

    const runtime = await probeCodexSharedRuntime(probeOptions);
    if (runtime.ready) {
      return { acquired: false, token: null, runtime };
    }
    await clearConfirmedDeadStartupLock(paths.lockPath, staleLockMs);
    await sleep(pollIntervalMs);
  }
  throw new Error(`timed out waiting for the Codex shared app-server startup lock at ${paths.lockPath}`);
}

async function confirmedStaleSocket(socketPath, initialProbe, options, probeOptions) {
  if (!initialProbe?.connectionFailure || !["ECONNREFUSED", "ENOTSOCK"].includes(initialProbe.errorCode)) {
    return null;
  }
  let firstStat;
  try {
    firstStat = await lstat(socketPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
  if (!firstStat.isSocket()) {
    throw new Error(`refusing to replace non-socket path at ${socketPath}`);
  }
  await sleep(positiveInteger(options.staleSocketProbeDelayMs, defaultStaleSocketProbeDelayMs));
  let secondStat;
  try {
    secondStat = await lstat(socketPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
  if (!secondStat.isSocket() || secondStat.dev !== firstStat.dev || secondStat.ino !== firstStat.ino) {
    return null;
  }
  const secondProbe = await probeCodexSharedRuntime(probeOptions);
  return (
    secondProbe.connectionFailure &&
    ["ECONNREFUSED", "ENOTSOCK"].includes(secondProbe.errorCode)
  ) ? secondStat : null;
}

async function readMatchingMetadata(paths, socketPath) {
  const metadata = await readJson(paths.metadataPath);
  if (metadata?.socketPath === socketPath) return metadata;
  if (paths.legacyMetadataPath && paths.legacyMetadataPath !== paths.metadataPath) {
    const legacyMetadata = await readJson(paths.legacyMetadataPath);
    if (legacyMetadata?.socketPath === socketPath) return legacyMetadata;
  }
  return null;
}

async function makeSocketPrivate(socketPath) {
  await validateSocketPathSafety(socketPath, {
    allowMissingParent: false,
    allowMissingSocket: false,
  });
  await chmod(path.dirname(socketPath), 0o700);
  await chmod(socketPath, 0o600);
}

function isolatedResult(requestedMode, state, reason = null) {
  return {
    mode: "isolated",
    requestedMode,
    ready: true,
    state,
    socketPath: null,
    remoteUrl: null,
    webSocketUrl: null,
    reused: false,
    started: false,
    pid: null,
    reason,
  };
}

async function sharedReadyResult({ requestedMode, probe, paths, reused, started, pid = null, reason = null }) {
  await makeSocketPrivate(probe.socketPath);
  const metadata = await readMatchingMetadata(paths, probe.socketPath);
  const metadataPid = Number.isSafeInteger(metadata?.pid) && processIsAlive(metadata.pid)
    ? metadata.pid
    : null;
  return {
    mode: "shared",
    requestedMode,
    ready: true,
    state: "ready",
    socketPath: probe.socketPath,
    remoteUrl: probe.remoteUrl,
    webSocketUrl: probe.webSocketUrl,
    reused: Boolean(reused),
    started: Boolean(started),
    pid: pid || metadataPid,
    reason,
  };
}

/**
 * Ensures one shared Codex app-server is accepting local Unix WebSocket
 * clients. A supported shared runtime fails closed: Clawdad never silently
 * creates a second writer after a shared startup failure.
 */
export async function ensureCodexSharedRuntime(options = {}) {
  const env = options.env || process.env;
  const requestedMode = normalizeCodexAppServerMode(
    options.mode ?? env.CLAWDAD_CODEX_APP_SERVER_MODE,
  );
  if (requestedMode === "isolated") {
    return isolatedResult(requestedMode, "isolated");
  }

  const socketPath = normalizeSocketPath(options.socketPath || codexSharedSocketPath(env));
  const paths = runtimePaths(options, socketPath);
  await validateSocketPathSafety(socketPath, {
    allowMissingParent: true,
    allowMissingSocket: true,
  });
  const probeOptions = {
    env,
    socketPath,
    timeoutMs: positiveInteger(options.probeTimeoutMs, defaultProbeTimeoutMs),
    WebSocketImpl: options.WebSocketImpl,
  };
  let probe = await probeCodexSharedRuntime(probeOptions);
  if (probe.ready) {
    return sharedReadyResult({ requestedMode, probe, paths, reused: true, started: false });
  }

  const capability = await sharedCapability(options);
  if (!capability?.supported) {
    if (requestedMode === "auto") {
      return isolatedResult(requestedMode, "unsupported", capability?.reason || "shared runtime unsupported");
    }
    const error = new Error(capability?.reason || "this Codex CLI does not support a shared Unix app-server");
    error.code = "CODEX_SHARED_RUNTIME_UNSUPPORTED";
    throw error;
  }

  await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  await validateSocketPathSafety(socketPath, {
    allowMissingParent: false,
    allowMissingSocket: true,
  });
  await chmod(path.dirname(socketPath), 0o700);
  await mkdir(paths.runtimeDir, { recursive: true, mode: 0o700 });
  await chmod(paths.runtimeDir, 0o700);
  await mkdir(paths.logsDir, { recursive: true, mode: 0o700 });
  await chmod(paths.logsDir, 0o700);

  const lock = await acquireStartupLock(paths, options, probeOptions);
  if (!lock.acquired) {
    return sharedReadyResult({
      requestedMode,
      probe: lock.runtime,
      paths,
      reused: true,
      started: false,
    });
  }

  let ownedChild = null;
  let ownedChildReady = false;
  try {
    probe = await probeCodexSharedRuntime(probeOptions);
    if (probe.ready) {
      return sharedReadyResult({ requestedMode, probe, paths, reused: true, started: false });
    }

    const codexBinary = pickString(options.codexBinary, env.CLAWDAD_CODEX_BIN, "codex");
    const recoveredOwner = await recoverVerifiedUnhealthySocket(
      socketPath,
      probe,
      options,
      probeOptions,
      codexBinary,
    );
    if (recoveredOwner && !recoveredOwner.socketReleased) {
      probe = await probeCodexSharedRuntime(probeOptions);
      if (probe.ready) {
        return sharedReadyResult({
          requestedMode,
          probe,
          paths,
          reused: true,
          started: false,
          reason: `recovered unhealthy Codex app-server pid ${recoveredOwner.pid}`,
        });
      }
      throw new Error(
        `the Codex shared socket changed while unhealthy owner pid ${recoveredOwner.pid} was being replaced`,
      );
    }

    if (!recoveredOwner) {
      const staleSocketStat = await confirmedStaleSocket(socketPath, probe, options, probeOptions);
      if (staleSocketStat) {
        const beforeUnlink = await lstat(socketPath);
        if (
          !beforeUnlink.isSocket() ||
          beforeUnlink.dev !== staleSocketStat.dev ||
          beforeUnlink.ino !== staleSocketStat.ino
        ) {
          throw new Error(`the Codex shared socket changed while its stale state was being verified at ${socketPath}`);
        }
        await unlink(socketPath);
      } else {
        try {
          const socketStat = await lstat(socketPath);
          if (socketStat.isSocket()) {
            throw new Error(
              `the Codex shared socket exists but did not pass its initialize probe: ${probe.error || "unknown probe failure"}`,
            );
          }
          throw new Error(`refusing to replace non-socket path at ${socketPath}`);
        } catch (error) {
          if (errorCode(error) !== "ENOENT") throw error;
        }
      }
    }

    const defaultSocket = codexSharedSocketPath({
      ...env,
      CLAWDAD_CODEX_APP_SERVER_SOCKET: "",
    });
    const listenUrl = !pickString(env.CLAWDAD_CODEX_APP_SERVER_SOCKET) && socketPath === defaultSocket
      ? "unix://"
      : codexSharedRemoteUrl(socketPath);
    const logHandle = await open(paths.logPath, "a", 0o600);
    await chmod(paths.logPath, 0o600);
    let spawnError = null;
    try {
      ownedChild = (options.spawnImpl || spawnChild)(
        codexBinary,
        ["app-server", "--listen", listenUrl],
        {
          cwd: options.cwd || env.HOME || os.homedir(),
          env,
          detached: true,
          stdio: ["ignore", logHandle.fd, logHandle.fd],
        },
      );
      ownedChild.once?.("error", (error) => {
        spawnError = error;
      });
      ownedChild.unref?.();
    } finally {
      await logHandle.close();
    }
    const metadata = {
      pid: Number.isSafeInteger(ownedChild.pid) ? ownedChild.pid : null,
      socketPath,
      remoteUrl: codexSharedRemoteUrl(socketPath),
      codexBinary,
      command: [codexBinary, "app-server", "--listen", listenUrl],
      logPath: paths.logPath,
      startedAt: new Date().toISOString(),
      ownerPid: process.pid,
    };
    await atomicWriteJson(paths.metadataPath, metadata);

    const startupTimeoutMs = positiveInteger(options.startupTimeoutMs, defaultStartupTimeoutMs);
    const pollIntervalMs = positiveInteger(options.pollIntervalMs, defaultPollIntervalMs);
    const startedAt = Date.now();
    let lastProbe = probe;
    while (Date.now() - startedAt < startupTimeoutMs) {
      if (spawnError) {
        throw new Error(`failed to start the Codex shared app-server: ${errorMessage(spawnError)}`, {
          cause: spawnError,
        });
      }
      if (ownedChild.exitCode != null || ownedChild.signalCode != null) {
        throw new Error(
          `Codex shared app-server exited during startup (code=${ownedChild.exitCode ?? "null"}, signal=${ownedChild.signalCode ?? "null"}); see ${paths.logPath}`,
        );
      }
      lastProbe = await probeCodexSharedRuntime(probeOptions);
      if (lastProbe.ready) {
        const readySocketStat = await lstat(socketPath);
        await atomicWriteJson(paths.metadataPath, {
          ...metadata,
          socketDevice: readySocketStat.dev,
          socketInode: readySocketStat.ino,
          serverInfo: lastProbe.serverInfo || null,
          readyAt: new Date().toISOString(),
          replacedUnhealthyPid: recoveredOwner?.pid || null,
        });
        const result = await sharedReadyResult({
          requestedMode,
          probe: lastProbe,
          paths,
          reused: false,
          started: true,
          pid: metadata.pid,
        });
        ownedChildReady = true;
        return result;
      }
      await sleep(pollIntervalMs);
    }
    const error = new Error(
      `Codex shared app-server did not become ready within ${startupTimeoutMs}ms: ${lastProbe?.error || "no initialize response"}; see ${paths.logPath}`,
    );
    error.code = "CODEX_SHARED_RUNTIME_START_FAILED";
    throw error;
  } catch (error) {
    if (ownedChild && !ownedChildReady) {
      try {
        await terminateOwnedRuntimeChild(
          ownedChild,
          options.ownedChildTerminationTimeoutMs,
        );
      } catch (terminationError) {
        throw new AggregateError(
          [error, terminationError],
          `Codex shared app-server startup failed and its owned child could not be terminated: ${errorMessage(error)}`,
        );
      }
    }
    throw error;
  } finally {
    await releaseStartupLock(paths.lockPath, lock.token);
  }
}

export async function codexSharedRuntimeStatus(options = {}) {
  const env = options.env || process.env;
  const requestedMode = normalizeCodexAppServerMode(
    options.mode ?? env.CLAWDAD_CODEX_APP_SERVER_MODE,
  );
  if (requestedMode === "isolated") {
    return isolatedResult(requestedMode, "isolated");
  }
  const socketPath = normalizeSocketPath(options.socketPath || codexSharedSocketPath(env));
  const paths = runtimePaths(options, socketPath);
  const probe = await probeCodexSharedRuntime({
    env,
    socketPath,
    timeoutMs: positiveInteger(options.probeTimeoutMs ?? options.timeoutMs, defaultProbeTimeoutMs),
    WebSocketImpl: options.WebSocketImpl,
  });
  const metadata = await readMatchingMetadata(paths, socketPath);
  const pid = Number.isSafeInteger(metadata?.pid) ? metadata.pid : null;
  return {
    mode: "shared",
    requestedMode,
    ready: probe.ready,
    state: probe.ready ? "ready" : "stopped",
    socketPath,
    remoteUrl: codexSharedRemoteUrl(socketPath),
    webSocketUrl: codexSharedWebSocketUrl(socketPath),
    reused: false,
    started: false,
    pid,
    pidAlive: pid ? processIsAlive(pid) : false,
    managed: Boolean(metadata),
    logPath: metadata?.logPath || paths.logPath,
    reason: probe.ready ? null : probe.error,
    errorCode: probe.errorCode || null,
  };
}
