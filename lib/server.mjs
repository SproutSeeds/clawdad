#!/usr/bin/env node

import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chmod, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";

const execFileP = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clawdadRoot = process.env.CLAWDAD_ROOT || path.resolve(__dirname, "..");
const clawdadHome = process.env.CLAWDAD_HOME || path.join(os.homedir(), ".clawdad");
const clawdadBin =
  process.env.CLAWDAD_BIN_PATH || path.resolve(clawdadRoot, "bin", "clawdad");
const serverModulePath = path.resolve(clawdadRoot, "lib", "server.mjs");
const packageJsonPath = path.resolve(clawdadRoot, "package.json");
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const version = packageJson.version || "dev";
const launchAgentLabelDefault = "com.sproutseeds.clawdad.server";
const systemdUnitNameDefault = "clawdad-server.service";
const stateFilePath = path.join(clawdadHome, "state.json");
const webAppRoot = path.join(clawdadRoot, "web");
const assetsRoot = path.join(clawdadRoot, "assets");
const mascotAssetPath = path.join(clawdadRoot, "assets", "clawdad-mascot.jpg");
const mascotCutoutAssetPath = path.join(clawdadRoot, "assets", "clawdad-mascot-cutout.png");
const mascotAppAssetPath = path.join(clawdadRoot, "assets", "clawdad-mascot-app.png");
const clawMarkAssetPath = path.join(clawdadRoot, "assets", "clawdad-claw.svg");
const wordmarkAssetPath = path.join(clawdadRoot, "assets", "clawdad-wordmark.svg");
const defaultServerConfigPath =
  process.env.CLAWDAD_SERVER_CONFIG_FILE || path.join(clawdadHome, "server.json");
const defaultTokenFile =
  process.env.CLAWDAD_SERVER_TOKEN_FILE || path.join(clawdadHome, "server.token");
const defaultShortcutTemplatePath = path.join(
  clawdadHome,
  "shortcuts",
  "dispatch-request.json",
);
const defaultTailscaleBinary = process.env.CLAWDAD_TAILSCALE || "tailscale";
const projectCatalogCacheTtlMs = 10_000;
const projectCatalogCache = {
  value: null,
  loadedAt: 0,
  promise: null,
};
const transcriptPathCacheTtlMs = 60_000;
const transcriptPathCache = new Map();
const transcriptTurnCache = new Map();

function printUsage() {
  console.log(`clawdad server helpers

Usage:
  clawdad serve [options]
  clawdad secure-bootstrap [options]
  clawdad secure-doctor [options]
  clawdad gen-token [options]
  clawdad print-launch-agent [options]
  clawdad install-launch-agent [options]
  clawdad print-systemd-unit [options]
  clawdad install-systemd-unit [options]

Commands:
  serve
    Start the HTTP listener for remote dispatches.

  secure-bootstrap
    Write the secure self-hosted config, shortcut template, and launch agent.
    Add --apply-serve to configure Tailscale Serve automatically.

  secure-doctor
    Verify the secure Tailscale + localhost deployment.

  gen-token
    Generate a bearer token. Add --write to save it to the token file.

  print-launch-agent
    Print a launchd plist for running 'clawdad serve' continuously on macOS.

  install-launch-agent
    Write the launchd plist to ~/Library/LaunchAgents (or --path).

  print-systemd-unit
    Print a systemd user unit for running 'clawdad serve' continuously on Linux.

  install-systemd-unit
    Write the systemd user unit to ~/.config/systemd/user (or --path).

Common options:
  --config <path>              Server config path (default: ${defaultServerConfigPath})
  --host <host>                Listener host (default: ${process.env.CLAWDAD_SERVER_HOST || "127.0.0.1"})
  --port <port>                Listener port (default: ${process.env.CLAWDAD_SERVER_PORT || "4477"})
  --default-project <slug>     Default project slug/path when a request omits 'project'
  --auth-mode <mode>           token, tailscale, or hybrid (default: ${process.env.CLAWDAD_SERVER_AUTH_MODE || "token"})
  --allowed-users <csv>        Comma-separated Tailscale login allowlist
  --allow-user <login>         Add one allowed Tailscale login (repeatable)
  --require-capability <cap>   Required Tailscale app capability
  --allow-tagged-devices       Allow requests without a Tailscale user login
  --token <token>              Bearer token to require for API requests
  --token-file <path>          Token file path (default: ${defaultTokenFile})

serve options:
  --body-limit-bytes <bytes>   Max request body size (default: ${process.env.CLAWDAD_SERVER_BODY_LIMIT_BYTES || "65536"})

secure-bootstrap options:
  --apply-serve                Run 'tailscale serve --bg' for the configured listener
  --https-port <port>          Tailscale Serve HTTPS port (default: ${process.env.CLAWDAD_SERVER_HTTPS_PORT || "443"})
  --shortcut-path <path>       Where to write the iPhone shortcut request template
  --skip-service-unit          Do not write the OS service unit
  --skip-launch-agent          Backward-compatible alias for --skip-service-unit

secure-doctor options:
  --json                       Emit machine-readable JSON

service unit options:
  --label <label>              launchd label (default: ${launchAgentLabelDefault})
  --systemd-name <name>        systemd user unit name (default: ${systemdUnitNameDefault})
  --path <path>                Output plist path
  --stdout-log <path>          Stdout log path
  --stderr-log <path>          Stderr log path

gen-token options:
  --write                      Write the token to the token file and chmod 600 it
`);
}

function parseArgs(argv) {
  const options = { _: [], allowUser: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--write":
      case "--allow-tagged-devices":
      case "--apply-serve":
      case "--skip-service-unit":
      case "--skip-launch-agent":
      case "--json":
        options[arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = true;
        break;
      case "--allow-user":
      case "--allowed-user": {
        const value = argv[index + 1];
        if (value == null) {
          throw new Error(`missing value for ${arg}`);
        }
        options.allowUser.push(value);
        index += 1;
        break;
      }
      case "--config":
      case "--host":
      case "--port":
      case "--auth-mode":
      case "--allowed-users":
      case "--require-capability":
      case "--token":
      case "--token-file":
      case "--default-project":
      case "--body-limit-bytes":
      case "--https-port":
      case "--shortcut-path":
      case "--label":
      case "--systemd-name":
      case "--path":
      case "--stdout-log":
      case "--stderr-log": {
        const value = argv[index + 1];
        if (value == null) {
          throw new Error(`missing value for ${arg}`);
        }
        options[arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = value;
        index += 1;
        break;
      }
      default:
        options._.push(arg);
        break;
    }
  }

  return options;
}

function toPositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function boolFromUnknown(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  }
  return fallback;
}

function trimTrailingNewlines(text) {
  return String(text || "").replace(/\s+$/u, "");
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload, null, 2));
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return "";
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function splitCommaSeparated(value) {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeAllowedUsers(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) {
      return uniqueStrings(value);
    }
    if (typeof value === "string" && value.trim() !== "") {
      return uniqueStrings(splitCommaSeparated(value));
    }
  }
  return [];
}

function normalizeStringList(...values) {
  const collected = [];

  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (typeof value !== "string") {
      return;
    }

    splitCommaSeparated(value).forEach((entry) => {
      if (entry) {
        collected.push(entry);
      }
    });
  };

  values.forEach(visit);
  return uniqueStrings(collected);
}

function expandHomePath(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed === "~") {
    return os.homedir();
  }
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function compactHomePath(filePath) {
  const home = os.homedir();
  if (filePath === home) {
    return "~";
  }
  if (filePath.startsWith(`${home}${path.sep}`)) {
    return `~/${path.relative(home, filePath)}`;
  }
  return filePath;
}

async function normalizeDirectoryPath(dirPath) {
  const expanded = expandHomePath(dirPath);
  if (!expanded) {
    return "";
  }

  const resolved = path.resolve(expanded);
  try {
    const canonical = await realpath(resolved);
    const stats = await stat(canonical);
    return stats.isDirectory() ? canonical : "";
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function pathInsideRoot(rootPath, targetPath) {
  const normalizedRoot = path.resolve(String(rootPath || ""));
  const normalizedTarget = path.resolve(String(targetPath || ""));
  return (
    normalizedTarget === normalizedRoot ||
    normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
  );
}

function projectNameIsValid(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed || trimmed === "." || trimmed === "..") {
    return false;
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return false;
  }
  return !trimmed.startsWith(".");
}

function normalizeProviderName(value) {
  const normalized = String(value || "claude").trim().toLowerCase();
  if (!["claude", "codex", "chimera"].includes(normalized)) {
    throw new Error(`unsupported provider '${value}'`);
  }
  return normalized;
}

function resolveBooleanSetting(cliEnabled, envValue, configValue, fallback = false) {
  if (cliEnabled) {
    return true;
  }
  if (envValue != null && String(envValue).trim() !== "") {
    return boolFromUnknown(envValue, fallback);
  }
  if (configValue != null) {
    return boolFromUnknown(configValue, fallback);
  }
  return fallback;
}

function normalizeAuthMode(value) {
  const normalized = String(value || "token").trim().toLowerCase();
  switch (normalized) {
    case "token":
      return "token";
    case "tailscale":
      return "tailscale";
    case "hybrid":
    case "tailscale-or-token":
      return "hybrid";
    default:
      throw new Error(`unsupported auth mode '${value}' (expected token, tailscale, or hybrid)`);
  }
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(left || "", "utf8");
  const rightBuffer = Buffer.from(right || "", "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function normalizeHost(host) {
  return String(host || "").trim().replace(/^\[(.*)\]$/u, "$1").toLowerCase();
}

function isLoopbackHost(host) {
  return ["127.0.0.1", "::1", "localhost"].includes(normalizeHost(host));
}

function isLoopbackRemote(remoteAddress) {
  const normalized = normalizeHost(remoteAddress);
  return (
    normalized === "::1" ||
    normalized === "127.0.0.1" ||
    normalized === "::ffff:127.0.0.1"
  );
}

function headerValue(req, headerName) {
  const value = req.headers[headerName.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] || "";
  }
  return value || "";
}

function bearerTokenFromRequest(req) {
  const authHeader = headerValue(req, "authorization");
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  return headerValue(req, "x-clawdad-token").trim();
}

async function readBody(req, limitBytes) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > limitBytes) {
      throw new Error(`request body exceeds ${limitBytes} bytes`);
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw new Error(`failed to read ${filePath}: ${error.message}`);
  }
}

async function writeJsonFile(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function stateLockDirPath() {
  return path.join(clawdadHome, ".state.lock");
}

function stateLockOwnerPath() {
  return path.join(stateLockDirPath(), "owner");
}

async function clearStateLockStale() {
  try {
    const lockStats = await stat(stateLockDirPath());
    const lockAgeMs = Date.now() - lockStats.mtimeMs;
    if (lockAgeMs <= 30_000) {
      return;
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  try {
    await writeFile(stateLockOwnerPath(), "", "utf8");
  } catch (_error) {
    // Ignore cleanup best-effort failures and retry lock acquisition.
  }

  try {
    await rm(stateLockDirPath(), { recursive: true, force: true });
  } catch (_error) {
    // Ignore stale-lock cleanup failures; acquisition will retry or time out.
  }
}

async function withStateLock(work) {
  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(stateLockDirPath());
      await writeFile(stateLockOwnerPath(), `${process.pid} ${Math.floor(Date.now() / 1000)}\n`, "utf8");
      break;
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      await clearStateLockStale();
      if (Date.now() - startedAt > 30_000) {
        throw new Error(`timed out waiting for state lock at ${stateLockDirPath()}`);
      }
      await sleep(100);
    }
  }

  try {
    return await work();
  } finally {
    try {
      await rm(stateLockDirPath(), { recursive: true, force: true });
    } catch (_error) {
      // Ignore unlock cleanup failures.
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function basenameOrFallback(projectPath, fallback = "project") {
  const normalized = String(projectPath || "").trim().replace(/\/+$/u, "");
  return normalized ? path.basename(normalized) : fallback;
}

function responseBodyForStatusCode(statusCode) {
  switch (statusCode) {
    case 200:
      return "OK";
    case 204:
      return "";
    case 404:
      return "Not Found";
    default:
      return "Error";
  }
}

function send(res, statusCode, body, headers = {}) {
  const payload = body == null ? "" : Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
  res.writeHead(statusCode, {
    "cache-control": "no-store, no-cache, must-revalidate, max-age=0, private",
    pragma: "no-cache",
    expires: "0",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(payload);
}

function inferMimeType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".webmanifest":
      return "application/manifest+json; charset=utf-8";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

async function sendFile(res, filePath, headers = {}) {
  try {
    const file = await readFile(filePath);
    send(res, 200, file, {
      "content-type": inferMimeType(filePath),
      ...headers,
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      send(res, 404, responseBodyForStatusCode(404), {
        "content-type": "text/plain; charset=utf-8",
      });
      return;
    }
    throw error;
  }
}

function sessionSummaryFromTab(tab, stateEntry = {}, activeSessionId = "") {
  const sessionId = String(tab?.resumeSessionId || "").trim();
  const sessionState =
    stateEntry && typeof stateEntry === "object" && stateEntry.sessions
      ? stateEntry.sessions?.[sessionId] || {}
      : {};

  return {
    slug: String(tab?.title || "").trim() || basenameOrFallback(String(tab?.path || "").trim()),
    path: String(tab?.path || "").trim(),
    provider: String(tab?.resumeTool || "").trim() || "claude",
    sessionId: sessionId || null,
    active: Boolean(sessionId && sessionId === activeSessionId),
    status: String(sessionState.status || "").trim() || "idle",
    dispatchCount: Number.parseInt(sessionState.dispatch_count || "0", 10) || 0,
    lastDispatch: String(sessionState.last_dispatch || "").trim() || null,
    lastResponse: String(sessionState.last_response || "").trim() || null,
    providerSessionSeeded:
      String(sessionState.provider_session_seeded || "true").trim() === "true",
  };
}

function chooseActiveSessionId(projectPath, sessionTabs, stateEntry = {}) {
  const configured = String(stateEntry.active_session_id || "").trim();
  if (configured && sessionTabs.some((tab) => String(tab?.resumeSessionId || "").trim() === configured)) {
    return configured;
  }

  const bucketName = basenameOrFallback(projectPath);
  const exactName = sessionTabs.find(
    (tab) =>
      String(tab?.title || "").trim() === bucketName &&
      String(tab?.resumeSessionId || "").trim() !== "",
  );
  if (exactName) {
    return String(exactName.resumeSessionId).trim();
  }

  const first = sessionTabs.find((tab) => String(tab?.resumeSessionId || "").trim() !== "");
  return first ? String(first.resumeSessionId).trim() : "";
}

function projectSummaryFromTabs(projectPath, tabsForPath, stateProjects = {}) {
  const stateEntry = stateProjects?.[projectPath] || {};
  const dispatchableTabs = tabsForPath.filter(
    (tab) => String(tab?.resumeSessionId || "").trim() !== "",
  );
  const activeSessionId = chooseActiveSessionId(projectPath, dispatchableTabs, stateEntry);
  const sessions = dispatchableTabs.map((tab) =>
    sessionSummaryFromTab(tab, stateEntry, activeSessionId),
  );
  const activeSession =
    sessions.find((session) => session.sessionId === activeSessionId) || sessions[0] || null;

  return {
    slug: basenameOrFallback(projectPath),
    displayName: basenameOrFallback(projectPath),
    path: projectPath,
    provider: activeSession?.provider || "claude",
    sessionId: activeSession?.sessionId || null,
    activeSessionId: activeSession?.sessionId || null,
    activeSessionLabel: activeSession?.slug || null,
    activeSession,
    sessionCount: sessions.length,
    sessions,
    status: String(stateEntry.status || "").trim() || "idle",
    dispatchCount: Number.parseInt(stateEntry.dispatch_count || "0", 10) || 0,
    lastDispatch: String(stateEntry.last_dispatch || "").trim() || null,
    lastResponse: String(stateEntry.last_response || "").trim() || null,
    registeredAt: String(stateEntry.registered_at || "").trim() || null,
  };
}

function projectMatchesInput(project, input) {
  const needle = String(input || "").trim();
  if (!needle) {
    return false;
  }

  if (project.path === needle || project.slug === needle || project.displayName === needle) {
    return true;
  }

  if (basenameOrFallback(project.path) === needle) {
    return true;
  }

  return project.sessions.some(
    (session) => session.sessionId === needle || session.slug === needle,
  );
}

function mailboxPaths(projectPath) {
  const mailboxDir = path.join(projectPath, ".clawdad", "mailbox");
  return {
    mailboxDir,
    statusFile: path.join(mailboxDir, "status.json"),
    responseFile: path.join(mailboxDir, "response.md"),
  };
}

function historyPaths(projectPath) {
  const historyDir = path.join(projectPath, ".clawdad", "history");
  return {
    historyDir,
    sessionsDir: path.join(historyDir, "sessions"),
    requestsDir: path.join(historyDir, "requests"),
  };
}

function sanitizeHistoryKey(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9._-]/g, "_");
}

function historySessionDir(projectPath, sessionId) {
  return path.join(historyPaths(projectPath).sessionsDir, sanitizeHistoryKey(sessionId));
}

function normalizeHistoryStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "completed") {
    return "answered";
  }
  if (normalized === "failed") {
    return "failed";
  }
  if (normalized === "answered") {
    return "answered";
  }
  return "queued";
}

function normalizeHistoryEntry(payload = {}) {
  return {
    requestId: pickString(payload.requestId) || null,
    projectPath: pickString(payload.projectPath) || null,
    sessionId: pickString(payload.sessionId) || null,
    sessionSlug: pickString(payload.sessionSlug) || null,
    provider: pickString(payload.provider, "session"),
    message: String(payload.message || ""),
    sentAt: pickString(payload.sentAt) || null,
    answeredAt: pickString(payload.answeredAt) || null,
    status: normalizeHistoryStatus(payload.status),
    exitCode: typeof payload.exitCode === "number" ? payload.exitCode : null,
    response: String(payload.response || ""),
  };
}

function historyItemTimestampMs(entry) {
  const value = pickString(entry?.answeredAt, entry?.sentAt);
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function providerTranscriptCacheKey(provider, sessionId) {
  return `${String(provider || "").trim().toLowerCase()}:${String(sessionId || "").trim()}`;
}

function providerHistoryRoot(provider) {
  const normalized = String(provider || "").trim().toLowerCase();
  if (normalized === "claude") {
    return path.join(os.homedir(), ".claude", "projects");
  }
  if (normalized === "codex") {
    return path.join(os.homedir(), ".codex", "sessions");
  }
  return "";
}

async function findTranscriptFileRecursive(rootDir, matcher) {
  if (!rootDir) {
    return "";
  }

  const pending = [rootDir];
  while (pending.length > 0) {
    const currentDir = pending.pop();
    let entries = [];
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (entry.isFile() && matcher(entry.name, entryPath)) {
        return entryPath;
      }
    }
  }

  return "";
}

async function findProviderTranscriptPath(provider, sessionId) {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedProvider || !normalizedSessionId) {
    return "";
  }

  const cacheKey = providerTranscriptCacheKey(normalizedProvider, normalizedSessionId);
  const cached = transcriptPathCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < transcriptPathCacheTtlMs) {
    return cached.filePath;
  }

  const rootDir = providerHistoryRoot(normalizedProvider);
  const filePath = await findTranscriptFileRecursive(rootDir, (name) => {
    if (!name.endsWith(".jsonl")) {
      return false;
    }
    if (normalizedProvider === "claude") {
      return name === `${normalizedSessionId}.jsonl`;
    }
    if (normalizedProvider === "codex") {
      return name.includes(normalizedSessionId);
    }
    return false;
  });

  transcriptPathCache.set(cacheKey, {
    filePath,
    checkedAt: Date.now(),
  });
  return filePath;
}

function textFromMessageContent(content) {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }

  const textParts = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    if (typeof block.text === "string" && block.text.trim() !== "") {
      textParts.push(block.text.trim());
      continue;
    }
    if (typeof block.input === "string" && block.input.trim() !== "") {
      textParts.push(block.input.trim());
      continue;
    }
    if (typeof block.output === "string" && block.output.trim() !== "") {
      textParts.push(block.output.trim());
      continue;
    }
    if (Array.isArray(block.content)) {
      const nested = textFromMessageContent(block.content);
      if (nested) {
        textParts.push(nested);
      }
    }
  }

  return textParts.join("\n\n").trim();
}

function looksLikeInjectedCodexMessage(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return false;
  }

  return (
    trimmed.startsWith("<permissions instructions>") ||
    trimmed.startsWith("# AGENTS.md instructions for ") ||
    trimmed.startsWith("<environment_context>") ||
    trimmed.startsWith("<apps_instructions>") ||
    trimmed.startsWith("<skills_instructions>") ||
    trimmed.startsWith("<plugins_instructions>")
  );
}

function buildHistoryTurns(messages, session = {}) {
  const sessionId = String(session.sessionId || "").trim();
  const sessionSlug = String(session.slug || "").trim();
  const provider = String(session.provider || "").trim() || "session";
  const projectPath = String(session.path || "").trim();
  const turns = [];
  let pendingTurn = null;
  let turnIndex = 0;

  const flushPending = () => {
    if (!pendingTurn) {
      return;
    }

    const completed = String(pendingTurn.response || "").trim() !== "";
    turns.push(
      normalizeHistoryEntry({
        requestId: `${provider}:${sessionId}:${turnIndex}`,
        projectPath,
        sessionId,
        sessionSlug,
        provider,
        message: pendingTurn.message,
        sentAt: pendingTurn.sentAt,
        answeredAt: pendingTurn.answeredAt,
        status: completed ? "answered" : "queued",
        exitCode: completed ? 0 : null,
        response: pendingTurn.response,
      }),
    );
    turnIndex += 1;
    pendingTurn = null;
  };

  for (const message of messages) {
    const role = String(message?.role || "").trim().toLowerCase();
    const text = String(message?.text || "").trim();
    if (!text) {
      continue;
    }

    if (role === "user") {
      flushPending();
      pendingTurn = {
        message: text,
        sentAt: pickString(message.timestamp) || null,
        answeredAt: null,
        response: "",
      };
      continue;
    }

    if (role !== "assistant" || !pendingTurn) {
      continue;
    }

    pendingTurn.response = pendingTurn.response
      ? `${pendingTurn.response}\n\n${text}`
      : text;
    pendingTurn.answeredAt = pickString(message.timestamp) || pendingTurn.answeredAt;
  }

  flushPending();
  return turns;
}

function parseClaudeTranscriptLines(lines, session) {
  const messages = [];

  for (const line of lines) {
    let payload;
    try {
      payload = JSON.parse(line);
    } catch (_error) {
      continue;
    }

    const type = String(payload?.type || "").trim().toLowerCase();
    if (type !== "user" && type !== "assistant") {
      continue;
    }

    const role = String(payload?.message?.role || type).trim().toLowerCase();
    if (role !== "user" && role !== "assistant") {
      continue;
    }

    const text = textFromMessageContent(payload?.message?.content);
    if (!text) {
      continue;
    }

    messages.push({
      role,
      text,
      timestamp: pickString(payload?.timestamp),
    });
  }

  return buildHistoryTurns(messages, session);
}

function parseCodexTranscriptLines(lines, session) {
  const messages = [];

  for (const line of lines) {
    let payload;
    try {
      payload = JSON.parse(line);
    } catch (_error) {
      continue;
    }

    if (String(payload?.type || "").trim() !== "response_item") {
      continue;
    }
    if (String(payload?.payload?.type || "").trim() !== "message") {
      continue;
    }

    const role = String(payload?.payload?.role || "").trim().toLowerCase();
    if (role === "developer") {
      continue;
    }
    if (role !== "user" && role !== "assistant") {
      continue;
    }

    const text = textFromMessageContent(payload?.payload?.content);
    if (!text) {
      continue;
    }
    if (role === "user" && looksLikeInjectedCodexMessage(text)) {
      continue;
    }

    messages.push({
      role,
      text,
      timestamp: pickString(payload?.timestamp),
    });
  }

  return buildHistoryTurns(messages, session);
}

async function readProviderHistory(projectPath, session) {
  const normalizedSession = {
    ...session,
    path: projectPath,
  };
  const provider = String(normalizedSession.provider || "").trim().toLowerCase();
  const sessionId = String(normalizedSession.sessionId || "").trim();
  if (!provider || !sessionId) {
    return [];
  }

  const transcriptPath = await findProviderTranscriptPath(provider, sessionId);
  if (!transcriptPath) {
    return [];
  }

  const cacheKey = providerTranscriptCacheKey(provider, sessionId);
  const transcriptStats = await stat(transcriptPath);
  const cached = transcriptTurnCache.get(cacheKey);
  if (
    cached &&
    cached.filePath === transcriptPath &&
    cached.mtimeMs === transcriptStats.mtimeMs
  ) {
    return cached.items;
  }

  const raw = await readFile(transcriptPath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  let items = [];
  if (provider === "claude") {
    items = parseClaudeTranscriptLines(lines, normalizedSession);
  } else if (provider === "codex") {
    items = parseCodexTranscriptLines(lines, normalizedSession);
  }

  items.sort((left, right) => historyItemTimestampMs(right) - historyItemTimestampMs(left));
  transcriptTurnCache.set(cacheKey, {
    filePath: transcriptPath,
    mtimeMs: transcriptStats.mtimeMs,
    items,
  });
  return items;
}

async function readMirroredSessionHistory(projectPath, sessionId) {
  const sessionDir = historySessionDir(projectPath, sessionId);
  let names = [];

  try {
    names = (await readdir(sessionDir)).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  names.sort((left, right) => right.localeCompare(left));
  const items = [];

  for (const name of names) {
    const payload = await readOptionalJson(path.join(sessionDir, name));
    if (!payload || typeof payload !== "object") {
      continue;
    }
    items.push(normalizeHistoryEntry(payload));
  }

  return items;
}

async function readSessionHistoryPage(projectPath, session, { cursor = 0, limit = 20 } = {}) {
  const mirroredItems = await readMirroredSessionHistory(projectPath, session.sessionId);
  const providerItems = await readProviderHistory(projectPath, session);
  let combinedItems = mirroredItems;

  if (providerItems.length > 0) {
    if (mirroredItems.length === 0) {
      combinedItems = providerItems;
    } else {
      const oldestMirroredTimestamp = mirroredItems.reduce((oldest, entry) => {
        const timestamp = historyItemTimestampMs(entry);
        if (timestamp === 0) {
          return oldest;
        }
        return oldest === 0 ? timestamp : Math.min(oldest, timestamp);
      }, 0);

      const olderProviderItems =
        oldestMirroredTimestamp > 0
          ? providerItems.filter((entry) => historyItemTimestampMs(entry) < oldestMirroredTimestamp)
          : providerItems;

      combinedItems = [...mirroredItems, ...olderProviderItems];
    }
  }

  combinedItems.sort((left, right) => historyItemTimestampMs(right) - historyItemTimestampMs(left));
  const offset = Math.max(0, Number.parseInt(String(cursor || "0"), 10) || 0);
  const pageItems = combinedItems.slice(offset, offset + limit);
  const nextCursor =
    offset + pageItems.length < combinedItems.length ? String(offset + pageItems.length) : null;
  return {
    items: pageItems,
    nextCursor,
    total: combinedItems.length,
  };
}

function responseBodyFromMailbox(markdown) {
  const content = String(markdown || "");
  const separator = "\n---\n";
  const index = content.indexOf(separator);
  if (index === -1) {
    return content.trim();
  }
  return content.slice(index + separator.length).trim();
}

function sessionDisplayForStatus(session) {
  const provider = String(session?.provider || "session").trim();
  const sessionId = String(session?.sessionId || "").trim();
  const shortId = sessionId ? (sessionId.length <= 8 ? sessionId : `…${sessionId.slice(-8)}`) : "unknown";
  return `${provider} • ${shortId}`;
}

function projectWithActiveSession(project, sessionId) {
  if (!project || !Array.isArray(project.sessions) || !sessionId) {
    return project;
  }

  const sessions = project.sessions.map((session) => ({
    ...session,
    active: session.sessionId === sessionId,
  }));
  const activeSession =
    sessions.find((session) => session.sessionId === sessionId) ||
    sessions.find((session) => session.active) ||
    project.activeSession ||
    null;

  return {
    ...project,
    provider: activeSession?.provider || project.provider || "claude",
    sessionId: activeSession?.sessionId || null,
    activeSessionId: activeSession?.sessionId || null,
    activeSessionLabel: activeSession?.slug || null,
    activeSession,
    sessions,
  };
}

function updateCachedProjectSelection(projectPath, sessionId) {
  if (!Array.isArray(projectCatalogCache.value)) {
    return null;
  }

  let updatedProject = null;
  projectCatalogCache.value = projectCatalogCache.value.map((project) => {
    if (project.path !== projectPath) {
      return project;
    }
    updatedProject = projectWithActiveSession(project, sessionId);
    return updatedProject;
  });
  if (updatedProject) {
    projectCatalogCache.loadedAt = Date.now();
  }
  return updatedProject;
}

async function persistActiveSessionSelection(projectPath, sessionId) {
  return withStateLock(async () => {
    let statePayload = {};
    try {
      statePayload = (await readOptionalJson(stateFilePath)) || {};
    } catch (error) {
      console.warn(`[clawdad-server] ignoring invalid state file at ${stateFilePath}: ${error.message}`);
      statePayload = {};
    }

    if (!statePayload || typeof statePayload !== "object") {
      statePayload = {};
    }
    if (!statePayload.projects || typeof statePayload.projects !== "object") {
      statePayload.projects = {};
    }

    const existingProject =
      statePayload.projects[projectPath] && typeof statePayload.projects[projectPath] === "object"
        ? statePayload.projects[projectPath]
        : {};
    const existingSessions =
      existingProject.sessions && typeof existingProject.sessions === "object"
        ? existingProject.sessions
        : {};
    const nextSessions = {
      ...existingSessions,
      [sessionId]: {
        ...(existingSessions[sessionId] || {}),
        last_selected_at: new Date().toISOString(),
      },
    };

    statePayload.projects[projectPath] = {
      ...existingProject,
      sessions: nextSessions,
      active_session_id: sessionId,
    };

    await writeJsonFile(stateFilePath, statePayload);
    return statePayload;
  });
}

async function readMailboxStatus(projectPath) {
  const { statusFile } = mailboxPaths(projectPath);
  return (await readOptionalJson(statusFile)) || {};
}

async function readMailboxResponse(projectPath) {
  const { responseFile } = mailboxPaths(projectPath);
  try {
    return await readFile(responseFile, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function resolveProjectPathForRequest(projectInput, configuredDefaultProject) {
  const requested = String(projectInput || "").trim() || String(configuredDefaultProject || "").trim();
  if (!requested) {
    return "";
  }
  if (requested.startsWith("/")) {
    return requested;
  }

  const projects = await loadProjectCatalogCached();
  return projects.find((project) => projectMatchesInput(project, requested))?.path || "";
}

async function waitForMailboxCompletion(projectPath, timeoutMs = null, previousRequestId = "") {
  const startedAt = Date.now();

  while (true) {
    const status = await readMailboxStatus(projectPath);
    const state = String(status.state || "").trim();
    const requestId = String(status.request_id || "").trim();
    if (previousRequestId && requestId === previousRequestId) {
      if (typeof timeoutMs === "number" && timeoutMs >= 0 && Date.now() - startedAt >= timeoutMs) {
        return { state: "timeout" };
      }
      await sleep(1000);
      continue;
    }

    if (state === "completed" || state === "failed") {
      return status;
    }

    if (typeof timeoutMs === "number" && timeoutMs >= 0 && Date.now() - startedAt >= timeoutMs) {
      return { state: "timeout" };
    }

    await sleep(1000);
  }
}

async function waitForMailboxRequestStart(projectPath, previousRequestId = "", timeoutMs = 3000) {
  const startedAt = Date.now();

  while (true) {
    const status = await readMailboxStatus(projectPath);
    const requestId = String(status.request_id || "").trim();
    if (requestId && requestId !== previousRequestId) {
      return status;
    }

    if (Date.now() - startedAt >= timeoutMs) {
      return {};
    }

    await sleep(100);
  }
}

async function loadProjectCatalog() {
  const statusResult = await runClawdad(["status", "--json"]);
  if (!statusResult.ok) {
    throw new Error(statusResult.stderr || statusResult.stdout || "failed to list projects");
  }

  let payload;
  try {
    payload = JSON.parse(statusResult.stdout || "{}");
  } catch (error) {
    throw new Error(`failed to parse clawdad status JSON: ${error.message}`);
  }

  const tabs = Array.isArray(payload.tabs) ? payload.tabs : [];
  let statePayload = {};
  try {
    statePayload = (await readOptionalJson(stateFilePath)) || {};
  } catch (error) {
    console.warn(`[clawdad-server] ignoring invalid state file at ${stateFilePath}: ${error.message}`);
    statePayload = {};
  }
  const stateProjects =
    statePayload && typeof statePayload === "object" && statePayload.projects
      ? statePayload.projects
      : {};
  const grouped = new Map();

  for (const tab of tabs) {
    const projectPath = String(tab?.path || "").trim();
    if (!projectPath || !String(tab?.resumeSessionId || "").trim()) {
      continue;
    }

    const existing = grouped.get(projectPath) || [];
    existing.push(tab);
    grouped.set(projectPath, existing);
  }

  return [...grouped.entries()]
    .map(([projectPath, tabsForPath]) => projectSummaryFromTabs(projectPath, tabsForPath, stateProjects))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

async function loadProjectCatalogCached() {
  const now = Date.now();
  if (projectCatalogCache.value && now - projectCatalogCache.loadedAt < projectCatalogCacheTtlMs) {
    return projectCatalogCache.value;
  }

  if (projectCatalogCache.promise) {
    return projectCatalogCache.promise;
  }

  projectCatalogCache.promise = loadProjectCatalog()
    .then((projects) => {
      projectCatalogCache.value = projects;
      projectCatalogCache.loadedAt = Date.now();
      return projects;
    })
    .finally(() => {
      projectCatalogCache.promise = null;
    });

  return projectCatalogCache.promise;
}

function invalidateProjectCatalogCache() {
  projectCatalogCache.value = null;
  projectCatalogCache.loadedAt = 0;
  projectCatalogCache.promise = null;
}

async function loadHeaderCarouselImages() {
  let names = [];
  try {
    names = await readdir(assetsRoot);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return names
    .filter((name) => /^clawdad-header-\d+\.jpg$/i.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((name) => `/assets/${name}`);
}

async function maybeServeApp(req, res, url) {
  if (req.method !== "GET") {
    return false;
  }

  const appAssets = {
    "/": path.join(webAppRoot, "index.html"),
    "/app.css": path.join(webAppRoot, "app.css"),
    "/app.js": path.join(webAppRoot, "app.js"),
    "/manifest.webmanifest": path.join(webAppRoot, "manifest.webmanifest"),
    "/assets/clawdad-mascot.jpg": mascotAssetPath,
    "/assets/clawdad-mascot-cutout.png": mascotCutoutAssetPath,
    "/assets/clawdad-mascot-app.png": mascotAppAssetPath,
    "/assets/clawdad-claw.svg": clawMarkAssetPath,
    "/assets/clawdad-wordmark.svg": wordmarkAssetPath,
    "/favicon.ico": mascotAppAssetPath,
  };

  const target = appAssets[url.pathname];
  if (!target) {
    if (!url.pathname.startsWith("/assets/")) {
      return false;
    }

    const relativeAssetPath = decodeURIComponent(url.pathname.slice("/assets/".length));
    const resolvedAssetPath = path.resolve(assetsRoot, relativeAssetPath);
    if (
      resolvedAssetPath !== assetsRoot &&
      !resolvedAssetPath.startsWith(`${assetsRoot}${path.sep}`)
    ) {
      send(res, 404, responseBodyForStatusCode(404), {
        "content-type": "text/plain; charset=utf-8",
      });
      return true;
    }

    await sendFile(res, resolvedAssetPath);
    return true;
  }

  await sendFile(res, target);
  return true;
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function projectRootLabel(rootPath) {
  return compactHomePath(rootPath);
}

async function allowedProjectRoots(options = {}) {
  const configuredRoots = Array.isArray(options.projectRoots) ? options.projectRoots : [];
  const candidates = [...configuredRoots];

  if (candidates.length === 0) {
    candidates.push(path.join(os.homedir(), "code"));
    candidates.push("/Volumes/Code_2TB/code");

    try {
      const trackedProjects = await loadProjectCatalogCached();
      trackedProjects.forEach((project) => {
        if (project?.path) {
          candidates.push(path.dirname(project.path));
        }
      });
    } catch (_error) {
      // Ignore catalog inference failures and fall back to defaults.
    }
  }

  const roots = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const normalized = await normalizeDirectoryPath(candidate);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    roots.push({
      path: normalized,
      label: projectRootLabel(normalized),
    });
  }

  return roots;
}

async function resolveAllowedProjectRoot(rootInput, options = {}) {
  const roots = await allowedProjectRoots(options);
  if (roots.length === 0) {
    return null;
  }

  const requested = String(rootInput || "").trim();
  if (!requested) {
    return roots[0];
  }

  const normalizedRequest = await normalizeDirectoryPath(requested);
  return (
    roots.find((root) => root.path === normalizedRequest || root.path === requested) || null
  );
}

function directoryNameLooksBrowsable(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed || trimmed.startsWith(".")) {
    return false;
  }
  return !["node_modules", "dist", "build", "coverage", "target"].includes(trimmed);
}

async function directoryLooksProjectLike(projectPath) {
  const markers = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod"];
  for (const marker of markers) {
    if (await fileExists(path.join(projectPath, marker))) {
      return true;
    }
  }
  return false;
}

async function listReposForRoot(rootPath, trackedProjects = []) {
  let entries = [];
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const trackedByPath = new Map(trackedProjects.map((project) => [project.path, project]));
  const repos = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && directoryNameLooksBrowsable(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const repoPath = path.join(rootPath, entry.name);
        const tracked = trackedByPath.get(repoPath) || null;
        const gitRepo = await fileExists(path.join(repoPath, ".git"));
        const looksProject = tracked ? true : await directoryLooksProjectLike(repoPath);
        if (!looksProject) {
          return null;
        }
        return {
          name: entry.name,
          path: repoPath,
          tracked: Boolean(tracked),
          gitRepo,
          sessionCount: tracked?.sessionCount || 0,
          provider: tracked?.provider || null,
        };
      }),
  );

  return repos.filter(Boolean);
}

async function loadServerConfig(rawOptions) {
  const configPath =
    pickString(rawOptions.config, process.env.CLAWDAD_SERVER_CONFIG_FILE) ||
    defaultServerConfigPath;
  const config = (await readOptionalJson(configPath)) || {};
  return { configPath, config };
}

async function resolveRuntimeOptions(rawOptions, overrides = {}) {
  const { configPath, config } = await loadServerConfig(rawOptions);
  const configTailscale = config.tailscale || {};
  const allowedUsers = normalizeAllowedUsers(
    rawOptions.allowUser,
    rawOptions.allowedUsers,
    process.env.CLAWDAD_SERVER_ALLOWED_USERS,
    config.allowedUsers,
  );

  const resolved = {
    configPath,
    config,
    host: pickString(
      overrides.host,
      rawOptions.host,
      process.env.CLAWDAD_SERVER_HOST,
      config.host,
      "127.0.0.1",
    ),
    port: toPositiveInteger(
      pickString(
        String(overrides.port || ""),
        rawOptions.port,
        process.env.CLAWDAD_SERVER_PORT,
        String(config.port || ""),
        "4477",
      ),
      "port",
    ),
    bodyLimitBytes: toPositiveInteger(
      pickString(
        String(overrides.bodyLimitBytes || ""),
        rawOptions.bodyLimitBytes,
        process.env.CLAWDAD_SERVER_BODY_LIMIT_BYTES,
        String(config.bodyLimitBytes || ""),
        "65536",
      ),
      "body-limit-bytes",
    ),
    defaultProject: pickString(
      overrides.defaultProject,
      rawOptions.defaultProject,
      process.env.CLAWDAD_SERVER_DEFAULT_PROJECT,
      config.defaultProject,
    ),
    authMode: normalizeAuthMode(
      pickString(
        overrides.authMode,
        rawOptions.authMode,
        process.env.CLAWDAD_SERVER_AUTH_MODE,
        config.authMode,
        "token",
      ),
    ),
    token: pickString(overrides.token, rawOptions.token, process.env.CLAWDAD_SERVER_TOKEN),
    tokenFile:
      pickString(
        overrides.tokenFile,
        rawOptions.tokenFile,
        process.env.CLAWDAD_SERVER_TOKEN_FILE,
        config.tokenFile,
      ) || defaultTokenFile,
    allowedUsers,
    requiredCapability: pickString(
      overrides.requiredCapability,
      rawOptions.requireCapability,
      process.env.CLAWDAD_SERVER_REQUIRED_CAPABILITY,
      config.requiredCapability,
    ),
    allowTaggedDevices: resolveBooleanSetting(
      rawOptions.allowTaggedDevices,
      process.env.CLAWDAD_SERVER_ALLOW_TAGGED_DEVICES,
      config.allowTaggedDevices,
      false,
    ),
    httpsPort: toPositiveInteger(
      pickString(
        String(overrides.httpsPort || ""),
        rawOptions.httpsPort,
        process.env.CLAWDAD_SERVER_HTTPS_PORT,
        String(configTailscale.httpsPort || ""),
        "443",
      ),
      "https-port",
    ),
    shortcutPath:
      pickString(overrides.shortcutPath, rawOptions.shortcutPath, config.shortcutPath) ||
      defaultShortcutTemplatePath,
    tailscaleDnsName: pickString(overrides.tailscaleDnsName, configTailscale.dnsName),
    tailscalePublicUrl: pickString(overrides.tailscalePublicUrl, configTailscale.publicUrl),
    projectRoots: normalizeStringList(
      process.env.CLAWDAD_SERVER_PROJECT_ROOTS,
      config.projectRoots,
    ),
    launchAgentLabel: pickString(rawOptions.label, config.launchAgentLabel, launchAgentLabelDefault),
    systemdUnitName: pickString(rawOptions.systemdName, config.systemdUnitName, systemdUnitNameDefault),
    stdoutLog:
      pickString(rawOptions.stdoutLog, config.stdoutLog) ||
      path.join(clawdadHome, "logs", "server.stdout.log"),
    stderrLog:
      pickString(rawOptions.stderrLog, config.stderrLog) ||
      path.join(clawdadHome, "logs", "server.stderr.log"),
  };

  return resolved;
}

async function resolveToken(options, { required = true } = {}) {
  if (options.token) {
    return String(options.token).trim();
  }

  try {
    return (await readFile(options.tokenFile || defaultTokenFile, "utf8")).trim();
  } catch (error) {
    if (!required && error.code === "ENOENT") {
      return "";
    }
    throw new Error(
      `missing token: pass --token, set CLAWDAD_SERVER_TOKEN, or create ${
        options.tokenFile || defaultTokenFile
      }`,
    );
  }
}

async function runExec(command, args, options = {}) {
  try {
    const result = await execFileP(command, args, {
      cwd: clawdadRoot,
      env: {
        ...process.env,
        CLAWDAD_ROOT: clawdadRoot,
        CLAWDAD_HOME: clawdadHome,
      },
      maxBuffer: 10 * 1024 * 1024,
      timeout: options.timeoutMs || undefined,
    });

    return {
      ok: true,
      exitCode: 0,
      stdout: trimTrailingNewlines(result.stdout),
      stderr: trimTrailingNewlines(result.stderr),
      timedOut: false,
    };
  } catch (error) {
    return {
      ok: false,
      exitCode:
        typeof error.code === "number"
          ? error.code
          : error.code === "ETIMEDOUT"
            ? 124
            : 1,
      stdout: trimTrailingNewlines(error.stdout),
      stderr: trimTrailingNewlines(error.stderr || error.message),
      timedOut: error.code === "ETIMEDOUT" || error.killed === true,
    };
  }
}

async function runClawdad(args) {
  return runExec(clawdadBin, args);
}

async function startDetached(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: clawdadRoot,
      env: {
        ...process.env,
        CLAWDAD_ROOT: clawdadRoot,
        CLAWDAD_HOME: clawdadHome,
      },
      detached: true,
      stdio: "ignore",
    });

    child.once("error", (error) => {
      resolve({ ok: false, error });
    });

    child.once("spawn", () => {
      child.unref();
      resolve({ ok: true, pid: child.pid || null });
    });
  });
}

async function startClawdadDetached(args) {
  return startDetached(clawdadBin, args);
}

async function runTailscale(args, options = {}) {
  return runExec(defaultTailscaleBinary, args, options);
}

function parseJsonResult(result, label) {
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
  }

  try {
    return JSON.parse(result.stdout || "{}");
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}`);
  }
}

async function getTailscaleStatus() {
  return parseJsonResult(await runTailscale(["status", "--json"]), "tailscale status --json");
}

async function getTailscaleServeStatus() {
  return parseJsonResult(
    await runTailscale(["serve", "status", "--json"]),
    "tailscale serve status --json",
  );
}

function stripTrailingDot(value) {
  return String(value || "").replace(/\.$/u, "");
}

function tailscaleCurrentLogin(status) {
  const self = status?.Self;
  const users = status?.User || {};
  if (!self?.UserID) {
    return "";
  }
  const user = users[String(self.UserID)] || users[self.UserID];
  return pickString(user?.LoginName);
}

function tailscaleDnsName(status) {
  return stripTrailingDot(status?.Self?.DNSName);
}

function tailscalePublicUrl(dnsName, httpsPort) {
  if (!dnsName) {
    return "";
  }
  return httpsPort === 443 ? `https://${dnsName}` : `https://${dnsName}:${httpsPort}`;
}

function hasTailscaleHeaders(req) {
  return (
    headerValue(req, "tailscale-user-login") !== "" ||
    headerValue(req, "tailscale-user-name") !== "" ||
    headerValue(req, "tailscale-app-capabilities") !== ""
  );
}

function parseAppCapabilities(rawHeader) {
  if (!rawHeader) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawHeader);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_error) {
    return null;
  }

  return null;
}

function actorFromTailscaleRequest(req) {
  const rawCapabilities = headerValue(req, "tailscale-app-capabilities");
  const capabilityMap = parseAppCapabilities(rawCapabilities);
  const capabilityNames =
    capabilityMap && typeof capabilityMap === "object"
      ? Object.keys(capabilityMap).sort()
      : [];

  return {
    authType: "tailscale",
    login: headerValue(req, "tailscale-user-login").trim() || null,
    displayName: headerValue(req, "tailscale-user-name").trim() || null,
    profilePicUrl: headerValue(req, "tailscale-user-profile-pic").trim() || null,
    capabilities: capabilityNames,
    capabilityMap,
    remoteAddress: req.socket.remoteAddress || null,
  };
}

function authorizeTokenRequest(req, token) {
  if (!token) {
    return {
      ok: false,
      statusCode: 401,
      error: "token auth is enabled but no token is configured",
    };
  }

  if (!constantTimeEqual(bearerTokenFromRequest(req), token)) {
    return {
      ok: false,
      statusCode: 401,
      error: "unauthorized",
    };
  }

  return {
    ok: true,
    actor: {
      authType: "token",
      remoteAddress: req.socket.remoteAddress || null,
    },
  };
}

function authorizeTailscaleRequest(req, options) {
  if (!isLoopbackRemote(req.socket.remoteAddress || "")) {
    return {
      ok: false,
      statusCode: 401,
      error: "tailscale auth requires a loopback request from Tailscale Serve",
    };
  }

  const actor = actorFromTailscaleRequest(req);
  if (!actor.login && !options.allowTaggedDevices) {
    return {
      ok: false,
      statusCode: 401,
      error: "missing Tailscale user identity headers",
    };
  }

  if (options.allowedUsers.length > 0) {
    if (!actor.login) {
      return {
        ok: false,
        statusCode: 403,
        error: "request is missing a Tailscale user login",
      };
    }
    if (!options.allowedUsers.includes(actor.login)) {
      return {
        ok: false,
        statusCode: 403,
        error: `Tailscale user '${actor.login}' is not allowed`,
      };
    }
  }

  if (options.requiredCapability) {
    if (!actor.capabilityMap) {
      return {
        ok: false,
        statusCode: 403,
        error: "Tailscale app capabilities header is missing or invalid JSON",
      };
    }
    if (!Object.prototype.hasOwnProperty.call(actor.capabilityMap, options.requiredCapability)) {
      return {
        ok: false,
        statusCode: 403,
        error: `missing required Tailscale app capability '${options.requiredCapability}'`,
      };
    }
  }

  return { ok: true, actor };
}

function authorizeRequest(req, options) {
  if (options.authMode === "token") {
    return authorizeTokenRequest(req, options.token);
  }

  if (options.authMode === "tailscale") {
    return authorizeTailscaleRequest(req, options);
  }

  const tailscaleTried = hasTailscaleHeaders(req) || isLoopbackRemote(req.socket.remoteAddress || "");
  const tailscaleResult = tailscaleTried ? authorizeTailscaleRequest(req, options) : null;
  if (tailscaleResult?.ok) {
    return tailscaleResult;
  }

  const tokenResult = authorizeTokenRequest(req, options.token);
  if (tokenResult.ok) {
    return tokenResult;
  }

  if (tailscaleResult && tailscaleResult.statusCode === 403) {
    return tailscaleResult;
  }

  return tokenResult;
}

function projectFromPayload(payload, defaultProject) {
  if (typeof payload.project === "string" && payload.project.trim() !== "") {
    return payload.project.trim();
  }
  return defaultProject || "";
}

function defaultProjectForCatalog(projects, configuredDefaultProject) {
  const configured = String(configuredDefaultProject || "").trim();
  if (!configured) {
    return projects[0]?.path || "";
  }

  return projects.find((project) => projectMatchesInput(project, configured))?.path || projects[0]?.path || "";
}

function defaultRemotePermissionMode(provider) {
  const normalized = String(provider || "").trim().toLowerCase();
  if (normalized === "codex") {
    return "approve";
  }
  return "";
}

async function parseDispatchPayload(req, bodyLimitBytes) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  const rawBody = await readBody(req, bodyLimitBytes);

  if (!rawBody.trim()) {
    return {};
  }

  if (contentType.includes("application/json")) {
    return JSON.parse(rawBody);
  }

  if (contentType.includes("text/plain")) {
    return { message: rawBody };
  }

  throw new Error("unsupported content-type; use application/json or text/plain");
}

async function handleDispatch(req, res, options, actor) {
  let payload;
  try {
    payload = await parseDispatchPayload(req, options.bodyLimitBytes);
  } catch (error) {
    json(res, 400, { ok: false, error: error.message });
    return;
  }

  const project = projectFromPayload(payload, options.defaultProject);
  const message =
    typeof payload.message === "string" ? payload.message.trim() : "";

  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
    return;
  }

  if (!message) {
    json(res, 400, { ok: false, error: "missing message" });
    return;
  }

  const resolvedProjectPath = await resolveProjectPathForRequest(project, options.defaultProject);
  if (!resolvedProjectPath) {
    json(res, 404, { ok: false, error: `project '${project}' is not tracked` });
    return;
  }

  let matchedProject = null;
  let matchedSession = null;
  try {
    const projects = await loadProjectCatalogCached();
    matchedProject = projects.find((entry) => entry.path === resolvedProjectPath) || null;
    matchedSession =
      matchedProject?.activeSession ||
      matchedProject?.sessions?.find((session) => session.active) ||
      matchedProject?.sessions?.[0] ||
      null;
  } catch (error) {
    json(res, 500, {
      ok: false,
      error: error.message,
    });
    return;
  }

  if (typeof payload.sessionId === "string" && payload.sessionId.trim() !== "") {
    const requestedSessionId = payload.sessionId.trim();
    matchedSession =
      matchedProject?.sessions.find(
        (session) => session.sessionId === requestedSessionId || session.slug === requestedSessionId,
      ) || null;

    if (!matchedProject || !matchedSession?.sessionId) {
      json(res, 404, {
        ok: false,
        error: `No tracked session '${requestedSessionId}' found for ${project}`,
      });
      return;
    }

    try {
      await persistActiveSessionSelection(matchedProject.path, matchedSession.sessionId);
      updateCachedProjectSelection(matchedProject.path, matchedSession.sessionId);
    } catch (error) {
      json(res, 500, {
        ok: false,
        error: error.message,
      });
      return;
    }
  }

  const wait = boolFromUnknown(payload.wait, false);
  const args = ["dispatch", resolvedProjectPath, message];

  let timeoutMs = null;
  if (payload.timeout != null) {
    timeoutMs = toPositiveInteger(payload.timeout, "timeout") * 1000;
    if (!wait) {
      args.push("--timeout", String(toPositiveInteger(payload.timeout, "timeout")));
    }
  }

  if (typeof payload.model === "string" && payload.model.trim() !== "") {
    args.push("--model", payload.model.trim());
  }

  const permissionMode =
    typeof payload.permissionMode === "string" && payload.permissionMode.trim() !== ""
      ? payload.permissionMode.trim()
      : defaultRemotePermissionMode(matchedSession?.provider);

  if (permissionMode) {
    args.push("--permission-mode", permissionMode);
  }

  const baselineStatus = await readMailboxStatus(resolvedProjectPath);
  const baselineRequestId = String(baselineStatus.request_id || "").trim();
  const startResult = await startClawdadDetached(args);
  if (!startResult.ok) {
    json(res, 500, {
      ok: false,
      project,
      wait,
      actor,
      exitCode: 1,
      stdout: "",
      stderr: startResult.error?.message || "failed to start dispatch",
    });
    return;
  }

  invalidateProjectCatalogCache();

  if (wait) {
    const mailboxStatus = await waitForMailboxCompletion(
      resolvedProjectPath,
      timeoutMs,
      baselineRequestId,
    );
    if (mailboxStatus.state === "timeout") {
      json(res, 504, {
        ok: false,
        project,
        wait,
        actor,
        exitCode: 124,
        stdout: "",
        stderr: timeoutMs ? `Timed out after ${Math.floor(timeoutMs / 1000)}s waiting for response` : "Timed out waiting for response",
      });
      return;
    }

    const responseMarkdown = await readMailboxResponse(resolvedProjectPath);
    const responseText = responseBodyFromMailbox(responseMarkdown);
    const completed = String(mailboxStatus.state || "") === "completed";
    json(res, completed ? 200 : 500, {
      ok: completed,
      project,
      wait,
      actor,
      exitCode: completed ? 0 : 1,
      stdout: responseText,
      stderr: completed ? "" : responseText,
      mailboxStatus,
    });
    return;
  }

  const startedMailboxStatus = await waitForMailboxRequestStart(
    resolvedProjectPath,
    baselineRequestId,
  );
  const startedRequestId = String(startedMailboxStatus.request_id || "").trim();

  json(res, 202, {
    ok: true,
    project,
    wait,
    actor,
    exitCode: 0,
    stdout: "",
    stderr: "",
    pid: startResult.pid,
    requestId: startedRequestId || null,
    mailboxStatus: startedRequestId ? startedMailboxStatus : null,
  });
}

async function handleRead(_req, res, options, url, actor) {
  const project = (url.searchParams.get("project") || options.defaultProject || "").trim();
  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
    return;
  }

  const projectPath = await resolveProjectPathForRequest(project, options.defaultProject);
  if (!projectPath) {
    json(res, 404, { ok: false, error: `project '${project}' is not tracked` });
    return;
  }

  const raw = boolFromUnknown(url.searchParams.get("raw"), true);
  const mailboxStatus = await readMailboxStatus(projectPath);
  const lifecycle = String(mailboxStatus.state || "idle").trim() || "idle";
  const responseMarkdown =
    lifecycle === "completed" || lifecycle === "failed"
      ? await readMailboxResponse(projectPath)
      : "";
  const output = raw ? responseBodyFromMailbox(responseMarkdown) : responseMarkdown;
  json(res, 200, {
    ok: true,
    project,
    projectPath,
    actor,
    exitCode: 0,
    output,
    stderr: "",
    mailboxStatus,
  });
}

async function handleStatus(_req, res, options, url, actor) {
  const project = (url.searchParams.get("project") || options.defaultProject || "").trim();
  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
    return;
  }

  const projectPath = await resolveProjectPathForRequest(project, options.defaultProject);
  if (!projectPath) {
    json(res, 404, { ok: false, error: `project '${project}' is not tracked` });
    return;
  }

  const projects = await loadProjectCatalogCached();
  const summary = projects.find((entry) => entry.path === projectPath) || null;
  const mailboxStatus = await readMailboxStatus(projectPath);
  const lifecycle = String(mailboxStatus.state || summary?.status || "idle").trim() || "idle";
  const provider = summary?.provider || "-";
  const lastDispatch = summary?.lastDispatch || "never";
  const dispatchCount = summary?.dispatchCount || 0;
  const activeSession = summary?.activeSession ? sessionDisplayForStatus(summary.activeSession) : "No tracked session";
  const output = [
    `${summary?.displayName || projectPath} • ${provider} • ${lifecycle}`,
    `Active session: ${activeSession}`,
    `Last dispatch: ${lastDispatch}`,
    `Dispatches: ${dispatchCount}`,
  ].join("\n");

  json(res, 200, {
    ok: true,
    project,
    projectPath,
    actor,
    exitCode: 0,
    output,
    stderr: "",
    mailboxStatus,
  });
}

async function handleList(_req, res, _options, url, actor) {
  const mode = (url.searchParams.get("mode") || "slugs").trim();
  const args = ["list"];

  if (mode === "paths") {
    args.push("--paths");
  } else if (mode === "slugs") {
    args.push("--slugs");
  }

  const result = await runClawdad(args);
  json(res, result.ok ? 200 : 500, {
    ok: result.ok,
    mode,
    actor,
    exitCode: result.exitCode,
    output: result.stdout,
    items: result.stdout ? result.stdout.split("\n").filter(Boolean) : [],
    stderr: result.stderr,
  });
}

async function handleProjects(_req, res, options, actor) {
  try {
    const projects = await loadProjectCatalogCached();
    const defaultProject = defaultProjectForCatalog(projects, options.defaultProject);
    json(res, 200, {
      ok: true,
      actor,
      defaultProject: defaultProject || null,
      projects,
    });
  } catch (error) {
    json(res, 500, {
      ok: false,
      actor,
      defaultProject: options.defaultProject || null,
      projects: [],
      error: error.message,
    });
  }
}

async function handleProjectRoots(_req, res, options, actor) {
  try {
    const [roots, trackedProjects] = await Promise.all([
      allowedProjectRoots(options),
      loadProjectCatalogCached(),
    ]);
    const enrichedRoots = await Promise.all(
      roots.map(async (root) => ({
        ...root,
        repos: await listReposForRoot(root.path, trackedProjects),
      })),
    );

    json(res, 200, {
      ok: true,
      actor,
      roots: enrichedRoots,
    });
  } catch (error) {
    json(res, 500, {
      ok: false,
      actor,
      roots: [],
      error: error.message,
    });
  }
}

async function resolveExistingProjectPathForCreate(rootPath, payload = {}) {
  const requestedPath = pickString(payload.path, payload.repoPath);
  if (!requestedPath) {
    throw new Error("missing existing repo path");
  }

  const normalizedPath = await normalizeDirectoryPath(requestedPath);
  if (!normalizedPath) {
    throw new Error("selected repo was not found");
  }
  if (!pathInsideRoot(rootPath, normalizedPath)) {
    throw new Error("selected repo is outside the allowed root");
  }
  return normalizedPath;
}

async function resolveNewProjectPathForCreate(rootPath, payload = {}) {
  const projectName = pickString(payload.name, payload.projectName, payload.repoName);
  if (!projectNameIsValid(projectName)) {
    throw new Error("project name must be a single visible directory name");
  }

  const targetPath = path.resolve(rootPath, projectName);
  if (!pathInsideRoot(rootPath, targetPath)) {
    throw new Error("new project path is outside the allowed root");
  }
  if (await fileExists(targetPath)) {
    throw new Error("a directory with that name already exists");
  }
  return targetPath;
}

async function handleCreateProject(req, res, options, actor) {
  let payload;
  try {
    payload = await parseDispatchPayload(req, options.bodyLimitBytes);
  } catch (error) {
    json(res, 400, { ok: false, error: error.message });
    return;
  }

  const mode = String(payload.mode || "existing").trim().toLowerCase();
  if (!["existing", "new"].includes(mode)) {
    json(res, 400, { ok: false, error: "mode must be 'existing' or 'new'" });
    return;
  }

  let provider;
  try {
    provider = normalizeProviderName(payload.provider || "claude");
  } catch (error) {
    json(res, 400, { ok: false, error: error.message });
    return;
  }

  const root = await resolveAllowedProjectRoot(payload.root, options);
  if (!root) {
    json(res, 400, { ok: false, error: "selected root is not allowed" });
    return;
  }

  let projectPath = "";
  let createdDirectory = false;
  try {
    projectPath =
      mode === "new"
        ? await resolveNewProjectPathForCreate(root.path, payload)
        : await resolveExistingProjectPathForCreate(root.path, payload);

    if (mode === "new") {
      await mkdir(projectPath, { recursive: false });
      createdDirectory = true;
    }
  } catch (error) {
    json(res, 400, {
      ok: false,
      actor,
      mode,
      provider,
      root: root.path,
      error: error.message,
    });
    return;
  }

  let trackedProjects;
  try {
    trackedProjects = await loadProjectCatalogCached();
  } catch (error) {
    json(res, 500, { ok: false, actor, error: error.message });
    return;
  }

  const existingProject = trackedProjects.find((project) => project.path === projectPath) || null;
  const args = existingProject
    ? ["add-session", projectPath, "--provider", provider]
    : ["register", projectPath, "--provider", provider];
  const requestedSlug = pickString(payload.slug);
  if (requestedSlug) {
    args.push("--slug", requestedSlug);
  }

  const result = await runClawdad(args);
  if (!result.ok) {
    json(res, 500, {
      ok: false,
      actor,
      mode,
      provider,
      root: root.path,
      projectPath,
      createdDirectory,
      error: result.stderr || result.stdout || "failed to create project",
    });
    return;
  }

  invalidateProjectCatalogCache();

  let refreshedProjects;
  try {
    refreshedProjects = await loadProjectCatalogCached();
  } catch (error) {
    json(res, 500, {
      ok: false,
      actor,
      mode,
      provider,
      root: root.path,
      projectPath,
      createdDirectory,
      error: error.message,
    });
    return;
  }

  const projectDetails = refreshedProjects.find((project) => project.path === projectPath) || null;
  const activeSession = projectDetails?.activeSession || projectDetails?.sessions?.find((session) => session.active) || null;

  json(res, existingProject ? 200 : 201, {
    ok: true,
    actor,
    mode,
    provider,
    root: root.path,
    projectPath,
    createdDirectory,
    reusedProject: Boolean(existingProject),
    projectDetails,
    sessionId: activeSession?.sessionId || null,
    output:
      result.stdout ||
      (existingProject
        ? `Added ${provider} session to ${projectDetails?.displayName || projectPath}`
        : `Registered ${projectDetails?.displayName || projectPath}`),
  });
}

async function handleHistory(_req, res, options, url, actor) {
  const project = (url.searchParams.get("project") || options.defaultProject || "").trim();
  const sessionId = (url.searchParams.get("sessionId") || "").trim();
  const cursor = url.searchParams.get("cursor") || "0";
  const limitValue = url.searchParams.get("limit") || "20";

  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
    return;
  }

  if (!sessionId) {
    json(res, 400, { ok: false, error: "missing sessionId" });
    return;
  }

  const projectPath = await resolveProjectPathForRequest(project, options.defaultProject);
  if (!projectPath) {
    json(res, 404, { ok: false, error: `project '${project}' is not tracked` });
    return;
  }

  let projects;
  try {
    projects = await loadProjectCatalogCached();
  } catch (error) {
    json(res, 500, { ok: false, actor, error: error.message });
    return;
  }

  const matchedProject = projects.find((entry) => entry.path === projectPath) || null;
  const matchedSession =
    matchedProject?.sessions.find(
      (session) => session.sessionId === sessionId || session.slug === sessionId,
    ) || null;

  if (!matchedProject || !matchedSession?.sessionId) {
    json(res, 404, {
      ok: false,
      actor,
      project: projectPath,
      sessionId,
      error: `No tracked session '${sessionId}' found for ${matchedProject?.displayName || project}`,
    });
    return;
  }

  const limit = Math.min(50, Math.max(1, Number.parseInt(limitValue, 10) || 20));

  try {
    const page = await readSessionHistoryPage(matchedProject.path, matchedSession, {
      cursor,
      limit,
    });
    json(res, 200, {
      ok: true,
      actor,
      project: matchedProject.path,
      sessionId: matchedSession.sessionId,
      limit,
      cursor: String(cursor),
      nextCursor: page.nextCursor,
      total: page.total,
      items: page.items,
    });
  } catch (error) {
    json(res, 500, {
      ok: false,
      actor,
      project: matchedProject.path,
      sessionId: matchedSession.sessionId,
      error: error.message,
    });
  }
}

async function handleActiveSession(req, res, options, actor) {
  let payload;
  try {
    payload = await parseDispatchPayload(req, options.bodyLimitBytes);
  } catch (error) {
    json(res, 400, { ok: false, error: error.message });
    return;
  }

  const project = projectFromPayload(payload, options.defaultProject);
  const sessionId =
    typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";

  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
    return;
  }

  if (!sessionId) {
    json(res, 400, { ok: false, error: "missing sessionId" });
    return;
  }

  let projects;
  try {
    projects = await loadProjectCatalogCached();
  } catch (error) {
    json(res, 500, { ok: false, actor, error: error.message });
    return;
  }

  const matchedProject = projects.find((entry) => projectMatchesInput(entry, project));
  if (!matchedProject) {
    json(res, 404, {
      ok: false,
      actor,
      project,
      sessionId,
      error: `No tracked project '${project}' found`,
    });
    return;
  }

  const matchedSession =
    matchedProject.sessions.find(
      (session) => session.sessionId === sessionId || session.slug === sessionId,
    ) || null;
  if (!matchedSession?.sessionId) {
    json(res, 404, {
      ok: false,
      actor,
      project: matchedProject.path,
      sessionId,
      error: `No tracked session '${sessionId}' found for ${matchedProject.displayName}`,
    });
    return;
  }

  try {
    await persistActiveSessionSelection(matchedProject.path, matchedSession.sessionId);
  } catch (error) {
    json(res, 500, {
      ok: false,
      actor,
      project: matchedProject.path,
      sessionId: matchedSession.sessionId,
      error: error.message,
    });
    return;
  }

  const projectDetails =
    updateCachedProjectSelection(matchedProject.path, matchedSession.sessionId) ||
    projectWithActiveSession(matchedProject, matchedSession.sessionId);

  json(res, 200, {
    ok: true,
    actor,
    project: matchedProject.path,
    sessionId: matchedSession.sessionId,
    projectDetails,
    output: `Active session set to ${sessionDisplayForStatus(matchedSession)}`,
  });
}

function buildServeArgs(options) {
  const args = [process.execPath, serverModulePath, "serve"];

  if (options.launchAgentConfigOnly) {
    args.push("--config", options.configPath);
    return args;
  }

  args.push(
    "--host",
    options.host,
    "--port",
    String(options.port),
    "--body-limit-bytes",
    String(options.bodyLimitBytes),
    "--auth-mode",
    options.authMode,
  );

  if (options.defaultProject) {
    args.push("--default-project", options.defaultProject);
  }
  if (options.allowedUsers.length > 0) {
    args.push("--allowed-users", options.allowedUsers.join(","));
  }
  if (options.requiredCapability) {
    args.push("--require-capability", options.requiredCapability);
  }
  if (options.allowTaggedDevices) {
    args.push("--allow-tagged-devices");
  }
  if (options.authMode === "token" || options.authMode === "hybrid") {
    args.push("--token-file", options.tokenFile);
  }

  return args;
}

function launchAgentPathForLabel(label) {
  return path.join(
    os.homedir(),
    "Library",
    "LaunchAgents",
    `${label}.plist`,
  );
}

function systemdUnitPathForName(name) {
  return path.join(
    os.homedir(),
    ".config",
    "systemd",
    "user",
    name,
  );
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function plistArray(values) {
  return values
    .map((value) => `    <string>${xmlEscape(value)}</string>`)
    .join("\n");
}

function renderLaunchAgentPlist(options) {
  const label = options.launchAgentLabel || launchAgentLabelDefault;
  const envPath = process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin";
  const args = buildServeArgs(options);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
${plistArray(args)}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(envPath)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(options.stdoutLog)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(options.stderrLog)}</string>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(clawdadRoot)}</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
}

function systemdEscape(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"');
}

function renderSystemdUnit(options) {
  const execStart = buildServeArgs(options)
    .map((arg) => `"${systemdEscape(arg)}"`)
    .join(" ");
  const envPath = systemdEscape(
    process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
  );

  return `[Unit]
Description=Clawdad secure listener
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${clawdadRoot}
Environment=PATH=${envPath}
ExecStart=${execStart}
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
`;
}

function shortcutTemplate(options) {
  const baseUrl = options.tailscalePublicUrl;
  return {
    name: "Clawdad Dispatch",
    method: "POST",
    url: baseUrl ? `${baseUrl}/v1/dispatch` : "https://YOUR-TAILNET-URL/v1/dispatch",
    headers: {
      "Content-Type": "application/json",
    },
    body: {
      project: options.defaultProject || "replace-with-project-slug",
      message: "What changed in this project today?",
      wait: true,
    },
    followUp: {
      whoami: baseUrl ? `${baseUrl}/v1/whoami` : "https://YOUR-TAILNET-URL/v1/whoami",
      status: baseUrl ? `${baseUrl}/v1/status` : "https://YOUR-TAILNET-URL/v1/status",
      read: baseUrl ? `${baseUrl}/v1/read` : "https://YOUR-TAILNET-URL/v1/read",
    },
  };
}

async function installLaunchAgent(options, { quiet = false } = {}) {
  const launchAgentPath = options.path || launchAgentPathForLabel(options.launchAgentLabel);

  await mkdir(path.dirname(launchAgentPath), { recursive: true });
  await mkdir(path.dirname(options.stdoutLog), { recursive: true });
  await mkdir(path.dirname(options.stderrLog), { recursive: true });
  await writeFile(launchAgentPath, renderLaunchAgentPlist(options), "utf8");

  if (!quiet) {
    console.log(`wrote launch agent to ${launchAgentPath}`);
    console.log(`next: launchctl bootstrap gui/$(id -u) ${launchAgentPath}`);
    console.log(`then: launchctl kickstart -k gui/$(id -u)/${options.launchAgentLabel}`);
  }

  return launchAgentPath;
}

async function installSystemdUnit(options, { quiet = false } = {}) {
  const systemdUnitPath = options.path || systemdUnitPathForName(options.systemdUnitName);
  await mkdir(path.dirname(systemdUnitPath), { recursive: true });
  await mkdir(path.dirname(options.stdoutLog), { recursive: true });
  await mkdir(path.dirname(options.stderrLog), { recursive: true });
  await writeFile(systemdUnitPath, renderSystemdUnit(options), "utf8");

  if (!quiet) {
    console.log(`wrote systemd unit to ${systemdUnitPath}`);
    console.log("next: systemctl --user daemon-reload");
    console.log(`then: systemctl --user enable --now ${options.systemdUnitName}`);
  }

  return systemdUnitPath;
}

function formatCheck(status, label, detail) {
  return { status, label, detail };
}

function renderCheckLine(check) {
  const prefix = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
  return `${prefix} ${check.label}: ${check.detail}`;
}

async function fetchLocalHealth(options) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: options.host,
        port: options.port,
        path: "/healthz",
        timeout: 2000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ ok: res.statusCode === 200, statusCode: res.statusCode, payload: JSON.parse(raw) });
          } catch (_error) {
            resolve({ ok: false, statusCode: res.statusCode, payload: null });
          }
        });
      },
    );

    req.on("error", () => resolve({ ok: false, statusCode: 0, payload: null }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, statusCode: 0, payload: null });
    });
  });
}

async function configureTailscaleServe(options) {
  const args = [
    "serve",
    "--bg",
    "--yes",
    "--https",
    String(options.httpsPort),
  ];

  if (options.requiredCapability) {
    args.push("--accept-app-caps", options.requiredCapability);
  }

  args.push(`http://127.0.0.1:${options.port}`);

  const result = await runTailscale(args, { timeoutMs: 8000 });
  if (!result.ok) {
    const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
    if (/Serve is not enabled on your tailnet\./u.test(combined)) {
      const enableUrl = combined.match(/https:\/\/\S+/u)?.[0] || "";
      throw new Error(
        enableUrl
          ? `Tailscale Serve is disabled on this tailnet. Enable it first: ${enableUrl}`
          : "Tailscale Serve is disabled on this tailnet. Enable it in the Tailscale admin console and retry.",
      );
    }
    if (result.timedOut) {
      throw new Error(
        combined || "timed out while configuring Tailscale Serve; run the command manually to inspect the prompt",
      );
    }
    throw new Error(result.stderr || result.stdout || "failed to configure tailscale serve");
  }

  return result;
}

function serveConfigContainsTarget(serveStatus, port) {
  const haystack = JSON.stringify(serveStatus || {});
  return (
    haystack.includes(`127.0.0.1:${port}`) ||
    haystack.includes(`localhost:${port}`) ||
    haystack.includes(`http://127.0.0.1:${port}`) ||
    haystack.includes(`http://localhost:${port}`)
  );
}

async function runServe(argv) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    printUsage();
    return;
  }

  const options = await resolveRuntimeOptions(rawOptions);
  if ((options.authMode === "tailscale" || options.authMode === "hybrid") && !isLoopbackHost(options.host)) {
    throw new Error("tailscale-backed auth requires --host to stay on localhost/127.0.0.1/::1");
  }

  const token =
    options.authMode === "token"
      ? await resolveToken(options, { required: true })
      : options.authMode === "hybrid"
        ? await resolveToken(options, { required: false })
        : "";

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/healthz") {
      json(res, 200, {
        ok: true,
        service: "clawdad-server",
        version,
        authMode: options.authMode,
        defaultProject: options.defaultProject || null,
      });
      return;
    }

    const auth = authorizeRequest(req, { ...options, token });
    if (!auth.ok) {
      json(res, auth.statusCode, { ok: false, error: auth.error });
      return;
    }

    if (await maybeServeApp(req, res, url)) {
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/whoami") {
      json(res, 200, {
        ok: true,
        authMode: options.authMode,
        actor: auth.actor,
        defaultProject: options.defaultProject || null,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/projects") {
      await handleProjects(req, res, options, auth.actor);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/projects") {
      await handleCreateProject(req, res, options, auth.actor);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/project-roots") {
      await handleProjectRoots(req, res, options, auth.actor);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/header-carousel") {
      const images = await loadHeaderCarouselImages();
      json(res, 200, {
        ok: true,
        actor: auth.actor,
        images,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/history") {
      await handleHistory(req, res, options, url, auth.actor);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/active-session") {
      await handleActiveSession(req, res, options, auth.actor);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/dispatch") {
      await handleDispatch(req, res, options, auth.actor);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/read") {
      await handleRead(req, res, options, url, auth.actor);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/status") {
      await handleStatus(req, res, options, url, auth.actor);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/list") {
      await handleList(req, res, options, url, auth.actor);
      return;
    }

    json(res, 404, { ok: false, error: "not found" });
  });

  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, resolve);
  });

  console.log(
    `clawdad listener ready on http://${options.host}:${options.port} (${options.authMode} auth, default project: ${options.defaultProject || "none"})`,
  );
}

async function runSecureBootstrap(argv) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    printUsage();
    return;
  }

  const tailscaleStatus = await getTailscaleStatus();
  const detectedLogin = tailscaleCurrentLogin(tailscaleStatus);
  const detectedDnsName = tailscaleDnsName(tailscaleStatus);
  if (!detectedDnsName) {
    throw new Error("could not determine this node's Tailscale DNS name");
  }

  if (rawOptions.host && !isLoopbackHost(rawOptions.host)) {
    throw new Error("secure-bootstrap only supports localhost listener hosts");
  }

  const resolved = await resolveRuntimeOptions(rawOptions, { authMode: rawOptions.authMode || "tailscale" });
  const authMode = resolved.authMode === "token" ? "tailscale" : resolved.authMode;
  const allowedUsers =
    resolved.allowedUsers.length > 0
      ? resolved.allowedUsers
      : detectedLogin
        ? [detectedLogin]
        : [];

  if (authMode === "tailscale" && allowedUsers.length === 0 && !resolved.requiredCapability && !resolved.allowTaggedDevices) {
    throw new Error(
      "no Tailscale user allowlist could be inferred; pass --allow-user or --allowed-users",
    );
  }

  const publicUrl = tailscalePublicUrl(detectedDnsName, resolved.httpsPort);
  const configPayload = {
    host: "127.0.0.1",
    port: resolved.port,
    bodyLimitBytes: resolved.bodyLimitBytes,
    defaultProject: resolved.defaultProject || "",
    authMode,
    allowedUsers,
    requiredCapability: resolved.requiredCapability || "",
    allowTaggedDevices: resolved.allowTaggedDevices,
    tokenFile: resolved.tokenFile,
    shortcutPath: resolved.shortcutPath,
    launchAgentLabel: resolved.launchAgentLabel,
    systemdUnitName: resolved.systemdUnitName,
    stdoutLog: resolved.stdoutLog,
    stderrLog: resolved.stderrLog,
    tailscale: {
      dnsName: detectedDnsName,
      login: detectedLogin || "",
      httpsPort: resolved.httpsPort,
      publicUrl,
      acceptAppCapabilities: resolved.requiredCapability ? [resolved.requiredCapability] : [],
    },
  };

  await writeJsonFile(resolved.configPath, configPayload);
  await writeJsonFile(resolved.shortcutPath, shortcutTemplate({ ...resolved, tailscalePublicUrl: publicUrl }));

  const skipServiceUnit = rawOptions.skipServiceUnit || rawOptions.skipLaunchAgent;
  let serviceUnitPath = null;
  if (process.platform === "darwin" && !skipServiceUnit) {
    serviceUnitPath = await installLaunchAgent(
      {
        ...resolved,
        ...configPayload,
        configPath: resolved.configPath,
        authMode,
        allowedUsers,
        host: "127.0.0.1",
        launchAgentConfigOnly: true,
        tailscalePublicUrl: publicUrl,
      },
      { quiet: true },
    );
  } else if (process.platform === "linux" && !skipServiceUnit) {
    serviceUnitPath = await installSystemdUnit(
      {
        ...resolved,
        ...configPayload,
        configPath: resolved.configPath,
        authMode,
        allowedUsers,
        host: "127.0.0.1",
        systemdUnitName: resolved.systemdUnitName,
        launchAgentConfigOnly: true,
        tailscalePublicUrl: publicUrl,
      },
      { quiet: true },
    );
  }

  if (rawOptions.applyServe) {
    await configureTailscaleServe({ ...resolved, authMode, requiredCapability: resolved.requiredCapability });
  }

  console.log(`wrote secure server config to ${resolved.configPath}`);
  console.log(`wrote iPhone shortcut template to ${resolved.shortcutPath}`);
  if (process.platform === "darwin" && serviceUnitPath) {
    console.log(`wrote launch agent to ${serviceUnitPath}`);
    console.log(`next: launchctl bootstrap gui/$(id -u) ${serviceUnitPath}`);
    console.log(`then: launchctl kickstart -k gui/$(id -u)/${resolved.launchAgentLabel}`);
  } else if (process.platform === "linux" && serviceUnitPath) {
    console.log(`wrote systemd unit to ${serviceUnitPath}`);
    console.log("next: systemctl --user daemon-reload");
    console.log(`then: systemctl --user enable --now ${resolved.systemdUnitName}`);
  } else if (skipServiceUnit) {
    console.log("service unit skipped at your request");
  } else {
    console.log("service unit skipped: automatic service files are implemented for macOS launchd and Linux systemd user services");
  }
  if (rawOptions.applyServe) {
    console.log(
      `configured Tailscale Serve -> http://127.0.0.1:${resolved.port} on ${publicUrl || detectedDnsName}`,
    );
  } else {
    const serveCommand = [
      defaultTailscaleBinary,
      "serve",
      "--bg",
      "--yes",
      "--https",
      String(resolved.httpsPort),
    ];
    if (resolved.requiredCapability) {
      serveCommand.push("--accept-app-caps", resolved.requiredCapability);
    }
    serveCommand.push(`http://127.0.0.1:${resolved.port}`);
    console.log(`next: ${serveCommand.join(" ")}`);
  }
  console.log(`tailnet URL: ${publicUrl}`);
  if (allowedUsers.length > 0) {
    console.log(`allowed users: ${allowedUsers.join(", ")}`);
  }
  if (resolved.requiredCapability) {
    console.log(`required capability: ${resolved.requiredCapability}`);
  }
  console.log("verify with: clawdad secure-doctor");
}

async function runSecureDoctor(argv) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    printUsage();
    return;
  }

  const options = await resolveRuntimeOptions(rawOptions);
  const checks = [];

  checks.push(
    isLoopbackHost(options.host)
      ? formatCheck("pass", "Listener host", `${options.host} is localhost-only`)
      : formatCheck("fail", "Listener host", `${options.host} is not localhost-only`),
  );

  checks.push(
    options.authMode === "tailscale" || options.authMode === "hybrid"
      ? formatCheck("pass", "Auth mode", `${options.authMode} is compatible with Tailscale Serve`)
      : formatCheck("fail", "Auth mode", "token-only mode is not the recommended secure deployment"),
  );

  checks.push(
    options.allowedUsers.length > 0 || options.requiredCapability || options.allowTaggedDevices
      ? formatCheck(
          "pass",
          "Application authz",
          options.allowedUsers.length > 0
            ? `allowlist: ${options.allowedUsers.join(", ")}`
            : options.requiredCapability
              ? `required capability: ${options.requiredCapability}`
              : "tagged devices enabled",
        )
      : formatCheck(
          "fail",
          "Application authz",
          "no allowed users or capability rule configured",
        ),
  );

  const configPresent = await fileExists(options.configPath);
  checks.push(
    configPresent
      ? formatCheck("pass", "Server config", options.configPath)
      : formatCheck("fail", "Server config", `${options.configPath} is missing`),
  );

  try {
    const tailscaleStatus = await getTailscaleStatus();
    const login = tailscaleCurrentLogin(tailscaleStatus);
    const dnsName = tailscaleDnsName(tailscaleStatus);
    checks.push(
      formatCheck(
        "pass",
        "Tailscale",
        `${login || "unknown user"} on ${dnsName || "unknown device"}`,
      ),
    );

    const serveStatus = await getTailscaleServeStatus();
    if (Object.keys(serveStatus).length === 0) {
      checks.push(formatCheck("fail", "Tailscale Serve", "no Serve config found"));
    } else if (!serveConfigContainsTarget(serveStatus, options.port)) {
      checks.push(
        formatCheck(
          "fail",
          "Tailscale Serve",
          `config does not appear to target localhost:${options.port}`,
        ),
      );
    } else {
      checks.push(
        formatCheck(
          "pass",
          "Tailscale Serve",
          `forwarding to localhost:${options.port}`,
        ),
      );
    }

    if (options.requiredCapability) {
      const haystack = JSON.stringify(serveStatus || {});
      checks.push(
        haystack.includes(options.requiredCapability)
          ? formatCheck("pass", "App capability forwarding", options.requiredCapability)
          : formatCheck(
              "fail",
              "App capability forwarding",
              `${options.requiredCapability} not found in Serve config`,
            ),
      );
    }

    const expectedUrl = tailscalePublicUrl(
      options.tailscaleDnsName || dnsName,
      options.httpsPort,
    );
    checks.push(
      expectedUrl
        ? formatCheck("pass", "Tailnet URL", expectedUrl)
        : formatCheck("warn", "Tailnet URL", "could not determine device URL"),
    );
  } catch (error) {
    checks.push(formatCheck("fail", "Tailscale", error.message));
  }

  if (process.platform === "darwin") {
    const launchAgentPath = launchAgentPathForLabel(options.launchAgentLabel);
    checks.push(
      (await fileExists(launchAgentPath))
        ? formatCheck("pass", "Launch agent", launchAgentPath)
        : formatCheck("warn", "Launch agent", `${launchAgentPath} is missing`),
    );
  } else if (process.platform === "linux") {
    const systemdUnitPath = systemdUnitPathForName(options.systemdUnitName);
    checks.push(
      (await fileExists(systemdUnitPath))
        ? formatCheck("pass", "Systemd unit", systemdUnitPath)
        : formatCheck("warn", "Systemd unit", `${systemdUnitPath} is missing`),
    );
  }

  const shortcutPresent = await fileExists(options.shortcutPath);
  checks.push(
    shortcutPresent
      ? formatCheck("pass", "Shortcut template", options.shortcutPath)
      : formatCheck("warn", "Shortcut template", `${options.shortcutPath} is missing`),
  );

  const health = await fetchLocalHealth(options);
  if (health.ok && health.payload?.authMode === options.authMode) {
    checks.push(
      formatCheck(
        "pass",
        "Local listener",
        `healthz responded on http://${options.host}:${options.port}`,
      ),
    );
  } else if (health.ok) {
    checks.push(
      formatCheck(
        "warn",
        "Local listener",
        `listener is reachable but reported authMode=${health.payload?.authMode || "unknown"}`,
      ),
    );
  } else {
    checks.push(
      formatCheck(
        "fail",
        "Local listener",
        `no response from http://${options.host}:${options.port}/healthz`,
      ),
    );
  }

  const failed = checks.filter((check) => check.status === "fail");
  if (rawOptions.json) {
    console.log(
      JSON.stringify(
        {
          ok: failed.length === 0,
          checks,
        },
        null,
        2,
      ),
    );
  } else {
    for (const check of checks) {
      console.log(renderCheckLine(check));
    }
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

async function runGenToken(argv) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    printUsage();
    return;
  }
  const options = await resolveRuntimeOptions(rawOptions);

  const token = crypto.randomBytes(32).toString("hex");
  if (!rawOptions.write) {
    console.log(token);
    return;
  }

  await mkdir(path.dirname(options.tokenFile), { recursive: true });
  await writeFile(options.tokenFile, `${token}\n`, "utf8");
  await chmod(options.tokenFile, 0o600);

  console.log(`wrote token to ${options.tokenFile}`);
}

async function runPrintLaunchAgent(argv) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    printUsage();
    return;
  }

  const options = await resolveRuntimeOptions(rawOptions);
  const configExists = await fileExists(options.configPath);
  console.log(renderLaunchAgentPlist({ ...options, launchAgentConfigOnly: configExists }));
}

async function runInstallLaunchAgent(argv) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    printUsage();
    return;
  }

  const options = await resolveRuntimeOptions(rawOptions);
  const configExists = await fileExists(options.configPath);
  await installLaunchAgent({ ...options, launchAgentConfigOnly: configExists });
}

async function runPrintSystemdUnit(argv) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    printUsage();
    return;
  }

  const options = await resolveRuntimeOptions(rawOptions);
  const configExists = await fileExists(options.configPath);
  console.log(renderSystemdUnit({ ...options, launchAgentConfigOnly: configExists }));
}

async function runInstallSystemdUnit(argv) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    printUsage();
    return;
  }

  const options = await resolveRuntimeOptions(rawOptions);
  const configExists = await fileExists(options.configPath);
  await installSystemdUnit({ ...options, launchAgentConfigOnly: configExists });
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "serve":
      await runServe(rest);
      break;
    case "secure-bootstrap":
      await runSecureBootstrap(rest);
      break;
    case "secure-doctor":
      await runSecureDoctor(rest);
      break;
    case "gen-token":
      await runGenToken(rest);
      break;
    case "print-launch-agent":
      await runPrintLaunchAgent(rest);
      break;
    case "install-launch-agent":
      await runInstallLaunchAgent(rest);
      break;
    case "print-systemd-unit":
      await runPrintSystemdUnit(rest);
      break;
    case "install-systemd-unit":
      await runInstallSystemdUnit(rest);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      throw new Error(`unknown server helper command: ${command}`);
  }
}

await main();
