#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { mkdir, readFile, rm, stat } from "node:fs/promises";

const busyMailboxStates = new Set(["running", "dispatched"]);
const defaultPollMs = 1500;
const defaultTimeoutMs = 24 * 60 * 60 * 1000;
const defaultLockStaleMs = 30 * 60 * 1000;

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
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--item-file") {
      options.itemFile = String(argv[index + 1] || "").trim();
      index += 1;
    }
  }

  return options;
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function mailboxIsBusy(projectPath) {
  const statusFile = path.join(projectPath, ".clawdad", "mailbox", "status.json");
  const status = await readJsonFile(statusFile).catch(() => ({}));
  return busyMailboxStates.has(String(status?.state || "").trim().toLowerCase());
}

async function acquireQueueLock(lockDir, staleMs = defaultLockStaleMs) {
  try {
    await mkdir(lockDir, { recursive: false });
    return async () => {
      await rm(lockDir, { recursive: true, force: true }).catch(() => {});
    };
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
  }

  const existing = await stat(lockDir).catch(() => null);
  if (existing && Date.now() - existing.mtimeMs > staleMs) {
    await rm(lockDir, { recursive: true, force: true }).catch(() => {});
    return acquireQueueLock(lockDir, staleMs);
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.itemFile) {
    throw new Error("missing --item-file");
  }

  const item = await readJsonFile(options.itemFile);
  const projectPath = pickString(item.projectPath);
  const requestId = pickString(item.requestId);
  const message = pickString(item.message);
  if (!projectPath || !requestId || !message) {
    throw new Error("queued dispatch item is missing projectPath, requestId, or message");
  }

  const pollMs = Number.parseInt(String(item.pollMs || defaultPollMs), 10) || defaultPollMs;
  const timeoutMs = Number.parseInt(String(item.timeoutMs || defaultTimeoutMs), 10) || defaultTimeoutMs;
  const startedAt = Date.now();
  const lockDir = path.join(projectPath, ".clawdad", "mailbox", "dispatch-queue.lock");

  while (Date.now() - startedAt < timeoutMs) {
    const releaseLock = await acquireQueueLock(lockDir);
    if (!releaseLock) {
      await sleep(pollMs);
      continue;
    }

    let shouldWait = false;
    try {
      if (await mailboxIsBusy(projectPath)) {
        shouldWait = true;
      } else {
        await spawnDispatch(item);
        await rm(options.itemFile, { force: true }).catch(() => {});
        return;
      }
    } finally {
      await releaseLock();
    }

    if (shouldWait) {
      await sleep(pollMs);
    }
  }

  throw new Error(`queued dispatch ${requestId} timed out waiting for the mailbox to become idle`);
}

main().catch((error) => {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
});
