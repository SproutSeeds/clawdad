#!/usr/bin/env node

import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chmod, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";

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
const defaultCodexBinary = process.env.CLAWDAD_CODEX || "codex";
const defaultChimeraBinary = process.env.CLAWDAD_CHIMERA || "chimera";
const defaultCodexHome = process.env.CLAWDAD_CODEX_HOME || path.join(os.homedir(), ".codex");
const activeProviders = new Set(["codex", "chimera"]);
const projectCatalogCacheTtlMs = 10_000;
const projectCatalogCache = {
  value: null,
  loadedAt: 0,
  promise: null,
};
const transcriptPathCacheTtlMs = 60_000;
const transcriptPathCache = new Map();
const transcriptTurnCache = new Map();
const projectSummarySnapshotLimit = 12;
const projectSummaryHistoryPerSessionLimit = 12;
const projectSummaryHistoryTotalLimit = 24;
const projectSummaryTimeoutMs = 5 * 60 * 1000;
const projectSummaryJobs = new Map();
const delegatePlanSnapshotLimit = 12;
const delegateHistoryTotalLimit = 18;
const delegateDispatchTimeoutMs = 30 * 60 * 1000;
const delegateDispatchStartTimeoutMs = 30_000;
const delegateDefaultSessionSlug = "Delegate";
const delegateDefaultHardStops = Object.freeze(["paid", "needs_human", "auth_required"]);
const delegateDefaultMaxStepsPerRun = 25;
const delegatePlanJobs = new Map();
const delegateRunJobs = new Map();
const featuredProjectRules = new Map([
  [
    "global-mind",
    {
      displayName: "Global Mind",
      accent: "gold",
      role: "global-mind",
    },
  ],
]);

function printUsage() {
  console.log(`clawdad server helpers

Usage:
  clawdad serve [options]
  clawdad secure-bootstrap [options]
  clawdad secure-doctor [options]
  clawdad delegate [project] [--json]
  clawdad delegate-set [project] [text] [--file <path> | --stdin] [--json]
  clawdad delegate-reset [project] [--json]
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

  delegate
    Print the saved delegate brief, status, and latest plan for one tracked project.

  delegate-set
    Update the saved delegate brief for one tracked project.

  delegate-reset
    Reset the delegate brief back to the default project template.

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
      case "--stdin":
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
      case "--project":
      case "--file":
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
  const normalized = String(value || "codex").trim().toLowerCase();
  if (!activeProviders.has(normalized)) {
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

async function readOptionalText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }
    throw new Error(`failed to read ${filePath}: ${error.message}`);
  }
}

async function writeJsonFile(filePath, payload) {
  await writeAtomicTextFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function writeTextFile(filePath, contents) {
  await writeAtomicTextFile(filePath, String(contents || ""));
}

async function writeAtomicTextFile(filePath, contents) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    await writeFile(tempPath, contents, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
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

function featuredProjectMeta(projectPath) {
  const slug = basenameOrFallback(projectPath);
  const rule = featuredProjectRules.get(slug.toLowerCase()) || null;
  return {
    slug,
    displayName: rule?.displayName || slug,
    featured: Boolean(rule),
    featuredAccent: rule?.accent || "",
    specialRole: rule?.role || "",
  };
}

function compareProjects(left, right) {
  const leftFeatured = Boolean(left?.featured);
  const rightFeatured = Boolean(right?.featured);
  if (leftFeatured !== rightFeatured) {
    return leftFeatured ? -1 : 1;
  }

  const leftName = String(left?.displayName || left?.slug || left?.path || "");
  const rightName = String(right?.displayName || right?.slug || right?.path || "");
  return leftName.localeCompare(rightName);
}

function pathDisplayTail(projectPath, segmentCount = 2) {
  const parts = String(projectPath || "")
    .trim()
    .split(path.sep)
    .filter(Boolean);
  if (parts.length === 0) {
    return "project";
  }
  if (parts.length <= segmentCount) {
    return parts.join(path.sep);
  }
  return parts.slice(-segmentCount).join(path.sep);
}

function disambiguateProjectDisplayNames(projects = []) {
  const grouped = new Map();

  for (const project of projects) {
    const displayName = String(project?.displayName || project?.slug || project?.path || "").trim();
    if (!displayName) {
      continue;
    }
    const group = grouped.get(displayName) || [];
    group.push(project);
    grouped.set(displayName, group);
  }

  return projects.map((project) => ({ ...project })).map((project) => {
    const displayName = String(project?.displayName || project?.slug || project?.path || "").trim();
    const group = grouped.get(displayName) || [];
    if (group.length <= 1) {
      return project;
    }

    const allParts = group.map((entry) =>
      String(entry?.path || "")
        .trim()
        .split(path.sep)
        .filter(Boolean),
    );
    const maxSegments = Math.max(...allParts.map((parts) => parts.length), 2);

    let chosenLabel = "";
    for (let segmentCount = 2; segmentCount <= maxSegments; segmentCount += 1) {
      const candidateLabels = group.map((entry) => pathDisplayTail(entry.path, segmentCount));
      if (new Set(candidateLabels).size === group.length) {
        chosenLabel = pathDisplayTail(project.path, segmentCount);
        break;
      }
    }

    return {
      ...project,
      displayName: chosenLabel || pathDisplayTail(project.path, maxSegments),
    };
  });
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
    provider: String(tab?.resumeTool || "").trim() || "codex",
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
  const visualMeta = featuredProjectMeta(projectPath);

  return {
    slug: visualMeta.slug,
    displayName: visualMeta.displayName,
    path: projectPath,
    featured: visualMeta.featured,
    featuredAccent: visualMeta.featuredAccent,
    specialRole: visualMeta.specialRole,
    provider: activeSession?.provider || "codex",
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

function normalizedHistoryText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function historyTimestampCandidateMs(value) {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function historySentAtMs(entry) {
  return historyTimestampCandidateMs(pickString(entry?.sentAt));
}

function historyAnsweredAtMs(entry) {
  return historyTimestampCandidateMs(pickString(entry?.answeredAt));
}

function historyResponseTextComparable(leftResponse, rightResponse) {
  const left = normalizedHistoryText(leftResponse);
  const right = normalizedHistoryText(rightResponse);
  if (!left || !right) {
    return false;
  }
  return left === right || left.includes(right) || right.includes(left);
}

function historyEntriesLikelyDuplicate(left, right) {
  const leftMessage = normalizedHistoryText(left?.message);
  const rightMessage = normalizedHistoryText(right?.message);
  const leftResponse = pickString(left?.response);
  const rightResponse = pickString(right?.response);

  if (!leftMessage || !rightMessage) {
    return false;
  }

  if (leftMessage !== rightMessage) {
    return false;
  }

  const leftSentAtMs = historySentAtMs(left);
  const rightSentAtMs = historySentAtMs(right);
  if (leftSentAtMs > 0 && rightSentAtMs > 0 && Math.abs(leftSentAtMs - rightSentAtMs) > 90_000) {
    return false;
  }

  const leftAnsweredAtMs = historyAnsweredAtMs(left);
  const rightAnsweredAtMs = historyAnsweredAtMs(right);
  if (
    leftAnsweredAtMs > 0 &&
    rightAnsweredAtMs > 0 &&
    Math.abs(leftAnsweredAtMs - rightAnsweredAtMs) > 120_000
  ) {
    return false;
  }

  if (
    leftSentAtMs > 0 &&
    rightSentAtMs > 0 &&
    Math.abs(leftSentAtMs - rightSentAtMs) <= 30_000 &&
    ((leftAnsweredAtMs > 0 &&
      rightAnsweredAtMs > 0 &&
      Math.abs(leftAnsweredAtMs - rightAnsweredAtMs) <= 120_000) ||
      (leftAnsweredAtMs <= 0 || rightAnsweredAtMs <= 0))
  ) {
    return true;
  }

  if (leftResponse && rightResponse) {
    if (!historyResponseTextComparable(leftResponse, rightResponse)) {
      return false;
    }
  } else if (!leftResponse && !rightResponse) {
    if (leftSentAtMs > 0 && rightSentAtMs > 0) {
      return Math.abs(leftSentAtMs - rightSentAtMs) <= 30_000;
    }
    return false;
  }

  if (leftSentAtMs > 0 && rightSentAtMs > 0) {
    return true;
  }

  return true;
}

function isSyntheticProviderHistoryRequestId(value) {
  const requestId = pickString(value);
  if (!requestId) {
    return false;
  }
  return (
    requestId.startsWith("codex:") ||
    requestId.startsWith("chimera:")
  );
}

function choosePreferredHistoryRequestId(left, right) {
  const leftRequestId = pickString(left?.requestId);
  const rightRequestId = pickString(right?.requestId);

  if (leftRequestId && !isSyntheticProviderHistoryRequestId(leftRequestId)) {
    return leftRequestId;
  }
  if (rightRequestId && !isSyntheticProviderHistoryRequestId(rightRequestId)) {
    return rightRequestId;
  }
  return leftRequestId || rightRequestId || null;
}

function choosePreferredHistoryStatus(leftStatus, rightStatus) {
  const leftRank = { failed: 3, answered: 2, queued: 1 }[normalizeHistoryStatus(leftStatus)] || 0;
  const rightRank = { failed: 3, answered: 2, queued: 1 }[normalizeHistoryStatus(rightStatus)] || 0;
  return leftRank >= rightRank ? normalizeHistoryStatus(leftStatus) : normalizeHistoryStatus(rightStatus);
}

function choosePreferredHistoryResponse(leftResponse, rightResponse) {
  const leftText = String(leftResponse || "");
  const rightText = String(rightResponse || "");
  if (!leftText) {
    return rightText;
  }
  if (!rightText) {
    return leftText;
  }

  const leftComparable = normalizedHistoryText(leftText);
  const rightComparable = normalizedHistoryText(rightText);
  if (leftComparable && rightComparable) {
    if (leftComparable === rightComparable) {
      return leftText.length >= rightText.length ? leftText : rightText;
    }
    if (leftComparable.includes(rightComparable)) {
      return leftText;
    }
    if (rightComparable.includes(leftComparable)) {
      return rightText;
    }
  }

  return leftText.length >= rightText.length ? leftText : rightText;
}

function chooseEarlierTimestamp(leftValue, rightValue) {
  const leftText = pickString(leftValue);
  const rightText = pickString(rightValue);
  const leftMs = historyTimestampCandidateMs(leftText);
  const rightMs = historyTimestampCandidateMs(rightText);
  if (leftMs > 0 && rightMs > 0) {
    return leftMs <= rightMs ? leftText : rightText;
  }
  return leftText || rightText || null;
}

function chooseLaterTimestamp(leftValue, rightValue) {
  const leftText = pickString(leftValue);
  const rightText = pickString(rightValue);
  const leftMs = historyTimestampCandidateMs(leftText);
  const rightMs = historyTimestampCandidateMs(rightText);
  if (leftMs > 0 && rightMs > 0) {
    return leftMs >= rightMs ? leftText : rightText;
  }
  return leftText || rightText || null;
}

function mergeHistoryEntries(left, right) {
  return normalizeHistoryEntry({
    requestId: choosePreferredHistoryRequestId(left, right),
    projectPath: pickString(left?.projectPath, right?.projectPath) || null,
    sessionId: pickString(left?.sessionId, right?.sessionId) || null,
    sessionSlug: pickString(left?.sessionSlug, right?.sessionSlug) || null,
    provider: pickString(left?.provider, right?.provider, "session"),
    message: String(left?.message || right?.message || ""),
    sentAt: chooseEarlierTimestamp(left?.sentAt, right?.sentAt),
    answeredAt: chooseLaterTimestamp(left?.answeredAt, right?.answeredAt),
    status: choosePreferredHistoryStatus(left?.status, right?.status),
    exitCode:
      typeof left?.exitCode === "number"
        ? left.exitCode
        : typeof right?.exitCode === "number"
          ? right.exitCode
          : null,
    response: choosePreferredHistoryResponse(left?.response, right?.response),
  });
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
  if (provider === "codex") {
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
  const combinedItems = [...mirroredItems];

  for (const providerEntry of providerItems) {
    const duplicateIndex = combinedItems.findIndex((existingEntry) =>
      historyEntriesLikelyDuplicate(providerEntry, existingEntry),
    );
    if (duplicateIndex >= 0) {
      combinedItems[duplicateIndex] = mergeHistoryEntries(
        combinedItems[duplicateIndex],
        providerEntry,
      );
      continue;
    }
    combinedItems.push(providerEntry);
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

function projectSummaryPaths(projectPath) {
  const summariesDir = path.join(projectPath, ".clawdad", "summaries");
  return {
    summariesDir,
    snapshotsFile: path.join(summariesDir, "project-summary-snapshots.json"),
    statusFile: path.join(summariesDir, "project-summary-status.json"),
  };
}

function normalizeProjectSummarySnapshot(payload = {}) {
  const createdAt = pickString(payload.createdAt, payload.generatedAt);
  const sourceEntryCount = Number.parseInt(String(payload.sourceEntryCount || "0"), 10) || 0;
  const sourceSessionCount = Number.parseInt(String(payload.sourceSessionCount || "0"), 10) || 0;

  return {
    id: pickString(payload.id) || crypto.randomUUID(),
    projectPath: pickString(payload.projectPath) || null,
    createdAt: createdAt || null,
    provider: pickString(payload.provider, "session"),
    sessionId: pickString(payload.sessionId) || null,
    sessionLabel: pickString(payload.sessionLabel) || null,
    sourceEntryCount,
    sourceSessionCount,
    summary: trimTrailingNewlines(String(payload.summary || "")),
  };
}

function projectSummaryTimestampMs(snapshot) {
  const parsed = Date.parse(pickString(snapshot?.createdAt));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeProjectSummaryStatus(payload = {}) {
  const normalizedState = String(payload.state || "idle").trim().toLowerCase();
  const state = ["idle", "running", "completed", "failed"].includes(normalizedState)
    ? normalizedState
    : "idle";

  return {
    state,
    requestId: pickString(payload.requestId) || null,
    projectPath: pickString(payload.projectPath) || null,
    startedAt: pickString(payload.startedAt) || null,
    completedAt: pickString(payload.completedAt) || null,
    provider: pickString(payload.provider) || null,
    sessionId: pickString(payload.sessionId) || null,
    sessionLabel: pickString(payload.sessionLabel) || null,
    snapshotId: pickString(payload.snapshotId) || null,
    error: trimTrailingNewlines(String(payload.error || "")) || null,
  };
}

async function writeProjectSummaryStatus(projectPath, status) {
  const { statusFile } = projectSummaryPaths(projectPath);
  const normalizedStatus = normalizeProjectSummaryStatus({
    ...status,
    projectPath,
  });

  await writeJsonFile(statusFile, {
    version: 1,
    ...normalizedStatus,
  });
  return normalizedStatus;
}

async function readProjectSummaryStatus(projectPath, { reconcile = false } = {}) {
  const { statusFile } = projectSummaryPaths(projectPath);
  const payload = (await readOptionalJson(statusFile)) || {};
  const runningJob = projectSummaryJobs.get(projectPath) || null;
  let status = normalizeProjectSummaryStatus({
    ...payload,
    projectPath,
  });

  if (status.state === "idle" && runningJob) {
    status = normalizeProjectSummaryStatus({
      state: "running",
      requestId: runningJob.requestId,
      projectPath,
      startedAt: runningJob.startedAt,
      provider: runningJob.provider,
      sessionId: runningJob.sessionId,
      sessionLabel: runningJob.sessionLabel,
    });
  }

  if (reconcile && status.state === "running" && !projectSummaryJobs.has(projectPath)) {
    status = await writeProjectSummaryStatus(projectPath, {
      ...status,
      state: "failed",
      completedAt: new Date().toISOString(),
      error: status.error || "Summary refresh was interrupted. Please try again.",
    });
  }

  return status;
}

async function readProjectSummarySnapshots(projectPath) {
  const { snapshotsFile } = projectSummaryPaths(projectPath);
  const payload = (await readOptionalJson(snapshotsFile)) || {};
  const snapshots = Array.isArray(payload.snapshots) ? payload.snapshots : [];

  return snapshots
    .map(normalizeProjectSummarySnapshot)
    .filter((snapshot) => snapshot.summary)
    .sort((left, right) => projectSummaryTimestampMs(right) - projectSummaryTimestampMs(left));
}

async function writeProjectSummarySnapshots(projectPath, snapshots) {
  const { snapshotsFile } = projectSummaryPaths(projectPath);
  const normalizedSnapshots = (Array.isArray(snapshots) ? snapshots : [])
    .map(normalizeProjectSummarySnapshot)
    .filter((snapshot) => snapshot.summary)
    .sort((left, right) => projectSummaryTimestampMs(right) - projectSummaryTimestampMs(left))
    .slice(0, projectSummarySnapshotLimit);

  await writeJsonFile(snapshotsFile, {
    version: 1,
    snapshots: normalizedSnapshots,
  });
  return normalizedSnapshots;
}

function summaryEntryKey(entry) {
  return [
    pickString(entry?.requestId),
    pickString(entry?.sessionId),
    pickString(entry?.sentAt, entry?.answeredAt),
    String(entry?.message || ""),
  ].join("::");
}

function truncateSummarySourceText(text, maxLength = 720) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

async function loadProjectSummarySourceEntries(project) {
  const sessions = Array.isArray(project?.sessions)
    ? project.sessions.filter((session) => pickString(session?.sessionId))
    : [];
  if (sessions.length === 0) {
    return [];
  }

  const pages = await Promise.all(
    sessions.map(async (session) => {
      try {
        const page = await readSessionHistoryPage(project.path, session, {
          cursor: 0,
          limit: projectSummaryHistoryPerSessionLimit,
        });
        return {
          session,
          items: Array.isArray(page.items) ? page.items : [],
        };
      } catch (_error) {
        return {
          session,
          items: [],
        };
      }
    }),
  );

  const byKey = new Map();
  for (const page of pages) {
    for (const item of page.items) {
      const normalized = normalizeHistoryEntry(item);
      if (!normalized.message && !normalized.response) {
        continue;
      }

      const sessionLabel = sessionDisplayForStatus(page.session);
      const enriched = {
        ...normalized,
        projectPath: project.path,
        projectLabel: project.displayName || project.slug || basenameOrFallback(project.path),
        sessionLabel,
        sessionSlug: pickString(normalized.sessionSlug, page.session.slug),
        provider: pickString(normalized.provider, page.session.provider),
      };
      const key = summaryEntryKey(enriched);
      if (!byKey.has(key)) {
        byKey.set(key, enriched);
      }
    }
  }

  return [...byKey.values()]
    .sort((left, right) => historyItemTimestampMs(right) - historyItemTimestampMs(left))
    .slice(0, projectSummaryHistoryTotalLimit);
}

function formatProjectSummarySourceEntry(entry) {
  const timestamp = pickString(entry?.answeredAt, entry?.sentAt) || "unknown time";
  const label = pickString(
    entry?.sessionLabel,
    entry?.sessionSlug,
    `${pickString(entry?.provider, "session")} • ${pickString(entry?.sessionId)}`,
  );
  const status = pickString(entry?.status, "queued");
  const parts = [`[${timestamp}] ${label} (${status})`];

  if (String(entry?.message || "").trim()) {
    parts.push(`User: ${truncateSummarySourceText(entry.message, 520)}`);
  }

  if (status === "queued") {
    parts.push("Assistant: still processing");
  } else if (String(entry?.response || "").trim()) {
    parts.push(`Assistant: ${truncateSummarySourceText(entry.response, 880)}`);
  }

  return parts.join("\n");
}

function buildProjectSummaryPrompt(project, session, sourceEntries, previousSnapshot = null) {
  const orderedEntries = [...sourceEntries].sort(
    (left, right) => historyItemTimestampMs(left) - historyItemTimestampMs(right),
  );
  const sourceText = orderedEntries.map(formatProjectSummarySourceEntry).join("\n\n");
  const previousBlock = previousSnapshot?.summary
    ? `Previous saved snapshot (${previousSnapshot.createdAt || "unknown time"}):\n${previousSnapshot.summary}`
    : "Previous saved snapshot: none";

  return `You are updating a saved project snapshot for a mobile dashboard.

Project: ${project.displayName || project.slug || basenameOrFallback(project.path)}
Directory: ${project.path}
Summary run provider: ${sessionDisplayForStatus(session)}

${previousBlock}

Recent project history across tracked sessions (oldest first):
${sourceText}

Write a concise markdown summary with exactly these sections:
**Current State**
1-3 sentences.

**Recent Changes**
- Bullet list.

**Open Threads**
- Bullet list.

**Next Move**
- One short bullet.

Rules:
- Use only the provided history.
- Mention uncertainty plainly.
- Prefer specifics over generic language.
- Keep it under 220 words.
- Do not add any introduction or closing beyond those sections.`;
}

function parseJsonLines(text) {
  const events = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      events.push(JSON.parse(trimmed));
    } catch (_error) {
      // Ignore malformed/non-JSON lines.
    }
  }
  return events;
}

async function runCodexProjectSummary(projectPath, prompt) {
  const outputFile = path.join(
    os.tmpdir(),
    `clawdad-summary-${crypto.randomUUID()}.md`,
  );
  try {
    const result = await runExec(
      defaultCodexBinary,
      [
        "exec",
        "--json",
        "--output-last-message",
        outputFile,
        "--skip-git-repo-check",
        "-c",
        'approval_policy="never"',
        "-c",
        'sandbox_mode="read-only"',
        prompt,
      ],
      {
        cwd: projectPath,
        timeoutMs: projectSummaryTimeoutMs,
        ignoreStdin: true,
      },
    );

    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || `codex exited with ${result.exitCode}`);
    }

    try {
      const summary = trimTrailingNewlines(await readFile(outputFile, "utf8"));
      if (summary) {
        return summary;
      }
    } catch (_error) {
      // Fall back to stdout.
    }

    return trimTrailingNewlines(result.stdout);
  } finally {
    await rm(outputFile, { force: true }).catch(() => {});
  }
}

function extractChimeraSummaryText(output) {
  const events = parseJsonLines(output);
  const turnComplete = [...events].reverse().find((entry) => entry?.type === "turn_complete");
  if (typeof turnComplete?.text === "string" && turnComplete.text.trim()) {
    return trimTrailingNewlines(turnComplete.text);
  }

  const textChunks = events
    .filter((entry) => entry?.type === "text_delta" && typeof entry.text === "string")
    .map((entry) => entry.text.trim())
    .filter(Boolean);
  if (textChunks.length > 0) {
    return trimTrailingNewlines(textChunks.join(""));
  }

  return trimTrailingNewlines(output);
}

async function runChimeraProjectSummary(projectPath, prompt) {
  const result = await runExec(
    defaultChimeraBinary,
    ["--json", "--prompt", prompt],
    {
      cwd: projectPath,
      timeoutMs: projectSummaryTimeoutMs,
    },
  );

  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || `chimera exited with ${result.exitCode}`);
  }

  return extractChimeraSummaryText(result.stdout);
}

async function generateProjectSummarySnapshot(project, session) {
  const snapshots = await readProjectSummarySnapshots(project.path);
  const previousSnapshot = snapshots[0] || null;
  const sourceEntries = await loadProjectSummarySourceEntries(project);

  if (sourceEntries.length === 0) {
    throw new Error("No saved conversation history yet for this project.");
  }

  const prompt = buildProjectSummaryPrompt(project, session, sourceEntries, previousSnapshot);
  const provider = String(session?.provider || "codex").trim().toLowerCase();
  let summaryText = "";

  switch (provider) {
    case "codex":
      summaryText = await runCodexProjectSummary(project.path, prompt);
      break;
    case "chimera":
      summaryText = await runChimeraProjectSummary(project.path, prompt);
      break;
    default:
      throw new Error(`unsupported provider '${provider}' for summary generation`);
  }

  if (!trimTrailingNewlines(summaryText)) {
    throw new Error("summary provider returned an empty response");
  }

  const snapshot = normalizeProjectSummarySnapshot({
    id: crypto.randomUUID(),
    projectPath: project.path,
    createdAt: new Date().toISOString(),
    provider,
    sessionId: session?.sessionId || null,
    sessionLabel: sessionDisplayForStatus(session),
    sourceEntryCount: sourceEntries.length,
    sourceSessionCount: new Set(sourceEntries.map((entry) => entry.sessionId).filter(Boolean)).size,
    summary: summaryText,
  });

  const nextSnapshots = await writeProjectSummarySnapshots(project.path, [snapshot, ...snapshots]);
  return {
    snapshot,
    snapshots: nextSnapshots,
    sourceEntries,
  };
}

async function startProjectSummaryGeneration(project, session) {
  const existingJob = projectSummaryJobs.get(project.path);
  if (existingJob) {
    return {
      accepted: false,
      status: await readProjectSummaryStatus(project.path),
    };
  }

  const requestId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const runningStatus = await writeProjectSummaryStatus(project.path, {
    state: "running",
    requestId,
    startedAt,
    completedAt: null,
    provider: session?.provider || null,
    sessionId: session?.sessionId || null,
    sessionLabel: sessionDisplayForStatus(session),
    snapshotId: null,
    error: "",
  });

  const promise = (async () => {
    try {
      const result = await generateProjectSummarySnapshot(project, session);
      await writeProjectSummaryStatus(project.path, {
        state: "completed",
        requestId,
        startedAt,
        completedAt: result.snapshot.createdAt || new Date().toISOString(),
        provider: session?.provider || null,
        sessionId: session?.sessionId || null,
        sessionLabel: sessionDisplayForStatus(session),
        snapshotId: result.snapshot.id,
        error: "",
      });
      return result;
    } catch (error) {
      await writeProjectSummaryStatus(project.path, {
        state: "failed",
        requestId,
        startedAt,
        completedAt: new Date().toISOString(),
        provider: session?.provider || null,
        sessionId: session?.sessionId || null,
        sessionLabel: sessionDisplayForStatus(session),
        snapshotId: null,
        error: error.message,
      });
      throw error;
    } finally {
      const activeJob = projectSummaryJobs.get(project.path);
      if (activeJob?.requestId === requestId) {
        projectSummaryJobs.delete(project.path);
      }
    }
  })();

  projectSummaryJobs.set(project.path, {
    requestId,
    startedAt,
    provider: session?.provider || null,
    sessionId: session?.sessionId || null,
    sessionLabel: sessionDisplayForStatus(session),
    promise,
  });

  promise.catch(() => {});

  return {
    accepted: true,
    status: runningStatus,
  };
}

function delegatePaths(projectPath) {
  const delegateDir = path.join(projectPath, ".clawdad", "delegate");
  return {
    delegateDir,
    configFile: path.join(delegateDir, "delegate-config.json"),
    briefFile: path.join(delegateDir, "delegate-brief.md"),
    statusFile: path.join(delegateDir, "delegate-status.json"),
    planSnapshotsFile: path.join(delegateDir, "delegate-plan-snapshots.json"),
  };
}

function normalizeDelegateConfig(payload = {}) {
  const maxStepsRaw = Number.parseInt(String(payload.maxStepsPerRun || ""), 10);
  const maxStepsPerRun =
    Number.isFinite(maxStepsRaw) && maxStepsRaw > 0
      ? Math.min(200, maxStepsRaw)
      : delegateDefaultMaxStepsPerRun;
  const hardStops = uniqueStrings(
    Array.isArray(payload.hardStops) && payload.hardStops.length > 0
      ? payload.hardStops
      : delegateDefaultHardStops,
  );

  return {
    version: 1,
    projectPath: pickString(payload.projectPath) || null,
    enabled: boolFromUnknown(payload.enabled, false),
    delegateSessionId: pickString(payload.delegateSessionId) || null,
    delegateSessionSlug: pickString(payload.delegateSessionSlug, delegateDefaultSessionSlug),
    hardStops: hardStops.length > 0 ? hardStops : [...delegateDefaultHardStops],
    maxStepsPerRun,
    updatedAt: pickString(payload.updatedAt) || null,
  };
}

async function readDelegateConfig(projectPath) {
  const payload = (await readOptionalJson(delegatePaths(projectPath).configFile)) || {};
  return normalizeDelegateConfig({
    ...payload,
    projectPath,
  });
}

async function writeDelegateConfig(projectPath, config) {
  const normalized = normalizeDelegateConfig({
    ...config,
    projectPath,
    updatedAt: new Date().toISOString(),
  });
  await writeJsonFile(delegatePaths(projectPath).configFile, normalized);
  return normalized;
}

function defaultDelegateBrief(project) {
  const displayName = project?.displayName || project?.slug || basenameOrFallback(project?.path);
  return `# North Star
What does success look like for ${displayName}?

# Current Objective
What should the delegate push forward right now?

# Definition of Done
- What must be true before we call this finished?

# Allowed Without Asking
- Local edits in this repo
- Running tests, build steps, and free tooling already available
- Reading local files and free/public docs when needed

# Hard Stops
- Anything paid
- Anything that needs another human
- Anything that needs credentials, billing, MFA, or account decisions

# Notes
- Keep this section updated with the latest cone of vision.
`;
}

async function readDelegateBrief(projectPath, project = null) {
  const raw = trimTrailingNewlines(await readOptionalText(delegatePaths(projectPath).briefFile));
  return raw || defaultDelegateBrief(project || { path: projectPath });
}

async function writeDelegateBrief(projectPath, brief, project = null) {
  const normalized = trimTrailingNewlines(String(brief || "").trim()) || defaultDelegateBrief(project || { path: projectPath });
  await writeTextFile(delegatePaths(projectPath).briefFile, `${normalized}\n`);
  return normalized;
}

function normalizeDelegatePlanSnapshot(payload = {}) {
  return {
    id: pickString(payload.id) || crypto.randomUUID(),
    projectPath: pickString(payload.projectPath) || null,
    createdAt: pickString(payload.createdAt) || null,
    provider: pickString(payload.provider, "codex"),
    sessionId: pickString(payload.sessionId) || null,
    sessionLabel: pickString(payload.sessionLabel) || null,
    sourceEntryCount: Number.parseInt(String(payload.sourceEntryCount || "0"), 10) || 0,
    summarySnapshotAt: pickString(payload.summarySnapshotAt) || null,
    plan: trimTrailingNewlines(String(payload.plan || "")),
  };
}

function delegatePlanTimestampMs(snapshot) {
  const parsed = Date.parse(pickString(snapshot?.createdAt));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function readDelegatePlanSnapshots(projectPath) {
  const payload = (await readOptionalJson(delegatePaths(projectPath).planSnapshotsFile)) || {};
  const snapshots = Array.isArray(payload.snapshots) ? payload.snapshots : [];
  return snapshots
    .map(normalizeDelegatePlanSnapshot)
    .filter((snapshot) => snapshot.plan)
    .sort((left, right) => delegatePlanTimestampMs(right) - delegatePlanTimestampMs(left));
}

async function writeDelegatePlanSnapshots(projectPath, snapshots) {
  const normalizedSnapshots = (Array.isArray(snapshots) ? snapshots : [])
    .map(normalizeDelegatePlanSnapshot)
    .filter((snapshot) => snapshot.plan)
    .sort((left, right) => delegatePlanTimestampMs(right) - delegatePlanTimestampMs(left))
    .slice(0, delegatePlanSnapshotLimit);

  await writeJsonFile(delegatePaths(projectPath).planSnapshotsFile, {
    version: 1,
    snapshots: normalizedSnapshots,
  });
  return normalizedSnapshots;
}

function normalizeDelegateStatus(payload = {}) {
  const normalizedState = String(payload.state || "idle").trim().toLowerCase();
  const allowedStates = ["idle", "planning", "running", "paused", "blocked", "completed", "failed"];
  const state = allowedStates.includes(normalizedState) ? normalizedState : "idle";
  const stepCount = Number.parseInt(String(payload.stepCount || "0"), 10) || 0;
  const maxStepsRaw = Number.parseInt(String(payload.maxSteps || payload.maxStepsPerRun || "0"), 10) || 0;

  return {
    state,
    runId: pickString(payload.runId, payload.requestId) || null,
    projectPath: pickString(payload.projectPath) || null,
    startedAt: pickString(payload.startedAt) || null,
    updatedAt: pickString(payload.updatedAt) || null,
    completedAt: pickString(payload.completedAt) || null,
    delegateSessionId: pickString(payload.delegateSessionId, payload.sessionId) || null,
    delegateSessionLabel: pickString(payload.delegateSessionLabel, payload.sessionLabel) || null,
    planSnapshotId: pickString(payload.planSnapshotId, payload.snapshotId) || null,
    stepCount,
    maxSteps: maxStepsRaw > 0 ? maxStepsRaw : delegateDefaultMaxStepsPerRun,
    lastOutcomeSummary: trimTrailingNewlines(String(payload.lastOutcomeSummary || "")) || null,
    nextAction: trimTrailingNewlines(String(payload.nextAction || "")) || null,
    stopReason: pickString(payload.stopReason) || null,
    pauseRequested: boolFromUnknown(payload.pauseRequested, false),
    error: trimTrailingNewlines(String(payload.error || "")) || null,
  };
}

async function writeDelegateStatus(projectPath, status) {
  const normalized = normalizeDelegateStatus({
    ...status,
    projectPath,
    updatedAt: new Date().toISOString(),
  });
  await writeJsonFile(delegatePaths(projectPath).statusFile, {
    version: 1,
    ...normalized,
  });
  return normalized;
}

async function readDelegateStatus(projectPath, { reconcile = false } = {}) {
  const payload = (await readOptionalJson(delegatePaths(projectPath).statusFile)) || {};
  let status = normalizeDelegateStatus({
    ...payload,
    projectPath,
  });

  if (status.state === "planning" && delegatePlanJobs.has(projectPath)) {
    const job = delegatePlanJobs.get(projectPath);
    status = normalizeDelegateStatus({
      ...status,
      state: "planning",
      runId: job.runId,
      startedAt: job.startedAt,
    });
  }

  if (status.state === "running" && delegateRunJobs.has(projectPath)) {
    const job = delegateRunJobs.get(projectPath);
    status = normalizeDelegateStatus({
      ...status,
      state: "running",
      runId: job.runId,
      startedAt: job.startedAt,
      delegateSessionId: job.delegateSessionId || status.delegateSessionId,
      delegateSessionLabel: job.delegateSessionLabel || status.delegateSessionLabel,
      pauseRequested: job.pauseRequested || status.pauseRequested,
    });
  }

  if (reconcile) {
    if (status.state === "planning" && !delegatePlanJobs.has(projectPath)) {
      status = await writeDelegateStatus(projectPath, {
        ...status,
        state: "failed",
        completedAt: new Date().toISOString(),
        error: status.error || "Delegate planning was interrupted. Please try again.",
      });
    } else if (status.state === "running" && !delegateRunJobs.has(projectPath)) {
      status = await writeDelegateStatus(projectPath, {
        ...status,
        state: "failed",
        completedAt: new Date().toISOString(),
        pauseRequested: false,
        error: status.error || "Delegate run was interrupted. Please try again.",
      });
    }
  }

  return status;
}

async function refreshProjectDetails(projectPath) {
  invalidateProjectCatalogCache();
  const projects = await loadProjectCatalogCached();
  return projects.find((entry) => entry.path === projectPath) || null;
}

function resolveDelegateSessionFromProject(projectDetails, config) {
  const sessions = Array.isArray(projectDetails?.sessions) ? projectDetails.sessions : [];
  const delegateSessionId = pickString(config?.delegateSessionId);
  const delegateSlug = pickString(config?.delegateSessionSlug, delegateDefaultSessionSlug);

  return (
    sessions.find(
      (session) =>
        String(session?.provider || "").trim().toLowerCase() === "codex" &&
        session.sessionId === delegateSessionId,
    ) ||
    sessions.find(
      (session) =>
        String(session?.provider || "").trim().toLowerCase() === "codex" &&
        pickString(session?.slug) === delegateSlug,
    ) ||
    null
  );
}

async function ensureDelegateSession(projectDetails, config) {
  if (!projectDetails?.path) {
    throw new Error("project is not tracked");
  }

  const existingSession = resolveDelegateSessionFromProject(projectDetails, config);
  if (existingSession?.sessionId) {
    const nextConfig =
      config.delegateSessionId === existingSession.sessionId &&
      config.delegateSessionSlug === pickString(existingSession.slug, config.delegateSessionSlug)
        ? config
        : await writeDelegateConfig(projectDetails.path, {
            ...config,
            delegateSessionId: existingSession.sessionId,
            delegateSessionSlug: pickString(existingSession.slug, config.delegateSessionSlug),
          });

    return {
      projectDetails,
      config: nextConfig,
      session: existingSession,
      created: false,
    };
  }

  const beforeSessionIds = new Set(
    (Array.isArray(projectDetails.sessions) ? projectDetails.sessions : [])
      .map((session) => String(session?.sessionId || "").trim())
      .filter(Boolean),
  );
  const previousActiveSessionId = pickString(projectDetails.activeSessionId);
  const slug = pickString(config.delegateSessionSlug, delegateDefaultSessionSlug);
  const result = await runClawdad([
    "add-session",
    projectDetails.path,
    "--provider",
    "codex",
    "--slug",
    slug,
  ]);
  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || "failed to create delegate session");
  }

  let refreshedProject = await refreshProjectDetails(projectDetails.path);
  if (
    previousActiveSessionId &&
    refreshedProject?.activeSessionId &&
    refreshedProject.activeSessionId !== previousActiveSessionId
  ) {
    await persistActiveSessionSelection(projectDetails.path, previousActiveSessionId);
    refreshedProject = await refreshProjectDetails(projectDetails.path);
  }
  const createdSession =
    (Array.isArray(refreshedProject?.sessions) ? refreshedProject.sessions : []).find(
      (session) =>
        String(session?.provider || "").trim().toLowerCase() === "codex" &&
        !beforeSessionIds.has(String(session?.sessionId || "").trim()),
    ) || resolveDelegateSessionFromProject(refreshedProject, { ...config, delegateSessionSlug: slug });

  if (!createdSession?.sessionId) {
    throw new Error("delegate session was created but could not be resolved");
  }

  const nextConfig = await writeDelegateConfig(projectDetails.path, {
    ...config,
    delegateSessionId: createdSession.sessionId,
    delegateSessionSlug: pickString(createdSession.slug, slug),
  });

  return {
    projectDetails: refreshedProject,
    config: nextConfig,
    session: createdSession,
    created: true,
  };
}

async function syncDelegateSession(projectPath, config) {
  const refreshedProject = await refreshProjectDetails(projectPath);
  if (!refreshedProject) {
    throw new Error(`project '${projectPath}' is not tracked`);
  }

  const session = resolveDelegateSessionFromProject(refreshedProject, config);
  if (!session?.sessionId) {
    return {
      projectDetails: refreshedProject,
      config,
      session: null,
    };
  }

  const nextConfig =
    config.delegateSessionId === session.sessionId &&
    config.delegateSessionSlug === pickString(session.slug, config.delegateSessionSlug)
      ? config
      : await writeDelegateConfig(projectPath, {
          ...config,
          delegateSessionId: session.sessionId,
          delegateSessionSlug: pickString(session.slug, config.delegateSessionSlug),
        });

  return {
    projectDetails: refreshedProject,
    config: nextConfig,
    session,
  };
}

function buildDelegatePlanPrompt(project, brief, sourceEntries, latestSummary = null, previousPlan = null) {
  const orderedEntries = [...sourceEntries]
    .sort((left, right) => historyItemTimestampMs(left) - historyItemTimestampMs(right))
    .slice(-delegateHistoryTotalLimit);
  const sourceText = orderedEntries.length > 0
    ? orderedEntries.map(formatProjectSummarySourceEntry).join("\n\n")
    : "No saved conversation history yet.";
  const summaryBlock = latestSummary?.summary
    ? `Latest saved project summary (${latestSummary.createdAt || "unknown time"}):\n${latestSummary.summary}`
    : "Latest saved project summary: none";
  const previousPlanBlock = previousPlan?.plan
    ? `Previous saved plan (${previousPlan.createdAt || "unknown time"}):\n${previousPlan.plan}`
    : "Previous saved plan: none";

  return `You are preparing the standing execution plan for an autonomous Codex delegate.

Project: ${project.displayName || project.slug || basenameOrFallback(project.path)}
Directory: ${project.path}

Delegate brief:
${brief}

${summaryBlock}

${previousPlanBlock}

Recent project history across tracked sessions (oldest first):
${sourceText}

Write a concise markdown plan with exactly these sections:
**North Star**
- Bullet list.

**Current Objective**
- Bullet list.

**Execution Tracks**
- Bullet list.

**Hard Stops**
- Bullet list.

**Next Steps**
1. Numbered list.

**Definition of Done**
- Bullet list.

Rules:
- Use only the brief, summary, and history provided here.
- Keep it concrete and execution-ready.
- Mention uncertainty plainly.
- Keep it under 260 words.
- Do not add any introduction or closing beyond those sections.`;
}

async function runCodexDelegatePlan(projectPath, prompt) {
  const outputFile = path.join(os.tmpdir(), `clawdad-delegate-plan-${crypto.randomUUID()}.md`);
  try {
    const result = await runExec(
      defaultCodexBinary,
      [
        "exec",
        "--json",
        "--output-last-message",
        outputFile,
        "--skip-git-repo-check",
        "-c",
        'approval_policy="never"',
        "-c",
        'sandbox_mode="read-only"',
        prompt,
      ],
      {
        cwd: projectPath,
        timeoutMs: projectSummaryTimeoutMs,
        ignoreStdin: true,
      },
    );

    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || `codex exited with ${result.exitCode}`);
    }

    try {
      const planText = trimTrailingNewlines(await readFile(outputFile, "utf8"));
      if (planText) {
        return planText;
      }
    } catch (_error) {
      // Fall back to stdout.
    }

    return trimTrailingNewlines(result.stdout);
  } finally {
    await rm(outputFile, { force: true }).catch(() => {});
  }
}

async function generateDelegatePlanSnapshot(project, config, delegateSession = null) {
  const [brief, latestSummarySnapshots, existingPlans, sourceEntries] = await Promise.all([
    readDelegateBrief(project.path, project),
    readProjectSummarySnapshots(project.path),
    readDelegatePlanSnapshots(project.path),
    loadProjectSummarySourceEntries(project),
  ]);
  const latestSummary = latestSummarySnapshots[0] || null;
  const previousPlan = existingPlans[0] || null;
  const prompt = buildDelegatePlanPrompt(project, brief, sourceEntries, latestSummary, previousPlan);
  const planText = await runCodexDelegatePlan(project.path, prompt);

  if (!trimTrailingNewlines(planText)) {
    throw new Error("delegate plan generation returned an empty response");
  }

  const snapshot = normalizeDelegatePlanSnapshot({
    id: crypto.randomUUID(),
    projectPath: project.path,
    createdAt: new Date().toISOString(),
    provider: "codex",
    sessionId: delegateSession?.sessionId || config.delegateSessionId || null,
    sessionLabel: delegateSession ? sessionDisplayForStatus(delegateSession) : null,
    sourceEntryCount: sourceEntries.length,
    summarySnapshotAt: latestSummary?.createdAt || null,
    plan: planText,
  });

  const snapshots = await writeDelegatePlanSnapshots(project.path, [snapshot, ...existingPlans]);
  return {
    snapshot,
    snapshots,
    brief,
    latestSummary,
    sourceEntries,
  };
}

function delegateRecentHistoryBlock(sourceEntries) {
  const ordered = [...sourceEntries]
    .sort((left, right) => historyItemTimestampMs(left) - historyItemTimestampMs(right))
    .slice(-delegateHistoryTotalLimit);
  if (ordered.length === 0) {
    return "No saved project history yet.";
  }
  return ordered.map(formatProjectSummarySourceEntry).join("\n\n");
}

function buildDelegateStepPrompt(project, delegateSession, brief, latestPlan, latestSummary, sourceEntries, status) {
  const summaryBlock = latestSummary?.summary
    ? `Latest saved project summary (${latestSummary.createdAt || "unknown time"}):\n${latestSummary.summary}`
    : "Latest saved project summary: none";
  const planBlock = latestPlan?.plan
    ? `Latest saved delegate plan (${latestPlan.createdAt || "unknown time"}):\n${latestPlan.plan}`
    : "Latest saved delegate plan: none";
  const historyBlock = delegateRecentHistoryBlock(sourceEntries);
  const currentStep = (Number.parseInt(String(status?.stepCount || "0"), 10) || 0) + 1;
  const maxSteps = Number.parseInt(String(status?.maxSteps || delegateDefaultMaxStepsPerRun), 10) || delegateDefaultMaxStepsPerRun;

  return `You are the standing Codex delegate for this project. Keep pushing the project forward while the user sleeps.

Project: ${project.displayName || project.slug || basenameOrFallback(project.path)}
Directory: ${project.path}
Delegate session: ${sessionDisplayForStatus(delegateSession)}
Current step: ${currentStep} of ${maxSteps}

Delegate brief:
${brief}

${summaryBlock}

${planBlock}

Recent project history across tracked sessions (oldest first):
${historyBlock}

Instructions:
- Take the single best next concrete step toward the plan.
- You may edit files, run local tooling, and use free resources already available.
- Do not spend money.
- Do not require another human.
- Do not rely on credentials, MFA, billing, payments, or account approvals.
- If any hard stop would be required, stop instead of proceeding.
- Keep your natural response concise but useful.

At the very end, include exactly one fenced JSON block with this schema:
\`\`\`json
{"state":"continue|blocked|completed","stop_reason":"none|paid|needs_human|auth_required|step_limit|unknown","next_action":"short string","summary":"short string"}
\`\`\`

Rules for the JSON block:
- "state" must be one of continue, blocked, completed.
- "stop_reason" must be "none" unless state is blocked.
- "next_action" should be the next concrete thing to do.
- "summary" should briefly explain what changed or why you stopped.`;
}

function extractLastJsonCodeBlock(text) {
  const matches = [...String(text || "").matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const block = trimTrailingNewlines(matches[index][1] || "");
    if (!block) {
      continue;
    }
    try {
      return JSON.parse(block);
    } catch (_error) {
      continue;
    }
  }
  return null;
}

function normalizeDelegateDecision(payload = {}) {
  const state = pickString(payload.state).toLowerCase();
  const normalizedState = ["continue", "blocked", "completed"].includes(state) ? state : "";
  const stopReason = pickString(payload.stop_reason, payload.stopReason, "none").toLowerCase();
  const normalizedStopReason =
    ["none", "paid", "needs_human", "auth_required", "step_limit", "unknown"].includes(stopReason)
      ? stopReason
      : "unknown";

  if (!normalizedState) {
    throw new Error("delegate response did not include a valid state");
  }

  return {
    state: normalizedState,
    stopReason: normalizedState === "blocked" ? normalizedStopReason : "none",
    nextAction: trimTrailingNewlines(String(payload.next_action || payload.nextAction || "")) || null,
    summary: trimTrailingNewlines(String(payload.summary || "")) || null,
  };
}

function parseDelegateDecision(responseText) {
  const parsed = extractLastJsonCodeBlock(responseText);
  if (!parsed) {
    throw new Error("delegate response did not include the required JSON decision block");
  }
  return normalizeDelegateDecision(parsed);
}

async function runTrackedSessionDispatchWait(projectPath, sessionId, message, { permissionMode = "approve", model = "" } = {}) {
  const baselineStatus = await readMailboxStatus(projectPath);
  const baselineRequestId = String(baselineStatus.request_id || "").trim();
  const args = ["dispatch", projectPath, message, "--session", sessionId, "--permission-mode", permissionMode];

  if (model) {
    args.push("--model", model);
  }

  const startResult = await startClawdadDetached(args);
  if (!startResult.ok) {
    throw new Error(startResult.error?.message || "failed to start delegate dispatch");
  }

  const startedStatus = await waitForMailboxRequestStart(
    projectPath,
    baselineRequestId,
    delegateDispatchStartTimeoutMs,
  );
  const requestId = String(startedStatus.request_id || "").trim();
  if (!requestId) {
    throw new Error("delegate dispatch did not start");
  }

  const mailboxStatus = await waitForMailboxCompletion(projectPath, delegateDispatchTimeoutMs, baselineRequestId);
  if (String(mailboxStatus.state || "").trim() === "timeout") {
    throw new Error("delegate dispatch timed out");
  }

  const responseMarkdown = await readMailboxResponse(projectPath);
  const responseText = responseBodyFromMailbox(responseMarkdown);
  const completed = String(mailboxStatus.state || "").trim() === "completed";

  return {
    ok: completed,
    requestId,
    mailboxStatus,
    responseMarkdown,
    responseText,
  };
}

async function setDelegatePaused(projectPath, config, status, error = "") {
  const nextConfig = await writeDelegateConfig(projectPath, {
    ...config,
    enabled: false,
  });
  const nextStatus = await writeDelegateStatus(projectPath, {
    ...status,
    state: "paused",
    pauseRequested: false,
    completedAt: new Date().toISOString(),
    error,
  });
  return {
    config: nextConfig,
    status: nextStatus,
  };
}

async function runDelegateLoop(projectPath, initialProject, initialConfig, initialSession, runId, startedAt) {
  let project = initialProject;
  let config = initialConfig;
  let delegateSession = initialSession;
  let latestStatus = await writeDelegateStatus(projectPath, {
    state: "running",
    runId,
    startedAt,
    delegateSessionId: delegateSession?.sessionId || config.delegateSessionId || null,
    delegateSessionLabel: delegateSession ? sessionDisplayForStatus(delegateSession) : null,
    planSnapshotId: null,
    stepCount: 0,
    maxSteps: config.maxStepsPerRun,
    lastOutcomeSummary: "",
    nextAction: "",
    stopReason: null,
    pauseRequested: false,
    error: "",
  });

  try {
    if (!(await readDelegatePlanSnapshots(projectPath))[0]) {
      latestStatus = await writeDelegateStatus(projectPath, {
        ...latestStatus,
        state: "planning",
        error: "",
      });
      const planResult = await generateDelegatePlanSnapshot(project, config, delegateSession);
      latestStatus = await writeDelegateStatus(projectPath, {
        ...latestStatus,
        state: "running",
        planSnapshotId: planResult.snapshot.id,
        error: "",
      });
    }

    for (let stepIndex = 0; stepIndex < config.maxStepsPerRun; stepIndex += 1) {
      config = await readDelegateConfig(projectPath);
      if (!config.enabled) {
        return await setDelegatePaused(projectPath, config, latestStatus);
      }

      const synced = await syncDelegateSession(projectPath, config);
      project = synced.projectDetails;
      config = synced.config;
      delegateSession = synced.session;
      if (!project || !delegateSession?.sessionId) {
        throw new Error("delegate session is not available");
      }

      const [brief, planSnapshots, summarySnapshots, sourceEntries] = await Promise.all([
        readDelegateBrief(projectPath, project),
        readDelegatePlanSnapshots(projectPath),
        readProjectSummarySnapshots(projectPath),
        loadProjectSummarySourceEntries(project),
      ]);
      const latestPlan = planSnapshots[0] || null;
      const latestSummary = summarySnapshots[0] || null;
      latestStatus = await writeDelegateStatus(projectPath, {
        ...latestStatus,
        state: "running",
        delegateSessionId: delegateSession.sessionId,
        delegateSessionLabel: sessionDisplayForStatus(delegateSession),
        planSnapshotId: latestPlan?.id || latestStatus.planSnapshotId,
        stepCount: stepIndex,
        maxSteps: config.maxStepsPerRun,
        error: "",
      });

      const prompt = buildDelegateStepPrompt(
        project,
        delegateSession,
        brief,
        latestPlan,
        latestSummary,
        sourceEntries,
        latestStatus,
      );
      const dispatchResult = await runTrackedSessionDispatchWait(projectPath, delegateSession.sessionId, prompt, {
        permissionMode: "approve",
      });
      if (!dispatchResult.ok) {
        throw new Error(dispatchResult.responseText || dispatchResult.mailboxStatus?.error || "delegate step failed");
      }

      const decision = parseDelegateDecision(dispatchResult.responseText);
      const syncedAfterStep = await syncDelegateSession(projectPath, config);
      project = syncedAfterStep.projectDetails;
      config = syncedAfterStep.config;
      delegateSession = syncedAfterStep.session || delegateSession;

      latestStatus = await writeDelegateStatus(projectPath, {
        ...latestStatus,
        state: "running",
        delegateSessionId: delegateSession?.sessionId || latestStatus.delegateSessionId,
        delegateSessionLabel: delegateSession ? sessionDisplayForStatus(delegateSession) : latestStatus.delegateSessionLabel,
        stepCount: stepIndex + 1,
        maxSteps: config.maxStepsPerRun,
        lastOutcomeSummary: decision.summary || latestStatus.lastOutcomeSummary,
        nextAction: decision.nextAction || latestStatus.nextAction,
        stopReason: decision.stopReason === "none" ? null : decision.stopReason,
        error: "",
      });

      config = await readDelegateConfig(projectPath);
      if (!config.enabled) {
        return await setDelegatePaused(projectPath, config, latestStatus);
      }

      if (decision.state === "completed") {
        config = await writeDelegateConfig(projectPath, {
          ...config,
          enabled: false,
        });
        latestStatus = await writeDelegateStatus(projectPath, {
          ...latestStatus,
          state: "completed",
          completedAt: new Date().toISOString(),
          pauseRequested: false,
          stopReason: null,
          error: "",
        });
        return {
          config,
          status: latestStatus,
        };
      }

      if (decision.state === "blocked") {
        config = await writeDelegateConfig(projectPath, {
          ...config,
          enabled: false,
        });
        latestStatus = await writeDelegateStatus(projectPath, {
          ...latestStatus,
          state: "blocked",
          completedAt: new Date().toISOString(),
          pauseRequested: false,
          stopReason: decision.stopReason,
          error: "",
        });
        return {
          config,
          status: latestStatus,
        };
      }
    }

    config = await writeDelegateConfig(projectPath, {
      ...config,
      enabled: false,
    });
    latestStatus = await writeDelegateStatus(projectPath, {
      ...latestStatus,
      state: "paused",
      completedAt: new Date().toISOString(),
      pauseRequested: false,
      stopReason: "step_limit",
      error: "",
    });
    return {
      config,
      status: latestStatus,
    };
  } catch (error) {
    const nextConfig = await writeDelegateConfig(projectPath, {
      ...config,
      enabled: false,
    });
    const failedStatus = await writeDelegateStatus(projectPath, {
      ...latestStatus,
      state: "failed",
      completedAt: new Date().toISOString(),
      pauseRequested: false,
      error: error.message,
    });
    return {
      config: nextConfig,
      status: failedStatus,
      error,
    };
  }
}

async function resolveProjectForDelegate(projectInput, defaultProject) {
  const projectPath = await resolveProjectPathForRequest(projectInput, defaultProject);
  if (!projectPath) {
    return {
      projectPath: "",
      projectDetails: null,
    };
  }

  const projects = await loadProjectCatalogCached();
  return {
    projectPath,
    projectDetails: projects.find((entry) => entry.path === projectPath) || null,
  };
}

async function buildDelegatePayload(projectDetails) {
  const [config, brief, status, planSnapshots] = await Promise.all([
    readDelegateConfig(projectDetails.path),
    readDelegateBrief(projectDetails.path, projectDetails),
    readDelegateStatus(projectDetails.path),
    readDelegatePlanSnapshots(projectDetails.path),
  ]);
  const delegateSession =
    resolveDelegateSessionFromProject(projectDetails, config) ||
    projectDetails.sessions.find(
      (session) =>
        String(session?.provider || "").trim().toLowerCase() === "codex" &&
        pickString(session?.slug) === pickString(config.delegateSessionSlug, delegateDefaultSessionSlug),
    ) ||
    null;

  return {
    config,
    brief,
    status,
    delegateSession: delegateSession
      ? {
          sessionId: delegateSession.sessionId,
          provider: delegateSession.provider,
          slug: delegateSession.slug,
          label: sessionDisplayForStatus(delegateSession),
        }
      : null,
    latestPlanSnapshot: planSnapshots[0] || null,
    planSnapshots,
  };
}

function delegateCliProjectInput(rawOptions) {
  return String(rawOptions.project || rawOptions._[0] || "").trim();
}

async function resolveDelegateProjectForCli(rawOptions) {
  const projectInput = delegateCliProjectInput(rawOptions);
  if (!projectInput) {
    throw new Error("missing project");
  }

  const resolved = await resolveProjectForDelegate(projectInput, "");
  if (!resolved.projectPath || !resolved.projectDetails) {
    throw new Error(`project '${projectInput}' is not tracked`);
  }

  return resolved;
}

async function readStdinText() {
  if (process.stdin.isTTY) {
    return "";
  }

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  }
  return chunks.join("");
}

async function runDelegateGet(argv) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    printUsage();
    return;
  }

  const resolved = await resolveDelegateProjectForCli(rawOptions);
  const payload = await buildDelegatePayload(resolved.projectDetails);
  const result = {
    ok: true,
    project: resolved.projectPath,
    projectDetails: resolved.projectDetails,
    ...payload,
  };

  if (rawOptions.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`${resolved.projectDetails.displayName || resolved.projectDetails.slug}`);
  console.log(`Path: ${resolved.projectPath}`);
  console.log(`Delegate session: ${payload.delegateSession?.label || "not created yet"}`);
  console.log(`Status: ${payload.status?.state || "idle"}`);
  console.log("");
  console.log(payload.brief || defaultDelegateBrief(resolved.projectDetails));
}

async function runDelegateSet(argv) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    printUsage();
    return;
  }

  const resolved = await resolveDelegateProjectForCli(rawOptions);
  let brief = "";

  if (rawOptions.file) {
    brief = await readFile(path.resolve(String(rawOptions.file)), "utf8");
  } else if (rawOptions.stdin) {
    brief = await readStdinText();
  } else {
    brief = rawOptions._.slice(1).join(" ");
  }

  if (!String(brief || "").trim()) {
    throw new Error("missing brief text");
  }

  const savedBrief = await writeDelegateBrief(resolved.projectPath, brief, resolved.projectDetails);
  const payload = await buildDelegatePayload(resolved.projectDetails);
  const result = {
    ok: true,
    project: resolved.projectPath,
    brief: savedBrief,
    ...payload,
  };

  if (rawOptions.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`updated delegate brief for ${resolved.projectDetails.displayName || resolved.projectDetails.slug}`);
}

async function runDelegateReset(argv) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    printUsage();
    return;
  }

  const resolved = await resolveDelegateProjectForCli(rawOptions);
  const savedBrief = await writeDelegateBrief(resolved.projectPath, "", resolved.projectDetails);
  const payload = await buildDelegatePayload(resolved.projectDetails);
  const result = {
    ok: true,
    project: resolved.projectPath,
    brief: savedBrief,
    ...payload,
  };

  if (rawOptions.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`reset delegate brief for ${resolved.projectDetails.displayName || resolved.projectDetails.slug}`);
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

function cleanedSessionTitle(session) {
  const provider = String(session?.provider || "session").trim() || "session";
  const rawTitle = pickString(session?.slug, session?.title);
  if (!rawTitle) {
    return provider;
  }

  const providerSuffixPattern = new RegExp(`\\s*\\(${provider}\\)$`, "i");
  return rawTitle.replace(providerSuffixPattern, "").trim() || provider;
}

function sessionDisplayForStatus(session) {
  const provider = String(session?.provider || "session").trim();
  const sessionId = String(session?.sessionId || "").trim();
  const title = cleanedSessionTitle(session);
  const shortId = sessionId ? (sessionId.length <= 4 ? sessionId : `…${sessionId.slice(-4)}`) : "unknown";
  return `${title} • ${provider} • ${shortId}`;
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
    provider: activeSession?.provider || project.provider || "codex",
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
    const provider = String(tab?.resumeTool || "codex").trim().toLowerCase();
    if (!projectPath || !String(tab?.resumeSessionId || "").trim() || !activeProviders.has(provider)) {
      continue;
    }

    const existing = grouped.get(projectPath) || [];
    existing.push(tab);
    grouped.set(projectPath, existing);
  }

  return disambiguateProjectDisplayNames(
    [...grouped.entries()]
      .map(([projectPath, tabsForPath]) => projectSummaryFromTabs(projectPath, tabsForPath, stateProjects))
      .sort(compareProjects),
  );
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
  if (options.ignoreStdin) {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: options.cwd || clawdadRoot,
        env: {
          ...process.env,
          CLAWDAD_ROOT: clawdadRoot,
          CLAWDAD_HOME: clawdadHome,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;
      let timeoutId = null;
      let killTimer = null;

      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (killTimer) {
          clearTimeout(killTimer);
        }
        resolve(result);
      };

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk;
      });

      child.once("error", (error) => {
        finish({
          ok: false,
          exitCode: typeof error.code === "number" ? error.code : 1,
          stdout: trimTrailingNewlines(stdout),
          stderr: trimTrailingNewlines(stderr || error.message),
          timedOut: false,
        });
      });

      if (options.timeoutMs) {
        timeoutId = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          killTimer = setTimeout(() => {
            child.kill("SIGKILL");
          }, 2_000);
          killTimer.unref?.();
        }, options.timeoutMs);
        timeoutId.unref?.();
      }

      child.once("close", (code) => {
        finish({
          ok: !timedOut && code === 0,
          exitCode: timedOut ? 124 : code ?? 1,
          stdout: trimTrailingNewlines(stdout),
          stderr: trimTrailingNewlines(stderr),
          timedOut,
        });
      });
    });
  }

  try {
    const result = await execFileP(command, args, {
      cwd: options.cwd || clawdadRoot,
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
  }

  const wait = boolFromUnknown(payload.wait, false);
  const args = ["dispatch", resolvedProjectPath, message];
  if (matchedSession?.sessionId) {
    args.push("--session", matchedSession.sessionId);
  }

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

function normalizeImportedSessionTitle(rawTitle, fallbackTitle = "Codex session") {
  const normalized = String(rawTitle || "").replace(/\s+/g, " ").trim();
  const base = normalized || String(fallbackTitle || "").trim() || "Codex session";
  if (base.length <= 52) {
    return base;
  }
  return `${base.slice(0, 51).trimEnd()}…`;
}

function importableCodexSessionView(session = {}, projectPath = "") {
  const sessionId = String(session.sessionId || "").trim();
  const title = normalizeImportedSessionTitle(
    pickString(session.titleHint, session.preview),
    path.basename(projectPath || session.cwd || "") || "Codex session",
  );
  return {
    sessionId,
    provider: "codex",
    source: pickString(session.source, "cli"),
    originator: pickString(session.originator) || null,
    cwd: pickString(session.cwd) || projectPath,
    timestamp: pickString(session.timestamp) || null,
    lastUpdatedAt: pickString(session.lastUpdatedAt) || null,
    preview: pickString(session.preview) || "",
    titleHint: title,
    label: sessionDisplayForStatus({
      slug: title,
      provider: "codex",
      sessionId,
    }),
  };
}

async function listImportableCodexSessionsForProject(projectDetails, { limit = 12, sessionId = "" } = {}) {
  const trackedSessionIds = Array.isArray(projectDetails?.sessions)
    ? projectDetails.sessions
        .filter((session) => String(session?.provider || "").trim().toLowerCase() === "codex")
        .map((session) => String(session?.sessionId || "").trim())
        .filter(Boolean)
    : [];

  const args = [
    path.resolve(clawdadRoot, "lib", "codex-session-discovery.mjs"),
    "--cwd",
    projectDetails.path,
    "--codex-home",
    defaultCodexHome,
    "--list",
    "--limit",
    String(limit),
  ];

  if (sessionId) {
    args.push("--session-id", sessionId);
  }

  for (const trackedSessionId of trackedSessionIds) {
    args.push("--exclude", trackedSessionId);
  }

  const result = await runExec(process.execPath, args);
  const payload = parseJsonResult(result, "codex session discovery");
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  return sessions.map((session) => importableCodexSessionView(session, projectDetails.path));
}

async function resolveTrackedProjectForImport(projectInput, defaultProject) {
  const projectPath = await resolveProjectPathForRequest(projectInput, defaultProject);
  if (!projectPath) {
    return {
      projectPath: "",
      projectDetails: null,
    };
  }

  const projects = await loadProjectCatalogCached();
  return {
    projectPath,
    projectDetails: projects.find((entry) => entry.path === projectPath) || null,
  };
}

async function handleImportableSessionsGet(_req, res, options, url, actor) {
  const project = (url.searchParams.get("project") || options.defaultProject || "").trim();
  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
    return;
  }

  let resolved;
  try {
    resolved = await resolveTrackedProjectForImport(project, options.defaultProject);
  } catch (error) {
    json(res, 500, { ok: false, actor, error: error.message });
    return;
  }

  if (!resolved.projectPath || !resolved.projectDetails) {
    json(res, 404, { ok: false, actor, error: `project '${project}' is not tracked` });
    return;
  }

  try {
    const sessions = await listImportableCodexSessionsForProject(resolved.projectDetails);
    json(res, 200, {
      ok: true,
      actor,
      project: resolved.projectPath,
      projectDetails: resolved.projectDetails,
      sessions,
    });
  } catch (error) {
    json(res, 500, {
      ok: false,
      actor,
      project: resolved.projectPath,
      sessions: [],
      error: error.message,
    });
  }
}

async function handleImportSession(req, res, options, actor) {
  let payload;
  try {
    payload = await parseDispatchPayload(req, options.bodyLimitBytes);
  } catch (error) {
    json(res, 400, { ok: false, error: error.message });
    return;
  }

  const project = projectFromPayload(payload, options.defaultProject);
  const requestedSessionId = pickString(payload.sessionId);
  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
    return;
  }
  if (!requestedSessionId) {
    json(res, 400, { ok: false, error: "missing sessionId" });
    return;
  }

  let resolved;
  try {
    resolved = await resolveTrackedProjectForImport(project, options.defaultProject);
  } catch (error) {
    json(res, 500, { ok: false, actor, error: error.message });
    return;
  }

  if (!resolved.projectPath || !resolved.projectDetails) {
    json(res, 404, { ok: false, actor, error: `project '${project}' is not tracked` });
    return;
  }

  let importableSession;
  try {
    const sessions = await listImportableCodexSessionsForProject(resolved.projectDetails, {
      limit: 0,
      sessionId: requestedSessionId,
    });
    importableSession = sessions.find((session) => session.sessionId === requestedSessionId) || null;
  } catch (error) {
    json(res, 500, { ok: false, actor, project: resolved.projectPath, error: error.message });
    return;
  }

  if (!importableSession) {
    json(res, 404, {
      ok: false,
      actor,
      project: resolved.projectPath,
      error: `No untracked local Codex session '${requestedSessionId}' was found for this project`,
    });
    return;
  }

  const result = await runClawdad(["track-session", resolved.projectPath, requestedSessionId]);
  if (!result.ok) {
    json(res, 500, {
      ok: false,
      actor,
      project: resolved.projectPath,
      error: result.stderr || result.stdout || "failed to track session",
    });
    return;
  }

  invalidateProjectCatalogCache();

  let refreshedProject = null;
  try {
    const refreshedProjects = await loadProjectCatalogCached();
    refreshedProject = refreshedProjects.find((entry) => entry.path === resolved.projectPath) || null;
  } catch (error) {
    json(res, 500, {
      ok: false,
      actor,
      project: resolved.projectPath,
      error: error.message,
    });
    return;
  }

  json(res, 201, {
    ok: true,
    actor,
    project: resolved.projectPath,
    sessionId: requestedSessionId,
    importedSession: importableSession,
    projectDetails: refreshedProject,
  });
}

async function resolveProjectAndSessionForSummary(projectInput, sessionInput, defaultProject) {
  const projectPath = await resolveProjectPathForRequest(projectInput, defaultProject);
  if (!projectPath) {
    return {
      projectPath: "",
      projectDetails: null,
      sessionDetails: null,
    };
  }

  const projects = await loadProjectCatalogCached();
  const projectDetails = projects.find((entry) => entry.path === projectPath) || null;
  if (!projectDetails) {
    return {
      projectPath,
      projectDetails: null,
      sessionDetails: null,
    };
  }

  const requestedSession = String(sessionInput || "").trim();
  const sessionDetails =
    (requestedSession
      ? projectDetails.sessions.find(
          (session) =>
            session.sessionId === requestedSession || session.slug === requestedSession,
        )
      : null) ||
    projectDetails.activeSession ||
    projectDetails.sessions.find((session) => session.active) ||
    projectDetails.sessions[0] ||
    null;

  return {
    projectPath,
    projectDetails,
    sessionDetails,
  };
}

async function handleProjectSummaryGet(_req, res, options, url, actor) {
  const project = (url.searchParams.get("project") || options.defaultProject || "").trim();
  const sessionId = (url.searchParams.get("sessionId") || "").trim();

  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
    return;
  }

  let resolved;
  try {
    resolved = await resolveProjectAndSessionForSummary(project, sessionId, options.defaultProject);
  } catch (error) {
    json(res, 500, { ok: false, actor, error: error.message });
    return;
  }

  if (!resolved.projectPath || !resolved.projectDetails) {
    json(res, 404, { ok: false, actor, error: `project '${project}' is not tracked` });
    return;
  }

  if (sessionId && !resolved.sessionDetails) {
    json(res, 404, {
      ok: false,
      actor,
      error: `No tracked session '${sessionId}' found for ${resolved.projectDetails.displayName}`,
    });
    return;
  }

  try {
    const [snapshots, summaryStatus] = await Promise.all([
      readProjectSummarySnapshots(resolved.projectPath),
      readProjectSummaryStatus(resolved.projectPath),
    ]);
    json(res, 200, {
      ok: true,
      actor,
      project: resolved.projectPath,
      projectDetails: resolved.projectDetails,
      summarySession: resolved.sessionDetails
        ? {
            sessionId: resolved.sessionDetails.sessionId,
            provider: resolved.sessionDetails.provider,
            label: sessionDisplayForStatus(resolved.sessionDetails),
          }
        : null,
      summaryStatus,
      latestSnapshot: snapshots[0] || null,
      snapshots,
    });
  } catch (error) {
    json(res, 500, {
      ok: false,
      actor,
      project: resolved.projectPath,
      error: error.message,
    });
  }
}

async function handleProjectSummaryCreate(req, res, options, actor) {
  let payload;
  try {
    payload = await parseDispatchPayload(req, options.bodyLimitBytes);
  } catch (error) {
    json(res, 400, { ok: false, error: error.message });
    return;
  }

  const project = projectFromPayload(payload, options.defaultProject);
  const sessionId = pickString(payload.sessionId);

  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
    return;
  }

  let resolved;
  try {
    resolved = await resolveProjectAndSessionForSummary(project, sessionId, options.defaultProject);
  } catch (error) {
    json(res, 500, { ok: false, actor, error: error.message });
    return;
  }

  if (!resolved.projectPath || !resolved.projectDetails) {
    json(res, 404, { ok: false, actor, error: `project '${project}' is not tracked` });
    return;
  }

  if (!resolved.sessionDetails) {
    json(res, 400, {
      ok: false,
      actor,
      error: `No tracked session is available for ${resolved.projectDetails.displayName}`,
    });
    return;
  }

  try {
    const [snapshots, startResult] = await Promise.all([
      readProjectSummarySnapshots(resolved.projectPath),
      startProjectSummaryGeneration(resolved.projectDetails, resolved.sessionDetails),
    ]);

    json(res, 202, {
      ok: true,
      actor,
      project: resolved.projectPath,
      projectDetails: resolved.projectDetails,
      summarySession: {
        sessionId: resolved.sessionDetails.sessionId,
        provider: resolved.sessionDetails.provider,
        label: sessionDisplayForStatus(resolved.sessionDetails),
      },
      summaryStatus: startResult.status,
      latestSnapshot: snapshots[0] || null,
      snapshots,
    });
  } catch (error) {
    json(res, 500, {
      ok: false,
      actor,
      project: resolved.projectPath,
      error: error.message,
    });
  }
}

async function startDelegatePlanGeneration(projectDetails) {
  if (delegateRunJobs.has(projectDetails.path)) {
    return {
      accepted: false,
      status: await readDelegateStatus(projectDetails.path),
    };
  }

  const existingJob = delegatePlanJobs.get(projectDetails.path);
  if (existingJob) {
    return {
      accepted: false,
      status: await readDelegateStatus(projectDetails.path),
    };
  }

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const initialConfig = await readDelegateConfig(projectDetails.path);
  const initialStatus = await writeDelegateStatus(projectDetails.path, {
    state: "planning",
    runId,
    startedAt,
    delegateSessionId: initialConfig.delegateSessionId,
    stepCount: 0,
    maxSteps: initialConfig.maxStepsPerRun,
    planSnapshotId: null,
    pauseRequested: false,
    error: "",
  });

  const promise = (async () => {
    try {
      const ensured = await ensureDelegateSession(projectDetails, initialConfig);
      const planResult = await generateDelegatePlanSnapshot(
        ensured.projectDetails,
        ensured.config,
        ensured.session,
      );
      await writeDelegateStatus(projectDetails.path, {
        state: ensured.config.enabled ? "paused" : "idle",
        runId,
        startedAt,
        completedAt: new Date().toISOString(),
        delegateSessionId: ensured.session.sessionId,
        delegateSessionLabel: sessionDisplayForStatus(ensured.session),
        stepCount: 0,
        maxSteps: ensured.config.maxStepsPerRun,
        planSnapshotId: planResult.snapshot.id,
        pauseRequested: false,
        error: "",
      });
      return planResult;
    } catch (error) {
      await writeDelegateStatus(projectDetails.path, {
        state: "failed",
        runId,
        startedAt,
        completedAt: new Date().toISOString(),
        delegateSessionId: initialConfig.delegateSessionId,
        stepCount: 0,
        maxSteps: initialConfig.maxStepsPerRun,
        pauseRequested: false,
        error: error.message,
      });
      throw error;
    } finally {
      const activeJob = delegatePlanJobs.get(projectDetails.path);
      if (activeJob?.runId === runId) {
        delegatePlanJobs.delete(projectDetails.path);
      }
    }
  })();

  delegatePlanJobs.set(projectDetails.path, {
    runId,
    startedAt,
    promise,
  });
  promise.catch(() => {});

  return {
    accepted: true,
    status: initialStatus,
  };
}

async function startDelegateRun(projectDetails) {
  const runningJob = delegateRunJobs.get(projectDetails.path);
  if (runningJob) {
    return {
      accepted: false,
      status: await readDelegateStatus(projectDetails.path),
    };
  }
  if (delegatePlanJobs.has(projectDetails.path)) {
    return {
      accepted: false,
      status: await readDelegateStatus(projectDetails.path),
    };
  }

  let config = await readDelegateConfig(projectDetails.path);
  config = await writeDelegateConfig(projectDetails.path, {
    ...config,
    enabled: true,
  });

  const ensured = await ensureDelegateSession(projectDetails, config);
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const initialStatus = await writeDelegateStatus(projectDetails.path, {
    state: "running",
    runId,
    startedAt,
    delegateSessionId: ensured.session.sessionId,
    delegateSessionLabel: sessionDisplayForStatus(ensured.session),
    stepCount: 0,
    maxSteps: ensured.config.maxStepsPerRun,
    planSnapshotId: null,
    pauseRequested: false,
    error: "",
  });

  const promise = runDelegateLoop(
    projectDetails.path,
    ensured.projectDetails,
    ensured.config,
    ensured.session,
    runId,
    startedAt,
  ).finally(() => {
    const activeJob = delegateRunJobs.get(projectDetails.path);
    if (activeJob?.runId === runId) {
      delegateRunJobs.delete(projectDetails.path);
    }
  });

  delegateRunJobs.set(projectDetails.path, {
    runId,
    startedAt,
    delegateSessionId: ensured.session.sessionId,
    delegateSessionLabel: sessionDisplayForStatus(ensured.session),
    pauseRequested: false,
    promise,
  });
  promise.catch(() => {});

  return {
    accepted: true,
    status: initialStatus,
  };
}

async function handleDelegateGet(_req, res, options, url, actor) {
  const project = (url.searchParams.get("project") || options.defaultProject || "").trim();
  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
    return;
  }

  let resolved;
  try {
    resolved = await resolveProjectForDelegate(project, options.defaultProject);
  } catch (error) {
    json(res, 500, { ok: false, actor, error: error.message });
    return;
  }

  if (!resolved.projectPath || !resolved.projectDetails) {
    json(res, 404, { ok: false, actor, error: `project '${project}' is not tracked` });
    return;
  }

  try {
    const payload = await buildDelegatePayload(resolved.projectDetails);
    json(res, 200, {
      ok: true,
      actor,
      project: resolved.projectPath,
      projectDetails: resolved.projectDetails,
      ...payload,
    });
  } catch (error) {
    json(res, 500, {
      ok: false,
      actor,
      project: resolved.projectPath,
      error: error.message,
    });
  }
}

async function handleDelegateBriefUpdate(req, res, options, actor) {
  let payload;
  try {
    payload = await parseDispatchPayload(req, options.bodyLimitBytes);
  } catch (error) {
    json(res, 400, { ok: false, error: error.message });
    return;
  }

  const project = projectFromPayload(payload, options.defaultProject);
  const brief = typeof payload.brief === "string" ? payload.brief : "";
  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
    return;
  }

  let resolved;
  try {
    resolved = await resolveProjectForDelegate(project, options.defaultProject);
  } catch (error) {
    json(res, 500, { ok: false, actor, error: error.message });
    return;
  }

  if (!resolved.projectPath || !resolved.projectDetails) {
    json(res, 404, { ok: false, actor, error: `project '${project}' is not tracked` });
    return;
  }

  try {
    await writeDelegateBrief(resolved.projectPath, brief, resolved.projectDetails);
    const delegatePayload = await buildDelegatePayload(resolved.projectDetails);
    json(res, 200, {
      ok: true,
      actor,
      project: resolved.projectPath,
      projectDetails: resolved.projectDetails,
      ...delegatePayload,
    });
  } catch (error) {
    json(res, 500, {
      ok: false,
      actor,
      project: resolved.projectPath,
      error: error.message,
    });
  }
}

async function handleDelegatePlanCreate(req, res, options, actor) {
  let payload;
  try {
    payload = await parseDispatchPayload(req, options.bodyLimitBytes);
  } catch (error) {
    json(res, 400, { ok: false, error: error.message });
    return;
  }

  const project = projectFromPayload(payload, options.defaultProject);
  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
    return;
  }

  let resolved;
  try {
    resolved = await resolveProjectForDelegate(project, options.defaultProject);
  } catch (error) {
    json(res, 500, { ok: false, actor, error: error.message });
    return;
  }

  if (!resolved.projectPath || !resolved.projectDetails) {
    json(res, 404, { ok: false, actor, error: `project '${project}' is not tracked` });
    return;
  }

  try {
    const startResult = await startDelegatePlanGeneration(resolved.projectDetails);
    const delegatePayload = await buildDelegatePayload(resolved.projectDetails);
    json(res, 202, {
      ok: true,
      actor,
      project: resolved.projectPath,
      projectDetails: resolved.projectDetails,
      accepted: startResult.accepted,
      ...delegatePayload,
    });
  } catch (error) {
    json(res, 500, {
      ok: false,
      actor,
      project: resolved.projectPath,
      error: error.message,
    });
  }
}

async function handleDelegateRun(req, res, options, actor) {
  let payload;
  try {
    payload = await parseDispatchPayload(req, options.bodyLimitBytes);
  } catch (error) {
    json(res, 400, { ok: false, error: error.message });
    return;
  }

  const project = projectFromPayload(payload, options.defaultProject);
  const action = pickString(payload.action, "start").toLowerCase();
  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
    return;
  }
  if (!["start", "pause"].includes(action)) {
    json(res, 400, { ok: false, error: "action must be 'start' or 'pause'" });
    return;
  }

  let resolved;
  try {
    resolved = await resolveProjectForDelegate(project, options.defaultProject);
  } catch (error) {
    json(res, 500, { ok: false, actor, error: error.message });
    return;
  }

  if (!resolved.projectPath || !resolved.projectDetails) {
    json(res, 404, { ok: false, actor, error: `project '${project}' is not tracked` });
    return;
  }

  try {
    if (action === "pause") {
      const activeRunJob = delegateRunJobs.get(resolved.projectPath);
      if (activeRunJob) {
        activeRunJob.pauseRequested = true;
      }
      const currentConfig = await readDelegateConfig(resolved.projectPath);
      const nextConfig = await writeDelegateConfig(resolved.projectPath, {
        ...currentConfig,
        enabled: false,
      });
      const currentStatus = await readDelegateStatus(resolved.projectPath, { reconcile: false });
      const nextStatus = await writeDelegateStatus(resolved.projectPath, {
        ...currentStatus,
        state: currentStatus.state === "running" || currentStatus.state === "planning" ? currentStatus.state : "paused",
        pauseRequested: currentStatus.state === "running" || currentStatus.state === "planning",
        completedAt:
          currentStatus.state === "running" || currentStatus.state === "planning"
            ? currentStatus.completedAt
            : new Date().toISOString(),
        error: "",
      });

      const delegatePayload = await buildDelegatePayload(resolved.projectDetails);
      json(res, 200, {
        ok: true,
        actor,
        action,
        project: resolved.projectPath,
        projectDetails: resolved.projectDetails,
        accepted: true,
        config: nextConfig,
        status: nextStatus,
        ...delegatePayload,
      });
      return;
    }

    const startResult = await startDelegateRun(resolved.projectDetails);
    const delegatePayload = await buildDelegatePayload(resolved.projectDetails);
    json(res, 202, {
      ok: true,
      actor,
      action,
      project: resolved.projectPath,
      projectDetails: resolved.projectDetails,
      accepted: startResult.accepted,
      ...delegatePayload,
    });
  } catch (error) {
    json(res, 500, {
      ok: false,
      actor,
      action,
      project: resolved.projectPath,
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
    provider = normalizeProviderName(payload.provider || "codex");
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

async function handleSessionTitleUpdate(req, res, options, actor) {
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
  const title =
    typeof payload.title === "string" ? payload.title.replace(/\s+/g, " ").trim() : "";

  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
    return;
  }

  if (!sessionId) {
    json(res, 400, { ok: false, error: "missing sessionId" });
    return;
  }

  if (!title) {
    json(res, 400, { ok: false, error: "missing title" });
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

  const result = await runClawdad([
    "rename-session",
    matchedProject.path,
    matchedSession.sessionId,
    title,
  ]);
  if (!result.ok) {
    json(res, 500, {
      ok: false,
      actor,
      project: matchedProject.path,
      sessionId: matchedSession.sessionId,
      error: result.stderr || result.stdout || "failed to rename session",
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
      project: matchedProject.path,
      sessionId: matchedSession.sessionId,
      error: error.message,
    });
    return;
  }

  const projectDetails = refreshedProjects.find((entry) => entry.path === matchedProject.path) || null;
  const refreshedSession =
    projectDetails?.sessions.find((session) => session.sessionId === matchedSession.sessionId) || null;

  json(res, 200, {
    ok: true,
    actor,
    project: matchedProject.path,
    sessionId: matchedSession.sessionId,
    title,
    projectDetails,
    session: refreshedSession,
    output:
      result.stdout ||
      `Renamed session to ${sessionDisplayForStatus({ ...matchedSession, slug: title })}`,
  });
}

async function handleSessionDelete(req, res, options, actor) {
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

  const result = await runClawdad([
    "remove-session",
    matchedProject.path,
    matchedSession.sessionId,
  ]);
  if (!result.ok) {
    json(res, 500, {
      ok: false,
      actor,
      project: matchedProject.path,
      sessionId: matchedSession.sessionId,
      error: result.stderr || result.stdout || "failed to remove session",
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
      project: matchedProject.path,
      sessionId: matchedSession.sessionId,
      error: error.message,
    });
    return;
  }

  const projectDetails = refreshedProjects.find((entry) => entry.path === matchedProject.path) || null;

  json(res, 200, {
    ok: true,
    actor,
    project: matchedProject.path,
    sessionId: matchedSession.sessionId,
    removedSessionLabel: sessionDisplayForStatus(matchedSession),
    projectDetails,
    output:
      result.stdout ||
      `Removed session ${sessionDisplayForStatus(matchedSession)}`,
  });
}

async function handleProjectDelete(req, res, options, actor) {
  let payload;
  try {
    payload = await parseDispatchPayload(req, options.bodyLimitBytes);
  } catch (error) {
    json(res, 400, { ok: false, error: error.message });
    return;
  }

  const project = projectFromPayload(payload, options.defaultProject);
  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
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
      error: `No tracked project '${project}' found`,
    });
    return;
  }

  const sessions = Array.isArray(matchedProject.sessions)
    ? matchedProject.sessions.filter((session) => String(session?.sessionId || "").trim())
    : [];
  if (sessions.length === 0) {
    json(res, 400, {
      ok: false,
      actor,
      project: matchedProject.path,
      error: `No tracked sessions are available for ${matchedProject.displayName}`,
    });
    return;
  }

  for (const session of sessions) {
    const result = await runClawdad([
      "remove-session",
      matchedProject.path,
      session.sessionId,
    ]);
    if (!result.ok) {
      json(res, 500, {
        ok: false,
        actor,
        project: matchedProject.path,
        sessionId: session.sessionId,
        error: result.stderr || result.stdout || "failed to remove project",
      });
      return;
    }
  }

  invalidateProjectCatalogCache();

  let refreshedProjects;
  try {
    refreshedProjects = await loadProjectCatalogCached();
  } catch (error) {
    json(res, 500, {
      ok: false,
      actor,
      project: matchedProject.path,
      error: error.message,
    });
    return;
  }

  json(res, 200, {
    ok: true,
    actor,
    project: matchedProject.path,
    removedProjectLabel: matchedProject.displayName,
    removedSessionCount: sessions.length,
    projects: refreshedProjects,
    output:
      `Stopped tracking ${matchedProject.displayName} (${sessions.length} session${sessions.length === 1 ? "" : "s"})`,
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

    if (req.method === "GET" && url.pathname === "/v1/importable-sessions") {
      await handleImportableSessionsGet(req, res, options, url, auth.actor);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/import-session") {
      await handleImportSession(req, res, options, auth.actor);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/project-summary") {
      await handleProjectSummaryGet(req, res, options, url, auth.actor);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/project-summary") {
      await handleProjectSummaryCreate(req, res, options, auth.actor);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/delegate") {
      await handleDelegateGet(req, res, options, url, auth.actor);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/delegate/brief") {
      await handleDelegateBriefUpdate(req, res, options, auth.actor);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/delegate/plan") {
      await handleDelegatePlanCreate(req, res, options, auth.actor);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/delegate/run") {
      await handleDelegateRun(req, res, options, auth.actor);
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

    if (req.method === "POST" && url.pathname === "/v1/session-title") {
      await handleSessionTitleUpdate(req, res, options, auth.actor);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/session-delete") {
      await handleSessionDelete(req, res, options, auth.actor);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/project-delete") {
      await handleProjectDelete(req, res, options, auth.actor);
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
    case "delegate":
      await runDelegateGet(rest);
      break;
    case "delegate-set":
      await runDelegateSet(rest);
      break;
    case "delegate-reset":
      await runDelegateReset(rest);
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
