import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const defaultTimeoutMs = 15_000;
const defaultPollMs = 25;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeIdentifier(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  if (value.includes("\0")) {
    throw new TypeError(`${name} must not contain NUL bytes`);
  }
  return value;
}

function normalizeProjectPath(projectPath) {
  if (typeof projectPath !== "string" || projectPath.trim() === "") {
    throw new TypeError("projectPath must be a non-empty string");
  }
  if (projectPath.includes("\0")) {
    throw new TypeError("projectPath must not contain NUL bytes");
  }
  return path.resolve(projectPath);
}

function normalizeTimeout(value, fallback, name, { allowZero = false } = {}) {
  const normalized = value ?? fallback;
  if (
    typeof normalized !== "number"
    || !Number.isFinite(normalized)
    || (allowZero ? normalized < 0 : normalized <= 0)
  ) {
    throw new TypeError(`${name} must be ${allowZero ? "a non-negative" : "a positive"} finite number`);
  }
  return normalized;
}

function normalizePid(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("pid must be a positive safe integer");
  }
  return value;
}

function defaultProcessIsLive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    // EPERM and unfamiliar platform errors do not prove that the process is
    // dead. Treat them as live so ownership is preserved.
    return true;
  }
}

function ownerIsValid(owner, threadId, requestId) {
  return Boolean(
    owner
    && typeof owner === "object"
    && !Array.isArray(owner)
    && Number.isSafeInteger(owner.pid)
    && owner.pid > 0
    && typeof owner.token === "string"
    && owner.token.length > 0
    && owner.threadId === threadId
    && owner.requestId === requestId
    && typeof owner.acquiredAt === "string"
    && owner.acquiredAt.length > 0
    && Number.isFinite(Date.parse(owner.acquiredAt)),
  );
}

async function readOwner(ownerFile, threadId, requestId) {
  let source;
  try {
    source = await readFile(ownerFile, "utf8");
  } catch (error) {
    return {
      state: error?.code === "ENOENT" ? "missing" : "unreadable",
      owner: null,
      error,
    };
  }

  let owner;
  try {
    owner = JSON.parse(source);
  } catch (error) {
    return { state: "malformed", owner: null, error };
  }

  if (!ownerIsValid(owner, threadId, requestId)) {
    return { state: "malformed", owner: null, error: null };
  }
  return { state: "valid", owner, error: null };
}

async function isOwnerLive(owner, processIsLive) {
  try {
    return Boolean(await processIsLive(owner.pid));
  } catch {
    // A failed liveness probe is not proof of death.
    return true;
  }
}

function sameOwner(left, right) {
  return Boolean(
    left
    && right
    && left.pid === right.pid
    && left.token === right.token
    && left.threadId === right.threadId
    && left.requestId === right.requestId
    && left.acquiredAt === right.acquiredAt,
  );
}

async function restoreMovedClaim(movedDir, claimDir) {
  try {
    await rename(movedDir, claimDir);
    return true;
  } catch {
    // Preserve the moved directory when the canonical path has already been
    // occupied. In particular, never remove ownership that we cannot prove.
    return false;
  }
}

async function recoverDeadClaim({
  claimDir,
  ownerFile,
  claimRoot,
  key,
  expectedOwner,
  threadId,
  requestId,
  processIsLive,
}) {
  const current = await readOwner(ownerFile, threadId, requestId);
  if (current.state !== "valid" || !sameOwner(current.owner, expectedOwner)) {
    return false;
  }
  if (await isOwnerLive(current.owner, processIsLive)) {
    return false;
  }

  const movedDir = path.join(claimRoot, `.${key}.dead-${randomUUID()}`);
  try {
    await rename(claimDir, movedDir);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EEXIST") return false;
    throw error;
  }

  const movedOwnerFile = path.join(movedDir, "owner.json");
  const moved = await readOwner(movedOwnerFile, threadId, requestId);
  if (
    moved.state !== "valid"
    || !sameOwner(moved.owner, expectedOwner)
    || await isOwnerLive(moved.owner, processIsLive)
  ) {
    await restoreMovedClaim(movedDir, claimDir);
    return false;
  }

  await rm(movedDir, { recursive: true, force: true });
  return true;
}

async function releaseOwnedClaim({
  claimDir,
  claimRoot,
  ownerFile,
  key,
  token,
  threadId,
  requestId,
}) {
  const current = await readOwner(ownerFile, threadId, requestId);
  if (current.state !== "valid" || current.owner.token !== token) {
    return false;
  }

  const movedDir = path.join(claimRoot, `.${key}.release-${randomUUID()}`);
  try {
    await rename(claimDir, movedDir);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EEXIST") return false;
    throw error;
  }

  const moved = await readOwner(path.join(movedDir, "owner.json"), threadId, requestId);
  if (moved.state !== "valid" || moved.owner.token !== token) {
    await restoreMovedClaim(movedDir, claimDir);
    return false;
  }

  await rm(movedDir, { recursive: true, force: true });
  return true;
}

export function codexDeliveryClaimKey(threadId, requestId) {
  const normalizedThreadId = normalizeIdentifier(threadId, "threadId");
  const normalizedRequestId = normalizeIdentifier(requestId, "requestId");
  return createHash("sha256")
    .update(normalizedThreadId, "utf8")
    .update("\0", "utf8")
    .update(normalizedRequestId, "utf8")
    .digest("hex");
}

/**
 * Claims delivery of one request into one Codex thread across local processes.
 *
 * The returned `mode` is `recovered` only when this acquisition removed a
 * token-verified owner whose process was confirmed dead. Malformed ownership
 * metadata is deliberately left in place and eventually times out because it
 * cannot safely prove that the owner is dead.
 */
export async function acquireCodexDeliveryClaim(
  projectPath,
  {
    threadId,
    requestId,
    timeoutMs = defaultTimeoutMs,
    pollMs = defaultPollMs,
    pid = process.pid,
    token = randomUUID(),
    processIsLive = defaultProcessIsLive,
    now = () => Date.now(),
    sleep = delay,
  } = {},
) {
  const projectRoot = normalizeProjectPath(projectPath);
  const normalizedThreadId = normalizeIdentifier(threadId, "threadId");
  const normalizedRequestId = normalizeIdentifier(requestId, "requestId");
  const normalizedPid = normalizePid(pid);
  const normalizedToken = normalizeIdentifier(token, "token");
  const normalizedTimeoutMs = normalizeTimeout(timeoutMs, defaultTimeoutMs, "timeoutMs", { allowZero: true });
  const normalizedPollMs = normalizeTimeout(pollMs, defaultPollMs, "pollMs");
  if (typeof processIsLive !== "function") {
    throw new TypeError("processIsLive must be a function");
  }
  if (typeof now !== "function" || typeof sleep !== "function") {
    throw new TypeError("now and sleep must be functions");
  }

  const key = codexDeliveryClaimKey(normalizedThreadId, normalizedRequestId);
  const claimRoot = path.join(projectRoot, ".clawdad", "mailbox", "delivery-claims");
  const claimDir = path.join(claimRoot, key);
  if (path.dirname(claimDir) !== claimRoot || !/^[a-f0-9]{64}$/u.test(path.basename(claimDir))) {
    throw new Error("refusing an unsafe Codex delivery claim path");
  }
  const ownerFile = path.join(claimDir, "owner.json");
  const startedAt = Number(now());
  if (!Number.isFinite(startedAt)) {
    throw new TypeError("now must return a finite millisecond timestamp");
  }
  let recovered = false;

  await mkdir(claimRoot, { recursive: true, mode: 0o700 });
  await chmod(claimRoot, 0o700).catch(() => {});

  for (;;) {
    try {
      await mkdir(claimDir, { mode: 0o700 });
      const owner = {
        pid: normalizedPid,
        token: normalizedToken,
        threadId: normalizedThreadId,
        requestId: normalizedRequestId,
        acquiredAt: new Date(Number(now())).toISOString(),
      };
      try {
        await writeFile(ownerFile, `${JSON.stringify(owner, null, 2)}\n`, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
      } catch (error) {
        // mkdir made this directory exclusively. rmdir only removes it if it
        // is still empty, so failed initialization cannot erase foreign data.
        await rmdir(claimDir).catch(() => {});
        throw error;
      }

      let releaseAttempted = false;
      return {
        mode: recovered ? "recovered" : "acquired",
        recovered,
        key,
        claimRoot,
        claimDir,
        ownerFile,
        owner,
        token: normalizedToken,
        async release() {
          if (releaseAttempted) return false;
          releaseAttempted = true;
          return releaseOwnedClaim({
            claimDir,
            claimRoot,
            ownerFile,
            key,
            token: normalizedToken,
            threadId: normalizedThreadId,
            requestId: normalizedRequestId,
          });
        },
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }

    const existing = await readOwner(ownerFile, normalizedThreadId, normalizedRequestId);
    if (existing.state === "valid" && !await isOwnerLive(existing.owner, processIsLive)) {
      const didRecover = await recoverDeadClaim({
        claimDir,
        ownerFile,
        claimRoot,
        key,
        expectedOwner: existing.owner,
        threadId: normalizedThreadId,
        requestId: normalizedRequestId,
        processIsLive,
      });
      if (didRecover) {
        recovered = true;
        continue;
      }
    }

    const elapsedMs = Number(now()) - startedAt;
    if (!Number.isFinite(elapsedMs)) {
      throw new TypeError("now must return a finite millisecond timestamp");
    }
    if (normalizedTimeoutMs > 0 && elapsedMs >= normalizedTimeoutMs) {
      const timeoutError = new Error(
        `timed out waiting for Codex delivery claim ${key} in ${projectRoot}`,
      );
      timeoutError.code = "CLAWDAD_CODEX_DELIVERY_CLAIM_TIMEOUT";
      timeoutError.claimKey = key;
      timeoutError.ownerState = existing.state;
      timeoutError.ownerPid = existing.state === "valid" ? existing.owner.pid : null;
      throw timeoutError;
    }

    await sleep(
      normalizedTimeoutMs === 0
        ? normalizedPollMs
        : Math.min(normalizedPollMs, normalizedTimeoutMs - elapsedMs),
    );
  }
}
