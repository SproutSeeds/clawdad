#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { acquireDispatchAdmissionLock } from "./dispatch-admission-lock.mjs";

const busyMailboxStates = new Set(["starting", "dispatching", "running", "dispatched"]);
const terminalMailboxStates = new Set(["completed", "failed", "idle"]);
const activeQueueStates = new Set(["queued", "processing", "dispatched"]);
const defaultPollMs = 1500;
const defaultTimeoutMs = 0;
const defaultHandoffTimeoutMs = 60_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickString(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function parseArgs(argv) {
  const options = {
    itemFile: "",
    projectPath: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--item-file") {
      options.itemFile = String(argv[index + 1] || "").trim();
      index += 1;
    } else if (arg === "--project-path") {
      options.projectPath = String(argv[index + 1] || "").trim();
      index += 1;
    }
  }

  return options;
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJsonFile(filePath, payload) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function updateQueuedItem(itemFile, item, patch = {}) {
  const next = {
    ...item,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonFile(itemFile, next);
  return next;
}

function stateFileForItem(item) {
  const clawdadHome = pickString(
    item.clawdadHome,
    process.env.CLAWDAD_HOME,
    process.env.HOME ? path.join(process.env.HOME, ".clawdad") : "",
  );
  return clawdadHome ? path.join(clawdadHome, "state.json") : "";
}

async function resolveQueuedSessionAlias(item) {
  const projectPath = pickString(item.projectPath);
  const originalSessionId = pickString(item.sessionId);
  const stateFile = stateFileForItem(item);
  if (!projectPath || !originalSessionId || !stateFile) {
    return originalSessionId;
  }

  const state = await readJsonFile(stateFile).catch(() => null);
  const aliases = state?.projects?.[projectPath]?.session_aliases;
  if (!aliases || typeof aliases !== "object" || Array.isArray(aliases)) {
    return originalSessionId;
  }

  const seen = new Set();
  let resolvedSessionId = originalSessionId;
  while (
    resolvedSessionId &&
    !seen.has(resolvedSessionId) &&
    Object.prototype.hasOwnProperty.call(aliases, resolvedSessionId)
  ) {
    seen.add(resolvedSessionId);
    const nextSessionId = pickString(aliases[resolvedSessionId]);
    if (!nextSessionId || nextSessionId === resolvedSessionId) {
      break;
    }
    resolvedSessionId = nextSessionId;
  }
  return resolvedSessionId;
}

async function markQueuedDispatchFailed(itemFile, error) {
  const item = await readJsonFile(itemFile).catch(() => null);
  if (!item || typeof item !== "object") {
    return;
  }
  const failedAt = new Date().toISOString();
  const errorText = pickString(error?.message, error, "queued dispatch failed");
  await updateQueuedItem(itemFile, item, {
    state: "failed",
    failedAt,
    error: errorText,
  }).catch(() => {});

  const projectPath = pickString(item.projectPath);
  const requestId = pickString(item.requestId);
  if (!projectPath || !requestId) {
    return;
  }
  const indexFile = path.join(projectPath, ".clawdad", "history", "requests", `${requestId}.json`);
  const index = await readJsonFile(indexFile).catch(() => null);
  const recordFile = pickString(item.historyRecordFile, index?.file);
  if (!recordFile) {
    return;
  }
  const record = await readJsonFile(recordFile).catch(() => null);
  if (!record || typeof record !== "object") {
    return;
  }
  await writeJsonFile(recordFile, {
    ...record,
    status: "failed",
    answeredAt: failedAt,
    exitCode: 1,
    response: errorText,
  }).catch(() => {});
}

async function readMailboxStatus(projectPath) {
  const statusFile = path.join(projectPath, ".clawdad", "mailbox", "status.json");
  return readJsonFile(statusFile).catch(() => ({}));
}

function processIsLive(pid) {
  const normalized = Number.parseInt(String(pid || "0"), 10);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return false;
  }
  try {
    process.kill(normalized, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function acquireQueueLock(lockDir) {
  try {
    await mkdir(lockDir, { recursive: false });
    await writeJsonFile(path.join(lockDir, "owner.json"), {
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
    return async () => {
      const owner = await readJsonFile(path.join(lockDir, "owner.json")).catch(() => ({}));
      if (Number.parseInt(String(owner?.pid || "0"), 10) === process.pid) {
        await rm(lockDir, { recursive: true, force: true }).catch(() => {});
      }
    };
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
  }

  const owner = await readJsonFile(path.join(lockDir, "owner.json")).catch(() => ({}));
  if (!processIsLive(owner?.pid)) {
    await rm(lockDir, { recursive: true, force: true }).catch(() => {});
    return acquireQueueLock(lockDir);
  }

  return null;
}

async function spawnDispatch(item) {
  const clawdadBin = pickString(item.clawdadBin, process.env.CLAWDAD_BIN_PATH, path.resolve(process.cwd(), "bin", "clawdad"));
  const clawdadRoot = pickString(item.clawdadRoot, process.env.CLAWDAD_ROOT, process.cwd());
  const args = ["dispatch", item.projectPath, item.message];
  if (item.sessionId) {
    args.push("--session", item.sessionId);
  }
  if (item.attachmentManifest) {
    args.push("--attachment-manifest", item.attachmentManifest);
  }
  if (item.model) {
    args.push("--model", item.model);
  }
  if (item.reasoningEffort) {
    args.push("--reasoning-effort", item.reasoningEffort);
  }
  if (item.permissionMode) {
    args.push("--permission-mode", item.permissionMode);
  }

  await new Promise((resolve, reject) => {
    const child = spawn(clawdadBin, args, {
      cwd: clawdadRoot,
      stdio: "ignore",
      env: {
        ...process.env,
        CLAWDAD_ROOT: clawdadRoot,
        CLAWDAD_HOME: pickString(item.clawdadHome, process.env.CLAWDAD_HOME),
        CLAWDAD_DISPATCH_REQUEST_ID: item.requestId,
        CLAWDAD_DISPATCH_ADMISSION_HELD: item.dispatchAdmissionHeld ? "1" : "",
      },
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`queued dispatch command exited with code=${code ?? "null"} signal=${signal ?? "null"}`));
    });
  });
}

async function queuedItems(queueDir, itemFile = "") {
  if (itemFile) {
    const item = await readJsonFile(itemFile).catch(() => null);
    return item && activeQueueStates.has(String(item.state || "queued").trim().toLowerCase())
      ? [{ itemFile, item }]
      : [];
  }

  const fileNames = (await readdir(queueDir).catch(() => []))
    .filter((fileName) => fileName.endsWith(".json"));
  const items = [];
  for (const fileName of fileNames) {
    const currentItemFile = path.join(queueDir, fileName);
    const item = await readJsonFile(currentItemFile).catch(() => null);
    const state = String(item?.state || "queued").trim().toLowerCase();
    if (item && activeQueueStates.has(state)) {
      items.push({ itemFile: currentItemFile, item });
    }
  }
  items.sort((left, right) => {
    const leftCreatedAt = pickString(left.item.createdAt, left.item.sentAt);
    const rightCreatedAt = pickString(right.item.createdAt, right.item.sentAt);
    return (
      leftCreatedAt.localeCompare(rightCreatedAt) ||
      pickString(left.item.queueSequence).localeCompare(pickString(right.item.queueSequence)) ||
      left.itemFile.localeCompare(right.itemFile)
    );
  });
  return items;
}

function mailboxState(status = {}) {
  return String(status?.state || "").trim().toLowerCase();
}

function mailboxRequestId(status = {}) {
  return pickString(status?.request_id, status?.requestId);
}

async function processQueueItem(itemFile, item, pollMs, handoffTimeoutMs) {
  const projectPath = pickString(item.projectPath);
  const requestId = pickString(item.requestId);
  const message = pickString(item.message);
  if (!projectPath || !requestId || !message) {
    throw new Error("queued dispatch item is missing projectPath, requestId, or message");
  }

  const queuedSessionId = pickString(item.sessionId);
  const resolvedSessionId = await resolveQueuedSessionAlias(item);
  if (resolvedSessionId && resolvedSessionId !== queuedSessionId) {
    item = await updateQueuedItem(itemFile, item, {
      sessionId: resolvedSessionId,
      sessionRekeyedFrom: pickString(item.sessionRekeyedFrom, queuedSessionId),
      sessionRekeyedAt: new Date().toISOString(),
    });
  }

  const status = await readMailboxStatus(projectPath);
  const statusState = mailboxState(status);
  const statusRequestId = mailboxRequestId(status);
  const itemState = String(item.state || "queued").trim().toLowerCase();

  if (statusRequestId === requestId) {
    if (busyMailboxStates.has(statusState)) {
      await updateQueuedItem(itemFile, item, {
        state: "dispatched",
        dispatchedAt: pickString(item.dispatchedAt, status.dispatched_at, status.dispatchedAt),
        workerPid: status.pid || null,
        error: null,
      });
      return "wait";
    }
    if (terminalMailboxStates.has(statusState)) {
      await rm(itemFile, { force: true }).catch(() => {});
      return "completed";
    }
  }

  if (busyMailboxStates.has(statusState)) {
    return "wait";
  }

  if (itemState === "dispatched") {
    const dispatchedAt = Date.parse(pickString(item.dispatchedAt, item.updatedAt, item.createdAt));
    const handoffAgeMs = Number.isFinite(dispatchedAt) ? Date.now() - dispatchedAt : handoffTimeoutMs;
    if (handoffAgeMs < handoffTimeoutMs) {
      return "wait";
    }
    throw new Error(
      `queued dispatch ${requestId} was accepted but the mailbox did not acknowledge it within ` +
      `${Math.ceil(handoffTimeoutMs / 1000)}s; refusing to send a duplicate`,
    );
  }

  if (itemState === "processing") {
    const attemptedAt = Date.parse(pickString(item.dispatchAttemptedAt, item.startedAt, item.updatedAt));
    const attemptAgeMs = Number.isFinite(attemptedAt) ? Date.now() - attemptedAt : handoffTimeoutMs;
    if (attemptAgeMs < handoffTimeoutMs) {
      return "wait";
    }
    const attemptCount = Number.parseInt(String(item.attemptCount || "1"), 10) || 1;
    if (attemptCount >= 2) {
      throw new Error(
        `queued dispatch ${requestId} lost mailbox acknowledgment after ${attemptCount} attempts`,
      );
    }
    item = await updateQueuedItem(itemFile, item, {
      state: "queued",
      recoveredAt: new Date().toISOString(),
      error: null,
    });
  }

  const attemptCount = (Number.parseInt(String(item.attemptCount || "0"), 10) || 0) + 1;
  const dispatchAttemptedAt = new Date().toISOString();
  const processingItem = await updateQueuedItem(itemFile, item, {
    state: "processing",
    startedAt: pickString(item.startedAt, new Date().toISOString()),
    dispatchAttemptedAt,
    attemptCount,
    pumpPid: process.pid,
    error: null,
  });
  await spawnDispatch({
    ...processingItem,
    dispatchAdmissionHeld: true,
  });
  await updateQueuedItem(itemFile, processingItem, {
    state: "dispatched",
    dispatchedAt: new Date().toISOString(),
    pumpPid: process.pid,
    error: null,
  });
  return "dispatched";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.itemFile && !options.projectPath) {
    throw new Error("missing --project-path or --item-file");
  }

  const seedItem = options.itemFile
    ? await readJsonFile(options.itemFile)
    : null;
  const projectPath = pickString(options.projectPath, seedItem?.projectPath);
  if (!projectPath) {
    throw new Error("queued dispatch worker could not resolve its project path");
  }

  const queueDir = path.join(projectPath, ".clawdad", "mailbox", "queued");
  const explicitItemMode = Boolean(options.itemFile);
  const pollMs =
    Number.parseInt(String(seedItem?.pollMs || process.env.CLAWDAD_QUEUE_POLL_MS || defaultPollMs), 10) ||
    defaultPollMs;
  const timeoutMs =
    Number.parseInt(String(seedItem?.timeoutMs || process.env.CLAWDAD_QUEUE_TIMEOUT_MS || defaultTimeoutMs), 10) ||
    defaultTimeoutMs;
  const handoffTimeoutMs =
    Number.parseInt(String(
      seedItem?.handoffTimeoutMs ||
      process.env.CLAWDAD_QUEUE_HANDOFF_TIMEOUT_MS ||
      defaultHandoffTimeoutMs
    ), 10) ||
    defaultHandoffTimeoutMs;
  const startedAt = Date.now();
  const lockDir = path.join(projectPath, ".clawdad", "mailbox", "dispatch-queue.lock");
  const releaseLock = await acquireQueueLock(lockDir);
  if (!releaseLock) {
    return;
  }

  try {
    while (timeoutMs <= 0 || Date.now() - startedAt < timeoutMs) {
      const items = await queuedItems(queueDir, explicitItemMode ? options.itemFile : "");
      if (items.length === 0) {
        return;
      }

      const { itemFile, item } = items[0];
      let admission = null;
      try {
        admission = await acquireDispatchAdmissionLock(projectPath);
        const result = await processQueueItem(itemFile, item, pollMs, handoffTimeoutMs);
        await admission.release();
        admission = null;
        if (explicitItemMode && result === "dispatched") {
          await rm(itemFile, { force: true }).catch(() => {});
          return;
        }
        if (result === "wait") {
          await sleep(pollMs);
        }
      } catch (error) {
        await admission?.release().catch(() => {});
        if (error?.code === "CLAWDAD_DISPATCH_ADMISSION_TIMEOUT") {
          await sleep(pollMs);
          continue;
        }
        await markQueuedDispatchFailed(itemFile, error);
        if (explicitItemMode) {
          throw error;
        }
      }
    }
  } finally {
    await releaseLock();
  }

  throw new Error(`queued dispatch pump timed out waiting for ${projectPath} to become idle`);
}

main().catch((error) => {
  const options = parseArgs(process.argv.slice(2));
  void markQueuedDispatchFailed(options.itemFile, error).finally(() => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  });
});
