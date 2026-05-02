#!/usr/bin/env node

import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { extractAgentMessageText, selectCodexTurnResultText } from "./codex-turn-result.mjs";

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
    permissionMode: "approve",
    codexBinary: process.env.CLAWDAD_CODEX || "codex",
    model: "",
    sessionSeeded: false,
    turnTimeoutMs: parseNonNegativeInteger(process.env.CLAWDAD_CODEX_TURN_TIMEOUT_MS, 30 * 60 * 1000),
    requestTimeoutMs: parseNonNegativeInteger(process.env.CLAWDAD_CODEX_REQUEST_TIMEOUT_MS, 120_000),
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
      case "--permission-mode":
        options.permissionMode = String(argv[index + 1] || "").trim() || options.permissionMode;
        index += 1;
        break;
      case "--codex-binary":
        options.codexBinary = String(argv[index + 1] || "").trim() || options.codexBinary;
        index += 1;
        break;
      case "--model":
        options.model = String(argv[index + 1] || "").trim();
        index += 1;
        break;
      case "--turn-timeout-ms":
        options.turnTimeoutMs = parseNonNegativeInteger(argv[index + 1], options.turnTimeoutMs);
        index += 1;
        break;
      case "--request-timeout-ms":
        options.requestTimeoutMs = parseNonNegativeInteger(argv[index + 1], options.requestTimeoutMs);
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
  return params;
}

function buildTurnParams(threadId, options) {
  const params = {
    threadId,
    cwd: options.projectPath,
    approvalPolicy: "never",
    input: [
      {
        type: "text",
        text: options.message,
        text_elements: [],
      },
    ],
    sandboxPolicy: turnSandboxForPermission(options.permissionMode, options.projectPath),
  };
  if (options.model) {
    params.model = options.model;
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
    payload: compactCodexEventPayload(message),
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

    const cleanText = String(text || "").trim();
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
  constructor(binary, cwd, { requestTimeoutMs = 120_000 } = {}) {
    this.binary = binary;
    this.cwd = cwd;
    this.requestTimeoutMs = requestTimeoutMs;
    this.child = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    this.closed = false;
    this.notificationListeners = new Set();
    this.exitPromise = null;
  }

  async start({ experimentalApi = false } = {}) {
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

    this.exitPromise = new Promise((resolve) => {
      this.child.once("exit", (code, signal) => {
        this.closed = true;
        for (const [, pending] of this.pending) {
          pending.clearTimer?.();
          pending.reject(new Error(`codex app-server exited before responding (code=${code ?? "null"}, signal=${signal ?? "null"})`));
        }
        this.pending.clear();
        resolve({ code, signal });
      });
    });

    await this.request("initialize", {
      clientInfo: {
        name: "clawdad",
        title: "Clawdad",
        version: "0.0.0",
      },
      capabilities: {
        experimentalApi: Boolean(experimentalApi),
      },
    });
    this.notify("initialized", {});
  }

  async stop() {
    if (!this.child || this.closed) {
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
      await Promise.race([
        this.exitPromise,
        sleep(500),
      ]);
    }
  }

  onNotification(listener) {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  async request(method, params, timeoutMs = this.requestTimeoutMs) {
    if (!this.child || this.closed) {
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
        this.child.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        this.pending.delete(id);
        clearTimer();
        reject(error);
      }
    });
  }

  notify(method, params = {}) {
    if (!this.child || this.closed) {
      throw new Error("codex app-server is not running");
    }
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  #drainStdout() {
    for (;;) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }

      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        for (const listener of this.notificationListeners) {
          listener({ type: "parse_error", error, raw: line });
        }
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(message, "id")) {
        const pending = this.pending.get(message.id);
        if (!pending) {
          continue;
        }
        this.pending.delete(message.id);
        pending.clearTimer?.();
        if (message.error) {
          pending.reject(message.error);
        } else {
          pending.resolve(message.result);
        }
        continue;
      }

      for (const listener of this.notificationListeners) {
        listener(message);
      }
    }
  }
}

async function waitForTurnCompletion(client, threadId, turnId, timeoutMs = 0, { onAgentText = null } = {}) {
  const completedAgentMessages = [];
  const agentDeltaTexts = new Map();

  return new Promise((resolve, reject) => {
    let timeoutId = null;
    let removeListener = () => {};
    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      removeListener();
    };

    removeListener = client.onNotification((message) => {
      if (!message || typeof message !== "object") {
        return;
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
        cleanup();
        resolve({
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
        cleanup();
        reject(new Error(describeError(params, "codex app-server reported an error")));
      }
    });

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`codex turn did not complete within ${Math.ceil(timeoutMs / 1000)}s`));
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

  const client = new AppServerClient(options.codexBinary, options.projectPath, {
    requestTimeoutMs: options.requestTimeoutMs,
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
    await client.start({
      experimentalApi: options.experimentalApi || shouldUseGoalApi,
    });
    const liveReporter = createLiveReporter();

    let threadResult;
    if ((options.sessionSeeded || options.goalOnly) && sessionId) {
      threadResult = await client.request("thread/resume", {
        ...buildThreadParams(options),
        threadId: sessionId,
      });
      sessionId = String(threadResult?.thread?.id || sessionId);
    } else {
      threadResult = await client.request("thread/start", buildThreadParams(options));
      sessionId = String(threadResult?.thread?.id || "");
    }

    if (!sessionId) {
      throw new Error("codex app-server did not return a thread id");
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

    const turnResult = await client.request("turn/start", buildTurnParams(sessionId, options));
    const turnId = String(turnResult?.turn?.id || "").trim();
    if (!turnId) {
      throw new Error("codex app-server did not return a turn id");
    }

    const completion = await waitForTurnCompletion(client, sessionId, turnId, options.turnTimeoutMs, {
      onAgentText: (text) => liveReporter.report(text),
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
    printJson({
      ok: false,
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
      result_text: "",
      error_text: [describeError(error), client.stderr.trim()].filter(Boolean).join("\n").trim(),
    });
    process.exitCode = 1;
  } finally {
    await eventRecorder.flush();
    await client.stop();
    if (activeClient === client) {
      activeClient = null;
    }
  }
}

await main();
