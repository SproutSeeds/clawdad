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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const options = {
    projectPath: "",
    message: "",
    sessionId: "",
    permissionMode: "approve",
    codexBinary: process.env.CLAWDAD_CODEX || "codex",
    model: "",
    sessionSeeded: false,
    turnTimeoutMs: parseNonNegativeInteger(process.env.CLAWDAD_CODEX_TURN_TIMEOUT_MS, 30 * 60 * 1000),
    requestTimeoutMs: parseNonNegativeInteger(process.env.CLAWDAD_CODEX_REQUEST_TIMEOUT_MS, 120_000),
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
      case "--session-seeded":
        options.sessionSeeded = true;
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

  async start() {
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
        version: "0.0.0",
      },
      capabilities: {
        experimentalApi: false,
      },
    });
  }

  async stop() {
    if (!this.child || this.closed) {
      return;
    }
    const childPid = this.child.pid;
    try {
      process.kill(-childPid, "SIGTERM");
    } catch {
      this.child.kill("SIGTERM");
    }
    const stopped = await Promise.race([
      this.exitPromise.then(() => true),
      sleep(2000).then(() => false),
    ]);
    if (!stopped && !this.closed) {
      try {
        process.kill(-childPid, "SIGKILL");
      } catch {
        this.child.kill("SIGKILL");
      }
      await Promise.race([
        this.exitPromise,
        sleep(1000),
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
        if (params.threadId !== threadId || params.turn?.id !== turnId) {
          return;
        }
        cleanup();
        resolve({
          turn: params.turn,
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
  if (!options.message) {
    printJson({ ok: false, error_text: "missing --message" });
    process.exitCode = 1;
    return;
  }

  const client = new AppServerClient(options.codexBinary, options.projectPath, {
    requestTimeoutMs: options.requestTimeoutMs,
  });
  activeClient = client;
  let sessionId = options.sessionId || "";
  let threadSource = "";
  let threadPath = "";

  try {
    await client.start();
    const liveReporter = createLiveReporter();

    let threadResult;
    if (options.sessionSeeded && sessionId) {
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
      result_text: resultText,
      error_text: "",
    });
  } catch (error) {
    printJson({
      ok: false,
      session_id: sessionId || "",
      thread_source: threadSource || null,
      thread_path: threadPath || null,
      result_text: "",
      error_text: [describeError(error), client.stderr.trim()].filter(Boolean).join("\n").trim(),
    });
    process.exitCode = 1;
  } finally {
    await client.stop();
    if (activeClient === client) {
      activeClient = null;
    }
  }
}

await main();
