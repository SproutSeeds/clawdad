#!/usr/bin/env node

import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { accessSync, closeSync, constants as fsConstants, createReadStream, openSync } from "node:fs";
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
  classifyDelegateLaneOverlap,
  defaultDelegateLaneId,
  delegatePauseDecision,
  delegateLaneIsDefault,
  delegatePlanRefreshDecision,
  delegatePostStepPlanRefreshDecision,
  delegateDispatchStallDecision,
  delegateRunListState,
  delegateStrategyBreakoutDecision,
  delegateStatusStepText,
  delegateWatchtowerReviewDecision,
  normalizeDelegateLaneId,
  recoverableCodexStreamDisconnect,
  shouldClearPendingDelegatePause,
} from "./delegate-state.mjs";
import {
  buildCodexIntegrationReport,
  handleCodexHookInput,
  installCodexIntegration,
} from "./codex-integration.mjs";
import {
  createTtsAudioId,
  ensureCachedTtsAudio,
  readTtsManifest,
  resolveElevenLabsApiKey,
  resolveTtsRuntimeConfig,
  ttsAudioFilePath,
} from "./tts-cache.mjs";

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
const staleDispatchDeadWorkerGraceMs = parseNonNegativeMs(
  process.env.CLAWDAD_STALE_DISPATCH_DEAD_WORKER_GRACE_MS,
  2 * 60 * 1000,
);
const codexGoalSyncTimeoutMs = parseNonNegativeMs(
  process.env.CLAWDAD_CODEX_GOAL_SYNC_TIMEOUT_MS,
  750,
);
const codexGoalMode = normalizeCodexGoalMode(process.env.CLAWDAD_CODEX_GOALS);
const launchAgentLabelDefault = "com.sproutseeds.clawdad.server";
const systemdUnitNameDefault = "clawdad-server.service";
const stateFilePath = path.join(clawdadHome, "state.json");
const quickPromptTitleMax = 80;
const quickPromptTextMax = 12_000;
const quickPromptMaxCount = 80;
const defaultQuickPromptDefinitions = [
  {
    id: "next-steps",
    title: "Next steps",
    text: "Please identify the highest level next steps for this project implementation and goal completion.",
  },
  {
    id: "project-update",
    title: "Project update",
    text: "Update me on this project.",
  },
  {
    id: "session-cleanup",
    title: "Session cleanup",
    text: "Make sure this project is cleaned up: run the appropriate Clawdad/Codex session health checks, repair safe stale state, and report any remaining quarantined, failed, or blocked sessions.",
  },
  {
    id: "validation-pass",
    title: "Validation pass",
    text: "Review the current worktree and recent project context, run the relevant validation, and tell me the smallest safe next implementation slice.",
  },
];
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
function resolveDefaultChimeraBinary() {
  if (process.env.CLAWDAD_CHIMERA) {
    return process.env.CLAWDAD_CHIMERA;
  }
  const executableExists = (candidate) => {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  const siblingDebug = path.resolve(clawdadRoot, "..", "Chimera", "target", "debug", "chimera");
  if (executableExists(siblingDebug)) {
    return siblingDebug;
  }
  const siblingRelease = path.resolve(clawdadRoot, "..", "Chimera", "target", "release", "chimera");
  if (executableExists(siblingRelease)) {
    return siblingRelease;
  }
  return "chimera";
}
const defaultTailscaleBinary = process.env.CLAWDAD_TAILSCALE || "tailscale";
const defaultCodexBinary = process.env.CLAWDAD_CODEX || "codex";
const defaultChimeraBinary = resolveDefaultChimeraBinary();
const defaultChimeraModel = process.env.CLAWDAD_CHIMERA_MODEL || "local";
const defaultOrpBinary = process.env.CLAWDAD_ORP || "orp";
const defaultSqliteBinary = process.env.CLAWDAD_SQLITE || "sqlite3";
const watchtowerSqliteBusyTimeoutMs = parseNonNegativeMs(
  process.env.CLAWDAD_WATCHTOWER_SQLITE_BUSY_TIMEOUT_MS,
  20_000,
);
const watchtowerSqliteExecTimeoutMs = parseNonNegativeMs(
  process.env.CLAWDAD_WATCHTOWER_SQLITE_EXEC_TIMEOUT_MS,
  45_000,
);
const watchtowerSqlBatchMaxEvents = 40;
const watchtowerSqlBatchMaxBytes = 1_000_000;
const watchtowerSqliteVacuumMinFreePages = parseNonNegativeMs(
  process.env.CLAWDAD_WATCHTOWER_SQLITE_VACUUM_MIN_FREE_PAGES,
  8192,
);
const watchtowerSqliteVacuumMinFreeRatio = (() => {
  const parsed = Number.parseFloat(String(process.env.CLAWDAD_WATCHTOWER_SQLITE_VACUUM_MIN_FREE_RATIO || ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.25;
})();
const watchtowerIndexCodexEvents = boolFromUnknown(
  process.env.CLAWDAD_WATCHTOWER_INDEX_CODEX_EVENTS,
  false,
);
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
const projectSessionAutoImportTtlMs = parseNonNegativeMs(
  process.env.CLAWDAD_PROJECT_SESSION_AUTO_IMPORT_TTL_MS,
  30_000,
);
const projectCatalogCache = {
  value: null,
  loadedAt: 0,
  promise: null,
};
const projectSessionAutoImportCache = new Map();
let projectSessionAutoImportCatalogPromise = null;
const transcriptPathCacheTtlMs = 60_000;
const transcriptPathCache = new Map();
const codexSessionBindingCache = new Map();
const transcriptTurnCache = new Map();
const projectSummarySnapshotLimit = 12;
const projectSummaryHistoryPerSessionLimit = 12;
const projectSummaryHistoryTotalLimit = 24;
const recentHistoryDefaultLimit = 24;
const recentHistoryMaxLimit = 50;
const recentHistoryDefaultSessionLimit = 10;
const recentHistoryMaxSessionLimit = 30;
const recentHistoryDefaultPerSessionLimit = 4;
const recentHistoryMaxPerSessionLimit = 10;
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
const delegateDispatchStallTimeoutMs = parseNonNegativeMs(
  process.env.CLAWDAD_DELEGATE_DISPATCH_STALL_TIMEOUT_MS,
  45 * 60 * 1000,
);
const delegateDispatchPauseStallTimeoutMs = parseNonNegativeMs(
  process.env.CLAWDAD_DELEGATE_DISPATCH_PAUSE_STALL_TIMEOUT_MS,
  5 * 60 * 1000,
);
const delegateDispatchStartTimeoutMs = parseNonNegativeMs(
  process.env.CLAWDAD_DELEGATE_DISPATCH_START_TIMEOUT_MS,
  120_000,
);
const delegateDispatchStartReconcileMs = parseNonNegativeMs(
  process.env.CLAWDAD_DELEGATE_DISPATCH_START_RECONCILE_MS,
  15_000,
);
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
const ttsPrepareJobs = new Map();
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
  clawdad lanes [project] [--json]
  clawdad lane-create [project] <laneId> [--display-name <name>] [--objective <text>] [--scope <glob>]... [--json]
  clawdad delegate [project] [--lane <laneId>] [--json]
  clawdad delegate-set [project] [text] [--lane <laneId>] [--file <path> | --stdin] [--session <session>] [--json]
                         [--compute-reserve-percent <0-100>] [--max-steps-per-run <n|unlimited>]
                         [--watchtower-review-mode <off|log|enforce>] [--direction-check-mode <off|observe|advise|enforce>]
  clawdad go [project] [--json]
  clawdad delegate-run [project] [--lane <laneId>] [--dry-run] [--json]
  clawdad supervise [project] --lane <laneId> [--once] [--daemon] [--interval <seconds>] [--max-runs <n>] [--dry-run] [--json]
  clawdad delegate-pause [project] [--lane <laneId>] [--json]
  clawdad delegate-reset [project] [--lane <laneId>] [--json]
  clawdad sessions-doctor [project] [--repair] [--json]
  clawdad codex <install|doctor> [project] [--force] [--dry-run] [--json]
  clawdad watchtower [project] [--once] [--interval <seconds>] [--json]
  clawdad feed tail [project] [--limit <n>] [--json]
  clawdad feed search [project] <query> [--limit <n>] [--json]
  clawdad feed review [project] [--limit <n>] [--json]
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

  lanes
    List delegate lanes for one tracked project.

  lane-create
    Create or update a named delegate lane under one tracked project.

  delegate-set
    Update the saved delegate brief and delegate guardrails for one tracked project.
    Delegates default to semantic runs with no step cap; --max-steps-per-run is ignored unless CLAWDAD_ENABLE_DELEGATE_STEP_CAPS=1.
    Watchtower review is off by default; use log for advisory review or enforce for blocking review.

  delegate-run
    Start autonomous Codex delegate mode for one tracked project.

  supervise
    Opt into continuity orchestration for one delegate lane. The supervisor only restarts bounded delegate runs after ORP and compute gates pass.

  go
    Friendly alias for delegate-run after ORP confirms a safe continuation.

  delegate-pause
    Ask an active delegate run to pause after the current step.

  delegate-reset
    Reset the delegate brief back to the default project template.

  sessions-doctor
    Audit tracked project sessions and delegate lanes for stale/quarantined state.
    Add --repair to clear non-live active pointers and stop orphaned delegate runs without deleting data.

  codex
    Install or audit the project-local Codex hooks, skills, plugin, and AGENTS integration pack.

  watchtower
    Observe delegate runs read-only and index review-worthy updates.

  feed
    Read the Watchtower review feed: tail, search, or review queue.

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
  --codex-home <path>          Codex home for integration doctor checks (default: ${defaultCodexHome})

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
  --live-app <name=url>        Add a live app health URL to verify (repeatable)
  --service-host-tag <tag>     Expected Tailscale Service host tag (default: tag:live-app-host)
  --service-host-socket <path> Isolated Tailscale service-host socket to verify

service unit options:
  --label <label>              launchd label (default: ${launchAgentLabelDefault})
  --systemd-name <name>        systemd user unit name (default: ${systemdUnitNameDefault})
  --path <path>                Output plist path
  --stdout-log <path>          Stdout log path
  --stderr-log <path>          Stderr log path

gen-token options:
  --write                      Write the token to the token file and chmod 600 it

codex options:
  --force                      Overwrite unmanaged generated skill/hook/plugin files where needed
  --dry-run                    Show planned writes without modifying files
`);
}

function parseArgs(argv) {
  const options = { _: [], allowUser: [], liveApp: [], scope: [] };

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
      case "--once":
      case "--daemon":
      case "--dry-run":
      case "--repair":
      case "--force":
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
      case "--live-app": {
        const value = argv[index + 1];
        if (value == null) {
          throw new Error(`missing value for ${arg}`);
        }
        options.liveApp.push(value);
        index += 1;
        break;
      }
      case "--scope": {
        const value = argv[index + 1];
        if (value == null) {
          throw new Error(`missing value for ${arg}`);
        }
        options.scope.push(value);
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
      case "--watchtower-review-mode":
      case "--direction-check-mode":
      case "--run-id":
      case "--limit":
      case "--interval":
      case "--max-runs":
      case "--session":
      case "--lane":
      case "--display-name":
      case "--objective":
      case "--https-port":
      case "--shortcut-path":
      case "--label":
      case "--max-steps-per-run":
      case "--systemd-name":
      case "--codex-home":
      case "--path":
      case "--stdout-log":
      case "--service-host-tag":
      case "--service-host-socket":
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

function boundedPositiveInteger(value, fallback, { max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
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

function defaultQuickPrompts() {
  return defaultQuickPromptDefinitions.map((prompt) => ({
    ...prompt,
    builtIn: true,
  }));
}

function normalizeQuickPromptId(value, fallback) {
  const raw = pickString(value, fallback);
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 96);
  return normalized || fallback;
}

function truncateQuickPromptText(value, maxLength) {
  const text = String(value || "").trim();
  return text.length > maxLength ? text.slice(0, maxLength).trim() : text;
}

function normalizeQuickPrompts(value, { fallbackToDefaults = true } = {}) {
  const defaultIds = new Set(defaultQuickPromptDefinitions.map((prompt) => prompt.id));
  const source = Array.isArray(value) ? value : null;
  if (!source) {
    return fallbackToDefaults ? defaultQuickPrompts() : [];
  }

  const usedIds = new Set();
  const prompts = [];
  for (const [index, entry] of source.entries()) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const text = truncateQuickPromptText(pickString(entry.text, entry.prompt), quickPromptTextMax);
    const title = truncateQuickPromptText(pickString(entry.title, entry.name), quickPromptTitleMax);
    if (!text || !title) {
      continue;
    }

    const fallbackId = `quick-prompt-${index + 1}`;
    let id = normalizeQuickPromptId(entry.id, fallbackId);
    if (usedIds.has(id)) {
      let suffix = 2;
      while (usedIds.has(`${id}-${suffix}`)) {
        suffix += 1;
      }
      id = `${id}-${suffix}`;
    }
    usedIds.add(id);

    prompts.push({
      id,
      title,
      text,
      builtIn: entry.builtIn === true || entry.builtin === true || defaultIds.has(id),
    });
    if (prompts.length >= quickPromptMaxCount) {
      break;
    }
  }

  if (prompts.length === 0 && fallbackToDefaults) {
    return defaultQuickPrompts();
  }
  return prompts;
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

function normalizeLiveAppEntry(entry) {
  if (!entry) {
    return null;
  }

  if (typeof entry === "string") {
    const trimmed = entry.trim();
    if (!trimmed) {
      return null;
    }

    const separatorIndex = trimmed.indexOf("=");
    const name = separatorIndex > 0 ? trimmed.slice(0, separatorIndex).trim() : "";
    const url = separatorIndex > 0 ? trimmed.slice(separatorIndex + 1).trim() : trimmed;
    if (!url) {
      return null;
    }

    return {
      name: name || url,
      url,
    };
  }

  if (typeof entry === "object" && !Array.isArray(entry)) {
    const url = pickString(entry.healthUrl, entry.url, entry.publicUrl);
    if (!url) {
      return null;
    }

    return {
      name: pickString(entry.name, entry.slug, entry.service, url),
      url,
    };
  }

  return null;
}

function normalizeLiveApps(...values) {
  const entries = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    if (Array.isArray(value)) {
      entries.push(...value);
      continue;
    }
    if (typeof value === "string") {
      entries.push(...splitCommaSeparated(value));
      continue;
    }
    entries.push(value);
  }

  const liveApps = [];
  const seen = new Set();
  for (const entry of entries) {
    const normalized = normalizeLiveAppEntry(entry);
    if (!normalized) {
      continue;
    }
    const key = `${normalized.name}\n${normalized.url}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    liveApps.push(normalized);
  }
  return liveApps;
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

function tailText(value, maxLength = 6000) {
  const text = trimTrailingNewlines(String(value || ""));
  const limit = Math.max(200, Number.parseInt(String(maxLength || "6000"), 10) || 6000);
  if (text.length <= limit) {
    return text;
  }
  return text.slice(text.length - limit);
}

const delegateDispatchHostAccessMessage =
  "Clawdad needs host-level access to ~/.clawdad and ~/.codex; run outside sandbox or configure writable state paths.";

function hostAccessCheckPayload({ name, label, filePath, ok, error = "", code = "" }) {
  return {
    name,
    label,
    path: filePath,
    ok: Boolean(ok),
    code: pickString(code) || null,
    error: trimTrailingNewlines(String(error || "")) || null,
  };
}

async function checkWritableDirectory(directory, { name, label }) {
  const resolvedDirectory = path.resolve(directory);
  const tempPath = path.join(resolvedDirectory, `.clawdad-write-check.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await mkdir(resolvedDirectory, { recursive: true });
    await writeFile(tempPath, "ok\n", "utf8");
    await rm(tempPath, { force: true });
    return hostAccessCheckPayload({ name, label, filePath: resolvedDirectory, ok: true });
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    return hostAccessCheckPayload({
      name,
      label,
      filePath: resolvedDirectory,
      ok: false,
      error: error.message,
      code: error.code,
    });
  }
}

async function checkAtomicWriteTarget(filePath, { name, label }) {
  const resolvedFile = path.resolve(filePath);
  const directory = path.dirname(resolvedFile);
  const tempBase = `.${path.basename(resolvedFile)}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const tempPath = path.join(directory, tempBase);
  const renamedTempPath = path.join(directory, `${tempBase}.rename`);
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(tempPath, "ok\n", "utf8");
    await rename(tempPath, renamedTempPath);
    await rm(renamedTempPath, { force: true });
    return hostAccessCheckPayload({ name, label, filePath: resolvedFile, ok: true });
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    await rm(renamedTempPath, { force: true }).catch(() => {});
    return hostAccessCheckPayload({
      name,
      label,
      filePath: resolvedFile,
      ok: false,
      error: error.message,
      code: error.code,
    });
  }
}

async function checkReadableFileIfPresent(filePath, { name, label }) {
  const resolvedFile = path.resolve(filePath);
  try {
    await readFile(resolvedFile, "utf8");
    return hostAccessCheckPayload({ name, label, filePath: resolvedFile, ok: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return hostAccessCheckPayload({ name, label, filePath: resolvedFile, ok: true });
    }
    return hostAccessCheckPayload({
      name,
      label,
      filePath: resolvedFile,
      ok: false,
      error: error.message,
      code: error.code,
    });
  }
}

async function checkReadableDirectoryIfPresent(directory, { name, label }) {
  const resolvedDirectory = path.resolve(directory);
  try {
    await readdir(resolvedDirectory);
    return hostAccessCheckPayload({ name, label, filePath: resolvedDirectory, ok: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return hostAccessCheckPayload({ name, label, filePath: resolvedDirectory, ok: true });
    }
    return hostAccessCheckPayload({
      name,
      label,
      filePath: resolvedDirectory,
      ok: false,
      error: error.message,
      code: error.code,
    });
  }
}

function summarizeHostAccessReport(report = {}) {
  const failures = Array.isArray(report.checks) ? report.checks.filter((check) => !check.ok) : [];
  if (failures.length === 0) {
    return "";
  }
  const details = failures
    .map((check) => `${check.label || check.name}: ${check.error || check.code || "not writable"} (${check.path})`)
    .join("; ");
  return `${delegateDispatchHostAccessMessage} Failed checks: ${details}`;
}

async function buildDelegateDispatchHostAccessReport(projectPath = "", laneId = defaultDelegateLaneId) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  const paths = projectPath ? delegatePaths(projectPath, normalizedLaneId) : null;
  const codexSessionsDir = path.join(defaultCodexHome, "sessions");
  const checks = [
    await checkWritableDirectory(clawdadHome, {
      name: "clawdad_home_write",
      label: "Write CLAWDAD_HOME",
    }),
    await checkAtomicWriteTarget(stateFilePath, {
      name: "state_file_atomic_write",
      label: "Atomic write Clawdad state file",
    }),
    await checkReadableFileIfPresent(stateFilePath, {
      name: "state_file_read",
      label: "Read Clawdad state file",
    }),
    await checkWritableDirectory(codexSessionsDir, {
      name: "codex_sessions_write",
      label: "Write Codex sessions directory",
    }),
    await checkReadableDirectoryIfPresent(codexSessionsDir, {
      name: "codex_sessions_read",
      label: "Read Codex sessions directory",
    }),
  ];

  if (paths) {
    checks.push(
      await checkAtomicWriteTarget(path.join(paths.mailboxDir, "status.json"), {
        name: "mailbox_status_atomic_write",
        label: "Atomic write delegate mailbox status",
      }),
      await checkWritableDirectory(paths.artifactsDir, {
        name: "delegate_artifacts_write",
        label: "Write delegate artifacts directory",
      }),
      await checkWritableDirectory(paths.runsDir, {
        name: "delegate_runs_write",
        label: "Write delegate runs directory",
      }),
    );
  }

  const ok = checks.every((check) => check.ok);
  return {
    ok,
    message: ok ? "" : summarizeHostAccessReport({ checks }),
    clawdadHome,
    stateFile: stateFilePath,
    codexHome: defaultCodexHome,
    codexSessionsDir,
    projectPath: projectPath || null,
    laneId: normalizedLaneId,
    mailboxDir: paths?.mailboxDir || null,
    artifactsDir: paths?.artifactsDir || null,
    checks,
  };
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

function delegateCatalogStatusIsLive(status = {}) {
  const state = pickString(status?.state).toLowerCase();
  return state === "planning" || state === "starting" || state === "dispatching" || state === "running";
}

function compareProjects(left, right) {
  const leftFeatured = Boolean(left?.featured);
  const rightFeatured = Boolean(right?.featured);
  if (leftFeatured !== rightFeatured) {
    return leftFeatured ? -1 : 1;
  }

  const leftLive = delegateCatalogStatusIsLive(left?.delegateStatus);
  const rightLive = delegateCatalogStatusIsLive(right?.delegateStatus);
  if (leftLive !== rightLive) {
    return leftLive ? -1 : 1;
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

async function appBuildVersion() {
  const files = [
    path.join(webAppRoot, "index.html"),
    path.join(webAppRoot, "app.css"),
    path.join(webAppRoot, "app.js"),
  ];
  const stats = await Promise.all(files.map((file) => stat(file)));
  const newestMtime = Math.max(...stats.map((entry) => Math.round(entry.mtimeMs)));
  const totalSize = stats.reduce((sum, entry) => sum + entry.size, 0);
  return `${version}-${newestMtime.toString(36)}-${totalSize.toString(36)}`.replace(/[^A-Za-z0-9._-]/g, "_");
}

async function sendAppIndex(res) {
  try {
    const [file, buildVersion] = await Promise.all([
      readFile(path.join(webAppRoot, "index.html"), "utf8"),
      appBuildVersion(),
    ]);
    send(
      res,
      200,
      file
        .replaceAll("__CLAWDAD_APP_BUILD_VALUE__", buildVersion)
        .replaceAll("__CLAWDAD_ASSET_VERSION__", buildVersion),
      {
        "content-type": "text/html; charset=utf-8",
      },
    );
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
  const stateProvider = pickString(sessionState.provider_override, sessionState.provider).toLowerCase();
  const tabProvider = String(tab?.resumeTool || "").trim().toLowerCase();
  const provider = activeProviders.has(stateProvider)
    ? stateProvider
    : activeProviders.has(tabProvider)
      ? tabProvider
      : "codex";

  return {
    slug: String(tab?.title || "").trim() || basenameOrFallback(String(tab?.path || "").trim()),
    path: String(tab?.path || "").trim(),
    provider,
    sessionId: sessionId || null,
    active: Boolean(sessionId && sessionId === activeSessionId),
    status: String(sessionState.status || "").trim() || "idle",
    dispatchCount: Number.parseInt(sessionState.dispatch_count || "0", 10) || 0,
    lastDispatch: String(sessionState.last_dispatch || "").trim() || null,
    lastResponse: String(sessionState.last_response || "").trim() || null,
    providerSessionTimestamp: pickString(sessionState.provider_session_timestamp) || null,
    providerLastActivity: pickString(sessionState.provider_last_activity) || null,
    providerSessionSource: pickString(sessionState.provider_session_source) || null,
    lastSelectedAt: pickString(sessionState.last_selected_at) || null,
    trackedAt: pickString(sessionState.tracked_at) || null,
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
    providerSessionTimestamp: pickString(sessionState.provider_session_timestamp) || null,
    providerLastActivity: pickString(sessionState.provider_last_activity) || null,
    providerSessionSource: pickString(sessionState.provider_session_source) || null,
    lastSelectedAt: pickString(sessionState.last_selected_at) || null,
    trackedAt: pickString(sessionState.tracked_at) || null,
    providerSessionSeeded: pickString(sessionState.provider_session_seeded, "true") === "true",
    localOnly: pickString(sessionState.local_only) === "true",
  };
}

function projectQuarantinedSessionIds(stateEntry = {}) {
  const quarantinedSessions =
    stateEntry?.quarantined_sessions && typeof stateEntry.quarantined_sessions === "object"
      ? stateEntry.quarantined_sessions
      : {};
  return new Set(Object.keys(quarantinedSessions).filter(Boolean));
}

function stateSessionIsQuarantined(stateEntry = {}, sessionId = "", sessionState = {}) {
  const normalizedSessionId = pickString(sessionId);
  if (!normalizedSessionId) {
    return false;
  }
  return (
    projectQuarantinedSessionIds(stateEntry).has(normalizedSessionId) ||
    pickString(sessionState?.quarantined).toLowerCase() === "true"
  );
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
    (tab) => {
      const sessionId = String(tab?.resumeSessionId || "").trim();
      return sessionId && !stateSessionIsQuarantined(stateEntry, sessionId);
    },
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
    const provider = pickString(sessionState?.provider).toLowerCase();
    return (
      pickString(sessionId) &&
      !stateSessionIsQuarantined(stateEntry, sessionId, sessionState) &&
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
  )
    .map(sessionWithActivityMetadata)
    .sort(compareProjectSessions(activeSessionId));
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

function statusMeansBusy(value) {
  const status = pickString(value).toLowerCase();
  return status === "running" || status === "dispatched" || status === "dispatching" || status === "starting";
}

function projectCatalogHasBusyStatus(projects = []) {
  if (!Array.isArray(projects)) {
    return false;
  }

  return projects.some((project) => (
    statusMeansBusy(project?.status) ||
    statusMeansBusy(project?.activeSession?.status) ||
    (Array.isArray(project?.sessions) &&
      project.sessions.some((session) => statusMeansBusy(session?.status)))
  ));
}

function projectSessionActivityTime(session = {}) {
  const candidates = [
    session.providerLastActivity,
    session.lastResponse,
    session.lastDispatch,
    session.providerSessionTimestamp,
    session.lastSelectedAt,
  ].map((value) => Date.parse(pickString(value))).filter(Number.isFinite);
  return candidates.length > 0 ? Math.max(...candidates) : 0;
}

function projectSessionActivityAt(session = {}) {
  const activityTime = projectSessionActivityTime(session);
  return activityTime > 0 ? new Date(activityTime).toISOString() : null;
}

function compareProjectSessions(activeSessionId = "") {
  return (left, right) => {
    const leftTime = projectSessionActivityTime(left);
    const rightTime = projectSessionActivityTime(right);
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    const leftActive = pickString(left?.sessionId) === activeSessionId ? 1 : 0;
    const rightActive = pickString(right?.sessionId) === activeSessionId ? 1 : 0;
    if (leftActive !== rightActive) {
      return rightActive - leftActive;
    }
    return pickString(left?.slug).localeCompare(pickString(right?.slug));
  };
}

function sessionWithActivityMetadata(session = {}) {
  return {
    ...session,
    lastActivityAt: projectSessionActivityAt(session),
  };
}

function latestProjectSessionStatus(projectStatus = "idle", sessions = []) {
  const ranked = [...(Array.isArray(sessions) ? sessions : [])]
    .filter((session) => pickString(session.status))
    .sort((left, right) => projectSessionActivityTime(right) - projectSessionActivityTime(left));
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
    (left, right) => projectSessionActivityTime(right) - projectSessionActivityTime(left),
  )[0] || null;

  return {
    ...project,
    activeSession,
    sessions: sessions.map(sessionWithActivityMetadata).sort(compareProjectSessions(project.activeSessionId)),
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
    const provider = pickString(sessionState?.provider).toLowerCase();
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

function mailboxPaths(projectPath, laneId = null) {
  const mailboxDir = laneId
    ? delegatePaths(projectPath, laneId).mailboxDir
    : path.join(projectPath, ".clawdad", "mailbox");
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

  const ageMs = mailboxInactiveAgeMs(status);
  const pid = Number.parseInt(String(status.pid || "0"), 10);
  if (pid > 0 && !processIsLive(pid)) {
    if (
      staleDispatchDeadWorkerGraceMs > 0 &&
      ageMs != null &&
      ageMs < staleDispatchDeadWorkerGraceMs
    ) {
      return "";
    }
    return `Dispatch worker ${pid} is no longer running.`;
  }

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
  const killWorker = (signal) => {
    try {
      process.kill(-pid, signal);
      return;
    } catch (_error) {
      // Detached dispatch workers are process-group leaders, but fall back to
      // the direct child if the process group is already gone.
    }
    try {
      process.kill(pid, signal);
    } catch (_error) {
      // The status repair below is enough to unblock the app if termination fails.
    }
  };
  try {
    killWorker("SIGTERM");
    setTimeout(() => {
      if (processIsLive(pid)) {
        killWorker("SIGKILL");
      }
    }, 2_000).unref?.();
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

async function updateStateForCompletedMailbox(projectPath, sessionId, completedAt) {
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
      status: "completed",
      last_response: completedAt,
      sessions: existingSessions,
    };

    if (sessionId) {
      nextProject.sessions = {
        ...existingSessions,
        [sessionId]: {
          ...existingSession,
          status: "completed",
          last_response: completedAt,
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
  if (
    normalizeHistoryStatus(existing.status) === "answered" &&
    pickString(existing.response)
  ) {
    return;
  }
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

async function updateHistoryForCompletedMailbox(projectPath, status, responseText, completedAt) {
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
  const sessionId = pickString(status.session_id, status.sessionId, existing.sessionId, indexPayload?.sessionId);
  const sentAt = pickString(existing.sentAt, indexPayload?.sentAt, status.dispatched_at, completedAt);
  const nextRecord = {
    ...existing,
    requestId,
    projectPath,
    sessionId,
    sentAt,
    answeredAt: completedAt,
    status: "answered",
    exitCode: 0,
    response: responseText || "",
  };

  await writeJsonFile(recordFile, nextRecord);
  await writeJsonFile(indexFile, {
    requestId,
    sessionId,
    sentAt,
    file: recordFile,
  });
}

async function readAnsweredHistoryForMailboxStatus(projectPath, status = {}) {
  const requestId = pickString(status.request_id, status.requestId);
  if (!requestId) {
    return null;
  }

  const indexFile = path.join(historyPaths(projectPath).requestsDir, `${requestId}.json`);
  const indexPayload = await readOptionalJson(indexFile).catch(() => null);
  const recordFile = pickString(indexPayload?.file);
  if (!recordFile) {
    return null;
  }

  const record = await readOptionalJson(recordFile).catch(() => null);
  if (
    !record ||
    typeof record !== "object" ||
    normalizeHistoryStatus(record.status) !== "answered" ||
    !pickString(record.response)
  ) {
    return null;
  }

  const statusSessionId = pickString(status.session_id, status.sessionId);
  const recordSessionId = pickString(record.sessionId, indexPayload?.sessionId);
  if (statusSessionId && recordSessionId && statusSessionId !== recordSessionId) {
    return null;
  }

  return normalizeHistoryEntry({
    ...record,
    requestId,
    sessionId: recordSessionId || statusSessionId || null,
  });
}

function mailboxResponseLooksLikeStaleFailure(markdown) {
  return /Clawdad marked this dispatch failed because it went stale\./u.test(
    responseBodyFromMailbox(markdown),
  );
}

async function writeCompletedMailboxFromHistory(projectPath, status, historyEntry, laneId = null) {
  const { statusFile, responseFile } = mailboxPaths(projectPath, laneId);
  const requestId = pickString(status.request_id, status.requestId, historyEntry?.requestId);
  const sessionId = pickString(status.session_id, status.sessionId, historyEntry?.sessionId);
  const completedAt = pickString(
    historyEntry?.answeredAt,
    status.completed_at,
    status.completedAt,
    new Date().toISOString(),
  );
  const completedStatus = {
    ...status,
    state: "completed",
    request_id: requestId || null,
    session_id: sessionId || null,
    completed_at: completedAt,
    error: null,
    pid: null,
  };

  await writeTextFile(responseFile, mailboxResponseMarkdown({
    requestId,
    sessionId,
    exitCode: typeof historyEntry?.exitCode === "number" ? historyEntry.exitCode : 0,
    completedAt,
    content: historyEntry?.response || "",
  }));
  await writeJsonFile(statusFile, completedStatus);
  await updateStateForCompletedMailbox(projectPath, sessionId, completedAt).catch(() => {});
  invalidateProjectCatalogCache();
  return completedStatus;
}

async function writeCompletedMailboxFromRecoveredResponse(projectPath, status, recoveredResponse, laneId = null) {
  terminateMailboxWorker(status);

  const { statusFile, responseFile } = mailboxPaths(projectPath, laneId);
  const requestId = pickString(status.request_id, status.requestId);
  const sessionId = pickString(status.session_id, status.sessionId);
  const completedAt = pickString(recoveredResponse?.event?.at, status.completed_at, status.completedAt, new Date().toISOString());
  const responseText = trimTrailingNewlines(String(recoveredResponse?.text || ""));
  const completedStatus = {
    ...status,
    state: "completed",
    request_id: requestId || null,
    session_id: sessionId || null,
    completed_at: completedAt,
    error: null,
    pid: null,
  };

  await writeTextFile(responseFile, mailboxResponseMarkdown({
    requestId,
    sessionId,
    exitCode: 0,
    completedAt,
    content: responseText,
  }));
  await writeJsonFile(statusFile, completedStatus);
  await updateHistoryForCompletedMailbox(projectPath, completedStatus, responseText, completedAt).catch(() => {});
  await updateStateForCompletedMailbox(projectPath, sessionId, completedAt).catch(() => {});
  invalidateProjectCatalogCache();
  return completedStatus;
}

async function repairStaleMailboxStatus(projectPath, status, reason, laneId = null) {
  terminateMailboxWorker(status);

  const answeredHistory = await readAnsweredHistoryForMailboxStatus(projectPath, status);
  if (answeredHistory) {
    return writeCompletedMailboxFromHistory(projectPath, status, answeredHistory, laneId);
  }

  const { statusFile, responseFile } = mailboxPaths(projectPath, laneId);
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

async function reconcileMailboxStatus(projectPath, status = {}, laneId = null) {
  const reason = staleMailboxStatusReason(status);
  if (!reason) {
    return status;
  }

  try {
    return await repairStaleMailboxStatus(projectPath, status, reason, laneId);
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

function historyEntryHasAnsweredResponse(entry) {
  return normalizeHistoryStatus(entry?.status) === "answered" && Boolean(pickString(entry?.response));
}

function historyEntryLooksLikeStaleDispatchFailure(entry) {
  return (
    normalizeHistoryStatus(entry?.status) === "failed" &&
    /Clawdad marked this dispatch failed because it went stale\./u.test(String(entry?.response || ""))
  );
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
  const leftSynthetic = isSyntheticProviderHistoryRequestId(leftRequestId);
  const rightSynthetic = isSyntheticProviderHistoryRequestId(rightRequestId);
  const mixedConcreteAndSynthetic =
    (leftSynthetic && rightRequestId && !rightSynthetic) ||
    (rightSynthetic && leftRequestId && !leftSynthetic);
  if (
    leftRequestId &&
    rightRequestId &&
    leftRequestId !== rightRequestId &&
    !leftSynthetic &&
    !rightSynthetic
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
    Math.abs(leftAnsweredAtMs - rightAnsweredAtMs) > 120_000 &&
    !mixedConcreteAndSynthetic
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
  const leftRank = { answered: 3, failed: 2, queued: 1 }[normalizeHistoryStatus(leftStatus)] || 0;
  const rightRank = { answered: 3, failed: 2, queued: 1 }[normalizeHistoryStatus(rightStatus)] || 0;
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

function chooseAuthoritativeHistoryEntry(left, right) {
  if (historyEntryHasAnsweredResponse(left) && historyEntryLooksLikeStaleDispatchFailure(right)) {
    return left;
  }
  if (historyEntryHasAnsweredResponse(right) && historyEntryLooksLikeStaleDispatchFailure(left)) {
    return right;
  }

  const leftRequestId = pickString(left?.requestId);
  const rightRequestId = pickString(right?.requestId);
  const leftConcrete = leftRequestId && !isSyntheticProviderHistoryRequestId(leftRequestId);
  const rightConcrete = rightRequestId && !isSyntheticProviderHistoryRequestId(rightRequestId);

  if (leftConcrete && !rightConcrete) {
    return left;
  }
  if (rightConcrete && !leftConcrete) {
    return right;
  }
  if (leftConcrete && rightConcrete) {
    return left;
  }
  return left || right || null;
}

function mergeHistoryEntries(left, right) {
  const authoritative = chooseAuthoritativeHistoryEntry(left, right);
  const authoritativeRequestId = pickString(authoritative?.requestId);
  const authoritativeConcrete =
    authoritativeRequestId && !isSyntheticProviderHistoryRequestId(authoritativeRequestId);
  const authoritativeStatus = normalizeHistoryStatus(authoritative?.status);
  const authoritativeTerminal =
    authoritativeConcrete && (authoritativeStatus === "answered" || authoritativeStatus === "failed");

  return normalizeHistoryEntry({
    requestId: choosePreferredHistoryRequestId(left, right),
    projectPath: pickString(left?.projectPath, right?.projectPath) || null,
    sessionId: pickString(left?.sessionId, right?.sessionId) || null,
    sessionSlug: pickString(left?.sessionSlug, right?.sessionSlug) || null,
    provider: pickString(authoritative?.provider, left?.provider, right?.provider, "session"),
    message: String(authoritative?.message || left?.message || right?.message || ""),
    sentAt: chooseEarlierTimestamp(left?.sentAt, right?.sentAt),
    answeredAt: authoritativeTerminal
      ? pickString(authoritative?.answeredAt) || chooseLaterTimestamp(left?.answeredAt, right?.answeredAt)
      : chooseLaterTimestamp(left?.answeredAt, right?.answeredAt),
    status: authoritativeTerminal
      ? authoritativeStatus
      : choosePreferredHistoryStatus(left?.status, right?.status),
    exitCode:
      authoritativeTerminal && typeof authoritative?.exitCode === "number"
        ? authoritative.exitCode
        : typeof left?.exitCode === "number"
        ? left.exitCode
        : typeof right?.exitCode === "number"
          ? right.exitCode
          : null,
    response: authoritativeTerminal && String(authoritative?.response || "").trim()
      ? String(authoritative.response)
      : choosePreferredHistoryResponse(left?.response, right?.response),
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

function codexHistoryRoot() {
  return path.join(path.resolve(defaultCodexHome), "sessions");
}

function codexSourceIsDispatchable(source) {
  const normalized = pickString(source).toLowerCase();
  return normalized === "cli" || normalized === "vscode";
}

async function readFirstJsonLineFromFile(filePath) {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of reader) {
      const trimmed = String(line || "").trim();
      if (!trimmed) {
        continue;
      }
      return JSON.parse(trimmed);
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  return null;
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

async function validateCodexSessionProjectBinding(projectPath, sessionId) {
  const normalizedProjectPath = path.resolve(projectPath || "");
  const normalizedSessionId = pickString(sessionId);
  if (!normalizedProjectPath || !normalizedSessionId) {
    return {
      ok: false,
      reason: "missing_session",
      message: "missing Codex session binding",
    };
  }

  const cacheKey = `${normalizedProjectPath}:${normalizedSessionId}`;
  const cached = codexSessionBindingCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < transcriptPathCacheTtlMs) {
    return cached.result;
  }
  const remember = (result) => {
    codexSessionBindingCache.set(cacheKey, {
      checkedAt: Date.now(),
      result,
    });
    return result;
  };

  const rootDir = codexHistoryRoot();
  const filePath = await findTranscriptFileRecursive(rootDir, (name) => (
    name.endsWith(".jsonl") && name.includes(normalizedSessionId)
  ));
  if (!filePath) {
    return remember({
      ok: false,
      reason: "missing_transcript",
      message: `Codex session ${normalizedSessionId} has no saved transcript under ${rootDir}.`,
    });
  }

  let firstLine;
  try {
    firstLine = await readFirstJsonLineFromFile(filePath);
  } catch (error) {
    return remember({
      ok: false,
      reason: "unreadable_transcript",
      filePath,
      message: `Codex session ${normalizedSessionId} transcript could not be read: ${error.message}`,
    });
  }

  const payload = firstLine?.payload || {};
  const transcriptSessionId = pickString(payload.id);
  if (transcriptSessionId !== normalizedSessionId) {
    return remember({
      ok: false,
      reason: "session_id_mismatch",
      filePath,
      message: `Codex transcript id ${transcriptSessionId || "(missing)"} does not match ${normalizedSessionId}.`,
    });
  }

  const transcriptCwd = pickString(payload.cwd);
  if (!transcriptCwd || path.resolve(transcriptCwd) !== normalizedProjectPath) {
    return remember({
      ok: false,
      reason: "cwd_mismatch",
      filePath,
      cwd: transcriptCwd || null,
      message: `Codex session ${normalizedSessionId} belongs to ${transcriptCwd || "(unknown cwd)"}, not ${normalizedProjectPath}.`,
    });
  }

  const source = pickString(payload.source);
  if (!codexSourceIsDispatchable(source)) {
    return remember({
      ok: false,
      reason: "unsupported_source",
      filePath,
      cwd: transcriptCwd,
      source: source || null,
      message: `Codex session ${normalizedSessionId} has unsupported source ${source || "(missing)"}.`,
    });
  }

  return remember({
    ok: true,
    reason: "",
    filePath,
    cwd: transcriptCwd,
    source,
  });
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

    const phase = pickString(message.phase).toLowerCase();
    if (phase && phase !== "final_answer") {
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
      phase: pickString(payload?.payload?.phase).toLowerCase(),
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

async function readRecentHistoryItems(projects, {
  limit = recentHistoryDefaultLimit,
  sessionLimit = recentHistoryDefaultSessionLimit,
  perSessionLimit = recentHistoryDefaultPerSessionLimit,
} = {}) {
  const targets = [];
  for (const project of Array.isArray(projects) ? projects : []) {
    if (!project?.path || !Array.isArray(project.sessions)) {
      continue;
    }

    for (const session of project.sessions) {
      if (!pickString(session?.sessionId)) {
        continue;
      }
      targets.push({
        project,
        session,
        activityTime: projectSessionActivityTime(session),
        active: pickString(session.sessionId) === pickString(project.activeSessionId),
      });
    }
  }

  targets.sort((left, right) => {
    if (left.activityTime !== right.activityTime) {
      return right.activityTime - left.activityTime;
    }
    if (left.active !== right.active) {
      return left.active ? -1 : 1;
    }
    return pickString(left.session.slug).localeCompare(pickString(right.session.slug));
  });

  const selectedTargets = targets.slice(0, Math.max(1, sessionLimit));
  const pages = await Promise.all(
    selectedTargets.map(async ({ project, session }) => {
      try {
        const page = await readSessionHistoryPage(project.path, session, {
          cursor: 0,
          limit: perSessionLimit,
        });
        return (Array.isArray(page.items) ? page.items : []).map((item) =>
          normalizeHistoryEntry({
            ...item,
            projectPath: project.path,
            sessionId: pickString(item?.sessionId, session.sessionId),
            sessionSlug: pickString(item?.sessionSlug, session.slug),
            provider: pickString(item?.provider, session.provider, project.provider),
          }),
        );
      } catch (_error) {
        return [];
      }
    }),
  );

  const byKey = new Map();
  for (const item of pages.flat()) {
    const key = [
      pickString(item.requestId),
      pickString(item.projectPath),
      pickString(item.sessionId),
      pickString(item.sentAt, item.answeredAt),
      normalizedHistoryMessageText(item.message),
    ].join("::");
    if (!key.trim()) {
      continue;
    }
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeHistoryEntries(existing, item) : item);
  }

  return [...byKey.values()]
    .sort((left, right) => historyItemTimestampMs(right) - historyItemTimestampMs(left))
    .slice(0, limit);
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
    ["--json", "--model", defaultChimeraModel, "--prompt", prompt],
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

function delegateJobKey(projectPath, laneId = defaultDelegateLaneId) {
  return `${projectPath}::${normalizeDelegateLaneId(laneId)}`;
}

function delegateLaneRoot(projectPath) {
  return path.join(projectPath, ".clawdad", "delegate");
}

function delegatePaths(projectPath, laneId = defaultDelegateLaneId) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  const rootDir = delegateLaneRoot(projectPath);
  const laneDir = delegateLaneIsDefault(normalizedLaneId)
    ? path.join(rootDir, "default")
    : path.join(rootDir, "lanes", normalizedLaneId);
  const delegateDir = delegateLaneIsDefault(normalizedLaneId)
    ? rootDir
    : laneDir;
  return {
    laneId: normalizedLaneId,
    rootDir,
    laneDir,
    delegateDir,
    configFile: path.join(delegateDir, "delegate-config.json"),
    briefFile: path.join(delegateDir, "delegate-brief.md"),
    statusFile: path.join(delegateDir, "delegate-status.json"),
    supervisorFile: path.join(delegateDir, "delegate-supervisor.json"),
    supervisorEventsFile: path.join(delegateDir, "delegate-supervisor-events.jsonl"),
    planSnapshotsFile: path.join(delegateDir, "delegate-plan-snapshots.json"),
    runSummariesFile: path.join(delegateDir, "delegate-run-summaries.json"),
    runsDir: path.join(delegateDir, "runs"),
    artifactsDir: path.join(delegateDir, "artifacts"),
    mailboxDir: path.join(delegateDir, "mailbox"),
  };
}

function delegateMirrorPath(projectPath, laneId, filePath) {
  const paths = delegatePaths(projectPath, laneId);
  if (!delegateLaneIsDefault(paths.laneId) || paths.laneDir === paths.delegateDir) {
    return "";
  }
  const relativePath = path.relative(paths.delegateDir, filePath);
  if (!relativePath || relativePath.startsWith("..")) {
    return "";
  }
  return path.join(paths.laneDir, relativePath);
}

function delegateStorageTargets(projectPath, laneId, filePath) {
  return uniqueStrings([
    filePath,
    delegateMirrorPath(projectPath, laneId, filePath),
  ]);
}

function blankDelegatePlanSnapshots() {
  return {
    version: 1,
    snapshots: [],
  };
}

function blankDelegateRunSummaries() {
  return {
    version: 1,
    snapshots: [],
  };
}

async function writeDelegateJsonStorage(projectPath, laneId, filePath, payload) {
  for (const targetPath of delegateStorageTargets(projectPath, laneId, filePath)) {
    await writeJsonFile(targetPath, payload);
  }
}

async function writeDelegateTextStorage(projectPath, laneId, filePath, contents) {
  for (const targetPath of delegateStorageTargets(projectPath, laneId, filePath)) {
    await writeTextFile(targetPath, contents);
  }
}

async function appendDelegateStorageLine(projectPath, laneId, filePath, line) {
  for (const targetPath of delegateStorageTargets(projectPath, laneId, filePath)) {
    await mkdir(path.dirname(targetPath), { recursive: true });
    await appendFile(targetPath, line, "utf8");
  }
}

async function ensureDelegateLaneStorage(projectPath, laneId = defaultDelegateLaneId, project = null) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  const paths = delegatePaths(projectPath, normalizedLaneId);
  const extraDirs = delegateLaneIsDefault(normalizedLaneId)
    ? [
        paths.laneDir,
        path.join(paths.laneDir, "runs"),
        path.join(paths.laneDir, "artifacts"),
        path.join(paths.laneDir, "mailbox"),
      ]
    : [];

  await Promise.all(
    uniqueStrings([
      paths.delegateDir,
      paths.runsDir,
      paths.artifactsDir,
      paths.mailboxDir,
      ...extraDirs,
    ]).map((directory) => mkdir(directory, { recursive: true })),
  );

  const now = new Date().toISOString();
  const defaults = [
    {
      filePath: paths.configFile,
      contents: `${JSON.stringify(normalizeDelegateConfig({
        projectPath,
        laneId: normalizedLaneId,
        createdAt: now,
        updatedAt: now,
      }, { laneId: normalizedLaneId }), null, 2)}\n`,
    },
    {
      filePath: paths.briefFile,
      contents: `${defaultDelegateBrief(project || { path: projectPath })}\n`,
    },
    {
      filePath: paths.statusFile,
      contents: `${JSON.stringify({
        version: 1,
        ...normalizeDelegateStatus({
          projectPath,
          laneId: normalizedLaneId,
          state: "idle",
          updatedAt: now,
        }),
      }, null, 2)}\n`,
    },
    {
      filePath: paths.supervisorFile,
      contents: `${JSON.stringify({
        version: 1,
        ...normalizeDelegateSupervisorState({
          projectPath,
          laneId: normalizedLaneId,
          state: "stopped",
          updatedAt: now,
        }),
      }, null, 2)}\n`,
    },
    {
      filePath: paths.planSnapshotsFile,
      contents: `${JSON.stringify(blankDelegatePlanSnapshots(), null, 2)}\n`,
    },
    {
      filePath: paths.runSummariesFile,
      contents: `${JSON.stringify(blankDelegateRunSummaries(), null, 2)}\n`,
    },
  ];

  for (const entry of defaults) {
    const primaryText = await readOptionalText(entry.filePath);
    const mirrorPath = delegateMirrorPath(projectPath, normalizedLaneId, entry.filePath);
    const mirrorText = mirrorPath ? await readOptionalText(mirrorPath) : "";
    if (primaryText) {
      if (mirrorPath && !mirrorText) {
        await writeTextFile(mirrorPath, primaryText);
      }
      continue;
    }
    if (mirrorText) {
      await writeTextFile(entry.filePath, mirrorText);
      continue;
    }
    await writeDelegateTextStorage(projectPath, normalizedLaneId, entry.filePath, entry.contents);
  }
}

function safeDelegateRunId(runId) {
  const normalized = pickString(runId);
  if (!normalized) {
    return "";
  }
  return normalized.replace(/[^a-zA-Z0-9._-]/gu, "_");
}

function delegateRunEventsFile(projectPath, runId, laneId = defaultDelegateLaneId) {
  const safeRunId = safeDelegateRunId(runId);
  if (!safeRunId) {
    return "";
  }
  return path.join(delegatePaths(projectPath, laneId).runsDir, `${safeRunId}.jsonl`);
}

function delegateCodexEventsFile(projectPath, runId, laneId = defaultDelegateLaneId) {
  const safeRunId = safeDelegateRunId(runId);
  if (!safeRunId) {
    return "";
  }
  return path.join(delegatePaths(projectPath, laneId).runsDir, `${safeRunId}.codex-events.jsonl`);
}

function delegateCodexGoalFromEvent(event = {}) {
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  const goal = payload.goal && typeof payload.goal === "object" ? payload.goal : {};
  if (event.type === "codex_thread_goal_cleared" || payload.cleared) {
    return normalizeDelegateCodexGoal({
      mode: codexGoalMode,
      supported: true,
      synced: true,
      skipped: false,
      threadId: event.threadId || payload.threadId,
      status: "paused",
      objective: "",
      updatedAt: event.at,
    });
  }
  if (event.type === "codex_goal_sync") {
    const requested = payload.requested && typeof payload.requested === "object" ? payload.requested : {};
    return normalizeDelegateCodexGoal({
      mode: payload.mode || codexGoalMode,
      supported: payload.supported,
      synced: payload.synced,
      skipped: payload.skipped,
      threadId: goal.threadId || requested.threadId || event.threadId,
      objective: goal.objective || requested.objective,
      status: goal.status || requested.status || "active",
      tokenBudget: goal.tokenBudget ?? requested.tokenBudget,
      tokensUsed: goal.tokensUsed,
      timeUsedSeconds: goal.timeUsedSeconds,
      createdAt: goal.createdAt,
      updatedAt: event.at,
      error: payload.error || "",
    });
  }
  if (event.type === "codex_thread_goal_updated" || event.method === "thread/goal/updated") {
    return normalizeDelegateCodexGoal({
      mode: codexGoalMode,
      supported: true,
      synced: true,
      skipped: false,
      threadId: goal.threadId || event.threadId,
      objective: goal.objective || payload.objective,
      status: goal.status || payload.status || "active",
      tokenBudget: goal.tokenBudget,
      tokensUsed: goal.tokensUsed,
      timeUsedSeconds: goal.timeUsedSeconds,
      createdAt: goal.createdAt,
      updatedAt: event.at,
      error: "",
    });
  }
  return null;
}

async function readDelegateCodexGoalFromRunEvents(projectPath, runId, laneId = defaultDelegateLaneId) {
  const eventsFile = delegateCodexEventsFile(projectPath, runId, laneId);
  if (!eventsFile) {
    return null;
  }
  const raw = await readOptionalText(eventsFile);
  if (!raw.trim()) {
    return null;
  }
  const lines = raw.split(/\r?\n/u).filter((line) => line.trim());
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const goal = delegateCodexGoalFromEvent(JSON.parse(lines[index]));
      if (goal) {
        return goal;
      }
    } catch (_error) {
      // Ignore malformed partial app-server event lines.
    }
  }
  return null;
}

async function readDelegateCodexEventTail(projectPath, runId, laneId = defaultDelegateLaneId, limit = 200) {
  const eventsFile = delegateCodexEventsFile(projectPath, runId, laneId);
  if (!eventsFile) {
    return [];
  }
  const raw = await readOptionalText(eventsFile);
  if (!raw.trim()) {
    return [];
  }
  const pageLimit = Math.min(500, Math.max(1, Number.parseInt(String(limit || 200), 10) || 200));
  const lines = raw.split(/\r?\n/u).filter((line) => line.trim()).slice(-pageLimit);
  const events = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch (_error) {
      // Ignore malformed partial app-server event lines.
    }
  }
  return events;
}

function normalizeDelegateWatchtowerReviewMode(value) {
  const normalized = pickString(value).toLowerCase();
  if (["log", "passive", "advisory", "observe", "observer"].includes(normalized)) {
    return "log";
  }
  if (["enforce", "strict", "on", "true"].includes(normalized)) {
    return "enforce";
  }
  return "off";
}

function normalizeDelegateDirectionCheckMode(value) {
  const normalized = pickString(value).toLowerCase();
  if (["off", "disabled", "none", "false", "0"].includes(normalized)) {
    return "off";
  }
  if (["advise", "advisory", "warn", "warning"].includes(normalized)) {
    return "advise";
  }
  if (["enforce", "strict", "block"].includes(normalized)) {
    return "enforce";
  }
  if (["observe", "observer", "log", "on", "true", "1"].includes(normalized)) {
    return "observe";
  }
  return "observe";
}

function normalizeDelegateConfig(payload = {}, { laneId = defaultDelegateLaneId } = {}) {
  const normalizedLaneId = normalizeDelegateLaneId(payload.laneId || laneId);
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
    laneId: normalizedLaneId,
    displayName: pickString(
      payload.displayName,
      delegateLaneIsDefault(normalizedLaneId) ? "Default delegate" : normalizedLaneId,
    ),
    objective: trimTrailingNewlines(String(payload.objective || "")) || null,
    scopeGlobs: Array.isArray(payload.scopeGlobs)
      ? uniqueStrings(payload.scopeGlobs.map((value) => pickString(value)).filter(Boolean))
      : [],
    projectPath: pickString(payload.projectPath) || null,
    enabled: boolFromUnknown(payload.enabled, false),
    delegateSessionId: pickString(payload.delegateSessionId) || null,
    delegateSessionSlug: pickString(payload.delegateSessionSlug, delegateDefaultSessionSlug),
    hardStops: hardStops.length > 0 ? hardStops : [...delegateDefaultHardStops],
    maxStepsPerRun,
    computeGuardEnabled: boolFromUnknown(payload.computeGuardEnabled, true),
    computeReservePercent: normalizePercent(payload.computeReservePercent, delegateDefaultComputeReservePercent),
    watchtowerReviewMode: normalizeDelegateWatchtowerReviewMode(payload.watchtowerReviewMode),
    directionCheckMode: normalizeDelegateDirectionCheckMode(payload.directionCheckMode),
    createdAt: pickString(payload.createdAt) || null,
    updatedAt: pickString(payload.updatedAt) || null,
  };
}

async function readDelegateConfig(projectPath, laneId = defaultDelegateLaneId) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  const payload = (await readOptionalJson(delegatePaths(projectPath, normalizedLaneId).configFile)) || {};
  return normalizeDelegateConfig({
    ...payload,
    projectPath,
    laneId: normalizedLaneId,
  }, { laneId: normalizedLaneId });
}

async function writeDelegateConfig(projectPath, config, laneId = config?.laneId || defaultDelegateLaneId) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  await ensureDelegateLaneStorage(projectPath, normalizedLaneId);
  const existing = (await readOptionalJson(delegatePaths(projectPath, normalizedLaneId).configFile)) || {};
  const now = new Date().toISOString();
  const normalized = normalizeDelegateConfig({
    ...existing,
    ...config,
    projectPath,
    laneId: normalizedLaneId,
    createdAt: pickString(config?.createdAt, existing.createdAt, now),
    updatedAt: now,
  }, { laneId: normalizedLaneId });
  await writeDelegateJsonStorage(projectPath, normalizedLaneId, delegatePaths(projectPath, normalizedLaneId).configFile, normalized);
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

# Worktree Hygiene
- Treat workspace hygiene as part of the delegation loop, not as a later cleanup pass.
- At every step boundary, preserve or explain every dirty path.
- Leave no unexplained root-level files, empty shell leftovers, credential-looking files, or suspicious temporary outputs in the visible worktree.
- Convert useful scratch output into a named artifact, source/test change, docs note, or project-managed generated output.
- Move disposable leftovers into ignored project/runtime quarantine when preservation is safer than deletion.
- Do not use destructive cleanup such as reset, checkout, or deletion unless the human explicitly approved it.
- If Clawdad or an enabled Watchtower reports unclassified paths, sensitive files, failed gates, or a large diff that needs review, make the next action hygiene/review/checkpoint before widening the work.

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

async function readDelegateBrief(projectPath, project = null, laneId = defaultDelegateLaneId) {
  const raw = trimTrailingNewlines(await readOptionalText(delegatePaths(projectPath, laneId).briefFile));
  return raw || defaultDelegateBrief(project || { path: projectPath });
}

async function writeDelegateBrief(projectPath, brief, project = null, laneId = defaultDelegateLaneId) {
  await ensureDelegateLaneStorage(projectPath, laneId, project);
  const normalized = trimTrailingNewlines(String(brief || "").trim()) || defaultDelegateBrief(project || { path: projectPath });
  await writeDelegateTextStorage(projectPath, laneId, delegatePaths(projectPath, laneId).briefFile, `${normalized}\n`);
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

async function readDelegatePlanSnapshots(projectPath, laneId = defaultDelegateLaneId) {
  const payload = (await readOptionalJson(delegatePaths(projectPath, laneId).planSnapshotsFile)) || {};
  const snapshots = Array.isArray(payload.snapshots) ? payload.snapshots : [];
  return snapshots
    .map(normalizeDelegatePlanSnapshot)
    .filter((snapshot) => snapshot.plan)
    .sort((left, right) => delegatePlanTimestampMs(right) - delegatePlanTimestampMs(left));
}

async function writeDelegatePlanSnapshots(projectPath, snapshots, laneId = defaultDelegateLaneId) {
  await ensureDelegateLaneStorage(projectPath, laneId);
  const normalizedSnapshots = (Array.isArray(snapshots) ? snapshots : [])
    .map(normalizeDelegatePlanSnapshot)
    .filter((snapshot) => snapshot.plan)
    .sort((left, right) => delegatePlanTimestampMs(right) - delegatePlanTimestampMs(left))
    .slice(0, delegatePlanSnapshotLimit);

  await writeDelegateJsonStorage(projectPath, laneId, delegatePaths(projectPath, laneId).planSnapshotsFile, {
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
  const reservePhrase = Number.isFinite(normalized.reservePercent) && normalized.reservePercent === 0
    ? ", reserve is 0%; continue until compute exhaustion or hard stop."
    : reserve
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

function canonicalDelegateRunIdForEventFile(runId) {
  const safeRunId = safeDelegateRunId(runId);
  return safeRunId.endsWith(".codex-events")
    ? safeRunId.slice(0, -".codex-events".length)
    : safeRunId;
}

function stableDelegateRunEventId(runId, lineIndex, rawLine) {
  const hash = crypto.createHash("sha256");
  hash.update(safeDelegateRunId(runId));
  hash.update("\0");
  hash.update(String(lineIndex));
  hash.update("\0");
  hash.update(String(rawLine || ""));
  return `line:${hash.digest("hex").slice(0, 32)}`;
}

async function appendDelegateRunEvent(projectPath, runId, type, payload = {}, laneId = defaultDelegateLaneId) {
  const safeRunId = safeDelegateRunId(runId);
  if (!projectPath || !safeRunId) {
    return null;
  }

  const event = normalizeDelegateRunEvent({
    ...payload,
    type,
    runId,
  });
  const eventsFile = delegateRunEventsFile(projectPath, safeRunId, laneId);
  await ensureDelegateLaneStorage(projectPath, laneId);
  await appendDelegateStorageLine(projectPath, laneId, eventsFile, `${JSON.stringify(event)}\n`);
  return event;
}

async function readDelegateRunEvents(projectPath, { runId = "", cursor = 0, limit = delegateRunEventPageLimit, laneId = defaultDelegateLaneId } = {}) {
  const safeRunId = safeDelegateRunId(runId);
  if (!projectPath || !safeRunId) {
    return {
      runId: safeRunId || "",
      events: [],
      nextCursor: "0",
      total: 0,
    };
  }

  const eventsFile = delegateRunEventsFile(projectPath, safeRunId, laneId);
  const raw = await readOptionalText(eventsFile);
  const lines = raw.split(/\r?\n/u).filter((line) => line.trim());
  const pageLimit = Math.min(500, Math.max(1, Number.parseInt(String(limit || delegateRunEventPageLimit), 10) || delegateRunEventPageLimit));
  const cursorText = String(cursor || "0").trim().toLowerCase();
  const start = cursorText === "tail"
    ? Math.max(0, lines.length - pageLimit)
    : Math.max(0, Number.parseInt(String(cursor || "0"), 10) || 0);
  const pageLines = lines.slice(start, start + pageLimit);
  const events = [];

  for (const [offset, line] of pageLines.entries()) {
    try {
      const payload = JSON.parse(line);
      const fallbackRunId = canonicalDelegateRunIdForEventFile(safeRunId);
      events.push(normalizeDelegateRunEvent({
        ...payload,
        id: pickString(payload.id) || stableDelegateRunEventId(safeRunId, start + offset, line),
        runId: pickString(payload.runId, payload.run_id) || fallbackRunId,
      }));
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

function watchtowerPaths(projectPath) {
  const feedDir = path.join(projectPath, ".clawdad", "feed");
  return {
    feedDir,
    dbFile: path.join(feedDir, "watchtower.sqlite"),
  };
}

function sqlLiteral(value) {
  if (value == null) {
    return "NULL";
  }
  return `'${String(value).replace(/'/gu, "''")}'`;
}

function sqlJsonLiteral(value) {
  return sqlLiteral(JSON.stringify(value ?? null));
}

function watchtowerId(...parts) {
  const hash = crypto.createHash("sha256");
  for (const part of parts) {
    hash.update(String(part ?? ""));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 24);
}

function watchtowerDelegateRunScanStateKey(laneId, runId) {
  return `delegate_run_file:${normalizeDelegateLaneId(laneId || defaultDelegateLaneId)}:${safeDelegateRunId(runId)}`;
}

async function watchtowerFileSignature(filePath) {
  const info = await stat(filePath);
  return `${Math.trunc(info.mtimeMs)}:${info.size}`;
}

function normalizeWatchtowerLaneId(value = "") {
  return value == null || String(value).trim() === ""
    ? ""
    : normalizeDelegateLaneId(value);
}

async function ensureWatchtowerDbColumn(dbFile, tableName, columnName, definition) {
  const columns = await runSqlite(
    dbFile,
    `PRAGMA table_info(${tableName});`,
    { json: true },
  ).catch(() => []);
  if (columns.some((column) => pickString(column?.name).toLowerCase() === columnName.toLowerCase())) {
    return;
  }
  await runSqlite(
    dbFile,
    `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`,
  );
}

async function cleanupWatchtowerLegacyUnknownDelegateEvents(dbFile) {
  const maintenanceKey = "maintenance.unknown_delegate_events_cleaned.v1";
  const rows = await runSqlite(
    dbFile,
    `SELECT value FROM feed_scan_state WHERE key = ${sqlLiteral(maintenanceKey)} LIMIT 1;`,
    { json: true },
  ).catch(() => []);
  if (pickString(rows[0]?.value) === "done") {
    return;
  }

  const now = new Date().toISOString();
  await runSqlite(
    dbFile,
    `
BEGIN IMMEDIATE;
CREATE TEMP TABLE IF NOT EXISTS clawdad_legacy_bad_watchtower_events (
  id TEXT PRIMARY KEY
);
DELETE FROM clawdad_legacy_bad_watchtower_events;
INSERT OR IGNORE INTO clawdad_legacy_bad_watchtower_events (id)
SELECT id FROM feed_events
WHERE source_type = 'delegate_event'
  AND (
    COALESCE(run_id, '') = ''
    OR source_ref LIKE 'delegate-event:%:unknown:%'
  );
DELETE FROM review_cards_fts
WHERE card_id IN (
  SELECT id FROM review_cards
  WHERE event_id IN (SELECT id FROM clawdad_legacy_bad_watchtower_events)
);
DELETE FROM review_cards
WHERE event_id IN (SELECT id FROM clawdad_legacy_bad_watchtower_events);
DELETE FROM feed_events_fts
WHERE event_id IN (SELECT id FROM clawdad_legacy_bad_watchtower_events);
DELETE FROM feed_events
WHERE id IN (SELECT id FROM clawdad_legacy_bad_watchtower_events);
DROP TABLE clawdad_legacy_bad_watchtower_events;
INSERT INTO feed_scan_state (key, value, updated_at)
VALUES (${sqlLiteral(maintenanceKey)}, 'done', ${sqlLiteral(now)})
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
COMMIT;
`,
    { timeoutMs: Math.max(watchtowerSqliteExecTimeoutMs, 180_000) },
  );
}

async function compactWatchtowerDbIfWasteful(dbFile) {
  const [pageRows, freeRows] = await Promise.all([
    runSqlite(dbFile, "PRAGMA page_count;", { json: true }).catch(() => []),
    runSqlite(dbFile, "PRAGMA freelist_count;", { json: true }).catch(() => []),
  ]);
  const pageCount = Number.parseInt(String(pageRows[0]?.page_count || "0"), 10) || 0;
  const freeCount = Number.parseInt(String(freeRows[0]?.freelist_count || "0"), 10) || 0;
  if (pageCount <= 0 || freeCount <= 0) {
    return false;
  }
  const freeRatio = freeCount / pageCount;
  if (
    freeCount < watchtowerSqliteVacuumMinFreePages ||
    freeRatio < watchtowerSqliteVacuumMinFreeRatio
  ) {
    return false;
  }

  await runSqlite(
    dbFile,
    "VACUUM;",
    { timeoutMs: Math.max(watchtowerSqliteExecTimeoutMs, 180_000) },
  );
  return true;
}

function watchtowerEventLaneFilterSql(laneId, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  const normalizedLaneId = normalizeDelegateLaneId(laneId || defaultDelegateLaneId);
  return `AND (
  ${prefix}lane_id = ${sqlLiteral(normalizedLaneId)}
  OR (
    ${prefix}lane_id = ''
    AND COALESCE(${prefix}source_type, '') <> 'delegate_event'
  )
)`;
}

function watchtowerCardLaneFilterSql(laneId, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  const normalizedLaneId = normalizeDelegateLaneId(laneId || defaultDelegateLaneId);
  return `AND (
  ${prefix}lane_id = ${sqlLiteral(normalizedLaneId)}
  OR (
    ${prefix}lane_id = ''
    AND COALESCE(${prefix}run_id, '') = ''
  )
)`;
}

function normalizeWatchtowerReviewStatus(value) {
  const status = pickString(value).toLowerCase();
  return ["info", "watch", "needs_review", "pause_recommended", "hard_stop"].includes(status)
    ? status
    : "info";
}

async function runSqlite(dbFile, sql, { json: jsonMode = false, timeoutMs = watchtowerSqliteExecTimeoutMs } = {}) {
  await mkdir(path.dirname(dbFile), { recursive: true });
  const args = [
    "-batch",
    ...(jsonMode ? ["-json"] : []),
    "-cmd",
    `.timeout ${watchtowerSqliteBusyTimeoutMs}`,
    dbFile,
  ];
  const result = await runExec(defaultSqliteBinary, args, {
    input: `${String(sql || "").trim()}\n`,
    timeoutMs,
    killProcessGroup: true,
  });
  if (!result.ok) {
    throw new Error(
      `sqlite3 failed for Watchtower feed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`,
    );
  }
  if (!jsonMode) {
    return result.stdout;
  }
  const text = String(result.stdout || "").trim();
  if (!text) {
    return [];
  }
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    throw new Error(`sqlite3 returned invalid JSON for Watchtower feed: ${error.message}`);
  }
}

async function ensureWatchtowerDb(projectPath) {
  const { dbFile } = watchtowerPaths(projectPath);
  await runSqlite(
    dbFile,
    `
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS feed_events (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  lane_id TEXT NOT NULL DEFAULT '',
  run_id TEXT,
  at TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL UNIQUE,
  event_type TEXT,
  title TEXT,
  body TEXT,
  active_orp_item TEXT,
  worker_summary TEXT,
  files_changed TEXT,
  tests_gates TEXT,
  current_decision TEXT,
  risk_flags TEXT,
  review_status TEXT NOT NULL,
  content_hash TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS feed_events_fts USING fts5(
  event_id UNINDEXED,
  project_path UNINDEXED,
  run_id UNINDEXED,
  review_status UNINDEXED,
  title,
  body,
  active_orp_item,
  worker_summary,
  files_changed,
  tests_gates,
  current_decision,
  risk_flags
);
CREATE TABLE IF NOT EXISTS review_cards (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  project_path TEXT NOT NULL,
  lane_id TEXT NOT NULL DEFAULT '',
  run_id TEXT,
  at TEXT NOT NULL,
  trigger TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  review_status TEXT NOT NULL,
  risk_flags TEXT,
  source_ref TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS review_cards_fts USING fts5(
  card_id UNINDEXED,
  project_path UNINDEXED,
  run_id UNINDEXED,
  review_status UNINDEXED,
  trigger,
  title,
  summary,
  risk_flags
);
CREATE TABLE IF NOT EXISTS feed_scan_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  );
  await ensureWatchtowerDbColumn(dbFile, "feed_events", "lane_id", "TEXT NOT NULL DEFAULT ''");
  await ensureWatchtowerDbColumn(dbFile, "feed_events", "content_hash", "TEXT NOT NULL DEFAULT ''");
  await ensureWatchtowerDbColumn(dbFile, "review_cards", "lane_id", "TEXT NOT NULL DEFAULT ''");
  await cleanupWatchtowerLegacyUnknownDelegateEvents(dbFile);
  await compactWatchtowerDbIfWasteful(dbFile).catch(() => false);
  return dbFile;
}

async function readWatchtowerScanState(projectPath, key) {
  const dbFile = await ensureWatchtowerDb(projectPath);
  const rows = await runSqlite(
    dbFile,
    `SELECT value FROM feed_scan_state WHERE key = ${sqlLiteral(key)} LIMIT 1;`,
    { json: true },
  );
  return pickString(rows[0]?.value);
}

async function writeWatchtowerScanState(projectPath, key, value) {
  const dbFile = await ensureWatchtowerDb(projectPath);
  const now = new Date().toISOString();
  await runSqlite(
    dbFile,
    `INSERT INTO feed_scan_state (key, value, updated_at)
VALUES (${sqlLiteral(key)}, ${sqlLiteral(value)}, ${sqlLiteral(now)})
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
  );
}

async function readWatchtowerScanStateMap(projectPath, keys = []) {
  const uniqueKeys = uniqueList(keys);
  const values = new Map();
  if (uniqueKeys.length === 0) {
    return values;
  }

  const dbFile = await ensureWatchtowerDb(projectPath);
  const chunkSize = 400;
  for (let index = 0; index < uniqueKeys.length; index += chunkSize) {
    const chunk = uniqueKeys.slice(index, index + chunkSize);
    const rows = await runSqlite(
      dbFile,
      `SELECT key, value FROM feed_scan_state WHERE key IN (${chunk.map(sqlLiteral).join(", ")});`,
      { json: true },
    );
    for (const row of rows) {
      const key = pickString(row.key);
      if (key) {
        values.set(key, pickString(row.value));
      }
    }
  }
  return values;
}

async function writeWatchtowerScanStateBatch(projectPath, entries = []) {
  const byKey = new Map();
  for (const entry of entries) {
    const key = pickString(entry?.key);
    if (key) {
      byKey.set(key, pickString(entry.value));
    }
  }
  if (byKey.size === 0) {
    return;
  }

  const dbFile = await ensureWatchtowerDb(projectPath);
  const now = new Date().toISOString();
  const statements = [];
  for (const [key, value] of byKey.entries()) {
    statements.push(
      `INSERT INTO feed_scan_state (key, value, updated_at)
VALUES (${sqlLiteral(key)}, ${sqlLiteral(value)}, ${sqlLiteral(now)})
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
    );
  }
  await runSqlite(dbFile, ["BEGIN IMMEDIATE;", ...statements, "COMMIT;"].join("\n"));
}

function watchtowerSqlEventInsert(event) {
  return `
INSERT INTO feed_events (
  id, project_path, lane_id, run_id, at, source_type, source_ref, event_type, title, body,
  active_orp_item, worker_summary, files_changed, tests_gates, current_decision,
  risk_flags, review_status, content_hash, payload_json, created_at
) VALUES (
  ${sqlLiteral(event.id)},
  ${sqlLiteral(event.projectPath)},
  ${sqlLiteral(normalizeWatchtowerLaneId(event.laneId))},
  ${sqlLiteral(event.runId || "")},
  ${sqlLiteral(event.at)},
  ${sqlLiteral(event.sourceType)},
  ${sqlLiteral(event.sourceRef)},
  ${sqlLiteral(event.eventType || "")},
  ${sqlLiteral(event.title || "")},
  ${sqlLiteral(event.body || "")},
  ${sqlLiteral(event.activeOrpItem || "")},
  ${sqlLiteral(event.workerSummary || "")},
  ${sqlLiteral(event.filesChangedText || "")},
  ${sqlLiteral(event.testsGatesText || "")},
  ${sqlLiteral(event.currentDecision || "")},
  ${sqlLiteral(event.riskFlagsText || "")},
  ${sqlLiteral(event.reviewStatus)},
  ${sqlLiteral(event.contentHash || "")},
  ${sqlJsonLiteral(event.payload || {})},
  ${sqlLiteral(event.createdAt)}
);
INSERT INTO feed_events_fts (
  event_id, project_path, run_id, review_status, title, body, active_orp_item,
  worker_summary, files_changed, tests_gates, current_decision, risk_flags
)
SELECT
  ${sqlLiteral(event.id)},
  ${sqlLiteral(event.projectPath)},
  ${sqlLiteral(event.runId || "")},
  ${sqlLiteral(event.reviewStatus)},
  ${sqlLiteral(event.title || "")},
  ${sqlLiteral(event.body || "")},
  ${sqlLiteral(event.activeOrpItem || "")},
  ${sqlLiteral(event.workerSummary || "")},
  ${sqlLiteral(event.filesChangedText || "")},
  ${sqlLiteral(event.testsGatesText || "")},
  ${sqlLiteral(event.currentDecision || "")},
  ${sqlLiteral(event.riskFlagsText || "")}
;
`;
}

function watchtowerSqlCardInsert(card) {
  return `
INSERT OR IGNORE INTO review_cards (
  id, event_id, project_path, lane_id, run_id, at, trigger, title, summary, review_status,
  risk_flags, source_ref, payload_json, created_at
) VALUES (
  ${sqlLiteral(card.id)},
  ${sqlLiteral(card.eventId)},
  ${sqlLiteral(card.projectPath)},
  ${sqlLiteral(normalizeWatchtowerLaneId(card.laneId))},
  ${sqlLiteral(card.runId || "")},
  ${sqlLiteral(card.at)},
  ${sqlLiteral(card.trigger)},
  ${sqlLiteral(card.title)},
  ${sqlLiteral(card.summary || "")},
  ${sqlLiteral(card.reviewStatus)},
  ${sqlLiteral(card.riskFlagsText || "")},
  ${sqlLiteral(card.sourceRef)},
  ${sqlJsonLiteral(card.payload || {})},
  ${sqlLiteral(card.createdAt)}
);
INSERT INTO review_cards_fts (
  card_id, project_path, run_id, review_status, trigger, title, summary, risk_flags
)
SELECT
  ${sqlLiteral(card.id)},
  ${sqlLiteral(card.projectPath)},
  ${sqlLiteral(card.runId || "")},
  ${sqlLiteral(card.reviewStatus)},
  ${sqlLiteral(card.trigger)},
  ${sqlLiteral(card.title)},
  ${sqlLiteral(card.summary || "")},
  ${sqlLiteral(card.riskFlagsText || "")}
;
`;
}

const watchtowerHashVolatileKeys = new Set(["createdAt", "created_at", "updatedAt", "updated_at", "generatedAt", "generated_at", "checkedAt", "checked_at"]);

function watchtowerStableHashValue(value) {
  if (Array.isArray(value)) {
    return value.map(watchtowerStableHashValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !watchtowerHashVolatileKeys.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, watchtowerStableHashValue(entryValue)]),
  );
}

function watchtowerStableFeedEventForHash(event = {}) {
  const { contentHash: _contentHash, createdAt: _createdAt, at: _at, ...stable } = event;
  return watchtowerStableHashValue(stable);
}

function watchtowerStableCardForHash(card = {}) {
  const { createdAt: _createdAt, at: _at, ...stable } = card;
  return watchtowerStableHashValue(stable);
}

function watchtowerFeedEventContentHash(event = {}, cards = []) {
  return watchtowerId(JSON.stringify({
    event: watchtowerStableFeedEventForHash(event),
    cards: cards.map(watchtowerStableCardForHash),
  }));
}

function watchtowerSqlStatementsForEvent(event, cards = []) {
  const contentHash = event.contentHash || watchtowerFeedEventContentHash(event, cards);
  const preparedEvent = {
    ...event,
    contentHash,
  };
  return [
    `DELETE FROM review_cards_fts WHERE card_id IN (
  SELECT id FROM review_cards WHERE event_id = ${sqlLiteral(preparedEvent.id)}
);`,
    `DELETE FROM review_cards WHERE event_id = ${sqlLiteral(preparedEvent.id)};`,
    `DELETE FROM feed_events_fts WHERE event_id = ${sqlLiteral(preparedEvent.id)};`,
    `DELETE FROM feed_events WHERE id = ${sqlLiteral(preparedEvent.id)};`,
    watchtowerSqlEventInsert(preparedEvent),
    ...cards.map(watchtowerSqlCardInsert),
  ];
}

async function insertWatchtowerEvent(projectPath, event, cards = []) {
  const preparedEvent = {
    ...event,
    contentHash: event.contentHash || watchtowerFeedEventContentHash(event, cards),
  };
  const existingHashes = await readWatchtowerEventContentHashes(projectPath, [preparedEvent.id]);
  if (existingHashes.get(preparedEvent.id) === preparedEvent.contentHash) {
    return false;
  }
  await insertWatchtowerEventBatch(projectPath, [{ event: preparedEvent, cards }]);
  return true;
}

async function insertWatchtowerEventBatch(projectPath, items = []) {
  const preparedItems = (Array.isArray(items) ? items : [])
    .map((item) => {
      const cards = Array.isArray(item?.cards) ? item.cards : [];
      const event = item?.event && typeof item.event === "object" ? item.event : null;
      if (!event?.id) {
        return null;
      }
      return {
        event: {
          ...event,
          contentHash: event.contentHash || watchtowerFeedEventContentHash(event, cards),
        },
        cards,
      };
    })
    .filter(Boolean);
  if (preparedItems.length === 0) {
    return;
  }

  const dbFile = await ensureWatchtowerDb(projectPath);
  let currentStatements = [];
  let currentBytes = 0;
  let currentEvents = 0;

  const flush = async () => {
    if (currentStatements.length === 0) {
      return;
    }
    await runSqlite(
      dbFile,
      ["BEGIN IMMEDIATE;", ...currentStatements, "COMMIT;"].join("\n"),
    );
    currentStatements = [];
    currentBytes = 0;
    currentEvents = 0;
  };

  for (const item of preparedItems) {
    const statements = watchtowerSqlStatementsForEvent(item.event, item.cards);
    const sql = statements.join("\n");
    const wouldOverflow =
      currentStatements.length > 0 &&
      (
        currentEvents >= watchtowerSqlBatchMaxEvents ||
        currentBytes + sql.length > watchtowerSqlBatchMaxBytes
      );
    if (wouldOverflow) {
      await flush();
    }
    currentStatements.push(...statements);
    currentBytes += sql.length;
    currentEvents += 1;
  }

  await flush();
}

async function readWatchtowerEventContentHashes(projectPath, eventIds = []) {
  const ids = uniqueList(eventIds);
  const hashes = new Map();
  if (ids.length === 0) {
    return hashes;
  }

  const dbFile = await ensureWatchtowerDb(projectPath);
  const chunkSize = 400;
  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize);
    const rows = await runSqlite(
      dbFile,
      `SELECT id, content_hash FROM feed_events WHERE id IN (${chunk.map(sqlLiteral).join(", ")});`,
      { json: true },
    );
    for (const row of rows) {
      hashes.set(pickString(row.id), pickString(row.content_hash));
    }
  }
  return hashes;
}

async function watchtowerDelegateRunHasIndexedEvents(projectPath, laneId, runId) {
  const normalizedRunId = safeDelegateRunId(runId);
  if (!normalizedRunId) {
    return false;
  }
  const dbFile = await ensureWatchtowerDb(projectPath);
  const rows = await runSqlite(
    dbFile,
    `SELECT COUNT(*) AS count FROM feed_events
WHERE project_path = ${sqlLiteral(projectPath)}
  ${watchtowerEventLaneFilterSql(laneId)}
  AND source_type = 'delegate_event'
  AND run_id = ${sqlLiteral(normalizedRunId)};`,
    { json: true },
  );
  const count = Number.parseInt(String(rows[0]?.count || "0"), 10) || 0;
  return count > 0;
}

async function readWatchtowerIndexedDelegateRunIds(projectPath, laneId, runIds = []) {
  const normalizedRunIds = uniqueList(runIds.map((runId) => canonicalDelegateRunIdForEventFile(runId)));
  const indexed = new Set();
  if (normalizedRunIds.length === 0) {
    return indexed;
  }

  const dbFile = await ensureWatchtowerDb(projectPath);
  const chunkSize = 400;
  for (let index = 0; index < normalizedRunIds.length; index += chunkSize) {
    const chunk = normalizedRunIds.slice(index, index + chunkSize);
    const rows = await runSqlite(
      dbFile,
      `SELECT DISTINCT run_id FROM feed_events
WHERE project_path = ${sqlLiteral(projectPath)}
  ${watchtowerEventLaneFilterSql(laneId)}
  AND source_type = 'delegate_event'
  AND run_id IN (${chunk.map(sqlLiteral).join(", ")});`,
      { json: true },
    );
    for (const row of rows) {
      const runId = canonicalDelegateRunIdForEventFile(row.run_id || row.runId);
      if (runId) {
        indexed.add(runId);
      }
    }
  }
  return indexed;
}

function parseJsonList(value) {
  if (Array.isArray(value)) {
    return value;
  }
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function normalizeWatchtowerEventRow(row = {}) {
  return {
    id: pickString(row.id),
    projectPath: pickString(row.project_path, row.projectPath),
    laneId: pickString(row.lane_id, row.laneId) || null,
    runId: pickString(row.run_id, row.runId) || null,
    at: pickString(row.at),
    sourceType: pickString(row.source_type, row.sourceType),
    sourceRef: pickString(row.source_ref, row.sourceRef),
    eventType: pickString(row.event_type, row.eventType),
    title: pickString(row.title),
    body: pickString(row.body),
    activeOrpItem: pickString(row.active_orp_item, row.activeOrpItem),
    workerSummary: pickString(row.worker_summary, row.workerSummary),
    filesChanged: parseJsonList(row.files_changed),
    testsGates: parseJsonList(row.tests_gates),
    currentDecision: pickString(row.current_decision, row.currentDecision),
    riskFlags: parseJsonList(row.risk_flags),
    reviewStatus: normalizeWatchtowerReviewStatus(row.review_status || row.reviewStatus),
    contentHash: pickString(row.content_hash, row.contentHash),
    payload: parseJsonObject(row.payload_json || row.payloadJson),
    createdAt: pickString(row.created_at, row.createdAt),
  };
}

function normalizeWatchtowerCardRow(row = {}) {
  return {
    id: pickString(row.id),
    eventId: pickString(row.event_id, row.eventId),
    projectPath: pickString(row.project_path, row.projectPath),
    laneId: pickString(row.lane_id, row.laneId) || null,
    runId: pickString(row.run_id, row.runId) || null,
    at: pickString(row.at),
    trigger: pickString(row.trigger),
    title: pickString(row.title),
    summary: pickString(row.summary),
    reviewStatus: normalizeWatchtowerReviewStatus(row.review_status || row.reviewStatus),
    riskFlags: parseJsonList(row.risk_flags),
    sourceRef: pickString(row.source_ref, row.sourceRef),
    payload: parseJsonObject(row.payload_json || row.payloadJson),
    createdAt: pickString(row.created_at, row.createdAt),
  };
}

function watchtowerLimit(value, fallback = 40) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(200, parsed);
}

async function readWatchtowerTail(projectPath, { limit = 40, laneId = defaultDelegateLaneId } = {}) {
  const dbFile = await ensureWatchtowerDb(projectPath);
  const rows = await runSqlite(
    dbFile,
    `SELECT * FROM feed_events
WHERE project_path = ${sqlLiteral(projectPath)}
${watchtowerEventLaneFilterSql(laneId)}
ORDER BY at DESC, created_at DESC
LIMIT ${watchtowerLimit(limit)};`,
    { json: true },
  );
  return rows.map(normalizeWatchtowerEventRow).reverse();
}

function ftsQueryFromSearchText(query) {
  const tokens = String(query || "")
    .toLowerCase()
    .match(/[a-z0-9_./-]+/giu);
  if (!tokens || tokens.length === 0) {
    return "";
  }
  return tokens
    .slice(0, 12)
    .map((token) => `"${token.replace(/"/gu, "")}"`)
    .join(" AND ");
}

async function searchWatchtowerFeed(projectPath, query, { limit = 40, laneId = defaultDelegateLaneId } = {}) {
  const dbFile = await ensureWatchtowerDb(projectPath);
  const ftsQuery = ftsQueryFromSearchText(query);
  if (!ftsQuery) {
    return [];
  }
  try {
    const rows = await runSqlite(
      dbFile,
      `SELECT e.* FROM feed_events e
JOIN feed_events_fts f ON f.event_id = e.id
WHERE f.project_path = ${sqlLiteral(projectPath)}
  ${watchtowerEventLaneFilterSql(laneId, "e")}
  AND feed_events_fts MATCH ${sqlLiteral(ftsQuery)}
ORDER BY e.at DESC, e.created_at DESC
LIMIT ${watchtowerLimit(limit)};`,
      { json: true },
    );
    return rows.map(normalizeWatchtowerEventRow);
  } catch (_error) {
    const like = `%${String(query || "").replace(/[%_]/gu, "")}%`;
    const rows = await runSqlite(
      dbFile,
      `SELECT * FROM feed_events
WHERE project_path = ${sqlLiteral(projectPath)}
  ${watchtowerEventLaneFilterSql(laneId)}
  AND (
    title LIKE ${sqlLiteral(like)}
    OR body LIKE ${sqlLiteral(like)}
    OR worker_summary LIKE ${sqlLiteral(like)}
    OR files_changed LIKE ${sqlLiteral(like)}
    OR tests_gates LIKE ${sqlLiteral(like)}
    OR risk_flags LIKE ${sqlLiteral(like)}
  )
ORDER BY at DESC, created_at DESC
LIMIT ${watchtowerLimit(limit)};`,
      { json: true },
    );
    return rows.map(normalizeWatchtowerEventRow);
  }
}

async function readWatchtowerReviewCards(projectPath, { limit = 40, laneId = defaultDelegateLaneId } = {}) {
  const dbFile = await ensureWatchtowerDb(projectPath);
  const rows = await runSqlite(
    dbFile,
    `SELECT * FROM review_cards
WHERE project_path = ${sqlLiteral(projectPath)}
${watchtowerCardLaneFilterSql(laneId)}
ORDER BY
  CASE review_status
    WHEN 'hard_stop' THEN 5
    WHEN 'pause_recommended' THEN 4
    WHEN 'needs_review' THEN 3
    WHEN 'watch' THEN 2
    ELSE 1
  END DESC,
  at DESC,
  created_at DESC
LIMIT ${watchtowerLimit(limit)};`,
    { json: true },
  );
  return rows.map(normalizeWatchtowerCardRow);
}

function parseGitStatusPath(line) {
  const text = String(line || "");
  if (text.length < 4) {
    return "";
  }
  const rawPath = text.slice(3).trim();
  const renamed = rawPath.match(/\s->\s(.+)$/u);
  const value = renamed ? renamed[1] : rawPath;
  return value.replace(/^"|"$/gu, "");
}

function parseGitStatusEntry(line) {
  const text = String(line || "");
  const filePath = parseGitStatusPath(text);
  return filePath
    ? {
        status: text.slice(0, 2),
        path: filePath,
        topLevel: filePath.split("/")[0] || filePath,
      }
    : null;
}

function uniqueList(values = []) {
  return [...new Set(values.map((value) => pickString(value)).filter(Boolean))];
}

async function ensureClawdadGitExclude(projectPath) {
  const excludePath = path.join(projectPath, ".git", "info", "exclude");
  let text = "";
  try {
    text = await readFile(excludePath, "utf8");
  } catch (_error) {
    return false;
  }
  if (/^\.clawdad\/?$/mu.test(text)) {
    return false;
  }
  const nextText = `${trimTrailingNewlines(text)}${text.trim() ? "\n" : ""}.clawdad/\n`;
  await writeFile(excludePath, nextText, "utf8");
  return true;
}

function genericWorktreePathLooksSuspicious(filePath) {
  const value = String(filePath || "").trim();
  if (!value) {
    return true;
  }
  const parts = value.split("/").filter(Boolean);
  const basename = parts[parts.length - 1] || value;
  if (parts.length === 1 && /^[=+~.,;:_-]{1,3}$/u.test(basename)) {
    return true;
  }
  if (/(?:^|\/)(?:\.?env|id_rsa|id_ed25519|credentials?|secrets?|tokens?|api[-_]?keys?)(?:$|\.)/iu.test(value)) {
    return true;
  }
  if (/(?:^|\/)(?:nohup\.out|core|crash\.log|debug\.log)$/iu.test(value)) {
    return true;
  }
  return false;
}

function classifyGenericWorktreePath(filePath) {
  const value = String(filePath || "").replace(/^"|"$/gu, "");
  const lower = value.toLowerCase();
  const parts = value.split("/").filter(Boolean);
  const basename = parts[parts.length - 1] || value;
  const lowerBase = basename.toLowerCase();

  if (!value) return "unclassified";
  if (genericWorktreePathLooksSuspicious(value)) return "suspicious";
  if (/^(?:\.clawdad|\.orp|\.erdos|\.git)(?:\/|$)/u.test(value)) return "agent_runtime_state";
  if (/^(?:tmp|temp|scratch|output|outputs|artifacts|reports|logs|coverage|dist|build|target|\.cache|\.next|node_modules)(?:\/|$)/iu.test(value)) {
    return "generated_or_runtime_artifact";
  }
  if (/^(?:docs?|documentation|notes?)(?:\/|$)/iu.test(value) || /\.(?:md|mdx|rst|txt|adoc)$/iu.test(lowerBase)) {
    return "docs_or_notes";
  }
  if (
    /^(?:\.github|\.gitlab|\.circleci|\.config|config|configs?|scripts?|bin)(?:\/|$)/iu.test(value) ||
    /^(?:dockerfile|compose\.ya?ml|makefile|justfile|procfile|license|copying|readme(?:\..*)?|contributing(?:\..*)?|codeowners)$/iu.test(lowerBase)
  ) {
    return "project_config_or_ci";
  }
  if (
    /^(?:src|lib|app|apps|packages|pkg|cmd|internal|server|client|web|components|pages|routes|test|tests|spec|specs|__tests__)(?:\/|$)/iu.test(value) ||
    /\.(?:js|jsx|mjs|cjs|ts|tsx|py|rb|go|rs|java|kt|kts|swift|c|cc|cpp|h|hpp|cs|php|scala|clj|ex|exs|erl|hrl|fs|fsx|lua|r|jl|sh|bash|zsh|fish|ps1|sql|graphql|gql|html|css|scss|sass|less|vue|svelte|astro|json|ya?ml|toml|ini|xml|lock)$/iu.test(lowerBase)
  ) {
    return "source_test_or_data";
  }
  if (
    /^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|pyproject\.toml|poetry\.lock|requirements(?:-[\w-]+)?\.txt|cargo\.toml|cargo\.lock|go\.mod|go\.sum|gemfile(?:\.lock)?|pom\.xml|build\.gradle|settings\.gradle|mix\.exs|rebar\.config|deno\.jsonc?|tsconfig(?:\..*)?\.json)$/iu.test(lowerBase)
  ) {
    return "project_config_or_ci";
  }
  if (/\.(?:png|jpe?g|gif|webp|avif|svg|ico|pdf|zip|gz|tgz|tar|mp4|mov|mp3|wav|wasm|ttf|otf|woff2?)$/iu.test(lowerBase)) {
    return "asset_or_binary";
  }
  if (parts.length > 1) {
    return "project_file";
  }
  return "unclassified";
}

function summarizeGenericWorktreeEntries(entries = []) {
  const byStatus = {};
  const byCategory = {};
  const samplesByCategory = {};
  for (const entry of entries) {
    byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
    byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
    samplesByCategory[entry.category] ||= [];
    if (samplesByCategory[entry.category].length < 8) {
      samplesByCategory[entry.category].push(entry.path);
    }
  }
  return { byStatus, byCategory, samplesByCategory };
}

function buildGenericWorktreeHygieneReport(projectPath, gitContext = {}) {
  if (!gitContext.ok) {
    return {
      schema: "clawdad.worktree_hygiene/1",
      generatedAt: new Date().toISOString(),
      projectPath,
      status: "not_git_workspace",
      clean: null,
      dirtyCount: null,
      unclassifiedCount: null,
      suspiciousCount: null,
      safeToExpand: true,
      entries: [],
      summary: {},
      requiredAction: "No generic Git hygiene gate is available because this is not a readable Git workspace.",
    };
  }
  const rawLines = String(gitContext.rawStatus || "").split(/\r?\n/u).filter(Boolean);
  const entries = rawLines
    .map(parseGitStatusEntry)
    .filter(Boolean)
    .map((entry) => ({
      ...entry,
      category: classifyGenericWorktreePath(entry.path),
    }));
  const summary = summarizeGenericWorktreeEntries(entries);
  const dirtyCount = entries.length;
  const unclassifiedCount = summary.byCategory.unclassified || 0;
  const suspiciousCount = summary.byCategory.suspicious || 0;
  const status = dirtyCount === 0
    ? "clean"
    : suspiciousCount > 0
      ? "dirty_suspicious"
      : unclassifiedCount > 0
        ? "dirty_unclassified"
        : "dirty_classified";
  return {
    schema: "clawdad.worktree_hygiene/1",
    generatedAt: new Date().toISOString(),
    projectPath,
    status,
    clean: dirtyCount === 0,
    dirtyCount,
    unclassifiedCount,
    suspiciousCount,
    safeToExpand: unclassifiedCount === 0 && suspiciousCount === 0,
    entries,
    summary,
    requiredAction: dirtyCount === 0
      ? "No worktree hygiene action required."
      : unclassifiedCount > 0 || suspiciousCount > 0
        ? "Resolve, classify, preserve, or quarantine suspicious/unclassified paths before widening delegation."
        : "Dirty paths are classified; keep them tied to the current task and validate before continuing.",
  };
}

async function readDelegateWorktreeHygiene(projectPath) {
  const gitContext = await readWatchtowerGitContext(projectPath);
  return gitContext.hygiene || buildGenericWorktreeHygieneReport(projectPath, gitContext);
}

function delegateWorktreeHygienePromptBlock(hygiene = null) {
  if (!hygiene || hygiene.clean == null) {
    return "Generic worktree hygiene: unavailable for this project.";
  }
  const summary = hygiene.summary?.byCategory
    ? Object.entries(hygiene.summary.byCategory).map(([key, value]) => `${key}=${value}`).join(", ")
    : "";
  const samples = hygiene.summary?.samplesByCategory
    ? Object.entries(hygiene.summary.samplesByCategory)
        .map(([category, paths]) => `${category}: ${paths.join(", ")}`)
        .slice(0, 8)
        .join("\n")
    : "";
  return `Generic worktree hygiene:
- status: ${hygiene.status}
- dirty paths: ${hygiene.dirtyCount ?? "unknown"}
- unclassified paths: ${hygiene.unclassifiedCount ?? "unknown"}
- suspicious paths: ${hygiene.suspiciousCount ?? "unknown"}
- safe to widen: ${hygiene.safeToExpand === false ? "no" : "yes"}
${summary ? `- category counts: ${summary}` : ""}
${hygiene.requiredAction ? `- required action: ${hygiene.requiredAction}` : ""}
${samples ? `Sample paths by category:\n${samples}` : ""}`;
}

async function readWatchtowerGitContext(projectPath) {
  await ensureClawdadGitExclude(projectPath).catch(() => false);
  const [statusResult, shortstatResult, numstatResult, headResult] = await Promise.all([
    runExec("git", ["status", "--porcelain=v1", "-uall"], { cwd: projectPath, ignoreStdin: true, timeoutMs: 5000 }),
    runExec("git", ["diff", "--shortstat"], { cwd: projectPath, ignoreStdin: true, timeoutMs: 5000 }),
    runExec("git", ["diff", "--numstat"], { cwd: projectPath, ignoreStdin: true, timeoutMs: 5000 }),
    runExec("git", ["rev-parse", "HEAD"], { cwd: projectPath, ignoreStdin: true, timeoutMs: 5000 }),
  ]);
  const statusLines = statusResult.ok
    ? String(statusResult.stdout || "").split(/\r?\n/u).filter(Boolean)
    : [];
  const filesChanged = uniqueList(statusLines.map(parseGitStatusPath));
  let inserted = 0;
  let deleted = 0;
  if (numstatResult.ok) {
    for (const line of String(numstatResult.stdout || "").split(/\r?\n/u)) {
      const [additions, deletions] = line.split(/\s+/u);
      const addValue = Number.parseInt(additions, 10);
      const delValue = Number.parseInt(deletions, 10);
      if (Number.isFinite(addValue)) inserted += addValue;
      if (Number.isFinite(delValue)) deleted += delValue;
    }
  }
  const gitContext = {
    ok: statusResult.ok,
    filesChanged,
    shortstat: shortstatResult.ok ? pickString(shortstatResult.stdout) : "",
    inserted,
    deleted,
    changedLines: inserted + deleted,
    head: headResult.ok ? pickString(headResult.stdout) : "",
    rawStatus: statusResult.ok ? statusResult.stdout : "",
  };
  return {
    ...gitContext,
    hygiene: buildGenericWorktreeHygieneReport(projectPath, gitContext),
  };
}

function watchtowerSensitiveFile(pathValue) {
  return /\b(broker|payment|payments|credential|credentials|secret|secrets|token|tokens|live[-_]?order|orders?|stripe|wallet|auth|keys?)\b/iu.test(
    String(pathValue || ""),
  );
}

function watchtowerSectionHeading(line) {
  const value = String(line || "").trim();
  return (
    /^#{1,6}\s+\S/u.test(value) ||
    /^\*\*[^*\n]{2,100}\*\*:?\s*$/u.test(value) ||
    /^[A-Z][A-Za-z0-9 /_-]{2,80}:?\s*$/u.test(value)
  );
}

function watchtowerGuardrailHeading(line) {
  return /^(?:#{1,6}\s*)?(?:\*\*)?(?:hard stops?|hard boundaries?|project boundaries?|guardrails?|safety constraints?|safety rules?)(?:\*\*)?:?\s*$/iu.test(
    String(line || "").trim(),
  );
}

function watchtowerGuardrailLine(line) {
  const value = String(line || "").trim();
  return (
    /\b(?:do not|don't|never|avoid|without|must not|should not|stop and report|blocked only when)\b/iu.test(value) ||
    /\bno\s+(?:paid|spend|credentials?|auth|billing|human|external|broker|live[- ]?order)\b/iu.test(value) ||
    /\b(?:paid services?|paid api|remote gpu|credentials?|broker credentials?|live[- ]?order routing|mfa|billing|account decisions?|external approval|human decision)\b.{0,80}\b(?:hard stops?|hard boundaries?|boundaries?|blocked|forbidden|prohibited)\b/iu.test(value)
  );
}

function watchtowerRiskSignalText(text) {
  const lines = String(text || "").split(/\r?\n/u);
  const kept = [];
  let inGuardrailSection = false;

  for (const rawLine of lines) {
    if (watchtowerGuardrailHeading(rawLine)) {
      inGuardrailSection = true;
      continue;
    }
    if (inGuardrailSection && watchtowerSectionHeading(rawLine)) {
      inGuardrailSection = false;
    }
    if (inGuardrailSection || watchtowerGuardrailLine(rawLine)) {
      continue;
    }
    kept.push(rawLine);
  }

  return kept.join("\n");
}

function watchtowerTextRiskFlags(text) {
  const value = watchtowerRiskSignalText(text);
  const flags = [];
  if (/\b(paid|entitlement|subscription|billing|invoice|api key|api entitlement|licensed data)\b/iu.test(value)) {
    flags.push("paid_data_or_api");
  }
  if (/\b(secret|credential|token|private key|api key|password)\b/iu.test(value)) {
    flags.push("credential_boundary");
  }
  if (/\b(broker|payment|stripe|live order|live-order|trade execution|wallet)\b/iu.test(value)) {
    flags.push("broker_payment_live_order_boundary");
  }
  if (/\b(patient data|protected health information|phi|hipaa|medical records?|clinical records?)\b/iu.test(value)) {
    flags.push("patient_data_boundary");
  }
  if (/\b(medical advice|clinical advice|treatment recommendation|diagnos(?:e|is)|prescrib(?:e|ing)|dosage)\b/iu.test(value)) {
    flags.push("medical_advice_boundary");
  }
  if (/\b(outreach|external contact|contacted|emailed|called|messaged)\b.{0,100}\b(patient|customer|client|user|doctor|clinician|external|recipient)\b/iu.test(value) ||
      /\b(send|sent)\b.{0,40}\b(email|message|dm|text)\b.{0,80}\b(external|patient|customer|client|user|doctor|clinician|recipient)\b/iu.test(value)) {
    flags.push("outreach_boundary");
  }
  if (/\b(legal advice|regulatory approval|compliance approval|irb approval|fda submission|regulated medical claim)\b/iu.test(value)) {
    flags.push("legal_regulatory_boundary");
  }
  if (/\b(needs?|requires?|required)\b.{0,80}\b(human approval|human decision|external approval|manual approval|account decision|mfa|human gate)\b/iu.test(value) ||
      /\bhuman[- ]gated\b/iu.test(value)) {
    flags.push("human_gate");
  }
  if (/\b(readiness|ready for production|production ready|go live|launch ready)\b/iu.test(value)) {
    flags.push("readiness_strengthened");
  }
  if (/\b(paper fill|paper fills|paper result|paper results|paper trading)\b/iu.test(value)) {
    flags.push("paper_results");
  }
  if (/\b(test|tests|check|checks|gate|gates)\b[\s\S]{0,120}\b(fail|failed|failing|error|red|✖)\b/iu.test(value) ||
      /\b(fail|failed|failing|error|red|✖)\b[\s\S]{0,120}\b(test|tests|check|checks|gate|gates)\b/iu.test(value)) {
    flags.push("tests_failed");
  }
  return flags;
}

function watchtowerTestsGates(text) {
  return uniqueList(
    String(text || "")
      .split(/\r?\n/u)
      .filter((line) =>
        /\b(npm test|node --test|pnpm test|yarn test|pytest|cargo test|go test|swift test|forge test|build|typecheck|lint|gate|gates|checks?)\b/iu.test(line),
      )
      .slice(0, 8),
  );
}

function watchtowerReviewStatus(flags = [], event = {}) {
  const set = new Set(flags);
  if (
    set.has("credential_boundary") ||
    set.has("broker_payment_live_order_boundary") ||
    set.has("patient_data_boundary") ||
    set.has("medical_advice_boundary") ||
    set.has("outreach_boundary") ||
    set.has("legal_regulatory_boundary") ||
    set.has("human_gate") ||
    (set.has("paid_data_or_api") && /blocked|failed|hard_stop|needs_human|paid/iu.test(JSON.stringify(event)))
  ) {
    return "hard_stop";
  }
  if (
    set.has("tests_failed") ||
    set.has("hygiene_dirty_unclassified") ||
    set.has("worktree_hygiene_unclassified") ||
    set.has("worktree_hygiene_suspicious") ||
    set.has("sensitive_files")
  ) {
    return "pause_recommended";
  }
  if (
    set.has("large_diff") ||
    set.has("checkpoint_commit") ||
    set.has("readiness_strengthened") ||
    set.has("paper_results") ||
    set.has("paid_data_or_api") ||
    set.has("run_blocked") ||
    set.has("run_paused")
  ) {
    return "needs_review";
  }
  if (set.has("orp_active_item_changed") || set.has("run_state_changed")) {
    return "watch";
  }
  return "info";
}

function watchtowerCardTrigger(flags = [], event = {}) {
  const priority = [
    "credential_boundary",
    "broker_payment_live_order_boundary",
    "paid_data_or_api",
    "patient_data_boundary",
    "medical_advice_boundary",
    "outreach_boundary",
    "legal_regulatory_boundary",
    "human_gate",
    "tests_failed",
    "hygiene_dirty_unclassified",
    "worktree_hygiene_suspicious",
    "worktree_hygiene_unclassified",
    "large_diff",
    "sensitive_files",
    "checkpoint_commit",
    "readiness_strengthened",
    "paper_results",
    "run_blocked",
    "run_paused",
    "orp_active_item_changed",
    "run_state_changed",
  ];
  const found = priority.find((flag) => flags.includes(flag));
  return found || pickString(event.eventType, event.type, "watch");
}

function watchtowerCardTitle(trigger, event = {}) {
  const labels = {
    credential_boundary: "Credential boundary touched",
    broker_payment_live_order_boundary: "Broker/payment/live-order boundary touched",
    paid_data_or_api: "Paid data or API entitlement mentioned",
    patient_data_boundary: "Patient-data boundary touched",
    medical_advice_boundary: "Medical-advice boundary touched",
    outreach_boundary: "External-outreach boundary touched",
    legal_regulatory_boundary: "Legal/regulatory boundary touched",
    human_gate: "Human approval gate touched",
    tests_failed: "Tests or gates failed",
    hygiene_dirty_unclassified: "ORP hygiene has unclassified dirty state",
    worktree_hygiene_suspicious: "Worktree has suspicious dirty state",
    worktree_hygiene_unclassified: "Worktree has unclassified dirty state",
    large_diff: "Large diff needs review",
    sensitive_files: "Sensitive files changed",
    checkpoint_commit: "Checkpoint commit appeared",
    readiness_strengthened: "Readiness claim strengthened",
    paper_results: "Paper result created or referenced",
    run_blocked: "Delegate run blocked",
    run_paused: "Delegate run paused",
    orp_active_item_changed: "ORP active item changed",
    run_state_changed: "Delegate state changed",
  };
  return labels[trigger] || pickString(event.title, "Watchtower review card");
}

function watchtowerEventToCard(event) {
  if (event.reviewStatus === "info") {
    return null;
  }
  const trigger = watchtowerCardTrigger(event.riskFlags, event);
  return {
    id: watchtowerId("card", event.sourceRef, trigger),
    eventId: event.id,
    projectPath: event.projectPath,
    laneId: normalizeWatchtowerLaneId(event.laneId),
    runId: event.runId,
    at: event.at,
    trigger,
    title: watchtowerCardTitle(trigger, event),
    summary: event.workerSummary || event.body || event.currentDecision || event.title,
    reviewStatus: event.reviewStatus,
    riskFlags: event.riskFlags,
    riskFlagsText: JSON.stringify(event.riskFlags),
    sourceRef: `card:${event.sourceRef}:${trigger}`,
    payload: {
      sourceEventId: event.id,
      sourceEventLaneId: normalizeWatchtowerLaneId(event.laneId) || null,
      sourceEventStep: Number.parseInt(String(event.payload?.step ?? event.step ?? "0"), 10) || null,
      sourceEventType: pickString(event.eventType, event.payload?.type) || null,
      sourceType: event.sourceType,
      sourceRef: event.sourceRef,
    },
    createdAt: new Date().toISOString(),
  };
}

function watchtowerEventToCards(event) {
  if (event.reviewStatus === "info") {
    return [];
  }
  const triggers = uniqueList(
    (event.riskFlags && event.riskFlags.length > 0
      ? event.riskFlags
      : [watchtowerCardTrigger([], event)]
    ).filter((flag) => flag !== "run_state_changed" || event.reviewStatus !== "watch"),
  );
  return triggers
    .map((trigger) =>
      watchtowerEventToCard({
        ...event,
        riskFlags: [trigger],
        reviewStatus: watchtowerReviewStatus([trigger], event),
      }),
    )
    .filter(Boolean);
}

function watchtowerActiveOrpItemFromPayload(payload = {}) {
  const summary = payload.summary && typeof payload.summary === "object" ? payload.summary : {};
  const additional = summary.additional && typeof summary.additional === "object" ? summary.additional : {};
  return pickString(
    summary.active_primary_id,
    summary.activePrimaryId,
    additional.active_item_id,
    additional.activeItemId,
    payload.next_action,
    payload.nextAction,
  );
}

async function readWatchtowerOrpContext(projectPath) {
  const [continuation, hygiene] = await Promise.all([
    runOrp(["frontier", "continuation-status", "--json"], {
      cwd: projectPath,
      ignoreStdin: true,
      timeoutMs: 10_000,
    }),
    runOrp(["hygiene", "--json"], {
      cwd: projectPath,
      ignoreStdin: true,
      timeoutMs: 10_000,
    }),
  ]);
  const continuationPayload = parseOptionalJsonObject(continuation.stdout) || {};
  const hygienePayload = parseOptionalJsonObject(hygiene.stdout) || {};
  return {
    continuationOk: continuation.ok,
    continuation: continuationPayload,
    activeOrpItem: watchtowerActiveOrpItemFromPayload(continuationPayload),
    hygieneOk: hygiene.ok,
    hygiene: hygienePayload,
  };
}

function watchtowerCurrentDecision(event = {}) {
  const parts = [
    pickString(event.state) ? `state=${event.state}` : "",
    pickString(event.stopReason) ? `stop=${event.stopReason}` : "",
    pickString(event.nextAction) ? `next=${event.nextAction}` : "",
  ].filter(Boolean);
  return parts.join("; ");
}

function watchtowerEventBody(event = {}) {
  return [
    pickString(event.error) ? `Error: ${event.error}` : "",
    pickString(event.summary),
    pickString(event.text),
    pickString(event.nextAction) ? `Next: ${event.nextAction}` : "",
    event.checkpoint ? JSON.stringify(event.checkpoint) : "",
  ].filter(Boolean).join("\n\n");
}

function buildWatchtowerFeedEventFromDelegateEvent(projectPath, event, context, laneId = defaultDelegateLaneId) {
  const body = watchtowerEventBody(event);
  const filesChanged = context.git.filesChanged || [];
  const testsGates = watchtowerTestsGates(body);
  const flags = [
    ...watchtowerTextRiskFlags(`${event.title || ""}\n${body}`),
    ...(filesChanged.some(watchtowerSensitiveFile) ? ["sensitive_files"] : []),
  ];
  if (event.type === "run_blocked") flags.push("run_blocked");
  if (event.type === "run_paused" || event.type === "pause_requested") flags.push("run_paused");
  if (event.type === "run_failed" || event.error) flags.push("run_state_changed");
  const reviewStatus = watchtowerReviewStatus(uniqueList(flags), event);
  const normalizedLaneId = normalizeDelegateLaneId(laneId || defaultDelegateLaneId);
  const sourceRef = `delegate-event:${normalizedLaneId}:${event.runId || "unknown"}:${event.id}`;
  return {
    id: watchtowerId(sourceRef),
    projectPath,
    laneId: normalizedLaneId,
    runId: event.runId || null,
    at: event.at || new Date().toISOString(),
    sourceType: "delegate_event",
    sourceRef,
    eventType: event.type,
    title: event.title || event.type.replace(/_/gu, " "),
    body,
    activeOrpItem: context.orp.activeOrpItem || "",
    workerSummary: pickString(event.summary, event.text, event.error),
    filesChanged,
    filesChangedText: JSON.stringify(filesChanged),
    testsGates,
    testsGatesText: JSON.stringify(testsGates),
    currentDecision: watchtowerCurrentDecision(event),
    riskFlags: uniqueList(flags),
    riskFlagsText: JSON.stringify(uniqueList(flags)),
    reviewStatus,
    payload: event,
    createdAt: new Date().toISOString(),
  };
}

function buildSyntheticWatchtowerEvent(projectPath, kind, payload = {}, laneId = "") {
  const flags = uniqueList(payload.riskFlags || []);
  const sourceRef = `${kind}:${payload.sourceKey || watchtowerId(JSON.stringify(payload))}`;
  return {
    id: watchtowerId(sourceRef),
    projectPath,
    laneId: normalizeWatchtowerLaneId(laneId),
    runId: pickString(payload.runId) || null,
    at: pickString(payload.at) || new Date().toISOString(),
    sourceType: "watchtower_signal",
    sourceRef,
    eventType: kind,
    title: pickString(payload.title) || kind.replace(/_/gu, " "),
    body: pickString(payload.body, payload.summary),
    activeOrpItem: pickString(payload.activeOrpItem),
    workerSummary: pickString(payload.summary, payload.body),
    filesChanged: Array.isArray(payload.filesChanged) ? payload.filesChanged : [],
    filesChangedText: JSON.stringify(Array.isArray(payload.filesChanged) ? payload.filesChanged : []),
    testsGates: Array.isArray(payload.testsGates) ? payload.testsGates : [],
    testsGatesText: JSON.stringify(Array.isArray(payload.testsGates) ? payload.testsGates : []),
    currentDecision: pickString(payload.currentDecision),
    riskFlags: flags,
    riskFlagsText: JSON.stringify(flags),
    reviewStatus: normalizeWatchtowerReviewStatus(payload.reviewStatus || watchtowerReviewStatus(flags, payload)),
    payload,
    createdAt: new Date().toISOString(),
  };
}

async function insertWatchtowerEventWithCard(projectPath, event) {
  const cards = watchtowerEventToCards(event);
  const indexed = await insertWatchtowerEvent(projectPath, event, cards);
  return { event, cards, indexed };
}

async function scanWatchtowerDelegateEvents(projectPath, context, laneId = defaultDelegateLaneId) {
  const runsDir = delegatePaths(projectPath, laneId).runsDir;
  let files = [];
  try {
    files = await readdir(runsDir);
  } catch (_error) {
    return { eventCount: 0, cardCount: 0 };
  }
  const runFiles = [];
  let skippedCodexEventRunCount = 0;
  for (const file of files.filter((value) => value.endsWith(".jsonl"))) {
    if (file.endsWith(".codex-events.jsonl") && !watchtowerIndexCodexEvents) {
      skippedCodexEventRunCount += 1;
      continue;
    }
    const filePath = path.join(runsDir, file);
    const signature = await watchtowerFileSignature(filePath).catch(() => "");
    const runId = file.replace(/\.jsonl$/u, "");
    const canonicalRunId = canonicalDelegateRunIdForEventFile(runId);
    runFiles.push({
      file,
      filePath,
      signature,
      runId,
      canonicalRunId,
      stateKey: watchtowerDelegateRunScanStateKey(laneId, runId),
    });
  }
  runFiles.sort((left, right) => {
    const leftMtime = Number.parseInt(String(left.signature).split(":")[0] || "0", 10) || 0;
    const rightMtime = Number.parseInt(String(right.signature).split(":")[0] || "0", 10) || 0;
    return rightMtime - leftMtime || left.file.localeCompare(right.file);
  });

  let eventCount = 0;
  let cardCount = 0;
  let scannedCount = 0;
  let skippedCount = 0;
  let skippedRunCount = skippedCodexEventRunCount;
  const currentRunId = safeDelegateRunId(context.status?.runId);
  const scanState = await readWatchtowerScanStateMap(
    projectPath,
    runFiles.map((entry) => entry.stateKey),
  ).catch(() => new Map());
  const historicalUntrackedRunIds = runFiles
    .filter((entry) => {
      const isCurrentRun = currentRunId && entry.canonicalRunId === currentRunId;
      return !isCurrentRun && !scanState.get(entry.stateKey);
    })
    .map((entry) => entry.canonicalRunId);
  const indexedRunIds = await readWatchtowerIndexedDelegateRunIds(
    projectPath,
    laneId,
    historicalUntrackedRunIds,
  ).catch(() => new Set());
  const scanStateWrites = [];
  for (const entry of runFiles) {
    const runId = entry.runId;
    const previousSignature = scanState.get(entry.stateKey) || "";
    const isCurrentRun = currentRunId && entry.canonicalRunId === currentRunId;
    if (entry.signature && previousSignature === entry.signature && !isCurrentRun) {
      skippedRunCount += 1;
      continue;
    }
    if (!previousSignature && !isCurrentRun && indexedRunIds.has(entry.canonicalRunId)) {
      if (entry.signature) {
        scanStateWrites.push({ key: entry.stateKey, value: entry.signature });
      }
      skippedRunCount += 1;
      continue;
    }

    const page = await readDelegateRunEvents(projectPath, {
      runId,
      cursor: 0,
      limit: 5000,
      laneId,
    });
    const candidates = [];
    for (const event of page.events) {
      const feedEvent = buildWatchtowerFeedEventFromDelegateEvent(projectPath, event, context, laneId);
      const cards = watchtowerEventToCards(feedEvent);
      feedEvent.contentHash = watchtowerFeedEventContentHash(feedEvent, cards);
      candidates.push({ event: feedEvent, cards });
      scannedCount += 1;
    }
    const existingHashes = await readWatchtowerEventContentHashes(
      projectPath,
      candidates.map((candidate) => candidate.event.id),
    );
    const changed = candidates.filter((candidate) => existingHashes.get(candidate.event.id) !== candidate.event.contentHash);
    if (changed.length > 0) {
      await insertWatchtowerEventBatch(projectPath, changed);
    }
    eventCount += changed.length;
    cardCount += changed.reduce((total, candidate) => total + candidate.cards.length, 0);
    skippedCount += candidates.length - changed.length;
    if (entry.signature) {
      scanStateWrites.push({ key: entry.stateKey, value: entry.signature });
    }
  }
  await writeWatchtowerScanStateBatch(projectPath, scanStateWrites).catch(() => {});
  return { eventCount, cardCount, scannedCount, skippedCount, skippedRunCount };
}

async function scanWatchtowerSignals(projectPath, context) {
  let eventCount = 0;
  let cardCount = 0;
  const addSignal = async (kind, payload) => {
    const result = await insertWatchtowerEventWithCard(
      projectPath,
      buildSyntheticWatchtowerEvent(projectPath, kind, payload, ""),
    );
    if (result.indexed) {
      eventCount += 1;
      cardCount += result.cards.length;
    }
  };

  const currentHead = context.git.head;
  const previousHead = await readWatchtowerScanState(projectPath, "git.head");
  if (currentHead && previousHead && previousHead !== currentHead) {
    await addSignal("checkpoint_commit", {
      title: "Checkpoint commit appeared",
      summary: `Git HEAD moved from ${previousHead.slice(0, 10)} to ${currentHead.slice(0, 10)}.`,
      sourceKey: currentHead,
      riskFlags: ["checkpoint_commit"],
      reviewStatus: "needs_review",
    });
  }
  if (currentHead) {
    await writeWatchtowerScanState(projectPath, "git.head", currentHead);
  }

  const activeOrpItem = context.orp.activeOrpItem;
  const previousOrpItem = await readWatchtowerScanState(projectPath, "orp.active_item");
  if (activeOrpItem && previousOrpItem && previousOrpItem !== activeOrpItem) {
    await addSignal("orp_active_item_changed", {
      title: "ORP active item changed",
      summary: `Active ORP item changed from ${previousOrpItem} to ${activeOrpItem}.`,
      sourceKey: activeOrpItem,
      activeOrpItem,
      riskFlags: ["orp_active_item_changed"],
      reviewStatus: "watch",
    });
  }
  if (activeOrpItem) {
    await writeWatchtowerScanState(projectPath, "orp.active_item", activeOrpItem);
  }

  const hygiene = context.orp.hygiene || {};
  const unclassifiedCount = Number(hygiene.unclassifiedCount ?? hygiene.unclassified_count ?? 0);
  const stopCondition = boolFromUnknown(hygiene.stopCondition ?? hygiene.stop_condition, false);
  if (unclassifiedCount > 0 || stopCondition) {
    await addSignal("hygiene_dirty_unclassified", {
      title: "ORP hygiene needs classification",
      summary: orpPayloadReason(hygiene) ||
        `ORP hygiene reports ${unclassifiedCount} unclassified path(s).`,
      sourceKey: watchtowerId(JSON.stringify(hygiene)),
      riskFlags: ["hygiene_dirty_unclassified"],
      reviewStatus: "pause_recommended",
      payload: hygiene,
    });
  }

  const gitHygiene = context.git.hygiene || {};
  const gitSuspiciousCount = Number(gitHygiene.suspiciousCount ?? 0);
  const gitUnclassifiedCount = Number(gitHygiene.unclassifiedCount ?? 0);
  if (gitSuspiciousCount > 0 || gitUnclassifiedCount > 0 || gitHygiene.safeToExpand === false) {
    const trigger = gitSuspiciousCount > 0 ? "worktree_hygiene_suspicious" : "worktree_hygiene_unclassified";
    await addSignal("worktree_hygiene", {
      title: trigger === "worktree_hygiene_suspicious"
        ? "Worktree has suspicious dirty state"
        : "Worktree has unclassified dirty state",
      summary: gitHygiene.requiredAction ||
        `Generic worktree hygiene reports ${gitSuspiciousCount} suspicious and ${gitUnclassifiedCount} unclassified path(s).`,
      sourceKey: watchtowerId(JSON.stringify({
        status: gitHygiene.status,
        suspiciousCount: gitSuspiciousCount,
        unclassifiedCount: gitUnclassifiedCount,
        entries: (gitHygiene.entries || []).map((entry) => entry.path).slice(0, 40),
      })),
      filesChanged: (gitHygiene.entries || []).map((entry) => entry.path),
      riskFlags: [trigger],
      reviewStatus: "pause_recommended",
      payload: gitHygiene,
    });
  }

  const filesChanged = context.git.filesChanged || [];
  const sensitiveFiles = filesChanged.filter(watchtowerSensitiveFile);
  if (sensitiveFiles.length > 0) {
    await addSignal("sensitive_files_changed", {
      title: "Sensitive files changed",
      summary: sensitiveFiles.slice(0, 8).join("\n"),
      sourceKey: watchtowerId(sensitiveFiles.join("\n")),
      filesChanged: sensitiveFiles,
      riskFlags: ["sensitive_files"],
      reviewStatus: "pause_recommended",
    });
  }

  const largeDiff = filesChanged.length >= 15 || context.git.changedLines >= 800;
  if (largeDiff) {
    await addSignal("large_diff", {
      title: "Large diff needs review",
      summary: context.git.shortstat || `${filesChanged.length} changed file(s).`,
      sourceKey: watchtowerId(filesChanged.join("\n"), context.git.shortstat),
      filesChanged,
      riskFlags: ["large_diff"],
      reviewStatus: "pause_recommended",
    });
  }

  return { eventCount, cardCount };
}

async function runWatchtowerScan(projectPath, laneId = defaultDelegateLaneId) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  await ensureWatchtowerDb(projectPath);
  const [git, orp, status] = await Promise.all([
    readWatchtowerGitContext(projectPath),
    readWatchtowerOrpContext(projectPath).catch((error) => ({
      continuationOk: false,
      continuation: {},
      activeOrpItem: "",
      hygieneOk: false,
      hygiene: { error: error.message },
    })),
    readDelegateStatus(projectPath, { laneId: normalizedLaneId }).catch(() => null),
  ]);
  const context = {
    git,
    orp,
    status,
  };
  const delegateResult = await scanWatchtowerDelegateEvents(projectPath, context, normalizedLaneId);
  const signalResult = await scanWatchtowerSignals(projectPath, context);
  return {
    ok: true,
    projectPath,
    laneId: normalizedLaneId,
    dbFile: watchtowerPaths(projectPath).dbFile,
    activeOrpItem: orp.activeOrpItem || "",
    runId: pickString(status?.runId) || null,
    indexedEvents: delegateResult.eventCount + signalResult.eventCount,
    scannedEvents: delegateResult.scannedCount + signalResult.eventCount,
    skippedEvents: delegateResult.skippedCount,
    skippedRuns: delegateResult.skippedRunCount,
    queuedCards: delegateResult.cardCount + signalResult.cardCount,
    filesChanged: git.filesChanged,
    changedLines: git.changedLines,
  };
}

async function evaluateDelegateReviewGuard(projectPath, {
  delegateDecision = {},
  laneId = defaultDelegateLaneId,
  step = null,
} = {}) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  const scan = await runWatchtowerScan(projectPath, normalizedLaneId);
  const [git, orp] = await Promise.all([
    readWatchtowerGitContext(projectPath),
    readWatchtowerOrpContext(projectPath).catch(() => ({ hygiene: {} })),
  ]);
  const freshSignals = [];
  const gitHygiene = git.hygiene || {};
  const suspiciousCount = Number(gitHygiene.suspiciousCount ?? 0);
  const unclassifiedCount = Number(gitHygiene.unclassifiedCount ?? 0);
  if (suspiciousCount > 0 || unclassifiedCount > 0 || gitHygiene.safeToExpand === false) {
    freshSignals.push({
      reviewStatus: "pause_recommended",
      trigger: suspiciousCount > 0 ? "worktree_hygiene_suspicious" : "worktree_hygiene_unclassified",
      title: suspiciousCount > 0
        ? "Worktree has suspicious dirty state"
        : "Worktree has unclassified dirty state",
      summary: gitHygiene.requiredAction ||
        `Generic worktree hygiene reports ${suspiciousCount} suspicious and ${unclassifiedCount} unclassified path(s).`,
      payload: gitHygiene,
    });
  }
  const orpHygiene = orp.hygiene || {};
  const orpUnclassifiedCount = Number(orpHygiene.unclassifiedCount ?? orpHygiene.unclassified_count ?? 0);
  const orpStopCondition = boolFromUnknown(orpHygiene.stopCondition ?? orpHygiene.stop_condition, false);
  if (orpUnclassifiedCount > 0 || orpStopCondition) {
    freshSignals.push({
      reviewStatus: "pause_recommended",
      trigger: "hygiene_dirty_unclassified",
      title: "ORP hygiene has unclassified dirty state",
      summary: orpPayloadReason(orpHygiene) ||
        `ORP hygiene reports ${orpUnclassifiedCount} unclassified path(s).`,
      payload: orpHygiene,
    });
  }
  const sensitiveFiles = (git.filesChanged || []).filter(watchtowerSensitiveFile);
  if (sensitiveFiles.length > 0) {
    freshSignals.push({
      reviewStatus: "pause_recommended",
      trigger: "sensitive_files",
      title: "Sensitive files changed",
      summary: sensitiveFiles.slice(0, 8).join("\n"),
      filesChanged: sensitiveFiles,
    });
  }
  const largeDiff = (git.filesChanged || []).length >= 15 || git.changedLines >= 800;
  if (largeDiff) {
    freshSignals.push({
      reviewStatus: "needs_review",
      trigger: "large_diff",
      title: "Large diff checkpoint",
      summary: git.shortstat || `${(git.filesChanged || []).length} changed file(s).`,
      filesChanged: git.filesChanged || [],
    });
  }
  const allCards = await readWatchtowerReviewCards(projectPath, { limit: 80, laneId: normalizedLaneId });
  const cards = currentWatchtowerReviewCards(allCards, scan, { step }).slice(0, 12);
  const policy = delegateWatchtowerReviewDecision({
    signals: [...freshSignals, ...cards],
    delegateDecision,
  });
  return {
    ok: true,
    scan,
    cards,
    card: policy.card,
    hardStop: Boolean(policy.hardStop),
    pauseRecommended: Boolean(policy.pauseRecommended),
    repairRecommended: Boolean(policy.repairRecommended),
    correctiveRecommended: Boolean(policy.correctiveRecommended),
    checkpointRecommended: Boolean(policy.checkpointRecommended),
    reason: policy.reason,
    nextAction: policy.nextAction,
    summary: policy.summary,
  };
}

async function queueDelegateReviewGuardCorrectiveStep({ projectPath, config, status, guard, step, logRunEvent }) {
  const laneId = normalizeDelegateLaneId(config?.laneId || status?.laneId || defaultDelegateLaneId);
  const nextStatus = await writeDelegateStatus(projectPath, {
    ...status,
    laneId,
    state: "running",
    nextAction: guard?.nextAction || status?.nextAction || "address the Watchtower review finding before widening work",
    stopReason: null,
    codexGoal: delegateCodexGoalWithStatus(status?.codexGoal, "active", {
      objective: guard?.nextAction || status?.nextAction || "",
    }),
    error: "",
  }, laneId);
  await logRunEvent("watchtower_corrective_step_queued", {
    title: "Watchtower corrective step queued",
    step,
    state: nextStatus.state,
    summary: guard?.summary || "",
    nextAction: nextStatus.nextAction,
    payload: {
      reason: guard?.reason || null,
      reviewCard: guard?.card || null,
      pauseRecommended: Boolean(guard?.pauseRecommended),
      repairRecommended: Boolean(guard?.repairRecommended),
      correctiveRecommended: Boolean(guard?.correctiveRecommended),
    },
  });
  return nextStatus;
}

async function stopDelegateForReviewGuard({ projectPath, config, status, guard, step, logRunEvent }) {
  const laneId = normalizeDelegateLaneId(config?.laneId || status?.laneId || defaultDelegateLaneId);
  const hardStop = Boolean(guard?.hardStop);
  const nextConfig = await writeDelegateConfig(projectPath, {
    ...config,
    enabled: false,
  }, laneId);
  const codexGoal = await syncDelegateCodexGoalStatus(projectPath, status, "paused", {
    objective: guard?.nextAction || status?.nextAction || "",
  });
  const nextStatus = await writeDelegateStatus(projectPath, {
    ...status,
    laneId,
    state: hardStop ? "blocked" : "paused",
    completedAt: new Date().toISOString(),
    pauseRequested: false,
    stopReason: hardStop ? "needs_human" : "review_recommended",
    nextAction: guard?.nextAction ||
      (hardStop
        ? "review Watchtower hard-stop card before continuing delegation"
        : "review/checkpoint the current diff before continuing delegation"),
    codexGoal,
    error: "",
  }, laneId);
  await logRunEvent(hardStop ? "run_blocked" : "run_paused", {
    title: hardStop ? "Watchtower hard stop" : "Paused for Watchtower review",
    step,
    state: nextStatus.state,
    stopReason: nextStatus.stopReason,
    summary: guard?.summary || "",
    nextAction: nextStatus.nextAction,
    payload: {
      reviewCard: guard?.card || null,
      scan: guard?.scan || null,
    },
  });
  return {
    config: nextConfig,
    status: nextStatus,
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

async function readDelegateRunList(projectPath, { status = null, summarySnapshots = null, laneId = defaultDelegateLaneId } = {}) {
  const runsById = new Map();
  const summaries = Array.isArray(summarySnapshots)
    ? summarySnapshots
    : await readDelegateRunSummarySnapshots(projectPath, laneId);

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
    runFiles = await readdir(delegatePaths(projectPath, laneId).runsDir, { withFileTypes: true });
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
    const raw = await readOptionalText(path.join(delegatePaths(projectPath, laneId).runsDir, entry.name));
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

async function readDelegateRunSummarySnapshots(projectPath, laneId = defaultDelegateLaneId) {
  const payload = (await readOptionalJson(delegatePaths(projectPath, laneId).runSummariesFile)) || {};
  const snapshots = Array.isArray(payload.snapshots) ? payload.snapshots : [];
  return snapshots
    .map(normalizeDelegateRunSummarySnapshot)
    .filter((snapshot) => snapshot.summary)
    .sort((left, right) => delegateRunSummaryTimestampMs(right) - delegateRunSummaryTimestampMs(left));
}

async function writeDelegateRunSummarySnapshots(projectPath, snapshots, laneId = defaultDelegateLaneId) {
  await ensureDelegateLaneStorage(projectPath, laneId);
  const normalizedSnapshots = (Array.isArray(snapshots) ? snapshots : [])
    .map(normalizeDelegateRunSummarySnapshot)
    .filter((snapshot) => snapshot.summary)
    .sort((left, right) => delegateRunSummaryTimestampMs(right) - delegateRunSummaryTimestampMs(left))
    .slice(0, delegateRunSummarySnapshotLimit);

  await writeDelegateJsonStorage(projectPath, laneId, delegatePaths(projectPath, laneId).runSummariesFile, {
    version: 1,
    snapshots: normalizedSnapshots,
  });
  return normalizedSnapshots;
}

function normalizeCodexGoalMode(value) {
  const mode = String(value || "auto").trim().toLowerCase();
  if (["auto", "off", "required"].includes(mode)) {
    return mode;
  }
  return "auto";
}

function normalizeCodexGoalStatus(value, fallback = "") {
  const status = String(value || "").trim();
  if (["active", "paused", "budgetLimited", "complete"].includes(status)) {
    return status;
  }
  return fallback;
}

function normalizeNullableBoolean(value) {
  if (value === true || value === false) {
    return value;
  }
  if (value === null) {
    return null;
  }
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) {
    return null;
  }
  if (["1", "true", "yes", "on"].includes(text)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(text)) {
    return false;
  }
  return null;
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDelegateCodexGoal(payload = null) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const mode = normalizeCodexGoalMode(payload.mode);
  const supported = normalizeNullableBoolean(payload.supported);
  const synced = normalizeNullableBoolean(payload.synced);
  const skipped = normalizeNullableBoolean(payload.skipped);
  const status = normalizeCodexGoalStatus(payload.status, "");
  const objective = trimTrailingNewlines(String(payload.objective || "")) || null;
  const error = trimTrailingNewlines(String(payload.error || "")) || null;
  const threadId = pickString(payload.threadId, payload.thread_id) || null;
  const updatedAt = pickString(payload.updatedAt, payload.updated_at) || null;
  const tokenBudget = normalizeOptionalNumber(payload.tokenBudget ?? payload.token_budget);
  const tokensUsed = normalizeOptionalNumber(payload.tokensUsed ?? payload.tokens_used);
  const timeUsedSeconds = normalizeOptionalNumber(payload.timeUsedSeconds ?? payload.time_used_seconds);
  const createdAt = normalizeOptionalNumber(payload.createdAt ?? payload.created_at);

  if (
    !objective &&
    !status &&
    !error &&
    !threadId &&
    supported === null &&
    synced === null &&
    skipped === null &&
    tokenBudget === null &&
    tokensUsed === null &&
    timeUsedSeconds === null
  ) {
    return null;
  }

  return {
    mode,
    supported,
    synced: synced === null ? false : synced,
    skipped: skipped === null ? mode === "off" : skipped,
    threadId,
    objective,
    status: status || null,
    tokenBudget,
    tokensUsed,
    timeUsedSeconds,
    createdAt,
    updatedAt,
    error,
  };
}

function buildDelegateCodexGoalMirror({
  threadGoal = "",
  status = "active",
  threadId = "",
  supported = null,
  synced = false,
  skipped = false,
  error = "",
  mode = codexGoalMode,
  tokenBudget = null,
} = {}) {
  const normalizedMode = normalizeCodexGoalMode(mode);
  if (normalizedMode === "off") {
    return null;
  }
  return normalizeDelegateCodexGoal({
    mode: normalizedMode,
    supported,
    synced,
    skipped,
    threadId,
    objective: threadGoal,
    status: normalizeCodexGoalStatus(status, "active"),
    tokenBudget,
    error,
    updatedAt: new Date().toISOString(),
  });
}

function delegateCodexGoalWithStatus(currentGoal, status, { error = "", objective = "" } = {}) {
  const current = normalizeDelegateCodexGoal(currentGoal);
  if (!current || current.mode === "off") {
    return current;
  }
  return normalizeDelegateCodexGoal({
    ...current,
    status: normalizeCodexGoalStatus(status, current.status || "active"),
    objective: trimTrailingNewlines(String(objective || "")) || current.objective,
    error: trimTrailingNewlines(String(error || "")) || current.error,
    updatedAt: new Date().toISOString(),
  });
}

function normalizeDelegateStatus(payload = {}) {
  const normalizedState = String(payload.state || "idle").trim().toLowerCase();
  const allowedStates = ["idle", "planning", "starting", "dispatching", "running", "paused", "blocked", "completed", "failed"];
  const state = allowedStates.includes(normalizedState) ? normalizedState : "idle";
  const stepCount = Number.parseInt(String(payload.stepCount || "0"), 10) || 0;
  const activeStep = Number.parseInt(String(payload.activeStep ?? payload.active_step ?? ""), 10);
  const rawActiveRequestId = pickString(payload.activeRequestId, payload.active_request_id) || null;
  const activeRequestId = state === "running" ? rawActiveRequestId : null;
  const normalizedActiveStep = Number.isFinite(activeStep) && activeStep > 0 ? activeStep : null;
  const maxSteps = normalizeOptionalPositiveInteger(payload.maxSteps ?? payload.maxStepsPerRun ?? null, { max: 200 });

  return {
    laneId: normalizeDelegateLaneId(payload.laneId || defaultDelegateLaneId),
    state,
    runId: pickString(payload.runId, payload.requestId) || null,
    projectPath: pickString(payload.projectPath) || null,
    startedAt: pickString(payload.startedAt) || null,
    updatedAt: pickString(payload.updatedAt) || null,
    completedAt: pickString(payload.completedAt) || null,
    delegateSessionId: pickString(payload.delegateSessionId, payload.sessionId) || null,
    delegateSessionLabel: pickString(payload.delegateSessionLabel, payload.sessionLabel) || null,
    planSnapshotId: pickString(payload.planSnapshotId, payload.snapshotId) || null,
    activeRequestId,
    activeStep: state === "running"
      ? normalizedActiveStep || (activeRequestId ? stepCount + 1 : null)
      : null,
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
    codexGoal: normalizeDelegateCodexGoal(payload.codexGoal || payload.codex_goal),
    error: trimTrailingNewlines(String(payload.error || "")) || null,
  };
}

function normalizeDelegateDirectionCheckResult(payload = {}) {
  const mode = normalizeDelegateDirectionCheckMode(payload.mode);
  const decisionValue = pickString(payload.decision, mode === "off" ? "skipped" : "aligned").toLowerCase();
  const allowedDecisions = ["aligned", "caution", "pause", "retarget", "skipped"];
  const decision = allowedDecisions.includes(decisionValue) ? decisionValue : "caution";
  const rawConfidence = Number.parseFloat(String(payload.confidence ?? "0"));
  const confidence = Number.isFinite(rawConfidence)
    ? (rawConfidence > 1 ? rawConfidence / 100 : rawConfidence)
    : 0;
  const checkedAt = pickString(payload.checkedAt, payload.checked_at) || new Date().toISOString();
  const humanNeeded = boolFromUnknown(payload.humanNeeded ?? payload.human_needed, false);
  const detectedDrift = boolFromUnknown(payload.detectedDrift ?? payload.detected_drift, false);
  const enforceable = mode === "enforce" && (decision === "pause" || humanNeeded);

  return {
    mode,
    decision,
    ok: decision !== "pause" && !humanNeeded,
    enforceable,
    confidence: Math.max(0, Math.min(1, Number.isFinite(confidence) ? confidence : 0)),
    reason: trimTrailingNewlines(String(payload.reason || "")) || null,
    detectedDrift,
    humanNeeded,
    source: pickString(payload.source) || "heuristic",
    previousNextAction: trimTrailingNewlines(String(payload.previousNextAction || payload.previous_next_action || "")) || null,
    proposedNextAction: trimTrailingNewlines(String(payload.proposedNextAction || payload.proposed_next_action || "")) || null,
    latestOutcome: trimTrailingNewlines(String(payload.latestOutcome || payload.latest_outcome || "")) || null,
    recommendedNextAction:
      trimTrailingNewlines(String(payload.recommendedNextAction || payload.recommended_next_action || "")) || null,
    checks: payload.checks && typeof payload.checks === "object" && !Array.isArray(payload.checks)
      ? payload.checks
      : {},
    checkedAt,
  };
}

function normalizeDelegateSupervisorState(payload = {}) {
  const normalizedState = String(payload.state || "stopped").trim().toLowerCase();
  const allowedStates = ["idle", "running", "paused", "stopped", "blocked", "completed"];
  const state = allowedStates.includes(normalizedState) ? normalizedState : "stopped";
  const restartCount = Number.parseInt(String(payload.restartCount || "0"), 10) || 0;
  const intervalSeconds = Number.parseInt(String(payload.intervalSeconds || ""), 10);
  const maxRuns = normalizeOptionalPositiveInteger(payload.maxRuns ?? null, { max: 10_000 });
  const pid = Number.parseInt(String(payload.pid || payload.supervisorPid || "0"), 10);
  const gateResult =
    payload.lastGateResult && typeof payload.lastGateResult === "object" && !Array.isArray(payload.lastGateResult)
      ? payload.lastGateResult
      : null;
  const directionCheck =
    payload.lastDirectionCheck && typeof payload.lastDirectionCheck === "object" && !Array.isArray(payload.lastDirectionCheck)
      ? normalizeDelegateDirectionCheckResult(payload.lastDirectionCheck)
      : null;

  return {
    laneId: normalizeDelegateLaneId(payload.laneId || defaultDelegateLaneId),
    projectPath: pickString(payload.projectPath) || null,
    enabled: boolFromUnknown(payload.enabled, false),
    state,
    pid: Number.isFinite(pid) && pid > 0 ? pid : null,
    startedAt: pickString(payload.startedAt) || null,
    updatedAt: pickString(payload.updatedAt) || null,
    stoppedAt: pickString(payload.stoppedAt) || null,
    intervalSeconds: Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : null,
    maxRuns,
    restartCount: Math.max(0, restartCount),
    lastGateResult: gateResult,
    lastDirectionCheck: directionCheck,
    lastRestartAt: pickString(payload.lastRestartAt) || null,
    lastBlockerReason: trimTrailingNewlines(String(payload.lastBlockerReason || "")) || null,
    lastConsumedNextAction: trimTrailingNewlines(String(payload.lastConsumedNextAction || "")) || null,
    lastOutcome: trimTrailingNewlines(String(payload.lastOutcome || payload.latestOutcome || "")) || null,
    lastAction: pickString(payload.lastAction) || null,
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

async function processCommand(pid) {
  const normalizedPid = Number.parseInt(String(pid || "0"), 10);
  if (!Number.isFinite(normalizedPid) || normalizedPid <= 0) {
    return "";
  }
  const result = await runExec("ps", ["-p", String(normalizedPid), "-o", "command="], {
    ignoreStdin: true,
    timeoutMs: 1000,
  }).catch(() => null);
  return result?.ok ? pickString(result.stdout) : "";
}

async function delegateRunSupervisorPidMatches(pid, projectPath, runId) {
  const command = await processCommand(pid);
  if (!command) {
    return false;
  }
  return (
    command.includes("delegate-supervisor") &&
    command.includes(projectPath) &&
    (!runId || command.includes(runId))
  );
}

function delegateStatusNeedsSupervisor(status = {}, config = {}) {
  const state = String(status?.state || "").trim().toLowerCase();
  return (
    ["starting", "dispatching", "running"].includes(state) &&
    boolFromUnknown(config?.enabled, false) &&
    !delegateSupervisorIsLive(status)
  );
}

async function writeDelegateStatus(projectPath, status, laneId = status?.laneId || defaultDelegateLaneId) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  await ensureDelegateLaneStorage(projectPath, normalizedLaneId);
  const normalized = normalizeDelegateStatus({
    ...status,
    projectPath,
    laneId: normalizedLaneId,
    updatedAt: new Date().toISOString(),
  });
  await writeDelegateJsonStorage(projectPath, normalizedLaneId, delegatePaths(projectPath, normalizedLaneId).statusFile, {
    version: 1,
    ...normalized,
  });
  return normalized;
}

async function readDelegateStatus(projectPath, { reconcile = false, laneId = defaultDelegateLaneId } = {}) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  const payload = (await readOptionalJson(delegatePaths(projectPath, normalizedLaneId).statusFile)) || {};
  let status = normalizeDelegateStatus({
    ...payload,
    projectPath,
    laneId: normalizedLaneId,
  });
  const jobKey = delegateJobKey(projectPath, normalizedLaneId);

  if (status.state === "planning" && delegatePlanJobs.has(jobKey)) {
    const job = delegatePlanJobs.get(jobKey);
    status = normalizeDelegateStatus({
      ...status,
      state: "planning",
      runId: job.runId,
      startedAt: job.startedAt,
    });
  }

  if (["starting", "dispatching", "running"].includes(status.state) && delegateRunJobs.has(jobKey)) {
    const job = delegateRunJobs.get(jobKey);
    status = normalizeDelegateStatus({
      ...status,
      state: status.state,
      runId: job.runId,
      startedAt: job.startedAt,
      delegateSessionId: job.delegateSessionId || status.delegateSessionId,
      delegateSessionLabel: job.delegateSessionLabel || status.delegateSessionLabel,
      pauseRequested: job.pauseRequested || status.pauseRequested,
    });
  }

  if (reconcile) {
    if (status.state === "planning" && !delegatePlanJobs.has(jobKey)) {
      status = await writeDelegateStatus(projectPath, {
        ...status,
        state: "failed",
        completedAt: new Date().toISOString(),
        error: status.error || "Delegate planning was interrupted. Please try again.",
      }, normalizedLaneId);
    } else if (
      ["starting", "dispatching", "running"].includes(status.state) &&
      !delegateRunJobs.has(jobKey) &&
      !delegateSupervisorIsLive(status)
    ) {
      status = await writeDelegateStatus(projectPath, {
        ...status,
        state: "failed",
        completedAt: new Date().toISOString(),
        pauseRequested: false,
        error: status.error || "Delegate run was interrupted. Please try again.",
      }, normalizedLaneId);
    }
  }

  return status;
}

function delegateContinuitySupervisorIsLive(supervisor = {}) {
  return processIsLive(supervisor.pid);
}

function delegateSupervisorStateForPayload(supervisor = {}) {
  const normalized = normalizeDelegateSupervisorState(supervisor);
  return {
    ...normalized,
    live: delegateContinuitySupervisorIsLive(normalized),
  };
}

async function readDelegateSupervisorState(projectPath, laneId = defaultDelegateLaneId) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  const payload = (await readOptionalJson(delegatePaths(projectPath, normalizedLaneId).supervisorFile)) || {};
  return normalizeDelegateSupervisorState({
    ...payload,
    projectPath,
    laneId: normalizedLaneId,
  });
}

async function writeDelegateSupervisorState(projectPath, supervisor, laneId = supervisor?.laneId || defaultDelegateLaneId) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  await ensureDelegateLaneStorage(projectPath, normalizedLaneId);
  const existing = (await readOptionalJson(delegatePaths(projectPath, normalizedLaneId).supervisorFile)) || {};
  const normalized = normalizeDelegateSupervisorState({
    ...existing,
    ...supervisor,
    projectPath,
    laneId: normalizedLaneId,
    updatedAt: new Date().toISOString(),
  });
  await writeDelegateJsonStorage(projectPath, normalizedLaneId, delegatePaths(projectPath, normalizedLaneId).supervisorFile, {
    version: 1,
    ...normalized,
  });
  return normalized;
}

async function appendDelegateSupervisorEvent(projectPath, laneId, type, payload = {}) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  const event = normalizeDelegateSupervisorEvent({
    id: pickString(payload.id) || crypto.randomUUID(),
    at: pickString(payload.at, payload.createdAt) || new Date().toISOString(),
    type: pickString(type, payload.type, "supervisor_event"),
    laneId: normalizedLaneId,
    action: pickString(payload.action) || null,
    state: pickString(payload.state) || null,
    reason: trimTrailingNewlines(String(payload.reason || "")) || null,
    nextAction: trimTrailingNewlines(String(payload.nextAction || "")) || null,
    runId: pickString(payload.runId) || null,
    restartCount: Number.parseInt(String(payload.restartCount || "0"), 10) || 0,
    payload:
      payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
        ? payload.payload
        : {},
  });
  await appendDelegateStorageLine(
    projectPath,
    normalizedLaneId,
    delegatePaths(projectPath, normalizedLaneId).supervisorEventsFile,
    `${JSON.stringify(event)}\n`,
  );
  return event;
}

function normalizeDelegateSupervisorEvent(payload = {}) {
  const payloadObject =
    payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
      ? payload.payload
      : {};
  return {
    id: pickString(payload.id) || crypto.randomUUID(),
    at: pickString(payload.at, payload.createdAt) || new Date().toISOString(),
    type: pickString(payload.type, "supervisor_event"),
    laneId: normalizeDelegateLaneId(payload.laneId || payload.lane_id || defaultDelegateLaneId),
    action: pickString(payload.action) || null,
    state: pickString(payload.state) || null,
    reason: trimTrailingNewlines(String(payload.reason || "")) || null,
    nextAction: trimTrailingNewlines(String(payload.nextAction || payload.next_action || "")) || null,
    runId: pickString(payload.runId, payload.run_id) || null,
    restartCount: Number.parseInt(String(payload.restartCount || payload.restart_count || "0"), 10) || 0,
    payload: payloadObject,
  };
}

async function readDelegateSupervisorEvents(projectPath, {
  laneId = defaultDelegateLaneId,
  cursor = "tail",
  limit = 50,
} = {}) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  const raw = await readOptionalText(delegatePaths(projectPath, normalizedLaneId).supervisorEventsFile);
  const lines = raw.split(/\r?\n/u).filter((line) => line.trim());
  const pageLimit = Math.min(200, Math.max(1, Number.parseInt(String(limit || "50"), 10) || 50));
  const cursorText = String(cursor || "tail").trim().toLowerCase();
  const start = cursorText === "tail"
    ? Math.max(0, lines.length - pageLimit)
    : Math.max(0, Number.parseInt(cursorText, 10) || 0);
  const pageLines = lines.slice(start, start + pageLimit);
  const events = [];

  for (const line of pageLines) {
    try {
      events.push(normalizeDelegateSupervisorEvent(JSON.parse(line)));
    } catch (_error) {
      // Ignore malformed legacy/debug supervisor event lines.
    }
  }

  const end = Math.min(lines.length, start + pageLines.length);
  return {
    events,
    nextCursor: String(end),
    total: lines.length,
  };
}

function delegateStatusForProjectCatalog(status = {}) {
  const normalized = normalizeDelegateStatus(status);
  if (normalized.state === "idle") {
    return null;
  }

  return {
    laneId: normalized.laneId,
    state: normalized.state,
    live: delegateCatalogStatusIsLive(normalized),
    runId: normalized.runId || null,
    activeStep: normalized.activeStep || null,
    stepCount: normalized.stepCount || 0,
    maxSteps: normalized.maxSteps || null,
    startedAt: normalized.startedAt || null,
    updatedAt: normalized.updatedAt || null,
    completedAt: normalized.completedAt || null,
    pauseRequested: Boolean(normalized.pauseRequested),
    lastOutcomeSummary: normalized.lastOutcomeSummary || null,
    nextAction: normalized.nextAction || null,
    stopReason: normalized.stopReason || null,
    computeBudget: normalized.computeBudget || null,
  };
}

async function readDelegateCatalogStatus(projectPath, laneId = defaultDelegateLaneId) {
  try {
    return delegateStatusForProjectCatalog(
      await readDelegateStatus(projectPath, { reconcile: false, laneId }),
    );
  } catch (error) {
    console.warn(`[clawdad-server] ignoring delegate status for ${projectPath} lane ${laneId}: ${error.message}`);
    return null;
  }
}

async function laneIdsForProject(projectPath) {
  const ids = new Set([defaultDelegateLaneId]);
  const lanesDir = path.join(delegateLaneRoot(projectPath), "lanes");
  try {
    const entries = await readdir(lanesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        ids.add(normalizeDelegateLaneId(entry.name));
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  return [...ids];
}

async function readDelegateLaneSummary(projectPath, laneId = defaultDelegateLaneId) {
  const config = await readDelegateConfig(projectPath, laneId);
  const status = await readDelegateCatalogStatus(projectPath, laneId);
  const runSummarySnapshots = await readDelegateRunSummarySnapshots(projectPath, laneId).catch(() => []);
  return {
    laneId: config.laneId,
    displayName: config.displayName,
    objective: config.objective,
    scopeGlobs: config.scopeGlobs,
    delegateSessionId: config.delegateSessionId,
    enabled: config.enabled,
    hardStops: config.hardStops,
    computeReservePercent: config.computeReservePercent,
    watchtowerReviewMode: config.watchtowerReviewMode,
    directionCheckMode: config.directionCheckMode,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    status,
    latestOutcome: status?.lastOutcomeSummary || runSummarySnapshots[0]?.summary || "",
    nextAction: status?.nextAction || "",
    hygieneState: status?.stopReason === "review_recommended" ? "review" : "ok",
    computeState: status?.computeBudget || null,
  };
}

async function readDelegateLanes(projectPath) {
  const ids = await laneIdsForProject(projectPath);
  const lanes = [];
  for (const laneId of ids) {
    try {
      lanes.push(await readDelegateLaneSummary(projectPath, laneId));
    } catch (error) {
      lanes.push({
        laneId,
        displayName: delegateLaneIsDefault(laneId) ? "Default delegate" : laneId,
        objective: null,
        scopeGlobs: [],
        enabled: false,
        status: null,
        error: error.message,
      });
    }
  }
  return lanes.sort((left, right) => {
    if (delegateLaneIsDefault(left.laneId)) {
      return -1;
    }
    if (delegateLaneIsDefault(right.laneId)) {
      return 1;
    }
    return String(left.displayName || left.laneId).localeCompare(String(right.displayName || right.laneId));
  });
}

async function writeDelegateLaneConfig(projectPath, laneId, patch = {}) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  return writeDelegateConfig(projectPath, {
    ...patch,
    laneId: normalizedLaneId,
  }, normalizedLaneId);
}

async function activeDelegateLaneSummaries(projectPath, { excludeLaneId = "" } = {}) {
  const excluded = normalizeDelegateLaneId(excludeLaneId);
  const lanes = await readDelegateLanes(projectPath).catch(() => []);
  return lanes.filter((lane) => {
    if (excluded && normalizeDelegateLaneId(lane?.laneId) === excluded) {
      return false;
    }
    const status = lane?.status || {};
    return ["planning", "starting", "dispatching", "running"].includes(String(status.state || "").trim().toLowerCase()) && Boolean(status.live);
  });
}

async function classifyDelegateLaneStart(projectPath, config) {
  const laneId = normalizeDelegateLaneId(config?.laneId || defaultDelegateLaneId);
  const activeLanes = await activeDelegateLaneSummaries(projectPath, { excludeLaneId: laneId });
  return classifyDelegateLaneOverlap({
    lane: {
      laneId,
      scopeGlobs: config?.scopeGlobs || [],
    },
    activeLanes,
    changedFiles: [],
  });
}

async function projectCatalogWithDelegateStatuses(projects = []) {
  const enrichedProjects = await Promise.all(
    projects.map(async (project) => {
      const delegateLanes = project?.path ? await readDelegateLanes(project.path).catch(() => []) : [];
      return {
        ...project,
        delegateStatus: project?.path ? await readDelegateCatalogStatus(project.path) : null,
        delegateLanes,
      };
    }),
  );
  return enrichedProjects.sort(compareProjects);
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
  const laneId = normalizeDelegateLaneId(config?.laneId || status?.laneId || defaultDelegateLaneId);
  const nextConfig = await writeDelegateConfig(projectPath, {
    ...config,
    enabled: false,
  }, laneId);
  const codexGoal = await syncDelegateCodexGoalStatus(projectPath, status, "budgetLimited", {
    error: message,
  });
  const nextStatus = await writeDelegateStatus(projectPath, {
    ...status,
    laneId,
    state: "blocked",
    activeRequestId: null,
    activeStep: null,
    lastRequestId: status.lastRequestId || status.activeRequestId || null,
    pauseRequested: false,
    completedAt: new Date().toISOString(),
    stopReason: "compute_limit",
    computeBudget,
    codexGoal,
    error: message,
  }, laneId);
  await appendDelegateRunEvent(projectPath, nextStatus.runId, "run_blocked", {
    title: "Paused near compute reserve",
    text: delegateComputeBudgetLogText(computeBudget) || message,
    state: nextStatus.state,
    stopReason: "compute_limit",
    computeBudget,
  }, laneId).catch(() => {});
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
    defaultSlug: delegateSessionSlugForLane(projectDetails, config),
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

function delegateSessionSlugForLane(projectDetails, config = {}) {
  const laneId = normalizeDelegateLaneId(config?.laneId || defaultDelegateLaneId);
  if (delegateLaneIsDefault(laneId)) {
    return delegateSessionSlugForProject(projectDetails);
  }
  const projectLabel = pickString(
    projectDetails?.displayName,
    projectDetails?.slug,
    projectDetails?.path ? basenameOrFallback(projectDetails.path) : "",
    "Project",
  );
  const laneLabel = pickString(config?.displayName, laneId);
  return `${projectLabel} ${laneLabel} Delegate`;
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

  const projectDelegateSlug = delegateSessionSlugForLane(projectDetails, config);
  const laneId = normalizeDelegateLaneId(config?.laneId || defaultDelegateLaneId);
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
          }, laneId);

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
      }, laneId);
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
  }, laneId);

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
- Treat this saved plan as Clawdad's current cone of vision: update the North Star, roadmap edge, blockers, and definition of done when new evidence supersedes older text.
- Remove or explicitly demote stale goals; do not leave contradictory roadmap directions in place.
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

async function generateDelegateRunSummarySnapshot(project, runId, laneId = defaultDelegateLaneId) {
  const page = await readDelegateRunEvents(project.path, {
    runId,
    cursor: 0,
    limit: 5000,
    laneId,
  });
  const events = Array.isArray(page.events) ? page.events : [];
  if (events.length === 0) {
    throw new Error("No delegate run events have been captured yet.");
  }

  const existingSnapshots = await readDelegateRunSummarySnapshots(project.path, laneId);
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
  const snapshots = await writeDelegateRunSummarySnapshots(project.path, [snapshot, ...existingSnapshots], laneId);
  return {
    snapshot,
    snapshots,
    events,
  };
}

async function generateDelegatePlanSnapshot(project, config, delegateSession = null, context = {}) {
  const laneId = normalizeDelegateLaneId(context?.laneId || config?.laneId || defaultDelegateLaneId);
  const [brief, latestSummarySnapshots, existingPlans, sourceEntries] = await Promise.all([
    readDelegateBrief(project.path, project, laneId),
    readProjectSummarySnapshots(project.path),
    readDelegatePlanSnapshots(project.path, laneId),
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
        laneId,
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

  const snapshots = await writeDelegatePlanSnapshots(project.path, [snapshot, ...existingPlans], laneId);
  return {
    snapshot,
    snapshots,
    brief,
    latestSummary,
    sourceEntries,
  };
}

async function refreshDelegatePlanForStepLearning({
  projectPath,
  laneId = defaultDelegateLaneId,
  project,
  config,
  delegateSession,
  latestPlan,
  statusBefore,
  statusAfter,
  decision,
  step,
  phaseHandoffAnalysis,
  logRunEvent,
}) {
  const refresh = delegatePostStepPlanRefreshDecision({
    latestPlan,
    statusBefore,
    statusAfter,
    decision,
  });
  if (!refresh.refresh) {
    return {
      latestPlan,
      status: statusAfter,
      refreshed: false,
      reason: refresh.reason,
    };
  }

  await logRunEvent("plan_accountability_started", {
    title: "Cone writeback started",
    step,
    text: `Refreshing the saved north-star plan because ${refresh.reason.replace(/_/gu, " ")}.`,
    payload: refresh,
  });

  try {
    const planResult = await generateDelegatePlanSnapshot(project, config, delegateSession, {
      laneId,
      status: statusAfter,
      phaseHandoffAnalysis,
      refreshReason: refresh.reason,
    });
    const nextStatus = await writeDelegateStatus(projectPath, {
      ...statusAfter,
      planSnapshotId: planResult.snapshot.id,
      error: "",
    }, laneId);
    await logRunEvent("plan_accountability_completed", {
      title: "Cone writeback updated",
      step,
      summary: planResult.snapshot.plan,
      payload: {
        reason: refresh.reason,
        planSnapshotId: planResult.snapshot.id,
        createdAt: planResult.snapshot.createdAt,
      },
    });
    return {
      latestPlan: planResult.snapshot,
      status: nextStatus,
      refreshed: true,
      reason: refresh.reason,
    };
  } catch (error) {
    await logRunEvent("plan_accountability_failed", {
      title: "Cone writeback failed",
      step,
      text: "Clawdad could not refresh the saved north-star plan after this step. The next prompt will still include the captured run events.",
      error: error.message,
      payload: refresh,
    });
    return {
      latestPlan,
      status: statusAfter,
      refreshed: false,
      reason: refresh.reason,
      error,
    };
  }
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

Before continuing this same pattern, run an assembly/convergence check against the project's own task model. Look for explicit phase endpoints, cutoff/finality fields, recombination or aggregate handoffs, parametric/general lemma opportunities, "next unresolved range" language, and any project-owned ORP/convergence-breakdown command.
Assemble what the repeated pieces jointly prove, name the finite measure that decreased, and record the remaining boundary. If no finite measure can be named, prefer a compression lemma, recombination packet, or theorem/work object over another sibling step.
If this is a finite ladder, finish the named endpoint only when it is clearly the current cheapest final subatom, then set next_action to the recombination, aggregate proof, general lemma, downstream margin phase, or explicit convergence-assembly writeback.
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
  worktreeHygiene = null,
) {
  const summaryBlock = latestSummary?.summary
    ? `Latest saved project summary (${latestSummary.createdAt || "unknown time"}):\n${latestSummary.summary}`
    : "Latest saved project summary: none";
  const planBlock = latestPlan?.plan
    ? `Latest saved delegate plan (${latestPlan.createdAt || "unknown time"}):\n${latestPlan.plan}`
    : "Latest saved delegate plan: none";
  const historyBlock = delegateRecentHistoryBlock(sourceEntries);
  const statusBlock = `Current delegate status:
- Last outcome: ${pickString(status?.lastOutcomeSummary) || "none"}
- Supervisor next action: ${pickString(status?.nextAction) || "none"}
- Stop reason: ${pickString(status?.stopReason) || "none"}
- Active request: ${pickString(status?.activeRequestId) || "none"}`;
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
  const hygieneBlock = delegateWorktreeHygienePromptBlock(worktreeHygiene);

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

${statusBlock}

Recent project history across tracked sessions (oldest first):
${historyBlock}

${hygieneBlock}

${handoffBlock ? `${handoffBlock}\n\n` : ""}
Instructions:
- Take the single best next concrete step toward the plan.
- If the brief conflicts with the latest saved plan or recent project history, treat the latest plan/history as the active cone of vision and keep the brief as durable north-star/hard-stop context.
- You may edit files, run local tooling, and use free resources already available.
- If generic worktree hygiene is dirty_suspicious or dirty_unclassified, make this step a hygiene/checkpoint step before broadening the feature/research work.
- If the worktree is dirty_classified, keep new edits tied to the current objective, refresh/checkpoint artifacts where appropriate, and do not leave new unclassified files behind.
- Do not spend money.
- Do not require another human.
- Before returning "blocked", spend the turn trying to unblock yourself with local read-only inspection, decomposition, and a ranked option set. Return "blocked" only for a real hard stop, not because the next move is strategically unclear.
- When the next move is unclear, rank 2-4 candidate probes by expected information gain, cost, reversibility, and probability of changing the decision. Pick the highest-value legal action as next_action.
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
- Clawdad also uses "checkpoint" to decide whether the saved north-star plan must be refreshed before the next step. Put the most informative new learning there.
- "progress_signal" should say whether this step meaningfully moved the project: high, medium, low, or none.
- "breakthroughs" should name the best discovery/evidence/change, or "none".
- "blockers" should name any actual blocker or risk, or "none".
- "next_probe" should name the next most informative probe or action.
- "confidence" should be low, medium, or high.`;
}

function buildDelegateStrategyBreakoutPrompt(
  project,
  delegateSession,
  brief,
  latestPlan,
  latestSummary,
  sourceEntries,
  status,
  phaseHandoffAnalysis = null,
  worktreeHygiene = null,
) {
  const summaryBlock = latestSummary?.summary
    ? `Latest saved project summary (${latestSummary.createdAt || "unknown time"}):\n${latestSummary.summary}`
    : "Latest saved project summary: none";
  const planBlock = latestPlan?.plan
    ? `Latest saved delegate plan (${latestPlan.createdAt || "unknown time"}):\n${latestPlan.plan}`
    : "Latest saved delegate plan: none";
  const historyBlock = delegateRecentHistoryBlock(sourceEntries);
  const handoffBlock = buildDelegatePhaseHandoffBlock(phaseHandoffAnalysis);
  const hygieneBlock = delegateWorktreeHygienePromptBlock(worktreeHygiene);

  return `You are the standing Codex delegate for this project, but this is a strategy breakout turn.

Project: ${project.displayName || project.slug || basenameOrFallback(project.path)}
Directory: ${project.path}
Delegate session: ${sessionDisplayForStatus(delegateSession)}

Delegate brief:
${brief}

${summaryBlock}

${planBlock}

Recent project history across tracked sessions (oldest first):
${historyBlock}

${hygieneBlock}

${handoffBlock ? `${handoffBlock}\n\n` : ""}
Purpose:
- Clawdad detected a tough spot, repeated loop, unclear route, or likely premature blocker.
- Do not continue blindly and do not make code edits in this turn.
- Use local read-only inspection/tool calls if useful.
- Break the situation down, rank 2-4 legal next probes by expected information gain, cost, reversibility, and probability of changing the decision.
- Choose the single highest-value legal next action. Prefer a bounded diagnostic, comparison, decomposition, source audit, smoke test, or packet that could change the route.
- If hygiene is suspicious/unclassified or Watchtower review is likely, select hygiene/checkpoint/review as the next probe before more expansion.
- If the best next move is truly paid, needs another human, credentials, MFA, account approval, or compute that is exhausted, say blocked and name the exact hard stop.
- Otherwise return continue and put the chosen action in next_action so the next delegate turn can act on it.

At the very end, include exactly one fenced JSON block with this schema:
\`\`\`json
{"state":"continue|blocked|completed","stop_reason":"none|paid|needs_human|compute_limit","next_action":"short string","summary":"short string","checkpoint":{"progress_signal":"low|medium|high|none","breakthroughs":"short string or none","blockers":"short string or none","next_probe":"short string","confidence":"low|medium|high"}}
\`\`\`

Rules:
- Use "continue" when a self-contained local/protocol-governed probe can move the project forward.
- Use "blocked" only for a real hard stop, not for uncertainty.
- In summary, include the ranked-options conclusion in a concise form.
- In checkpoint.breakthroughs, name the strategic insight or "none".
- In checkpoint.blockers, name the exact blocker or "none".
- In checkpoint.next_probe, repeat the selected highest-value probe.
- Do not add any introduction or closing beyond the useful response and required JSON.`;
}

function buildDelegateBlockRecoveryPrompt(
  project,
  delegateSession,
  brief,
  latestPlan,
  latestSummary,
  sourceEntries,
  status,
  blockedDecision,
  blockedResponseText,
  worktreeHygiene = null,
) {
  const summaryBlock = latestSummary?.summary
    ? `Latest saved project summary (${latestSummary.createdAt || "unknown time"}):\n${latestSummary.summary}`
    : "Latest saved project summary: none";
  const planBlock = latestPlan?.plan
    ? `Latest saved delegate plan (${latestPlan.createdAt || "unknown time"}):\n${latestPlan.plan}`
    : "Latest saved delegate plan: none";
  const historyBlock = delegateRecentHistoryBlock(sourceEntries);
  const hygieneBlock = delegateWorktreeHygienePromptBlock(worktreeHygiene);

  return `You are the standing Codex delegate for this project, but this is a block-recovery turn.

Project: ${project.displayName || project.slug || basenameOrFallback(project.path)}
Directory: ${project.path}
Delegate session: ${sessionDisplayForStatus(delegateSession)}

Delegate brief:
${brief}

${summaryBlock}

${planBlock}

Recent project history across tracked sessions (oldest first):
${historyBlock}

${hygieneBlock}

The previous delegate response was about to stop the run:
State: ${blockedDecision.state}
Stop reason: ${blockedDecision.stopReason}
Summary: ${blockedDecision.summary || "none"}
Next action: ${blockedDecision.nextAction || "none"}
Checkpoint blocker: ${blockedDecision.checkpoint?.blockers || "none"}

Previous response text:
${truncateSummarySourceText(blockedResponseText, 1800) || "none"}

Purpose:
- Before Clawdad stops, challenge the block constructively.
- Do not make code edits in this turn.
- Use local read-only inspection/tool calls if useful.
- Decide whether this is a true hard stop or a solvable tough spot.
- Rank 2-4 legal options by expected information gain, cost, reversibility, and probability of changing the decision.
- If a self-contained local/protocol-governed action can move forward, return "continue" and put that action in next_action.
- Return "blocked" only when the next move truly requires paid spend, another human, credentials, MFA, account approval, or exhausted compute.

At the very end, include exactly one fenced JSON block with this schema:
\`\`\`json
{"state":"continue|blocked|completed","stop_reason":"none|paid|needs_human|compute_limit","next_action":"short string","summary":"short string","checkpoint":{"progress_signal":"low|medium|high|none","breakthroughs":"short string or none","blockers":"short string or none","next_probe":"short string","confidence":"low|medium|high"}}
\`\`\`

Rules:
- "continue" means Clawdad should keep the delegation loop alive and act on next_action next.
- "blocked" means you found no legal self-contained recovery path.
- In summary, state the ranked-options conclusion briefly.
- In checkpoint.next_probe, repeat the chosen recovery probe or the exact hard stop.
- Do not add any introduction or closing beyond the useful response and required JSON.`;
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

async function recoverDelegateDecisionFromCodexEvents(projectPath, { runId = "", laneId = defaultDelegateLaneId } = {}) {
  const safeRunId = safeDelegateRunId(runId);
  if (!projectPath || !safeRunId) {
    return null;
  }

  const eventsFile = delegateCodexEventsFile(projectPath, safeRunId, laneId);
  const raw = await readOptionalText(eventsFile);
  if (!raw.trim()) {
    return null;
  }

  const parsedEvents = [];
  const completedTurnIds = new Set();
  for (const line of raw.split(/\r?\n/u).filter((entry) => entry.trim())) {
    try {
      const event = JSON.parse(line);
      parsedEvents.push(event);
      const type = pickString(event?.type);
      const status = pickString(event?.status, event?.payload?.status).toLowerCase();
      if (type === "codex_turn_completed" && status === "completed") {
        const turnId = pickString(event?.turnId, event?.turn_id);
        if (turnId) {
          completedTurnIds.add(turnId);
        }
      }
    } catch (_error) {
      // Ignore malformed partial app-server event lines.
    }
  }

  if (completedTurnIds.size === 0) {
    return null;
  }

  for (let index = parsedEvents.length - 1; index >= 0; index -= 1) {
    const event = parsedEvents[index];
    const type = pickString(event?.type);
    if (type !== "codex_agent_message") {
      continue;
    }

    const turnId = pickString(event?.turnId, event?.turn_id);
    if (turnId && !completedTurnIds.has(turnId)) {
      continue;
    }

    const text = trimTrailingNewlines(String(event?.payload?.text || ""));
    if (!text) {
      continue;
    }

    try {
      return {
        text,
        decision: parseDelegateDecision(text),
        event,
        source: "codex_events",
      };
    } catch (_error) {
      // Keep walking backward; the latest completed Codex message may be commentary.
    }
  }

  return null;
}

async function recoverDelegateDecisionFromLiveEvents(projectPath, { runId = "", step = null, laneId = defaultDelegateLaneId } = {}) {
  const safeRunId = safeDelegateRunId(runId);
  if (!projectPath || !safeRunId) {
    return null;
  }

  const eventsFile = delegateRunEventsFile(projectPath, safeRunId, laneId);
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
    if (event.payload?.decision && typeof event.payload.decision === "object") {
      try {
        return {
          text,
          decision: normalizeDelegateDecision(event.payload.decision),
          event,
        };
      } catch (_error) {
        // Fall through to text parsing; older or malformed payloads should not mask recoverable text.
      }
    }

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

  return recoverDelegateDecisionFromCodexEvents(projectPath, { runId: safeRunId, laneId });
}

function compactGoalText(value, maxLength = 360) {
  const text = trimTrailingNewlines(String(value || "").replace(/\s+/gu, " ").trim());
  if (!text) {
    return "";
  }
  const limit = Math.max(80, Number.parseInt(String(maxLength || "360"), 10) || 360);
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
}

function summarizeDelegateBriefForGoal(brief = "") {
  const lines = String(brief || "")
    .split(/\r?\n/u)
    .map((line) => line.replace(/^#{1,6}\s*/u, "").replace(/^[-*]\s*/u, "").trim())
    .filter(Boolean)
    .filter((line) => !/^what does success look like\??$/iu.test(line))
    .filter((line) => !/^what should the delegate push forward right now\??$/iu.test(line))
    .slice(0, 4);
  return compactGoalText(lines.join(" "), 420);
}

function summarizeDelegateHardBoundariesForGoal(config = {}, brief = "") {
  const hardStops = Array.isArray(config?.hardStops)
    ? config.hardStops.map((entry) => String(entry || "").replace(/_/gu, " ").trim()).filter(Boolean)
    : [];
  const boundaryLines = String(brief || "")
    .split(/\r?\n/u)
    .map((line) => line.replace(/^#{1,6}\s*/u, "").replace(/^[-*]\s*/u, "").trim())
    .filter((line) => /\b(hard stops?|hard boundaries?|boundary|boundaries|credential|broker|live order|patient data|medical advice|paid|money|legal|regulatory|human approval)\b/iu.test(line))
    .slice(0, 3);
  return compactGoalText(uniqueStrings([...hardStops, ...boundaryLines]).join("; "), 420);
}

function delegateGoalCycleText(status = {}, config = {}) {
  const stepCount = Math.max(0, Number.parseInt(String(status?.stepCount || "0"), 10) || 0);
  const nextStep = stepCount + 1;
  const maxSteps = normalizeOptionalPositiveInteger(
    config?.maxStepsPerRun ?? status?.maxSteps ?? status?.maxStepsPerRun ?? null,
    { max: 200 },
  );
  return maxSteps ? `bounded delegate-run step ${nextStep} of ${maxSteps}` : `bounded delegate-run step ${nextStep}`;
}

function delegateGoalReserveText(config = {}) {
  const reserve = normalizePercent(config?.computeReservePercent, delegateDefaultComputeReservePercent);
  return reserve === 0
    ? "0% (continue until compute exhaustion or hard stop)"
    : `${delegatePercentText(reserve)}%`;
}

function buildDelegateCodexThreadGoal({
  project = null,
  config = null,
  status = null,
  latestPlan = null,
  brief = "",
  laneId = defaultDelegateLaneId,
} = {}) {
  const normalizedLaneId = normalizeDelegateLaneId(config?.laneId || laneId);
  const objective = trimTrailingNewlines(
    pickString(
      config?.objective,
      latestPlan?.nextAction,
      status?.nextAction,
      status?.lastOutcomeSummary,
    ),
  );
  const projectLabel = pickString(project?.slug, project?.displayName, path.basename(pickString(project?.path) || ""));
  const laneLabel =
    pickString(config?.displayName) ||
    (delegateLaneIsDefault(normalizedLaneId) ? "Default delegate" : normalizedLaneId);
  const briefSummary = summarizeDelegateBriefForGoal(brief);
  const hardBoundarySummary = summarizeDelegateHardBoundariesForGoal(config, brief);

  return trimTrailingNewlines(
    [
      "Clawdad delegate lane goal.",
      projectLabel ? `Project: ${projectLabel}` : "",
      `Lane: ${laneLabel}`,
      objective ? `Objective: ${objective}` : "",
      briefSummary ? `Current brief: ${briefSummary}` : "",
      latestPlan?.refreshReason ? `Plan refresh reason: ${latestPlan.refreshReason}` : "",
      `Cycle: ${delegateGoalCycleText(status, config)}`,
      `Compute reserve: ${delegateGoalReserveText(config)}`,
      status?.computeBudget?.remainingPercent !== undefined
        ? `Compute remaining: ${status.computeBudget.remainingPercent}%`
        : "",
      hardBoundarySummary ? `Hard boundaries: ${hardBoundarySummary}` : "",
      "Autonomy: continue local/free work until semantic completion, explicit pause, compute exhaustion/reserve, or hard stop.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function syncDelegateCodexGoalStatus(projectPath, status, nextGoalStatus, {
  objective = "",
  error = "",
  clear = false,
} = {}) {
  const currentGoal = normalizeDelegateCodexGoal(status?.codexGoal);
  if (!currentGoal || currentGoal.mode === "off") {
    return currentGoal;
  }

  const localGoal = delegateCodexGoalWithStatus(currentGoal, nextGoalStatus, {
    objective,
    error,
  });
  if (!currentGoal.supported || !status?.delegateSessionId) {
    return localGoal;
  }

  const args = [
    path.join(clawdadRoot, "lib", "codex-app-server-dispatch.mjs"),
    "--goal-only",
    "--project-path",
    projectPath,
    "--session-id",
    status.delegateSessionId,
    "--session-seeded",
    "--goal-mode",
    currentGoal.mode || "auto",
    "--thread-goal-status",
    normalizeCodexGoalStatus(nextGoalStatus, currentGoal.status || "active"),
    "--goal-sync-timeout-ms",
    String(codexGoalSyncTimeoutMs),
    "--request-timeout-ms",
    String(Math.max(250, codexGoalSyncTimeoutMs)),
    "--turn-timeout-ms",
    String(Math.max(250, codexGoalSyncTimeoutMs)),
  ];
  const nextObjective = trimTrailingNewlines(String(objective || currentGoal.objective || ""));
  if (nextObjective) {
    args.push("--thread-goal", nextObjective);
  }
  if (clear) {
    args.push("--clear-thread-goal");
  }

  try {
    const result = await execFileP(process.execPath, args, {
      cwd: projectPath,
      env: {
        ...process.env,
        CLAWDAD_CODEX_GOALS: currentGoal.mode || "auto",
      },
      timeout: Math.max(2000, codexGoalSyncTimeoutMs + 1500),
      maxBuffer: 1024 * 1024,
    });
    const payload = JSON.parse(String(result.stdout || "{}"));
    return normalizeDelegateCodexGoal({
      ...localGoal,
      supported: payload.thread_goal_supported,
      synced: payload.thread_goal_synced,
      skipped: payload.thread_goal_skipped,
      objective: payload.thread_goal_objective || nextObjective || localGoal?.objective,
      status: payload.thread_goal_status || localGoal?.status,
      threadId: payload.session_id || localGoal?.threadId,
      error: payload.thread_goal_error || "",
      ...(payload.thread_goal && typeof payload.thread_goal === "object" ? payload.thread_goal : {}),
      updatedAt: new Date().toISOString(),
    }) || localGoal;
  } catch (syncError) {
    const requestedStatus = normalizeCodexGoalStatus(nextGoalStatus, currentGoal.status || "active");
    const preserveSyncedTerminalMirror =
      !error &&
      currentGoal.synced === true &&
      ["complete", "paused", "budgetLimited"].includes(requestedStatus);
    return normalizeDelegateCodexGoal({
      ...localGoal,
      supported: currentGoal.supported,
      synced: currentGoal.synced,
      skipped: currentGoal.skipped,
      error: preserveSyncedTerminalMirror ? "" : error || syncError.message || "Codex goal sync failed",
      updatedAt: new Date().toISOString(),
    }) || localGoal;
  }
}

async function runDelegateMetaDecisionTurn({
  projectPath,
  laneId = defaultDelegateLaneId,
  delegateSession,
  prompt,
  threadGoal = "",
  status,
  step,
  logRunEvent,
  startType,
  startTitle,
  startText,
  completedType,
  completedTitle,
}) {
  let latestStatus = status;
  await logRunEvent(startType, {
    title: startTitle,
    step,
    text: startText,
    nextAction: latestStatus.nextAction,
  });
  latestStatus = await writeDelegateStatus(projectPath, {
    ...latestStatus,
    state: "dispatching",
    activeRequestId: null,
    activeStep: null,
    error: "",
  }, laneId);

  const dispatchResult = await runTrackedSessionDispatchWait(projectPath, delegateSession.sessionId, prompt, {
    permissionMode: "plan",
    liveRunId: latestStatus.runId,
    liveStep: step,
    laneId,
    threadGoal,
    onEvent: async (type, payload = {}) => {
      await logRunEvent(type, {
        ...payload,
        step,
      });
      if (payload.requestId && type === "dispatch_started") {
        latestStatus = await writeDelegateStatus(projectPath, {
          ...latestStatus,
          state: "running",
          activeRequestId: payload.requestId,
          activeStep: step,
          codexGoal: payload.codexGoal || latestStatus.codexGoal,
          error: "",
        }, laneId);
      }
    },
  });

  let responseText = dispatchResult.responseText;
  let decision = null;
  let recoveredResponse = null;
  if (!dispatchResult.ok) {
    recoveredResponse = await recoverDelegateDecisionFromLiveEvents(projectPath, {
      runId: latestStatus.runId,
      step,
      laneId,
    });
    if (!recoveredResponse) {
      throw new Error(
        dispatchResult.responseText ||
          dispatchResult.mailboxStatus?.error ||
          "delegate strategy turn failed",
      );
    }
    responseText = recoveredResponse.text;
    decision = recoveredResponse.decision;
    await logRunEvent("agent_response_recovered", {
      title: "Recovered strategy response",
      step,
      requestId: dispatchResult.requestId,
      text: "Recovered a valid delegate JSON decision from the live event stream after the strategy dispatch failed.",
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
        step,
        laneId,
      });
      if (!recoveredResponse) {
        throw error;
      }
      responseText = recoveredResponse.text;
      decision = recoveredResponse.decision;
      await logRunEvent("agent_response_recovered", {
        title: "Recovered strategy response",
        step,
        requestId: dispatchResult.requestId,
        text: "Recovered a valid delegate JSON decision from the live event stream after strategy response parsing failed.",
        payload: {
          sourceEventId: recoveredResponse.event?.id || null,
          sourceEventAt: recoveredResponse.event?.at || null,
          sourceEventType: recoveredResponse.event?.type || null,
        },
      });
    }
  }

  await logRunEvent("agent_response", {
    title: recoveredResponse ? "Strategy response recovered" : "Strategy response captured",
    step,
    requestId: dispatchResult.requestId,
    text: responseText,
    payload: {
      recoveredFromLiveEvents: Boolean(recoveredResponse),
      strategyTurn: true,
    },
  });
  await logRunEvent(completedType, {
    title: completedTitle,
    step,
    requestId: dispatchResult.requestId,
    state: decision.state,
    stopReason: decision.stopReason,
    summary: decision.summary,
    nextAction: decision.nextAction,
    checkpoint: decision.checkpoint,
  });

  return {
    status: latestStatus,
    dispatchResult,
    responseText,
    decision,
  };
}

async function stopDelegateRunFromDecision({ projectPath, laneId = config?.laneId || status?.laneId || defaultDelegateLaneId, config, status, decision, step, logRunEvent }) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  if (decision.state === "completed") {
    const nextConfig = await writeDelegateConfig(projectPath, {
      ...config,
      enabled: false,
    }, normalizedLaneId);
    const codexGoal = await syncDelegateCodexGoalStatus(projectPath, status, "complete");
    const completedStatus = await writeDelegateStatus(projectPath, {
      ...status,
      laneId: normalizedLaneId,
      state: "completed",
      completedAt: new Date().toISOString(),
      pauseRequested: false,
      stopReason: null,
      codexGoal,
      error: "",
    }, normalizedLaneId);
    await logRunEvent("run_completed", {
      title: "Delegate completed",
      step,
      summary: decision.summary || "The delegate marked the run complete.",
      text: `Bounded delegate-run is complete. For endless supervision, run ${delegateContinuousCommand(projectPath, normalizedLaneId)}.`,
      state: completedStatus.state,
    });
    return {
      done: true,
      config: nextConfig,
      status: completedStatus,
    };
  }

  if (decision.state === "blocked") {
    const nextConfig = await writeDelegateConfig(projectPath, {
      ...config,
      enabled: false,
    }, normalizedLaneId);
    const codexGoal = await syncDelegateCodexGoalStatus(projectPath, status, "paused", {
      objective: decision.nextAction || status?.nextAction || "",
      error: decision.summary || "",
    });
    const blockedStatus = await writeDelegateStatus(projectPath, {
      ...status,
      laneId: normalizedLaneId,
      state: "blocked",
      completedAt: new Date().toISOString(),
      pauseRequested: false,
      stopReason: decision.stopReason,
      codexGoal,
      error: "",
    }, normalizedLaneId);
    await logRunEvent("run_blocked", {
      title: "Delegate blocked",
      step,
      state: blockedStatus.state,
      stopReason: decision.stopReason,
      summary: decision.summary || "",
      nextAction: decision.nextAction || "",
    });
    return {
      done: true,
      config: nextConfig,
      status: blockedStatus,
    };
  }

  return {
    done: false,
    config,
    status,
  };
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

const orpDelegateBootstrapCommand = "orp init --research-system --project-startup --current-codex --json";

function compactOrpCommand(args) {
  return ["orp", ...args].join(" ");
}

function orpTextForDetection(step = {}) {
  const payload = step.payload || {};
  const payloadText = [
    orpPayloadReason(payload),
    ...orpPayloadIssues(payload),
    pickString(payload?.code, payload?.status),
  ].filter(Boolean).join("\n");
  const rawText = step.payload ? step.stderr || "" : `${step.stdout || ""}\n${step.stderr || ""}`;
  return `${rawText}\n${payloadText}`.toLowerCase();
}

function orpPayloadIssues(payload = {}) {
  const issues = Array.isArray(payload?.issues) ? payload.issues : [];
  return issues
    .map((issue) => {
      if (typeof issue === "string") {
        return issue.trim();
      }
      return [
        pickString(issue?.severity),
        pickString(issue?.code),
        pickString(issue?.message, issue?.reason, issue?.detail),
      ].filter(Boolean).join(": ");
    })
    .filter(Boolean);
}

function orpPayloadReason(payload = {}) {
  const issues = orpPayloadIssues(payload);
  if (issues.length > 0) {
    return issues.join("; ");
  }

  return pickString(
    payload?.reason,
    payload?.message,
    payload?.error,
    payload?.requiredAction,
    payload?.required_action,
    payload?.stopReason,
    payload?.stop_reason,
    payload?.nextAction,
    payload?.next_action,
    payload?.suggestedNextCommand,
    payload?.suggested_next_command,
  );
}

function orpStepReason(step = {}) {
  return pickString(
    orpPayloadReason(step.payload),
    step.stderr,
    step.stdout,
    step.exitCode != null ? `${step.command} exited ${step.exitCode}` : "",
  );
}

function orpStepMissingBootstrap(step = {}) {
  const text = orpTextForDetection(step);
  return (
    /\bmissing_(?:init|initialization|frontier|research|research_system|project|state|stack)\b/u.test(text) ||
    /\b(?:frontier|research[- ]system|project startup|project state|state|stack)\b.{0,80}\bmissing\b/u.test(text) ||
    /\bmissing\b.{0,80}\b(?:frontier|research[- ]system|project startup|project state|state|stack)\b/u.test(text) ||
    /\bnot initialized\b/u.test(text) ||
    /\binitialize orp\b/u.test(text) ||
    /orp init --research-system/u.test(text)
  );
}

function orpDelegateBlock(step, reason, { bootstrap = false } = {}) {
  return {
    ok: false,
    blocked: true,
    step: step.key,
    command: step.command,
    reason,
    bootstrapRequired: bootstrap,
    bootstrapCommand: bootstrap ? orpDelegateBootstrapCommand : "",
    steps: [step],
  };
}

function classifyOrpHygiene(step) {
  if (orpStepMissingBootstrap(step)) {
    return orpDelegateBlock(
      step,
      `ORP project initialization is missing. Run ${orpDelegateBootstrapCommand}`,
      { bootstrap: true },
    );
  }

  if (!step.resultOk) {
    return orpDelegateBlock(step, `${step.command}: ${orpStepReason(step)}`);
  }

  const payload = step.payload || {};
  const unclassifiedCount = Number(payload.unclassifiedCount ?? payload.unclassified_count ?? 0);
  const stopCondition = boolFromUnknown(payload.stopCondition ?? payload.stop_condition, false);
  const safeToExpand =
    payload.safeToExpand != null
      ? boolFromUnknown(payload.safeToExpand, true)
      : payload.safe_to_expand != null
        ? boolFromUnknown(payload.safe_to_expand, true)
        : true;

  if (unclassifiedCount > 0 || stopCondition || !safeToExpand) {
    const reason = orpPayloadReason(payload) ||
      `ORP hygiene is not safe to delegate (${unclassifiedCount} unclassified path(s)).`;
    return orpDelegateBlock(step, `${step.command}: ${reason}`);
  }

  return { ok: true };
}

function classifyOrpProjectRefresh(step) {
  if (orpStepMissingBootstrap(step)) {
    return orpDelegateBlock(
      step,
      `ORP project/research-system initialization is missing. Run ${orpDelegateBootstrapCommand}`,
      { bootstrap: true },
    );
  }

  if (!step.resultOk || step.payload?.ok === false) {
    return orpDelegateBlock(step, `${step.command}: ${orpStepReason(step)}`);
  }

  return { ok: true };
}

function orpPreflightReady(payload = {}) {
  if (payload?.ok === false) {
    return false;
  }
  if (payload?.continuation?.ok === false) {
    return false;
  }

  const explicitReady = payload?.preflight?.ready ?? payload?.ready;
  if (explicitReady != null) {
    return boolFromUnknown(explicitReady, false);
  }

  const explicitSafe =
    payload?.safeToDelegate ??
    payload?.safe_to_delegate ??
    payload?.continuation?.safeToDelegate ??
    payload?.continuation?.safe_to_delegate ??
    payload?.continuation?.safe;
  if (explicitSafe != null) {
    return boolFromUnknown(explicitSafe, false);
  }

  return orpPayloadIssues(payload).length === 0;
}

function classifyOrpFrontierPreflight(step) {
  if (orpStepMissingBootstrap(step)) {
    return orpDelegateBlock(
      step,
      `ORP frontier/research-system state is missing. Run ${orpDelegateBootstrapCommand}`,
      { bootstrap: true },
    );
  }

  if (!step.resultOk || !orpPreflightReady(step.payload || {})) {
    const reason = orpPayloadReason(step.payload) || "ORP did not report an active safe continuation.";
    return orpDelegateBlock(step, `${step.command}: ${reason}`);
  }

  return { ok: true };
}

async function runOrpDelegatePreflight(projectPath) {
  const definitions = [
    {
      key: "hygiene",
      args: ["hygiene", "--json"],
      classify: classifyOrpHygiene,
    },
    {
      key: "project_refresh",
      args: ["project", "refresh", "--json"],
      classify: classifyOrpProjectRefresh,
    },
    {
      key: "frontier_preflight",
      args: ["frontier", "preflight-delegate", "--json"],
      classify: classifyOrpFrontierPreflight,
    },
  ];
  const steps = [];

  for (const definition of definitions) {
    const result = await runOrp(definition.args, {
      cwd: projectPath,
      ignoreStdin: true,
      timeoutMs: 60_000,
    });
    const step = {
      key: definition.key,
      command: compactOrpCommand(definition.args),
      resultOk: result.ok,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      payload: parseOptionalJsonObject(result.stdout),
    };
    steps.push(step);

    if (result.ok && !step.payload) {
      return {
        ...orpDelegateBlock(step, `${step.command}: ORP returned invalid or empty JSON.`),
        steps,
      };
    }

    const decision = definition.classify(step);
    if (!decision.ok) {
      return {
        ...decision,
        steps,
      };
    }
  }

  return {
    ok: true,
    blocked: false,
    steps,
  };
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
  {
    permissionMode = "approve",
    model = "",
    onEvent = null,
    liveRunId = "",
    liveStep = null,
    laneId = defaultDelegateLaneId,
    threadGoal = "",
  } = {},
) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  const baselineStatus = await readMailboxStatus(projectPath, normalizedLaneId);
  const baselineRequestId = String(baselineStatus.request_id || "").trim();
  const args = ["dispatch", projectPath, message, "--session", sessionId, "--permission-mode", permissionMode];
  const normalizedGoalMode = normalizeCodexGoalMode(process.env.CLAWDAD_CODEX_GOALS || codexGoalMode);
  const plannedCodexGoal = threadGoal
    ? buildDelegateCodexGoalMirror({
        threadGoal,
        status: "active",
        threadId: sessionId,
        mode: normalizedGoalMode,
      })
    : null;

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
    CLAWDAD_MAILBOX_DIR: delegatePaths(projectPath, normalizedLaneId).mailboxDir,
    CLAWDAD_ARTIFACTS_DIR: delegatePaths(projectPath, normalizedLaneId).artifactsDir,
  };
  const safeLiveRunId = safeDelegateRunId(liveRunId);
  const liveStepValue = Number.parseInt(String(liveStep || "0"), 10);
  if (safeLiveRunId) {
    workerEnv.CLAWDAD_CODEX_LIVE_EVENT_FILE = delegateRunEventsFile(projectPath, safeLiveRunId, normalizedLaneId);
    workerEnv.CLAWDAD_CODEX_EVENT_LOG_FILE = delegateCodexEventsFile(projectPath, safeLiveRunId, normalizedLaneId);
    workerEnv.CLAWDAD_CODEX_LIVE_RUN_ID = safeLiveRunId;
    if (Number.isFinite(liveStepValue) && liveStepValue > 0) {
      workerEnv.CLAWDAD_CODEX_LIVE_STEP = String(liveStepValue);
    }
  }
  if (threadGoal) {
    workerEnv.CLAWDAD_CODEX_GOALS = normalizedGoalMode;
    if (normalizedGoalMode !== "off") {
      workerEnv.CLAWDAD_CODEX_THREAD_GOAL = threadGoal;
      workerEnv.CLAWDAD_CODEX_THREAD_GOAL_STATUS = "active";
      workerEnv.CLAWDAD_CODEX_GOAL_SYNC_TIMEOUT_MS = String(codexGoalSyncTimeoutMs);
    }
  }
  if (workerTimeoutMs) {
    workerEnv.CLAWDAD_CODEX_TURN_TIMEOUT_MS = String(workerTimeoutMs);
  }
  const hostAccess = await buildDelegateDispatchHostAccessReport(projectPath, normalizedLaneId);
  if (!hostAccess.ok) {
    if (typeof onEvent === "function") {
      await onEvent("dispatch_preflight_failed", {
        title: "Dispatch preflight failed",
        text: hostAccess.message,
        payload: hostAccess,
      });
    }
    throw new Error(hostAccess.message);
  }
  const runPaths = delegatePaths(projectPath, normalizedLaneId);
  const dispatchStartupLogFile = safeLiveRunId
    ? path.join(runPaths.runsDir, `${safeLiveRunId}.dispatch-start.log`)
    : path.join(runPaths.runsDir, `dispatch-start.${Date.now()}.${crypto.randomUUID()}.log`);
  const startResult = await startClawdadDetached(args, {
    env: workerEnv,
    outputFile: dispatchStartupLogFile,
  });
  if (!startResult.ok) {
    throw new Error(startResult.error?.message || "failed to start delegate dispatch");
  }
  if (typeof onEvent === "function") {
    await onEvent("dispatch_process_started", {
      title: "Dispatch worker started",
      text: startResult.pid ? `Worker pid ${startResult.pid}` : "",
      payload: {
        pid: startResult.pid || null,
        startupLogFile: startResult.outputFile || dispatchStartupLogFile,
        mailboxDir: runPaths.mailboxDir,
        clawdadHome,
        codexHome: defaultCodexHome,
        targetSessionId: sessionId,
      },
    });
  }

  const startedStatus = await waitForMailboxRequestStart(
    projectPath,
    baselineRequestId,
    delegateDispatchStartTimeoutMs,
    normalizedLaneId,
    { workerPid: startResult.pid || null },
  );
  let requestId = String(startedStatus.request_id || "").trim();
  if (!requestId) {
    const workerExitedBeforeRequest = Boolean(startedStatus.workerExitedBeforeRequest);
    if (typeof onEvent === "function" && !workerExitedBeforeRequest) {
      await onEvent("dispatch_start_reconcile", {
        title: "Reconciling dispatch start",
        text: "The worker started, but the mailbox request appeared late.",
      });
    }
    const reconciledStatus = await waitForMailboxRequestStart(
      projectPath,
      baselineRequestId,
      workerExitedBeforeRequest ? 0 : delegateDispatchStartReconcileMs,
      normalizedLaneId,
      { workerPid: startResult.pid || null },
    );
    requestId = String(reconciledStatus.request_id || "").trim();
    if (!requestId) {
      const totalWaitSeconds = Math.round(
        (delegateDispatchStartTimeoutMs + delegateDispatchStartReconcileMs) / 1000,
      );
      const outputTail = tailText(
        await readOptionalText(dispatchStartupLogFile).catch((error) => `Could not read startup log: ${error.message}`),
      );
      const workerLive = startResult.pid ? processIsLive(startResult.pid) : false;
      const failurePayload = {
        pid: startResult.pid || null,
        exitCode: null,
        stderrTail: outputTail,
        outputTail,
        mailboxDir: runPaths.mailboxDir,
        clawdadHome,
        codexHome: defaultCodexHome,
        targetSessionId: sessionId,
        stateFile: stateFilePath,
        startupLogFile: dispatchStartupLogFile,
        hostAccess,
      };
      if (typeof onEvent === "function") {
        await onEvent(workerLive ? "dispatch_start_timeout" : "dispatch_process_failed", {
          title: workerLive ? "Dispatch worker did not create mailbox request" : "Dispatch worker exited before mailbox request",
          text: outputTail || (
            workerLive
              ? `Delegate dispatch did not create a mailbox request within ${totalWaitSeconds}s.`
              : "Detached dispatch worker exited before writing the mailbox request."
          ),
          payload: failurePayload,
        });
      }
      const detail = outputTail ? ` Startup log: ${outputTail}` : "";
      const workerPhrase = workerLive
        ? "Detached worker is still live but has not created the mailbox request."
        : "Detached worker exited before creating the mailbox request.";
      const accessAdvice = /\b(operation not permitted|eacces|permission denied|mktemp|clawdad_home|codex)\b/iu.test(outputTail)
        ? ` ${delegateDispatchHostAccessMessage}`
        : "";
      throw new Error(
        `delegate dispatch did not start within ${totalWaitSeconds}s. ${workerPhrase}${accessAdvice}${detail}`,
      );
    }
  }
  if (typeof onEvent === "function") {
    await onEvent("dispatch_started", {
      title: "Delegate step dispatched",
      requestId,
      codexGoal: plannedCodexGoal,
    });
  }

  const mailboxStatus = await waitForMailboxCompletion(projectPath, delegateDispatchTimeoutMs, baselineRequestId, normalizedLaneId, {
    stallGuard: safeLiveRunId
      ? {
          runId: safeLiveRunId,
          step: Number.isFinite(liveStepValue) && liveStepValue > 0 ? liveStepValue : null,
          laneId: normalizedLaneId,
        }
      : null,
  });
  if (String(mailboxStatus.state || "").trim() === "timeout") {
    throw new Error("delegate dispatch timed out");
  }

  const responseMarkdown = await readMailboxResponse(projectPath, normalizedLaneId);
  const responseText = responseBodyFromMailbox(responseMarkdown);
  const completed = String(mailboxStatus.state || "").trim() === "completed";
  if (typeof onEvent === "function") {
    const codexGoal = safeLiveRunId
      ? await readDelegateCodexGoalFromRunEvents(projectPath, safeLiveRunId, normalizedLaneId)
      : null;
    await onEvent(completed ? "dispatch_completed" : "dispatch_failed", {
      title: completed ? "Delegate step returned" : "Delegate step failed",
      requestId,
      state: String(mailboxStatus.state || "").trim(),
      error: completed ? "" : pickString(mailboxStatus.error),
      codexGoal: codexGoal || plannedCodexGoal,
    });
  }
  const codexGoal = safeLiveRunId
    ? await readDelegateCodexGoalFromRunEvents(projectPath, safeLiveRunId, normalizedLaneId)
    : null;

  return {
    ok: completed,
    requestId,
    mailboxStatus,
    responseMarkdown,
    responseText,
    codexGoal: codexGoal || plannedCodexGoal,
  };
}

async function resumeTrackedSessionDispatchWait(
  projectPath,
  sessionId,
  status,
  { onEvent = null, laneId = status?.laneId || defaultDelegateLaneId } = {},
) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  const initialMailboxStatus = await readMailboxStatus(projectPath, normalizedLaneId);
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
      : await waitForMailboxCompletion(projectPath, delegateDispatchTimeoutMs, "", normalizedLaneId, {
          stallGuard: {
            runId: pickString(status?.runId),
            step: Number.parseInt(String(status?.activeStep || "0"), 10) || null,
            laneId: normalizedLaneId,
          },
        });
  if (String(mailboxStatus.state || "").trim() === "timeout") {
    throw new Error("delegate dispatch timed out after supervisor resume");
  }

  const responseMarkdown = await readMailboxResponse(projectPath, normalizedLaneId);
  const responseText = responseBodyFromMailbox(responseMarkdown);
  const completed = String(mailboxStatus.state || "").trim() === "completed";

  if (typeof onEvent === "function") {
    const codexGoal = status?.runId
      ? await readDelegateCodexGoalFromRunEvents(projectPath, status.runId, normalizedLaneId)
      : null;
    await onEvent(completed ? "dispatch_completed" : "dispatch_failed", {
      title: completed ? "Delegate step returned" : "Delegate step failed",
      requestId,
      state: String(mailboxStatus.state || "").trim(),
      error: completed ? "" : pickString(mailboxStatus.error),
      codexGoal: codexGoal || normalizeDelegateCodexGoal(status?.codexGoal),
    });
  }
  const codexGoal = status?.runId
    ? await readDelegateCodexGoalFromRunEvents(projectPath, status.runId, normalizedLaneId)
    : null;

  return {
    ok: completed,
    requestId,
    mailboxStatus,
    responseMarkdown,
    responseText,
    resumed: true,
    codexGoal: codexGoal || normalizeDelegateCodexGoal(status?.codexGoal),
  };
}

async function setDelegatePaused(projectPath, config, status, error = "") {
  const laneId = normalizeDelegateLaneId(config?.laneId || status?.laneId || defaultDelegateLaneId);
  const nextConfig = await writeDelegateConfig(projectPath, {
    ...config,
    enabled: false,
  }, laneId);
  const codexGoal = await syncDelegateCodexGoalStatus(projectPath, status, "paused", {
    error,
  });
  const nextStatus = await writeDelegateStatus(projectPath, {
    ...status,
    laneId,
    state: "paused",
    pauseRequested: false,
    completedAt: new Date().toISOString(),
    codexGoal,
    error,
  }, laneId);
  await appendDelegateRunEvent(projectPath, nextStatus.runId, "run_paused", {
    title: "Delegate paused",
    text: error || "The delegate will stop after the current safe point.",
    state: nextStatus.state,
    stopReason: nextStatus.stopReason,
  }, laneId).catch(() => {});
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
  { resume = false, laneId = initialConfig?.laneId || defaultDelegateLaneId } = {},
) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  let project = initialProject;
  let config = initialConfig;
  let delegateSession = initialSession;
  const logRunEvent = async (type, payload = {}) => {
    await appendDelegateRunEvent(projectPath, runId, type, payload, normalizedLaneId).catch(() => {});
  };
  const initialComputeGuard = await evaluateDelegateComputeGuard(config);
  let lastLoggedComputeUsedBucket = delegateComputeUsedBucket(initialComputeGuard.budget);
  const existingStatus = resume
    ? await readDelegateStatus(projectPath, { reconcile: false, laneId: normalizedLaneId })
    : null;
  let latestStatus = await writeDelegateStatus(
    projectPath,
    resume && existingStatus?.state === "running"
      ? {
          ...existingStatus,
          laneId: normalizedLaneId,
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
          laneId: normalizedLaneId,
          state: "running",
          runId,
          startedAt,
          delegateSessionId: delegateSession?.sessionId || config.delegateSessionId || null,
          delegateSessionLabel: delegateSession ? sessionDisplayForStatus(delegateSession) : null,
          planSnapshotId: null,
          activeRequestId: null,
          activeStep: null,
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
    normalizedLaneId,
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
  let lastStrategyBreakoutPattern = "";

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

    if (!(await readDelegatePlanSnapshots(projectPath, normalizedLaneId))[0]) {
      await logRunEvent("planning_started", {
        title: "Planning started",
        text: "No saved delegate plan was found, so Clawdad is creating one first.",
      });
      latestStatus = await writeDelegateStatus(projectPath, {
        ...latestStatus,
        state: "planning",
        error: "",
      }, normalizedLaneId);
      const planResult = await generateDelegatePlanSnapshot(project, config, delegateSession, {
        laneId: normalizedLaneId,
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
      }, normalizedLaneId);
    }

    for (let stepIndex = Math.max(0, Number.parseInt(String(latestStatus.stepCount || "0"), 10) || 0); ; stepIndex += 1) {
      config = await readDelegateConfig(projectPath, normalizedLaneId);
      if (!config.enabled) {
        return await setDelegatePaused(projectPath, config, latestStatus);
      }
      if (config.maxStepsPerRun && stepIndex >= config.maxStepsPerRun) {
        config = await writeDelegateConfig(projectPath, {
          ...config,
          enabled: false,
        }, normalizedLaneId);
        latestStatus = await writeDelegateStatus(projectPath, {
          ...latestStatus,
          state: "paused",
          completedAt: new Date().toISOString(),
          pauseRequested: false,
          stopReason: "step_limit",
          error: "",
        }, normalizedLaneId);
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
      }, normalizedLaneId);
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

      const [brief, initialPlanSnapshots, summarySnapshots, sourceEntries, worktreeHygiene] = await Promise.all([
        readDelegateBrief(projectPath, project, normalizedLaneId),
        readDelegatePlanSnapshots(projectPath, normalizedLaneId),
        readProjectSummarySnapshots(projectPath),
        loadProjectSummarySourceEntries(project),
        readDelegateWorktreeHygiene(projectPath).catch((error) => ({
          schema: "clawdad.worktree_hygiene/1",
          status: "unavailable",
          clean: null,
          dirtyCount: null,
          unclassifiedCount: null,
          suspiciousCount: null,
          safeToExpand: true,
          requiredAction: error.message,
        })),
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
          laneId: normalizedLaneId,
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
      }, normalizedLaneId);
      const statusBeforeStep = latestStatus;
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
      await logRunEvent("worktree_hygiene_checked", {
        title: "Worktree hygiene checked",
        step: stepIndex + 1,
        text: delegateWorktreeHygienePromptBlock(worktreeHygiene),
        payload: worktreeHygiene,
      });
      const strategyBreakout = delegateStrategyBreakoutDecision({
        phaseHandoffAnalysis,
        status: latestStatus,
        lastBreakoutPattern: lastStrategyBreakoutPattern,
      });
      if (strategyBreakout.breakout) {
        const strategyPrompt = buildDelegateStrategyBreakoutPrompt(
          project,
          delegateSession,
          brief,
          latestPlan,
          latestSummary,
          delegateSourceEntries,
          latestStatus,
          phaseHandoffAnalysis,
          worktreeHygiene,
        );
        const strategyResult = await runDelegateMetaDecisionTurn({
          projectPath,
          laneId: normalizedLaneId,
          delegateSession,
          prompt: strategyPrompt,
          threadGoal: buildDelegateCodexThreadGoal({
            project,
            config,
            status: latestStatus,
            latestPlan,
            brief,
            laneId: normalizedLaneId,
          }),
          status: latestStatus,
          step: stepIndex + 1,
          logRunEvent,
          startType: "strategy_breakout_started",
          startTitle: "Strategy breakout started",
          startText:
            "Clawdad detected a repeated or stuck pattern, so this turn asks the delegate to rank breakout probes before doing more implementation.",
          completedType: "strategy_breakout_completed",
          completedTitle: "Strategy breakout completed",
        });
        latestStatus = strategyResult.status;
        const syncedAfterStrategy = await syncDelegateSession(projectPath, config);
        project = syncedAfterStrategy.projectDetails;
        config = syncedAfterStrategy.config;
        delegateSession = syncedAfterStrategy.session || delegateSession;
        latestStatus = await writeDelegateStatus(projectPath, {
          ...latestStatus,
          state: "running",
          delegateSessionId: delegateSession?.sessionId || latestStatus.delegateSessionId,
          delegateSessionLabel: delegateSession
            ? sessionDisplayForStatus(delegateSession)
            : latestStatus.delegateSessionLabel,
          stepCount: stepIndex + 1,
          maxSteps: config.maxStepsPerRun,
          activeRequestId: null,
          activeStep: null,
          lastRequestId: strategyResult.dispatchResult.requestId || latestStatus.lastRequestId,
          lastOutcomeSummary: strategyResult.decision.summary || latestStatus.lastOutcomeSummary,
          nextAction: strategyResult.decision.nextAction || latestStatus.nextAction,
          stopReason: strategyResult.decision.stopReason === "none" ? null : strategyResult.decision.stopReason,
          codexGoal: strategyResult.dispatchResult.codexGoal || latestStatus.codexGoal,
          error: "",
        }, normalizedLaneId);
        const strategyComputeGuard = await evaluateDelegateComputeGuard(config);
        latestStatus = await writeDelegateStatus(projectPath, {
          ...latestStatus,
          computeBudget: strategyComputeGuard.budget,
        }, normalizedLaneId);
        if (!strategyComputeGuard.blocked) {
          const planWriteback = await refreshDelegatePlanForStepLearning({
            projectPath,
            laneId: normalizedLaneId,
            project,
            config,
            delegateSession,
            latestPlan,
            statusBefore: statusBeforeStep,
            statusAfter: latestStatus,
            decision: strategyResult.decision,
            step: stepIndex + 1,
            phaseHandoffAnalysis,
            logRunEvent,
          });
          latestPlan = planWriteback.latestPlan || latestPlan;
          latestStatus = planWriteback.status || latestStatus;
        }
        lastStrategyBreakoutPattern = strategyBreakout.pattern;

        if (strategyComputeGuard.blocked) {
          return await setDelegateComputeBlocked(
            projectPath,
            config,
            latestStatus,
            strategyComputeGuard.message,
            strategyComputeGuard.budget,
          );
        }

        const terminal = await stopDelegateRunFromDecision({
          projectPath,
          laneId: normalizedLaneId,
          config,
          status: latestStatus,
          decision: strategyResult.decision,
          step: stepIndex + 1,
          logRunEvent,
        });
        if (terminal.done) {
          return {
            config: terminal.config,
            status: terminal.status,
          };
        }

        continue;
      }
      await logRunEvent("step_started", {
        title: "Delegate step started",
        step: stepIndex + 1,
        text: latestStatus.nextAction || "Preparing the next safe project action.",
      });

      let dispatchResult = resume
        ? await resumeTrackedSessionDispatchWait(projectPath, delegateSession.sessionId, latestStatus, {
            laneId: normalizedLaneId,
            onEvent: async (type, payload = {}) => {
              await logRunEvent(type, {
                ...payload,
                step: stepIndex + 1,
              });
              if (payload.requestId && ["supervisor_rejoined_dispatch", "dispatch_started"].includes(type)) {
                latestStatus = await writeDelegateStatus(projectPath, {
                  ...latestStatus,
                  state: "running",
                  activeRequestId: payload.requestId,
                  activeStep: stepIndex + 1,
                  codexGoal: payload.codexGoal || latestStatus.codexGoal,
                  error: "",
                }, normalizedLaneId);
              }
            },
          })
        : null;

      if (!dispatchResult) {
        latestStatus = await writeDelegateStatus(projectPath, {
          ...latestStatus,
          state: "dispatching",
          activeRequestId: null,
          activeStep: null,
          error: "",
        }, normalizedLaneId);
        const prompt = buildDelegateStepPrompt(
          project,
          delegateSession,
          brief,
          latestPlan,
          latestSummary,
          delegateSourceEntries,
          latestStatus,
          phaseHandoffAnalysis,
          worktreeHygiene,
        );
        dispatchResult = await runTrackedSessionDispatchWait(projectPath, delegateSession.sessionId, prompt, {
          permissionMode: "approve",
          liveRunId: latestStatus.runId,
          liveStep: stepIndex + 1,
          laneId: normalizedLaneId,
          threadGoal: buildDelegateCodexThreadGoal({
            project,
            config,
            status: latestStatus,
            latestPlan,
            brief,
            laneId: normalizedLaneId,
          }),
          onEvent: async (type, payload = {}) => {
            await logRunEvent(type, {
              ...payload,
              step: stepIndex + 1,
            });
            if (payload.requestId && type === "dispatch_started") {
              latestStatus = await writeDelegateStatus(projectPath, {
                ...latestStatus,
                state: "running",
                activeRequestId: payload.requestId,
                activeStep: stepIndex + 1,
                codexGoal: payload.codexGoal || latestStatus.codexGoal,
                error: "",
              }, normalizedLaneId);
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
          laneId: normalizedLaneId,
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
              activeStep: null,
              lastRequestId: dispatchResult.requestId || latestStatus.lastRequestId,
              codexGoal: dispatchResult.codexGoal || latestStatus.codexGoal,
              error: dispatchErrorText,
            }, normalizedLaneId);
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
            laneId: normalizedLaneId,
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
        activeStep: null,
        lastRequestId: dispatchResult.requestId || latestStatus.lastRequestId,
        lastOutcomeSummary: decision.summary || latestStatus.lastOutcomeSummary,
        nextAction: decision.nextAction || latestStatus.nextAction,
        stopReason: decision.stopReason === "none" ? null : decision.stopReason,
        codexGoal: dispatchResult.codexGoal || latestStatus.codexGoal,
        error: "",
      }, normalizedLaneId);
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
      }, normalizedLaneId);
      if (!postStepComputeGuard.blocked) {
        const planWriteback = await refreshDelegatePlanForStepLearning({
          projectPath,
          laneId: normalizedLaneId,
          project,
          config,
          delegateSession,
          latestPlan,
          statusBefore: statusBeforeStep,
          statusAfter: latestStatus,
          decision,
          step: stepIndex + 1,
          phaseHandoffAnalysis,
          logRunEvent,
        });
        latestPlan = planWriteback.latestPlan || latestPlan;
        latestStatus = planWriteback.status || latestStatus;
      }

      const watchtowerReviewMode = normalizeDelegateWatchtowerReviewMode(config.watchtowerReviewMode);
      if (watchtowerReviewMode !== "off") {
        const reviewGuard = await evaluateDelegateReviewGuard(projectPath, {
          delegateDecision: decision,
          laneId: normalizedLaneId,
          step: stepIndex + 1,
        }).catch((error) => ({
          ok: false,
          hardStop: false,
          pauseRecommended: false,
          repairRecommended: false,
          correctiveRecommended: false,
          checkpointRecommended: false,
          summary: error.message,
        }));
        if (reviewGuard.ok) {
          await logRunEvent("watchtower_review_checked", {
            title: "Watchtower review checked",
            step: stepIndex + 1,
            text: reviewGuard.summary,
            payload: {
              mode: watchtowerReviewMode,
              pauseRecommended: reviewGuard.pauseRecommended,
              hardStop: reviewGuard.hardStop,
              repairRecommended: reviewGuard.repairRecommended,
              correctiveRecommended: reviewGuard.correctiveRecommended,
              checkpointRecommended: reviewGuard.checkpointRecommended,
              reason: reviewGuard.reason || null,
              reviewCard: reviewGuard.card || null,
            },
          });
        } else {
          await logRunEvent("watchtower_review_unavailable", {
            title: "Watchtower review unavailable",
            step: stepIndex + 1,
            text: reviewGuard.summary,
            payload: {
              mode: watchtowerReviewMode,
            },
          });
        }
        if (
          watchtowerReviewMode === "log" &&
          reviewGuard.ok &&
          (
            reviewGuard.hardStop ||
            reviewGuard.pauseRecommended ||
            reviewGuard.repairRecommended ||
            reviewGuard.correctiveRecommended
          )
        ) {
          await logRunEvent("watchtower_review_advisory", {
            title: "Watchtower review advisory",
            step: stepIndex + 1,
            summary: reviewGuard.summary || "",
            nextAction: reviewGuard.nextAction || "",
            payload: {
              reason: reviewGuard.reason || null,
              reviewCard: reviewGuard.card || null,
            },
          });
        }
        if (watchtowerReviewMode === "enforce") {
          if (reviewGuard.hardStop) {
            return await stopDelegateForReviewGuard({
              projectPath,
              laneId: normalizedLaneId,
              config,
              status: latestStatus,
              guard: reviewGuard,
              step: stepIndex + 1,
              logRunEvent,
            });
          }
          if (reviewGuard.correctiveRecommended || reviewGuard.repairRecommended || reviewGuard.pauseRecommended) {
            latestStatus = await queueDelegateReviewGuardCorrectiveStep({
              projectPath,
              laneId: normalizedLaneId,
              config,
              status: latestStatus,
              guard: reviewGuard,
              step: stepIndex + 1,
              logRunEvent,
            });
            continue;
          }
        }
        if (reviewGuard.checkpointRecommended) {
          await logRunEvent("watchtower_checkpoint_logged", {
            title: "Watchtower checkpoint logged",
            step: stepIndex + 1,
            summary: reviewGuard.summary || "",
            payload: {
              mode: watchtowerReviewMode,
              reason: reviewGuard.reason || null,
              reviewCard: reviewGuard.card || null,
            },
          });
        }
      }

      config = await readDelegateConfig(projectPath, normalizedLaneId);
      if (!config.enabled) {
        return await setDelegatePaused(projectPath, config, latestStatus);
      }

      if (decision.state === "blocked" && decision.stopReason !== "compute_limit") {
        const recoveryPrompt = buildDelegateBlockRecoveryPrompt(
          project,
          delegateSession,
          brief,
          latestPlan,
          latestSummary,
          delegateSourceEntries,
          latestStatus,
          decision,
          responseText,
          worktreeHygiene,
        );
        const recoveryResult = await runDelegateMetaDecisionTurn({
          projectPath,
          laneId: normalizedLaneId,
          delegateSession,
          prompt: recoveryPrompt,
          threadGoal: buildDelegateCodexThreadGoal({
            project,
            config,
            status: latestStatus,
            latestPlan,
            brief,
            laneId: normalizedLaneId,
          }),
          status: latestStatus,
          step: stepIndex + 1,
          logRunEvent,
          startType: "block_recovery_started",
          startTitle: "Block recovery started",
          startText:
            "The delegate was about to stop, so Clawdad is asking for a read-only ranked recovery probe before closing the run.",
          completedType: "block_recovery_completed",
          completedTitle: "Block recovery completed",
        });
        latestStatus = recoveryResult.status;
        const syncedAfterRecovery = await syncDelegateSession(projectPath, config);
        project = syncedAfterRecovery.projectDetails;
        config = syncedAfterRecovery.config;
        delegateSession = syncedAfterRecovery.session || delegateSession;
        latestStatus = await writeDelegateStatus(projectPath, {
          ...latestStatus,
          state: "running",
          delegateSessionId: delegateSession?.sessionId || latestStatus.delegateSessionId,
          delegateSessionLabel: delegateSession
            ? sessionDisplayForStatus(delegateSession)
            : latestStatus.delegateSessionLabel,
          stepCount: stepIndex + 1,
          maxSteps: config.maxStepsPerRun,
          activeRequestId: null,
          activeStep: null,
          lastRequestId: recoveryResult.dispatchResult.requestId || latestStatus.lastRequestId,
          lastOutcomeSummary: recoveryResult.decision.summary || latestStatus.lastOutcomeSummary,
          nextAction: recoveryResult.decision.nextAction || latestStatus.nextAction,
          stopReason: recoveryResult.decision.stopReason === "none" ? null : recoveryResult.decision.stopReason,
          codexGoal: recoveryResult.dispatchResult.codexGoal || latestStatus.codexGoal,
          error: "",
        }, normalizedLaneId);
        const recoveryComputeGuard = await evaluateDelegateComputeGuard(config);
        latestStatus = await writeDelegateStatus(projectPath, {
          ...latestStatus,
          computeBudget: recoveryComputeGuard.budget,
        }, normalizedLaneId);
        if (!recoveryComputeGuard.blocked) {
          const planWriteback = await refreshDelegatePlanForStepLearning({
            projectPath,
            laneId: normalizedLaneId,
            project,
            config,
            delegateSession,
            latestPlan,
            statusBefore: statusBeforeStep,
            statusAfter: latestStatus,
            decision: recoveryResult.decision,
            step: stepIndex + 1,
            phaseHandoffAnalysis,
            logRunEvent,
          });
          latestPlan = planWriteback.latestPlan || latestPlan;
          latestStatus = planWriteback.status || latestStatus;
        }

        if (recoveryComputeGuard.blocked) {
          return await setDelegateComputeBlocked(
            projectPath,
            config,
            latestStatus,
            recoveryComputeGuard.message,
            recoveryComputeGuard.budget,
          );
        }

        decision = recoveryResult.decision;
        responseText = recoveryResult.responseText;
        if (decision.state === "continue") {
          continue;
        }
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
          }, normalizedLaneId);
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
        }, normalizedLaneId);
        const codexGoal = await syncDelegateCodexGoalStatus(projectPath, latestStatus, "complete");
        latestStatus = await writeDelegateStatus(projectPath, {
          ...latestStatus,
          state: "completed",
          completedAt: new Date().toISOString(),
          pauseRequested: false,
          stopReason: null,
          codexGoal,
          error: "",
        }, normalizedLaneId);
        await logRunEvent("run_completed", {
          title: "Delegate completed",
          step: stepIndex + 1,
          summary: decision.summary || "The delegate marked the run complete.",
          text: `Bounded delegate-run is complete. For endless supervision, run ${delegateContinuousCommand(projectPath, normalizedLaneId)}.`,
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
        }, normalizedLaneId);
        const codexGoal = await syncDelegateCodexGoalStatus(projectPath, latestStatus, "paused", {
          objective: decision.nextAction || latestStatus.nextAction || "",
          error: decision.summary || "",
        });
        latestStatus = await writeDelegateStatus(projectPath, {
          ...latestStatus,
          state: "blocked",
          completedAt: new Date().toISOString(),
          pauseRequested: false,
          stopReason: decision.stopReason,
          codexGoal,
          error: "",
        }, normalizedLaneId);
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
    }, normalizedLaneId);
    const codexGoal = await syncDelegateCodexGoalStatus(projectPath, latestStatus, "paused", {
      error: error.message,
    });
    const failedStatus = await writeDelegateStatus(projectPath, {
      ...latestStatus,
      state: "failed",
      activeRequestId: null,
      activeStep: null,
      lastRequestId: latestStatus.lastRequestId || latestStatus.activeRequestId || null,
      completedAt: new Date().toISOString(),
      pauseRequested: false,
      codexGoal,
      error: error.message,
    }, normalizedLaneId);
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

async function buildDelegatePayload(projectDetails, laneId = defaultDelegateLaneId) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  const [
    config,
    brief,
    initialStatus,
    supervisorState,
    supervisorEventsPage,
    planSnapshots,
    runSummarySnapshots,
  ] = await Promise.all([
    readDelegateConfig(projectDetails.path, normalizedLaneId),
    readDelegateBrief(projectDetails.path, projectDetails, normalizedLaneId),
    readDelegateStatus(projectDetails.path, { laneId: normalizedLaneId }),
    readDelegateSupervisorState(projectDetails.path, normalizedLaneId),
    readDelegateSupervisorEvents(projectDetails.path, { laneId: normalizedLaneId, cursor: "tail", limit: 50 }),
    readDelegatePlanSnapshots(projectDetails.path, normalizedLaneId),
    readDelegateRunSummarySnapshots(projectDetails.path, normalizedLaneId),
  ]);
  let status = initialStatus;
  if (delegateStatusNeedsSupervisor(status, config)) {
    try {
      const resumeResult = await startDelegateRun(projectDetails, normalizedLaneId);
      status = resumeResult.status || status;
    } catch (error) {
      await appendDelegateRunEvent(projectDetails.path, status.runId, "supervisor_resume_failed", {
        title: "Supervisor resume failed",
        error: error.message,
        state: status.state,
      }, normalizedLaneId).catch(() => {});
    }
  }
  const delegateSession =
    resolveDelegateSessionFromProject(projectDetails, config) ||
    projectDetails.sessions.find(
      (session) =>
        String(session?.provider || "").trim().toLowerCase() === "codex" &&
        pickString(session?.slug) === pickString(config.delegateSessionSlug, delegateSessionSlugForLane(projectDetails, config)),
    ) ||
    null;
  const delegateRuns = await readDelegateRunList(projectDetails.path, {
    status,
    summarySnapshots: runSummarySnapshots,
    laneId: normalizedLaneId,
  });
  const lanes = await readDelegateLanes(projectDetails.path);

  return {
    laneId: normalizedLaneId,
    lane: lanes.find((entry) => normalizeDelegateLaneId(entry?.laneId) === normalizedLaneId) || null,
    lanes,
    config,
    brief,
    status,
    supervisor: delegateSupervisorStateForPayload(supervisorState),
    supervisorEvents: supervisorEventsPage.events,
    supervisorEventsCursor: supervisorEventsPage.nextCursor,
    supervisorEventsTotal: supervisorEventsPage.total,
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

function delegateCliLaneId(rawOptions) {
  return normalizeDelegateLaneId(rawOptions.lane);
}

function delegateLaneDisplayName(lane = {}) {
  return pickString(lane.displayName) ||
    (delegateLaneIsDefault(lane.laneId) ? "Default delegate" : pickString(lane.laneId, defaultDelegateLaneId));
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

async function runLanes(argv) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    printUsage();
    return;
  }

  const resolved = await resolveDelegateProjectForCli(rawOptions);
  const lanes = await readDelegateLanes(resolved.projectPath);
  const result = {
    ok: true,
    project: resolved.projectPath,
    projectDetails: resolved.projectDetails,
    lanes,
  };

  if (rawOptions.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`${resolved.projectDetails.displayName || resolved.projectDetails.slug}`);
  for (const lane of lanes) {
    const status = lane.status?.state || "idle";
    const live = lane.status?.live ? " live" : "";
    const objective = lane.objective ? ` - ${lane.objective}` : "";
    console.log(`${lane.laneId}: ${delegateLaneDisplayName(lane)} (${status}${live})${objective}`);
  }
}

async function runLaneCreate(argv) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    printUsage();
    return;
  }

  const resolved = await resolveDelegateProjectForCli(rawOptions);
  const laneId = normalizeDelegateLaneId(rawOptions.lane || rawOptions._[1]);
  if (!laneId || delegateLaneIsDefault(laneId)) {
    throw new Error("missing non-default lane id");
  }

  await ensureDelegateLaneStorage(resolved.projectPath, laneId, resolved.projectDetails);
  const lane = await writeDelegateLaneConfig(resolved.projectPath, laneId, {
    displayName: pickString(rawOptions.displayName, laneId),
    objective: pickString(rawOptions.objective),
    scopeGlobs: Array.isArray(rawOptions.scope) ? rawOptions.scope.filter(Boolean) : [],
    enabled: false,
  });
  const lanes = await readDelegateLanes(resolved.projectPath);
  const result = {
    ok: true,
    project: resolved.projectPath,
    projectDetails: resolved.projectDetails,
    lane,
    lanes,
  };

  if (rawOptions.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`created delegate lane ${lane.laneId} for ${resolved.projectDetails.displayName || resolved.projectDetails.slug}`);
}

async function runDelegateGet(argv) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    printUsage();
    return;
  }

  const resolved = await resolveDelegateProjectForCli(rawOptions);
  const laneId = delegateCliLaneId(rawOptions);
  const payload = await buildDelegatePayload(resolved.projectDetails, laneId);
  const result = {
    ok: true,
    project: resolved.projectPath,
    laneId,
    projectDetails: resolved.projectDetails,
    ...payload,
  };

  if (rawOptions.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`${resolved.projectDetails.displayName || resolved.projectDetails.slug}`);
  console.log(`Path: ${resolved.projectPath}`);
  console.log(`Lane: ${delegateLaneDisplayName(payload.config)} (${payload.config.laneId})`);
  console.log(`Delegate session: ${payload.delegateSession?.label || "not created yet"}`);
  const status = payload.status || {};
  const statusBits = [
    status.stepCount != null ? delegateStatusStepText(status) : "",
    status.pauseRequested ? "pause requested" : "",
    status.activeRequestId ? `active ${status.activeRequestId}` : "",
  ].filter(Boolean);
  const supervisorText = status.supervisorPid
    ? `${delegateSupervisorIsLive(status) ? "live" : "stale"} pid ${status.supervisorPid}`
    : "none";
  const continuitySupervisor = payload.supervisor || {};
  const continuitySupervisorText = continuitySupervisor.enabled || continuitySupervisor.state !== "stopped"
    ? `${continuitySupervisor.state || "stopped"}${continuitySupervisor.live ? ` live pid ${continuitySupervisor.pid}` : ""}${
        continuitySupervisor.restartCount ? `, ${continuitySupervisor.restartCount} restart(s)` : ""
      }`
    : "off";
  console.log(`Status: ${status.state || "idle"}${statusBits.length ? ` (${statusBits.join(", ")})` : ""}`);
  console.log(`Worker supervisor: ${supervisorText}`);
  console.log(`Continuity supervisor: ${continuitySupervisorText}`);
  if (continuitySupervisor.lastBlockerReason) {
    console.log(`Supervisor blocker: ${continuitySupervisor.lastBlockerReason}`);
  }
  console.log(`Guardrails: hard stops ${payload.config.hardStops.join(", ")}`);
  console.log(`Watchtower review: ${payload.config.watchtowerReviewMode || "off"}`);
  console.log(`Direction check: ${payload.config.directionCheckMode || "observe"}`);
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
  const laneId = delegateCliLaneId(rawOptions);
  let brief = "";
  const hasBriefInput = Boolean(rawOptions.file || rawOptions.stdin || rawOptions._.slice(1).join(" ").trim());
  const hasConfigUpdate =
    rawOptions.computeReservePercent != null ||
    rawOptions.maxStepsPerRun != null ||
    rawOptions.session != null ||
    rawOptions.watchtowerReviewMode != null ||
    rawOptions.directionCheckMode != null;

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
    ? await writeDelegateBrief(resolved.projectPath, brief, resolved.projectDetails, laneId)
    : await readDelegateBrief(resolved.projectPath, resolved.projectDetails, laneId);

  if (hasConfigUpdate) {
    const currentConfig = await readDelegateConfig(resolved.projectPath, laneId);
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
      watchtowerReviewMode:
        rawOptions.watchtowerReviewMode != null
          ? rawOptions.watchtowerReviewMode
          : currentConfig.watchtowerReviewMode,
      directionCheckMode:
        rawOptions.directionCheckMode != null
          ? rawOptions.directionCheckMode
          : currentConfig.directionCheckMode,
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

    await writeDelegateConfig(resolved.projectPath, nextConfig, laneId);
  }

  const payload = await buildDelegatePayload(resolved.projectDetails, laneId);
  const result = {
    ok: true,
    project: resolved.projectPath,
    laneId,
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
    if (payload.continuousCommand) {
      console.log(`continuous supervision: ${payload.continuousCommand}`);
    }
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

function shellQuote(value) {
  return `'${String(value || "").replace(/'/gu, "'\\''")}'`;
}

function delegateContinuousCommand(projectPath, laneId = defaultDelegateLaneId) {
  return `clawdad supervise ${shellQuote(projectPath)} --lane ${shellQuote(normalizeDelegateLaneId(laneId))} --daemon`;
}

function printDelegatePreflightBlocked(resolved, preflight) {
  const displayName = resolved.projectDetails.displayName || resolved.projectDetails.slug || resolved.projectPath;
  console.log(`delegate not started for ${displayName}`);
  console.log(preflight.reason || "ORP did not report a safe continuation.");
  if (preflight.bootstrapCommand) {
    console.log("");
    console.log(`Bootstrap first: ${preflight.bootstrapCommand}`);
  }
}

function delegatePreflightBlockedResult(resolved, preflight) {
  return {
    ok: false,
    action: "start",
    accepted: false,
    project: resolved.projectPath,
    projectDetails: resolved.projectDetails,
    error: preflight.reason || "ORP did not report a safe continuation.",
    bootstrapCommand: preflight.bootstrapCommand || "",
    orpPreflight: preflight,
  };
}

function delegateStatusIsRunningLike(status = {}) {
  const state = String(status?.state || "").trim().toLowerCase();
  return ["running", "dispatching", "starting", "planning"].includes(state) || Boolean(status?.activeRequestId);
}

function delegateSupervisorBriefHasObjective(brief = "") {
  const text = trimTrailingNewlines(String(brief || ""));
  if (!text) {
    return false;
  }
  const lower = text.toLowerCase();
  return !(
    lower.includes("what does success look like") &&
    lower.includes("what should the delegate push forward right now")
  );
}

function delegateSupervisorConfiguredObjective(config = {}, brief = "") {
  return pickString(config.objective) || (delegateSupervisorBriefHasObjective(brief) ? "saved delegate brief" : "");
}

function delegateSupervisorFailureReported(status = {}) {
  const stopReason = pickString(status.stopReason).toLowerCase();
  if (["needs_human", "compute_limit", "auth_required", "failed_checks", "test_failure", "project_boundary"].includes(stopReason)) {
    return {
      blocked: true,
      code: stopReason,
      reason: `Delegate stopped with hard-stop reason: ${stopReason}.`,
    };
  }
  if (status.error) {
    return {
      blocked: true,
      code: "delegate_error",
      reason: status.error,
    };
  }

  const text = [
    status.lastOutcomeSummary,
    status.nextAction,
  ].filter(Boolean).join("\n");
  const failureLine = text
    .split(/\r?\n/u)
    .find((line) => {
      const lower = line.toLowerCase();
      if (/\b(no|without|resolved|fixed|cleared)\s+(failed|failing)\s+(tests?|checks?)\b/u.test(lower)) {
        return false;
      }
      return /\b(failing tests?|tests? failed|failed checks?|checks? failed|validation failed|lint failed|build failed)\b/u.test(lower);
    });
  if (failureLine) {
    return {
      blocked: true,
      code: "failed_checks",
      reason: `Delegate reported failed validation: ${failureLine.trim()}`,
    };
  }

  return {
    blocked: false,
    code: "",
    reason: "",
  };
}

function delegateSupervisorNextActionDecision(nextAction) {
  const text = trimTrailingNewlines(String(nextAction || "")).trim();
  if (!text) {
    return {
      ok: false,
      missing: true,
      code: "missing_next_action",
      reason: "Delegate completed without a nextAction.",
      nextAction: "",
    };
  }

  const lower = text.toLowerCase();
  const ambiguous =
    text.length < 12 ||
    /^(continue|keep going|next|tbd|todo|unknown|none|n\/a|na)$/u.test(lower) ||
    /\b(maybe|figure out|something|whatever|unsure|unclear)\b/u.test(lower);
  if (ambiguous) {
    return {
      ok: false,
      missing: false,
      code: "ambiguous_next_action",
      reason: `Supervisor needs a concrete nextAction before restarting: ${text}`,
      nextAction: text,
    };
  }

  return {
    ok: true,
    missing: false,
    code: "ok",
    reason: "",
    nextAction: text,
  };
}

function delegateSupervisorHardStopDecision({ config = {}, status = {}, nextAction = "", brief = "" } = {}) {
  const text = [
    nextAction,
    status.lastOutcomeSummary,
    status.error,
  ].filter(Boolean).join("\n").toLowerCase();
  const hardStops = Array.isArray(config.hardStops)
    ? config.hardStops.map((entry) => pickString(entry).toLowerCase()).filter(Boolean)
    : [];

  if (hardStops.includes("needs_human") && /\b(needs? human|human approval|manual approval|ask the user|ask user|requires approval|awaiting approval)\b/u.test(text)) {
    return {
      blocked: true,
      code: "needs_human",
      reason: "Continuation appears to require human approval.",
    };
  }

  if (/\b(paid|unbudgeted|purchase|buy|subscribe|billing|invoice|credit card|live payment|paid api)\b/u.test(text)) {
    return {
      blocked: true,
      code: "paid_unbudgeted",
      reason: "Continuation may involve paid or unbudgeted work.",
    };
  }

  if (/\b(api key|credential|secret|password|token rotation|login|account decision)\b/u.test(text)) {
    return {
      blocked: true,
      code: "credential_boundary",
      reason: "Continuation touches credential or account boundaries.",
    };
  }

  if (/\b(outside this repo|outside the repo|another repo|different repository|production deploy|live order|hard boundary)\b/u.test(text)) {
    return {
      blocked: true,
      code: "project_boundary",
      reason: "Continuation may cross a project hard boundary.",
    };
  }

  return {
    blocked: false,
    code: "",
    reason: "",
  };
}

function compactDelegateDirectionText(value = "", maxLength = 480) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function delegateDirectionTokens(value = "") {
  const stopWords = new Set([
    "the", "and", "for", "with", "that", "this", "from", "into", "then", "than", "after",
    "before", "when", "while", "will", "should", "could", "would", "about", "under", "over",
    "next", "action", "latest", "delegate", "lane", "run", "step", "project", "work",
  ]);
  return new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9_/-]+/gu, " ")
      .split(/\s+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !stopWords.has(token)),
  );
}

function delegateDirectionOverlap(left = "", right = "") {
  const leftTokens = delegateDirectionTokens(left);
  const rightTokens = delegateDirectionTokens(right);
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function buildDelegateDirectionCheckInput({
  config = {},
  status = {},
  brief = "",
  nextAction = "",
  gate = {},
  supervisor = {},
} = {}) {
  return {
    laneId: normalizeDelegateLaneId(config.laneId || status.laneId || supervisor.laneId || defaultDelegateLaneId),
    objective: compactDelegateDirectionText(config.objective || brief, 700),
    previousNextAction: compactDelegateDirectionText(status.nextAction || supervisor.lastConsumedNextAction || "", 500),
    proposedNextAction: compactDelegateDirectionText(nextAction, 500),
    latestOutcome: compactDelegateDirectionText(status.lastOutcomeSummary || supervisor.lastOutcome || "", 700),
    statusState: pickString(status.state) || "idle",
    runId: pickString(status.runId) || null,
    checks: {
      orp: gate?.orpPreflight?.ok === false ? "blocked" : gate?.orpPreflight ? "passed" : "not_checked",
      compute: gate?.computeGuard?.blocked ? "blocked" : gate?.computeGuard ? "passed" : "not_checked",
      hardStops: gate?.ok === false ? gate.code || "blocked" : "passed",
    },
  };
}

function evaluateDelegateDirectionCheck({
  config = {},
  status = {},
  brief = "",
  nextAction = "",
  gate = {},
  supervisor = {},
} = {}) {
  const mode = normalizeDelegateDirectionCheckMode(config.directionCheckMode);
  const input = buildDelegateDirectionCheckInput({ config, status, brief, nextAction, gate, supervisor });
  if (mode === "off") {
    return normalizeDelegateDirectionCheckResult({
      mode,
      decision: "skipped",
      confidence: 1,
      reason: "Direction check is disabled for this lane.",
      ...input,
      checkedAt: new Date().toISOString(),
    });
  }

  const issues = [];
  const proposed = input.proposedNextAction || "";
  const latest = input.latestOutcome || "";
  const objective = input.objective || "";
  const previous = input.previousNextAction || "";
  const combined = `${latest}\n${proposed}`.toLowerCase();

  if (!latest && String(status.state || "").toLowerCase() === "completed") {
    issues.push({
      severity: "caution",
      reason: "The previous worker completed without a latestOutcome readback.",
    });
  }

  if (previous && proposed && previous.toLowerCase() === proposed.toLowerCase() && Number(supervisor.restartCount || 0) > 0) {
    issues.push({
      severity: "caution",
      reason: "The proposed nextAction repeats the last consumed nextAction.",
      detectedDrift: true,
    });
  }

  if (/\b(no progress|nothing changed|no route change|still blocked|still deferred|waiting for|wait for|awaiting)\b/u.test(combined)) {
    issues.push({
      severity: "caution",
      reason: "The run appears to be waiting or making little progress; avoid restarting into a low-value loop.",
      detectedDrift: true,
    });
  }

  if (
    /\b(failed|failing|red|error|broken)\b[\s\S]{0,80}\b(test|tests|check|checks|gate|gates|build|lint)\b/u.test(combined) ||
    /\b(test|tests|check|checks|gate|gates|build|lint)\b[\s\S]{0,80}\b(failed|failing|red|error|broken)\b/u.test(combined)
  ) {
    if (!/\b(fix|repair|resolve|rerun|test|check|hygiene|checkpoint|classify)\b/u.test(proposed.toLowerCase())) {
      issues.push({
        severity: "pause",
        reason: "The worker reported failed checks, but the proposed nextAction does not clearly repair or rerun them.",
        detectedDrift: true,
      });
    }
  }

  if (/\b(do not widen|do not expand|standing handoff|only when|until .+ fires|wait state|finite ladder is closed)\b/u.test(`${objective}\n${latest}`.toLowerCase()) &&
      /\b(widen|expand|new feature|new lane|fresh implementation|broaden|explore unrelated)\b/u.test(proposed.toLowerCase())) {
    issues.push({
      severity: "pause",
      reason: "The proposed nextAction widens work despite the current handoff saying to wait or stay narrow.",
      detectedDrift: true,
    });
  }

  const overlap = delegateDirectionOverlap(objective, proposed);
  if (objective && proposed && overlap < 0.08 && !/\b(hygiene|checkpoint|test|verify|review|summary|report)\b/u.test(proposed.toLowerCase())) {
    issues.push({
      severity: "caution",
      reason: "The proposed nextAction has low lexical overlap with the saved lane objective.",
      detectedDrift: true,
    });
  }

  const pauseIssue = issues.find((issue) => issue.severity === "pause");
  const cautionIssue = issues.find((issue) => issue.severity === "caution");
  const selected = pauseIssue || cautionIssue || null;
  const decision = pauseIssue ? "pause" : cautionIssue ? "caution" : "aligned";
  const confidence = decision === "aligned" ? 0.78 : pauseIssue ? 0.86 : 0.68;
  const reason = selected?.reason || "Proposed continuation is aligned with the lane objective and last readback.";
  const detectedDrift = issues.some((issue) => issue.detectedDrift);
  const recommendedNextAction = pauseIssue
    ? "Pause and retarget the lane with a concrete repair, checkpoint, or blocker packet before restarting."
    : cautionIssue
      ? proposed
      : proposed;

  return normalizeDelegateDirectionCheckResult({
    mode,
    decision,
    confidence,
    reason,
    detectedDrift,
    humanNeeded: false,
    source: "heuristic",
    previousNextAction: input.previousNextAction,
    proposedNextAction: input.proposedNextAction,
    latestOutcome: input.latestOutcome,
    recommendedNextAction,
    checks: input.checks,
    checkedAt: new Date().toISOString(),
  });
}

async function evaluateDelegateSupervisorGates(projectPath, {
  config = {},
  status = {},
  nextAction = "",
  brief = "",
  supervisor = {},
  requireNextAction = false,
} = {}) {
  const statusBlocker = delegateSupervisorFailureReported(status);
  if (statusBlocker.blocked) {
    return {
      ok: false,
      blocked: true,
      code: statusBlocker.code,
      reason: statusBlocker.reason,
      lastGateResult: {
        ok: false,
        gate: "delegate_status",
        code: statusBlocker.code,
        reason: statusBlocker.reason,
      },
    };
  }

  const nextDecision = requireNextAction
    ? delegateSupervisorNextActionDecision(nextAction)
    : { ok: true, nextAction: pickString(nextAction) };
  if (!nextDecision.ok) {
    return {
      ok: false,
      blocked: !nextDecision.missing,
      completed: Boolean(nextDecision.missing),
      code: nextDecision.code,
      reason: nextDecision.reason,
      lastGateResult: {
        ok: false,
        gate: "next_action",
        code: nextDecision.code,
        reason: nextDecision.reason,
      },
      nextAction: nextDecision.nextAction,
    };
  }

  const hardStop = delegateSupervisorHardStopDecision({
    config,
    status,
    nextAction: nextDecision.nextAction,
    brief,
  });
  if (hardStop.blocked) {
    return {
      ok: false,
      blocked: true,
      code: hardStop.code,
      reason: hardStop.reason,
      lastGateResult: {
        ok: false,
        gate: "hard_stops",
        code: hardStop.code,
        reason: hardStop.reason,
      },
      nextAction: nextDecision.nextAction,
    };
  }

  const orpPreflight = await runOrpDelegatePreflight(projectPath);
  if (!orpPreflight.ok) {
    return {
      ok: false,
      blocked: true,
      code: orpPreflight.step || "orp_preflight",
      reason: orpPreflight.reason || "ORP did not report a safe continuation.",
      bootstrapCommand: orpPreflight.bootstrapCommand || "",
      orpPreflight,
      lastGateResult: {
        ok: false,
        gate: "orp_preflight",
        code: orpPreflight.step || "orp_preflight",
        reason: orpPreflight.reason || "ORP did not report a safe continuation.",
      },
      nextAction: nextDecision.nextAction,
    };
  }

  const computeGuard = await evaluateDelegateComputeGuard(config);
  if (computeGuard.blocked) {
    return {
      ok: false,
      blocked: true,
      code: "compute_limit",
      reason: computeGuard.message,
      computeGuard,
      lastGateResult: {
        ok: false,
        gate: "compute",
        code: "compute_limit",
        reason: computeGuard.message,
        budget: computeGuard.budget,
      },
      nextAction: nextDecision.nextAction,
    };
  }

  const directionCheck = evaluateDelegateDirectionCheck({
    config,
    status,
    brief,
    nextAction: nextDecision.nextAction,
    gate: {
      ok: true,
      orpPreflight,
      computeGuard,
    },
    supervisor,
  });
  if (directionCheck.enforceable) {
    return {
      ok: false,
      blocked: true,
      code: "direction_check",
      reason: directionCheck.reason || "Direction check blocked continuation.",
      directionCheck,
      lastGateResult: {
        ok: false,
        gate: "direction_check",
        code: directionCheck.decision,
        reason: directionCheck.reason || "Direction check blocked continuation.",
        directionCheck,
        checkedAt: directionCheck.checkedAt,
      },
      nextAction: nextDecision.nextAction,
    };
  }

  return {
    ok: true,
    blocked: false,
    code: "ok",
    reason: "",
    orpPreflight,
    computeGuard,
    directionCheck,
    lastGateResult: {
      ok: true,
      gate: "supervisor",
      code: "safe_to_continue",
      reason:
        directionCheck.mode === "off"
          ? "ORP and compute gates passed."
          : directionCheck.decision === "aligned"
            ? "ORP, compute, and direction checks passed."
            : `ORP and compute gates passed; direction check is ${directionCheck.decision}.`,
      directionCheck,
      checkedAt: new Date().toISOString(),
    },
    nextAction: nextDecision.nextAction,
  };
}

function buildDelegateSupervisorContinuationBrief(brief, status = {}, nextAction = "") {
  const marker = "# Supervisor Continuation";
  const base = trimTrailingNewlines(String(brief || "")).split(marker)[0].trim();
  const latestOutcome = trimTrailingNewlines(String(status.lastOutcomeSummary || "No latest outcome was recorded."));
  const runId = pickString(status.runId) || "unknown";
  const completedAt = pickString(status.completedAt, status.updatedAt) || new Date().toISOString();
  return `${base || defaultDelegateBrief({ path: status.projectPath })}\n\n${marker}
Latest Outcome:
${latestOutcome}

Consumed Next Action:
${trimTrailingNewlines(nextAction)}

Worker Run:
- Previous run: ${runId}
- Previous completion: ${completedAt}

Supervisor Rules:
- Treat this as one bounded delegate run.
- Do not widen into unrelated implementation work.
- Stop with a clear blocker if ORP hygiene, compute reserve, failed checks, human approval, paid work, credentials, or project boundaries are unsafe.
`;
}

async function persistDelegateSupervisorTransition(projectPath, laneId, patch, eventType, eventPayload = {}, { dryRun = false } = {}) {
  if (dryRun) {
    return normalizeDelegateSupervisorState({
      ...patch,
      projectPath,
      laneId,
    });
  }
  const supervisor = await writeDelegateSupervisorState(projectPath, patch, laneId);
  await appendDelegateSupervisorEvent(projectPath, laneId, eventType, {
    ...eventPayload,
    state: supervisor.state,
    restartCount: supervisor.restartCount,
  }).catch(() => {});
  return supervisor;
}

async function blockDelegateSupervisor(resolved, laneId, currentSupervisor, gate, options = {}) {
  const reason = gate.reason || "Supervisor gate blocked continuation.";
  const supervisor = await persistDelegateSupervisorTransition(
    resolved.projectPath,
    laneId,
    {
      ...currentSupervisor,
      enabled: false,
      state: "blocked",
      pid: process.pid,
      lastGateResult: gate.lastGateResult || {
        ok: false,
        gate: gate.code || "supervisor",
        reason,
      },
      lastDirectionCheck: gate.directionCheck || gate.lastGateResult?.directionCheck || currentSupervisor.lastDirectionCheck || null,
      lastBlockerReason: reason,
      lastAction: "blocked",
      stoppedAt: new Date().toISOString(),
    },
    "supervisor_blocked",
    {
      action: "blocked",
      reason,
      nextAction: gate.nextAction || "",
      payload: gate,
    },
    options,
  );
  const config = await readDelegateConfig(resolved.projectPath, laneId);
  if (!options.dryRun) {
    await writeDelegateConfig(resolved.projectPath, {
      ...config,
      enabled: false,
    }, laneId);
  }
  return {
    ok: false,
    action: "blocked",
    accepted: false,
    started: false,
    project: resolved.projectPath,
    laneId,
    projectDetails: resolved.projectDetails,
    error: reason,
    supervisor: delegateSupervisorStateForPayload(supervisor),
    gate,
  };
}

async function stopTerminalDelegateRunSupervisor(projectPath, laneId, status = {}, {
  reason = "Terminal delegate run supervisor is no longer needed.",
} = {}) {
  const state = pickString(status.state).toLowerCase();
  if (!["completed", "blocked", "failed"].includes(state)) {
    return false;
  }
  const pid = Number.parseInt(String(status.supervisorPid || "0"), 10);
  if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid || !processIsLive(pid)) {
    return false;
  }
  const runId = safeDelegateRunId(status.runId);
  const matches = await delegateRunSupervisorPidMatches(pid, projectPath, runId);
  if (!matches) {
    return false;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (_error) {
    return false;
  }

  await appendDelegateRunEvent(projectPath, status.runId, "stale_run_supervisor_stopped", {
    title: "Stale run supervisor stopped",
    text: reason,
    state,
    payload: {
      pid,
      reason,
    },
  }, laneId).catch(() => {});
  return true;
}

async function startDelegateFromSupervisor(resolved, laneId, {
  config,
  status,
  brief,
  nextAction = "",
  gate,
  currentSupervisor,
  mode,
  options = {},
} = {}) {
  const restartCount = Number(currentSupervisor?.restartCount || 0) + 1;
  if (options.dryRun) {
    const supervisor = normalizeDelegateSupervisorState({
      ...currentSupervisor,
      enabled: false,
      state: "stopped",
      pid: null,
      lastGateResult: gate.lastGateResult,
      lastDirectionCheck: gate.directionCheck || gate.lastGateResult?.directionCheck || null,
      lastConsumedNextAction: nextAction || null,
      lastOutcome: status?.lastOutcomeSummary || null,
      lastAction: mode,
      restartCount,
      lastRestartAt: new Date().toISOString(),
      stoppedAt: new Date().toISOString(),
    });
    return {
      ok: true,
      action: "dry_run",
      accepted: false,
      started: false,
      project: resolved.projectPath,
      laneId,
      projectDetails: resolved.projectDetails,
      supervisor: delegateSupervisorStateForPayload(supervisor),
      gate,
    };
  }

  if (nextAction) {
    const nextBrief = buildDelegateSupervisorContinuationBrief(brief, status, nextAction);
    await writeDelegateBrief(resolved.projectPath, nextBrief, resolved.projectDetails, laneId);
    await writeDelegateConfig(resolved.projectPath, {
      ...config,
      objective: nextAction,
    }, laneId);
  }

  if (gate.directionCheck) {
    await appendDelegateSupervisorEvent(resolved.projectPath, laneId, "supervisor_direction_checked", {
      action: "direction_check",
      runId: status?.runId || null,
      nextAction,
      reason: gate.directionCheck.reason || "",
      payload: {
        directionCheck: gate.directionCheck,
      },
    }).catch(() => {});
  }

  await stopTerminalDelegateRunSupervisor(resolved.projectPath, laneId, status, {
    reason: `Supervisor ${mode} is starting the next bounded run.`,
  }).catch(() => {});

  const startResult = await startDelegateRun(resolved.projectDetails, laneId);
  const started = Boolean(startResult.accepted && startResult.status?.state === "running");
  const keepRunning = Boolean(options.keepRunning);
  const transitionAt = new Date().toISOString();
  const nextSupervisor = await persistDelegateSupervisorTransition(
    resolved.projectPath,
    laneId,
    {
      ...currentSupervisor,
      enabled: started ? keepRunning : false,
      state: started ? (keepRunning ? "running" : "stopped") : "blocked",
      pid: started && keepRunning ? process.pid : null,
      startedAt: currentSupervisor?.startedAt || transitionAt,
      intervalSeconds: options.intervalSeconds,
      maxRuns: options.maxRuns,
      restartCount: started ? restartCount : Number(currentSupervisor?.restartCount || 0),
      lastGateResult: gate.lastGateResult,
      lastDirectionCheck: gate.directionCheck || gate.lastGateResult?.directionCheck || currentSupervisor.lastDirectionCheck || null,
      lastRestartAt: started ? transitionAt : currentSupervisor?.lastRestartAt || null,
      lastBlockerReason: started ? null : startResult.status?.error || "Delegate lane did not accept a restart.",
      lastConsumedNextAction: nextAction || currentSupervisor?.lastConsumedNextAction || null,
      lastOutcome: status?.lastOutcomeSummary || currentSupervisor?.lastOutcome || null,
      lastAction: started ? mode : "restart_rejected",
      stoppedAt: started && !keepRunning ? transitionAt : currentSupervisor?.stoppedAt || null,
    },
    started ? "supervisor_restarted_lane" : "supervisor_restart_rejected",
    {
      action: started ? mode : "restart_rejected",
      runId: startResult.status?.runId || null,
      nextAction,
      reason: started ? "" : startResult.status?.error || "Delegate lane did not accept a restart.",
      payload: {
        gate,
        delegateStatus: startResult.status || null,
      },
    },
    options,
  );

  return {
    ok: started,
    action: mode,
    accepted: Boolean(startResult.accepted),
    started,
    project: resolved.projectPath,
    laneId,
    projectDetails: resolved.projectDetails,
    status: startResult.status || null,
    supervisor: delegateSupervisorStateForPayload(nextSupervisor),
    gate,
    error: started ? "" : startResult.status?.error || "Delegate lane did not accept a restart.",
  };
}

async function reconcileDelegateStatusFromCompletedMailbox(projectPath, status = {}, laneId = defaultDelegateLaneId) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  if (!delegateStatusIsRunningLike(status)) {
    return status;
  }

  const mailboxStatus = await readMailboxStatus(projectPath, normalizedLaneId).catch(() => null);
  if (pickString(mailboxStatus?.state).toLowerCase() !== "completed") {
    return status;
  }

  const mailboxRequestId = pickString(mailboxStatus.request_id, mailboxStatus.requestId);
  const activeRequestId = pickString(status.activeRequestId);
  if (mailboxRequestId && activeRequestId && mailboxRequestId !== activeRequestId) {
    return status;
  }

  const responseMarkdown = await readMailboxResponseForStatus(projectPath, mailboxStatus, normalizedLaneId).catch(() => "");
  const responseText = responseBodyFromMailbox(responseMarkdown);
  if (!responseText) {
    return status;
  }

  let decision;
  try {
    decision = parseDelegateDecision(responseText);
  } catch (_error) {
    return status;
  }

  const completedAt = pickString(mailboxStatus.completed_at, mailboxStatus.completedAt, new Date().toISOString());
  const currentStepCount = Number.parseInt(String(status.stepCount || "0"), 10) || 0;
  const activeStep = Number.parseInt(String(status.activeStep || "0"), 10) || 0;
  const step = activeStep > 0 ? activeStep : Math.max(1, currentStepCount);
  const nextState = decision.state === "blocked" ? "blocked" : "completed";
  const nextStatus = await writeDelegateStatus(projectPath, {
    ...status,
    state: nextState,
    completedAt,
    stepCount: Math.max(currentStepCount, step),
    activeRequestId: null,
    activeStep: null,
    lastRequestId: mailboxRequestId || status.lastRequestId || null,
    lastOutcomeSummary: decision.summary || status.lastOutcomeSummary || null,
    nextAction: decision.nextAction || status.nextAction || null,
    stopReason: decision.state === "blocked" ? decision.stopReason : null,
    pauseRequested: false,
    error: decision.state === "blocked" ? decision.summary || "" : "",
  }, normalizedLaneId);

  await appendDelegateRunEvent(projectPath, status.runId, "mailbox_completion_reconciled", {
    title: "Mailbox completion reconciled",
    step,
    requestId: mailboxRequestId,
    state: decision.state,
    stopReason: decision.stopReason,
    summary: decision.summary,
    nextAction: decision.nextAction,
    text: "Supervisor consumed a completed mailbox response while the lane status was still running.",
    checkpoint: decision.checkpoint,
  }, normalizedLaneId).catch(() => {});
  await appendDelegateRunEvent(projectPath, status.runId, "step_completed", {
    title: "Delegate step completed",
    step,
    requestId: mailboxRequestId,
    state: decision.state,
    stopReason: decision.stopReason,
    summary: decision.summary,
    nextAction: decision.nextAction,
    checkpoint: decision.checkpoint,
  }, normalizedLaneId).catch(() => {});

  if (decision.state === "completed") {
    await resetCompletedMailboxForSupervisorRestart(projectPath, mailboxStatus, normalizedLaneId).catch(() => {});
  }

  return nextStatus;
}

async function resetCompletedMailboxForSupervisorRestart(projectPath, mailboxStatus = {}, laneId = defaultDelegateLaneId) {
  if (pickString(mailboxStatus.state).toLowerCase() !== "completed") {
    return false;
  }
  const { statusFile } = mailboxPaths(projectPath, laneId);
  await writeJsonFile(statusFile, {
    ...mailboxStatus,
    state: "idle",
    request_id: null,
    dispatched_at: null,
    completed_at: null,
    heartbeat_at: null,
    error: null,
    pid: null,
  });
  return true;
}

async function runDelegateSupervisorTick(resolved, laneId, options = {}) {
  const [config, brief, initialStatus, supervisor] = await Promise.all([
    readDelegateConfig(resolved.projectPath, laneId),
    readDelegateBrief(resolved.projectPath, resolved.projectDetails, laneId),
    readDelegateStatus(resolved.projectPath, { reconcile: false, laneId }),
    readDelegateSupervisorState(resolved.projectPath, laneId),
  ]);
  let status = initialStatus;
  const currentSupervisor = normalizeDelegateSupervisorState({
    ...supervisor,
    enabled: Boolean(options.keepRunning),
    state: options.keepRunning ? "running" : "stopped",
    pid: options.keepRunning ? process.pid : null,
    startedAt: supervisor.startedAt || new Date().toISOString(),
    intervalSeconds: options.intervalSeconds,
    maxRuns: options.maxRuns,
  });

  status = await reconcileDelegateStatusFromCompletedMailbox(resolved.projectPath, status, laneId);

  if (delegateStatusIsRunningLike(status)) {
    const nextSupervisor = await persistDelegateSupervisorTransition(
      resolved.projectPath,
      laneId,
      {
        ...currentSupervisor,
        enabled: Boolean(options.keepRunning),
        state: options.keepRunning ? "running" : "stopped",
        pid: options.keepRunning ? process.pid : null,
        stoppedAt: options.keepRunning ? currentSupervisor.stoppedAt : new Date().toISOString(),
        lastGateResult: {
          ok: true,
          gate: "lane_status",
          code: "lane_running",
          reason: "Worker lane is already running.",
          checkedAt: new Date().toISOString(),
        },
        lastAction: "wait",
      },
      "supervisor_waiting",
      {
        action: "wait",
        runId: status.runId,
        reason: "Worker lane is already running.",
      },
      options,
    );
    return {
      ok: true,
      action: "wait",
      accepted: false,
      started: false,
      project: resolved.projectPath,
      laneId,
      projectDetails: resolved.projectDetails,
      status,
      supervisor: delegateSupervisorStateForPayload(nextSupervisor),
    };
  }

  if (status.state === "completed") {
    const nextDecision = delegateSupervisorNextActionDecision(status.nextAction);
    if (nextDecision.missing) {
      const nextSupervisor = await persistDelegateSupervisorTransition(
        resolved.projectPath,
        laneId,
        {
          ...currentSupervisor,
          enabled: false,
          state: "completed",
          pid: null,
          lastGateResult: {
            ok: true,
            gate: "next_action",
            code: "no_next_action",
            reason: "Delegate completed without a nextAction.",
          },
          lastBlockerReason: null,
          lastAction: "completed",
          stoppedAt: new Date().toISOString(),
        },
        "supervisor_completed",
        {
          action: "completed",
          runId: status.runId,
          reason: "Delegate completed without a nextAction.",
        },
        options,
      );
      return {
        ok: true,
        action: "completed",
        accepted: false,
        started: false,
        project: resolved.projectPath,
        laneId,
        projectDetails: resolved.projectDetails,
        status,
        supervisor: delegateSupervisorStateForPayload(nextSupervisor),
      };
    }

    const gate = await evaluateDelegateSupervisorGates(resolved.projectPath, {
      config,
      status,
      brief,
      nextAction: nextDecision.nextAction,
      supervisor: currentSupervisor,
      requireNextAction: true,
    });
    if (!gate.ok) {
      return blockDelegateSupervisor(resolved, laneId, currentSupervisor, gate, options);
    }
    return startDelegateFromSupervisor(resolved, laneId, {
      config,
      status,
      brief,
      nextAction: gate.nextAction,
      gate,
      currentSupervisor,
      mode: "restart",
      options,
    });
  }

  if (status.state === "idle") {
    const configuredObjective = delegateSupervisorConfiguredObjective(config, brief);
    if (!configuredObjective) {
      return blockDelegateSupervisor(
        resolved,
        laneId,
        currentSupervisor,
        {
          ok: false,
          blocked: true,
          code: "missing_objective",
          reason: "Supervisor needs a configured delegate brief or lane objective before starting.",
          lastGateResult: {
            ok: false,
            gate: "objective",
            code: "missing_objective",
            reason: "Supervisor needs a configured delegate brief or lane objective before starting.",
          },
        },
        options,
      );
    }
    const gate = await evaluateDelegateSupervisorGates(resolved.projectPath, {
      config,
      status,
      brief,
      nextAction: pickString(config.objective, configuredObjective),
      supervisor: currentSupervisor,
      requireNextAction: false,
    });
    if (!gate.ok) {
      return blockDelegateSupervisor(resolved, laneId, currentSupervisor, gate, options);
    }
    return startDelegateFromSupervisor(resolved, laneId, {
      config,
      status,
      brief,
      nextAction: "",
      gate,
      currentSupervisor,
      mode: "start",
      options,
    });
  }

  const reasonByState = {
    paused: "Worker lane is paused; supervisor will not override the pause.",
    blocked: status.error || status.stopReason || "Worker lane is blocked.",
    failed: status.error || "Worker lane failed.",
  };
  return blockDelegateSupervisor(
    resolved,
    laneId,
    currentSupervisor,
    {
      ok: false,
      blocked: true,
      code: status.state || "lane_not_ready",
      reason: reasonByState[status.state] || `Worker lane state is ${status.state || "unknown"}.`,
      lastGateResult: {
        ok: false,
        gate: "lane_status",
        code: status.state || "lane_not_ready",
        reason: reasonByState[status.state] || `Worker lane state is ${status.state || "unknown"}.`,
      },
    },
    options,
  );
}

function printDelegateSupervisorResult(result) {
  const displayName = result.projectDetails?.displayName || result.projectDetails?.slug || result.project;
  if (result.action === "wait") {
    console.log(`supervisor waiting: ${displayName} lane ${result.laneId} is already running`);
    return;
  }
  if (result.action === "completed") {
    console.log(`supervisor stopped: ${displayName} lane ${result.laneId} has no nextAction`);
    return;
  }
  if (result.action === "blocked") {
    console.log(`supervisor blocked: ${result.error || "gate blocked continuation"}`);
    return;
  }
  if (result.action === "dry_run") {
    console.log(`supervisor dry run: ${displayName} lane ${result.laneId} would continue safely`);
    return;
  }
  if (result.started) {
    console.log(`supervisor ${result.action === "start" ? "started" : "restarted"} ${displayName} lane ${result.laneId}`);
    return;
  }
  console.log(`supervisor ${result.action || "checked"} ${displayName} lane ${result.laneId}`);
}

async function startDelegateSupervisorDaemon(resolved, laneId, options = {}) {
  const args = [
    serverModulePath,
    "supervise",
    resolved.projectPath,
    "--lane",
    laneId,
    "--interval",
    String(options.intervalSeconds),
  ];
  if (options.maxRuns) {
    args.push("--max-runs", String(options.maxRuns));
  }
  if (options.once) {
    args.push("--once");
  }
  if (options.dryRun) {
    args.push("--dry-run");
  }
  const startResult = await startDetached(process.execPath, args);
  if (!startResult.ok) {
    throw new Error(startResult.error?.message || "failed to start supervisor daemon");
  }
  const supervisor = await writeDelegateSupervisorState(resolved.projectPath, {
    enabled: true,
    state: "running",
    pid: startResult.pid || null,
    startedAt: new Date().toISOString(),
    intervalSeconds: options.intervalSeconds,
    maxRuns: options.maxRuns,
    lastAction: "daemon_started",
  }, laneId);
  await appendDelegateSupervisorEvent(resolved.projectPath, laneId, "supervisor_daemon_started", {
    action: "daemon_started",
    state: supervisor.state,
    restartCount: supervisor.restartCount,
    payload: {
      pid: startResult.pid || null,
    },
  }).catch(() => {});
  return {
    ok: true,
    action: "daemon",
    accepted: true,
    started: true,
    project: resolved.projectPath,
    laneId,
    projectDetails: resolved.projectDetails,
    supervisor: delegateSupervisorStateForPayload(supervisor),
  };
}

async function stopDelegateContinuitySupervisor(projectDetails, laneId = defaultDelegateLaneId, {
  pauseWorker = true,
  reason = "Supervisor stopped by user.",
} = {}) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  const currentSupervisor = await readDelegateSupervisorState(projectDetails.path, normalizedLaneId);
  const previousPid = currentSupervisor.pid || null;
  const stoppedAt = new Date().toISOString();

  const supervisor = await writeDelegateSupervisorState(projectDetails.path, {
    ...currentSupervisor,
    enabled: false,
    state: "stopped",
    pid: null,
    stoppedAt,
    lastAction: "stop_requested",
    lastBlockerReason: null,
    lastGateResult: {
      ok: true,
      gate: "user_control",
      code: "stop_requested",
      reason,
      checkedAt: stoppedAt,
    },
  }, normalizedLaneId);
  await appendDelegateSupervisorEvent(projectDetails.path, normalizedLaneId, "supervisor_stop_requested", {
    action: "stop",
    state: supervisor.state,
    reason,
    payload: {
      previousPid,
    },
  }).catch(() => {});

  if (previousPid && previousPid !== process.pid && processIsLive(previousPid)) {
    try {
      process.kill(previousPid, "SIGTERM");
    } catch (_error) {
      // The stored pid is best-effort; the persisted stopped state is the source of truth.
    }
  }

  const pauseResult = pauseWorker
    ? await pauseDelegateRun(projectDetails, normalizedLaneId)
    : null;

  return {
    accepted: true,
    supervisor,
    pauseResult,
  };
}

async function runDelegateSupervise(argv) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    printUsage();
    return;
  }

  const resolved = await resolveDelegateProjectForCli(rawOptions);
  const laneId = delegateCliLaneId(rawOptions);
  const intervalSeconds = Math.max(1, Number.parseInt(String(rawOptions.interval || "10"), 10) || 10);
  const maxRuns = normalizeOptionalPositiveInteger(rawOptions.maxRuns ?? null, { max: 10_000 });
  const options = {
    intervalSeconds,
    maxRuns,
    dryRun: Boolean(rawOptions.dryRun),
    once: Boolean(rawOptions.once),
    keepRunning: !(rawOptions.once || rawOptions.json || rawOptions.dryRun),
  };

  if (rawOptions.daemon) {
    const result = await startDelegateSupervisorDaemon(resolved, laneId, options);
    if (rawOptions.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`supervisor daemon started for ${resolved.projectDetails.displayName || resolved.projectDetails.slug || resolved.projectPath} lane ${laneId}`);
    }
    return;
  }

  let runsStarted = 0;
  let lastResult = null;
  for (;;) {
    if (lastResult && options.keepRunning) {
      const persistedSupervisor = await readDelegateSupervisorState(resolved.projectPath, laneId);
      if (!persistedSupervisor.enabled && persistedSupervisor.lastAction === "stop_requested") {
        lastResult = {
          ok: true,
          action: "stopped",
          accepted: true,
          started: false,
          project: resolved.projectPath,
          laneId,
          projectDetails: resolved.projectDetails,
          supervisor: delegateSupervisorStateForPayload(persistedSupervisor),
        };
        break;
      }
    }

    lastResult = await runDelegateSupervisorTick(resolved, laneId, options);
    if (lastResult.started) {
      runsStarted += 1;
    }

    const terminal = ["blocked", "completed", "dry_run"].includes(lastResult.action) || !lastResult.ok;
    const maxReached = maxRuns != null && runsStarted >= maxRuns;
    if (rawOptions.json || rawOptions.once || rawOptions.dryRun || terminal || maxReached) {
      if (maxReached && lastResult.supervisor) {
        const supervisor = await writeDelegateSupervisorState(resolved.projectPath, {
          ...lastResult.supervisor,
          enabled: false,
          state: "stopped",
          pid: null,
          stoppedAt: new Date().toISOString(),
          lastAction: "max_runs_reached",
          lastGateResult: {
            ok: true,
            gate: "max_runs",
            code: "max_runs_reached",
            reason: `Supervisor reached --max-runs ${maxRuns}.`,
          },
        }, laneId);
        lastResult = {
          ...lastResult,
          action: "max_runs_reached",
          supervisor: delegateSupervisorStateForPayload(supervisor),
        };
      }
      break;
    }

    printDelegateSupervisorResult(lastResult);
    await sleep(intervalSeconds * 1000);
  }

  if (rawOptions.json) {
    console.log(JSON.stringify(lastResult, null, 2));
  } else {
    printDelegateSupervisorResult(lastResult);
  }
  if (lastResult && !lastResult.ok) {
    process.exitCode = 1;
  }
}

async function runDelegateRun(argv) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    printUsage();
    return;
  }

  const resolved = await resolveDelegateProjectForCli(rawOptions);
  const laneId = delegateCliLaneId(rawOptions);
  const preflight = await runOrpDelegatePreflight(resolved.projectPath);
  if (!preflight.ok) {
    const result = delegatePreflightBlockedResult(resolved, preflight);
    if (rawOptions.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printDelegatePreflightBlocked(resolved, preflight);
    }
    process.exitCode = 1;
    return;
  }

  if (rawOptions.dryRun) {
    const payload = await buildDelegatePayload(resolved.projectDetails, laneId);
    const result = {
      ok: true,
      action: "dry_run",
      accepted: false,
      project: resolved.projectPath,
      laneId,
      projectDetails: resolved.projectDetails,
      ...payload,
      status: payload.status,
      orpPreflight: preflight,
    };
    if (rawOptions.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const displayName = resolved.projectDetails.displayName || resolved.projectDetails.slug || resolved.projectPath;
    console.log(`delegate dry run for ${displayName}`);
    return;
  }

  const startResult = await startDelegateRun(resolved.projectDetails, laneId);
  const payload = await buildDelegatePayload(resolved.projectDetails, laneId);
  const continuousCommand = delegateContinuousCommand(resolved.projectPath, laneId);
  const result = {
    ok: true,
    action: "start",
    accepted: startResult.accepted,
    project: resolved.projectPath,
    laneId,
    continuousCommand,
    projectDetails: resolved.projectDetails,
    ...payload,
    status: startResult.status || payload.status,
  };

  if (rawOptions.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printDelegateRunResult("start", resolved, { ...payload, continuousCommand }, result.status, startResult.accepted);
}

async function runDelegateSupervisor(argv) {
  const rawOptions = parseArgs(argv);
  const resolved = await resolveDelegateProjectForCli(rawOptions);
  const laneId = normalizeDelegateLaneId(rawOptions.lane);
  const jobKey = delegateJobKey(resolved.projectPath, laneId);
  const status = await readDelegateStatus(resolved.projectPath, { reconcile: false, laneId });
  const runId = pickString(rawOptions.runId, status.runId) || crypto.randomUUID();
  if (status.runId && status.runId !== runId) {
    return;
  }

  let config = await readDelegateConfig(resolved.projectPath, laneId);
  if (!config.enabled && status.state !== "running") {
    return;
  }

  const ensured = await ensureDelegateSession(resolved.projectDetails, config);
  config = ensured.config;
  const startedAt = status.startedAt || new Date().toISOString();
  delegateRunJobs.set(jobKey, {
    runId,
    startedAt,
    laneId,
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
      { resume: status.state === "running", laneId },
    );
    const activeJob = delegateRunJobs.get(jobKey);
    if (activeJob?.runId === runId) {
      activeJob.promise = promise;
    }
    await promise;
  } finally {
    const activeJob = delegateRunJobs.get(jobKey);
    if (activeJob?.runId === runId) {
      delegateRunJobs.delete(jobKey);
    }
  }
}

async function pauseDelegateRun(projectDetails, laneId = defaultDelegateLaneId) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  const jobKey = delegateJobKey(projectDetails.path, normalizedLaneId);
  const activeRunJob = delegateRunJobs.get(jobKey);
  if (activeRunJob) {
    activeRunJob.pauseRequested = true;
  }
  const currentConfig = await readDelegateConfig(projectDetails.path, normalizedLaneId);
  const nextConfig = await writeDelegateConfig(projectDetails.path, {
    ...currentConfig,
    enabled: false,
  }, normalizedLaneId);
  const currentStatus = await readDelegateStatus(projectDetails.path, { reconcile: false, laneId: normalizedLaneId });
  const pauseDecision = delegatePauseDecision({
    status: currentStatus,
    hasActiveRunJob: Boolean(activeRunJob),
    hasActivePlanJob: delegatePlanJobs.has(jobKey),
    supervisorLive: delegateSupervisorIsLive(currentStatus),
  });
  const nextStatus = await writeDelegateStatus(projectDetails.path, {
    ...currentStatus,
    laneId: normalizedLaneId,
    state: pauseDecision.state,
    activeRequestId: pauseDecision.waitForSafePoint ? currentStatus.activeRequestId : null,
    activeStep: pauseDecision.waitForSafePoint ? currentStatus.activeStep : null,
    lastRequestId: currentStatus.lastRequestId || (!pauseDecision.waitForSafePoint ? currentStatus.activeRequestId : null),
    pauseRequested: pauseDecision.pauseRequested,
    completedAt: pauseDecision.waitForSafePoint ? currentStatus.completedAt : new Date().toISOString(),
    codexGoal: delegateCodexGoalWithStatus(currentStatus.codexGoal, "paused"),
    error: "",
  }, normalizedLaneId);
  await appendDelegateRunEvent(projectDetails.path, nextStatus.runId, "pause_requested", {
    title: pauseDecision.waitForSafePoint ? "Pause requested" : "Delegate paused",
    text: pauseDecision.waitForSafePoint
      ? "Clawdad will pause the delegate after the current step returns."
      : currentStatus.state === "running"
        ? "No live delegate supervisor was attached, so Clawdad marked the stale run paused immediately."
        : "The delegate is paused.",
    state: nextStatus.state,
  }, normalizedLaneId).catch(() => {});

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
  const laneId = delegateCliLaneId(rawOptions);
  const pauseResult = await pauseDelegateRun(resolved.projectDetails, laneId);
  const payload = await buildDelegatePayload(resolved.projectDetails, laneId);
  const result = {
    ok: true,
    action: "pause",
    accepted: pauseResult.accepted,
    project: resolved.projectPath,
    laneId,
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
  const laneId = delegateCliLaneId(rawOptions);
  const savedBrief = await writeDelegateBrief(resolved.projectPath, "", resolved.projectDetails, laneId);
  const payload = await buildDelegatePayload(resolved.projectDetails, laneId);
  const result = {
    ok: true,
    project: resolved.projectPath,
    laneId,
    brief: savedBrief,
    ...payload,
  };

  if (rawOptions.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`reset delegate brief for ${resolved.projectDetails.displayName || resolved.projectDetails.slug}`);
}

async function resolveWatchtowerProjectForCli(projectInput) {
  const input = pickString(projectInput);
  if (!input) {
    throw new Error("missing project");
  }
  const resolved = await resolveProjectForDelegate(input, "");
  if (!resolved.projectPath || !resolved.projectDetails) {
    throw new Error(`project '${input}' is not tracked`);
  }
  return resolved;
}

function watchtowerStatusRank(status) {
  return {
    hard_stop: 5,
    pause_recommended: 4,
    needs_review: 3,
    watch: 2,
    info: 1,
  }[normalizeWatchtowerReviewStatus(status)] || 0;
}

function watchtowerEventLine(event) {
  const pieces = [
    `[${event.reviewStatus}]`,
    event.at || "unknown time",
    event.runId ? `run ${event.runId}` : "",
    event.activeOrpItem ? `orp ${event.activeOrpItem}` : "",
  ].filter(Boolean);
  const body = pickString(event.workerSummary, event.body, event.currentDecision);
  return [
    `${pieces.join(" | ")}\n${event.title || event.eventType || "Watchtower event"}`,
    body ? `  ${body.split(/\r?\n/u).slice(0, 3).join("\n  ")}` : "",
    event.riskFlags.length > 0 ? `  risks: ${event.riskFlags.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

function watchtowerCardLine(card) {
  const pieces = [
    `[${card.reviewStatus}]`,
    card.at || "unknown time",
    card.trigger ? `trigger ${card.trigger}` : "",
    card.runId ? `run ${card.runId}` : "",
  ].filter(Boolean);
  return [
    `${pieces.join(" | ")}\n${card.title}`,
    card.summary ? `  ${card.summary.split(/\r?\n/u).slice(0, 4).join("\n  ")}` : "",
    card.riskFlags.length > 0 ? `  risks: ${card.riskFlags.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

function printWatchtowerEvents(events = []) {
  if (events.length === 0) {
    console.log("No Watchtower feed events yet.");
    return;
  }
  console.log(events.map(watchtowerEventLine).join("\n\n"));
}

function printWatchtowerCards(cards = []) {
  if (cards.length === 0) {
    console.log("No Watchtower review cards yet.");
    return;
  }
  console.log(cards.map(watchtowerCardLine).join("\n\n"));
}

function currentWatchtowerReviewCards(cards = [], scan = {}, { step = null } = {}) {
  const currentRunId = pickString(scan.runId);
  const currentStep = Number.parseInt(String(step || "0"), 10) || null;
  return cards.filter((card) => {
    const cardRunId = pickString(card.runId);
    if (cardRunId && currentRunId && cardRunId !== currentRunId) {
      return false;
    }
    const sourceType = pickString(card.payload?.sourceType);
    const sourceEventStep = Number.parseInt(String(card.payload?.sourceEventStep || "0"), 10) || null;
    if (currentStep && sourceType === "delegate_event") {
      return sourceEventStep ? sourceEventStep === currentStep : false;
    }
    return true;
  });
}

async function runWatchtower(argv) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    printUsage();
    return;
  }
  const projectInput = pickString(rawOptions.project, rawOptions._[0]);
  const resolved = await resolveWatchtowerProjectForCli(projectInput);
  const laneId = delegateCliLaneId(rawOptions);
  const intervalSeconds = Math.max(1, Number.parseInt(String(rawOptions.interval || "5"), 10) || 5);

  const scanOnce = async () => {
    const scan = await runWatchtowerScan(resolved.projectPath, laneId);
    const allCards = await readWatchtowerReviewCards(resolved.projectPath, { limit: 80, laneId });
    const cards = currentWatchtowerReviewCards(allCards, scan).slice(0, 12);
    const topStatus = cards.reduce(
      (status, card) =>
        watchtowerStatusRank(card.reviewStatus) > watchtowerStatusRank(status)
          ? card.reviewStatus
          : status,
      "info",
    );
    return {
      ok: true,
      project: resolved.projectPath,
      laneId,
      projectDetails: resolved.projectDetails,
      topStatus,
      scan,
      reviewCards: cards,
      historicalReviewCardCount: Math.max(0, allCards.length - cards.length),
    };
  };

  if (rawOptions.once || rawOptions.json) {
    const payload = await scanOnce();
    if (rawOptions.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(
        `Watchtower indexed ${payload.scan.indexedEvents} update(s); ${payload.reviewCards.length} current review card(s).`,
      );
      if (payload.historicalReviewCardCount > 0) {
        console.log(`${payload.historicalReviewCardCount} historical review card(s) hidden from this current-state view.`);
      }
      printWatchtowerCards(payload.reviewCards);
    }
    return;
  }

  console.log(`Watchtower observing ${resolved.projectDetails.displayName || resolved.projectDetails.slug || resolved.projectPath}`);
  console.log(`Feed database: ${watchtowerPaths(resolved.projectPath).dbFile}`);
  for (;;) {
    const payload = await scanOnce();
    const top = payload.reviewCards[0];
    const suffix = top ? ` top: [${top.reviewStatus}] ${top.title}` : " no review cards";
    console.log(`[${new Date().toISOString()}] indexed ${payload.scan.indexedEvents};${suffix}`);
    await sleep(intervalSeconds * 1000);
  }
}

async function runFeed(argv) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    printUsage();
    return;
  }
  const [modeInput, projectInput, ...rest] = rawOptions._;
  const mode = pickString(modeInput).toLowerCase();
  if (!["tail", "search", "review"].includes(mode)) {
    throw new Error("Usage: clawdad feed <tail|search|review> <project> [query]");
  }
  const resolved = await resolveWatchtowerProjectForCli(projectInput);
  const laneId = delegateCliLaneId(rawOptions);
  const limit = watchtowerLimit(rawOptions.limit, mode === "review" ? 30 : 40);
  const scan = await runWatchtowerScan(resolved.projectPath, laneId);

  if (mode === "review") {
    const cards = await readWatchtowerReviewCards(resolved.projectPath, { limit, laneId });
    if (rawOptions.json) {
      console.log(JSON.stringify({
        ok: true,
        mode,
        project: resolved.projectPath,
        laneId,
        projectDetails: resolved.projectDetails,
        scan,
        cards,
      }, null, 2));
    } else {
      printWatchtowerCards(cards);
    }
    return;
  }

  if (mode === "search") {
    const query = rest.join(" ").trim();
    if (!query) {
      throw new Error("missing search query");
    }
    const events = await searchWatchtowerFeed(resolved.projectPath, query, { limit, laneId });
    if (rawOptions.json) {
      console.log(JSON.stringify({
        ok: true,
        mode,
        query,
        project: resolved.projectPath,
        projectDetails: resolved.projectDetails,
        scan,
        events,
      }, null, 2));
    } else {
      printWatchtowerEvents(events);
    }
    return;
  }

  const events = await readWatchtowerTail(resolved.projectPath, { limit, laneId });
  if (rawOptions.json) {
    console.log(JSON.stringify({
      ok: true,
      mode,
      project: resolved.projectPath,
      projectDetails: resolved.projectDetails,
      scan,
      events,
    }, null, 2));
  } else {
    printWatchtowerEvents(events);
  }
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

function sessionProviderSessionSeeded(session = {}) {
  if (typeof session?.providerSessionSeeded === "boolean") {
    return session.providerSessionSeeded;
  }
  return pickString(session?.provider_session_seeded, "true") === "true";
}

async function validateDispatchSessionBinding(projectPath, session = {}) {
  const provider = pickString(session?.provider, "codex").toLowerCase();
  const sessionId = pickString(session?.sessionId, session?.resumeSessionId);
  if (!sessionId) {
    return {
      ok: false,
      statusCode: 400,
      message: "selected session has no provider session id",
    };
  }
  if (!activeProviders.has(provider)) {
    return {
      ok: false,
      statusCode: 400,
      message: `unsupported provider '${provider || "(missing)"}' for ${sessionDisplayForStatus(session)}`,
    };
  }

  if (provider !== "codex" || !sessionProviderSessionSeeded(session)) {
    return { ok: true };
  }

  const binding = await validateCodexSessionProjectBinding(projectPath, sessionId);
  if (binding.ok) {
    return { ok: true };
  }

  return {
    ok: false,
    statusCode: 409,
    reason: binding.reason,
    message:
      `${binding.message} Select or import a Codex session saved from this project, ` +
      "or run `clawdad sessions-doctor --repair` to quarantine stale bindings.",
  };
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

async function readMailboxStatus(projectPath, laneId = null) {
  const { statusFile } = mailboxPaths(projectPath, laneId);
  try {
    return await reconcileMailboxStatus(projectPath, JSON.parse(await readFile(statusFile, "utf8")), laneId);
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

async function readMailboxResponse(projectPath, laneId = null) {
  const { responseFile } = mailboxPaths(projectPath, laneId);
  try {
    return await readFile(responseFile, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function readMailboxResponseForStatus(projectPath, status = {}, laneId = null) {
  const markdown = await readMailboxResponse(projectPath, laneId);
  if (laneId) {
    return markdown;
  }

  const state = pickString(status.state).toLowerCase();
  if (state !== "completed") {
    return markdown;
  }

  const body = responseBodyFromMailbox(markdown);
  if (body && !mailboxResponseLooksLikeStaleFailure(markdown)) {
    return markdown;
  }

  const answeredHistory = await readAnsweredHistoryForMailboxStatus(projectPath, status);
  if (!answeredHistory) {
    return markdown;
  }

  await writeCompletedMailboxFromHistory(projectPath, status, answeredHistory, laneId).catch(() => {});
  return mailboxResponseMarkdown({
    requestId: answeredHistory.requestId,
    sessionId: answeredHistory.sessionId,
    exitCode: typeof answeredHistory.exitCode === "number" ? answeredHistory.exitCode : 0,
    completedAt: answeredHistory.answeredAt || new Date().toISOString(),
    content: answeredHistory.response || "",
  });
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

function describeMsAsMinutes(ms) {
  return Math.max(1, Math.round((Number(ms) || 0) / 60_000));
}

async function evaluateDelegateDispatchStall(projectPath, mailboxStatus = {}, {
  runId = "",
  laneId = defaultDelegateLaneId,
  step = null,
} = {}) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId || defaultDelegateLaneId);
  const delegateStatus = await readDelegateStatus(projectPath, {
    reconcile: false,
    laneId: normalizedLaneId,
  }).catch(() => ({}));
  const safeRunId = safeDelegateRunId(runId || delegateStatus?.runId || "");
  const page = safeRunId
    ? await readDelegateRunEvents(projectPath, {
        runId: safeRunId,
        cursor: "tail",
        limit: 200,
        laneId: normalizedLaneId,
      }).catch(() => ({ events: [] }))
    : { events: [] };
  const codexEvents = safeRunId
    ? await readDelegateCodexEventTail(projectPath, safeRunId, normalizedLaneId, 200).catch(() => [])
    : [];
  const activeStep = Number.parseInt(String(step || delegateStatus?.activeStep || "0"), 10);
  return delegateDispatchStallDecision({
    mailboxStatus,
    delegateStatus: {
      ...delegateStatus,
      activeStep: Number.isFinite(activeStep) && activeStep > 0 ? activeStep : delegateStatus?.activeStep,
    },
    events: [...page.events, ...codexEvents],
    staleTimeoutMs: delegateDispatchStallTimeoutMs,
    pauseStaleTimeoutMs: delegateDispatchPauseStallTimeoutMs,
  });
}

async function waitForMailboxCompletion(projectPath, timeoutMs = null, previousRequestId = "", laneId = null, {
  stallGuard = null,
} = {}) {
  const startedAt = Date.now();
  const normalizedLaneId = laneId ? normalizeDelegateLaneId(laneId) : null;
  let lastMirroredCodexGoalAt = "";

  while (true) {
    const status = await readMailboxStatus(projectPath, normalizedLaneId);
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

    if (requestId && stallGuard?.runId) {
      const effectiveLaneId = normalizedLaneId || stallGuard.laneId || defaultDelegateLaneId;
      const codexGoal = await readDelegateCodexGoalFromRunEvents(projectPath, stallGuard.runId, effectiveLaneId).catch(() => null);
      if (codexGoal?.updatedAt && codexGoal.updatedAt !== lastMirroredCodexGoalAt) {
        lastMirroredCodexGoalAt = codexGoal.updatedAt;
        const delegateStatus = await readDelegateStatus(projectPath, {
          reconcile: false,
          laneId: effectiveLaneId,
        }).catch(() => null);
        if (delegateStatus) {
          await writeDelegateStatus(projectPath, {
            ...delegateStatus,
            codexGoal,
          }, effectiveLaneId).catch(() => {});
        }
      }

      const recoveredCodexResponse = await recoverDelegateDecisionFromCodexEvents(projectPath, {
        runId: stallGuard.runId,
        laneId: effectiveLaneId,
      }).catch(() => null);
      if (recoveredCodexResponse) {
        await appendDelegateRunEvent(projectPath, stallGuard.runId, "agent_response_recovered", {
          title: "Recovered agent response",
          step: stallGuard.step,
          requestId,
          text: "Recovered a valid delegate JSON decision from Codex app-server events after the mailbox stayed running.",
          payload: {
            source: recoveredCodexResponse.source || "codex_events",
            sourceEventAt: recoveredCodexResponse.event?.at || null,
            sourceEventType: recoveredCodexResponse.event?.type || null,
          },
        }, effectiveLaneId).catch(() => {});
        return writeCompletedMailboxFromRecoveredResponse(
          projectPath,
          status,
          recoveredCodexResponse,
          effectiveLaneId,
        );
      }

      const stall = await evaluateDelegateDispatchStall(projectPath, status, {
        ...stallGuard,
        laneId: effectiveLaneId,
      });
      if (stall.stalled) {
        const ageMinutes = describeMsAsMinutes(stall.ageMs);
        const limitMinutes = describeMsAsMinutes(stall.timeoutMs);
        const reason = stall.pauseRequested
          ? `Delegate dispatch has made no live progress for about ${ageMinutes} minutes after pause was requested, beyond the ${limitMinutes} minute safety limit.`
          : `Delegate dispatch has made no live progress for about ${ageMinutes} minutes, beyond the ${limitMinutes} minute safety limit.`;
        await appendDelegateRunEvent(projectPath, stallGuard.runId, "dispatch_stale_failed", {
          title: "Delegate dispatch stalled",
          text: reason,
          requestId,
          state: "failed",
          error: reason,
          payload: {
            ageMs: stall.ageMs,
            timeoutMs: stall.timeoutMs,
            progressAt: stall.progressAt,
            progressSource: stall.progressSource,
            progressType: stall.progressType,
            pauseRequested: stall.pauseRequested,
          },
        }, effectiveLaneId).catch(() => {});
        return await repairStaleMailboxStatus(projectPath, status, reason, effectiveLaneId);
      }
    }

    if (typeof timeoutMs === "number" && timeoutMs >= 0 && Date.now() - startedAt >= timeoutMs) {
      return { state: "timeout" };
    }

    await sleep(1000);
  }
}

async function waitForMailboxRequestStart(
  projectPath,
  previousRequestId = "",
  timeoutMs = 3000,
  laneId = null,
  { workerPid = null } = {},
) {
  const startedAt = Date.now();

  while (true) {
    const status = await readMailboxStatus(projectPath, laneId);
    const requestId = String(status.request_id || "").trim();
    if (requestId && requestId !== previousRequestId) {
      return status;
    }

    if (workerPid && !processIsLive(workerPid)) {
      return {
        ...status,
        workerExitedBeforeRequest: true,
      };
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
    const cacheHasBusyStatus = projectCatalogHasBusyStatus(projectCatalogCache.value);
    if (
      !cacheHasBusyStatus &&
      (allowStale || now - projectCatalogCache.loadedAt < projectCatalogCacheTtlMs)
    ) {
      return projectCatalogCache.value;
    }
  }

  const stateProjects = await readProjectStateProjects();
  const localProjects = await projectCatalogFromStateProjects(stateProjects);

  if (projectCatalogCache.promise) {
    if (
      allowStale &&
      projectCatalogCache.value &&
      !projectCatalogHasBusyStatus(projectCatalogCache.value)
    ) {
      return mergeProjectCatalogs(projectCatalogCache.value, localProjects);
    }
    if (localProjects.length > 0) {
      return localProjects;
    }
    return projectCatalogCache.promise;
  }

  if (localProjects.length > 0) {
    const cacheHasBusyStatus = projectCatalogHasBusyStatus(projectCatalogCache.value);
    const projects = allowStale && projectCatalogCache.value && !cacheHasBusyStatus
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
      if (
        allowStale &&
        projectCatalogCache.value &&
        !projectCatalogHasBusyStatus(projectCatalogCache.value)
      ) {
        console.warn(`[clawdad-server] keeping stale project catalog after refresh failed: ${reason}`);
        return projectCatalogCache.value;
      }
      throw error;
    })
    .finally(() => {
      projectCatalogCache.promise = null;
    });

  if (
    allowStale &&
    projectCatalogCache.value &&
    !projectCatalogHasBusyStatus(projectCatalogCache.value)
  ) {
    return projectCatalogCache.value;
  }

  return projectCatalogCache.promise;
}

function invalidateProjectCatalogCache() {
  projectCatalogCache.value = null;
  projectCatalogCache.loadedAt = 0;
  projectCatalogCache.promise = null;
}

const sessionDoctorBusyStates = new Set(["running", "queued", "dispatched", "dispatching", "starting", "planning"]);
const sessionDoctorTerminalStates = new Set(["idle", "paused", "blocked", "completed", "failed"]);

function sessionDoctorState(value) {
  return pickString(value).toLowerCase();
}

function sessionDoctorBusy(value) {
  return sessionDoctorBusyStates.has(sessionDoctorState(value));
}

function sessionDoctorTerminal(value) {
  return sessionDoctorTerminalStates.has(sessionDoctorState(value));
}

async function readSessionDoctorStatePayload() {
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
  return statePayload;
}

async function updateSessionDoctorStateProject(projectPath, updater) {
  return withStateLock(async () => {
    const statePayload = await readSessionDoctorStatePayload();
    const currentProject =
      statePayload.projects[projectPath] && typeof statePayload.projects[projectPath] === "object"
        ? statePayload.projects[projectPath]
        : {};
    statePayload.projects[projectPath] = updater(currentProject) || currentProject;
    await writeJsonFile(stateFilePath, statePayload);
    return statePayload.projects[projectPath];
  });
}

async function resetSessionDoctorFailedMailbox(projectPath, sessionId) {
  const { statusFile } = mailboxPaths(projectPath);
  const status = (await readOptionalJson(statusFile).catch(() => null)) || {};
  if (!status || typeof status !== "object") {
    return false;
  }

  const statusSessionId = pickString(status.session_id, status.sessionId);
  if (
    sessionDoctorState(status.state) !== "failed" ||
    (sessionId && statusSessionId && statusSessionId !== sessionId)
  ) {
    return false;
  }

  await writeJsonFile(statusFile, {
    ...status,
    state: "idle",
    request_id: null,
    session_id: statusSessionId || sessionId || null,
    dispatched_at: null,
    completed_at: null,
    heartbeat_at: null,
    error: null,
    pid: null,
  });
  return true;
}

function sessionDoctorFallbackSessionId(projectState = {}, skippedSessionId = "", { skipFailed = false } = {}) {
  const quarantined = projectQuarantinedSessionIds(projectState);
  const sessions = projectState.sessions && typeof projectState.sessions === "object" ? projectState.sessions : {};
  for (const [sessionId, sessionState] of Object.entries(sessions)) {
    const status = sessionDoctorState(sessionState?.status || "idle") || "idle";
    if (
      sessionId &&
      sessionId !== skippedSessionId &&
      !quarantined.has(sessionId) &&
      pickString(sessionState?.quarantined).toLowerCase() !== "true" &&
      (!skipFailed || status !== "failed")
    ) {
      return sessionId;
    }
  }
  return "";
}

async function quarantineSessionDoctorSession(projectPath, sessionId, reason, detail = "") {
  const now = new Date().toISOString();
  return updateSessionDoctorStateProject(projectPath, (currentProject) => {
    const currentSessions =
      currentProject.sessions && typeof currentProject.sessions === "object"
        ? currentProject.sessions
        : {};
    const currentQuarantined =
      currentProject.quarantined_sessions && typeof currentProject.quarantined_sessions === "object"
        ? currentProject.quarantined_sessions
        : {};
    const currentSession =
      currentSessions[sessionId] && typeof currentSessions[sessionId] === "object"
        ? currentSessions[sessionId]
        : {};
    const nextSessions = {
      ...currentSessions,
      [sessionId]: {
        ...currentSession,
        status: "failed",
        quarantined: "true",
        quarantine_reason: reason,
        quarantine_detail: detail,
        quarantined_at: now,
      },
    };
    const nextProject = {
      ...currentProject,
      sessions: nextSessions,
      quarantined_sessions: {
        ...currentQuarantined,
        [sessionId]: {
          ...currentSession,
          status: "failed",
          reason,
          detail,
          quarantined_at: now,
        },
      },
    };

    if (pickString(currentProject.active_session_id) === sessionId) {
      nextProject.active_session_id = sessionDoctorFallbackSessionId(nextProject, sessionId);
    }

    return nextProject;
  });
}

async function sessionDoctorProjectPaths(selector = "", stateProjects = {}) {
  const normalizedSelector = pickString(selector);
  const paths = new Set(Object.keys(stateProjects || {}).filter(Boolean));
  if (!normalizedSelector) {
    const catalog = await loadProjectCatalogCached({ allowStale: true }).catch(() => []);
    for (const project of catalog) {
      if (project?.path) {
        paths.add(project.path);
      }
    }
    return [...paths].sort((left, right) => left.localeCompare(right));
  }

  const directMatches = [...paths].filter((projectPath) => {
    const tail = basenameOrFallback(projectPath);
    return (
      projectPath === normalizedSelector ||
      tail === normalizedSelector ||
      path.resolve(normalizedSelector) === projectPath
    );
  });
  if (directMatches.length > 0) {
    return directMatches;
  }

  const catalog = await loadProjectCatalogCached({ allowStale: true }).catch(() => []);
  const catalogMatch = catalog.find((project) => projectMatchesInput(project, normalizedSelector));
  return catalogMatch?.path ? [catalogMatch.path] : [];
}

async function repairDoctorDelegateStatus(projectPath, laneId, status, patch) {
  const nextStatus = await writeDelegateStatus(projectPath, {
    ...status,
    ...patch,
    laneId,
    updatedAt: new Date().toISOString(),
  }, laneId);
  invalidateProjectCatalogCache();
  return nextStatus;
}

async function inspectSessionDoctorProject(projectPath, stateProjects = {}, { repair = false } = {}) {
  const stateEntry = stateProjects?.[projectPath] || {};
  const sessions = stateEntry.sessions && typeof stateEntry.sessions === "object" ? stateEntry.sessions : {};
  const quarantinedIds = projectQuarantinedSessionIds(stateEntry);
  const projectReport = {
    projectPath,
    exists: false,
    issues: [],
    repairs: [],
    sessions: [],
    lanes: [],
    quarantinedSessions: [...quarantinedIds],
  };

  const addIssue = (type, message, details = {}) => {
    const issue = {
      type,
      message,
      resolved: false,
      ...details,
    };
    projectReport.issues.push(issue);
    return issue;
  };
  const addRepair = (type, message, details = {}) => {
    projectReport.repairs.push({
      type,
      message,
      ...details,
    });
  };
  const markResolved = (issue) => {
    if (issue) {
      issue.resolved = true;
    }
  };
  const updateReportedSession = (sessionId, patch = {}) => {
    const reportedSession = projectReport.sessions.find((session) => session.sessionId === sessionId);
    if (reportedSession) {
      Object.assign(reportedSession, patch);
    }
  };

  try {
    projectReport.exists = (await stat(projectPath)).isDirectory();
  } catch (error) {
    if (error.code !== "ENOENT") {
      addIssue("project_inaccessible", error.message);
    } else {
      addIssue("project_missing", `Tracked project path no longer exists: ${projectPath}`);
    }
    return projectReport;
  }

  const activeSessionId = pickString(stateEntry.active_session_id);
  if (activeSessionId && stateSessionIsQuarantined(stateEntry, activeSessionId, sessions[activeSessionId])) {
    const issue = addIssue(
      "active_session_quarantined",
      `Active session ${activeSessionId} is quarantined and should not be selected.`,
      { sessionId: activeSessionId },
    );
    if (repair) {
      const nextActive = sessionDoctorFallbackSessionId(stateEntry, activeSessionId);
      await updateSessionDoctorStateProject(projectPath, (currentProject) => ({
        ...currentProject,
        active_session_id: nextActive,
      }));
      addRepair(
        "active_session_retargeted",
        nextActive ? `Retargeted active session to ${nextActive}.` : "Cleared active session selection.",
        { sessionId: activeSessionId, nextActiveSessionId: nextActive || null },
      );
      markResolved(issue);
    }
  }

  const rootMailboxStatus = await readMailboxStatus(projectPath).catch(() => ({}));
  const rootMailboxSessionId = pickString(rootMailboxStatus.session_id, rootMailboxStatus.sessionId);
  const rootMailboxState = sessionDoctorState(rootMailboxStatus.state);

  for (const [sessionId, sessionState] of Object.entries(sessions)) {
    const status = sessionDoctorState(sessionState?.status || "idle") || "idle";
    const quarantined = stateSessionIsQuarantined(stateEntry, sessionId, sessionState);
    projectReport.sessions.push({
      sessionId,
      slug: pickString(sessionState?.slug) || null,
      status,
      active: sessionId === activeSessionId,
      quarantined,
    });

    if (quarantined) {
      continue;
    }

    const provider = pickString(sessionState?.provider).toLowerCase();
    if (!provider) {
      const issue = addIssue(
        "session_provider_missing",
        `Session ${sessionId} has no provider metadata, so Clawdad cannot safely dispatch it.`,
        { sessionId },
      );
      if (repair) {
        const detail = "Session state is missing provider metadata.";
        await quarantineSessionDoctorSession(projectPath, sessionId, "missing_session_provider", detail);
        addRepair(
          "session_quarantined",
          `Quarantined ${sessionId} because its provider metadata is missing.`,
          { sessionId, reason: "missing_session_provider" },
        );
        markResolved(issue);
      }
      continue;
    }

    if (!activeProviders.has(provider)) {
      const issue = addIssue(
        "session_provider_unsupported",
        `Session ${sessionId} uses unsupported provider '${provider}'.`,
        { sessionId, provider },
      );
      if (repair) {
        const detail = `Unsupported provider: ${provider}`;
        await quarantineSessionDoctorSession(projectPath, sessionId, "unsupported_session_provider", detail);
        addRepair(
          "session_quarantined",
          `Quarantined ${sessionId} because provider '${provider}' is unsupported.`,
          { sessionId, provider, reason: "unsupported_session_provider" },
        );
        markResolved(issue);
      }
      continue;
    }

    const providerSeeded = pickString(sessionState?.provider_session_seeded, "true") === "true";
    if (provider === "codex" && providerSeeded) {
      const binding = await validateCodexSessionProjectBinding(projectPath, sessionId);
      if (!binding.ok) {
        const issue = addIssue(
          "codex_session_unbound",
          binding.message,
          {
            sessionId,
            reason: binding.reason,
            cwd: binding.cwd || null,
          },
        );
        if (repair) {
          await quarantineSessionDoctorSession(
            projectPath,
            sessionId,
            "codex_session_not_found_for_project",
            binding.message,
          );
          addRepair(
            "session_quarantined",
            `Quarantined ${sessionId} because it is not a saved Codex session for this project.`,
            { sessionId, reason: binding.reason },
          );
          markResolved(issue);
        }
        continue;
      }
    }

    if (sessionId === activeSessionId && status === "failed") {
      const issue = addIssue(
        "active_session_failed",
        `Active session ${sessionId} is marked failed from its last turn, but the provider session binding is valid.`,
        { sessionId, status },
      );
      if (repair) {
        const completedAt = pickString(rootMailboxStatus.completed_at, rootMailboxStatus.completedAt) || new Date().toISOString();
        const mailboxReset = await resetSessionDoctorFailedMailbox(projectPath, sessionId);
        await updateSessionDoctorStateProject(projectPath, (currentProject) => {
          const currentSessions =
            currentProject.sessions && typeof currentProject.sessions === "object"
              ? currentProject.sessions
              : {};
          const currentSession =
            currentSessions[sessionId] && typeof currentSessions[sessionId] === "object"
              ? currentSessions[sessionId]
              : {};
          return {
            ...currentProject,
            status: rootMailboxSessionId === sessionId && rootMailboxState === "failed"
              ? "idle"
              : pickString(currentProject.status, "idle"),
            last_response: completedAt,
            sessions: {
              ...currentSessions,
              [sessionId]: {
                ...currentSession,
                status: "idle",
                last_response: completedAt,
              },
            },
          };
        });
        addRepair(
          "active_failed_session_reset",
          mailboxReset
            ? `Reset active session ${sessionId} and current mailbox to idle after preserving the failed turn in history.`
            : `Reset active session ${sessionId} to idle after preserving the failed turn in mailbox/history.`,
          { sessionId },
        );
        updateReportedSession(sessionId, { status: "idle" });
        markResolved(issue);
        invalidateProjectCatalogCache();
      }
    }

    if (
      sessionId === activeSessionId &&
      status !== "failed" &&
      rootMailboxState === "failed" &&
      (!rootMailboxSessionId || rootMailboxSessionId === sessionId)
    ) {
      const issue = addIssue(
        "stale_failed_mailbox",
        `Current mailbox is still marked failed for active session ${sessionId}, but the registry session is ${status}.`,
        { sessionId, status, mailboxState: rootMailboxState },
      );
      if (repair) {
        const mailboxReset = await resetSessionDoctorFailedMailbox(projectPath, sessionId);
        if (mailboxReset) {
          addRepair(
            "stale_failed_mailbox_reset",
            `Reset current mailbox for active session ${sessionId} to idle after preserving the failed turn in history.`,
            { sessionId },
          );
          markResolved(issue);
          invalidateProjectCatalogCache();
        }
      }
    }

    if (sessionDoctorBusy(status)) {
      const issue = addIssue(
        "busy_session_status",
        `Session ${sessionId} is still marked ${status}.`,
        { sessionId, status },
      );
      if (
        repair &&
        rootMailboxSessionId === sessionId &&
        (rootMailboxState === "completed" || rootMailboxState === "failed")
      ) {
        await updateSessionDoctorStateProject(projectPath, (currentProject) => {
          const currentSessions =
            currentProject.sessions && typeof currentProject.sessions === "object"
              ? currentProject.sessions
              : {};
          const currentSession =
            currentSessions[sessionId] && typeof currentSessions[sessionId] === "object"
              ? currentSessions[sessionId]
              : {};
          const completedAt = pickString(rootMailboxStatus.completed_at, rootMailboxStatus.completedAt) || new Date().toISOString();
          return {
            ...currentProject,
            status: rootMailboxState,
            last_response: completedAt,
            sessions: {
              ...currentSessions,
              [sessionId]: {
                ...currentSession,
                status: rootMailboxState,
                last_response: completedAt,
              },
            },
          };
        });
        addRepair(
          "busy_session_status_synced",
          `Synced session ${sessionId} to terminal mailbox state ${rootMailboxState}.`,
          { sessionId, state: rootMailboxState },
        );
        markResolved(issue);
      }
    }
  }

  const laneIds = await laneIdsForProject(projectPath).catch(() => [defaultDelegateLaneId]);
  for (const laneId of laneIds) {
    const paths = delegatePaths(projectPath, laneId);
    const rawStatus = (await readOptionalJson(paths.statusFile).catch(() => null)) || {};
    const status = normalizeDelegateStatus({
      ...rawStatus,
      projectPath,
      laneId,
    });
    const config = await readDelegateConfig(projectPath, laneId).catch(() => normalizeDelegateConfig({ projectPath, laneId }));
    const mailboxStatus = await readMailboxStatus(projectPath, laneId).catch(() => ({}));
    const rawActiveRequestId = pickString(rawStatus.activeRequestId, rawStatus.active_request_id);
    const rawActiveStep = Number.parseInt(String(rawStatus.activeStep ?? rawStatus.active_step ?? ""), 10);
    const mailboxState = sessionDoctorState(mailboxStatus.state);
    const supervisorLive = delegateSupervisorIsLive(status);
    const laneReport = {
      laneId,
      state: status.state,
      enabled: config.enabled,
      supervisorPid: status.supervisorPid || null,
      supervisorLive,
      activeRequestId: rawActiveRequestId || null,
      mailboxState: mailboxState || "idle",
      codexGoal: status.codexGoal || null,
    };
    projectReport.lanes.push(laneReport);

    if (sessionDoctorTerminal(status.state) && status.codexGoal?.status === "active") {
      const terminalGoalStatus =
        status.state === "completed"
          ? "complete"
          : status.stopReason === "compute_limit"
            ? "budgetLimited"
            : "paused";
      const issue = addIssue(
        "stale_codex_goal_active",
        `Lane ${laneId} is ${status.state} but its mirrored Codex goal is still active.`,
        { laneId, runId: status.runId || null, goalStatus: status.codexGoal.status },
      );
      if (repair) {
        await repairDoctorDelegateStatus(projectPath, laneId, status, {
          codexGoal: delegateCodexGoalWithStatus(status.codexGoal, terminalGoalStatus, {
            error: status.error || "",
          }),
        });
        addRepair(
          "stale_codex_goal_mirror_repaired",
          `Updated ${laneId} mirrored Codex goal to ${terminalGoalStatus}.`,
          { laneId, goalStatus: terminalGoalStatus },
        );
        markResolved(issue);
      }
    }

    if (sessionDoctorTerminal(status.state) && (rawActiveRequestId || (Number.isFinite(rawActiveStep) && rawActiveStep > 0))) {
      const issue = addIssue(
        "terminal_lane_has_active_request",
        `Lane ${laneId} is ${status.state} but still has an active delegate request pointer.`,
        { laneId, activeRequestId: rawActiveRequestId || null, activeStep: Number.isFinite(rawActiveStep) ? rawActiveStep : null },
      );
      if (repair) {
        await repairDoctorDelegateStatus(projectPath, laneId, status, {
          activeRequestId: null,
          activeStep: null,
          lastRequestId: status.lastRequestId || rawActiveRequestId || null,
        });
        addRepair(
          "terminal_lane_active_request_cleared",
          `Cleared stale active request pointer for ${laneId}.`,
          { laneId, activeRequestId: rawActiveRequestId || null },
        );
        markResolved(issue);
      }
    }

    if (config.delegateSessionId && stateSessionIsQuarantined(stateEntry, config.delegateSessionId, sessions[config.delegateSessionId])) {
      const issue = addIssue(
        "delegate_config_quarantined_session",
        `Lane ${laneId} points at quarantined delegate session ${config.delegateSessionId}.`,
        { laneId, sessionId: config.delegateSessionId },
      );
      if (repair) {
        await writeDelegateConfig(projectPath, {
          ...config,
          enabled: false,
          delegateSessionId: null,
        }, laneId);
        addRepair(
          "delegate_config_quarantined_session_cleared",
          `Disabled ${laneId} and cleared its quarantined delegate session binding.`,
          { laneId, sessionId: config.delegateSessionId },
        );
        markResolved(issue);
      }
    }

    if (["starting", "dispatching", "running"].includes(status.state) && !supervisorLive) {
      const issue = addIssue(
        "delegate_supervisor_not_live",
        `Lane ${laneId} is running but its supervisor process is not live.`,
        { laneId, supervisorPid: status.supervisorPid || null },
      );
      const mailboxBusy = mailboxState === "running" || mailboxState === "dispatched";
      let stalled = null;
      if (mailboxBusy) {
        stalled = await evaluateDelegateDispatchStall(projectPath, mailboxStatus, {
          runId: status.runId,
          laneId,
          step: status.activeStep,
        }).catch(() => null);
      }
      if (mailboxBusy && stalled?.stalled) {
        const staleIssue = addIssue(
          "delegate_dispatch_stalled",
          `Lane ${laneId} delegate dispatch has no live progress and exceeded the stall limit.`,
          {
            laneId,
            requestId: pickString(mailboxStatus.request_id, mailboxStatus.requestId) || null,
            ageMs: stalled.ageMs,
            timeoutMs: stalled.timeoutMs,
          },
        );
        if (repair) {
          const reason = `Clawdad sessions-doctor marked this delegate dispatch failed because it had no live progress after ${describeMsAsMinutes(stalled.ageMs)} minutes.`;
          await repairStaleMailboxStatus(projectPath, mailboxStatus, reason, laneId).catch(() => {});
          await repairDoctorDelegateStatus(projectPath, laneId, status, {
            state: "failed",
            completedAt: new Date().toISOString(),
            activeRequestId: null,
            activeStep: null,
            lastRequestId: status.lastRequestId || status.activeRequestId || null,
            pauseRequested: false,
            error: reason,
          });
          await appendDelegateRunEvent(projectPath, status.runId, "session_doctor_stale_failed", {
            title: "Sessions doctor stopped stale delegate run",
            text: reason,
            state: "failed",
            error: reason,
          }, laneId).catch(() => {});
          addRepair(
            "delegate_dispatch_stale_failed",
            `Marked ${laneId} failed after stale dispatch detection.`,
            { laneId },
          );
          markResolved(staleIssue);
          markResolved(issue);
        }
      } else if (repair && !mailboxBusy) {
        const reason = "Clawdad sessions-doctor marked this delegate run failed because no live supervisor or active mailbox worker was attached.";
        await repairDoctorDelegateStatus(projectPath, laneId, status, {
          state: "failed",
          completedAt: new Date().toISOString(),
          activeRequestId: null,
          activeStep: null,
          lastRequestId: status.lastRequestId || status.activeRequestId || null,
          pauseRequested: false,
          error: reason,
        });
        await appendDelegateRunEvent(projectPath, status.runId, "session_doctor_orphan_failed", {
          title: "Sessions doctor stopped orphaned delegate run",
          text: reason,
          state: "failed",
          error: reason,
        }, laneId).catch(() => {});
        addRepair(
          "delegate_orphan_failed",
          `Marked ${laneId} failed because it had no live supervisor or mailbox worker.`,
          { laneId },
        );
        markResolved(issue);
      }
    }
  }

  return projectReport;
}

async function buildSessionDoctorReport({ selector = "", repair = false } = {}) {
  const statePayload = await readSessionDoctorStatePayload();
  const stateProjects = statePayload.projects || {};
  const projectPaths = await sessionDoctorProjectPaths(selector, stateProjects);
  const environment = await buildDelegateDispatchHostAccessReport(
    projectPaths.length === 1 ? projectPaths[0] : "",
    defaultDelegateLaneId,
  ).catch((error) => ({
    ok: false,
    message: error.message,
    clawdadHome,
    stateFile: stateFilePath,
    codexHome: defaultCodexHome,
    checks: [
      hostAccessCheckPayload({
        name: "session_doctor_environment_check",
        label: "Run session doctor environment checks",
        filePath: clawdadHome,
        ok: false,
        error: error.message,
        code: error.code,
      }),
    ],
  }));
  const environmentIssues = (Array.isArray(environment.checks) ? environment.checks : [])
    .filter((check) => !check.ok)
    .map((check) => ({
      type: "sandbox_host_access",
      message: `${check.label || check.name}: ${check.error || check.code || "not writable"} (${check.path})`,
      resolved: false,
      name: check.name,
      path: check.path,
      code: check.code || null,
    }));
  const projects = [];
  for (const projectPath of projectPaths) {
    projects.push(await inspectSessionDoctorProject(projectPath, stateProjects, { repair }));
  }
  const issueCount = environmentIssues.length + projects.reduce((sum, project) => sum + project.issues.length, 0);
  const unresolvedIssueCount = projects.reduce(
    (sum, project) => sum + project.issues.filter((issue) => !issue.resolved).length,
    environmentIssues.filter((issue) => !issue.resolved).length,
  );
  const repairCount = projects.reduce((sum, project) => sum + project.repairs.length, 0);
  return {
    ok: unresolvedIssueCount === 0,
    repair,
    stateFile: stateFilePath,
    environment: {
      ...environment,
      issues: environmentIssues,
    },
    projectCount: projects.length,
    issueCount,
    unresolvedIssueCount,
    repairCount,
    projects,
  };
}

function printSessionDoctorReport(report) {
  console.log(
    `Sessions doctor: ${report.projectCount} project${report.projectCount === 1 ? "" : "s"}, ${report.issueCount} issue${report.issueCount === 1 ? "" : "s"}, ${report.repairCount} repair${report.repairCount === 1 ? "" : "s"}`,
  );
  const environmentIssues = Array.isArray(report.environment?.issues) ? report.environment.issues : [];
  if (environmentIssues.length > 0) {
    console.log("\nEnvironment");
    for (const issue of environmentIssues) {
      console.log(`  issue: ${issue.message}`);
    }
    if (report.environment?.message) {
      console.log(`  advice: ${report.environment.message}`);
    }
  }
  if (report.projectCount === 0) {
    console.log("No tracked projects found.");
    return;
  }
  for (const project of report.projects) {
    const status = project.issues.length === 0
      ? "ok"
      : project.issues.every((issue) => issue.resolved)
        ? "repaired"
        : "needs attention";
    console.log(`\n${project.projectPath}`);
    console.log(`  status: ${status}`);
    if (project.quarantinedSessions.length > 0) {
      console.log(`  quarantined: ${project.quarantinedSessions.join(", ")}`);
    }
    for (const issue of project.issues) {
      console.log(`  ${issue.resolved ? "fixed" : "issue"}: ${issue.message}`);
    }
    for (const repair of project.repairs) {
      console.log(`  repair: ${repair.message}`);
    }
  }
}

async function runSessionsDoctor(argv) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    printUsage();
    return;
  }
  const report = await buildSessionDoctorReport({
    selector: rawOptions._[0] || "",
    repair: Boolean(rawOptions.repair),
  });
  if (rawOptions.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printSessionDoctorReport(report);
  }
  if (!report.ok) {
    process.exitCode = 1;
  }
}

async function resolveCodexIntegrationProject(rawOptions = {}) {
  const requested = pickString(rawOptions.project, rawOptions._?.[0], process.cwd());
  const directPath = await normalizeDirectoryPath(requested).catch(() => "");
  if (directPath) {
    return directPath;
  }
  const trackedPath = await resolveProjectPathForRequest(requested, "").catch(() => "");
  const normalizedTrackedPath = trackedPath
    ? await normalizeDirectoryPath(trackedPath).catch(() => trackedPath)
    : "";
  if (normalizedTrackedPath) {
    return normalizedTrackedPath;
  }
  throw new Error(`project '${requested}' was not found`);
}

function printCodexIntegrationReport(report, { operations = [] } = {}) {
  console.log(`Codex integration: ${report.projectPath}`);
  if (operations.length > 0) {
    for (const entry of operations) {
      const detail = entry.detail ? ` (${entry.detail})` : "";
      console.log(`  ${entry.action}: ${entry.path}${detail}`);
    }
  }
  for (const entry of report.checks) {
    console.log(`  ${renderCheckLine(entry)}`);
  }
}

async function runCodexHook(_argv = []) {
  const raw = await readStdinText();
  const input = raw.trim() ? JSON.parse(raw) : {};
  const response = await handleCodexHookInput(input, {
    projectPath: pickString(process.env.CLAWDAD_HOOK_PROJECT, input.cwd, process.cwd()),
  });
  if (response) {
    console.log(JSON.stringify(response));
  }
}

async function runCodexIntegration(argv) {
  const [subcommand = "doctor", ...rest] = argv;
  if (["hook", "codex-hook"].includes(subcommand)) {
    await runCodexHook(rest);
    return;
  }
  const rawOptions = parseArgs(rest);
  if (rawOptions.help) {
    printUsage();
    return;
  }
  const projectPath = await resolveCodexIntegrationProject(rawOptions);
  const codexHome = pickString(rawOptions.codexHome, process.env.CLAWDAD_CODEX_HOME, defaultCodexHome);

  if (subcommand === "install" || subcommand === "setup") {
    const result = await installCodexIntegration({
      projectPath,
      codexHome,
      clawdadBin,
      version,
      dryRun: Boolean(rawOptions.dryRun),
      force: Boolean(rawOptions.force),
    });
    if (rawOptions.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printCodexIntegrationReport(result.report, { operations: result.operations });
    }
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (subcommand === "doctor" || subcommand === "check") {
    const report = await buildCodexIntegrationReport({ projectPath, codexHome });
    if (rawOptions.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printCodexIntegrationReport(report);
    }
    if (!report.ok) {
      process.exitCode = 1;
    }
    return;
  }

  throw new Error(`unknown codex subcommand: ${subcommand}`);
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

  if (url.pathname === "/" || url.pathname === "/index.html") {
    await sendAppIndex(res);
    return true;
  }

  const appAssets = {
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

function artifactDownloadUrl(projectPath, relativePath) {
  const query = new URLSearchParams({
    project: projectPath,
    file: relativePath,
  });
  return `/v1/artifacts/download?${query.toString()}`;
}

function normalizeArtifactEntry(projectPath, relativePath, info) {
  const fileName = path.basename(relativePath);
  return {
    id: artifactId(projectPath, relativePath, info),
    projectPath,
    relativePath,
    fileName,
    size: info.size,
    modifiedAt: new Date(info.mtimeMs || Date.now()).toISOString(),
    mimeType: inferMimeType(relativePath),
    downloadUrl: artifactDownloadUrl(projectPath, relativePath),
  };
}

async function listProjectArtifacts(projectPath) {
  const artifactRoot = projectArtifactsDir(projectPath);
  await mkdir(artifactRoot, { recursive: true });
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
      entries.push(normalizeArtifactEntry(projectPath, relativePath, info));
    }
  }

  await walk(artifactRoot);
  return entries.sort((left, right) => {
    const leftMs = Date.parse(left.modifiedAt || "");
    const rightMs = Date.parse(right.modifiedAt || "");
    return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
  });
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
    tailscaleServiceHostTag: pickString(
      overrides.tailscaleServiceHostTag,
      rawOptions.serviceHostTag,
      process.env.CLAWDAD_TAILSCALE_SERVICE_HOST_TAG,
      configTailscale.serviceHostTag,
      "tag:live-app-host",
    ),
    tailscaleServiceHostSocket: pickString(
      overrides.tailscaleServiceHostSocket,
      rawOptions.serviceHostSocket,
      process.env.CLAWDAD_TAILSCALE_SERVICE_HOST_SOCKET,
      configTailscale.serviceHostSocket,
    ),
    liveApps: normalizeLiveApps(
      overrides.liveApps,
      rawOptions.liveApp,
      process.env.CLAWDAD_SECURE_DOCTOR_LIVE_APPS,
      configTailscale.liveApps,
    ),
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
  if (options.ignoreStdin || options.input != null) {
    return new Promise((resolve) => {
      const stdinMode = options.input != null ? "pipe" : "ignore";
      const child = spawn(command, args, {
        cwd: options.cwd || clawdadRoot,
        detached: Boolean(options.killProcessGroup),
        env: {
          ...process.env,
          CLAWDAD_ROOT: clawdadRoot,
          CLAWDAD_HOME: clawdadHome,
          ...(options.env || {}),
        },
        stdio: [stdinMode, "pipe", "pipe"],
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

      if (options.input != null) {
        child.stdin?.on("error", () => {});
        child.stdin?.end(String(options.input));
      }

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
  const outputFile = pickString(options.outputFile);
  let outputFd = null;
  let stdio = "ignore";
  if (outputFile) {
    try {
      await mkdir(path.dirname(outputFile), { recursive: true });
      outputFd = openSync(outputFile, "a");
      stdio = ["ignore", outputFd, outputFd];
    } catch (error) {
      if (outputFd != null) {
        try {
          closeSync(outputFd);
        } catch (_closeError) {}
      }
      return { ok: false, error, outputFile };
    }
  }

  return new Promise((resolve) => {
    let settled = false;
    const closeOutput = () => {
      if (outputFd == null) {
        return;
      }
      try {
        closeSync(outputFd);
      } catch (_error) {}
      outputFd = null;
    };
    const finish = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      closeOutput();
      resolve({
        ...payload,
        outputFile: outputFile || null,
      });
    };

    let child = null;
    try {
      child = spawn(command, args, {
        cwd: clawdadRoot,
        env: {
          ...process.env,
          CLAWDAD_ROOT: clawdadRoot,
          CLAWDAD_HOME: clawdadHome,
          ...(options.env || {}),
        },
        detached: true,
        stdio,
      });
    } catch (error) {
      finish({ ok: false, error });
      return;
    }

    child.once("error", (error) => {
      finish({ ok: false, error });
    });

    child.once("spawn", () => {
      child.unref();
      finish({ ok: true, pid: child.pid || null });
    });
  });
}

async function startClawdadDetached(args, options = {}) {
  return startDetached(clawdadBin, args, options);
}

async function runTailscale(args, options = {}) {
  const { socket, ...execOptions } = options;
  const finalArgs = socket ? ["--socket", socket, ...args] : args;
  return runExec(defaultTailscaleBinary, finalArgs, execOptions);
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

function parseOptionalJsonObject(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

async function getTailscaleStatus(socket = "") {
  return parseJsonResult(
    await runTailscale(["status", "--json"], socket ? { socket } : {}),
    "tailscale status --json",
  );
}

async function getTailscaleServeStatus(socket = "") {
  return parseJsonResult(
    await runTailscale(["serve", "status", "--json"], socket ? { socket } : {}),
    "tailscale serve status --json",
  );
}

async function getTailscaleFunnelStatus(socket = "") {
  return parseJsonResult(
    await runTailscale(["funnel", "status", "--json"], socket ? { socket } : {}),
    "tailscale funnel status --json",
  );
}

async function getTailscaleCliVersion(socket = "") {
  const result = await runTailscale(["version"], { timeoutMs: 5000, socket });
  if (!result.ok) {
    return "";
  }
  return pickString((result.stdout || "").split(/\r?\n/u)[0]);
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

function firstSemver(value) {
  return String(value || "").match(/\d+\.\d+\.\d+/u)?.[0] || "";
}

function tailscaleSelfTags(status) {
  const tags = status?.Self?.Tags;
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean).sort();
  }
  return [];
}

function tailscaleServiceHostCap(status) {
  const capMap = status?.Self?.CapMap;
  if (capMap && typeof capMap === "object" && !Array.isArray(capMap)) {
    return capMap["service-host"] || capMap["https://tailscale.com/cap/service-host"] || null;
  }
  return null;
}

function daysUntilIso(isoValue) {
  const timestamp = Date.parse(isoValue || "");
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return Math.ceil((timestamp - Date.now()) / (24 * 60 * 60 * 1000));
}

function routeNameFromUrl(value) {
  try {
    const parsed = new URL(value);
    const port =
      parsed.port ||
      (parsed.protocol === "https:" ? "443" : parsed.protocol === "http:" ? "80" : "");
    return port ? `${parsed.hostname}:${port}` : parsed.hostname;
  } catch (_error) {
    return "";
  }
}

function serviceNameFromLiveApp(app) {
  return String(app.name || "").replace(/^svc:/u, "").trim();
}

function serviceUrlFromLiveApp(app, tailnetSuffix) {
  const serviceName = serviceNameFromLiveApp(app);
  if (!serviceName || !tailnetSuffix) {
    return "";
  }
  return `https://${serviceName}.${tailnetSuffix}`;
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
    let projects = await loadProjectCatalogCached();
    matchedProject = projects.find((entry) => entry.path === resolvedProjectPath) || null;
    if (matchedProject && await autoRegisterImportableCodexSessionsForProject(matchedProject)) {
      projects = await loadProjectCatalogCached({ allowStale: false });
      matchedProject = projects.find((entry) => entry.path === resolvedProjectPath) || matchedProject;
    }
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

  const sessionValidation = await validateDispatchSessionBinding(resolvedProjectPath, matchedSession || {});
  if (!sessionValidation.ok) {
    json(res, sessionValidation.statusCode || 409, {
      ok: false,
      project,
      wait,
      actor,
      sessionId: matchedSession?.sessionId || null,
      provider: matchedSession?.provider || null,
      error: sessionValidation.message,
      reason: sessionValidation.reason || "invalid_session_binding",
    });
    return;
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

    const responseMarkdown = await readMailboxResponseForStatus(resolvedProjectPath, mailboxStatus);
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
      ? await readMailboxResponseForStatus(projectPath, mailboxStatus)
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
  let summary = projects.find((entry) => entry.path === projectPath) || null;
  if (summary && await autoRegisterImportableCodexSessionsForProject(summary)) {
    const refreshedProjects = await loadProjectCatalogCached({ allowStale: false });
    summary = refreshedProjects.find((entry) => entry.path === projectPath) || summary;
  }
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
    const cachedProjects = await loadProjectCatalogCached();
    const autoImportScheduled = scheduleAutoRegisterImportableCodexSessionsForProjects(cachedProjects);
    const projects = await projectCatalogWithDelegateStatuses(cachedProjects);
    const defaultProject = defaultProjectForCatalog(projects, options.defaultProject);
    json(res, 200, {
      ok: true,
      actor,
      defaultProject: defaultProject || null,
      autoImportedSessionCount: 0,
      autoImportScheduled,
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

async function resolveProjectPathForCodexIntegration(projectInput, defaultProject = "") {
  const requested = pickString(projectInput, defaultProject);
  if (!requested) {
    return "";
  }
  const direct = await normalizeDirectoryPath(requested).catch(() => "");
  if (direct) {
    return direct;
  }
  const tracked = await resolveProjectPathForRequest(requested, defaultProject).catch(() => "");
  return tracked ? await normalizeDirectoryPath(tracked).catch(() => tracked) : "";
}

async function handleCodexIntegrationGet(_req, res, options, url, actor) {
  const project = (url.searchParams.get("project") || options.defaultProject || "").trim();
  const projectPath = await resolveProjectPathForCodexIntegration(project, options.defaultProject);
  if (!projectPath) {
    json(res, 404, { ok: false, actor, error: `project '${project || "(default)"}' was not found` });
    return;
  }
  const report = await buildCodexIntegrationReport({
    projectPath,
    codexHome: pickString(process.env.CLAWDAD_CODEX_HOME, defaultCodexHome),
  });
  json(res, report.ok ? 200 : 409, {
    ...report,
    actor,
  });
}

async function handleCodexIntegrationInstall(req, res, options, actor) {
  let payload = {};
  try {
    const rawBody = await readBody(req, options.bodyLimitBytes);
    payload = rawBody.trim() ? JSON.parse(rawBody) : {};
  } catch (error) {
    json(res, 400, { ok: false, actor, error: error.message });
    return;
  }
  const project = pickString(payload.project, options.defaultProject);
  const projectPath = await resolveProjectPathForCodexIntegration(project, options.defaultProject);
  if (!projectPath) {
    json(res, 404, { ok: false, actor, error: `project '${project || "(default)"}' was not found` });
    return;
  }
  try {
    const result = await installCodexIntegration({
      projectPath,
      codexHome: pickString(process.env.CLAWDAD_CODEX_HOME, defaultCodexHome),
      clawdadBin,
      version,
      dryRun: boolFromUnknown(payload.dryRun, false),
      force: boolFromUnknown(payload.force, false),
    });
    json(res, result.ok ? 200 : 409, {
      ...result,
      actor,
    });
  } catch (error) {
    json(res, 500, { ok: false, actor, projectPath, error: error.message });
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

function ttsAudioUrl(projectPath, audioId, partName) {
  const query = new URLSearchParams({
    project: projectPath,
    audioId,
    part: partName,
  });
  return `/v1/tts/audio?${query.toString()}`;
}

function ttsManifestForClient(projectPath, manifest = {}) {
  const parts = Array.isArray(manifest.parts) ? manifest.parts : [];
  return {
    audioId: pickString(manifest.audioId),
    state: pickString(manifest.state, "unknown"),
    provider: pickString(manifest.provider),
    voiceId: pickString(manifest.voiceId),
    modelId: pickString(manifest.modelId),
    outputFormat: pickString(manifest.outputFormat),
    charCount: typeof manifest.charCount === "number" ? manifest.charCount : null,
    chunkCount: typeof manifest.chunkCount === "number" ? manifest.chunkCount : parts.length,
    cachedAt: pickString(manifest.updatedAt, manifest.createdAt) || null,
    parts: parts.map((part) => ({
      index: typeof part.index === "number" ? part.index : null,
      fileName: pickString(part.fileName),
      bytes: typeof part.bytes === "number" ? part.bytes : null,
      charCount: typeof part.charCount === "number" ? part.charCount : null,
      url: ttsAudioUrl(projectPath, manifest.audioId, part.fileName),
    })),
  };
}

function ttsMessageAudioId(config, text) {
  return createTtsAudioId({
    provider: config.provider,
    voiceId: config.voiceId,
    modelId: config.modelId,
    outputFormat: config.outputFormat,
    text,
  });
}

function ttsPrepareJobKey(projectPath, audioId) {
  return `${projectPath}\0${audioId}`;
}

function ttsGeneratingAudioForClient(projectPath, audioId, source = {}, manifest = {}) {
  return {
    audioId,
    state: "generating",
    provider: pickString(manifest.provider),
    voiceId: pickString(manifest.voiceId),
    modelId: pickString(manifest.modelId),
    outputFormat: pickString(manifest.outputFormat),
    charCount: typeof manifest.charCount === "number" ? manifest.charCount : null,
    chunkCount: typeof manifest.chunkCount === "number" ? manifest.chunkCount : null,
    cachedAt: pickString(manifest.updatedAt, manifest.createdAt) || null,
    source,
    parts: [],
  };
}

function ttsErrorStatusCode(error) {
  const message = error?.message || "";
  if (/too long|missing text|disabled|unsupported/iu.test(message)) {
    return 400;
  }
  if (/ElevenLabs|HTTP|API key/iu.test(message)) {
    return 502;
  }
  return 500;
}

async function startTtsPrepareJob({ projectPath, text, source, config, apiKey }) {
  const audioId = ttsMessageAudioId(config, text);
  const existingManifest = await readTtsManifest(projectPath, audioId);
  if (existingManifest?.state === "ready" && Array.isArray(existingManifest.parts) && existingManifest.parts.length > 0) {
    return {
      statusCode: 200,
      cached: true,
      audio: ttsManifestForClient(projectPath, existingManifest),
    };
  }
  if (existingManifest?.state === "failed") {
    return {
      statusCode: 502,
      cached: false,
      audio: ttsManifestForClient(projectPath, existingManifest),
      error: pickString(existingManifest.error, "Audio generation failed"),
    };
  }

  const key = ttsPrepareJobKey(projectPath, audioId);
  if (!ttsPrepareJobs.has(key)) {
    const job = ensureCachedTtsAudio({
      projectPath,
      text,
      source,
      config,
      apiKey,
    })
      .catch((error) => {
        console.warn(`clawdad tts prepare failed for ${audioId}: ${error.message}`);
      })
      .finally(() => {
        ttsPrepareJobs.delete(key);
      });
    ttsPrepareJobs.set(key, job);
  }

  return {
    statusCode: 202,
    cached: false,
    audio: ttsGeneratingAudioForClient(projectPath, audioId, source, existingManifest || {}),
  };
}

function historyRequestIdLooksSafe(requestId) {
  const normalized = pickString(requestId);
  return Boolean(normalized) && !normalized.includes("\0") && !normalized.includes("/") && !normalized.includes("\\");
}

async function readHistoryEntryByRequestId(projectPath, requestId, sessionId = "") {
  if (!historyRequestIdLooksSafe(requestId)) {
    return null;
  }

  const indexFile = path.join(historyPaths(projectPath).requestsDir, `${requestId}.json`);
  const indexPayload = await readOptionalJson(indexFile).catch(() => null);
  const recordFile = pickString(indexPayload?.file);
  if (!recordFile) {
    return null;
  }

  const historyRoot = historyPaths(projectPath).historyDir;
  const resolvedRecordFile = path.resolve(recordFile);
  if (!pathInsideRoot(historyRoot, resolvedRecordFile)) {
    return null;
  }

  const record = await readOptionalJson(resolvedRecordFile).catch(() => null);
  if (!record || typeof record !== "object") {
    return null;
  }

  const recordSessionId = pickString(record.sessionId, indexPayload?.sessionId);
  const requestedSessionId = pickString(sessionId);
  if (requestedSessionId && recordSessionId && requestedSessionId !== recordSessionId) {
    return null;
  }

  return normalizeHistoryEntry({
    ...record,
    requestId,
    sessionId: recordSessionId || requestedSessionId || null,
  });
}

async function findHistoryEntryForTts(projectPath, projectDetails, payload = {}) {
  const requestId = pickString(payload.requestId);
  const sessionId = pickString(payload.sessionId);
  if (!requestId) {
    return null;
  }

  const mirrored = await readHistoryEntryByRequestId(projectPath, requestId, sessionId);
  if (mirrored) {
    return mirrored;
  }

  const session =
    Array.isArray(projectDetails?.sessions)
      ? projectDetails.sessions.find(
          (entry) => entry.sessionId === sessionId || entry.slug === sessionId,
        )
      : null;
  if (!session?.sessionId) {
    return null;
  }

  const providerItems = await readProviderHistory(projectPath, session).catch(() => []);
  return providerItems.find((entry) => pickString(entry.requestId) === requestId) || null;
}

async function ttsTextFromPayload(projectPath, projectDetails, payload = {}) {
  const kind = pickString(payload.kind, payload.part).toLowerCase() === "response" ? "response" : "message";
  const historyEntry = await findHistoryEntryForTts(projectPath, projectDetails, payload);
  const fallbackText = String(payload.text || "").trim();
  const text =
    kind === "response"
      ? pickString(historyEntry?.response, fallbackText)
      : pickString(historyEntry?.message, fallbackText);

  if (!text) {
    throw new Error(
      kind === "response"
        ? "No saved response text is available for this message yet"
        : "No saved message text is available for this message",
    );
  }

  return {
    kind,
    text,
    source: {
      projectPath,
      sessionId: pickString(payload.sessionId, historyEntry?.sessionId) || null,
      requestId: pickString(payload.requestId, historyEntry?.requestId) || null,
      kind,
      status: pickString(historyEntry?.status) || null,
    },
  };
}

async function handleTtsMessageCreate(req, res, options, actor) {
  let payload;
  try {
    payload = await parseDispatchPayload(req, options.bodyLimitBytes);
  } catch (error) {
    json(res, 400, { ok: false, error: error.message });
    return;
  }

  const asyncPrepare =
    boolFromUnknown(payload.async, false) ||
    boolFromUnknown(payload.prepare, false) ||
    boolFromUnknown(payload.background, false);
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

  const ttsConfig = resolveTtsRuntimeConfig({ config: options.config });
  if (!ttsConfig.enabled) {
    json(res, 403, {
      ok: false,
      actor,
      project: resolved.projectPath,
      error: "Text-to-speech is disabled on this Clawdad server",
    });
    return;
  }

  let ttsMessage;
  try {
    ttsMessage = await ttsTextFromPayload(resolved.projectPath, resolved.projectDetails, payload);
  } catch (error) {
    json(res, 400, {
      ok: false,
      actor,
      project: resolved.projectPath,
      error: error.message,
    });
    return;
  }

  let apiKey = "";
  try {
    apiKey = await resolveElevenLabsApiKey({ projectPath: resolved.projectPath });
  } catch (_error) {
    apiKey = "";
  }
  if (!apiKey) {
    json(res, 409, {
      ok: false,
      actor,
      project: resolved.projectPath,
      error:
        "ElevenLabs API key is not configured. Set ELEVENLABS_API_KEY, CLAWDAD_ELEVENLABS_API_KEY, add a Keychain item named clawdad-elevenlabs, or store it in ORP secrets.",
    });
    return;
  }

  try {
    if (asyncPrepare) {
      const prepared = await startTtsPrepareJob({
        projectPath: resolved.projectPath,
        text: ttsMessage.text,
        source: ttsMessage.source,
        config: ttsConfig,
        apiKey,
      });
      json(res, prepared.statusCode, {
        ok: prepared.statusCode < 400,
        actor,
        project: resolved.projectPath,
        cached: prepared.cached,
        audio: prepared.audio,
        ...(prepared.error ? { error: prepared.error } : {}),
      });
      return;
    }

    const audioId = ttsMessageAudioId(ttsConfig, ttsMessage.text);
    const activePrepare = ttsPrepareJobs.get(ttsPrepareJobKey(resolved.projectPath, audioId));
    if (activePrepare) {
      await activePrepare;
    }
    const result = await ensureCachedTtsAudio({
      projectPath: resolved.projectPath,
      text: ttsMessage.text,
      source: ttsMessage.source,
      config: ttsConfig,
      apiKey,
    });
    json(res, 200, {
      ok: true,
      actor,
      project: resolved.projectPath,
      cached: result.cached,
      audio: ttsManifestForClient(resolved.projectPath, result.manifest),
    });
  } catch (error) {
    const statusCode = ttsErrorStatusCode(error);
    json(res, statusCode, {
      ok: false,
      actor,
      project: resolved.projectPath,
      error: error.message,
    });
  }
}

async function handleTtsAudioGet(req, res, options, url, actor) {
  const project = (url.searchParams.get("project") || options.defaultProject || "").trim();
  const audioId = url.searchParams.get("audioId") || "";
  const partName = url.searchParams.get("part") || "";
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
    const manifest = await readTtsManifest(resolved.projectPath, audioId);
    if (!manifest || manifest.state !== "ready") {
      throw new Error("audio is not ready");
    }
    const part = Array.isArray(manifest.parts)
      ? manifest.parts.find((entry) => pickString(entry.fileName) === partName)
      : null;
    if (!part) {
      throw new Error("audio part was not found");
    }
    await sendFile(res, ttsAudioFilePath(resolved.projectPath, audioId, partName), {
      "content-type": "audio/mpeg",
      "content-disposition": `inline; filename="${path.basename(partName)}"`,
      "cache-control": "private, max-age=31536000, immutable",
    });
  } catch (error) {
    const statusCode = /invalid|not ready|not found/iu.test(error.message) ? 404 : 400;
    json(res, statusCode, {
      ok: false,
      actor,
      project: resolved.projectPath,
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
    transcriptPath: pickString(session.file) || null,
    preview: pickString(session.preview) || "",
    titleHint: title,
    label: sessionDisplayForStatus({
      slug: title,
      provider: "codex",
      sessionId,
    }),
  };
}

async function listImportableCodexSessionsForProject(projectDetails, {
  limit = 12,
  sessionId = "",
  excludeTracked = true,
} = {}) {
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

  if (excludeTracked) {
    for (const trackedSessionId of trackedSessionIds) {
      args.push("--exclude", trackedSessionId);
    }
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

async function registerImportedSessionLocally(projectPath, importableSession, projectDetails = {}, { makeActive = true } = {}) {
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

    const nextProject = {
      status: pickString(existingProject.status, "idle"),
      last_dispatch: existingProject.last_dispatch ?? null,
      last_response: existingProject.last_response ?? null,
      dispatch_count: Number.parseInt(String(existingProject.dispatch_count || "0"), 10) || 0,
      registered_at: pickString(existingProject.registered_at, now),
      ...existingProject,
      active_session_id: makeActive
        ? sessionId
        : pickString(existingProject.active_session_id, sessionId),
      sessions: {
        ...existingSessions,
        [sessionId]: {
          slug: pickString(existingSession.slug, slug),
          provider: "codex",
          provider_session_seeded: "true",
          tracked_at: pickString(existingSession.tracked_at, now),
          last_selected_at: makeActive
            ? now
            : existingSession.last_selected_at ?? null,
          dispatch_count: Number.parseInt(String(existingSession.dispatch_count || "0"), 10) || 0,
          last_dispatch: existingSession.last_dispatch ?? null,
          last_response: existingSession.last_response ?? null,
          provider_session_timestamp: pickString(importableSession.timestamp, existingSession.provider_session_timestamp) || null,
          provider_last_activity: pickString(importableSession.lastUpdatedAt, existingSession.provider_last_activity) || null,
          provider_session_source: pickString(importableSession.source, existingSession.provider_session_source) || null,
          provider_transcript_path: pickString(importableSession.transcriptPath, existingSession.provider_transcript_path) || null,
          status: pickString(existingSession.status, "idle"),
          local_only: pickString(existingSession.local_only, "true"),
          orp_error: pickString(existingSession.orp_error),
        },
      },
    };
    statePayload.projects[projectPath] = nextProject;

    await writeJsonFile(stateFilePath, statePayload);
    return statePayload;
  });
}

async function autoRegisterImportableCodexSessionsForProject(projectDetails = {}, {
  force = false,
  limit = 24,
} = {}) {
  const projectPath = pickString(projectDetails?.path);
  if (!projectPath || String(projectDetails?.provider || "codex").toLowerCase() !== "codex") {
    return 0;
  }

  const now = Date.now();
  const cachedAt = projectSessionAutoImportCache.get(projectPath) || 0;
  if (!force && projectSessionAutoImportTtlMs > 0 && now - cachedAt < projectSessionAutoImportTtlMs) {
    return 0;
  }
  projectSessionAutoImportCache.set(projectPath, now);

  let importable = [];
  try {
    importable = await listImportableCodexSessionsForProject(projectDetails, { limit, excludeTracked: false });
  } catch (error) {
    console.warn(`[clawdad-server] local Codex session auto-import skipped for ${projectPath}: ${error.message}`);
    return 0;
  }

  let registered = 0;
  for (const session of importable) {
    const sessionId = pickString(session?.sessionId);
    if (!sessionId) {
      continue;
    }
    try {
      await registerImportedSessionLocally(projectPath, session, projectDetails, { makeActive: false });
      registered += 1;
    } catch (error) {
      console.warn(`[clawdad-server] failed to auto-register Codex session ${sessionId} for ${projectPath}: ${error.message}`);
    }
  }

  if (registered > 0) {
    invalidateProjectCatalogCache();
  }
  return registered;
}

async function autoRegisterImportableCodexSessionsForProjects(projects = [], options = {}) {
  let registered = 0;
  for (const project of Array.isArray(projects) ? projects : []) {
    registered += await autoRegisterImportableCodexSessionsForProject(project, options);
  }
  return registered;
}

function scheduleAutoRegisterImportableCodexSessionsForProjects(projects = [], options = {}) {
  if (projectSessionAutoImportCatalogPromise) {
    return false;
  }

  const snapshot = Array.isArray(projects) ? [...projects] : [];
  if (snapshot.length === 0) {
    return false;
  }

  projectSessionAutoImportCatalogPromise = autoRegisterImportableCodexSessionsForProjects(snapshot, options)
    .then((registered) => {
      if (registered > 0) {
        invalidateProjectCatalogCache();
      }
      return registered;
    })
    .catch((error) => {
      console.warn(`[clawdad-server] local Codex catalog auto-import skipped: ${error.message}`);
      return 0;
    })
    .finally(() => {
      projectSessionAutoImportCatalogPromise = null;
    });
  return true;
}

async function readQuickPrompts() {
  let statePayload = {};
  try {
    statePayload = (await readOptionalJson(stateFilePath)) || {};
  } catch (error) {
    console.warn(`[clawdad-server] ignoring invalid state file at ${stateFilePath}: ${error.message}`);
    statePayload = {};
  }

  if (!statePayload || typeof statePayload !== "object") {
    return defaultQuickPrompts();
  }
  if (!Object.prototype.hasOwnProperty.call(statePayload, "quick_prompts")) {
    return defaultQuickPrompts();
  }
  if (!Array.isArray(statePayload.quick_prompts)) {
    return defaultQuickPrompts();
  }
  return normalizeQuickPrompts(statePayload.quick_prompts, { fallbackToDefaults: false });
}

async function writeQuickPrompts(prompts, { reset = false } = {}) {
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
    statePayload.quick_prompts_updated_at = new Date().toISOString();
    if (reset) {
      delete statePayload.quick_prompts;
    } else {
      statePayload.quick_prompts = normalizeQuickPrompts(prompts, { fallbackToDefaults: false });
    }

    await writeJsonFile(stateFilePath, statePayload);
    return reset ? defaultQuickPrompts() : statePayload.quick_prompts;
  });
}

async function handleQuickPromptsGet(_req, res, _options, _url, actor) {
  try {
    const prompts = await readQuickPrompts();
    json(res, 200, {
      ok: true,
      actor,
      prompts,
    });
  } catch (error) {
    json(res, 500, { ok: false, actor, error: error.message });
  }
}

async function handleQuickPromptsPut(req, res, options, actor) {
  let payload;
  try {
    payload = await parseDispatchPayload(req, options.bodyLimitBytes);
  } catch (error) {
    json(res, 400, { ok: false, error: error.message });
    return;
  }

  const reset = payload?.reset === true;
  if (!reset && !Array.isArray(payload?.prompts)) {
    json(res, 400, { ok: false, actor, error: "missing prompts array" });
    return;
  }
  if (!reset && payload.prompts.length > quickPromptMaxCount) {
    json(res, 400, {
      ok: false,
      actor,
      error: `quick prompts are limited to ${quickPromptMaxCount}`,
    });
    return;
  }

  try {
    const savedPrompts = await writeQuickPrompts(
      reset ? [] : normalizeQuickPrompts(payload.prompts, { fallbackToDefaults: false }),
      { reset },
    );
    json(res, 200, {
      ok: true,
      actor,
      prompts: savedPrompts,
    });
  } catch (error) {
    json(res, 500, { ok: false, actor, error: error.message });
  }
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

async function startDelegatePlanGeneration(projectDetails, laneId = defaultDelegateLaneId) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  const jobKey = delegateJobKey(projectDetails.path, normalizedLaneId);
  if (delegateRunJobs.has(jobKey)) {
    return {
      accepted: false,
      status: await readDelegateStatus(projectDetails.path, { laneId: normalizedLaneId }),
    };
  }

  const existingJob = delegatePlanJobs.get(jobKey);
  if (existingJob) {
    return {
      accepted: false,
      status: await readDelegateStatus(projectDetails.path, { laneId: normalizedLaneId }),
    };
  }

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const initialConfig = await readDelegateConfig(projectDetails.path, normalizedLaneId);
  const computeGuard = await evaluateDelegateComputeGuard(initialConfig);
  const initialStatus = await writeDelegateStatus(projectDetails.path, {
    state: computeGuard.blocked ? "blocked" : "planning",
    laneId: normalizedLaneId,
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
  }, normalizedLaneId);
  if (computeGuard.blocked) {
    await writeDelegateConfig(projectDetails.path, {
      ...initialConfig,
      enabled: false,
    }, normalizedLaneId);
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
        { laneId: normalizedLaneId },
      );
      await writeDelegateStatus(projectDetails.path, {
        laneId: normalizedLaneId,
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
      }, normalizedLaneId);
      return planResult;
    } catch (error) {
      await writeDelegateStatus(projectDetails.path, {
        laneId: normalizedLaneId,
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
      }, normalizedLaneId);
      throw error;
    } finally {
      const activeJob = delegatePlanJobs.get(jobKey);
      if (activeJob?.runId === runId) {
        delegatePlanJobs.delete(jobKey);
      }
    }
  })();

  delegatePlanJobs.set(jobKey, {
    runId,
    startedAt,
    laneId: normalizedLaneId,
    promise,
  });
  promise.catch(() => {});

  return {
    accepted: true,
    status: initialStatus,
  };
}

async function startDelegateSupervisorProcess(projectDetails, status, laneId = status?.laneId || defaultDelegateLaneId) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  const runId = pickString(status?.runId) || crypto.randomUUID();
  const startResult = await startDetached(process.execPath, [
    serverModulePath,
    "delegate-supervisor",
    projectDetails.path,
    "--lane",
    normalizedLaneId,
    "--run-id",
    runId,
  ]);
  if (!startResult.ok) {
    throw new Error(startResult.error?.message || "failed to start delegate supervisor");
  }

  const nextStatus = await writeDelegateStatus(projectDetails.path, {
    ...status,
    laneId: normalizedLaneId,
    state: "running",
    runId,
    startedAt: status?.startedAt || new Date().toISOString(),
    completedAt: null,
    supervisorPid: startResult.pid,
    supervisorStartedAt: new Date().toISOString(),
    pauseRequested: false,
    error: "",
  }, normalizedLaneId);
  await appendDelegateRunEvent(projectDetails.path, runId, "supervisor_started", {
    title: "Supervisor started",
    text: startResult.pid ? `Supervisor pid ${startResult.pid}` : "Detached supervisor started.",
    state: nextStatus.state,
  }, normalizedLaneId).catch(() => {});

  return {
    accepted: true,
    status: nextStatus,
    pid: startResult.pid || null,
  };
}

async function startDelegateRun(projectDetails, laneId = defaultDelegateLaneId) {
  const normalizedLaneId = normalizeDelegateLaneId(laneId);
  const jobKey = delegateJobKey(projectDetails.path, normalizedLaneId);
  const runningJob = delegateRunJobs.get(jobKey);
  if (runningJob) {
    const currentConfig = await readDelegateConfig(projectDetails.path, normalizedLaneId);
    const currentStatus = await readDelegateStatus(projectDetails.path, { reconcile: false, laneId: normalizedLaneId });
    if (shouldClearPendingDelegatePause({ runningJob, currentStatus, currentConfig })) {
      runningJob.pauseRequested = false;
      await writeDelegateConfig(projectDetails.path, {
        ...currentConfig,
        enabled: true,
      }, normalizedLaneId);
      const resumedStatus = await writeDelegateStatus(projectDetails.path, {
        ...currentStatus,
        laneId: normalizedLaneId,
        state: "running",
        runId: runningJob.runId || currentStatus.runId,
        startedAt: runningJob.startedAt || currentStatus.startedAt,
        delegateSessionId: runningJob.delegateSessionId || currentStatus.delegateSessionId,
        delegateSessionLabel: runningJob.delegateSessionLabel || currentStatus.delegateSessionLabel,
        completedAt: null,
        pauseRequested: false,
        error: "",
      }, normalizedLaneId);
      await appendDelegateRunEvent(projectDetails.path, resumedStatus.runId, "run_resumed", {
        title: "Delegate resumed",
        text: "A pending pause was cleared and the active run kept going.",
        state: resumedStatus.state,
      }, normalizedLaneId).catch(() => {});
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
  if (delegatePlanJobs.has(jobKey)) {
    return {
      accepted: false,
      status: await readDelegateStatus(projectDetails.path, { laneId: normalizedLaneId }),
    };
  }

  let config = await readDelegateConfig(projectDetails.path, normalizedLaneId);
  const currentStatus = await readDelegateStatus(projectDetails.path, { reconcile: false, laneId: normalizedLaneId });
  if (["starting", "dispatching", "running"].includes(currentStatus.state) && !delegateSupervisorIsLive(currentStatus)) {
    config = await writeDelegateConfig(projectDetails.path, {
      ...config,
      enabled: true,
    }, normalizedLaneId);
    await appendDelegateRunEvent(projectDetails.path, currentStatus.runId, "supervisor_interrupted", {
      title: "Supervisor interrupted",
      text: "Status was still running, but no live supervisor was attached. Clawdad is starting a replacement supervisor.",
      state: currentStatus.state,
    }, normalizedLaneId).catch(() => {});
    return startDelegateSupervisorProcess(projectDetails, {
      ...currentStatus,
      laneId: normalizedLaneId,
      pauseRequested: false,
    }, normalizedLaneId);
  }
  if (["starting", "dispatching", "running"].includes(currentStatus.state) && delegateSupervisorIsLive(currentStatus)) {
    return {
      accepted: false,
      status: currentStatus,
    };
  }

  config = await writeDelegateConfig(projectDetails.path, {
    ...config,
    enabled: true,
  }, normalizedLaneId);
  const laneConflict = await classifyDelegateLaneStart(projectDetails.path, config);
  if (laneConflict.level === "unsafe") {
    const blockedConfig = await writeDelegateConfig(projectDetails.path, {
      ...config,
      enabled: false,
    }, normalizedLaneId);
    const blockedStatus = await writeDelegateStatus(projectDetails.path, {
      laneId: normalizedLaneId,
      state: "blocked",
      runId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      delegateSessionId: blockedConfig.delegateSessionId,
      stepCount: 0,
      maxSteps: blockedConfig.maxStepsPerRun,
      stopReason: "needs_human",
      pauseRequested: false,
      lastOutcomeSummary: "Delegate lane start was blocked by an unsafe overlapping active lane.",
      nextAction: "Narrow this lane scope or pause the overlapping lane before starting.",
      error: `Unsafe delegate lane overlap: ${laneConflict.overlappingLanes.join(", ")}`,
    }, normalizedLaneId);
    await appendDelegateRunEvent(projectDetails.path, blockedStatus.runId, "run_blocked", {
      title: "Unsafe lane overlap",
      text: blockedStatus.error,
      state: blockedStatus.state,
      stopReason: blockedStatus.stopReason,
      payload: laneConflict,
    }, normalizedLaneId).catch(() => {});
    return {
      accepted: false,
      status: blockedStatus,
    };
  }
  const computeGuard = await evaluateDelegateComputeGuard(config);
  if (computeGuard.blocked) {
    const blockedConfig = await writeDelegateConfig(projectDetails.path, {
      ...config,
      enabled: false,
    }, normalizedLaneId);
    const blockedStatus = await writeDelegateStatus(projectDetails.path, {
      laneId: normalizedLaneId,
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
    }, normalizedLaneId);
    await appendDelegateRunEvent(projectDetails.path, blockedStatus.runId, "run_blocked", {
      title: "Paused near compute reserve",
      text: delegateComputeBudgetLogText(computeGuard.budget) || computeGuard.message,
      state: blockedStatus.state,
      stopReason: "compute_limit",
      computeBudget: computeGuard.budget,
    }, normalizedLaneId).catch(() => {});
    return {
      accepted: false,
      status: blockedStatus,
    };
  }

  const ensured = await ensureDelegateSession(projectDetails, config);
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const baselineMailboxStatus = await readMailboxStatus(projectDetails.path, normalizedLaneId);
  const initialStatus = await writeDelegateStatus(projectDetails.path, {
    laneId: normalizedLaneId,
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
    activeStep: null,
    lastRequestId: pickString(baselineMailboxStatus.request_id) || null,
    supervisorPid: null,
    supervisorStartedAt: null,
    pauseRequested: false,
    error: "",
  }, normalizedLaneId);

  return startDelegateSupervisorProcess(ensured.projectDetails, initialStatus, normalizedLaneId);
}

async function resumeActiveDelegateSupervisors() {
  const projects = await loadProjectCatalogCached().catch(() => []);
  for (const project of projects) {
    if (!project?.path) {
      continue;
    }
    const laneIds = await laneIdsForProject(project.path).catch(() => [defaultDelegateLaneId]);
    for (const laneId of laneIds) {
      try {
        const [config, status] = await Promise.all([
          readDelegateConfig(project.path, laneId),
          readDelegateStatus(project.path, { reconcile: false, laneId }),
        ]);
        if (delegateStatusNeedsSupervisor(status, config)) {
          await startDelegateRun(project, laneId);
        }
      } catch (error) {
        await appendDelegateRunEvent(project.path, null, "supervisor_resume_failed", {
          title: "Supervisor resume failed",
          laneId,
          error: error.message,
        }, laneId).catch(() => {});
      }
    }
  }
}

async function handleDelegateGet(_req, res, options, url, actor) {
  const project = (url.searchParams.get("project") || options.defaultProject || "").trim();
  const laneId = normalizeDelegateLaneId(url.searchParams.get("lane") || url.searchParams.get("laneId"));
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
    const payload = await buildDelegatePayload(resolved.projectDetails, laneId);
    json(res, 200, {
      ok: true,
      actor,
      project: resolved.projectPath,
      laneId,
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

async function handleDelegateLanesGet(_req, res, options, url, actor) {
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
    const lanes = await readDelegateLanes(resolved.projectPath);
    json(res, 200, {
      ok: true,
      actor,
      project: resolved.projectPath,
      projectDetails: resolved.projectDetails,
      lanes,
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
  const laneId = normalizeDelegateLaneId(payload.lane || payload.laneId);
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
    await writeDelegateBrief(resolved.projectPath, brief, resolved.projectDetails, laneId);
    const configPatch = payload.config && typeof payload.config === "object" ? payload.config : {};
    if (
      configPatch.computeReservePercent != null ||
      payload.computeReservePercent != null ||
      configPatch.maxStepsPerRun != null ||
      payload.maxStepsPerRun != null ||
      configPatch.watchtowerReviewMode != null ||
      payload.watchtowerReviewMode != null ||
      configPatch.directionCheckMode != null ||
      payload.directionCheckMode != null
    ) {
      const currentConfig = await readDelegateConfig(resolved.projectPath, laneId);
      await writeDelegateConfig(resolved.projectPath, {
        ...currentConfig,
        computeReservePercent:
          configPatch.computeReservePercent ?? payload.computeReservePercent ?? currentConfig.computeReservePercent,
        maxStepsPerRun:
          configPatch.maxStepsPerRun ?? payload.maxStepsPerRun ?? currentConfig.maxStepsPerRun,
        watchtowerReviewMode:
          configPatch.watchtowerReviewMode ?? payload.watchtowerReviewMode ?? currentConfig.watchtowerReviewMode,
        directionCheckMode:
          configPatch.directionCheckMode ?? payload.directionCheckMode ?? currentConfig.directionCheckMode,
      }, laneId);
    }
    const delegatePayload = await buildDelegatePayload(resolved.projectDetails, laneId);
    json(res, 200, {
      ok: true,
      actor,
      project: resolved.projectPath,
      laneId,
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
  const laneId = normalizeDelegateLaneId(payload.lane || payload.laneId);
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
    const startResult = await startDelegatePlanGeneration(resolved.projectDetails, laneId);
    const delegatePayload = await buildDelegatePayload(resolved.projectDetails, laneId);
    json(res, 202, {
      ok: true,
      actor,
      project: resolved.projectPath,
      laneId,
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
  const laneId = normalizeDelegateLaneId(payload.lane || payload.laneId);
  const requestedAction = pickString(payload.action, "start").toLowerCase();
  const action = requestedAction === "stop" ? "pause" : requestedAction;
  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
    return;
  }
  if (!["start", "pause"].includes(action)) {
    json(res, 400, { ok: false, error: "action must be 'start', 'pause', or 'stop'" });
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
      const pauseResult = await pauseDelegateRun(resolved.projectDetails, laneId);
      const delegatePayload = await buildDelegatePayload(resolved.projectDetails, laneId);
      json(res, 200, {
        ok: true,
        actor,
        action,
        project: resolved.projectPath,
        laneId,
        projectDetails: resolved.projectDetails,
        ...delegatePayload,
        accepted: pauseResult.accepted,
        config: pauseResult.config,
        status: pauseResult.status,
      });
      return;
    }

    const startResult = await startDelegateRun(resolved.projectDetails, laneId);
    const delegatePayload = await buildDelegatePayload(resolved.projectDetails, laneId);
    json(res, 202, {
      ok: true,
      actor,
      action,
      project: resolved.projectPath,
      laneId,
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

async function handleDelegateSupervise(req, res, options, actor) {
  let payload;
  try {
    payload = await parseDispatchPayload(req, options.bodyLimitBytes);
  } catch (error) {
    json(res, 400, { ok: false, error: error.message });
    return;
  }

  const project = projectFromPayload(payload, options.defaultProject);
  const laneId = normalizeDelegateLaneId(payload.lane || payload.laneId);
  const action = pickString(payload.action, payload.dryRun ? "preview" : "start").toLowerCase();
  const intervalSeconds = Math.max(1, Number.parseInt(String(payload.intervalSeconds || payload.interval || "10"), 10) || 10);
  const maxRuns = normalizeOptionalPositiveInteger(payload.maxRuns ?? null, { max: 10_000 });
  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
    return;
  }
  if (!["preview", "start", "stop"].includes(action)) {
    json(res, 400, { ok: false, error: "action must be 'preview', 'start', or 'stop'" });
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
    if (action === "preview") {
      const preview = await runDelegateSupervisorTick(resolved, laneId, {
        intervalSeconds,
        maxRuns,
        dryRun: true,
        once: true,
        keepRunning: false,
      });
      const delegatePayload = await buildDelegatePayload(resolved.projectDetails, laneId);
      json(res, 200, {
        ok: true,
        previewOk: preview.ok,
        actor,
        action,
        project: resolved.projectPath,
        laneId,
        projectDetails: resolved.projectDetails,
        supervisorPreview: preview,
        ...delegatePayload,
      });
      return;
    }

    if (action === "stop") {
      const stopResult = await stopDelegateContinuitySupervisor(resolved.projectDetails, laneId, {
        pauseWorker: boolFromUnknown(payload.pauseWorker, true),
        reason: "Supervisor stopped from the Clawdad app.",
      });
      const delegatePayload = await buildDelegatePayload(resolved.projectDetails, laneId);
      json(res, 200, {
        ok: true,
        actor,
        action,
        project: resolved.projectPath,
        laneId,
        projectDetails: resolved.projectDetails,
        accepted: stopResult.accepted,
        ...delegatePayload,
        supervisor: delegateSupervisorStateForPayload(stopResult.supervisor),
        status: stopResult.pauseResult?.status || delegatePayload.status,
      });
      return;
    }

    const startResult = await startDelegateSupervisorDaemon(resolved, laneId, {
      intervalSeconds,
      maxRuns,
      dryRun: false,
      once: false,
    });
    const delegatePayload = await buildDelegatePayload(resolved.projectDetails, laneId);
    json(res, 202, {
      ok: true,
      actor,
      action,
      project: resolved.projectPath,
      laneId,
      projectDetails: resolved.projectDetails,
      accepted: startResult.accepted,
      ...delegatePayload,
      supervisor: startResult.supervisor,
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
  const laneId = normalizeDelegateLaneId(url.searchParams.get("lane") || url.searchParams.get("laneId"));
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
      readDelegateStatus(resolved.projectPath, { laneId }),
      readDelegateRunSummarySnapshots(resolved.projectPath, laneId),
    ]);
    const delegateRuns = await readDelegateRunList(resolved.projectPath, {
      status,
      summarySnapshots,
      laneId,
    });
    const runId =
      requestedRunId ||
      pickString(status.runId) ||
      pickString(summarySnapshots[0]?.runId);
    const page = await readDelegateRunEvents(resolved.projectPath, {
      runId,
      cursor,
      limit,
      laneId,
    });
    const resolvedRunId = page.runId || runId || "";
    const statusEvent = delegateStatusRunEvent(status, resolvedRunId, page.events);
    const events = statusEvent ? [...page.events, statusEvent] : page.events;
    json(res, 200, {
      ok: true,
      actor,
      project: resolved.projectPath,
      laneId,
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

async function handleDelegateFeedGet(_req, res, options, url, actor) {
  const project = (url.searchParams.get("project") || options.defaultProject || "").trim();
  const laneId = normalizeDelegateLaneId(url.searchParams.get("lane") || url.searchParams.get("laneId"));
  const mode = pickString(url.searchParams.get("mode"), "review").toLowerCase();
  const query = pickString(url.searchParams.get("q"), url.searchParams.get("query"));
  const limit = watchtowerLimit(url.searchParams.get("limit"), mode === "review" ? 30 : 40);

  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
    return;
  }
  if (!["tail", "search", "review"].includes(mode)) {
    json(res, 400, { ok: false, actor, error: "mode must be tail, search, or review" });
    return;
  }
  if (mode === "search" && !query) {
    json(res, 400, { ok: false, actor, error: "missing search query" });
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
    const scan = await runWatchtowerScan(resolved.projectPath, laneId);
    const events = mode === "tail"
      ? await readWatchtowerTail(resolved.projectPath, { limit, laneId })
      : mode === "search"
        ? await searchWatchtowerFeed(resolved.projectPath, query, { limit, laneId })
        : [];
    const cards = mode === "review"
      ? await readWatchtowerReviewCards(resolved.projectPath, { limit, laneId })
      : await readWatchtowerReviewCards(resolved.projectPath, { limit: 12, laneId });
    json(res, 200, {
      ok: true,
      actor,
      mode,
      query,
      project: resolved.projectPath,
      laneId,
      projectDetails: resolved.projectDetails,
      scan,
      events,
      cards,
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
  const laneId = normalizeDelegateLaneId(payload.lane || payload.laneId);
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
      readDelegateStatus(resolved.projectPath, { laneId }),
      readDelegateRunSummarySnapshots(resolved.projectPath, laneId),
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

    const result = await generateDelegateRunSummarySnapshot(resolved.projectDetails, runId, laneId);
    json(res, 200, {
      ok: true,
      actor,
      project: resolved.projectPath,
      laneId,
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

async function handleRecentHistory(_req, res, options, url, actor) {
  const project = (url.searchParams.get("project") || "").trim();
  const limit = boundedPositiveInteger(
    url.searchParams.get("limit"),
    recentHistoryDefaultLimit,
    { max: recentHistoryMaxLimit },
  );
  const sessionLimit = boundedPositiveInteger(
    url.searchParams.get("sessionLimit"),
    recentHistoryDefaultSessionLimit,
    { max: recentHistoryMaxSessionLimit },
  );
  const perSessionLimit = boundedPositiveInteger(
    url.searchParams.get("perSessionLimit"),
    recentHistoryDefaultPerSessionLimit,
    { max: recentHistoryMaxPerSessionLimit },
  );

  let projects;
  try {
    projects = await loadProjectCatalogCached();
  } catch (error) {
    json(res, 500, { ok: false, actor, error: error.message });
    return;
  }

  let targetProjects = projects;
  let projectPath = "";
  if (project) {
    projectPath = await resolveProjectPathForRequest(project, options.defaultProject);
    if (!projectPath) {
      json(res, 404, { ok: false, actor, error: `project '${project}' is not tracked` });
      return;
    }
    targetProjects = projects.filter((entry) => entry.path === projectPath);
  }

  try {
    const items = await readRecentHistoryItems(targetProjects, {
      limit,
      sessionLimit,
      perSessionLimit,
    });
    json(res, 200, {
      ok: true,
      actor,
      project: projectPath || null,
      limit,
      sessionLimit,
      perSessionLimit,
      total: items.length,
      items,
    });
  } catch (error) {
    json(res, 500, {
      ok: false,
      actor,
      project: projectPath || null,
      error: error.message,
    });
  }
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

  const limit = boundedPositiveInteger(limitValue, 20, { max: 50 });

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

function plistEnvDict(entries) {
  return Array.from(entries.entries())
    .map(([key, value]) => `    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>`)
    .join("\n");
}

function launchAgentEnvironment(envPath) {
  const entries = new Map([["PATH", envPath]]);
  if (process.env.CLAWDAD_CHIMERA || path.isAbsolute(defaultChimeraBinary)) {
    entries.set("CLAWDAD_CHIMERA", defaultChimeraBinary);
  }
  entries.set("CLAWDAD_CHIMERA_MODEL", defaultChimeraModel);
  if (process.env.OLLAMA_BASE_URL) {
    entries.set("OLLAMA_BASE_URL", process.env.OLLAMA_BASE_URL);
  }
  for (const key of [
    "CLAWDAD_CHIMERA_LOCAL_OLLAMA_BASE_URL",
    "CLAWDAD_CHIMERA_4090_OLLAMA_BASE_URL",
    "CLAWDAD_CHIMERA_WORKSTATION_OLLAMA_BASE_URL",
    "CLAWDAD_OLLAMA_LOCAL_BASE_URL",
    "CLAWDAD_OLLAMA_4090_BASE_URL",
    "CLAWDAD_OLLAMA_WORKSTATION_BASE_URL",
  ]) {
    if (process.env[key]) {
      entries.set(key, process.env[key]);
    }
  }
  return entries;
}

function renderLaunchAgentPlist(options) {
  const label = options.launchAgentLabel || launchAgentLabelDefault;
  const envPath = process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin";
  const args = buildServeArgs(options);
  const envEntries = launchAgentEnvironment(envPath);

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
${plistEnvDict(envEntries)}
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

async function fetchUrlHealth(url, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      resolve({ ok: false, statusCode: 0, payload: null, error: error.message });
      return;
    }

    const client = parsed.protocol === "https:" ? https : parsed.protocol === "http:" ? http : null;
    if (!client) {
      resolve({ ok: false, statusCode: 0, payload: null, error: `unsupported protocol ${parsed.protocol}` });
      return;
    }

    const req = client.get(
      {
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname || "/"}${parsed.search || ""}`,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch (_error) {
            payload = null;
          }
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            statusCode: res.statusCode,
            payload,
            raw,
          });
        });
      },
    );

    req.on("error", (error) => resolve({ ok: false, statusCode: 0, payload: null, error: error.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, statusCode: 0, payload: null, error: "timeout" });
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

function tailscaleWebRouteNames(status) {
  const names = [];
  const web = status?.Web && typeof status.Web === "object" && !Array.isArray(status.Web)
    ? status.Web
    : {};
  names.push(...Object.keys(web));

  const services = status?.Services && typeof status.Services === "object" && !Array.isArray(status.Services)
    ? status.Services
    : {};
  for (const service of Object.values(services)) {
    const serviceWeb = service?.Web && typeof service.Web === "object" && !Array.isArray(service.Web)
      ? service.Web
      : {};
    names.push(...Object.keys(serviceWeb));
  }

  return [...new Set(names)].sort();
}

function tailscalePublicFunnelRouteNames(status) {
  const allowFunnel =
    status?.AllowFunnel && typeof status.AllowFunnel === "object" && !Array.isArray(status.AllowFunnel)
      ? status.AllowFunnel
      : {};
  return Object.entries(allowFunnel)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([name]) => name)
    .sort();
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

    if (req.method === "GET" && url.pathname === "/v1/quick-prompts") {
      await handleQuickPromptsGet(req, res, options, url, auth.actor);
      return;
    }

    if (req.method === "PUT" && url.pathname === "/v1/quick-prompts") {
      await handleQuickPromptsPut(req, res, options, auth.actor);
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

    if (req.method === "POST" && url.pathname === "/v1/tts/message") {
      await handleTtsMessageCreate(req, res, options, auth.actor);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/tts/audio") {
      await handleTtsAudioGet(req, res, options, url, auth.actor);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/artifacts/share") {
      json(res, 404, { ok: false, actor: auth.actor, error: "artifact share links are disabled" });
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/artifacts/revoke") {
      json(res, 404, { ok: false, actor: auth.actor, error: "artifact share links are disabled" });
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

    if (req.method === "GET" && url.pathname === "/v1/codex-integration") {
      await handleCodexIntegrationGet(req, res, options, url, auth.actor);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/codex-integration/install") {
      await handleCodexIntegrationInstall(req, res, options, auth.actor);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/project-summary") {
      await handleProjectSummaryCreate(req, res, options, auth.actor);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/delegate/lanes") {
      await handleDelegateLanesGet(req, res, options, url, auth.actor);
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

    if (req.method === "POST" && url.pathname === "/v1/delegate/supervise") {
      await handleDelegateSupervise(req, res, options, auth.actor);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/delegate/run-log") {
      await handleDelegateRunLogGet(req, res, options, url, auth.actor);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/delegate/feed") {
      await handleDelegateFeedGet(req, res, options, url, auth.actor);
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

    if (req.method === "GET" && url.pathname === "/v1/history/recent") {
      await handleRecentHistory(req, res, options, url, auth.actor);
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
  let durableServiceHostReady = false;

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
    const tailnetSuffix = stripTrailingDot(tailscaleStatus?.MagicDNSSuffix || "");
    checks.push(
      formatCheck(
        "pass",
        "Tailscale",
        `${login || "unknown user"} on ${dnsName || "unknown device"}`,
      ),
    );

    const cliVersion = await getTailscaleCliVersion();
    const daemonVersion = pickString(tailscaleStatus?.Version);
    const cliSemver = firstSemver(cliVersion);
    const daemonSemver = firstSemver(daemonVersion);
    if (cliSemver && daemonSemver && cliSemver !== daemonSemver) {
      checks.push(
        formatCheck(
          "warn",
          "Tailscale CLI",
          `client ${cliSemver} differs from daemon ${daemonSemver}`,
        ),
      );
    } else if (cliSemver || daemonSemver) {
      checks.push(
        formatCheck(
          "pass",
          "Tailscale CLI",
          cliSemver && daemonSemver ? `client and daemon ${cliSemver}` : cliVersion || daemonVersion,
        ),
      );
    }

    const keyExpiry = pickString(tailscaleStatus?.Self?.KeyExpiry);
    const keyExpiryDays = daysUntilIso(keyExpiry);
    if (keyExpiryDays != null && keyExpiryDays < 0) {
      checks.push(formatCheck("fail", "Tailscale key expiry", `expired ${Math.abs(keyExpiryDays)} days ago`));
    } else if (keyExpiryDays != null && keyExpiryDays <= 45) {
      checks.push(formatCheck("warn", "Tailscale key expiry", `expires in ${keyExpiryDays} days (${keyExpiry})`));
    } else if (keyExpiryDays != null) {
      checks.push(formatCheck("pass", "Tailscale key expiry", `expires in ${keyExpiryDays} days`));
    } else {
      checks.push(formatCheck("warn", "Tailscale key expiry", "could not determine node key expiry"));
    }

    const tags = tailscaleSelfTags(tailscaleStatus);
    const serviceHostCap = tailscaleServiceHostCap(tailscaleStatus);
    if (options.tailscaleServiceHostSocket) {
      checks.push(
        formatCheck(
          "pass",
          "Primary Tailscale node",
          "left user-owned; isolated service host configured",
        ),
      );

      try {
        const serviceHostStatus = await getTailscaleStatus(options.tailscaleServiceHostSocket);
        const serviceHostBackend = pickString(serviceHostStatus?.BackendState);
        const serviceHostTags = tailscaleSelfTags(serviceHostStatus);
        const serviceHostHasCap = tailscaleServiceHostCap(serviceHostStatus);
        const serviceHostAuthUrl = pickString(serviceHostStatus?.AuthURL);
        durableServiceHostReady =
          serviceHostBackend === "Running" &&
          (serviceHostTags.includes(options.tailscaleServiceHostTag) || Boolean(serviceHostHasCap));

        if (durableServiceHostReady) {
          checks.push(
            formatCheck(
              "pass",
              "Durable service host",
              serviceHostTags.length > 0 ? serviceHostTags.join(", ") : "service-host capability present",
            ),
          );
        } else if (serviceHostBackend === "NeedsLogin") {
          checks.push(
            formatCheck(
              "warn",
              "Durable service host",
              serviceHostAuthUrl ? `pending login: ${serviceHostAuthUrl}` : "pending login",
            ),
          );
        } else if (serviceHostBackend) {
          checks.push(
            formatCheck(
              "warn",
              "Durable service host",
              `${serviceHostBackend}; expected ${options.tailscaleServiceHostTag}`,
            ),
          );
        } else {
          checks.push(formatCheck("warn", "Durable service host", "not authenticated yet"));
        }
      } catch (error) {
        checks.push(formatCheck("warn", "Durable service host", error.message));
      }
    } else if (tags.includes(options.tailscaleServiceHostTag) || serviceHostCap) {
      durableServiceHostReady = true;
      checks.push(
        formatCheck(
          "pass",
          "Tailscale Service host",
          serviceHostCap ? "service-host capability present" : `tagged as ${options.tailscaleServiceHostTag}`,
        ),
      );
    } else {
      checks.push(
        formatCheck(
          "warn",
          "Tailscale Service host",
          `current node is not tagged; durable Services need ${options.tailscaleServiceHostTag}`,
        ),
      );
    }

    const serveStatus = await getTailscaleServeStatus();
    const serveRoutes = tailscaleWebRouteNames(serveStatus);
    let durableServeRoutes = [];
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

    if (options.tailscaleServiceHostSocket && durableServiceHostReady) {
      try {
        const durableServeStatus = await getTailscaleServeStatus(options.tailscaleServiceHostSocket);
        durableServeRoutes = tailscaleWebRouteNames(durableServeStatus);
        checks.push(
          durableServeRoutes.length > 0
            ? formatCheck(
                "pass",
                "Durable Serve",
                `configured Service routes: ${durableServeRoutes.join(", ")}`,
              )
            : formatCheck("warn", "Durable Serve", "no Service web routes configured"),
        );
      } catch (error) {
        checks.push(formatCheck("warn", "Durable Serve", error.message));
      }
    }

    const expectedLiveRoutes = new Set(options.liveApps.map((app) => routeNameFromUrl(app.url)).filter(Boolean));
    const surfaceRoutes = options.tailscaleServiceHostSocket ? durableServeRoutes : serveRoutes;
    const surfaceLabel = options.tailscaleServiceHostSocket ? "Durable Serve surface" : "Serve surface";
    const unexpectedServeRoutes =
      expectedLiveRoutes.size > 0
        ? surfaceRoutes.filter((routeName) => !expectedLiveRoutes.has(routeName))
        : surfaceRoutes.slice(1);
    const missingLiveRoutes =
      expectedLiveRoutes.size > 0
        ? [...expectedLiveRoutes].filter((routeName) => !surfaceRoutes.includes(routeName))
        : [];
    if (expectedLiveRoutes.size > 0 && unexpectedServeRoutes.length === 0 && missingLiveRoutes.length === 0) {
      checks.push(
        formatCheck(
          "pass",
          surfaceLabel,
          `configured routes match live app set: ${surfaceRoutes.join(", ")}`,
        ),
      );
    } else if (expectedLiveRoutes.size > 0 && missingLiveRoutes.length > 0) {
      checks.push(
        formatCheck(
          "fail",
          surfaceLabel,
          `missing expected routes: ${missingLiveRoutes.join(", ")}`,
        ),
      );
    } else if (surfaceRoutes.length <= 1) {
      checks.push(
        formatCheck(
          "pass",
          surfaceLabel,
          surfaceRoutes.length === 0 ? "no extra web routes" : `single web route: ${surfaceRoutes[0]}`,
        ),
      );
    } else {
      checks.push(
        formatCheck(
          "warn",
          surfaceLabel,
          `multiple web routes configured: ${surfaceRoutes.join(", ")}`,
        ),
      );
    }

    const funnelStatus = await getTailscaleFunnelStatus();
    const publicFunnelRoutes = tailscalePublicFunnelRouteNames(funnelStatus);
    checks.push(
      publicFunnelRoutes.length === 0
        ? formatCheck("pass", "Public Funnel", "no public Funnel routes enabled")
        : formatCheck(
            "fail",
            "Public Funnel",
            `public Funnel enabled: ${publicFunnelRoutes.join(", ")}`,
          ),
    );

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

    if (options.liveApps.length > 0) {
      for (const app of options.liveApps) {
        const health = await fetchUrlHealth(app.url);
        checks.push(
          health.ok
            ? formatCheck(
                "pass",
                `Live app ${app.name}`,
                `${app.url} responded ${health.statusCode}`,
              )
            : formatCheck(
                "fail",
                `Live app ${app.name}`,
                `${app.url} failed${health.error ? `: ${health.error}` : ""}`,
              ),
        );

        const serviceUrl = serviceUrlFromLiveApp(app, tailnetSuffix);
        if (serviceUrl) {
          checks.push(
            durableServiceHostReady
              ? formatCheck("pass", `Durable URL ${app.name}`, serviceUrl)
              : formatCheck(
                  "warn",
                  `Durable URL ${app.name}`,
                  `${serviceUrl} pending tagged Service host migration`,
                ),
          );
        }
      }
    }
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
    case "lanes":
      await runLanes(rest);
      break;
    case "lane-create":
      await runLaneCreate(rest);
      break;
    case "delegate":
      await runDelegateGet(rest);
      break;
    case "delegate-set":
      await runDelegateSet(rest);
      break;
    case "go":
    case "delegate-run":
    case "delegate-start":
      await runDelegateRun(rest);
      break;
    case "supervise":
      await runDelegateSupervise(rest);
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
    case "sessions-doctor":
    case "session-doctor":
      await runSessionsDoctor(rest);
      break;
    case "codex":
      await runCodexIntegration(rest);
      break;
    case "codex-hook":
      await runCodexHook(rest);
      break;
    case "watchtower":
      await runWatchtower(rest);
      break;
    case "feed":
      await runFeed(rest);
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
