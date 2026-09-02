#!/usr/bin/env node

import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import WebSocket from "ws";
import { acquireCodexDeliveryClaim } from "./codex-delivery-claim.mjs";
import {
  codexSharedSocketPath,
  codexSharedWebSocketUrl,
  ensureCodexSharedRuntime,
  normalizeCodexAppServerMode,
} from "./codex-shared-runtime.mjs";
import { extractAgentMessageText, selectCodexTurnResultText } from "./codex-turn-result.mjs";
import {
  redactSensitiveText,
  redactSensitiveValue,
} from "./privacy-redaction.mjs";

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function parseNonNegativeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function parseOptionalNonNegativeNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeGoalMode(value) {
  const mode = String(value || "auto").trim().toLowerCase();
  if (["auto", "off", "required"].includes(mode)) {
    return mode;
  }
  return "auto";
}

function normalizeThreadGoalStatus(value, fallback = "active") {
  const status = String(value || "").trim();
  if (["active", "paused", "budgetLimited", "complete"].includes(status)) {
    return status;
  }
  return fallback;
}

function normalizeDispatchMode(value) {
  const mode = String(value || "direct").trim().toLowerCase();
  return ["queue", "queued", "next"].includes(mode) ? "queue" : "direct";
}

function parseArgs(argv) {
  const options = {
    projectPath: "",
    message: "",
    sessionId: "",
    threadGoal: String(process.env.CLAWDAD_CODEX_THREAD_GOAL || "").trim(),
    threadGoalStatus: normalizeThreadGoalStatus(process.env.CLAWDAD_CODEX_THREAD_GOAL_STATUS, "active"),
    threadGoalStatusSpecified: String(process.env.CLAWDAD_CODEX_THREAD_GOAL_STATUS || "").trim() !== "",
    threadGoalTokenBudget: parseOptionalNonNegativeNumber(process.env.CLAWDAD_CODEX_THREAD_GOAL_TOKEN_BUDGET),
    threadGoalClear: false,
    goalMode: normalizeGoalMode(process.env.CLAWDAD_CODEX_GOALS),
    goalOnly: false,
    eventLogFile: String(process.env.CLAWDAD_CODEX_EVENT_LOG_FILE || "").trim(),
    interjectionDir: "",
    attachmentManifest: "",
    attachmentInputs: [],
    permissionMode: "approve",
    codexBinary: process.env.CLAWDAD_CODEX || "codex",
    appServerMode: normalizeCodexAppServerMode(process.env.CLAWDAD_CODEX_APP_SERVER_MODE),
    appServerSocket: codexSharedSocketPath(process.env),
    requestId: String(process.env.CLAWDAD_DISPATCH_REQUEST_ID || "").trim(),
    dispatchMode: normalizeDispatchMode(process.env.CLAWDAD_DISPATCH_MODE),
    model: "",
    reasoningEffort: "",
    sessionSeeded: false,
    turnTimeoutMs: parseNonNegativeInteger(process.env.CLAWDAD_CODEX_TURN_TIMEOUT_MS, 0),
    turnIdleTimeoutMs: parseNonNegativeInteger(process.env.CLAWDAD_CODEX_TURN_IDLE_TIMEOUT_MS, 0),
    toolIdleTimeoutMs: parseNonNegativeInteger(process.env.CLAWDAD_CODEX_TOOL_IDLE_TIMEOUT_MS, 0),
    requestTimeoutMs: parseNonNegativeInteger(process.env.CLAWDAD_CODEX_REQUEST_TIMEOUT_MS, 120_000),
    resumeTimeoutMs: parseNonNegativeInteger(process.env.CLAWDAD_CODEX_RESUME_TIMEOUT_MS, 0),
    livenessIntervalMs: parseNonNegativeInteger(process.env.CLAWDAD_CODEX_LIVENESS_INTERVAL_MS, 30_000),
    livenessProbeTimeoutMs: parseNonNegativeInteger(process.env.CLAWDAD_CODEX_LIVENESS_PROBE_TIMEOUT_MS, 10_000),
    goalSyncTimeoutMs: parseNonNegativeInteger(process.env.CLAWDAD_CODEX_GOAL_SYNC_TIMEOUT_MS, 1500),
    experimentalApi:
      String(process.env.CLAWDAD_CODEX_EXPERIMENTAL_API || "").trim() === "1" ||
      String(process.env.CLAWDAD_CODEX_EXPERIMENTAL_API || "").trim().toLowerCase() === "true",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--project-path":
        options.projectPath = String(argv[index + 1] || "").trim();
        index += 1;
        break;
      case "--message":
        options.message = String(argv[index + 1] || "");
        index += 1;
        break;
      case "--session-id":
        options.sessionId = String(argv[index + 1] || "").trim();
        index += 1;
        break;
      case "--thread-goal":
        options.threadGoal = String(argv[index + 1] || "").trim();
        index += 1;
        break;
      case "--thread-goal-status":
        options.threadGoalStatus = normalizeThreadGoalStatus(argv[index + 1], options.threadGoalStatus);
        options.threadGoalStatusSpecified = true;
        index += 1;
        break;
      case "--thread-goal-token-budget":
        options.threadGoalTokenBudget = parseOptionalNonNegativeNumber(argv[index + 1]);
        index += 1;
        break;
      case "--clear-thread-goal":
        options.threadGoalClear = true;
        break;
      case "--goal-mode":
        options.goalMode = normalizeGoalMode(argv[index + 1]);
        index += 1;
        break;
      case "--goal-only":
        options.goalOnly = true;
        break;
      case "--event-log-file":
        options.eventLogFile = String(argv[index + 1] || "").trim();
        index += 1;
        break;
      case "--interjection-dir":
        options.interjectionDir = String(argv[index + 1] || "").trim();
        index += 1;
        break;
      case "--attachment-manifest":
        options.attachmentManifest = String(argv[index + 1] || "").trim();
        index += 1;
        break;
      case "--permission-mode":
        options.permissionMode = String(argv[index + 1] || "").trim() || options.permissionMode;
        index += 1;
        break;
      case "--codex-binary":
        options.codexBinary = String(argv[index + 1] || "").trim() || options.codexBinary;
        index += 1;
        break;
      case "--app-server-mode":
        options.appServerMode = normalizeCodexAppServerMode(argv[index + 1]);
        index += 1;
        break;
      case "--app-server-socket":
        options.appServerSocket = path.resolve(String(argv[index + 1] || "").trim() || options.appServerSocket);
        index += 1;
        break;
      case "--request-id":
        options.requestId = String(argv[index + 1] || "").trim();
        index += 1;
        break;
      case "--dispatch-mode":
        options.dispatchMode = normalizeDispatchMode(argv[index + 1]);
        index += 1;
        break;
      case "--model":
        options.model = String(argv[index + 1] || "").trim();
        index += 1;
        break;
      case "--reasoning-effort":
        options.reasoningEffort = String(argv[index + 1] || "").trim();
        index += 1;
        break;
      case "--turn-timeout-ms":
        options.turnTimeoutMs = parseNonNegativeInteger(argv[index + 1], options.turnTimeoutMs);
        index += 1;
        break;
      case "--turn-idle-timeout-ms":
        options.turnIdleTimeoutMs = parseNonNegativeInteger(argv[index + 1], options.turnIdleTimeoutMs);
        index += 1;
        break;
      case "--tool-idle-timeout-ms":
        options.toolIdleTimeoutMs = parseNonNegativeInteger(argv[index + 1], options.toolIdleTimeoutMs);
        index += 1;
        break;
      case "--request-timeout-ms":
        options.requestTimeoutMs = parseNonNegativeInteger(argv[index + 1], options.requestTimeoutMs);
        index += 1;
        break;
      case "--resume-timeout-ms":
        options.resumeTimeoutMs = parseNonNegativeInteger(argv[index + 1], options.resumeTimeoutMs);
        index += 1;
        break;
      case "--liveness-interval-ms":
        options.livenessIntervalMs = parseNonNegativeInteger(argv[index + 1], options.livenessIntervalMs);
        index += 1;
        break;
      case "--liveness-probe-timeout-ms":
        options.livenessProbeTimeoutMs = parseNonNegativeInteger(argv[index + 1], options.livenessProbeTimeoutMs);
        index += 1;
        break;
      case "--goal-sync-timeout-ms":
        options.goalSyncTimeoutMs = parseNonNegativeInteger(argv[index + 1], options.goalSyncTimeoutMs);
        index += 1;
        break;
      case "--session-seeded":
        options.sessionSeeded = true;
        break;
      case "--experimental-api":
        options.experimentalApi = true;
        break;
      default:
        break;
    }
  }

  return options;
}

function threadSandboxForPermission(permissionMode) {
  switch (permissionMode) {
    case "plan":
      return "read-only";
    case "full":
      return "danger-full-access";
    case "approve":
    default:
      return "workspace-write";
  }
}

function turnSandboxForPermission(permissionMode, projectPath) {
  switch (permissionMode) {
    case "plan":
      return {
        type: "readOnly",
        networkAccess: false,
      };
    case "full":
      return {
        type: "dangerFullAccess",
      };
    case "approve":
    default:
      return {
        type: "workspaceWrite",
        networkAccess: true,
        writableRoots: [projectPath],
      };
  }
}

function buildThreadParams(options) {
  const params = {
    cwd: options.projectPath,
    approvalPolicy: "never",
    sandbox: threadSandboxForPermission(options.permissionMode),
  };
  if (options.model) {
    params.model = options.model;
  }
  if (options.reasoningEffort) {
    params.config = {
      model_reasoning_effort: options.reasoningEffort,
    };
  }
  return params;
}

async function readAttachmentInputs(manifestPath) {
  const pathText = String(manifestPath || "").trim();
  if (!pathText) {
    return [];
  }

  const manifest = JSON.parse(await readFile(pathText, "utf8"));
  const attachments = Array.isArray(manifest?.attachments) ? manifest.attachments : [];
  return attachments
    .filter((attachment) => {
      const filePath = String(attachment?.path || "").trim();
      const mimeType = String(attachment?.mimeType || "").trim().toLowerCase();
      const kind = String(attachment?.kind || "").trim().toLowerCase();
      return Boolean(filePath) && (kind === "image" || mimeType.startsWith("image/"));
    })
    .map((attachment) => ({
      type: "localImage",
      path: String(attachment.path).trim(),
    }));
}

function buildUserInput(message, attachmentInputs = []) {
  return [
    {
      type: "text",
      text: message,
      text_elements: [],
    },
    ...(Array.isArray(attachmentInputs) ? attachmentInputs : []),
  ];
}

function buildTurnParams(threadId, options) {
  const params = {
    threadId,
    cwd: options.projectPath,
    approvalPolicy: "never",
    input: buildUserInput(options.message, options.attachmentInputs),
    sandboxPolicy: turnSandboxForPermission(options.permissionMode, options.projectPath),
  };
  if (options.requestId) {
    params.clientUserMessageId = options.requestId;
  }
  if (options.model) {
    params.model = options.model;
  }
  if (options.reasoningEffort) {
    params.effort = options.reasoningEffort;
  }
  return params;
}

function describeError(error, fallback = "") {
  if (!error) {
    return fallback;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
}

function describeDispatchError(error, client) {
  const text = describeError(error, "Codex dispatch failed");
  if (
    client?.effectiveMode === "shared" &&
    /writer.*already|already.*writer|writer.*open|rollout.*locked|locked.*rollout/iu.test(text)
  ) {
    return [
      text,
      "This thread is still owned by a legacy standalone Codex CLI session. Close that one Codex session once, then reopen it from Clawdad (or run `clawdad codex-cli resume <thread-id>`). The conversation history stays intact, and future phone and Terminal messages will share one local writer.",
    ].join("\n\n");
  }
  return text;
}

function extractLastJsonCodeBlock(text) {
  const matches = [...String(text || "").matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const block = String(matches[index][1] || "").trim();
    if (!block) {
      continue;
    }
    try {
      return JSON.parse(block);
    } catch {
      // Keep walking backward; live streams can include scratch fenced blocks.
    }
  }
  return null;
}

function liveDecisionPayload(text) {
  const parsed = extractLastJsonCodeBlock(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const state = String(parsed.state || "").trim();
  if (!["continue", "blocked", "completed"].includes(state)) {
    return null;
  }
  return parsed;
}

function compactString(value, maxLength = 2400) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 20)}... [truncated]`;
}

function compactCommandText(value) {
  if (Array.isArray(value)) {
    return value.map((part) => String(part || "")).filter(Boolean).join(" ");
  }
  return typeof value === "string" ? value : "";
}

function compactItemLabel(item = {}) {
  const type = String(item.type || "").trim();
  const name = String(item.name || item.toolName || item.tool_name || "").trim();
  if (name) {
    return name;
  }
  switch (type) {
    case "agentMessage":
      return "Assistant";
    case "commandExecution":
      return "Command";
    case "fileChange":
      return "File change";
    case "mcpToolCall":
    case "dynamicToolCall":
    case "toolCall":
      return "Tool";
    default:
      return type ? type.replace(/([a-z])([A-Z])/gu, "$1 $2") : "";
  }
}

function compactThreadGoal(goal) {
  if (!goal || typeof goal !== "object") {
    return null;
  }
  return {
    threadId: String(goal.threadId || "").trim() || null,
    objective: compactString(goal.objective, 2000),
    status: goal.status || null,
    tokenBudget: goal.tokenBudget ?? null,
    tokensUsed: goal.tokensUsed ?? null,
    timeUsedSeconds: goal.timeUsedSeconds ?? null,
    createdAt: goal.createdAt ?? null,
    updatedAt: goal.updatedAt ?? null,
  };
}

function compactCodexEventPayload(message) {
  const method = String(message?.method || message?.type || "");
  const params = message?.params && typeof message.params === "object" ? message.params : {};
  const item = params.item && typeof params.item === "object" ? params.item : {};

  if (method === "item/agentMessage/delta") {
    return {
      delta: compactString(params.delta, 4000),
    };
  }

  if (method === "item/completed" && item.type === "agentMessage") {
    return {
      phase: item.phase || null,
      text: compactString(item.text, 8000),
    };
  }

  if (method === "item/commandExecution/requestApproval") {
    return {
      reason: compactString(params.reason, 1000),
      command: Array.isArray(params.command) ? params.command : null,
      commandText: compactString(compactCommandText(params.command), 2000),
      cwd: typeof params.cwd === "string" ? params.cwd : null,
      availableDecisions: Array.isArray(params.availableDecisions) ? params.availableDecisions : null,
    };
  }

  if (method === "item/fileChange/requestApproval") {
    return {
      reason: compactString(params.reason, 1000),
      grantRoot: typeof params.grantRoot === "string" ? params.grantRoot : null,
    };
  }

  if (method === "turn/completed") {
    return {
      status: params.turn?.status || null,
      error: params.turn?.error || null,
    };
  }

  if (method === "clawdad/turn/liveness") {
    return {
      alive: Boolean(params.alive),
      turnStatus: params.turnStatus || null,
      phase: params.phase || null,
      activeToolCalls: Number(params.activeToolCalls || 0),
      pendingServerRequests: Number(params.pendingServerRequests || 0),
      serverRequestMethods: Array.isArray(params.serverRequestMethods)
        ? params.serverRequestMethods.map((value) => compactString(value, 200))
        : [],
      checkedAt: params.checkedAt || null,
      error: compactString(params.error, 2000),
    };
  }

  if (method === "thread/goal/updated") {
    return {
      goal: compactThreadGoal(params.goal),
      objective: compactString(params.goal?.objective, 2000),
      status: params.goal?.status || null,
    };
  }

  if (method === "thread/goal/cleared") {
    return {
      threadId: String(params.threadId || "").trim() || null,
      cleared: true,
    };
  }

  if (method === "clawdad/goal/sync") {
    return {
      mode: params.mode || null,
      supported: params.supported ?? null,
      synced: Boolean(params.synced),
      skipped: Boolean(params.skipped),
      error: compactString(params.error, 2000),
      goal: compactThreadGoal(params.goal),
      requested: params.requested && typeof params.requested === "object"
        ? {
            threadId: String(params.requested.threadId || "").trim() || null,
            objective: compactString(params.requested.objective, 2000),
            status: params.requested.status || null,
            tokenBudget: params.requested.tokenBudget ?? null,
            clear: Boolean(params.requested.clear),
          }
        : null,
    };
  }

  if (method === "error") {
    const error = params.error && typeof params.error === "object" ? params.error : {};
    return {
      error: compactString(describeError(params.error || message.error || message), 2000),
      willRetry: codexErrorWillRetry(message),
      retryable: codexErrorWillRetry(message),
      codexErrorInfo:
        error.codexErrorInfo && typeof error.codexErrorInfo === "object"
          ? error.codexErrorInfo
          : null,
      additionalDetails: compactString(error.additionalDetails || params.additionalDetails, 2000),
    };
  }

  if (method.startsWith("item/")) {
    return {
      label: compactString(compactItemLabel(item), 500),
      itemType: item.type || null,
      status: item.status || null,
      name: compactString(item.name || item.toolName || item.tool_name || "", 500),
      text: compactString(item.text || item.output || item.error || "", 4000),
      command: Array.isArray(item.command) ? item.command : null,
      commandText: compactString(compactCommandText(item.command), 2000),
    };
  }

  if (message?.type === "parse_error") {
    return {
      error: describeError(message.error),
      raw: compactString(message.raw, 2000),
    };
  }

  return {};
}

function normalizeCodexAppServerEvent(message) {
  const method = String(message?.method || message?.type || "codex/event");
  const params = message?.params && typeof message.params === "object" ? message.params : {};
  const item = params.item && typeof params.item === "object" ? params.item : {};
  const threadId = String(params.threadId || item.threadId || "").trim() || null;
  const turnId = String(params.turnId || params.turn?.id || item.turnId || "").trim() || null;
  const itemId = String(params.itemId || item.id || "").trim() || null;
  let type = "codex_event";

  if (message?.type === "parse_error") {
    type = "codex_parse_error";
  } else if (method === "error") {
    type = "codex_error";
  } else if (method === "clawdad/goal/sync") {
    type = "codex_goal_sync";
  } else if (method === "thread/goal/updated") {
    type = "codex_thread_goal_updated";
  } else if (method === "thread/goal/cleared") {
    type = "codex_thread_goal_cleared";
  } else if (method === "thread/started" || method === "thread/status/changed") {
    type = "codex_thread";
  } else if (method === "turn/started") {
    type = "codex_turn_started";
  } else if (method === "turn/completed") {
    type = "codex_turn_completed";
  } else if (method === "item/agentMessage/delta") {
    type = "codex_agent_message_delta";
  } else if (method === "item/completed" && item.type === "agentMessage") {
    type = "codex_agent_message";
  } else if (method.endsWith("/requestApproval") || method === "item/tool/requestUserInput") {
    type = "codex_approval_request";
  } else if (method.startsWith("item/")) {
    type = "codex_item";
  }

  return {
    at: new Date().toISOString(),
    type,
    method,
    threadId,
    turnId,
    itemId,
    itemType: item.type || null,
    status: params.turn?.status || item.status || null,
    payload: redactSensitiveValue(compactCodexEventPayload(message)),
  };
}

function createCodexEventRecorder(eventLogFile) {
  const filePath = String(eventLogFile || "").trim();
  let pending = Promise.resolve();

  async function appendEvent(message) {
    if (!filePath) {
      return;
    }
    const event = normalizeCodexAppServerEvent(message);
    pending = pending
      .then(async () => {
        await mkdir(path.dirname(filePath), { recursive: true });
        await appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
      })
      .catch(() => {});
    await pending;
  }

  return {
    record(message) {
      void appendEvent(message);
    },
    async flush() {
      await pending;
    },
  };
}

function createLiveReporter() {
  const eventFile = String(process.env.CLAWDAD_CODEX_LIVE_EVENT_FILE || "").trim();
  const runId = String(process.env.CLAWDAD_CODEX_LIVE_RUN_ID || "").trim();
  const rawStep = Number.parseInt(String(process.env.CLAWDAD_CODEX_LIVE_STEP || "0"), 10);
  const step = Number.isFinite(rawStep) && rawStep > 0 ? rawStep : null;
  const minIntervalMs = 5000;
  const minDeltaChars = 160;
  const maxTextChars = 2200;
  let lastText = "";
  let lastWriteAt = 0;
  let pending = Promise.resolve();

  async function appendEvent(text, { force = false } = {}) {
    if (!eventFile || !runId) {
      return;
    }

    const cleanText = redactSensitiveText(text).trim();
    if (!cleanText) {
      return;
    }

    const now = Date.now();
    if (
      !force &&
      now - lastWriteAt < minIntervalMs &&
      Math.abs(cleanText.length - lastText.length) < minDeltaChars
    ) {
      return;
    }

    lastText = cleanText;
    lastWriteAt = now;
    const eventText =
      cleanText.length > maxTextChars
        ? `...\n${cleanText.slice(-maxTextChars)}`
        : cleanText;
    const decision = force ? liveDecisionPayload(cleanText) : null;
    const event = {
      id: `live-${runId}${step ? `-${step}` : ""}`,
      at: new Date().toISOString(),
      type: "agent_live",
      runId,
      step,
      title: force ? "Live stream checkpoint" : "Live agent stream",
      text: eventText,
      payload: {
        fullTextLength: cleanText.length,
        truncated: cleanText.length > maxTextChars,
        decision,
      },
    };

    pending = pending
      .then(async () => {
        await mkdir(path.dirname(eventFile), { recursive: true });
        await appendFile(eventFile, `${JSON.stringify(event)}\n`, "utf8");
      })
      .catch(() => {});
    await pending;
  }

  return {
    report(text) {
      void appendEvent(text);
    },
    async flush(text) {
      await appendEvent(text, { force: true });
      await pending;
    },
  };
}

class AppServerClient {
  constructor(
    binary,
    cwd,
    {
      requestTimeoutMs = 120_000,
      appServerMode = "isolated",
      appServerSocket = "",
    } = {},
  ) {
    this.binary = binary;
    this.cwd = cwd;
    this.requestTimeoutMs = requestTimeoutMs;
    this.appServerMode = normalizeCodexAppServerMode(appServerMode);
    this.appServerSocket = appServerSocket || codexSharedSocketPath(process.env);
    this.effectiveMode = "isolated";
    this.child = null;
    this.socket = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    this.closed = false;
    this.notificationListeners = new Set();
    this.serverRequestListeners = new Set();
    this.activeServerRequests = new Map();
    this.exitListeners = new Set();
    this.exitPromise = null;
    this.exitResult = null;
    this.resolveExit = null;
    this.experimentalApi = false;
  }

  async start({ experimentalApi = false } = {}) {
    this.experimentalApi = Boolean(experimentalApi);
    if (this.appServerMode === "isolated") {
      this.#startIsolated();
    } else {
      const runtime = await ensureCodexSharedRuntime({
        mode: this.appServerMode,
        codexBinary: this.binary,
        socketPath: this.appServerSocket,
        cwd: this.cwd,
        env: process.env,
      });
      if (runtime?.mode === "isolated") {
        this.#startIsolated();
      } else {
        this.appServerSocket = runtime?.socketPath || this.appServerSocket;
        await this.#startShared();
      }
    }

    await this.#initialize();
  }

  async #initialize() {
    await this.request("initialize", {
      clientInfo: {
        name: "clawdad",
        title: "Clawdad",
        version: "0.0.0",
      },
      capabilities: {
        experimentalApi: this.experimentalApi,
      },
    });
    this.notify("initialized", {});
  }

  async reconnectShared() {
    if (this.effectiveMode !== "shared") {
      throw new Error("only a shared Codex app-server client can reconnect");
    }
    this.closed = false;
    this.exitResult = null;
    this.exitPromise = null;
    this.resolveExit = null;
    this.socket = null;
    this.pending.clear();
    this.activeServerRequests.clear();
    const runtime = await ensureCodexSharedRuntime({
      mode: "shared",
      codexBinary: this.binary,
      socketPath: this.appServerSocket,
      cwd: this.cwd,
      env: process.env,
    });
    this.appServerSocket = runtime?.socketPath || this.appServerSocket;
    await this.#startShared();
    await this.#initialize();
  }

  #createExitPromise() {
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
  }

  #startIsolated() {
    this.effectiveMode = "isolated";
    this.#createExitPromise();
    this.child = spawn(this.binary, ["app-server"], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
      detached: true,
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      this.#drainStdout();
    });
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    this.child.stdin.on("error", (error) => {
      // The app-server can close its stdin immediately before the child exit
      // event arrives. Consume that EPIPE so the exit listener can report the
      // structured turn failure instead of crashing this dispatcher.
      this.stderr += `${describeError(error)}\n`;
    });
    this.child.once("error", (error) => {
      this.stderr += `${describeError(error)}\n`;
    });
    this.child.once("exit", (code, signal) => {
      this.#markClosed({ code, signal });
    });
  }

  async #startShared() {
    this.effectiveMode = "shared";
    this.#createExitPromise();
    const handshakeTimeout = this.requestTimeoutMs > 0
      ? Math.max(1_000, Math.min(this.requestTimeoutMs, 10_000))
      : 10_000;
    const socket = new WebSocket(codexSharedWebSocketUrl(this.appServerSocket), {
      handshakeTimeout,
      perMessageDeflate: false,
    });
    this.socket = socket;

    socket.on("message", (data) => {
      this.#readMessage(String(data));
    });
    socket.on("error", (error) => {
      this.stderr += `${describeError(error)}\n`;
    });
    socket.once("close", (code, reason) => {
      this.#markClosed({
        code,
        signal: null,
        reason: String(reason || ""),
      });
    });

    await new Promise((resolve, reject) => {
      let settled = false;
      const finishResolve = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      socket.once("open", finishResolve);
      socket.once("error", finishReject);
    });
  }

  #markClosed(result = {}) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.exitResult = result;
    const detail = this.effectiveMode === "shared"
      ? `codex shared app-server connection closed (code=${result.code ?? "null"})`
      : `codex app-server exited before responding (code=${result.code ?? "null"}, signal=${result.signal ?? "null"})`;
    for (const [, pending] of this.pending) {
      pending.clearTimer?.();
      pending.reject(new Error(detail));
    }
    this.pending.clear();
    this.activeServerRequests.clear();
    for (const listener of this.exitListeners) {
      try {
        listener(this.exitResult);
      } catch {
        // Exit handling should continue even if an observer fails.
      }
    }
    this.resolveExit?.(this.exitResult);
  }

  async stop() {
    if (this.closed) {
      return;
    }
    if (this.effectiveMode === "shared") {
      if (!this.socket) {
        return;
      }
      try {
        this.socket.close(1000, "clawdad dispatch complete");
      } catch {
        this.socket.terminate();
      }
      const stopped = await Promise.race([
        this.exitPromise.then(() => true),
        sleep(750).then(() => false),
      ]);
      if (!stopped && !this.closed) {
        this.socket.terminate();
        await Promise.race([this.exitPromise, sleep(500)]);
      }
      return;
    }

    if (!this.child) {
      return;
    }
    const childPid = this.child.pid;
    try {
      this.child.kill("SIGTERM");
    } catch {
      // Fall through to the process-group termination below.
    }
    const stopped = await Promise.race([
      this.exitPromise.then(() => true),
      sleep(750).then(() => false),
    ]);
    if (!stopped && !this.closed) {
      try {
        process.kill(-childPid, "SIGTERM");
      } catch {
        this.child.kill("SIGKILL");
      }
      await Promise.race([
        this.exitPromise.then(() => true),
        sleep(750).then(() => false),
      ]);
    }
    if (!this.closed) {
      try {
        process.kill(-childPid, "SIGKILL");
      } catch {
        this.child.kill("SIGKILL");
      }
      await Promise.race([this.exitPromise, sleep(500)]);
    }
  }

  onNotification(listener) {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  onServerRequest(listener) {
    this.serverRequestListeners.add(listener);
    return () => {
      this.serverRequestListeners.delete(listener);
    };
  }

  onExit(listener) {
    if (this.exitResult) {
      queueMicrotask(() => listener(this.exitResult));
      return () => {};
    }
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  isRunning() {
    if (this.closed) {
      return false;
    }
    if (this.effectiveMode === "shared") {
      return this.socket?.readyState === WebSocket.OPEN;
    }
    return Boolean(this.child);
  }

  #send(payload) {
    if (!this.isRunning()) {
      throw new Error("codex app-server is not running");
    }
    const serialized = JSON.stringify(payload);
    if (this.effectiveMode === "shared") {
      this.socket.send(serialized);
      return;
    }
    this.child.stdin.write(`${serialized}\n`);
  }

  async request(method, params, timeoutMs = this.requestTimeoutMs) {
    if (!this.isRunning()) {
      throw new Error("codex app-server is not running");
    }
    const id = this.nextId;
    this.nextId += 1;
    const payload = { id, method, params };

    return new Promise((resolve, reject) => {
      let timeoutId = null;
      const clearTimer = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };
      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`timed out waiting for codex app-server ${method} response after ${Math.ceil(timeoutMs / 1000)}s`));
        }, timeoutMs);
        timeoutId.unref?.();
      }
      this.pending.set(id, { resolve, reject, clearTimer });
      try {
        this.#send(payload);
      } catch (error) {
        this.pending.delete(id);
        clearTimer();
        reject(error);
      }
    });
  }

  notify(method, params = {}) {
    this.#send({ method, params });
  }

  hasServerRequest(id) {
    return this.activeServerRequests.has(id);
  }

  discardServerRequest(id) {
    return this.activeServerRequests.delete(id);
  }

  respond(id, result) {
    if (!this.activeServerRequests.has(id)) {
      return false;
    }
    this.#send({ id, result });
    this.activeServerRequests.delete(id);
    return true;
  }

  respondError(id, message, code = -32603) {
    if (!this.activeServerRequests.has(id)) {
      return false;
    }
    this.#send({
      id,
      error: {
        code,
        message: String(message || "ClawDad could not handle the app-server request"),
      },
    });
    this.activeServerRequests.delete(id);
    return true;
  }

  serverRequestSnapshot() {
    return {
      count: this.activeServerRequests.size,
      methods: [...this.activeServerRequests.values()]
        .map((request) => String(request?.method || "").trim())
        .filter(Boolean),
    };
  }

  #drainStdout() {
    for (;;) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) {
        this.#readMessage(line);
      }
    }
  }

  #readMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      for (const listener of this.notificationListeners) {
        listener({ type: "parse_error", error, raw });
      }
      return;
    }

    if (
      Object.prototype.hasOwnProperty.call(message, "id") &&
      typeof message.method === "string" &&
      message.method.trim()
    ) {
      this.activeServerRequests.set(message.id, message);
      // A turn can produce an approval immediately after its turn/start
      // response. Deferring request listeners to the microtask queue lets the
      // request promise record that turn's ownership before any shared client
      // decides whether it should answer the approval.
      queueMicrotask(() => {
        if (!this.activeServerRequests.has(message.id)) {
          return;
        }
        if (this.serverRequestListeners.size === 0) {
          this.respondError(message.id, `ClawDad does not support app-server request '${message.method}'`, -32601);
          return;
        }
        for (const listener of this.serverRequestListeners) {
          try {
            listener(message);
          } catch (error) {
            this.respondError(message.id, describeError(error));
          }
        }
      });
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, "id")) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        for (const listener of this.notificationListeners) {
          listener({
            type: "unknown_response",
            raw: message,
            error: new Error(`received unmatched app-server response id '${message.id}'`),
          });
        }
        return;
      }
      this.pending.delete(message.id);
      pending.clearTimer?.();
      if (message.error) {
        pending.reject(message.error);
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method === "serverRequest/resolved") {
      this.activeServerRequests.delete(message.params?.requestId);
    }
    for (const listener of this.notificationListeners) {
      listener(message);
    }
  }
}

function approvalRequestKey(message = {}) {
  const hash = crypto.createHash("sha256");
  hash.update(String(message.id ?? ""));
  hash.update("\0");
  hash.update(String(message.method || ""));
  hash.update("\0");
  hash.update(String(message.params?.threadId || ""));
  hash.update("\0");
  hash.update(String(message.params?.turnId || ""));
  return hash.digest("hex").slice(0, 32);
}

function approvalRequestTitle(method) {
  switch (method) {
    case "item/commandExecution/requestApproval":
    case "execCommandApproval":
      return "Approve command";
    case "item/fileChange/requestApproval":
    case "applyPatchApproval":
      return "Approve file changes";
    case "item/permissions/requestApproval":
      return "Approve additional access";
    case "item/tool/requestUserInput":
      return "Codex needs your answer";
    case "mcpServer/elicitation/request":
      return "Approve connected app action";
    default:
      return "Codex needs approval";
  }
}

function approvalRequestPrompt(message = {}) {
  const params = message.params && typeof message.params === "object" ? message.params : {};
  const questions = Array.isArray(params.questions) ? params.questions : [];
  const command = Array.isArray(params.command)
    ? params.command.join(" ")
    : String(params.command || "").trim();
  return [
    params.reason,
    params.message,
    command,
    questions.map((question) => question?.question).filter(Boolean).join("\n"),
  ].map((value) => String(value || "").trim()).find(Boolean) || approvalRequestTitle(message.method);
}

function approvalRequestOptions(message = {}) {
  const questions = Array.isArray(message?.params?.questions) ? message.params.questions : [];
  return questions.map((question) => ({
    id: String(question?.id || "").trim(),
    header: String(question?.header || "").trim(),
    question: String(question?.question || "").trim(),
    options: Array.isArray(question?.options)
      ? question.options.map((option) => ({
          label: String(option?.label || "").trim(),
          description: String(option?.description || "").trim(),
        })).filter((option) => option.label)
      : [],
  })).filter((question) => question.id);
}

function automaticServerRequestResult(message, permissionMode) {
  if (message.method === "currentTime/read") {
    return {
      handled: true,
      result: {
        currentTimeAt: Math.floor(Date.now() / 1000),
      },
    };
  }

  if (permissionMode !== "full") {
    return { handled: false, result: null };
  }

  switch (message.method) {
    case "item/commandExecution/requestApproval":
      return { handled: true, result: { decision: "accept" } };
    case "item/fileChange/requestApproval":
      return { handled: true, result: { decision: "accept" } };
    case "item/permissions/requestApproval":
      return {
        handled: true,
        result: {
          permissions: message.params?.permissions || {},
          scope: "turn",
        },
      };
    case "execCommandApproval":
    case "applyPatchApproval":
      return { handled: true, result: { decision: "approved" } };
    default:
      return { handled: false, result: null };
  }
}

function defaultQuestionAnswers(message, approved) {
  const answers = {};
  for (const question of Array.isArray(message?.params?.questions) ? message.params.questions : []) {
    const options = Array.isArray(question?.options) ? question.options : [];
    const preferredPattern = approved
      ? /approve|allow|confirm|continue|yes|proceed/iu
      : /decline|deny|cancel|no|stop/iu;
    const selected =
      options.find((option) => preferredPattern.test(String(option?.label || ""))) ||
      options[approved ? 0 : Math.max(0, options.length - 1)];
    answers[String(question?.id || "")] = {
      answers: selected?.label ? [String(selected.label)] : [],
    };
  }
  return answers;
}

function serverRequestResultFromDecision(message, decision = {}) {
  const approved = String(decision?.decision || decision?.action || "").trim().toLowerCase() === "approve";
  switch (message.method) {
    case "item/commandExecution/requestApproval":
      return { decision: approved ? "accept" : "decline" };
    case "item/fileChange/requestApproval":
      return { decision: approved ? "accept" : "decline" };
    case "item/permissions/requestApproval":
      return approved
        ? { permissions: message.params?.permissions || {}, scope: "turn" }
        : { permissions: {}, scope: "turn" };
    case "execCommandApproval":
    case "applyPatchApproval":
      return {
        decision: approved
          ? "approved"
          : { denied: { rejection: String(decision?.reason || "Declined in ClawDad") } },
      };
    case "item/tool/requestUserInput":
      return {
        answers:
          decision?.answers && typeof decision.answers === "object"
            ? decision.answers
            : defaultQuestionAnswers(message, approved),
      };
    case "mcpServer/elicitation/request":
      return {
        action: approved ? "accept" : "decline",
        content: approved && decision?.content && typeof decision.content === "object"
          ? decision.content
          : approved
            ? {}
            : null,
        _meta: null,
      };
    default:
      throw new Error(`unsupported app-server request '${message.method}'`);
  }
}

async function waitForServerRequestDecision(message, options, isPending = null) {
  const approvalId = approvalRequestKey(message);
  const approvalDir = path.join(options.projectPath, ".clawdad", "mailbox", "approvals");
  const approvalFile = path.join(approvalDir, `${approvalId}.json`);
  const createdAt = new Date().toISOString();
  const pending = {
    approvalId,
    state: "pending",
    createdAt,
    updatedAt: createdAt,
    pid: process.pid,
    requestId: message.id,
    method: message.method,
    permissionMode: options.permissionMode,
    title: approvalRequestTitle(message.method),
    prompt: approvalRequestPrompt(message),
    questions: approvalRequestOptions(message),
    params: message.params || {},
  };
  await writeJsonFile(approvalFile, pending);

  for (;;) {
    if (typeof isPending === "function" && !isPending()) {
      await writeJsonFile(approvalFile, {
        ...pending,
        state: "resolved_elsewhere",
        resolution: "another_client",
        resolvedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return null;
    }
    const current = JSON.parse(await readFile(approvalFile, "utf8").catch(() => "{}"));
    if (String(current?.state || "").trim().toLowerCase() === "decided") {
      const result = serverRequestResultFromDecision(message, current);
      await writeJsonFile(approvalFile, {
        ...current,
        state: "resolved",
        resolvedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return result;
    }
    await sleep(250);
  }
}

async function handleCodexServerRequest(
  client,
  message,
  options,
  eventRecorder,
  { ownsRequest = null } = {},
) {
  eventRecorder.record(message);
  if (
    client.effectiveMode === "shared" &&
    (typeof ownsRequest !== "function" || !ownsRequest(message))
  ) {
    client.discardServerRequest(message.id);
    eventRecorder.record({
      method: "clawdad/serverRequest/ignored",
      params: {
        threadId: message.params?.threadId || null,
        turnId: message.params?.turnId || null,
        requestMethod: message.method,
        reason: "turn_owned_by_another_client",
      },
    });
    return;
  }
  const automatic = automaticServerRequestResult(message, options.permissionMode);
  if (automatic.handled) {
    const responded = client.respond(message.id, automatic.result);
    eventRecorder.record({
      method: "clawdad/serverRequest/resolved",
      params: {
        threadId: message.params?.threadId || null,
        turnId: message.params?.turnId || null,
        requestMethod: message.method,
        resolution: responded ? "automatic" : "another_client",
      },
    });
    return;
  }

  const interactiveMethods = new Set([
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/permissions/requestApproval",
    "item/tool/requestUserInput",
    "mcpServer/elicitation/request",
    "execCommandApproval",
    "applyPatchApproval",
  ]);
  if (!interactiveMethods.has(message.method)) {
    if (client.effectiveMode === "shared") {
      client.discardServerRequest(message.id);
    } else {
      client.respondError(message.id, `ClawDad cannot service app-server request '${message.method}'`, -32601);
    }
    return;
  }

  try {
    const result = await waitForServerRequestDecision(
      message,
      options,
      () => client.hasServerRequest(message.id),
    );
    if (result === null || !client.respond(message.id, result)) {
      eventRecorder.record({
        method: "clawdad/serverRequest/resolved",
        params: {
          threadId: message.params?.threadId || null,
          turnId: message.params?.turnId || null,
          requestMethod: message.method,
          resolution: "another_client",
        },
      });
      return;
    }
    eventRecorder.record({
      method: "clawdad/serverRequest/resolved",
      params: {
        threadId: message.params?.threadId || null,
        turnId: message.params?.turnId || null,
        requestMethod: message.method,
        resolution: "user",
      },
    });
  } catch (error) {
    if (client.hasServerRequest(message.id)) {
      client.respondError(message.id, describeError(error));
    }
  }
}

class CodexTurnIdleTimeoutError extends Error {
  constructor(
    message,
    {
      completedAgentMessages = [],
      agentDeltaTexts = new Map(),
      idleTimeoutMs = 0,
      recoveryReason = "turn_idle_timeout",
    } = {},
  ) {
    super(message);
    this.name = "CodexTurnIdleTimeoutError";
    this.completedAgentMessages = completedAgentMessages;
    this.agentDeltaTexts = agentDeltaTexts;
    this.idleTimeoutMs = idleTimeoutMs;
    this.recoveryReason = recoveryReason;
  }
}

function notificationMatchesTurn(message, threadId, turnId) {
  const params = message?.params && typeof message.params === "object" ? message.params : {};
  const item = params.item && typeof params.item === "object" ? params.item : {};
  const messageThreadId = String(params.threadId || params.turn?.threadId || item.threadId || "").trim();
  const messageTurnId = String(params.turnId || params.turn?.id || item.turnId || "").trim();

  if (messageThreadId && messageThreadId !== threadId) {
    return false;
  }
  if (messageTurnId && messageTurnId !== turnId) {
    return false;
  }
  return Boolean(messageThreadId || messageTurnId);
}

function codexErrorNotificationScope(message) {
  const params = message?.params && typeof message.params === "object" ? message.params : {};
  const error = params.error && typeof params.error === "object" ? params.error : {};
  const errorTurn = error.turn && typeof error.turn === "object" ? error.turn : {};
  return {
    threadId: String(
      params.threadId ||
      params.turn?.threadId ||
      error.threadId ||
      errorTurn.threadId ||
      "",
    ).trim(),
    turnId: String(
      params.turnId ||
      params.turn?.id ||
      error.turnId ||
      errorTurn.id ||
      "",
    ).trim(),
  };
}

function codexErrorTargetsTurn(message, threadId, turnId) {
  const scope = codexErrorNotificationScope(message);
  if (scope.threadId && scope.threadId !== threadId) {
    return false;
  }
  if (scope.turnId && scope.turnId !== turnId) {
    return false;
  }
  return true;
}

function codexErrorWillRetry(message) {
  const params = message?.params && typeof message.params === "object" ? message.params : {};
  const error = params.error && typeof params.error === "object" ? params.error : {};
  return (
    params.willRetry === true ||
    params.retryable === true ||
    error.willRetry === true ||
    error.retryable === true
  );
}

function recoveredIdleResultText(partialText, idleTimeoutMs, recoveryReason = "turn_idle_timeout") {
  const seconds = Math.max(1, Math.ceil(Number(idleTimeoutMs || 0) / 1000));
  const subject =
    recoveryReason === "tool_idle_timeout"
      ? "a Codex connector/tool call"
      : "the Codex turn";
  const recoveryNote =
    `Clawdad stopped this run because ${subject} made no live progress for ${seconds}s before it finished. ` +
    "The latest agent text is preserved below, and the request was marked failed so partial work is not mistaken for a completed handoff.";
  const cleanPartial = String(partialText || "").trim();
  if (!cleanPartial) {
    return `${recoveryNote}\n\nNo final agent answer was available yet. Check the project files and Agent files for work saved before the stall.`;
  }
  return `${recoveryNote}\n\nLatest agent text before the stall:\n\n${cleanPartial}`;
}

function itemTypeBlocksInterjection(value) {
  return ["commandExecution", "dynamicToolCall", "fileChange", "localShell", "mcpToolCall"].includes(
    String(value || ""),
  );
}

function historyPaths(projectPath) {
  const historyDir = path.join(projectPath, ".clawdad", "history");
  return {
    historyDir,
    sessionsDir: path.join(historyDir, "sessions"),
    requestsDir: path.join(historyDir, "requests"),
  };
}

function pathInsideRoot(rootPath, targetPath) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function sanitizeHistoryKey(value) {
  return String(value || "").replace(/[^A-Za-z0-9._-]/g, "_");
}

function historyRequestStamp(isoValue) {
  return String(isoValue || new Date().toISOString()).replace(/[-:]/g, "").replace(/\s+/g, "_");
}

function historySessionDir(projectPath, sessionId) {
  return path.join(historyPaths(projectPath).sessionsDir, sanitizeHistoryKey(sessionId));
}

function historyRequestRecordFile(projectPath, sessionId, requestId, sentAt) {
  return path.join(historySessionDir(projectPath, sessionId), `${historyRequestStamp(sentAt)}--${requestId}.json`);
}

async function writeJsonFile(filePath, payload) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function updateInterjectionHistory(projectPath, requestId, nextFields = {}) {
  const cleanRequestId = String(requestId || "").trim();
  if (!projectPath || !cleanRequestId || cleanRequestId.includes("/") || cleanRequestId.includes("\\")) {
    return;
  }

  const indexFile = path.join(historyPaths(projectPath).requestsDir, `${cleanRequestId}.json`);
  const indexPayload = JSON.parse(await readFile(indexFile, "utf8").catch(() => "{}"));
  const recordFile = String(indexPayload?.file || "").trim();
  if (!recordFile) {
    return;
  }
  const historyRoot = path.resolve(historyPaths(projectPath).historyDir);
  const resolvedRecordFile = path.resolve(recordFile);
  if (!pathInsideRoot(historyRoot, resolvedRecordFile)) {
    return;
  }

  const record = JSON.parse(await readFile(resolvedRecordFile, "utf8").catch(() => "{}"));
  const sentAt = String(record.sentAt || indexPayload.sentAt || new Date().toISOString());
  const currentSessionId = String(record.sessionId || indexPayload.sessionId || "").trim();
  const nextSessionId = String(nextFields.sessionId || record.sessionId || indexPayload.sessionId || "").trim();
  const targetRecordFile = nextSessionId && nextSessionId !== currentSessionId
    ? historyRequestRecordFile(projectPath, nextSessionId, cleanRequestId, sentAt)
    : resolvedRecordFile;
  if (!pathInsideRoot(historyRoot, targetRecordFile)) {
    return;
  }

  const nextRecord = {
    ...record,
    requestId: cleanRequestId,
    sessionId: nextSessionId || record.sessionId || indexPayload.sessionId || null,
    sentAt,
    answeredAt: nextFields.answeredAt ?? record.answeredAt ?? new Date().toISOString(),
    status: nextFields.status || record.status || "answered",
    exitCode: nextFields.exitCode ?? record.exitCode ?? 0,
    response: nextFields.response ?? record.response ?? "",
  };
  await writeJsonFile(targetRecordFile, nextRecord);
  if (targetRecordFile !== resolvedRecordFile) {
    await unlink(resolvedRecordFile).catch(() => {});
  }
  await writeJsonFile(indexFile, {
    ...indexPayload,
    requestId: cleanRequestId,
    sessionId: nextRecord.sessionId || indexPayload.sessionId || null,
    sentAt,
    file: targetRecordFile,
  });
}

async function markInterjectionFile(filePath, payload, state, extra = {}) {
  await writeJsonFile(filePath, {
    ...payload,
    ...extra,
    state,
    updatedAt: new Date().toISOString(),
  });
}

async function waitForTurnCompletion(
  client,
  threadId,
  turnId,
  timeoutMs = 0,
  {
    onAgentText = null,
    onLiveness = null,
    idleTimeoutMs = 0,
    toolIdleTimeoutMs = 0,
    livenessIntervalMs = 30_000,
    livenessProbeTimeoutMs = 10_000,
    projectPath = "",
    interjectionDir = "",
    sessionAliases = [],
  } = {},
) {
  const completedAgentMessages = [];
  const agentDeltaTexts = new Map();
  const activeMcpToolCallIds = new Set();
  const activeDynamicToolCallIds = new Set();
  const consumedInterjectionFiles = new Set();
  const acceptedInterjectionSessionIds = new Set(
    [threadId, ...(Array.isArray(sessionAliases) ? sessionAliases : [])]
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );

  return new Promise((resolve, reject) => {
    let timeoutId = null;
    let idleTimeoutId = null;
    let interjectionIntervalId = null;
    let livenessIntervalId = null;
    let interjectionReadInFlight = false;
    let livenessProbeInFlight = false;
    let settled = false;
    let removeListener = () => {};
    let removeExitListener = () => {};
    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (idleTimeoutId) {
        clearTimeout(idleTimeoutId);
      }
      if (interjectionIntervalId) {
        clearInterval(interjectionIntervalId);
      }
      if (livenessIntervalId) {
        clearInterval(livenessIntervalId);
      }
      removeListener();
      removeExitListener();
    };
    const finishResolve = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };
    const finishReject = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const currentIdleLimit = () => {
      if ((activeMcpToolCallIds.size > 0 || activeDynamicToolCallIds.size > 0) && toolIdleTimeoutMs > 0) {
        return {
          timeout: idleTimeoutMs > 0 ? Math.min(idleTimeoutMs, toolIdleTimeoutMs) : toolIdleTimeoutMs,
          recoveryReason: "tool_idle_timeout",
        };
      }
      return {
        timeout: idleTimeoutMs,
        recoveryReason: "turn_idle_timeout",
      };
    };
    const armIdleTimer = () => {
      if (idleTimeoutId) {
        clearTimeout(idleTimeoutId);
        idleTimeoutId = null;
      }
      const idleLimit = currentIdleLimit();
      if (idleLimit.timeout > 0) {
        idleTimeoutId = setTimeout(() => {
          finishReject(new CodexTurnIdleTimeoutError(
            `codex turn made no live progress for ${Math.ceil(idleLimit.timeout / 1000)}s before completion`,
            {
              completedAgentMessages,
              agentDeltaTexts,
              idleTimeoutMs: idleLimit.timeout,
              recoveryReason: idleLimit.recoveryReason,
            },
          ));
        }, idleLimit.timeout);
        idleTimeoutId.unref?.();
      }
    };
    const consumeInterjections = async () => {
      const dir = String(interjectionDir || "").trim();
      if (!dir || interjectionReadInFlight || activeMcpToolCallIds.size > 0 || activeDynamicToolCallIds.size > 0) {
        return;
      }

      interjectionReadInFlight = true;
      let retryAfterToolBoundary = false;
      try {
        const files = (await readdir(dir).catch(() => []))
          .filter((fileName) => fileName.endsWith(".json"))
          .map((fileName) => path.join(dir, fileName))
          .filter((filePath) => !consumedInterjectionFiles.has(filePath));
        const pending = [];
        for (const filePath of files) {
          const payload = JSON.parse(await readFile(filePath, "utf8").catch(() => "{}"));
          if (String(payload?.state || "pending").trim().toLowerCase() !== "pending") {
            consumedInterjectionFiles.add(filePath);
            continue;
          }
          pending.push({ filePath, payload });
        }
        pending.sort((left, right) => {
          const leftAt = String(left.payload.createdAt || left.payload.sentAt || "");
          const rightAt = String(right.payload.createdAt || right.payload.sentAt || "");
          return leftAt.localeCompare(rightAt) || left.filePath.localeCompare(right.filePath);
        });

        for (const item of pending) {
          const targetSessionId = String(item.payload.sessionId || item.payload.threadId || "").trim();
          if (targetSessionId && !acceptedInterjectionSessionIds.has(targetSessionId)) {
            continue;
          }
          const requestId = String(item.payload.requestId || "").trim();
          const message = String(item.payload.agentMessage || item.payload.message || "").trim();
          if (!message) {
            consumedInterjectionFiles.add(item.filePath);
            await markInterjectionFile(item.filePath, item.payload, "failed", {
              sessionId: threadId,
              error: "missing interjection message",
            });
            await updateInterjectionHistory(projectPath, requestId, {
              sessionId: threadId,
              status: "failed",
              exitCode: 1,
              response: "ClawDad could not send this Direct message because it was empty.",
            }).catch(() => {});
            continue;
          }

          // A tool may start while the pending Direct message is being read from disk.
          // Re-check at the handoff boundary and let item/completed trigger the retry.
          if (activeMcpToolCallIds.size > 0 || activeDynamicToolCallIds.size > 0) {
            break;
          }

          try {
            const attachmentInputs = await readAttachmentInputs(item.payload.attachmentManifest);
            if (requestId) {
              const latestThread = await readSharedThread(client, threadId).catch(() => null);
              if (threadTurnForClientRequest(latestThread, requestId)) {
                consumedInterjectionFiles.add(item.filePath);
                await markInterjectionFile(item.filePath, item.payload, "accepted", {
                  sessionId: threadId,
                  acceptedAt: new Date().toISOString(),
                  reconciled: true,
                });
                await updateInterjectionHistory(projectPath, requestId, {
                  sessionId: threadId,
                  status: "answered",
                  exitCode: 0,
                  response: "Direct message was already present in the active Codex turn.",
                }).catch(() => {});
                continue;
              }
            }
            await client.request("turn/steer", {
              threadId,
              expectedTurnId: turnId,
              input: buildUserInput(message, attachmentInputs),
              ...(requestId ? { clientUserMessageId: requestId } : {}),
            });
            consumedInterjectionFiles.add(item.filePath);
            await markInterjectionFile(item.filePath, item.payload, "accepted", {
              sessionId: threadId,
              acceptedAt: new Date().toISOString(),
            });
            await updateInterjectionHistory(projectPath, requestId, {
              sessionId: threadId,
              status: "answered",
              exitCode: 0,
              response: "Sent directly into the active Codex turn after its current tool call.",
            }).catch(() => {});
          } catch (error) {
            const errorText = describeError(error, "failed to send Direct message into active Codex turn");
            const toolBoundaryMoved =
              /active tool|before .*tool.*completed|tool call .*in progress/iu.test(errorText);
            if (toolBoundaryMoved) {
              retryAfterToolBoundary = true;
              break;
            }
            consumedInterjectionFiles.add(item.filePath);
            await markInterjectionFile(item.filePath, item.payload, "failed", {
              sessionId: threadId,
              error: errorText,
            });
            await updateInterjectionHistory(projectPath, requestId, {
              sessionId: threadId,
              status: "failed",
              exitCode: 1,
              response: errorText,
            }).catch(() => {});
          }
        }
      } finally {
        interjectionReadInFlight = false;
        if (
          retryAfterToolBoundary &&
          !settled &&
          activeMcpToolCallIds.size === 0 &&
          activeDynamicToolCallIds.size === 0
        ) {
          const retryTimeout = setTimeout(() => {
            void consumeInterjections();
          }, 25);
          retryTimeout.unref?.();
        }
      }
    };

    const probeLiveness = async () => {
      if (settled || livenessProbeInFlight || client.closed) {
        return;
      }
      livenessProbeInFlight = true;
      try {
        const readResult = await client.request(
          "thread/read",
          { threadId, includeTurns: true },
          livenessProbeTimeoutMs,
        );
        if (settled) {
          return;
        }
        const turns = Array.isArray(readResult?.thread?.turns) ? readResult.thread.turns : [];
        const turn = turns.find((entry) => String(entry?.id || "").trim() === turnId) || null;
        const turnStatus = String(turn?.status || "inProgress").trim() || "inProgress";
        const serverRequests = client.serverRequestSnapshot();
        const activeToolCalls = activeMcpToolCallIds.size + activeDynamicToolCallIds.size;
        if (typeof onLiveness === "function") {
          onLiveness({
            alive: true,
            turnStatus,
            phase: serverRequests.count > 0
              ? "awaiting_approval"
              : activeToolCalls > 0
                ? "working_tool"
                : "working",
            activeToolCalls,
            pendingServerRequests: serverRequests.count,
            serverRequestMethods: serverRequests.methods,
            checkedAt: new Date().toISOString(),
            error: "",
          });
        }
        armIdleTimer();
        if (["completed", "failed", "cancelled", "canceled", "interrupted"].includes(turnStatus.toLowerCase())) {
          finishResolve({
            turn,
            completedAgentMessages,
            agentDeltaTexts,
          });
        }
      } catch (error) {
        if (!settled && typeof onLiveness === "function") {
          const serverRequests = client.serverRequestSnapshot();
          const activeToolCalls = activeMcpToolCallIds.size + activeDynamicToolCallIds.size;
          onLiveness({
            alive: !client.closed,
            turnStatus: "unknown",
            phase: serverRequests.count > 0
              ? "awaiting_approval"
              : activeToolCalls > 0
                ? "working_tool"
                : "connection_check",
            activeToolCalls,
            pendingServerRequests: serverRequests.count,
            serverRequestMethods: serverRequests.methods,
            checkedAt: new Date().toISOString(),
            error: describeError(error, "Codex liveness probe failed"),
          });
        }
      } finally {
        livenessProbeInFlight = false;
      }
    };

    removeListener = client.onNotification((message) => {
      if (!message || typeof message !== "object") {
        return;
      }
      if (notificationMatchesTurn(message, threadId, turnId)) {
        const params = message.params || {};
        const item = params.item && typeof params.item === "object" ? params.item : {};
        const itemId = String(params.itemId || item.id || "").trim();
        if (message.method === "item/started" && item.type === "mcpToolCall" && itemId) {
          activeMcpToolCallIds.add(itemId);
        } else if (message.method === "item/completed" && item.type === "mcpToolCall" && itemId) {
          activeMcpToolCallIds.delete(itemId);
          void consumeInterjections();
        } else if (message.method === "item/started" && itemTypeBlocksInterjection(item.type) && itemId) {
          activeDynamicToolCallIds.add(itemId);
        } else if (message.method === "item/completed" && itemTypeBlocksInterjection(item.type) && itemId) {
          activeDynamicToolCallIds.delete(itemId);
          void consumeInterjections();
        }
        armIdleTimer();
      }

      if (message.method === "item/agentMessage/delta") {
        const params = message.params || {};
        if (params.threadId === threadId && params.turnId === turnId && params.itemId) {
          const existing = agentDeltaTexts.get(params.itemId) || "";
          const nextText = existing + String(params.delta || "");
          agentDeltaTexts.set(params.itemId, nextText);
          if (typeof onAgentText === "function") {
            onAgentText(Array.from(agentDeltaTexts.values()).join("\n\n"));
          }
        }
        return;
      }

      if (message.method === "item/completed") {
        const params = message.params || {};
        if (params.threadId === threadId && params.turnId === turnId && params.item?.type === "agentMessage") {
          completedAgentMessages.push(params.item);
          if (typeof onAgentText === "function" && typeof params.item.text === "string") {
            onAgentText(params.item.text);
          }
        }
        return;
      }

      if (message.method === "turn/completed") {
        const params = message.params || {};
        const completedThreadId = String(params.threadId || params.turn?.threadId || "").trim();
        const completedTurnId = String(params.turnId || params.turn?.id || "").trim();
        if (completedThreadId !== threadId || completedTurnId !== turnId) {
          return;
        }
        finishResolve({
          turn: {
            ...(params.turn && typeof params.turn === "object" ? params.turn : {}),
            id: completedTurnId,
          },
          completedAgentMessages,
          agentDeltaTexts,
        });
      }

      if (message.method === "error") {
        const params = message.params || {};
        if (!codexErrorTargetsTurn(message, threadId, turnId)) {
          return;
        }
        if (codexErrorWillRetry(message)) {
          armIdleTimer();
          return;
        }
        finishReject(new Error(describeError(params.error || params, "codex app-server reported an error")));
      }
    });

    removeExitListener = client.onExit(({ code, signal }) => {
      finishReject(new Error(
        client.effectiveMode === "shared"
          ? `codex shared app-server connection closed before the active turn completed (code=${code ?? "null"})`
          : `codex app-server exited before the active turn completed (code=${code ?? "null"}, signal=${signal ?? "null"})`,
      ));
    });

    armIdleTimer();
    if (String(interjectionDir || "").trim()) {
      interjectionIntervalId = setInterval(() => {
        void consumeInterjections();
      }, 750);
      interjectionIntervalId.unref?.();
      void consumeInterjections();
    }
    if (livenessIntervalMs > 0) {
      livenessIntervalId = setInterval(() => {
        void probeLiveness();
      }, Math.max(25, livenessIntervalMs));
      livenessIntervalId.unref?.();
    }
    void probeLiveness();
    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        finishReject(new Error(`codex turn did not complete within ${Math.ceil(timeoutMs / 1000)}s`));
      }, timeoutMs);
      timeoutId.unref?.();
    }
  });
}

async function readTurnResult(client, threadId, turnId, completedAgentMessages, agentDeltaTexts) {
  const fromCurrentTurn = selectCodexTurnResultText({
    completedAgentMessages,
    agentDeltaTexts,
  });
  if (fromCurrentTurn) {
    return fromCurrentTurn;
  }

  const readResult = await client.request("thread/read", {
    threadId,
    includeTurns: true,
  });

  const turns = Array.isArray(readResult?.thread?.turns) ? readResult.thread.turns : [];
  const turn = turns.find((entry) => entry?.id === turnId) || turns[turns.length - 1] || null;
  return selectCodexTurnResultText({
    readItems: Array.isArray(turn?.items) ? turn.items : [],
    completedAgentMessages,
    agentDeltaTexts,
  });
}

function threadActiveTurn(thread = {}) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  return [...turns].reverse().find((turn) => String(turn?.status || "").trim() === "inProgress") || null;
}

function threadTurnForClientRequest(thread = {}, requestId = "") {
  const cleanRequestId = String(requestId || "").trim();
  if (!cleanRequestId) {
    return null;
  }
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  return [...turns].reverse().find((turn) => (
    Array.isArray(turn?.items) && turn.items.some((item) => (
      item?.type === "userMessage" && String(item?.clientId || "").trim() === cleanRequestId
    ))
  )) || null;
}

async function readSharedThread(client, threadId) {
  const result = await client.request("thread/read", {
    threadId,
    includeTurns: true,
  });
  return result?.thread && typeof result.thread === "object" ? result.thread : {};
}

function sharedTurnRaceError(error) {
  return /active turn|already.*turn|turn.*in progress|wrong state|not steerable|activeTurnNotSteerable|expected turn|cannot accept direct|tool.*in progress/iu
    .test(describeError(error));
}

function sharedTurnCannotSteerError(error) {
  const code = String(
    error?.code ||
    error?.data?.code ||
    error?.data?.type ||
    error?.data?.kind ||
    "",
  ).trim();
  let details = "";
  try {
    details = JSON.stringify(error?.data || error || {});
  } catch {
    details = describeError(error);
  }
  return /activeTurnNotSteerable|cannot steer|not steerable|review|compact|tool.*(?:active|running|in progress)|cannot accept direct/iu
    .test(`${code} ${describeError(error)} ${details}`);
}

function sharedTransportDisconnectError(error) {
  return /shared app-server connection closed|websocket is not open|socket hang up|ECONNRESET|EPIPE/iu
    .test(describeError(error));
}

async function resumeAfterSharedReconnect(client, threadId) {
  await client.reconnectShared();
  const resumed = await client.request("thread/resume", { threadId });
  return resumed?.thread && typeof resumed.thread === "object" ? resumed.thread : {};
}

async function routeSharedTurnWithRecovery(client, threadId, initialThread, options, callbacks = {}) {
  let thread = initialThread;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await routeSharedTurn(client, threadId, thread, options, callbacks);
    } catch (error) {
      if (attempt > 0 || !sharedTransportDisconnectError(error)) {
        throw error;
      }
      thread = await resumeAfterSharedReconnect(client, threadId);
    }
  }
  throw new Error("Codex shared app-server turn routing could not be reconciled after reconnect");
}

async function waitForTurnCompletionWithSharedRecovery(
  client,
  threadId,
  turnId,
  timeoutMs,
  waitOptions,
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await waitForTurnCompletion(client, threadId, turnId, timeoutMs, waitOptions);
    } catch (error) {
      if (attempt > 0 || client.effectiveMode !== "shared" || !sharedTransportDisconnectError(error)) {
        throw error;
      }
      const thread = await resumeAfterSharedReconnect(client, threadId);
      const turn = (Array.isArray(thread?.turns) ? thread.turns : [])
        .find((entry) => String(entry?.id || "").trim() === turnId) || null;
      if (turn && String(turn.status || "").trim() !== "inProgress") {
        return {
          turn,
          completedAgentMessages: [],
          agentDeltaTexts: new Map(),
        };
      }
    }
  }
  throw new Error("Codex shared app-server turn completion could not be reconciled after reconnect");
}

async function routeSharedTurn(client, threadId, initialThread, options, {
  onWaitingLiveness = null,
  onTurnAccepted = null,
} = {}) {
  let thread = initialThread && typeof initialThread === "object" ? initialThread : {};
  let deferUntilIdle = options.dispatchMode === "queue";
  const startedAt = Date.now();
  const deadline = options.turnTimeoutMs > 0 ? startedAt + options.turnTimeoutMs : 0;

  const accepted = (result, ownsTurn) => {
    if (typeof onTurnAccepted === "function") {
      onTurnAccepted({
        threadId,
        turnId: result.turnId,
        ownsTurn,
        deliveryMode: result.deliveryMode,
      });
    }
    return result;
  };

  for (;;) {
    if (deadline > 0 && Date.now() >= deadline) {
      throw new Error(`codex shared turn did not accept the message within ${Math.ceil(options.turnTimeoutMs / 1000)}s`);
    }

    const reconciledTurn = threadTurnForClientRequest(thread, options.requestId);
    if (reconciledTurn) {
      return accepted({
        turnId: String(reconciledTurn.id || "").trim(),
        turn: reconciledTurn,
        deliveryMode: "reconciled",
        alreadyTerminal: String(reconciledTurn.status || "").trim() !== "inProgress",
      }, true);
    }

    const activeTurn = threadActiveTurn(thread);
    if (activeTurn) {
      const activeTurnId = String(activeTurn.id || "").trim();
      if (!deferUntilIdle && options.dispatchMode === "direct" && thread?.canAcceptDirectInput !== false) {
        try {
          const steerResult = await client.request("turn/steer", {
            threadId,
            expectedTurnId: activeTurnId,
            input: buildUserInput(options.message, options.attachmentInputs),
            ...(options.requestId ? { clientUserMessageId: options.requestId } : {}),
          });
          return accepted({
            turnId: String(steerResult?.turnId || activeTurnId).trim(),
            turn: activeTurn,
            deliveryMode: "steer",
            alreadyTerminal: false,
          }, false);
        } catch (error) {
          if (sharedTransportDisconnectError(error)) {
            throw error;
          }
          if (sharedTurnCannotSteerError(error)) {
            deferUntilIdle = true;
          } else if (sharedTurnRaceError(error)) {
            await sleep(100);
            thread = await readSharedThread(client, threadId);
            continue;
          } else {
            throw error;
          }
        }
      }

      await waitForTurnCompletionWithSharedRecovery(client, threadId, activeTurnId, options.turnTimeoutMs, {
        onLiveness: onWaitingLiveness,
        idleTimeoutMs: 0,
        toolIdleTimeoutMs: 0,
        livenessIntervalMs: Math.min(Math.max(options.livenessIntervalMs, 250), 2000),
        livenessProbeTimeoutMs: options.livenessProbeTimeoutMs,
        projectPath: options.projectPath,
        interjectionDir: options.interjectionDir,
      });
      thread = await readSharedThread(client, threadId);
      continue;
    }

    try {
      const turnResult = await client.request("turn/start", buildTurnParams(threadId, options));
      const turnId = String(turnResult?.turn?.id || "").trim();
      if (!turnId) {
        throw new Error("codex app-server did not return a turn id");
      }
      return accepted({
        turnId,
        turn: turnResult.turn,
        deliveryMode: options.dispatchMode === "queue" || deferUntilIdle ? "deferred_start" : "start",
        alreadyTerminal: false,
      }, true);
    } catch (error) {
      thread = await readSharedThread(client, threadId).catch(() => null);
      const reconciledAfterError = threadTurnForClientRequest(thread, options.requestId);
      if (reconciledAfterError) {
        return accepted({
          turnId: String(reconciledAfterError.id || "").trim(),
          turn: reconciledAfterError,
          deliveryMode: "reconciled",
          alreadyTerminal: String(reconciledAfterError.status || "").trim() !== "inProgress",
        }, true);
      }
      if (!thread || !sharedTurnRaceError(error)) {
        throw error;
      }
      await sleep(100);
    }
  }
}

function goalErrorIsUnsupported(error) {
  const message = describeError(error);
  return /method not found|unknown method|not supported|unsupported|experimentalapi/iu.test(message);
}

async function syncThreadGoal(
  client,
  {
    threadId,
    objective = "",
    status = "active",
    tokenBudget = null,
    clear = false,
    mode = "auto",
  } = {},
  timeoutMs = 1500,
) {
  const normalizedMode = normalizeGoalMode(mode);
  const trimmedObjective = String(objective || "").trim();
  const normalizedStatus = normalizeThreadGoalStatus(status, "active");
  const normalizedTokenBudget = parseOptionalNonNegativeNumber(tokenBudget);
  const trimmedThreadId = String(threadId || "").trim();
  const requested = {
    threadId: trimmedThreadId,
    objective: trimmedObjective,
    status: normalizedStatus,
    tokenBudget: normalizedTokenBudget,
    clear: Boolean(clear),
  };

  if (normalizedMode === "off") {
    return {
      mode: normalizedMode,
      supported: false,
      synced: false,
      skipped: true,
      error: "",
      goal: null,
      requested,
    };
  }
  if (!trimmedThreadId) {
    return {
      mode: normalizedMode,
      supported: true,
      synced: false,
      skipped: false,
      error: "missing thread id",
      goal: null,
      requested,
    };
  }
  if (!clear && !trimmedObjective && !normalizedStatus && normalizedTokenBudget === null) {
    return {
      mode: normalizedMode,
      supported: true,
      synced: false,
      skipped: true,
      error: "",
      goal: null,
      requested,
    };
  }

  const params = { threadId: trimmedThreadId };
  if (trimmedObjective) {
    params.objective = trimmedObjective;
  }
  if (!clear && normalizedStatus) {
    params.status = normalizedStatus;
  }
  if (!clear && normalizedTokenBudget !== null) {
    params.tokenBudget = normalizedTokenBudget;
  }

  try {
    if (clear) {
      const result = await client.request("thread/goal/clear", { threadId: trimmedThreadId }, timeoutMs);
      return {
        mode: normalizedMode,
        supported: true,
        synced: true,
        skipped: false,
        error: "",
        goal: null,
        cleared: Boolean(result?.cleared ?? true),
        requested,
      };
    }
    const result = await client.request("thread/goal/set", params, timeoutMs);
    return {
      mode: normalizedMode,
      supported: true,
      synced: true,
      skipped: false,
      error: "",
      goal: compactThreadGoal(result?.goal) || {
        threadId: trimmedThreadId,
        objective: trimmedObjective,
        status: normalizedStatus,
        tokenBudget: normalizedTokenBudget,
        tokensUsed: null,
        timeUsedSeconds: null,
        createdAt: null,
        updatedAt: null,
      },
      requested,
    };
  } catch (error) {
    const unsupported = goalErrorIsUnsupported(error);
    return {
      mode: normalizedMode,
      supported: unsupported ? false : true,
      synced: false,
      skipped: unsupported && normalizedMode === "auto",
      error: describeError(error),
      goal: null,
      requested,
    };
  }
}

let activeClient = null;
let shuttingDown = false;

async function stopActiveClientForSignal(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  const forceExitCode = signal === "SIGINT" ? 130 : 143;
  const forceExit = setTimeout(() => {
    process.exit(forceExitCode);
  }, 2000);
  forceExit.unref?.();
  try {
    await activeClient?.stop();
  } finally {
    clearTimeout(forceExit);
    process.exit(forceExitCode);
  }
}

process.once("SIGTERM", () => {
  void stopActiveClientForSignal("SIGTERM");
});

process.once("SIGINT", () => {
  void stopActiveClientForSignal("SIGINT");
});

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.projectPath) {
    printJson({ ok: false, error_text: "missing --project-path" });
    process.exitCode = 1;
    return;
  }
  if (!options.message && !options.goalOnly) {
    printJson({ ok: false, error_text: "missing --message" });
    process.exitCode = 1;
    return;
  }
  if (options.goalOnly && !options.sessionId) {
    printJson({ ok: false, error_text: "missing --session-id" });
    process.exitCode = 1;
    return;
  }
  if (!options.goalOnly && !options.requestId) {
    options.requestId = crypto.randomUUID();
  }

  try {
    options.attachmentInputs = await readAttachmentInputs(options.attachmentManifest);
  } catch (error) {
    printJson({
      ok: false,
      session_id: options.sessionId || "",
      result_text: "",
      error_text: `failed to read attachment manifest: ${describeError(error)}`,
    });
    process.exitCode = 1;
    return;
  }

  const client = new AppServerClient(options.codexBinary, options.projectPath, {
    requestTimeoutMs: options.requestTimeoutMs,
    appServerMode: options.appServerMode,
    appServerSocket: options.appServerSocket,
  });
  const eventRecorder = createCodexEventRecorder(options.eventLogFile);
  const goalRequested =
    Boolean(options.threadGoal) ||
    options.goalOnly ||
    options.threadGoalClear ||
    options.threadGoalTokenBudget !== null ||
    options.threadGoalStatusSpecified;
  const shouldUseGoalApi = options.goalMode !== "off" && goalRequested;
  activeClient = client;
  let sessionId = options.sessionId || "";
  let threadSource = "";
  let threadPath = "";
  let deliveryMode = "";
  let deliveryClaim = null;
  let ownedSharedTurn = { threadId: "", turnId: "" };
  const recordTurnOwnership = ({ threadId = "", turnId = "", ownsTurn = false } = {}) => {
    ownedSharedTurn = ownsTurn
      ? {
          threadId: String(threadId || "").trim(),
          turnId: String(turnId || "").trim(),
        }
      : { threadId: "", turnId: "" };
  };
  const ownsServerRequest = (message = {}) => {
    const requestTurnId = String(
      message.params?.turnId || message.params?.turn?.id || "",
    ).trim();
    if (!ownedSharedTurn.turnId || requestTurnId !== ownedSharedTurn.turnId) {
      return false;
    }
    const requestThreadId = String(
      message.params?.threadId || message.params?.thread?.id || "",
    ).trim();
    return !requestThreadId || requestThreadId === ownedSharedTurn.threadId;
  };
  const liveReporter = createLiveReporter();
  let goalSync = {
    mode: options.goalMode,
    supported: options.goalMode === "off" ? false : null,
    synced: false,
    skipped: options.goalMode === "off",
    error: "",
    goal: null,
  };

  try {
    client.onNotification((message) => {
      eventRecorder.record(message);
    });
    client.onServerRequest((message) => {
      void handleCodexServerRequest(client, message, options, eventRecorder, {
        ownsRequest: ownsServerRequest,
      });
    });
    await client.start({
      experimentalApi: options.experimentalApi || shouldUseGoalApi,
    });

    let threadResult;
    const requestedSessionId = sessionId;
    if ((options.sessionSeeded || options.goalOnly) && sessionId) {
      threadResult = await client.request(
        "thread/resume",
        client.effectiveMode === "shared"
          ? { threadId: sessionId }
          : { ...buildThreadParams(options), threadId: sessionId },
        options.resumeTimeoutMs,
      );
      sessionId = String(threadResult?.thread?.id || sessionId);
    } else {
      threadResult = await client.request("thread/start", buildThreadParams(options));
      sessionId = String(threadResult?.thread?.id || "");
    }

    if (!sessionId) {
      throw new Error("codex app-server did not return a thread id");
    }

    if (client.effectiveMode === "shared" && !options.goalOnly) {
      deliveryClaim = await acquireCodexDeliveryClaim(options.projectPath, {
        threadId: sessionId,
        requestId: options.requestId,
        timeoutMs: options.turnTimeoutMs > 0 ? options.turnTimeoutMs : 0,
        pollMs: 50,
      });
      eventRecorder.record({
        method: "clawdad/deliveryClaim/acquired",
        params: {
          threadId: sessionId,
          requestId: options.requestId,
          mode: deliveryClaim.mode,
          recovered: deliveryClaim.recovered,
        },
      });
      const refreshedThread = await readSharedThread(client, sessionId);
      threadResult = {
        ...(threadResult && typeof threadResult === "object" ? threadResult : {}),
        thread: refreshedThread,
      };
    }

    threadSource = String(threadResult?.thread?.source || "");
    threadPath = String(threadResult?.thread?.path || "");
    if (goalRequested) {
      goalSync = await syncThreadGoal(
        client,
        {
          threadId: sessionId,
          objective: options.threadGoal,
          status: options.threadGoalStatus,
          tokenBudget: options.threadGoalTokenBudget,
          clear: options.threadGoalClear,
          mode: options.goalMode,
        },
        options.goalSyncTimeoutMs,
      );
      eventRecorder.record({
        method: "clawdad/goal/sync",
        params: {
          threadId: sessionId,
          ...goalSync,
        },
      });
    }
    if (options.goalMode === "required" && !goalSync.synced) {
      throw new Error(goalSync.error || "required Codex thread goal sync failed");
    }

    if (options.goalOnly) {
      printJson({
        ok: goalSync.synced || goalSync.skipped,
        session_id: sessionId,
        thread_source: threadSource || null,
        thread_path: threadPath || null,
        thread_goal_mode: goalSync.mode,
        thread_goal_supported: goalSync.supported,
        thread_goal_synced: goalSync.synced,
        thread_goal_skipped: goalSync.skipped,
        thread_goal_status: goalSync.goal?.status || options.threadGoalStatus || "",
        thread_goal_objective: goalSync.goal?.objective || options.threadGoal || "",
        thread_goal: goalSync.goal || null,
        thread_goal_error: goalSync.error || "",
        result_text: "",
        error_text: "",
      });
      return;
    }

    const routedTurn = client.effectiveMode === "shared"
      ? await routeSharedTurnWithRecovery(client, sessionId, threadResult?.thread, options, {
          onWaitingLiveness: (snapshot) => {
            eventRecorder.record({
              method: "clawdad/turn/liveness",
              params: {
                threadId: sessionId,
                waitingForSharedTurn: true,
                ...snapshot,
              },
            });
          },
          onTurnAccepted: recordTurnOwnership,
        })
      : await (async () => {
          const turnResult = await client.request("turn/start", buildTurnParams(sessionId, options));
          const turnId = String(turnResult?.turn?.id || "").trim();
          if (!turnId) {
            throw new Error("codex app-server did not return a turn id");
          }
          recordTurnOwnership({ threadId: sessionId, turnId, ownsTurn: true });
          return {
            turnId,
            turn: turnResult.turn,
            deliveryMode: "start",
            alreadyTerminal: false,
          };
        })();
    const turnId = routedTurn.turnId;
    deliveryMode = routedTurn.deliveryMode;

    const completion = routedTurn.alreadyTerminal
      ? {
          turn: routedTurn.turn,
          completedAgentMessages: [],
          agentDeltaTexts: new Map(),
        }
      : await waitForTurnCompletionWithSharedRecovery(client, sessionId, turnId, options.turnTimeoutMs, {
        onAgentText: (text) => liveReporter.report(text),
        onLiveness: (snapshot) => {
        eventRecorder.record({
          method: "clawdad/turn/liveness",
          params: {
            threadId: sessionId,
            turnId,
            ...snapshot,
          },
        });
      },
      idleTimeoutMs: options.turnIdleTimeoutMs,
      toolIdleTimeoutMs: options.toolIdleTimeoutMs,
      livenessIntervalMs: options.livenessIntervalMs,
      livenessProbeTimeoutMs: options.livenessProbeTimeoutMs,
      projectPath: options.projectPath,
      interjectionDir: options.interjectionDir,
      sessionAliases: requestedSessionId && requestedSessionId !== sessionId ? [requestedSessionId] : [],
      });
    const resultText = await readTurnResult(
      client,
      sessionId,
      turnId,
      completion.completedAgentMessages,
      completion.agentDeltaTexts,
    );

    if (completion.turn?.status && completion.turn.status !== "completed") {
      throw new Error(`codex turn completed with status ${completion.turn.status}`);
    }
    if (completion.turn?.error) {
      throw new Error(describeError(completion.turn.error, "codex turn failed"));
    }
    await liveReporter.flush(resultText);

    printJson({
      ok: true,
      session_id: sessionId,
      thread_source: threadSource || null,
      thread_path: threadPath || null,
      app_server_mode: client.effectiveMode,
      delivery_mode: deliveryMode,
      client_request_id: options.requestId || null,
      thread_goal_mode: goalSync.mode,
      thread_goal_supported: goalSync.supported,
      thread_goal_synced: goalSync.synced,
      thread_goal_skipped: goalSync.skipped,
      thread_goal_status: goalSync.goal?.status || options.threadGoalStatus || "",
      thread_goal_objective: goalSync.goal?.objective || options.threadGoal || "",
      thread_goal: goalSync.goal || null,
      thread_goal_error: goalSync.error || "",
      result_text: resultText,
      error_text: "",
    });
  } catch (error) {
    if (error instanceof CodexTurnIdleTimeoutError) {
      const partialText = selectCodexTurnResultText({
        completedAgentMessages: error.completedAgentMessages,
        agentDeltaTexts: error.agentDeltaTexts,
      });
      const resultText = recoveredIdleResultText(partialText, error.idleTimeoutMs, error.recoveryReason);
      await liveReporter.flush(resultText);
      printJson({
        ok: false,
        recovered: true,
        recovery_reason: error.recoveryReason || "turn_idle_timeout",
        session_id: sessionId || "",
        thread_source: threadSource || null,
        thread_path: threadPath || null,
        thread_goal_mode: goalSync.mode,
        thread_goal_supported: goalSync.supported,
        thread_goal_synced: goalSync.synced,
        thread_goal_skipped: goalSync.skipped,
        thread_goal_status: goalSync.goal?.status || options.threadGoalStatus || "",
        thread_goal_objective: goalSync.goal?.objective || options.threadGoal || "",
        thread_goal: goalSync.goal || null,
        thread_goal_error: goalSync.error || "",
        result_text: resultText,
        error_text: resultText,
      });
      process.exitCode = 124;
      return;
    }
    printJson({
      ok: false,
      session_id: sessionId || "",
      thread_source: threadSource || null,
      thread_path: threadPath || null,
      app_server_mode: client.effectiveMode,
      delivery_mode: deliveryMode || null,
      client_request_id: options.requestId || null,
      thread_goal_mode: goalSync.mode,
      thread_goal_supported: goalSync.supported,
      thread_goal_synced: goalSync.synced,
      thread_goal_skipped: goalSync.skipped,
      thread_goal_status: goalSync.goal?.status || options.threadGoalStatus || "",
      thread_goal_objective: goalSync.goal?.objective || options.threadGoal || "",
      thread_goal: goalSync.goal || null,
      thread_goal_error: goalSync.error || "",
      result_text: "",
      error_text: [describeDispatchError(error, client), client.stderr.trim()].filter(Boolean).join("\n").trim(),
    });
    process.exitCode = 1;
  } finally {
    try {
      await eventRecorder.flush();
      await client.stop();
    } finally {
      await deliveryClaim?.release().catch(() => false);
      if (activeClient === client) {
        activeClient = null;
      }
    }
  }
}

await main();
