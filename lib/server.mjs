#!/usr/bin/env node

import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { appendFile, chmod, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import {
  computeBudgetIsBelowReserve as delegateComputeBudgetIsBelowReserve,
  defaultComputeReservePercent as delegateDefaultComputeReservePercent,
  describeComputeBudget as describeDelegateComputeBudget,
  looksLikeComputeLimitError,
  normalizeComputeBudget as normalizeDelegateComputeBudget,
  normalizePercent,
  readLatestCodexComputeBudget,
} from "./codex-compute-guard.mjs";
import {
  analyzeDelegatePhaseHandoff,
  chooseDelegateSession,
  delegatePauseDecision,
  delegatePlanRefreshDecision,
  delegateRunListState,
  recoverableCodexStreamDisconnect,
  shouldClearPendingDelegatePause,
} from "./delegate-state.mjs";

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
const defaultCodexTurnTimeoutMs = parseNonNegativeMs(
  process.env.CLAWDAD_CODEX_TURN_TIMEOUT_MS,
  30 * 60 * 1000,
);
const staleDispatchTimeoutMs = parseNonNegativeMs(
  process.env.CLAWDAD_STALE_DISPATCH_TIMEOUT_MS,
  defaultCodexTurnTimeoutMs + 5 * 60 * 1000,
);
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
const defaultOrpBinary = process.env.CLAWDAD_ORP || "orp";
const defaultCodexHome = process.env.CLAWDAD_CODEX_HOME || path.join(os.homedir(), ".codex");
const activeProviders = new Set(["codex", "chimera"]);
const projectCatalogCacheTtlMs = 10_000;
const projectCatalogCommandTimeoutMs = parseNonNegativeMs(
  process.env.CLAWDAD_PROJECT_CATALOG_TIMEOUT_MS,
  1_500,
);
const importableSessionDiscoveryTimeoutMs = parseNonNegativeMs(
  process.env.CLAWDAD_IMPORTABLE_SESSION_DISCOVERY_TIMEOUT_MS,
  8_000,
);
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
const delegatePlanRunEventLimit = 24;
const delegateRunSummarySnapshotLimit = 12;
const delegateRunEventPageLimit = 80;
const delegateRunSummaryEventLimit = 160;
const delegateHistoryTotalLimit = 18;
const delegateDispatchTimeoutMs = Math.max(
  30 * 60 * 1000,
  Number.parseInt(String(process.env.CLAWDAD_DELEGATE_DISPATCH_TIMEOUT_MS || ""), 10) ||
    2 * 60 * 60 * 1000,
);
const delegateDispatchStartTimeoutMs = 120_000;
const delegateDispatchStartReconcileMs = 15_000;
const delegateDefaultSessionSlug = "Delegate";
const delegateRequiredHardStops = Object.freeze(["paid", "needs_human", "compute_limit"]);
const delegateDefaultHardStops = delegateRequiredHardStops;
const delegateLegacyDefaultMaxStepsPerRun = 25;
const delegateDefaultMaxStepsPerRun = null;
const delegateStepCapsEnabled = ["1", "true", "yes", "on"].includes(
  String(process.env.CLAWDAD_ENABLE_DELEGATE_STEP_CAPS || "").trim().toLowerCase(),
);
const delegatePlanJobs = new Map();
const delegateRunJobs = new Map();
const artifactShareDefaultTtlMs = 7 * 24 * 60 * 60 * 1000;
const artifactShareMaxTtlMs = 30 * 24 * 60 * 60 * 1000;
const artifactListLimit = 200;
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
  clawdad delegate-set [project] [text] [--file <path> | --stdin] [--session <session>] [--json]
                         [--compute-reserve-percent <0-100>] [--max-steps-per-run <n|unlimited>]
  clawdad delegate-run [project] [--json]
  clawdad delegate-pause [project] [--json]
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
    Update the saved delegate brief and delegate guardrails for one tracked project.
    Delegates default to semantic runs with no step cap; --max-steps-per-run is ignored unless CLAWDAD_ENABLE_DELEGATE_STEP_CAPS=1.

  delegate-run
    Start autonomous Codex delegate mode for one tracked project.

  delegate-pause
    Ask an active delegate run to pause after the current step.

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
      case "--compute-reserve-percent":
      case "--run-id":
      case "--session":
      case "--https-port":
      case "--shortcut-path":
      case "--label":
      case "--max-steps-per-run":
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

function parseNonNegativeMs(value, fallback = 0) {
  const text = String(value ?? "").trim();
  if (!text) {
    return fallback;
  }
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
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

function normalizeOptionalPositiveInteger(value, { max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value == null || value === "" || value === false) {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || ["none", "null", "unlimited", "indefinite", "forever"].includes(normalized)) {
    return null;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.min(max, parsed);
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
    case ".pdf":
      return "application/pdf";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".csv":
      return "text/csv; charset=utf-8";
    case ".zip":
      return "application/zip";
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
    localOnly: false,
  };
}

function sessionSummaryFromStateSession(projectPath, sessionId, sessionState = {}, activeSessionId = "") {
  const provider = pickString(sessionState.provider, "codex").toLowerCase();

  return {
    slug: pickString(sessionState.slug, basenameOrFallback(projectPath)),
    path: projectPath,
    provider,
    sessionId: sessionId || null,
    active: Boolean(sessionId && sessionId === activeSessionId),
    status: pickString(sessionState.status, "idle"),
    dispatchCount: Number.parseInt(sessionState.dispatch_count || "0", 10) || 0,
    lastDispatch: pickString(sessionState.last_dispatch) || null,
    lastResponse: pickString(sessionState.last_response) || null,
    providerSessionSeeded: pickString(sessionState.provider_session_seeded, "true") === "true",
    localOnly: pickString(sessionState.local_only) === "true",
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
  const tabSessionIds = new Set(
    dispatchableTabs
      .map((tab) => String(tab?.resumeSessionId || "").trim())
      .filter(Boolean),
  );
  const stateSessionEntries = Object.entries(
    stateEntry && typeof stateEntry === "object" && stateEntry.sessions
      ? stateEntry.sessions
      : {},
  ).filter(([sessionId, sessionState]) => {
    const provider = pickString(sessionState?.provider, "codex").toLowerCase();
    return (
      pickString(sessionId) &&
      !tabSessionIds.has(sessionId) &&
      (provider === "codex" || provider === "chimera")
    );
  });
  const localSessionTabs = stateSessionEntries.map(([sessionId, sessionState]) => ({
    title: pickString(sessionState?.slug, basenameOrFallback(projectPath)),
    path: projectPath,
    resumeTool: pickString(sessionState?.provider, "codex"),
    resumeSessionId: sessionId,
  }));
  const activeSessionId = chooseActiveSessionId(
    projectPath,
    [...dispatchableTabs, ...localSessionTabs],
    stateEntry,
  );
  const sessions = dispatchableTabs.map((tab) =>
    sessionSummaryFromTab(tab, stateEntry, activeSessionId),
  ).concat(
    stateSessionEntries.map(([sessionId, sessionState]) =>
      sessionSummaryFromStateSession(projectPath, sessionId, sessionState, activeSessionId),
    ),
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

function mailboxStateForProjectCatalog(value) {
  const state = pickString(value).toLowerCase();
  if (state === "dispatched" || state === "running") {
    return "running";
  }
  if (state === "completed" || state === "failed") {
    return state;
  }
  return "";
}

function projectSessionStatusTime(session = {}) {
  const responseTime = Date.parse(pickString(session.lastResponse));
  if (Number.isFinite(responseTime)) {
    return responseTime;
  }
  const dispatchTime = Date.parse(pickString(session.lastDispatch));
  return Number.isFinite(dispatchTime) ? dispatchTime : 0;
}

function latestProjectSessionStatus(projectStatus = "idle", sessions = []) {
  const ranked = [...(Array.isArray(sessions) ? sessions : [])]
    .filter((session) => pickString(session.status))
    .sort((left, right) => projectSessionStatusTime(right) - projectSessionStatusTime(left));
  return pickString(ranked[0]?.status, projectStatus, "idle");
}

function projectSummaryWithMailboxStatus(project, mailboxStatus = {}) {
  const mailboxState = mailboxStateForProjectCatalog(mailboxStatus?.state);
  const sessionId = pickString(mailboxStatus?.session_id, mailboxStatus?.sessionId);
  if (!project || !mailboxState || !sessionId || !Array.isArray(project.sessions)) {
    return project;
  }

  const dispatchedAt = pickString(mailboxStatus?.dispatched_at, mailboxStatus?.dispatchedAt);
  const completedAt = pickString(mailboxStatus?.completed_at, mailboxStatus?.completedAt);
  const isTerminal = mailboxState === "completed" || mailboxState === "failed";
  let matched = false;
  const sessions = project.sessions.map((session) => {
    if (pickString(session.sessionId) !== sessionId) {
      return session;
    }
    matched = true;
    return {
      ...session,
      status: mailboxState,
      lastDispatch: dispatchedAt || session.lastDispatch || null,
      lastResponse: isTerminal ? completedAt || session.lastResponse || null : session.lastResponse || null,
    };
  });

  if (!matched) {
    return project;
  }

  const activeSession =
    sessions.find((session) => session.sessionId === project.activeSessionId) ||
    sessions.find((session) => session.active) ||
    project.activeSession ||
    null;
  const latestSession = [...sessions].sort(
    (left, right) => projectSessionStatusTime(right) - projectSessionStatusTime(left),
  )[0] || null;

  return {
    ...project,
    activeSession,
    sessions,
    status: latestProjectSessionStatus(project.status, sessions),
    lastDispatch: latestSession?.lastDispatch || project.lastDispatch || null,
    lastResponse: latestSession?.lastResponse || project.lastResponse || null,
  };
}

function projectHasStateSessions(projectPath, stateEntry = {}) {
  if (!pickString(projectPath) || !stateEntry || typeof stateEntry !== "object") {
    return false;
  }

  const sessions = stateEntry.sessions && typeof stateEntry.sessions === "object"
    ? stateEntry.sessions
    : {};
  return Object.entries(sessions).some(([sessionId, sessionState]) => {
    const provider = pickString(sessionState?.provider, "codex").toLowerCase();
    return pickString(sessionId) && activeProviders.has(provider);
  });
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

function safeRepairTimestampSuffix(date = new Date()) {
  return date.toISOString().replace(/[^0-9A-Za-z]/gu, "");
}

function extractMalformedJsonStringField(raw, fieldName) {
  const escapedField = String(fieldName).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = String(raw || "").match(new RegExp(`"${escapedField}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`, "u"));
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch (_error) {
    return match[1];
  }
}

function extractMalformedJsonNumberField(raw, fieldName) {
  const escapedField = String(fieldName).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = String(raw || "").match(new RegExp(`"${escapedField}"\\s*:\\s*(-?\\d+)`, "u"));
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMailboxTimestampMs(...values) {
  const parsed = Date.parse(pickString(...values));
  return Number.isFinite(parsed) ? parsed : null;
}

function mailboxInactiveAgeMs(status = {}) {
  const heartbeatAtMs = parseMailboxTimestampMs(
    status.heartbeat_at,
    status.heartbeatAt,
    status.updated_at,
    status.updatedAt,
  );
  if (heartbeatAtMs != null) {
    return Math.max(0, Date.now() - heartbeatAtMs);
  }

  const pid = Number.parseInt(String(status.pid || "0"), 10);
  if (pid > 0 && processIsLive(pid)) {
    return null;
  }

  const dispatchedAtMs = parseMailboxTimestampMs(status.dispatched_at, status.dispatchedAt);
  if (dispatchedAtMs == null) {
    return null;
  }
  return Math.max(0, Date.now() - dispatchedAtMs);
}

function staleMailboxStatusReason(status = {}) {
  const state = pickString(status.state).toLowerCase();
  if (state !== "running" && state !== "dispatched") {
    return "";
  }

  const pid = Number.parseInt(String(status.pid || "0"), 10);
  if (pid > 0 && !processIsLive(pid)) {
    return `Dispatch worker ${pid} is no longer running.`;
  }

  const ageMs = mailboxInactiveAgeMs(status);
  if (
    staleDispatchTimeoutMs > 0 &&
    ageMs != null &&
    ageMs >= staleDispatchTimeoutMs
  ) {
    const ageMinutes = Math.max(1, Math.round(ageMs / 60_000));
    const limitMinutes = Math.max(1, Math.round(staleDispatchTimeoutMs / 60_000));
    return `Dispatch has had no heartbeat for about ${ageMinutes} minutes, beyond the ${limitMinutes} minute safety limit.`;
  }

  return "";
}

function terminateMailboxWorker(status = {}) {
  const pid = Number.parseInt(String(status.pid || "0"), 10);
  if (!Number.isFinite(pid) || pid <= 0 || !processIsLive(pid)) {
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (_error) {
    // The status repair below is enough to unblock the app if termination fails.
  }
}

function mailboxResponseMarkdown({ requestId, sessionId, exitCode, completedAt, content }) {
  return [
    `# Response: ${requestId || "unknown"}`,
    "",
    `Completed: ${completedAt}`,
    `Session: ${sessionId || ""}`,
    `Exit code: ${exitCode}`,
    "",
    "---",
    "",
    content || "",
  ].join("\n");
}

async function updateStateForFailedMailbox(projectPath, sessionId, completedAt) {
  await withStateLock(async () => {
    let statePayload = {};
    try {
      statePayload = (await readOptionalJson(stateFilePath)) || {};
    } catch (_error) {
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
    const existingSession =
      sessionId && existingSessions[sessionId] && typeof existingSessions[sessionId] === "object"
        ? existingSessions[sessionId]
        : {};

    const nextProject = {
      ...existingProject,
      status: "failed",
      last_response: completedAt,
      dispatch_count: (Number.parseInt(String(existingProject.dispatch_count || "0"), 10) || 0) + 1,
      sessions: existingSessions,
    };

    if (sessionId) {
      nextProject.sessions = {
        ...existingSessions,
        [sessionId]: {
          ...existingSession,
          status: "failed",
          last_response: completedAt,
          dispatch_count: (Number.parseInt(String(existingSession.dispatch_count || "0"), 10) || 0) + 1,
        },
      };
    }

    statePayload.projects[projectPath] = nextProject;
    await writeJsonFile(stateFilePath, statePayload);
  });
}

async function updateHistoryForFailedMailbox(projectPath, status, errorText, completedAt) {
  const requestId = pickString(status.request_id, status.requestId);
  if (!requestId) {
    return;
  }

  const indexFile = path.join(historyPaths(projectPath).requestsDir, `${requestId}.json`);
  const indexPayload = await readOptionalJson(indexFile).catch(() => null);
  const recordFile = pickString(indexPayload?.file);
  if (!recordFile) {
    return;
  }

  const existing = (await readOptionalJson(recordFile).catch(() => null)) || {};
  const sessionId = pickString(status.session_id, status.sessionId, existing.sessionId);
  const sentAt = pickString(existing.sentAt, indexPayload?.sentAt, status.dispatched_at, completedAt);
  const nextRecord = {
    ...existing,
    requestId,
    projectPath,
    sessionId,
    sentAt,
    answeredAt: completedAt,
    status: "failed",
    exitCode: 124,
    response: errorText,
  };

  await writeJsonFile(recordFile, nextRecord);
  await writeJsonFile(indexFile, {
    requestId,
    sessionId,
    sentAt,
    file: recordFile,
  });
}

async function repairStaleMailboxStatus(projectPath, status, reason) {
  terminateMailboxWorker(status);

  const { statusFile, responseFile } = mailboxPaths(projectPath);
  const completedAt = new Date().toISOString();
  const requestId = pickString(status.request_id, status.requestId);
  const sessionId = pickString(status.session_id, status.sessionId);
  const errorText = `Clawdad marked this dispatch failed because it went stale. ${reason}`;
  const failedStatus = {
    ...status,
    state: "failed",
    request_id: requestId || null,
    session_id: sessionId || null,
    completed_at: completedAt,
    error: errorText,
    pid: null,
  };

  await writeTextFile(responseFile, mailboxResponseMarkdown({
    requestId,
    sessionId,
    exitCode: 124,
    completedAt,
    content: errorText,
  }));
  await writeJsonFile(statusFile, failedStatus);
  await updateHistoryForFailedMailbox(projectPath, failedStatus, errorText, completedAt).catch(() => {});
  await updateStateForFailedMailbox(projectPath, sessionId, completedAt).catch(() => {});
  invalidateProjectCatalogCache();
  return failedStatus;
}

async function reconcileMailboxStatus(projectPath, status = {}) {
  const reason = staleMailboxStatusReason(status);
  if (!reason) {
    return status;
  }

  try {
    return await repairStaleMailboxStatus(projectPath, status, reason);
  } catch (error) {
    return {
      ...status,
      stale: true,
      staleError: error.message,
    };
  }
}

async function repairMalformedMailboxStatus(projectPath, statusFile, parseError) {
  let raw = "";
  try {
    raw = await readFile(statusFile, "utf8");
  } catch (_error) {
    raw = "";
  }

  const repairedAt = new Date().toISOString();
  const badStatusPath = `${statusFile}.bad.${safeRepairTimestampSuffix(new Date())}`;
  let quarantinedPath = "";
  try {
    await rename(statusFile, badStatusPath);
    quarantinedPath = badStatusPath;
  } catch (_error) {
    quarantinedPath = "";
  }

  const repairedStatus = {
    state: "failed",
    request_id: extractMalformedJsonStringField(raw, "request_id"),
    session_id: extractMalformedJsonStringField(raw, "session_id"),
    dispatched_at: extractMalformedJsonStringField(raw, "dispatched_at"),
    completed_at: repairedAt,
    error: `Clawdad repaired malformed mailbox status: ${parseError.message}`,
    pid: extractMalformedJsonNumberField(raw, "pid"),
  };

  try {
    await writeJsonFile(statusFile, repairedStatus);
  } catch (_error) {
    // Return the in-memory repaired status even if disk repair fails, so a
    // supervisor can fail soft instead of crashing on the malformed file.
  }

  let delegateRunId = null;
  try {
    const delegateStatus = (await readOptionalJson(delegatePaths(projectPath).statusFile)) || {};
    delegateRunId = delegateStatus.runId || delegateStatus.run_id || null;
  } catch (_error) {
    delegateRunId = null;
  }

  await appendDelegateRunEvent(projectPath, delegateRunId, "mailbox_status_repaired", {
    title: "Mailbox status repaired",
    text: quarantinedPath
      ? `Malformed mailbox status was quarantined as ${path.basename(quarantinedPath)}.`
      : "Malformed mailbox status could not be quarantined, but Clawdad wrote a repaired failed status.",
    state: "failed",
    requestId: repairedStatus.request_id,
    error: repairedStatus.error,
    payload: {
      quarantinedPath,
    },
  }).catch(() => {});

  return repairedStatus;
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

function stripClawdadHistoryHandoff(value) {
  return String(value || "")
    .replace(/\s*\[Clawdad artifact handoff:[\s\S]*?\]\s*$/u, "")
    .trim();
}

function normalizedHistoryMessageText(value) {
  return normalizedHistoryText(stripClawdadHistoryHandoff(value));
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
  const leftRequestId = pickString(left?.requestId);
  const rightRequestId = pickString(right?.requestId);
  if (
    leftRequestId &&
    rightRequestId &&
    leftRequestId !== rightRequestId &&
    !isSyntheticProviderHistoryRequestId(leftRequestId) &&
    !isSyntheticProviderHistoryRequestId(rightRequestId)
  ) {
    return false;
  }

  const leftMessage = normalizedHistoryMessageText(left?.message);
  const rightMessage = normalizedHistoryMessageText(right?.message);
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
  const pycachePrefix = path.join(projectPath, ".clawdad", "pycache");
  await mkdir(pycachePrefix, { recursive: true }).catch(() => {});
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
        env: {
          PYTHONPYCACHEPREFIX: pycachePrefix,
        },
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
    runSummariesFile: path.join(delegateDir, "delegate-run-summaries.json"),
    runsDir: path.join(delegateDir, "runs"),
  };
}

function safeDelegateRunId(runId) {
  const normalized = pickString(runId);
  if (!normalized) {
    return "";
  }
  return normalized.replace(/[^a-zA-Z0-9._-]/gu, "_");
}

function delegateRunEventsFile(projectPath, runId) {
  const safeRunId = safeDelegateRunId(runId);
  if (!safeRunId) {
    return "";
  }
  return path.join(delegatePaths(projectPath).runsDir, `${safeRunId}.jsonl`);
}

function normalizeDelegateConfig(payload = {}) {
  const rawMaxSteps = payload.maxStepsPerRun ?? payload.maxSteps ?? null;
  let maxStepsPerRun = delegateStepCapsEnabled
    ? normalizeOptionalPositiveInteger(rawMaxSteps, { max: 200 })
    : delegateDefaultMaxStepsPerRun;
  const payloadVersion = Number.parseInt(String(payload.version || "1"), 10) || 1;
  if (delegateStepCapsEnabled && payloadVersion <= 1 && maxStepsPerRun === delegateLegacyDefaultMaxStepsPerRun) {
    maxStepsPerRun = delegateDefaultMaxStepsPerRun;
  }
  const configuredHardStops =
    Array.isArray(payload.hardStops) && payload.hardStops.length > 0
      ? payload.hardStops
      : delegateDefaultHardStops;
  const hardStops = uniqueStrings(
    [...delegateRequiredHardStops, ...configuredHardStops].map((hardStop) => {
      const normalized = pickString(hardStop).toLowerCase();
      if (["auth_required", "step_limit", "unknown"].includes(normalized)) {
        return "needs_human";
      }
      return normalized;
    }),
  );

  return {
    version: 2,
    projectPath: pickString(payload.projectPath) || null,
    enabled: boolFromUnknown(payload.enabled, false),
    delegateSessionId: pickString(payload.delegateSessionId) || null,
    delegateSessionSlug: pickString(payload.delegateSessionSlug, delegateDefaultSessionSlug),
    hardStops: hardStops.length > 0 ? hardStops : [...delegateDefaultHardStops],
    maxStepsPerRun,
    computeGuardEnabled: boolFromUnknown(payload.computeGuardEnabled, true),
    computeReservePercent: normalizePercent(payload.computeReservePercent, delegateDefaultComputeReservePercent),
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
- Anything that needs another human or an account/credential decision
- Weekly Codex compute dropping to the saved reserve threshold

# Autonomy Stop Policy
- No arbitrary step or run-count cap by default
- Continue until the objective is semantically complete
- Stop only when blocked by a hard stop, compute reserve, or an explicit user pause

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
  const stepValue = Number.parseInt(String(payload.stepCount ?? ""), 10);
  return {
    id: pickString(payload.id) || crypto.randomUUID(),
    projectPath: pickString(payload.projectPath) || null,
    runId: pickString(payload.runId) || null,
    createdAt: pickString(payload.createdAt) || null,
    provider: pickString(payload.provider, "codex"),
    sessionId: pickString(payload.sessionId) || null,
    sessionLabel: pickString(payload.sessionLabel) || null,
    stepCount: Number.isFinite(stepValue) && stepValue >= 0 ? stepValue : null,
    sourceEntryCount: Number.parseInt(String(payload.sourceEntryCount || "0"), 10) || 0,
    summarySnapshotAt: pickString(payload.summarySnapshotAt) || null,
    statusSummary: trimTrailingNewlines(String(payload.statusSummary || "")) || null,
    nextAction: trimTrailingNewlines(String(payload.nextAction || "")) || null,
    refreshReason: pickString(payload.refreshReason) || null,
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

function delegatePercentText(value) {
  const numeric = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(numeric)) {
    return "";
  }

  const rounded = Math.round(numeric * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(/\.0$/u, "");
}

function delegateComputeBudgetLogText(budget) {
  const normalized = normalizeDelegateComputeBudget(budget);
  if (!normalized || normalized.status !== "observed") {
    return "";
  }
  if (normalized.unlimited) {
    return "Compute appears unlimited right now, so no weekly reserve pressure is visible.";
  }

  const used = delegatePercentText(normalized.usedPercent);
  const remaining = delegatePercentText(normalized.remainingPercent);
  if (!used || !remaining) {
    return "";
  }

  const reserve = delegatePercentText(normalized.reservePercent);
  const reservePhrase = reserve
    ? Number.isFinite(normalized.remainingPercent) &&
      Number.isFinite(normalized.reservePercent) &&
      normalized.remainingPercent <= normalized.reservePercent
      ? `, with the ${reserve}% reserve now reached.`
      : `, with the ${reserve}% reserve still protected.`
    : ".";
  return `Compute is at ${used}% used, ${remaining}% remaining${reservePhrase}`;
}

function delegateComputeUsedBucket(budget) {
  const normalized = normalizeDelegateComputeBudget(budget);
  if (!normalized || normalized.status !== "observed" || normalized.unlimited) {
    return null;
  }
  const used = Number.parseFloat(String(normalized.usedPercent ?? ""));
  if (!Number.isFinite(used)) {
    return null;
  }
  return Math.max(0, Math.floor(used / 5));
}

function normalizeDelegateRunEvent(payload = {}) {
  const payloadObject =
    payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
      ? payload.payload
      : {};
  const stepValue = Number.parseInt(String(payload.step ?? payload.stepCount ?? ""), 10);
  return {
    id: pickString(payload.id) || crypto.randomUUID(),
    at: pickString(payload.at, payload.createdAt) || new Date().toISOString(),
    type: pickString(payload.type, "event"),
    runId: pickString(payload.runId) || null,
    step: Number.isFinite(stepValue) && stepValue > 0 ? stepValue : null,
    requestId: pickString(payload.requestId, payload.request_id) || null,
    title: pickString(payload.title) || null,
    text: trimTrailingNewlines(String(payload.text || "")) || null,
    summary: trimTrailingNewlines(String(payload.summary || "")) || null,
    nextAction: trimTrailingNewlines(String(payload.nextAction || payload.next_action || "")) || null,
    state: pickString(payload.state) || null,
    stopReason: pickString(payload.stopReason, payload.stop_reason) || null,
    error: trimTrailingNewlines(String(payload.error || "")) || null,
    checkpoint: normalizeDelegateCheckpoint(payload.checkpoint || payload.step_checkpoint) || null,
    computeBudget: normalizeDelegateComputeBudget(payload.computeBudget) || null,
    payload: payloadObject,
  };
}

async function appendDelegateRunEvent(projectPath, runId, type, payload = {}) {
  const safeRunId = safeDelegateRunId(runId);
  if (!projectPath || !safeRunId) {
    return null;
  }

  const event = normalizeDelegateRunEvent({
    ...payload,
    type,
    runId,
  });
  const eventsFile = delegateRunEventsFile(projectPath, safeRunId);
  await mkdir(path.dirname(eventsFile), { recursive: true });
  await appendFile(eventsFile, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

async function readDelegateRunEvents(projectPath, { runId = "", cursor = 0, limit = delegateRunEventPageLimit } = {}) {
  const safeRunId = safeDelegateRunId(runId);
  if (!projectPath || !safeRunId) {
    return {
      runId: safeRunId || "",
      events: [],
      nextCursor: "0",
      total: 0,
    };
  }

  const eventsFile = delegateRunEventsFile(projectPath, safeRunId);
  const raw = await readOptionalText(eventsFile);
  const lines = raw.split(/\r?\n/u).filter((line) => line.trim());
  const pageLimit = Math.min(500, Math.max(1, Number.parseInt(String(limit || delegateRunEventPageLimit), 10) || delegateRunEventPageLimit));
  const cursorText = String(cursor || "0").trim().toLowerCase();
  const start = cursorText === "tail"
    ? Math.max(0, lines.length - pageLimit)
    : Math.max(0, Number.parseInt(String(cursor || "0"), 10) || 0);
  const pageLines = lines.slice(start, start + pageLimit);
  const events = [];

  for (const line of pageLines) {
    try {
      events.push(normalizeDelegateRunEvent(JSON.parse(line)));
    } catch (_error) {
      // Keep malformed legacy/debug lines from breaking the whole feed.
    }
  }

  const end = Math.min(lines.length, start + pageLines.length);
  return {
    runId: safeRunId,
    events,
    nextCursor: String(end),
    total: lines.length,
  };
}

function delegateStatusRunEvent(status, runId, events = []) {
  const state = pickString(status?.state).toLowerCase();
  const statusRunId = safeDelegateRunId(status?.runId);
  const safeRunId = safeDelegateRunId(runId);
  if (!statusRunId || statusRunId !== safeRunId) {
    return null;
  }
  if (!["blocked", "completed", "failed", "paused"].includes(state) && !status?.error) {
    return null;
  }

  const statusError = trimTrailingNewlines(String(status?.error || "")) || null;
  const statusStopReason = pickString(status?.stopReason) || null;
  const duplicate = (Array.isArray(events) ? events : []).some((event) => {
    const eventState = pickString(event?.state).toLowerCase();
    return (
      eventState === state &&
      (!statusError || trimTrailingNewlines(String(event?.error || "")) === statusError)
    );
  });
  if (duplicate) {
    return null;
  }

  const titleByState = {
    blocked: "Delegate blocked",
    completed: "Delegate completed",
    failed: "Delegate failed",
    paused: "Delegate paused",
  };
  const text =
    statusError ||
    trimTrailingNewlines(String(status?.lastOutcomeSummary || "")) ||
    trimTrailingNewlines(String(status?.nextAction || "")) ||
    statusStopReason ||
    null;

  return normalizeDelegateRunEvent({
    id: `status-${safeRunId}-${state}`,
    at: pickString(status?.completedAt, status?.updatedAt, status?.startedAt) || new Date().toISOString(),
    type: state === "failed" ? "run_failed" : `run_${state}`,
    runId: safeRunId,
    title: titleByState[state] || "Delegate status",
    text,
    state,
    stopReason: statusStopReason,
    error: statusError,
    computeBudget: status?.computeBudget || null,
  });
}

async function readDelegateRunList(projectPath, { status = null, summarySnapshots = null } = {}) {
  const runsById = new Map();
  const summaries = Array.isArray(summarySnapshots)
    ? summarySnapshots
    : await readDelegateRunSummarySnapshots(projectPath);

  function upsertRun(runId, patch) {
    const safeRunId = safeDelegateRunId(runId);
    if (!safeRunId) {
      return;
    }
    runsById.set(safeRunId, {
      runId: safeRunId,
      state: "",
      startedAt: null,
      updatedAt: null,
      completedAt: null,
      eventCount: 0,
      summary: "",
      error: "",
      lastTitle: "",
      lastEventAt: null,
      ...runsById.get(safeRunId),
      ...patch,
    });
  }

  if (status?.runId) {
    upsertRun(status.runId, {
      state: status.state || "",
      startedAt: status.startedAt || null,
      updatedAt: status.updatedAt || null,
      completedAt: status.completedAt || null,
      summary: status.lastOutcomeSummary || status.nextAction || "",
      error: status.error || "",
    });
  }

  for (const snapshot of summaries) {
    if (!snapshot.runId) {
      continue;
    }
    upsertRun(snapshot.runId, {
      eventCount: snapshot.sourceEventCount || 0,
      summary: snapshot.summary || "",
      updatedAt: snapshot.createdAt || null,
    });
  }

  let runFiles = [];
  try {
    runFiles = await readdir(delegatePaths(projectPath).runsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  for (const entry of runFiles) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }
    const runId = entry.name.replace(/\.jsonl$/u, "");
    const raw = await readOptionalText(path.join(delegatePaths(projectPath).runsDir, entry.name));
    const lines = raw.split(/\r?\n/u).filter((line) => line.trim());
    let firstEvent = null;
    let lastEvent = null;

    for (const line of lines) {
      try {
        firstEvent = normalizeDelegateRunEvent(JSON.parse(line));
        break;
      } catch (_error) {
        // Ignore malformed legacy/debug lines.
      }
    }

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        lastEvent = normalizeDelegateRunEvent(JSON.parse(lines[index]));
        break;
      } catch (_error) {
        // Ignore malformed legacy/debug lines.
      }
    }

    const existingRun = runsById.get(safeDelegateRunId(runId)) || {};
    const statusMatchesRun = safeDelegateRunId(status?.runId) === safeDelegateRunId(runId);
    upsertRun(runId, {
      startedAt: firstEvent?.at || existingRun.startedAt || null,
      updatedAt: lastEvent?.at || existingRun.updatedAt || null,
      eventCount: lines.length,
      lastTitle: lastEvent?.title || "",
      summary: lastEvent?.summary || existingRun.summary || lastEvent?.text || "",
      error: lastEvent?.error || existingRun.error || "",
      state: delegateRunListState({
        existingState: existingRun.state,
        eventState: lastEvent?.state,
        statusMatchesRun,
      }),
      lastEventAt: lastEvent?.at || null,
    });
  }

  return [...runsById.values()]
    .sort((left, right) => {
      const leftTime = Date.parse(left.completedAt || left.updatedAt || left.lastEventAt || left.startedAt || "");
      const rightTime = Date.parse(right.completedAt || right.updatedAt || right.lastEventAt || right.startedAt || "");
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    })
    .slice(0, 50);
}

function normalizeDelegateRunSummarySnapshot(payload = {}) {
  return {
    id: pickString(payload.id) || crypto.randomUUID(),
    projectPath: pickString(payload.projectPath) || null,
    runId: pickString(payload.runId) || null,
    createdAt: pickString(payload.createdAt) || null,
    provider: pickString(payload.provider, "codex"),
    sourceEventCount: Number.parseInt(String(payload.sourceEventCount || "0"), 10) || 0,
    summary: trimTrailingNewlines(String(payload.summary || "")),
  };
}

function delegateRunSummaryTimestampMs(snapshot) {
  const parsed = Date.parse(pickString(snapshot?.createdAt));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function readDelegateRunSummarySnapshots(projectPath) {
  const payload = (await readOptionalJson(delegatePaths(projectPath).runSummariesFile)) || {};
  const snapshots = Array.isArray(payload.snapshots) ? payload.snapshots : [];
  return snapshots
    .map(normalizeDelegateRunSummarySnapshot)
    .filter((snapshot) => snapshot.summary)
    .sort((left, right) => delegateRunSummaryTimestampMs(right) - delegateRunSummaryTimestampMs(left));
}

async function writeDelegateRunSummarySnapshots(projectPath, snapshots) {
  const normalizedSnapshots = (Array.isArray(snapshots) ? snapshots : [])
    .map(normalizeDelegateRunSummarySnapshot)
    .filter((snapshot) => snapshot.summary)
    .sort((left, right) => delegateRunSummaryTimestampMs(right) - delegateRunSummaryTimestampMs(left))
    .slice(0, delegateRunSummarySnapshotLimit);

  await writeJsonFile(delegatePaths(projectPath).runSummariesFile, {
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
  const maxSteps = normalizeOptionalPositiveInteger(payload.maxSteps ?? payload.maxStepsPerRun ?? null, { max: 200 });

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
    activeRequestId: pickString(payload.activeRequestId, payload.active_request_id) || null,
    lastRequestId: pickString(payload.lastRequestId, payload.last_request_id) || null,
    supervisorPid: Number.parseInt(String(payload.supervisorPid || payload.supervisor_pid || "0"), 10) || null,
    supervisorStartedAt: pickString(payload.supervisorStartedAt, payload.supervisor_started_at) || null,
    stepCount,
    maxSteps,
    computeBudget: normalizeDelegateComputeBudget(payload.computeBudget),
    lastOutcomeSummary: trimTrailingNewlines(String(payload.lastOutcomeSummary || "")) || null,
    nextAction: trimTrailingNewlines(String(payload.nextAction || "")) || null,
    stopReason: pickString(payload.stopReason) || null,
    pauseRequested: boolFromUnknown(payload.pauseRequested, false),
    error: trimTrailingNewlines(String(payload.error || "")) || null,
  };
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

function delegateSupervisorIsLive(status = {}) {
  return processIsLive(status.supervisorPid);
}

function delegateStatusNeedsSupervisor(status = {}, config = {}) {
  const state = String(status?.state || "").trim().toLowerCase();
  return (
    state === "running" &&
    boolFromUnknown(config?.enabled, false) &&
    !delegateSupervisorIsLive(status)
  );
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
    } else if (
      status.state === "running" &&
      !delegateRunJobs.has(projectPath) &&
      !delegateSupervisorIsLive(status)
    ) {
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

async function evaluateDelegateComputeGuard(config) {
  const budget = await readLatestCodexComputeBudget(config, { codexHome: defaultCodexHome });
  return {
    budget,
    blocked: delegateComputeBudgetIsBelowReserve(budget),
    message: describeDelegateComputeBudget(budget),
  };
}

async function setDelegateComputeBlocked(projectPath, config, status, message, computeBudget = null) {
  const nextConfig = await writeDelegateConfig(projectPath, {
    ...config,
    enabled: false,
  });
  const nextStatus = await writeDelegateStatus(projectPath, {
    ...status,
    state: "blocked",
    pauseRequested: false,
    completedAt: new Date().toISOString(),
    stopReason: "compute_limit",
    computeBudget,
    error: message,
  });
  await appendDelegateRunEvent(projectPath, nextStatus.runId, "run_blocked", {
    title: "Paused near compute reserve",
    text: delegateComputeBudgetLogText(computeBudget) || message,
    state: nextStatus.state,
    stopReason: "compute_limit",
    computeBudget,
  }).catch(() => {});
  return {
    config: nextConfig,
    status: nextStatus,
  };
}

async function refreshProjectDetails(projectPath) {
  invalidateProjectCatalogCache();
  const projects = await loadProjectCatalogCached();
  return projects.find((entry) => entry.path === projectPath) || null;
}

function resolveDelegateSessionFromProject(projectDetails, config) {
  const sessions = Array.isArray(projectDetails?.sessions) ? projectDetails.sessions : [];
  const activeSessionId = pickString(projectDetails?.activeSessionId, projectDetails?.sessionId);
  return chooseDelegateSession({
    sessions,
    config,
    activeSessionId,
    defaultSlug: delegateSessionSlugForProject(projectDetails),
  }).session;
}

function delegateSessionSlugForProject(projectDetails) {
  const projectLabel = pickString(
    projectDetails?.displayName,
    projectDetails?.slug,
    projectDetails?.path ? basenameOrFallback(projectDetails.path) : "",
    "Project",
  );
  return `${projectLabel} Delegate`;
}

function reusableNonActiveCodexSession(projectDetails) {
  const sessions = Array.isArray(projectDetails?.sessions) ? projectDetails.sessions : [];
  const activeSessionId = pickString(projectDetails?.activeSessionId, projectDetails?.sessionId);
  const candidates = sessions.filter(
    (session) =>
      String(session?.provider || "").trim().toLowerCase() === "codex" &&
      pickString(session?.sessionId) &&
      (!activeSessionId || pickString(session.sessionId) !== activeSessionId),
  );

  return (
    candidates.find((session) => /delegate/iu.test(pickString(session?.slug))) ||
    candidates.find((session) => pickString(session?.status).toLowerCase() !== "running") ||
    candidates[0] ||
    null
  );
}

async function ensureDelegateSession(projectDetails, config) {
  if (!projectDetails?.path) {
    throw new Error("project is not tracked");
  }

  const projectDelegateSlug = delegateSessionSlugForProject(projectDetails);
  const configuredSlug = pickString(config.delegateSessionSlug, delegateDefaultSessionSlug);
  const selection = chooseDelegateSession({
    sessions: projectDetails.sessions,
    config,
    activeSessionId: pickString(projectDetails.activeSessionId, projectDetails.sessionId),
    defaultSlug: projectDelegateSlug,
  });
  const shouldUseProjectDelegateSlug =
    selection.resetToDefault ||
    (!selection.session?.sessionId && configuredSlug === delegateDefaultSessionSlug);
  const configForSession = shouldUseProjectDelegateSlug
    ? {
        ...config,
        delegateSessionId: null,
        delegateSessionSlug: projectDelegateSlug,
      }
    : config;
  const existingSession = selection.session;
  if (existingSession?.sessionId) {
    const nextConfig =
      configForSession.delegateSessionId === existingSession.sessionId &&
      configForSession.delegateSessionSlug === pickString(existingSession.slug, configForSession.delegateSessionSlug)
        ? configForSession
        : await writeDelegateConfig(projectDetails.path, {
            ...configForSession,
            delegateSessionId: existingSession.sessionId,
            delegateSessionSlug: pickString(existingSession.slug, configForSession.delegateSessionSlug),
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
  const slug = pickString(configForSession.delegateSessionSlug, delegateDefaultSessionSlug);
  const result = await runClawdad([
    "add-session",
    projectDetails.path,
    "--provider",
    "codex",
    "--slug",
    slug,
  ]);
  if (!result.ok) {
    const fallbackSession = reusableNonActiveCodexSession(projectDetails);
    if (fallbackSession?.sessionId) {
      const nextConfig = await writeDelegateConfig(projectDetails.path, {
        ...configForSession,
        delegateSessionId: fallbackSession.sessionId,
        delegateSessionSlug: pickString(fallbackSession.slug, configForSession.delegateSessionSlug),
      });
      return {
        projectDetails,
        config: nextConfig,
        session: fallbackSession,
        created: false,
        reusedExisting: true,
      };
    }
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
    ) || resolveDelegateSessionFromProject(refreshedProject, { ...configForSession, delegateSessionSlug: slug });

  if (!createdSession?.sessionId) {
    throw new Error("delegate session was created but could not be resolved");
  }

  const nextConfig = await writeDelegateConfig(projectDetails.path, {
    ...configForSession,
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

  return ensureDelegateSession(refreshedProject, config);
}

function buildDelegatePlanPrompt(
  project,
  brief,
  sourceEntries,
  latestSummary = null,
  previousPlan = null,
  { status = null, runEvents = [], phaseHandoffAnalysis = null, refreshReason = "" } = {},
) {
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
  const statusBlock = status
    ? `Current delegate status:
- State: ${pickString(status.state, "unknown")}
- Step count: ${Number.parseInt(String(status.stepCount || "0"), 10) || 0}
- Last outcome: ${pickString(status.lastOutcomeSummary) || "none"}
- Current next action: ${pickString(status.nextAction) || "none"}
- Compute: ${delegateComputeBudgetLogText(status.computeBudget) || describeDelegateComputeBudget(status.computeBudget) || "unknown"}
- Refresh reason: ${pickString(refreshReason) || "manual_or_initial"}`
    : "Current delegate status: none";
  const runEventText = (Array.isArray(runEvents) ? runEvents : [])
    .slice(-delegatePlanRunEventLimit)
    .map(delegateRunEventSummaryLine)
    .join("\n\n");
  const runEventsBlock = runEventText
    ? `Recent delegate run events, oldest first:\n${runEventText}`
    : "Recent delegate run events: none";
  const handoffBlock = buildDelegatePhaseHandoffBlock(phaseHandoffAnalysis);

  return `You are preparing the standing execution plan for an autonomous Codex delegate.

Project: ${project.displayName || project.slug || basenameOrFallback(project.path)}
Directory: ${project.path}

Delegate brief:
${brief}

${summaryBlock}

${previousPlanBlock}

${statusBlock}

${runEventsBlock}

Recent project history across tracked sessions (oldest first):
${sourceText}

${handoffBlock ? `${handoffBlock}\n` : ""}

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
- Treat current delegate status and recent run events as the freshest source of truth when they conflict with an older brief or previous plan.
- Refresh the Current Objective and Next Steps to match the latest concrete edge; do not preserve stale objective text just because it appears in the brief.
- Keep it concrete and execution-ready.
- Treat only paid services, another human/account/external decision, and exhausted or low-reserve compute as hard stops.
- Mention uncertainty plainly.
- Keep it under 260 words.
- Do not add any introduction or closing beyond those sections.`;
}

async function runCodexDelegatePlan(projectPath, prompt) {
  const outputFile = path.join(os.tmpdir(), `clawdad-delegate-plan-${crypto.randomUUID()}.md`);
  const pycachePrefix = path.join(projectPath, ".clawdad", "pycache");
  await mkdir(pycachePrefix, { recursive: true }).catch(() => {});
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
        env: {
          PYTHONPYCACHEPREFIX: pycachePrefix,
        },
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

function delegateRunEventSummaryLine(event) {
  const timestamp = pickString(event?.at) || "unknown time";
  const type = pickString(event?.type, "event");
  const step = event?.step ? ` step ${event.step}` : "";
  const request = event?.requestId ? ` request ${event.requestId}` : "";
  const title = pickString(event?.title) || type.replace(/_/gu, " ");
  const details = [
    pickString(event?.summary),
    pickString(event?.nextAction) ? `Next: ${event.nextAction}` : "",
    pickString(event?.text),
    pickString(event?.text) ? "" : delegateComputeBudgetLogText(event?.computeBudget),
    pickString(event?.error) ? `Error: ${event.error}` : "",
  ].filter(Boolean);

  return `[${timestamp}] ${title}${step}${request}${details.length > 0 ? `\n${truncateSummarySourceText(details.join(" "), 1000)}` : ""}`;
}

function buildDelegateRunSummaryPrompt(project, runId, events, previousSnapshot = null) {
  const orderedEvents = [...events]
    .sort((left, right) => {
      const leftMs = Date.parse(pickString(left?.at));
      const rightMs = Date.parse(pickString(right?.at));
      return (Number.isFinite(leftMs) ? leftMs : 0) - (Number.isFinite(rightMs) ? rightMs : 0);
    })
    .slice(-delegateRunSummaryEventLimit);
  const eventText = orderedEvents.map(delegateRunEventSummaryLine).join("\n\n");
  const previousBlock = previousSnapshot?.summary
    ? `Previous saved delegate run summary (${previousSnapshot.createdAt || "unknown time"}):\n${previousSnapshot.summary}`
    : "Previous saved delegate run summary: none";
  const latestComputeText =
    [...orderedEvents]
      .reverse()
      .map((event) => delegateComputeBudgetLogText(event?.computeBudget))
      .find(Boolean) || "No compute telemetry captured yet.";

  return `You are summarizing an autonomous Codex delegate run for a mobile project dashboard.

Project: ${project.displayName || project.slug || basenameOrFallback(project.path)}
Directory: ${project.path}
Run id: ${runId}

${previousBlock}

Latest compute telemetry:
${latestComputeText}

Recent run events, oldest first:
${eventText || "No run events captured yet."}

Write a concise markdown summary with exactly these sections:
**Status**
1-2 sentences.

**Recent Progress**
- Bullet list.

**Evidence**
- Bullet list of files, checks, requests, or artifacts mentioned.

**Current Edge**
- One short bullet.

**Next Move**
- One short bullet.

**Needs Human**
- "No" or one exact blocker.

Rules:
- Use only the provided run events.
- Include the latest compute telemetry in **Status** when it is available.
- Do not expose hidden chain-of-thought or invent private reasoning.
- Prefer concrete project state over generic narration.
- Mention uncertainty plainly.
- Keep it under 240 words.
- Do not add any introduction or closing beyond those sections.`;
}

async function runCodexDelegateRunSummary(projectPath, prompt) {
  const outputFile = path.join(os.tmpdir(), `clawdad-delegate-run-summary-${crypto.randomUUID()}.md`);
  const pycachePrefix = path.join(projectPath, ".clawdad", "pycache");
  await mkdir(pycachePrefix, { recursive: true }).catch(() => {});
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
        env: {
          PYTHONPYCACHEPREFIX: pycachePrefix,
        },
      },
    );

    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || `codex exited with ${result.exitCode}`);
    }

    try {
      const summaryText = trimTrailingNewlines(await readFile(outputFile, "utf8"));
      if (summaryText) {
        return summaryText;
      }
    } catch (_error) {
      // Fall back to stdout.
    }

    return trimTrailingNewlines(result.stdout);
  } finally {
    await rm(outputFile, { force: true }).catch(() => {});
  }
}

async function generateDelegateRunSummarySnapshot(project, runId) {
  const page = await readDelegateRunEvents(project.path, {
    runId,
    cursor: 0,
    limit: 5000,
  });
  const events = Array.isArray(page.events) ? page.events : [];
  if (events.length === 0) {
    throw new Error("No delegate run events have been captured yet.");
  }

  const existingSnapshots = await readDelegateRunSummarySnapshots(project.path);
  const previousSnapshot =
    existingSnapshots.find((snapshot) => snapshot.runId === runId) ||
    existingSnapshots[0] ||
    null;
  const prompt = buildDelegateRunSummaryPrompt(project, runId, events, previousSnapshot);
  const summaryText = await runCodexDelegateRunSummary(project.path, prompt);
  if (!trimTrailingNewlines(summaryText)) {
    throw new Error("delegate run summary returned an empty response");
  }

  const snapshot = normalizeDelegateRunSummarySnapshot({
    id: crypto.randomUUID(),
    projectPath: project.path,
    runId,
    createdAt: new Date().toISOString(),
    provider: "codex",
    sourceEventCount: events.length,
    summary: summaryText,
  });
  const snapshots = await writeDelegateRunSummarySnapshots(project.path, [snapshot, ...existingSnapshots]);
  return {
    snapshot,
    snapshots,
    events,
  };
}

async function generateDelegatePlanSnapshot(project, config, delegateSession = null, context = {}) {
  const [brief, latestSummarySnapshots, existingPlans, sourceEntries] = await Promise.all([
    readDelegateBrief(project.path, project),
    readProjectSummarySnapshots(project.path),
    readDelegatePlanSnapshots(project.path),
    loadProjectSummarySourceEntries(project),
  ]);
  const latestSummary = latestSummarySnapshots[0] || null;
  const previousPlan = existingPlans[0] || null;
  const contextStatus = context?.status || null;
  const runId = pickString(contextStatus?.runId);
  const runEvents = runId
    ? (await readDelegateRunEvents(project.path, {
        runId,
        cursor: 0,
        limit: 5000,
      }).catch(() => ({ events: [] }))).events || []
    : [];
  const prompt = buildDelegatePlanPrompt(project, brief, sourceEntries, latestSummary, previousPlan, {
    status: contextStatus,
    runEvents,
    phaseHandoffAnalysis: context?.phaseHandoffAnalysis || null,
    refreshReason: context?.refreshReason || "",
  });
  const planText = await runCodexDelegatePlan(project.path, prompt);

  if (!trimTrailingNewlines(planText)) {
    throw new Error("delegate plan generation returned an empty response");
  }

  const snapshot = normalizeDelegatePlanSnapshot({
    id: crypto.randomUUID(),
    projectPath: project.path,
    runId: runId || null,
    createdAt: new Date().toISOString(),
    provider: "codex",
    sessionId: delegateSession?.sessionId || config.delegateSessionId || null,
    sessionLabel: delegateSession ? sessionDisplayForStatus(delegateSession) : null,
    stepCount: contextStatus?.stepCount ?? null,
    sourceEntryCount: sourceEntries.length,
    summarySnapshotAt: latestSummary?.createdAt || null,
    statusSummary: contextStatus?.lastOutcomeSummary || null,
    nextAction: contextStatus?.nextAction || null,
    refreshReason: context?.refreshReason || null,
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
    return "No saved delegate-session history yet.";
  }
  return ordered.map(formatProjectSummarySourceEntry).join("\n\n");
}

function delegateSessionHistoryEntries(sourceEntries, delegateSession) {
  const delegateSessionId = pickString(delegateSession?.sessionId);
  if (!delegateSessionId) {
    return [];
  }

  return (Array.isArray(sourceEntries) ? sourceEntries : []).filter(
    (entry) => pickString(entry?.sessionId) === delegateSessionId,
  );
}

function buildDelegatePhaseHandoffBlock(analysis) {
  if (!analysis?.triggered) {
    return "";
  }

  const recentActions = (Array.isArray(analysis.recentActions) ? analysis.recentActions : [])
    .slice(-5)
    .map((action) => `- ${action}`)
    .join("\n");

  return `Phase handoff guard:
Recent delegate history shows ${analysis.repeatCount} consecutive same-shaped next actions.
${recentActions ? `Recent actions:\n${recentActions}` : ""}

Before continuing this same pattern, inspect the project's own task model for explicit phase endpoints, cutoff/finality fields, recombination or aggregate handoffs, parametric/general lemma opportunities, and "next unresolved range" language.
If this is a finite ladder, finish the named endpoint only when it is clearly the current cheapest final subatom, then set next_action to the recombination, aggregate proof, general lemma, or downstream margin phase.
Do not invent an unbounded next sibling just because the prior actions formed a pattern. If no project-owned endpoint exists, create a concise handoff note or choose the generalizing theorem/work object instead of extending the staircase.`;
}

function buildDelegateStepPrompt(
  project,
  delegateSession,
  brief,
  latestPlan,
  latestSummary,
  sourceEntries,
  status,
  phaseHandoffAnalysis = null,
) {
  const summaryBlock = latestSummary?.summary
    ? `Latest saved project summary (${latestSummary.createdAt || "unknown time"}):\n${latestSummary.summary}`
    : "Latest saved project summary: none";
  const planBlock = latestPlan?.plan
    ? `Latest saved delegate plan (${latestPlan.createdAt || "unknown time"}):\n${latestPlan.plan}`
    : "Latest saved delegate plan: none";
  const historyBlock = delegateRecentHistoryBlock(sourceEntries);
  const currentStep = (Number.parseInt(String(status?.stepCount || "0"), 10) || 0) + 1;
  const maxSteps = normalizeOptionalPositiveInteger(status?.maxSteps, { max: 200 });
  const stepLabel = maxSteps ? `${currentStep} of emergency cap ${maxSteps}` : `${currentStep} (semantic run; no step cap)`;
  const computeBudget = normalizeDelegateComputeBudget(status?.computeBudget);
  const computeLabel = computeBudget
    ? `${describeDelegateComputeBudget(computeBudget)}`
    : `Codex weekly compute reserve is ${delegateDefaultComputeReservePercent}%; Clawdad will pause if it can observe usage at or below that reserve.`;
  const handoffAnalysis =
    phaseHandoffAnalysis ||
    analyzeDelegatePhaseHandoff({
      sourceEntries,
      status,
    });
  const handoffBlock = buildDelegatePhaseHandoffBlock(handoffAnalysis);

  return `You are the standing Codex delegate for this project. Keep pushing the project forward while the user sleeps.

Project: ${project.displayName || project.slug || basenameOrFallback(project.path)}
Directory: ${project.path}
Delegate session: ${sessionDisplayForStatus(delegateSession)}
Current step: ${stepLabel}
Compute guard: ${computeLabel}
Autonomy stop policy: continue until the objective is semantically complete, the compute reserve is reached, a hard stop is required, or the user explicitly pauses the run. Do not stop because a certain number of turns elapsed.
Artifact handoff: If you create a deliverable file the user may need to download or share, save it under ${projectArtifactsDir(project.path)} using a clear filename. Create that folder if needed. Mention the saved filename in your response; Clawdad will surface files from that folder as download cards in the app.

Delegate brief:
${brief}

${summaryBlock}

${planBlock}

Recent project history across tracked sessions (oldest first):
${historyBlock}

${handoffBlock ? `${handoffBlock}\n\n` : ""}
Instructions:
- Take the single best next concrete step toward the plan.
- If the brief conflicts with the latest saved plan or recent project history, treat the latest plan/history as the active cone of vision and keep the brief as durable north-star/hard-stop context.
- You may edit files, run local tooling, and use free resources already available.
- Do not spend money.
- Do not require another human.
- If credentials, MFA, billing, account approval, or an external decision is required, stop with stop_reason "needs_human".
- If any hard stop would be required, stop instead of proceeding and prepare the packet the user needs next.
- If you encounter a Codex usage, quota, rate-limit, credit, or compute-limit error, stop with stop_reason "compute_limit".
- Use state "completed" only when the current objective is semantically done, not because a step count was reached.
- Keep your natural response concise but useful.

At the very end, include exactly one fenced JSON block with this schema:
\`\`\`json
{"state":"continue|blocked|completed","stop_reason":"none|paid|needs_human|compute_limit","next_action":"short string","summary":"short string","checkpoint":{"progress_signal":"low|medium|high|none","breakthroughs":"short string or none","blockers":"short string or none","next_probe":"short string","confidence":"low|medium|high"}}
\`\`\`

Rules for the JSON block:
- "state" must be one of continue, blocked, completed.
- "stop_reason" must be "none" unless state is blocked.
- "next_action" should be the next concrete thing to do.
- "summary" should briefly explain what changed or why you stopped.
- "checkpoint" feeds the run log step card. Use it to make the run reviewable at a glance.
- "progress_signal" should say whether this step meaningfully moved the project: high, medium, low, or none.
- "breakthroughs" should name the best discovery/evidence/change, or "none".
- "blockers" should name any actual blocker or risk, or "none".
- "next_probe" should name the next most informative probe or action.
- "confidence" should be low, medium, or high.`;
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

function normalizeDelegateCheckpoint(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const confidence = pickString(payload.confidence).toLowerCase();
  const checkpoint = {
    progressSignal: trimTrailingNewlines(String(payload.progress_signal || payload.progressSignal || "")) || null,
    breakthroughs: trimTrailingNewlines(String(payload.breakthroughs || payload.breakthrough || "")) || null,
    blockers: trimTrailingNewlines(String(payload.blockers || payload.blocker || "")) || null,
    nextProbe: trimTrailingNewlines(String(payload.next_probe || payload.nextProbe || "")) || null,
    confidence: ["low", "medium", "high"].includes(confidence) ? confidence : null,
  };
  return Object.values(checkpoint).some(Boolean) ? checkpoint : null;
}

function normalizeDelegateDecision(payload = {}) {
  const state = pickString(payload.state).toLowerCase();
  const normalizedState = ["continue", "blocked", "completed"].includes(state) ? state : "";
  const rawStopReason = pickString(payload.stop_reason, payload.stopReason, "none").toLowerCase();
  const stopReason = ["auth_required", "step_limit", "unknown"].includes(rawStopReason)
    ? "needs_human"
    : rawStopReason;
  const normalizedStopReason =
    ["none", "paid", "needs_human", "compute_limit"].includes(stopReason)
      ? stopReason
      : "needs_human";

  if (!normalizedState) {
    throw new Error("delegate response did not include a valid state");
  }

  return {
    state: normalizedState,
    stopReason: normalizedState === "blocked" ? normalizedStopReason : "none",
    nextAction: trimTrailingNewlines(String(payload.next_action || payload.nextAction || "")) || null,
    summary: trimTrailingNewlines(String(payload.summary || "")) || null,
    checkpoint: normalizeDelegateCheckpoint(payload.checkpoint || payload.step_checkpoint),
  };
}

function parseDelegateDecision(responseText) {
  const parsed = extractLastJsonCodeBlock(responseText);
  if (!parsed) {
    throw new Error("delegate response did not include the required JSON decision block");
  }
  return normalizeDelegateDecision(parsed);
}

async function recoverDelegateDecisionFromLiveEvents(projectPath, { runId = "", step = null } = {}) {
  const safeRunId = safeDelegateRunId(runId);
  if (!projectPath || !safeRunId) {
    return null;
  }

  const eventsFile = delegateRunEventsFile(projectPath, safeRunId);
  const raw = await readOptionalText(eventsFile);
  if (!raw.trim()) {
    return null;
  }

  const lines = raw.split(/\r?\n/u).filter((line) => line.trim());
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let event = null;
    try {
      event = normalizeDelegateRunEvent(JSON.parse(lines[index]));
    } catch (_error) {
      continue;
    }

    const eventStep = Number.parseInt(String(event.step || "0"), 10) || null;
    if (step && eventStep && eventStep !== step) {
      continue;
    }

    if (!["agent_live", "agent_response"].includes(event.type)) {
      continue;
    }

    const text = trimTrailingNewlines(String(event.text || ""));
    if (!text) {
      continue;
    }

    try {
      return {
        text,
        decision: parseDelegateDecision(text),
        event,
      };
    } catch (_error) {
      // Keep walking backward; the most recent live checkpoint may be stale or partial.
    }
  }

  return null;
}

function orpAdditionalQueueUnavailable(result) {
  const text = `${result?.stderr || ""}\n${result?.stdout || ""}`.toLowerCase();
  if (text.includes("frontier stack is missing")) {
    return true;
  }
  return (
    result?.exitCode === 2 &&
    (
      text.includes("invalid choice") ||
      text.includes("unrecognized arguments")
    )
  );
}

async function runOrpFrontierAdditional(projectPath, command) {
  const result = await runOrp(
    ["--repo-root", projectPath, "frontier", "additional", command, "--json"],
    {
      cwd: projectPath,
      ignoreStdin: true,
      timeoutMs: 20_000,
    },
  );
  if (!result.ok) {
    if (orpAdditionalQueueUnavailable(result)) {
      return {
        ok: false,
        unavailable: true,
        error: result.stderr || result.stdout || `orp exited ${result.exitCode}`,
      };
    }
    throw new Error(result.stderr || result.stdout || `orp frontier additional ${command} failed`);
  }
  return {
    ok: true,
    payload: parseJsonResult(result, `orp frontier additional ${command}`),
  };
}

async function advanceOrpAdditionalQueue(projectPath, { completeActive = false } = {}) {
  let completed = null;
  if (completeActive) {
    completed = await runOrpFrontierAdditional(projectPath, "complete-active");
    if (completed.unavailable) {
      return {
        ok: true,
        unavailable: true,
        completed,
        activated: false,
        payload: null,
      };
    }
  }

  const activated = await runOrpFrontierAdditional(projectPath, "activate-next");
  if (activated.unavailable) {
    return {
      ok: true,
      unavailable: true,
      completed,
      activated: false,
      payload: null,
    };
  }

  return {
    ok: true,
    unavailable: false,
    completed,
    activated: Boolean(activated.payload?.activated),
    payload: activated.payload || null,
  };
}

async function runTrackedSessionDispatchWait(
  projectPath,
  sessionId,
  message,
  { permissionMode = "approve", model = "", onEvent = null, liveRunId = "", liveStep = null } = {},
) {
  const baselineStatus = await readMailboxStatus(projectPath);
  const baselineRequestId = String(baselineStatus.request_id || "").trim();
  const args = ["dispatch", projectPath, message, "--session", sessionId, "--permission-mode", permissionMode];

  if (model) {
    args.push("--model", model);
  }

  const workerTimeoutMs =
    typeof delegateDispatchTimeoutMs === "number" && delegateDispatchTimeoutMs > 10_000
      ? delegateDispatchTimeoutMs - 5_000
      : delegateDispatchTimeoutMs;
  const projectPycachePrefix = path.join(projectPath, ".clawdad", "pycache");
  await mkdir(projectPycachePrefix, { recursive: true }).catch(() => {});
  const workerEnv = {
    PYTHONPYCACHEPREFIX: projectPycachePrefix,
  };
  const safeLiveRunId = safeDelegateRunId(liveRunId);
  const liveStepValue = Number.parseInt(String(liveStep || "0"), 10);
  if (safeLiveRunId) {
    workerEnv.CLAWDAD_CODEX_LIVE_EVENT_FILE = delegateRunEventsFile(projectPath, safeLiveRunId);
    workerEnv.CLAWDAD_CODEX_LIVE_RUN_ID = safeLiveRunId;
    if (Number.isFinite(liveStepValue) && liveStepValue > 0) {
      workerEnv.CLAWDAD_CODEX_LIVE_STEP = String(liveStepValue);
    }
  }
  if (workerTimeoutMs) {
    workerEnv.CLAWDAD_CODEX_TURN_TIMEOUT_MS = String(workerTimeoutMs);
  }
  const startResult = await startClawdadDetached(args, {
    env: workerEnv,
  });
  if (!startResult.ok) {
    throw new Error(startResult.error?.message || "failed to start delegate dispatch");
  }
  if (typeof onEvent === "function") {
    await onEvent("dispatch_process_started", {
      title: "Dispatch worker started",
      text: startResult.pid ? `Worker pid ${startResult.pid}` : "",
    });
  }

  const startedStatus = await waitForMailboxRequestStart(
    projectPath,
    baselineRequestId,
    delegateDispatchStartTimeoutMs,
  );
  let requestId = String(startedStatus.request_id || "").trim();
  if (!requestId) {
    if (typeof onEvent === "function") {
      await onEvent("dispatch_start_reconcile", {
        title: "Reconciling dispatch start",
        text: "The worker started, but the mailbox request appeared late.",
      });
    }
    const reconciledStatus = await waitForMailboxRequestStart(
      projectPath,
      baselineRequestId,
      delegateDispatchStartReconcileMs,
    );
    requestId = String(reconciledStatus.request_id || "").trim();
    if (!requestId) {
      const totalWaitSeconds = Math.round(
        (delegateDispatchStartTimeoutMs + delegateDispatchStartReconcileMs) / 1000,
      );
      throw new Error(`delegate dispatch did not start within ${totalWaitSeconds}s`);
    }
  }
  if (typeof onEvent === "function") {
    await onEvent("dispatch_started", {
      title: "Delegate step dispatched",
      requestId,
    });
  }

  const mailboxStatus = await waitForMailboxCompletion(projectPath, delegateDispatchTimeoutMs, baselineRequestId);
  if (String(mailboxStatus.state || "").trim() === "timeout") {
    throw new Error("delegate dispatch timed out");
  }

  const responseMarkdown = await readMailboxResponse(projectPath);
  const responseText = responseBodyFromMailbox(responseMarkdown);
  const completed = String(mailboxStatus.state || "").trim() === "completed";
  if (typeof onEvent === "function") {
    await onEvent(completed ? "dispatch_completed" : "dispatch_failed", {
      title: completed ? "Delegate step returned" : "Delegate step failed",
      requestId,
      state: String(mailboxStatus.state || "").trim(),
      error: completed ? "" : pickString(mailboxStatus.error),
    });
  }

  return {
    ok: completed,
    requestId,
    mailboxStatus,
    responseMarkdown,
    responseText,
  };
}

async function resumeTrackedSessionDispatchWait(
  projectPath,
  sessionId,
  status,
  { onEvent = null } = {},
) {
  const initialMailboxStatus = await readMailboxStatus(projectPath);
  const requestId = pickString(initialMailboxStatus.request_id);
  const state = pickString(initialMailboxStatus.state).toLowerCase();
  const mailboxSessionId = pickString(initialMailboxStatus.session_id);
  const activeRequestId = pickString(status?.activeRequestId);
  const lastRequestId = pickString(status?.lastRequestId);

  if (!requestId || requestId === lastRequestId) {
    return null;
  }
  if (activeRequestId && requestId !== activeRequestId) {
    return null;
  }
  if (mailboxSessionId && sessionId && mailboxSessionId !== sessionId) {
    return null;
  }
  if (!["dispatched", "running", "completed", "failed"].includes(state)) {
    return null;
  }

  if (typeof onEvent === "function") {
    await onEvent("supervisor_rejoined_dispatch", {
      title: "Supervisor rejoined dispatch",
      requestId,
      state,
      text:
        state === "completed" || state === "failed"
          ? "The child dispatch had already returned, so Clawdad is consuming the saved response."
          : "The child dispatch is still running, so Clawdad is waiting for it instead of launching a duplicate.",
    });
  }

  const mailboxStatus =
    state === "completed" || state === "failed"
      ? initialMailboxStatus
      : await waitForMailboxCompletion(projectPath, delegateDispatchTimeoutMs, "");
  if (String(mailboxStatus.state || "").trim() === "timeout") {
    throw new Error("delegate dispatch timed out after supervisor resume");
  }

  const responseMarkdown = await readMailboxResponse(projectPath);
  const responseText = responseBodyFromMailbox(responseMarkdown);
  const completed = String(mailboxStatus.state || "").trim() === "completed";

  if (typeof onEvent === "function") {
    await onEvent(completed ? "dispatch_completed" : "dispatch_failed", {
      title: completed ? "Delegate step returned" : "Delegate step failed",
      requestId,
      state: String(mailboxStatus.state || "").trim(),
      error: completed ? "" : pickString(mailboxStatus.error),
    });
  }

  return {
    ok: completed,
    requestId,
    mailboxStatus,
    responseMarkdown,
    responseText,
    resumed: true,
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
  await appendDelegateRunEvent(projectPath, nextStatus.runId, "run_paused", {
    title: "Delegate paused",
    text: error || "The delegate will stop after the current safe point.",
    state: nextStatus.state,
    stopReason: nextStatus.stopReason,
  }).catch(() => {});
  return {
    config: nextConfig,
    status: nextStatus,
  };
}

async function runDelegateLoop(
  projectPath,
  initialProject,
  initialConfig,
  initialSession,
  runId,
  startedAt,
  { resume = false } = {},
) {
  let project = initialProject;
  let config = initialConfig;
  let delegateSession = initialSession;
  const logRunEvent = async (type, payload = {}) => {
    await appendDelegateRunEvent(projectPath, runId, type, payload).catch(() => {});
  };
  const initialComputeGuard = await evaluateDelegateComputeGuard(config);
  let lastLoggedComputeUsedBucket = delegateComputeUsedBucket(initialComputeGuard.budget);
  const existingStatus = resume
    ? await readDelegateStatus(projectPath, { reconcile: false })
    : null;
  let latestStatus = await writeDelegateStatus(
    projectPath,
    resume && existingStatus?.state === "running"
      ? {
          ...existingStatus,
          state: "running",
          runId: existingStatus.runId || runId,
          startedAt: existingStatus.startedAt || startedAt,
          delegateSessionId: delegateSession?.sessionId || existingStatus.delegateSessionId || config.delegateSessionId || null,
          delegateSessionLabel: delegateSession
            ? sessionDisplayForStatus(delegateSession)
            : existingStatus.delegateSessionLabel,
          maxSteps: config.maxStepsPerRun,
          computeBudget: initialComputeGuard.budget,
          supervisorPid: process.pid,
          supervisorStartedAt: new Date().toISOString(),
          completedAt: null,
          error: "",
        }
      : {
          state: "running",
          runId,
          startedAt,
          delegateSessionId: delegateSession?.sessionId || config.delegateSessionId || null,
          delegateSessionLabel: delegateSession ? sessionDisplayForStatus(delegateSession) : null,
          planSnapshotId: null,
          activeRequestId: null,
          lastRequestId: existingStatus?.lastRequestId || null,
          supervisorPid: process.pid,
          supervisorStartedAt: new Date().toISOString(),
          stepCount: 0,
          maxSteps: config.maxStepsPerRun,
          computeBudget: initialComputeGuard.budget,
          lastOutcomeSummary: "",
          nextAction: "",
          stopReason: null,
          pauseRequested: false,
          error: "",
        },
  );
  await logRunEvent(resume ? "supervisor_resumed" : "run_started", {
    title: resume ? "Supervisor resumed" : "Delegate run started",
    text: delegateSession ? sessionDisplayForStatus(delegateSession) : "Delegate session pending",
    state: latestStatus.state,
    computeBudget: initialComputeGuard.budget,
  });
  const initialComputeText = delegateComputeBudgetLogText(initialComputeGuard.budget);
  if (initialComputeText) {
    await logRunEvent("compute_guard_checked", {
      title: "Compute guard checked",
      text: initialComputeText,
      computeBudget: initialComputeGuard.budget,
    });
  }

  try {
    if (initialComputeGuard.blocked) {
      return await setDelegateComputeBlocked(
        projectPath,
        config,
        latestStatus,
        initialComputeGuard.message,
        initialComputeGuard.budget,
      );
    }

    if (!(await readDelegatePlanSnapshots(projectPath))[0]) {
      await logRunEvent("planning_started", {
        title: "Planning started",
        text: "No saved delegate plan was found, so Clawdad is creating one first.",
      });
      latestStatus = await writeDelegateStatus(projectPath, {
        ...latestStatus,
        state: "planning",
        error: "",
      });
      const planResult = await generateDelegatePlanSnapshot(project, config, delegateSession, {
        status: latestStatus,
        refreshReason: "missing_plan",
      });
      await logRunEvent("planning_completed", {
        title: "Planning completed",
        summary: planResult.snapshot.plan,
        payload: {
          planSnapshotId: planResult.snapshot.id,
          createdAt: planResult.snapshot.createdAt,
        },
      });
      latestStatus = await writeDelegateStatus(projectPath, {
        ...latestStatus,
        state: "running",
        planSnapshotId: planResult.snapshot.id,
        error: "",
      });
    }

    for (let stepIndex = Math.max(0, Number.parseInt(String(latestStatus.stepCount || "0"), 10) || 0); ; stepIndex += 1) {
      config = await readDelegateConfig(projectPath);
      if (!config.enabled) {
        return await setDelegatePaused(projectPath, config, latestStatus);
      }
      if (config.maxStepsPerRun && stepIndex >= config.maxStepsPerRun) {
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
        await logRunEvent("run_paused", {
          title: "Paused at step limit",
          text: `The delegate reached the configured ${config.maxStepsPerRun} step limit.`,
          state: latestStatus.state,
          stopReason: "step_limit",
        });
        return {
          config,
          status: latestStatus,
        };
      }

      const computeGuard = await evaluateDelegateComputeGuard(config);
      latestStatus = await writeDelegateStatus(projectPath, {
        ...latestStatus,
        maxSteps: config.maxStepsPerRun,
        computeBudget: computeGuard.budget,
      });
      const computeUsedBucket = delegateComputeUsedBucket(computeGuard.budget);
      const computeText = delegateComputeBudgetLogText(computeGuard.budget);
      if (
        computeText &&
        computeUsedBucket != null &&
        (lastLoggedComputeUsedBucket == null || computeUsedBucket > lastLoggedComputeUsedBucket)
      ) {
        lastLoggedComputeUsedBucket = computeUsedBucket;
        await logRunEvent("compute_guard_checked", {
          title: "Compute guard checked",
          step: stepIndex + 1,
          text: computeText,
          computeBudget: computeGuard.budget,
        });
      }
      if (computeGuard.blocked) {
        return await setDelegateComputeBlocked(
          projectPath,
          config,
          latestStatus,
          computeGuard.message,
          computeGuard.budget,
        );
      }

      const synced = await syncDelegateSession(projectPath, config);
      project = synced.projectDetails;
      config = synced.config;
      delegateSession = synced.session;
      if (!project || !delegateSession?.sessionId) {
        throw new Error("delegate session is not available");
      }
      await logRunEvent("delegate_session_ready", {
        title: "Delegate session ready",
        step: stepIndex + 1,
        text: sessionDisplayForStatus(delegateSession),
        payload: {
          sessionId: delegateSession.sessionId,
          slug: delegateSession.slug,
          provider: delegateSession.provider,
        },
      });

      const [brief, initialPlanSnapshots, summarySnapshots, sourceEntries] = await Promise.all([
        readDelegateBrief(projectPath, project),
        readDelegatePlanSnapshots(projectPath),
        readProjectSummarySnapshots(projectPath),
        loadProjectSummarySourceEntries(project),
      ]);
      let planSnapshots = initialPlanSnapshots;
      let latestPlan = planSnapshots[0] || null;
      const latestSummary = summarySnapshots[0] || null;
      const delegateSourceEntries = delegateSessionHistoryEntries(sourceEntries, delegateSession);
      const phaseHandoffAnalysis = analyzeDelegatePhaseHandoff({
        sourceEntries: delegateSourceEntries,
        status: latestStatus,
      });
      const planRefresh = delegatePlanRefreshDecision({
        latestPlan,
        status: latestStatus,
        sourceEntryCount: sourceEntries.length,
        phaseHandoffAnalysis,
      });
      if (planRefresh.refresh) {
        await logRunEvent("plan_refresh_started", {
          title: "Delegate plan refresh started",
          step: stepIndex + 1,
          text: `Refreshing the saved plan because ${planRefresh.reason.replace(/_/gu, " ")}.`,
          payload: {
            reason: planRefresh.reason,
            stepsSincePlan: planRefresh.stepsSincePlan,
            sourceEntriesSincePlan: planRefresh.sourceEntriesSincePlan,
            ageMs: planRefresh.ageMs,
          },
        });
        const planResult = await generateDelegatePlanSnapshot(project, config, delegateSession, {
          status: latestStatus,
          phaseHandoffAnalysis,
          refreshReason: planRefresh.reason,
        });
        planSnapshots = planResult.snapshots;
        latestPlan = planResult.snapshot;
        await logRunEvent("plan_refresh_completed", {
          title: "Delegate plan refreshed",
          step: stepIndex + 1,
          summary: latestPlan.plan,
          payload: {
            reason: planRefresh.reason,
            planSnapshotId: latestPlan.id,
            createdAt: latestPlan.createdAt,
          },
        });
      }
      latestStatus = await writeDelegateStatus(projectPath, {
        ...latestStatus,
        state: "running",
        delegateSessionId: delegateSession.sessionId,
        delegateSessionLabel: sessionDisplayForStatus(delegateSession),
        planSnapshotId: latestPlan?.id || latestStatus.planSnapshotId,
        stepCount: stepIndex,
        maxSteps: config.maxStepsPerRun,
        computeBudget: computeGuard.budget,
        error: "",
      });
      if (phaseHandoffAnalysis.triggered) {
        await logRunEvent("phase_handoff_guard", {
          title: "Phase handoff guard",
          step: stepIndex + 1,
          text: `Detected ${phaseHandoffAnalysis.repeatCount} consecutive same-shaped next actions. The next prompt will require an endpoint/recombination/generalization check before extending the staircase.`,
          nextAction: latestStatus.nextAction,
          payload: {
            repeatCount: phaseHandoffAnalysis.repeatCount,
            recentActions: phaseHandoffAnalysis.recentActions,
          },
        });
      }
      await logRunEvent("step_started", {
        title: "Delegate step started",
        step: stepIndex + 1,
        text: latestStatus.nextAction || "Preparing the next safe project action.",
      });

      let dispatchResult = resume
        ? await resumeTrackedSessionDispatchWait(projectPath, delegateSession.sessionId, latestStatus, {
            onEvent: async (type, payload = {}) => {
              await logRunEvent(type, {
                ...payload,
                step: stepIndex + 1,
              });
              if (payload.requestId && ["supervisor_rejoined_dispatch", "dispatch_started"].includes(type)) {
                latestStatus = await writeDelegateStatus(projectPath, {
                  ...latestStatus,
                  activeRequestId: payload.requestId,
                  error: "",
                });
              }
            },
          })
        : null;

      if (!dispatchResult) {
        const prompt = buildDelegateStepPrompt(
          project,
          delegateSession,
          brief,
          latestPlan,
          latestSummary,
          delegateSourceEntries,
          latestStatus,
          phaseHandoffAnalysis,
        );
        dispatchResult = await runTrackedSessionDispatchWait(projectPath, delegateSession.sessionId, prompt, {
          permissionMode: "approve",
          liveRunId: latestStatus.runId,
          liveStep: stepIndex + 1,
          onEvent: async (type, payload = {}) => {
            await logRunEvent(type, {
              ...payload,
              step: stepIndex + 1,
            });
            if (payload.requestId && type === "dispatch_started") {
              latestStatus = await writeDelegateStatus(projectPath, {
                ...latestStatus,
                activeRequestId: payload.requestId,
                error: "",
              });
            }
          },
        });
      }
      let responseText = dispatchResult.responseText;
      let decision = null;
      let recoveredResponse = null;
      if (!dispatchResult.ok) {
        recoveredResponse = await recoverDelegateDecisionFromLiveEvents(projectPath, {
          runId: latestStatus.runId,
          step: stepIndex + 1,
        });
        if (!recoveredResponse) {
          const dispatchErrorText =
            dispatchResult.responseText || dispatchResult.mailboxStatus?.error || "delegate step failed";
          if (recoverableCodexStreamDisconnect({
            error: dispatchErrorText,
            responseText: dispatchResult.responseText,
            mailboxStatus: dispatchResult.mailboxStatus,
          })) {
            await logRunEvent("dispatch_recoverable_transport_failure", {
              title: "Recoverable Codex stream disconnect",
              step: stepIndex + 1,
              requestId: dispatchResult.requestId,
              text:
                "Codex closed the response websocket before response.completed with a retryable transport error. Clawdad is keeping the delegate enabled so the next step can inspect live artifacts and resume without marking the project blocked.",
              error: dispatchErrorText,
            });
            latestStatus = await writeDelegateStatus(projectPath, {
              ...latestStatus,
              state: "running",
              stepCount: stepIndex + 1,
              activeRequestId: null,
              lastRequestId: dispatchResult.requestId || latestStatus.lastRequestId,
              error: dispatchErrorText,
            });
            continue;
          }
          throw new Error(dispatchErrorText);
        }
        responseText = recoveredResponse.text;
        decision = recoveredResponse.decision;
        await logRunEvent("agent_response_recovered", {
          title: "Recovered agent response",
          step: stepIndex + 1,
          requestId: dispatchResult.requestId,
          text: "Recovered a valid delegate JSON decision from the live event stream after the mailbox dispatch failed.",
          payload: {
            sourceEventId: recoveredResponse.event?.id || null,
            sourceEventAt: recoveredResponse.event?.at || null,
            sourceEventType: recoveredResponse.event?.type || null,
          },
        });
      } else {
        try {
          decision = parseDelegateDecision(responseText);
        } catch (error) {
          recoveredResponse = await recoverDelegateDecisionFromLiveEvents(projectPath, {
            runId: latestStatus.runId,
            step: stepIndex + 1,
          });
          if (!recoveredResponse) {
            throw error;
          }
          responseText = recoveredResponse.text;
          decision = recoveredResponse.decision;
          await logRunEvent("agent_response_recovered", {
            title: "Recovered agent response",
            step: stepIndex + 1,
            requestId: dispatchResult.requestId,
            text: "Recovered a valid delegate JSON decision from the live event stream after mailbox response parsing failed.",
            payload: {
              sourceEventId: recoveredResponse.event?.id || null,
              sourceEventAt: recoveredResponse.event?.at || null,
              sourceEventType: recoveredResponse.event?.type || null,
            },
          });
        }
      }

      await logRunEvent("agent_response", {
        title: recoveredResponse ? "Agent response recovered" : "Agent response captured",
        step: stepIndex + 1,
        requestId: dispatchResult.requestId,
        text: responseText,
        payload: {
          recoveredFromLiveEvents: Boolean(recoveredResponse),
        },
      });

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
        activeRequestId: null,
        lastRequestId: dispatchResult.requestId || latestStatus.lastRequestId,
        lastOutcomeSummary: decision.summary || latestStatus.lastOutcomeSummary,
        nextAction: decision.nextAction || latestStatus.nextAction,
        stopReason: decision.stopReason === "none" ? null : decision.stopReason,
        error: "",
      });
      await logRunEvent("step_completed", {
        title: "Delegate step completed",
        step: stepIndex + 1,
        requestId: dispatchResult.requestId,
        state: decision.state,
        stopReason: decision.stopReason,
        summary: decision.summary,
        nextAction: decision.nextAction,
        checkpoint: decision.checkpoint,
      });

      const postStepComputeGuard = await evaluateDelegateComputeGuard(config);
      latestStatus = await writeDelegateStatus(projectPath, {
        ...latestStatus,
        computeBudget: postStepComputeGuard.budget,
      });

      config = await readDelegateConfig(projectPath);
      if (!config.enabled) {
        return await setDelegatePaused(projectPath, config, latestStatus);
      }

      if (decision.state === "completed") {
        const additional = await advanceOrpAdditionalQueue(projectPath, { completeActive: true });
        if (additional.unavailable) {
          await logRunEvent("orp_additional_unavailable", {
            title: "ORP additional queue unavailable",
            step: stepIndex + 1,
            text: additional.completed?.error || "No ORP additional queue command is available for this project.",
          });
        } else if (additional.activated) {
          const nextAction = pickString(additional.payload?.next_action, additional.payload?.nextAction);
          latestStatus = await writeDelegateStatus(projectPath, {
            ...latestStatus,
            state: "running",
            completedAt: null,
            pauseRequested: false,
            stopReason: null,
            lastOutcomeSummary: decision.summary || latestStatus.lastOutcomeSummary,
            nextAction: nextAction || latestStatus.nextAction,
            error: "",
          });
          await logRunEvent("orp_additional_activated", {
            title: "ORP additional item activated",
            step: stepIndex + 1,
            summary: nextAction || "Activated the next queued ORP additional item.",
            nextAction,
            payload: additional.payload,
          });
          continue;
        }

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
        await logRunEvent("run_completed", {
          title: "Delegate completed",
          step: stepIndex + 1,
          summary: decision.summary || "The delegate marked the run complete.",
          state: latestStatus.state,
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
        await logRunEvent("run_blocked", {
          title: "Delegate blocked",
          step: stepIndex + 1,
          state: latestStatus.state,
          stopReason: decision.stopReason,
          summary: decision.summary || "",
          nextAction: decision.nextAction || "",
        });
        return {
          config,
          status: latestStatus,
        };
      }

      if (postStepComputeGuard.blocked) {
        return await setDelegateComputeBlocked(
          projectPath,
          config,
          latestStatus,
          postStepComputeGuard.message,
          postStepComputeGuard.budget,
        );
      }
    }
  } catch (error) {
    if (looksLikeComputeLimitError(error.message)) {
      const computeBudget = await readLatestCodexComputeBudget(config, { codexHome: defaultCodexHome }).catch(
        () => latestStatus.computeBudget,
      );
      return await setDelegateComputeBlocked(
        projectPath,
        config,
        latestStatus,
        error.message || "Codex compute limit reached.",
        computeBudget,
      );
    }
    await logRunEvent("run_failed", {
      title: "Delegate failed",
      state: "failed",
      error: error.message,
    });
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
  const [config, brief, initialStatus, planSnapshots, runSummarySnapshots] = await Promise.all([
    readDelegateConfig(projectDetails.path),
    readDelegateBrief(projectDetails.path, projectDetails),
    readDelegateStatus(projectDetails.path),
    readDelegatePlanSnapshots(projectDetails.path),
    readDelegateRunSummarySnapshots(projectDetails.path),
  ]);
  let status = initialStatus;
  if (delegateStatusNeedsSupervisor(status, config)) {
    try {
      const resumeResult = await startDelegateRun(projectDetails);
      status = resumeResult.status || status;
    } catch (error) {
      await appendDelegateRunEvent(projectDetails.path, status.runId, "supervisor_resume_failed", {
        title: "Supervisor resume failed",
        error: error.message,
        state: status.state,
      }).catch(() => {});
    }
  }
  const delegateSession =
    resolveDelegateSessionFromProject(projectDetails, config) ||
    projectDetails.sessions.find(
      (session) =>
        String(session?.provider || "").trim().toLowerCase() === "codex" &&
        pickString(session?.slug) === pickString(config.delegateSessionSlug, delegateSessionSlugForProject(projectDetails)),
    ) ||
    null;
  const delegateRuns = await readDelegateRunList(projectDetails.path, {
    status,
    summarySnapshots: runSummarySnapshots,
  });

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
    delegateRuns,
    latestRunSummarySnapshot: runSummarySnapshots[0] || null,
    runSummarySnapshots,
  };
}

function resolveCodexSessionSelector(projectDetails, selector) {
  const target = pickString(selector);
  if (!target) {
    return null;
  }

  const sessions = (Array.isArray(projectDetails?.sessions) ? projectDetails.sessions : []).filter(
    (session) =>
      String(session?.provider || "").trim().toLowerCase() === "codex" &&
      pickString(session?.sessionId),
  );
  const matches = (session, value) =>
    pickString(session?.sessionId) === value || pickString(session?.slug) === value;
  const exactMatch = sessions.find((session) => matches(session, target));
  if (exactMatch) {
    return exactMatch;
  }

  const foldedTarget = target.toLowerCase();
  return (
    sessions.find((session) =>
      [session?.sessionId, session?.slug]
        .map((value) => pickString(value).toLowerCase())
        .includes(foldedTarget),
    ) || null
  );
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
  const status = payload.status || {};
  const statusBits = [
    status.stepCount != null ? `step ${status.stepCount}` : "",
    status.pauseRequested ? "pause requested" : "",
    status.activeRequestId ? `active ${status.activeRequestId}` : "",
  ].filter(Boolean);
  const supervisorText = status.supervisorPid
    ? `${delegateSupervisorIsLive(status) ? "live" : "stale"} pid ${status.supervisorPid}`
    : "none";
  console.log(`Status: ${status.state || "idle"}${statusBits.length ? ` (${statusBits.join(", ")})` : ""}`);
  console.log(`Supervisor: ${supervisorText}`);
  console.log(`Guardrails: hard stops ${payload.config.hardStops.join(", ")}`);
  console.log(
    `Compute guard: ${
      payload.config.computeGuardEnabled ? `on, reserve ${payload.config.computeReservePercent}%` : "off"
    }`,
  );
  console.log(`Step cap: ${payload.config.maxStepsPerRun ? payload.config.maxStepsPerRun : "none"}`);
  console.log(`Latest plan: ${payload.latestPlanSnapshot?.createdAt || "none"}`);
  if (status.computeBudget) {
    console.log(`Compute: ${delegateComputeBudgetLogText(status.computeBudget) || describeDelegateComputeBudget(status.computeBudget)}`);
  }
  if (status.error) {
    console.log(`Last error: ${status.error}`);
  }
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
  const hasBriefInput = Boolean(rawOptions.file || rawOptions.stdin || rawOptions._.slice(1).join(" ").trim());
  const hasConfigUpdate =
    rawOptions.computeReservePercent != null ||
    rawOptions.maxStepsPerRun != null ||
    rawOptions.session != null;

  if (rawOptions.file) {
    brief = await readFile(path.resolve(String(rawOptions.file)), "utf8");
  } else if (rawOptions.stdin) {
    brief = await readStdinText();
  } else {
    brief = rawOptions._.slice(1).join(" ");
  }

  if (!hasBriefInput && !hasConfigUpdate) {
    throw new Error("missing brief text or delegate guardrail option");
  }

  const savedBrief = hasBriefInput
    ? await writeDelegateBrief(resolved.projectPath, brief, resolved.projectDetails)
    : await readDelegateBrief(resolved.projectPath, resolved.projectDetails);

  if (hasConfigUpdate) {
    const currentConfig = await readDelegateConfig(resolved.projectPath);
    const nextConfig = {
      ...currentConfig,
      computeReservePercent:
        rawOptions.computeReservePercent != null
          ? rawOptions.computeReservePercent
          : currentConfig.computeReservePercent,
      maxStepsPerRun:
        rawOptions.maxStepsPerRun != null
          ? rawOptions.maxStepsPerRun
          : currentConfig.maxStepsPerRun,
    };

    if (rawOptions.session != null) {
      const selectedSession = resolveCodexSessionSelector(resolved.projectDetails, rawOptions.session);
      if (!selectedSession?.sessionId) {
        throw new Error(`no tracked Codex session '${rawOptions.session}' found for this project`);
      }
      nextConfig.delegateSessionId = selectedSession.sessionId;
      nextConfig.delegateSessionSlug = pickString(
        selectedSession.slug,
        currentConfig.delegateSessionSlug,
        delegateDefaultSessionSlug,
      );
    }

    await writeDelegateConfig(resolved.projectPath, nextConfig);
  }

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

  console.log(`updated delegate settings for ${resolved.projectDetails.displayName || resolved.projectDetails.slug}`);
}

function printDelegateRunResult(action, resolved, payload, status, accepted) {
  const displayName = resolved.projectDetails.displayName || resolved.projectDetails.slug || resolved.projectPath;
  const state = status?.state || payload.status?.state || "idle";
  const stopReason = status?.stopReason || payload.status?.stopReason || "";
  const error = status?.error || payload.status?.error || "";
  const sessionLabel = payload.delegateSession?.label || "delegate session pending";

  if (action === "pause") {
    if (state === "running" || status?.pauseRequested) {
      console.log(`delegate pause requested for ${displayName}`);
    } else {
      console.log(`delegate paused for ${displayName}`);
    }
    return;
  }

  if (accepted && state === "running") {
    console.log(`delegate running for ${displayName} (${sessionLabel})`);
    return;
  }
  if (state === "blocked") {
    console.log(`delegate blocked for ${displayName}${stopReason ? ` (${stopReason})` : ""}`);
    if (error) {
      console.log(error);
    }
    return;
  }
  if (!accepted && (state === "running" || state === "planning")) {
    console.log(`delegate already ${state} for ${displayName} (${sessionLabel})`);
    return;
  }
  console.log(`delegate ${state} for ${displayName} (${sessionLabel})`);
}

async function runDelegateRun(argv) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    printUsage();
    return;
  }

  const resolved = await resolveDelegateProjectForCli(rawOptions);
  const startResult = await startDelegateRun(resolved.projectDetails);
  const payload = await buildDelegatePayload(resolved.projectDetails);
  const result = {
    ok: true,
    action: "start",
    accepted: startResult.accepted,
    project: resolved.projectPath,
    projectDetails: resolved.projectDetails,
    ...payload,
    status: startResult.status || payload.status,
  };

  if (rawOptions.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printDelegateRunResult("start", resolved, payload, result.status, startResult.accepted);
}

async function runDelegateSupervisor(argv) {
  const rawOptions = parseArgs(argv);
  const resolved = await resolveDelegateProjectForCli(rawOptions);
  const status = await readDelegateStatus(resolved.projectPath, { reconcile: false });
  const runId = pickString(rawOptions.runId, status.runId) || crypto.randomUUID();
  if (status.runId && status.runId !== runId) {
    return;
  }

  let config = await readDelegateConfig(resolved.projectPath);
  if (!config.enabled && status.state !== "running") {
    return;
  }

  const ensured = await ensureDelegateSession(resolved.projectDetails, config);
  config = ensured.config;
  const startedAt = status.startedAt || new Date().toISOString();
  delegateRunJobs.set(resolved.projectPath, {
    runId,
    startedAt,
    delegateSessionId: ensured.session.sessionId,
    delegateSessionLabel: sessionDisplayForStatus(ensured.session),
    pauseRequested: false,
    promise: null,
  });

  try {
    const promise = runDelegateLoop(
      resolved.projectPath,
      ensured.projectDetails,
      config,
      ensured.session,
      runId,
      startedAt,
      { resume: status.state === "running" },
    );
    const activeJob = delegateRunJobs.get(resolved.projectPath);
    if (activeJob?.runId === runId) {
      activeJob.promise = promise;
    }
    await promise;
  } finally {
    const activeJob = delegateRunJobs.get(resolved.projectPath);
    if (activeJob?.runId === runId) {
      delegateRunJobs.delete(resolved.projectPath);
    }
  }
}

async function pauseDelegateRun(projectDetails) {
  const activeRunJob = delegateRunJobs.get(projectDetails.path);
  if (activeRunJob) {
    activeRunJob.pauseRequested = true;
  }
  const currentConfig = await readDelegateConfig(projectDetails.path);
  const nextConfig = await writeDelegateConfig(projectDetails.path, {
    ...currentConfig,
    enabled: false,
  });
  const currentStatus = await readDelegateStatus(projectDetails.path, { reconcile: false });
  const pauseDecision = delegatePauseDecision({
    status: currentStatus,
    hasActiveRunJob: Boolean(activeRunJob),
    hasActivePlanJob: delegatePlanJobs.has(projectDetails.path),
    supervisorLive: delegateSupervisorIsLive(currentStatus),
  });
  const nextStatus = await writeDelegateStatus(projectDetails.path, {
    ...currentStatus,
    state: pauseDecision.state,
    pauseRequested: pauseDecision.pauseRequested,
    completedAt: pauseDecision.waitForSafePoint ? currentStatus.completedAt : new Date().toISOString(),
    error: "",
  });
  await appendDelegateRunEvent(projectDetails.path, nextStatus.runId, "pause_requested", {
    title: pauseDecision.waitForSafePoint ? "Pause requested" : "Delegate paused",
    text: pauseDecision.waitForSafePoint
      ? "Clawdad will pause the delegate after the current step returns."
      : currentStatus.state === "running"
        ? "No live delegate supervisor was attached, so Clawdad marked the stale run paused immediately."
        : "The delegate is paused.",
    state: nextStatus.state,
  }).catch(() => {});

  return {
    accepted: true,
    config: nextConfig,
    status: nextStatus,
  };
}

async function runDelegatePause(argv) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    printUsage();
    return;
  }

  const resolved = await resolveDelegateProjectForCli(rawOptions);
  const pauseResult = await pauseDelegateRun(resolved.projectDetails);
  const payload = await buildDelegatePayload(resolved.projectDetails);
  const result = {
    ok: true,
    action: "pause",
    accepted: pauseResult.accepted,
    project: resolved.projectPath,
    projectDetails: resolved.projectDetails,
    ...payload,
    config: pauseResult.config,
    status: pauseResult.status,
  };

  if (rawOptions.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printDelegateRunResult("pause", resolved, payload, result.status, pauseResult.accepted);
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
  try {
    return await reconcileMailboxStatus(projectPath, JSON.parse(await readFile(statusFile, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    if (error instanceof SyntaxError) {
      return repairMalformedMailboxStatus(projectPath, statusFile, error);
    }
    throw new Error(`failed to read ${statusFile}: ${error.message}`);
  }
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

async function readProjectStateProjects() {
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
  return stateProjects;
}

async function projectCatalogFromStateProjects(stateProjects = {}) {
  const projectEntries = await Promise.all(
    Object.entries(stateProjects).map(async ([projectPath, stateEntry]) => {
      if (!projectHasStateSessions(projectPath, stateEntry)) {
        return null;
      }
      try {
        const stats = await stat(projectPath);
        if (!stats.isDirectory()) {
          return null;
        }
      } catch (error) {
        if (error.code === "ENOENT") {
          return null;
        }
        console.warn(`[clawdad-server] ignoring inaccessible project path ${projectPath}: ${error.message}`);
        return null;
      }
      return [projectPath, stateEntry];
    }),
  );

  const summaries = await Promise.all(
    projectEntries
      .filter(Boolean)
      .map(async ([projectPath]) => {
        const project = projectSummaryFromTabs(projectPath, [], stateProjects);
        const mailboxStatus = await readMailboxStatus(projectPath).catch(() => ({}));
        return projectSummaryWithMailboxStatus(project, mailboxStatus);
      }),
  );

  return disambiguateProjectDisplayNames(
    summaries
      .filter((project) => project.sessions.length > 0)
      .sort(compareProjects),
  );
}

function mergeProjectCatalogs(preferredProjects = [], extraProjects = []) {
  const grouped = new Map();
  for (const project of preferredProjects) {
    const projectPath = pickString(project?.path);
    if (projectPath) {
      grouped.set(projectPath, project);
    }
  }
  for (const project of extraProjects) {
    const projectPath = pickString(project?.path);
    if (projectPath && !grouped.has(projectPath)) {
      grouped.set(projectPath, project);
    }
  }
  return disambiguateProjectDisplayNames([...grouped.values()].sort(compareProjects));
}

async function loadProjectCatalogFromOrp(stateProjects = {}) {
  const statusResult = await runClawdad(["status", "--json"], {
    ignoreStdin: true,
    killProcessGroup: true,
    timeoutMs: projectCatalogCommandTimeoutMs,
  });
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

  for (const [projectPath, stateEntry] of Object.entries(stateProjects)) {
    if (!grouped.has(projectPath) && projectHasStateSessions(projectPath, stateEntry)) {
      grouped.set(projectPath, []);
    }
  }

  return disambiguateProjectDisplayNames(
    [...grouped.entries()]
      .map(([projectPath, tabsForPath]) => projectSummaryFromTabs(projectPath, tabsForPath, stateProjects))
      .sort(compareProjects),
  );
}

async function loadProjectCatalog() {
  const stateProjects = await readProjectStateProjects();
  const localProjects = await projectCatalogFromStateProjects(stateProjects);
  if (localProjects.length > 0) {
    return localProjects;
  }
  return loadProjectCatalogFromOrp(stateProjects);
}

async function loadProjectCatalogCached({ allowStale = true } = {}) {
  const now = Date.now();
  // Project navigation is local-first; ORP is only a cold-start fallback here.
  if (projectCatalogCache.value) {
    if (allowStale || now - projectCatalogCache.loadedAt < projectCatalogCacheTtlMs) {
      return projectCatalogCache.value;
    }
  }

  const stateProjects = await readProjectStateProjects();
  const localProjects = await projectCatalogFromStateProjects(stateProjects);

  if (projectCatalogCache.promise) {
    if (allowStale && projectCatalogCache.value) {
      return mergeProjectCatalogs(projectCatalogCache.value, localProjects);
    }
    if (localProjects.length > 0) {
      return localProjects;
    }
    return projectCatalogCache.promise;
  }

  if (localProjects.length > 0) {
    const projects = allowStale && projectCatalogCache.value
      ? mergeProjectCatalogs(projectCatalogCache.value, localProjects)
      : localProjects;
    projectCatalogCache.value = projects;
    projectCatalogCache.loadedAt = Date.now();
    return projects;
  }

  projectCatalogCache.promise = loadProjectCatalogFromOrp(stateProjects)
    .then((projects) => {
      projectCatalogCache.value = projects;
      projectCatalogCache.loadedAt = Date.now();
      return projects;
    })
    .catch((error) => {
      const reason = error.message || "failed";
      console.warn(`[clawdad-server] ORP project catalog sync skipped: ${reason}`);
      if (allowStale && projectCatalogCache.value) {
        console.warn(`[clawdad-server] keeping stale project catalog after refresh failed: ${reason}`);
        return projectCatalogCache.value;
      }
      throw error;
    })
    .finally(() => {
      projectCatalogCache.promise = null;
    });

  if (allowStale && projectCatalogCache.value) {
    return projectCatalogCache.value;
  }

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

function projectArtifactsDir(projectPath) {
  return path.join(projectPath, ".clawdad", "artifacts");
}

function artifactSharesFile(projectPath) {
  return path.join(projectArtifactsDir(projectPath), ".clawdad-shares.json");
}

function artifactRelativePath(rawPath) {
  const normalized = String(rawPath || "").trim().replace(/\\/gu, "/").replace(/^\/+/u, "");
  if (!normalized || normalized.includes("\0")) {
    throw new Error("missing artifact file");
  }

  const cleaned = path.posix.normalize(normalized);
  if (!cleaned || cleaned === "." || cleaned.startsWith("../") || cleaned === "..") {
    throw new Error("invalid artifact path");
  }
  if (cleaned.split("/").some((segment) => segment === ".." || segment === "")) {
    throw new Error("invalid artifact path");
  }
  return cleaned;
}

function artifactPathFor(projectPath, relativePath) {
  const artifactRoot = projectArtifactsDir(projectPath);
  const normalizedRelativePath = artifactRelativePath(relativePath);
  const absolutePath = path.resolve(artifactRoot, normalizedRelativePath);
  if (!pathInsideRoot(artifactRoot, absolutePath)) {
    throw new Error("artifact path is outside the project artifact directory");
  }
  return {
    artifactRoot,
    relativePath: normalizedRelativePath,
    absolutePath,
  };
}

function artifactIsHidden(relativePath) {
  return String(relativePath || "")
    .split("/")
    .some((segment) => segment.startsWith("."));
}

function artifactId(projectPath, relativePath, info = {}) {
  const hash = crypto.createHash("sha256");
  hash.update(projectPath);
  hash.update("\0");
  hash.update(relativePath);
  hash.update("\0");
  hash.update(String(info.mtimeMs || ""));
  hash.update("\0");
  hash.update(String(info.size || ""));
  return hash.digest("hex").slice(0, 24);
}

function contentDispositionAttachment(filename) {
  const fallback = String(filename || "download").replace(/[^\w .()@-]/gu, "_") || "download";
  return `attachment; filename="${fallback.replace(/"/gu, "'")}"; filename*=UTF-8''${encodeURIComponent(filename || fallback)}`;
}

function originForRequest(req, options = {}) {
  const configured = pickString(options.tailscalePublicUrl);
  if (configured) {
    return configured.replace(/\/+$/u, "");
  }
  const proto = headerValue(req, "x-forwarded-proto") || "https";
  const host = headerValue(req, "x-forwarded-host") || headerValue(req, "host");
  return host ? `${proto}://${host}`.replace(/\/+$/u, "") : "";
}

function artifactDownloadUrl(projectPath, relativePath) {
  const query = new URLSearchParams({
    project: projectPath,
    file: relativePath,
  });
  return `/v1/artifacts/download?${query.toString()}`;
}

function artifactShareUrl(req, options, token, fileName) {
  const origin = originForRequest(req, options);
  const safeFileName = encodeURIComponent(fileName || "download");
  const pathPart = `/share/${encodeURIComponent(token)}/${safeFileName}`;
  return origin ? `${origin}${pathPart}` : pathPart;
}

function normalizeArtifactShare(projectPath, payload = {}) {
  return {
    token: pickString(payload.token),
    projectPath: pickString(payload.projectPath) || projectPath,
    relativePath: pickString(payload.relativePath),
    fileName: pickString(payload.fileName),
    createdAt: pickString(payload.createdAt) || null,
    expiresAt: pickString(payload.expiresAt) || null,
    revokedAt: pickString(payload.revokedAt) || null,
  };
}

function artifactShareIsActive(share, nowMs = Date.now()) {
  if (!share?.token || !share.relativePath || share.revokedAt) {
    return false;
  }
  const expiresAtMs = Date.parse(share.expiresAt || "");
  return !Number.isFinite(expiresAtMs) || expiresAtMs > nowMs;
}

async function readArtifactShares(projectPath, { includeExpired = false } = {}) {
  const payload = (await readOptionalJson(artifactSharesFile(projectPath))) || {};
  const nowMs = Date.now();
  return (Array.isArray(payload.shares) ? payload.shares : [])
    .map((share) => normalizeArtifactShare(projectPath, share))
    .filter((share) => share.token && share.relativePath)
    .filter((share) => includeExpired || artifactShareIsActive(share, nowMs));
}

async function writeArtifactShares(projectPath, shares) {
  const normalizedShares = (Array.isArray(shares) ? shares : [])
    .map((share) => normalizeArtifactShare(projectPath, share))
    .filter((share) => share.token && share.relativePath);
  await writeJsonFile(artifactSharesFile(projectPath), {
    version: 1,
    shares: normalizedShares,
  });
  return normalizedShares;
}

async function pruneArtifactShares(projectPath) {
  const allShares = await readArtifactShares(projectPath, { includeExpired: true });
  const activeShares = allShares.filter((share) => artifactShareIsActive(share));
  if (activeShares.length !== allShares.length) {
    await writeArtifactShares(projectPath, activeShares);
  }
  return activeShares;
}

function normalizeArtifactEntry(projectPath, relativePath, info, shares = [], req = null, options = {}) {
  const fileName = path.basename(relativePath);
  const activeShare = shares.find((share) => share.relativePath === relativePath) || null;
  return {
    id: artifactId(projectPath, relativePath, info),
    projectPath,
    relativePath,
    fileName,
    size: info.size,
    modifiedAt: new Date(info.mtimeMs || Date.now()).toISOString(),
    mimeType: inferMimeType(relativePath),
    downloadUrl: artifactDownloadUrl(projectPath, relativePath),
    share: activeShare
      ? {
          token: activeShare.token,
          createdAt: activeShare.createdAt,
          expiresAt: activeShare.expiresAt,
          url: req ? artifactShareUrl(req, options, activeShare.token, fileName) : "",
        }
      : null,
  };
}

async function listProjectArtifacts(projectPath, req = null, options = {}) {
  const artifactRoot = projectArtifactsDir(projectPath);
  await mkdir(artifactRoot, { recursive: true });
  const shares = await pruneArtifactShares(projectPath);
  const entries = [];

  async function walk(currentDir, relativeDir = "", depth = 0) {
    if (entries.length >= artifactListLimit || depth > 8) {
      return;
    }

    let names = [];
    try {
      names = await readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const entry of names) {
      if (entries.length >= artifactListLimit) {
        break;
      }
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (artifactIsHidden(relativePath)) {
        continue;
      }

      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const info = await stat(absolutePath);
      entries.push(normalizeArtifactEntry(projectPath, relativePath, info, shares, req, options));
    }
  }

  await walk(artifactRoot);
  return entries.sort((left, right) => {
    const leftMs = Date.parse(left.modifiedAt || "");
    const rightMs = Date.parse(right.modifiedAt || "");
    return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
  });
}

async function createArtifactShare(projectPath, relativePath, req, options, expiresInHours = null) {
  const artifact = artifactPathFor(projectPath, relativePath);
  const info = await stat(artifact.absolutePath);
  if (!info.isFile()) {
    throw new Error("artifact is not a file");
  }

  const allShares = await readArtifactShares(projectPath, { includeExpired: true });
  const activeShares = allShares.filter((share) => artifactShareIsActive(share));
  const existing = activeShares.find((share) => share.relativePath === artifact.relativePath) || null;
  if (existing) {
    return {
      ...existing,
      url: artifactShareUrl(req, options, existing.token, existing.fileName || path.basename(artifact.relativePath)),
    };
  }

  const requestedTtlMs =
    expiresInHours == null
      ? artifactShareDefaultTtlMs
      : Math.min(
          artifactShareMaxTtlMs,
          Math.max(60 * 60 * 1000, Number.parseFloat(String(expiresInHours)) * 60 * 60 * 1000),
        );
  const createdAt = new Date().toISOString();
  const share = normalizeArtifactShare(projectPath, {
    token: crypto.randomBytes(24).toString("base64url"),
    projectPath,
    relativePath: artifact.relativePath,
    fileName: path.basename(artifact.relativePath),
    createdAt,
    expiresAt: new Date(Date.now() + requestedTtlMs).toISOString(),
  });

  await writeArtifactShares(projectPath, [share, ...activeShares]);
  return {
    ...share,
    url: artifactShareUrl(req, options, share.token, share.fileName),
  };
}

async function revokeArtifactShare(projectPath, tokenOrRelativePath) {
  const allShares = await readArtifactShares(projectPath, { includeExpired: true });
  const needle = pickString(tokenOrRelativePath);
  const nextShares = allShares.filter(
    (share) => share.token !== needle && share.relativePath !== needle,
  );
  await writeArtifactShares(projectPath, nextShares);
  return allShares.length !== nextShares.length;
}

async function findArtifactShare(token) {
  const requestedToken = pickString(token);
  if (!requestedToken) {
    return null;
  }

  const projects = await loadProjectCatalogCached();
  for (const project of projects) {
    const shares = await pruneArtifactShares(project.path);
    const share = shares.find((entry) => entry.token === requestedToken);
    if (share) {
      return {
        project,
        share,
      };
    }
  }
  return null;
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
  const markers = [
    ".git",
    ".clawdad",
    ".claude",
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "requirements.txt",
  ];
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
        detached: Boolean(options.killProcessGroup),
        env: {
          ...process.env,
          CLAWDAD_ROOT: clawdadRoot,
          CLAWDAD_HOME: clawdadHome,
          ...(options.env || {}),
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
        const killChild = (signal) => {
          if (options.killProcessGroup && child.pid) {
            try {
              process.kill(-child.pid, signal);
              return;
            } catch (_error) {
              // Fall back to the direct child when the process group is already gone.
            }
          }
          child.kill(signal);
        };

        timeoutId = setTimeout(() => {
          timedOut = true;
          killChild("SIGTERM");
          killTimer = setTimeout(() => {
            killChild("SIGKILL");
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
        ...(options.env || {}),
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

async function runClawdad(args, options = {}) {
  return runExec(clawdadBin, args, options);
}

async function runOrp(args, options = {}) {
  return runExec(defaultOrpBinary, args, options);
}

async function startDetached(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: clawdadRoot,
      env: {
        ...process.env,
        CLAWDAD_ROOT: clawdadRoot,
        CLAWDAD_HOME: clawdadHome,
        ...(options.env || {}),
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

async function startClawdadDetached(args, options = {}) {
  return startDetached(clawdadBin, args, options);
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

async function resolveProjectForArtifacts(projectInput, defaultProject) {
  const resolved = await resolveProjectForDelegate(projectInput, defaultProject);
  if (!resolved.projectPath || !resolved.projectDetails) {
    return {
      projectPath: resolved.projectPath || "",
      projectDetails: null,
    };
  }
  return resolved;
}

async function handleArtifactsGet(req, res, options, url, actor) {
  const project = (url.searchParams.get("project") || options.defaultProject || "").trim();
  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
    return;
  }

  let resolved;
  try {
    resolved = await resolveProjectForArtifacts(project, options.defaultProject);
  } catch (error) {
    json(res, 500, { ok: false, actor, error: error.message });
    return;
  }

  if (!resolved.projectPath || !resolved.projectDetails) {
    json(res, 404, { ok: false, actor, error: `project '${project}' is not tracked` });
    return;
  }

  try {
    const artifacts = await listProjectArtifacts(resolved.projectPath, req, options);
    json(res, 200, {
      ok: true,
      actor,
      project: resolved.projectPath,
      projectDetails: resolved.projectDetails,
      artifactRoot: projectArtifactsDir(resolved.projectPath),
      artifacts,
    });
  } catch (error) {
    json(res, 500, {
      ok: false,
      actor,
      project: resolved.projectPath,
      artifacts: [],
      error: error.message,
    });
  }
}

async function handleArtifactDownload(req, res, options, url, actor) {
  const project = (url.searchParams.get("project") || options.defaultProject || "").trim();
  const file = url.searchParams.get("file") || "";
  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
    return;
  }

  let resolved;
  try {
    resolved = await resolveProjectForArtifacts(project, options.defaultProject);
  } catch (error) {
    json(res, 500, { ok: false, actor, error: error.message });
    return;
  }

  if (!resolved.projectPath || !resolved.projectDetails) {
    json(res, 404, { ok: false, actor, error: `project '${project}' is not tracked` });
    return;
  }

  try {
    const artifact = artifactPathFor(resolved.projectPath, file);
    if (artifactIsHidden(artifact.relativePath)) {
      throw new Error("artifact is not downloadable");
    }
    await sendFile(res, artifact.absolutePath, {
      "content-disposition": contentDispositionAttachment(path.basename(artifact.relativePath)),
    });
  } catch (error) {
    const statusCode = /invalid|missing|outside|not downloadable/iu.test(error.message) ? 400 : 404;
    json(res, statusCode, {
      ok: false,
      actor,
      project: resolved.projectPath,
      error: error.message,
    });
  }
}

async function handleArtifactShareCreate(req, res, options, actor) {
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
    resolved = await resolveProjectForArtifacts(project, options.defaultProject);
  } catch (error) {
    json(res, 500, { ok: false, actor, error: error.message });
    return;
  }

  if (!resolved.projectPath || !resolved.projectDetails) {
    json(res, 404, { ok: false, actor, error: `project '${project}' is not tracked` });
    return;
  }

  try {
    const share = await createArtifactShare(
      resolved.projectPath,
      payload.file || payload.relativePath,
      req,
      options,
      payload.expiresInHours,
    );
    const artifacts = await listProjectArtifacts(resolved.projectPath, req, options);
    json(res, 200, {
      ok: true,
      actor,
      project: resolved.projectPath,
      projectDetails: resolved.projectDetails,
      share,
      artifacts,
    });
  } catch (error) {
    json(res, 400, {
      ok: false,
      actor,
      project: resolved.projectPath,
      error: error.message,
    });
  }
}

async function handleArtifactShareRevoke(req, res, options, actor) {
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
    resolved = await resolveProjectForArtifacts(project, options.defaultProject);
  } catch (error) {
    json(res, 500, { ok: false, actor, error: error.message });
    return;
  }

  if (!resolved.projectPath || !resolved.projectDetails) {
    json(res, 404, { ok: false, actor, error: `project '${project}' is not tracked` });
    return;
  }

  try {
    const revoked = await revokeArtifactShare(
      resolved.projectPath,
      pickString(payload.token, payload.file, payload.relativePath),
    );
    const artifacts = await listProjectArtifacts(resolved.projectPath, req, options);
    json(res, 200, {
      ok: true,
      actor,
      project: resolved.projectPath,
      projectDetails: resolved.projectDetails,
      revoked,
      artifacts,
    });
  } catch (error) {
    json(res, 400, {
      ok: false,
      actor,
      project: resolved.projectPath,
      error: error.message,
    });
  }
}

async function handlePublicArtifactShare(req, res, options, url) {
  if (req.method !== "GET" || !url.pathname.startsWith("/share/")) {
    return false;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const token = parts[1] ? decodeURIComponent(parts[1]) : "";
  if (!token) {
    send(res, 404, responseBodyForStatusCode(404), {
      "content-type": "text/plain; charset=utf-8",
    });
    return true;
  }

  try {
    const resolved = await findArtifactShare(token);
    if (!resolved?.project?.path || !resolved.share?.relativePath) {
      send(res, 404, responseBodyForStatusCode(404), {
        "content-type": "text/plain; charset=utf-8",
      });
      return true;
    }

    const artifact = artifactPathFor(resolved.project.path, resolved.share.relativePath);
    await sendFile(res, artifact.absolutePath, {
      "content-disposition": contentDispositionAttachment(
        resolved.share.fileName || path.basename(artifact.relativePath),
      ),
      "x-robots-tag": "noindex, nofollow",
    });
  } catch (_error) {
    send(res, 404, responseBodyForStatusCode(404), {
      "content-type": "text/plain; charset=utf-8",
    });
  }

  return true;
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

  const result = await runExec(process.execPath, args, {
    ignoreStdin: true,
    killProcessGroup: true,
    timeoutMs: importableSessionDiscoveryTimeoutMs,
  });
  if (!result.ok) {
    const message = result.timedOut
      ? "timed out while looking for local Codex sessions"
      : result.stderr || result.stdout || "failed to discover local Codex sessions";
    throw new Error(message);
  }
  const payload = parseJsonResult(result, "codex session discovery");
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  return sessions.map((session) => importableCodexSessionView(session, projectDetails.path));
}

function uniqueImportedSessionSlug(importableSession = {}, projectDetails = {}, projectPath = "") {
  const fallbackTitle = path.basename(projectPath || projectDetails?.path || "") || "Codex session";
  const base = normalizeImportedSessionTitle(
    pickString(importableSession.titleHint, importableSession.preview, importableSession.label),
    fallbackTitle,
  );
  const used = new Set(
    (Array.isArray(projectDetails?.sessions) ? projectDetails.sessions : [])
      .map((session) => pickString(session?.slug))
      .filter(Boolean),
  );
  if (!used.has(base)) {
    return base;
  }

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base} ${suffix}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }

  return `${base} ${Date.now()}`;
}

async function registerImportedSessionLocally(projectPath, importableSession, projectDetails = {}) {
  const sessionId = pickString(importableSession?.sessionId);
  if (!projectPath || !sessionId) {
    throw new Error("missing imported session details");
  }
  const slug = uniqueImportedSessionSlug(importableSession, projectDetails, projectPath);
  const now = new Date().toISOString();

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
    statePayload.version = Number.parseInt(String(statePayload.version || "3"), 10) || 3;
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
    const existingSession =
      existingSessions[sessionId] && typeof existingSessions[sessionId] === "object"
        ? existingSessions[sessionId]
        : {};

    statePayload.projects[projectPath] = {
      status: pickString(existingProject.status, "idle"),
      last_dispatch: existingProject.last_dispatch ?? null,
      last_response: existingProject.last_response ?? null,
      dispatch_count: Number.parseInt(String(existingProject.dispatch_count || "0"), 10) || 0,
      registered_at: pickString(existingProject.registered_at, now),
      ...existingProject,
      active_session_id: sessionId,
      sessions: {
        ...existingSessions,
        [sessionId]: {
          slug: pickString(existingSession.slug, slug),
          provider: "codex",
          provider_session_seeded: "true",
          tracked_at: pickString(existingSession.tracked_at, now),
          last_selected_at: now,
          dispatch_count: Number.parseInt(String(existingSession.dispatch_count || "0"), 10) || 0,
          last_dispatch: existingSession.last_dispatch ?? null,
          last_response: existingSession.last_response ?? null,
          status: pickString(existingSession.status, "idle"),
          local_only: "true",
          orp_error: pickString(existingSession.orp_error),
        },
      },
    };

    await writeJsonFile(stateFilePath, statePayload);
    return statePayload;
  });
}

async function registerProjectSessionLocally(projectPath, {
  sessionId = crypto.randomUUID(),
  slug = "",
  provider = "codex",
  providerSessionSeeded = "false",
  status = "idle",
} = {}) {
  const normalizedSessionId = pickString(sessionId, crypto.randomUUID());
  const normalizedProvider = pickString(provider, "codex").toLowerCase();
  const normalizedSlug = normalizeImportedSessionTitle(
    pickString(slug),
    path.basename(projectPath || "") || "Codex session",
  );
  const now = new Date().toISOString();

  await mkdir(path.join(projectPath, ".clawdad", "mailbox"), { recursive: true });
  const statusFile = mailboxPaths(projectPath).statusFile;
  if (!(await fileExists(statusFile))) {
    await writeJsonFile(statusFile, {
      state: status,
      request_id: null,
      session_id: null,
      error: null,
      pid: null,
    });
  }

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
    statePayload.version = Number.parseInt(String(statePayload.version || "3"), 10) || 3;
    if (!statePayload.orp_workspace) {
      statePayload.orp_workspace = "main";
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
    const existingSession =
      existingSessions[normalizedSessionId] && typeof existingSessions[normalizedSessionId] === "object"
        ? existingSessions[normalizedSessionId]
        : {};

    statePayload.projects[projectPath] = {
      status: pickString(existingProject.status, status),
      last_dispatch: existingProject.last_dispatch ?? null,
      last_response: existingProject.last_response ?? null,
      dispatch_count: Number.parseInt(String(existingProject.dispatch_count || "0"), 10) || 0,
      registered_at: pickString(existingProject.registered_at, now),
      ...existingProject,
      active_session_id: normalizedSessionId,
      sessions: {
        ...existingSessions,
        [normalizedSessionId]: {
          slug: pickString(existingSession.slug, normalizedSlug),
          provider: normalizedProvider,
          provider_session_seeded: pickString(
            existingSession.provider_session_seeded,
            providerSessionSeeded,
          ),
          tracked_at: pickString(existingSession.tracked_at, now),
          last_selected_at: now,
          dispatch_count: Number.parseInt(String(existingSession.dispatch_count || "0"), 10) || 0,
          last_dispatch: existingSession.last_dispatch ?? null,
          last_response: existingSession.last_response ?? null,
          status: pickString(existingSession.status, status),
          local_only: "true",
          orp_error: pickString(existingSession.orp_error),
        },
      },
    };

    await writeJsonFile(stateFilePath, statePayload);
    return {
      statePayload,
      sessionId: normalizedSessionId,
    };
  });
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

  try {
    await registerImportedSessionLocally(resolved.projectPath, importableSession, resolved.projectDetails);
    invalidateProjectCatalogCache();
  } catch (error) {
    json(res, 500, {
      ok: false,
      actor,
      project: resolved.projectPath,
      error: error.message,
    });
    return;
  }

  let refreshedProject = null;
  try {
    const refreshedProjects = await loadProjectCatalogCached({ allowStale: false });
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
  const computeGuard = await evaluateDelegateComputeGuard(initialConfig);
  const initialStatus = await writeDelegateStatus(projectDetails.path, {
    state: computeGuard.blocked ? "blocked" : "planning",
    runId,
    startedAt,
    completedAt: computeGuard.blocked ? new Date().toISOString() : null,
    delegateSessionId: initialConfig.delegateSessionId,
    stepCount: 0,
    maxSteps: initialConfig.maxStepsPerRun,
    computeBudget: computeGuard.budget,
    planSnapshotId: null,
    pauseRequested: false,
    stopReason: computeGuard.blocked ? "compute_limit" : null,
    error: computeGuard.blocked ? computeGuard.message : "",
  });
  if (computeGuard.blocked) {
    await writeDelegateConfig(projectDetails.path, {
      ...initialConfig,
      enabled: false,
    });
    return {
      accepted: false,
      status: initialStatus,
    };
  }

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
        computeBudget: computeGuard.budget,
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
        computeBudget: computeGuard.budget,
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

async function startDelegateSupervisorProcess(projectDetails, status) {
  const runId = pickString(status?.runId) || crypto.randomUUID();
  const startResult = await startDetached(process.execPath, [
    serverModulePath,
    "delegate-supervisor",
    projectDetails.path,
    "--run-id",
    runId,
  ]);
  if (!startResult.ok) {
    throw new Error(startResult.error?.message || "failed to start delegate supervisor");
  }

  const nextStatus = await writeDelegateStatus(projectDetails.path, {
    ...status,
    state: "running",
    runId,
    startedAt: status?.startedAt || new Date().toISOString(),
    completedAt: null,
    supervisorPid: startResult.pid,
    supervisorStartedAt: new Date().toISOString(),
    pauseRequested: false,
    error: "",
  });
  await appendDelegateRunEvent(projectDetails.path, runId, "supervisor_started", {
    title: "Supervisor started",
    text: startResult.pid ? `Supervisor pid ${startResult.pid}` : "Detached supervisor started.",
    state: nextStatus.state,
  }).catch(() => {});

  return {
    accepted: true,
    status: nextStatus,
    pid: startResult.pid || null,
  };
}

async function startDelegateRun(projectDetails) {
  const runningJob = delegateRunJobs.get(projectDetails.path);
  if (runningJob) {
    const currentConfig = await readDelegateConfig(projectDetails.path);
    const currentStatus = await readDelegateStatus(projectDetails.path, { reconcile: false });
    if (shouldClearPendingDelegatePause({ runningJob, currentStatus, currentConfig })) {
      runningJob.pauseRequested = false;
      await writeDelegateConfig(projectDetails.path, {
        ...currentConfig,
        enabled: true,
      });
      const resumedStatus = await writeDelegateStatus(projectDetails.path, {
        ...currentStatus,
        state: "running",
        runId: runningJob.runId || currentStatus.runId,
        startedAt: runningJob.startedAt || currentStatus.startedAt,
        delegateSessionId: runningJob.delegateSessionId || currentStatus.delegateSessionId,
        delegateSessionLabel: runningJob.delegateSessionLabel || currentStatus.delegateSessionLabel,
        completedAt: null,
        pauseRequested: false,
        error: "",
      });
      await appendDelegateRunEvent(projectDetails.path, resumedStatus.runId, "run_resumed", {
        title: "Delegate resumed",
        text: "A pending pause was cleared and the active run kept going.",
        state: resumedStatus.state,
      }).catch(() => {});
      return {
        accepted: true,
        status: resumedStatus,
      };
    }
    return {
      accepted: false,
      status: currentStatus,
    };
  }
  if (delegatePlanJobs.has(projectDetails.path)) {
    return {
      accepted: false,
      status: await readDelegateStatus(projectDetails.path),
    };
  }

  let config = await readDelegateConfig(projectDetails.path);
  const currentStatus = await readDelegateStatus(projectDetails.path, { reconcile: false });
  if (currentStatus.state === "running" && !delegateSupervisorIsLive(currentStatus)) {
    config = await writeDelegateConfig(projectDetails.path, {
      ...config,
      enabled: true,
    });
    await appendDelegateRunEvent(projectDetails.path, currentStatus.runId, "supervisor_interrupted", {
      title: "Supervisor interrupted",
      text: "Status was still running, but no live supervisor was attached. Clawdad is starting a replacement supervisor.",
      state: currentStatus.state,
    }).catch(() => {});
    return startDelegateSupervisorProcess(projectDetails, {
      ...currentStatus,
      pauseRequested: false,
    });
  }
  if (currentStatus.state === "running" && delegateSupervisorIsLive(currentStatus)) {
    return {
      accepted: false,
      status: currentStatus,
    };
  }

  config = await writeDelegateConfig(projectDetails.path, {
    ...config,
    enabled: true,
  });
  const computeGuard = await evaluateDelegateComputeGuard(config);
  if (computeGuard.blocked) {
    const blockedConfig = await writeDelegateConfig(projectDetails.path, {
      ...config,
      enabled: false,
    });
    const blockedStatus = await writeDelegateStatus(projectDetails.path, {
      state: "blocked",
      runId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      delegateSessionId: blockedConfig.delegateSessionId,
      stepCount: 0,
      maxSteps: blockedConfig.maxStepsPerRun,
      computeBudget: computeGuard.budget,
      stopReason: "compute_limit",
      pauseRequested: false,
      error: computeGuard.message,
    });
    await appendDelegateRunEvent(projectDetails.path, blockedStatus.runId, "run_blocked", {
      title: "Paused near compute reserve",
      text: delegateComputeBudgetLogText(computeGuard.budget) || computeGuard.message,
      state: blockedStatus.state,
      stopReason: "compute_limit",
      computeBudget: computeGuard.budget,
    }).catch(() => {});
    return {
      accepted: false,
      status: blockedStatus,
    };
  }

  const ensured = await ensureDelegateSession(projectDetails, config);
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const baselineMailboxStatus = await readMailboxStatus(projectDetails.path);
  const initialStatus = await writeDelegateStatus(projectDetails.path, {
    state: "running",
    runId,
    startedAt,
    delegateSessionId: ensured.session.sessionId,
    delegateSessionLabel: sessionDisplayForStatus(ensured.session),
    stepCount: 0,
    maxSteps: ensured.config.maxStepsPerRun,
    computeBudget: computeGuard.budget,
    planSnapshotId: null,
    activeRequestId: null,
    lastRequestId: pickString(baselineMailboxStatus.request_id) || null,
    supervisorPid: null,
    supervisorStartedAt: null,
    pauseRequested: false,
    error: "",
  });

  return startDelegateSupervisorProcess(ensured.projectDetails, initialStatus);
}

async function resumeActiveDelegateSupervisors() {
  const projects = await loadProjectCatalogCached().catch(() => []);
  for (const project of projects) {
    if (!project?.path) {
      continue;
    }
    try {
      const [config, status] = await Promise.all([
        readDelegateConfig(project.path),
        readDelegateStatus(project.path, { reconcile: false }),
      ]);
      if (delegateStatusNeedsSupervisor(status, config)) {
        await startDelegateRun(project);
      }
    } catch (error) {
      await appendDelegateRunEvent(project.path, null, "supervisor_resume_failed", {
        title: "Supervisor resume failed",
        error: error.message,
      }).catch(() => {});
    }
  }
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
    const configPatch = payload.config && typeof payload.config === "object" ? payload.config : {};
    if (
      configPatch.computeReservePercent != null ||
      payload.computeReservePercent != null ||
      configPatch.maxStepsPerRun != null ||
      payload.maxStepsPerRun != null
    ) {
      const currentConfig = await readDelegateConfig(resolved.projectPath);
      await writeDelegateConfig(resolved.projectPath, {
        ...currentConfig,
        computeReservePercent:
          configPatch.computeReservePercent ?? payload.computeReservePercent ?? currentConfig.computeReservePercent,
        maxStepsPerRun:
          configPatch.maxStepsPerRun ?? payload.maxStepsPerRun ?? currentConfig.maxStepsPerRun,
      });
    }
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
      const pauseResult = await pauseDelegateRun(resolved.projectDetails);
      const delegatePayload = await buildDelegatePayload(resolved.projectDetails);
      json(res, 200, {
        ok: true,
        actor,
        action,
        project: resolved.projectPath,
        projectDetails: resolved.projectDetails,
        ...delegatePayload,
        accepted: pauseResult.accepted,
        config: pauseResult.config,
        status: pauseResult.status,
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

async function handleDelegateRunLogGet(_req, res, options, url, actor) {
  const project = (url.searchParams.get("project") || options.defaultProject || "").trim();
  const requestedRunId = pickString(url.searchParams.get("runId"));
  const cursor = url.searchParams.get("cursor") || "0";
  const limit = url.searchParams.get("limit") || String(delegateRunEventPageLimit);

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
    const [status, summarySnapshots] = await Promise.all([
      readDelegateStatus(resolved.projectPath),
      readDelegateRunSummarySnapshots(resolved.projectPath),
    ]);
    const delegateRuns = await readDelegateRunList(resolved.projectPath, {
      status,
      summarySnapshots,
    });
    const runId =
      requestedRunId ||
      pickString(status.runId) ||
      pickString(summarySnapshots[0]?.runId);
    const page = await readDelegateRunEvents(resolved.projectPath, {
      runId,
      cursor,
      limit,
    });
    const resolvedRunId = page.runId || runId || "";
    const statusEvent = delegateStatusRunEvent(status, resolvedRunId, page.events);
    const events = statusEvent ? [...page.events, statusEvent] : page.events;
    json(res, 200, {
      ok: true,
      actor,
      project: resolved.projectPath,
      projectDetails: resolved.projectDetails,
      runId: resolvedRunId,
      status,
      events,
      nextCursor: page.nextCursor,
      total: page.total + (statusEvent ? 1 : 0),
      delegateRuns,
      latestRunSummarySnapshot:
        summarySnapshots.find((snapshot) => snapshot.runId === resolvedRunId) ||
        summarySnapshots[0] ||
        null,
      runSummarySnapshots: summarySnapshots,
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

async function handleDelegateRunSummaryCreate(req, res, options, actor) {
  let payload;
  try {
    payload = await parseDispatchPayload(req, options.bodyLimitBytes);
  } catch (error) {
    json(res, 400, { ok: false, error: error.message });
    return;
  }

  const project = projectFromPayload(payload, options.defaultProject);
  const requestedRunId = pickString(payload.runId);
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
    const [status, existingSnapshots] = await Promise.all([
      readDelegateStatus(resolved.projectPath),
      readDelegateRunSummarySnapshots(resolved.projectPath),
    ]);
    const runId =
      requestedRunId ||
      pickString(status.runId) ||
      pickString(existingSnapshots[0]?.runId);
    if (!runId) {
      json(res, 400, {
        ok: false,
        actor,
        project: resolved.projectPath,
        error: "No delegate run is available to summarize yet.",
      });
      return;
    }

    const result = await generateDelegateRunSummarySnapshot(resolved.projectDetails, runId);
    json(res, 200, {
      ok: true,
      actor,
      project: resolved.projectPath,
      projectDetails: resolved.projectDetails,
      runId,
      status,
      latestRunSummarySnapshot: result.snapshot,
      runSummarySnapshots: result.snapshots,
      sourceEventCount: result.events.length,
    });
  } catch (error) {
    const statusCode = /No delegate run events/iu.test(error.message) ? 400 : 500;
    json(res, statusCode, {
      ok: false,
      actor,
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
  const requestedSlug = pickString(payload.slug);

  let registeredSessionId = "";
  try {
    const registration = await registerProjectSessionLocally(projectPath, {
      slug: requestedSlug || path.basename(projectPath),
      provider,
      providerSessionSeeded: "false",
    });
    registeredSessionId = registration.sessionId;
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
      (existingProject
        ? `Added ${provider} session to ${projectDetails?.displayName || projectPath}`
        : `Registered ${projectDetails?.displayName || projectPath}`),
    registeredSessionId,
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

    if (await handlePublicArtifactShare(req, res, options, url)) {
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

    if (req.method === "GET" && url.pathname === "/v1/artifacts") {
      await handleArtifactsGet(req, res, options, url, auth.actor);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/artifacts/download") {
      await handleArtifactDownload(req, res, options, url, auth.actor);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/artifacts/share") {
      await handleArtifactShareCreate(req, res, options, auth.actor);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/artifacts/revoke") {
      await handleArtifactShareRevoke(req, res, options, auth.actor);
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

    if (req.method === "GET" && url.pathname === "/v1/delegate/run-log") {
      await handleDelegateRunLogGet(req, res, options, url, auth.actor);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/delegate/run-summary") {
      await handleDelegateRunSummaryCreate(req, res, options, auth.actor);
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
  resumeActiveDelegateSupervisors().catch((error) => {
    console.warn(`[clawdad-server] delegate supervisor resume sweep failed: ${error.message}`);
  });
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
    case "delegate-run":
    case "delegate-start":
      await runDelegateRun(rest);
      break;
    case "delegate-supervisor":
      await runDelegateSupervisor(rest);
      break;
    case "delegate-pause":
    case "delegate-stop":
      await runDelegatePause(rest);
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
