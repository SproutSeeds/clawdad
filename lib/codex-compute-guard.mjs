import os from "node:os";
import path from "node:path";
import { open, readdir, stat } from "node:fs/promises";

export const defaultComputeReservePercent = 10;
export const defaultComputeHistoryFileLimit = 80;
export const defaultComputeTailBytes = 256 * 1024;
export const defaultComputeObservationMaxAgeMs = 30 * 60 * 1000;

function pickString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return "";
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

export function numberFromUnknown(value) {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizePercent(value, fallback = defaultComputeReservePercent) {
  const parsed = numberFromUnknown(value);
  const candidate = parsed == null ? fallback : parsed;
  if (!Number.isFinite(candidate)) {
    return fallback;
  }
  return Math.min(100, Math.max(0, candidate));
}

function normalizeOptionalPositiveInteger(value) {
  if (value == null || value === "" || value === false) {
    return null;
  }
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export function normalizeComputeBudget(payload = null) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const status = pickString(payload.status) || "unavailable";
  const usedPercent = numberFromUnknown(payload.usedPercent);
  const remainingPercent = numberFromUnknown(payload.remainingPercent);
  const reservePercent = normalizePercent(payload.reservePercent, defaultComputeReservePercent);
  const windowMinutes = normalizeOptionalPositiveInteger(payload.windowMinutes);
  const resetsAtRaw = Number.parseInt(String(payload.resetsAt || "0"), 10) || 0;

  return {
    status,
    checkedAt: pickString(payload.checkedAt) || null,
    source: pickString(payload.source) || null,
    limitId: pickString(payload.limitId) || null,
    limitName: pickString(payload.limitName) || null,
    windowMinutes,
    usedPercent: usedPercent == null ? null : Math.min(100, Math.max(0, usedPercent)),
    remainingPercent: remainingPercent == null ? null : Math.min(100, Math.max(0, remainingPercent)),
    reservePercent,
    resetsAt: resetsAtRaw > 0 ? resetsAtRaw : null,
    unlimited: boolFromUnknown(payload.unlimited, false),
    error: trimTrailingNewlines(String(payload.error || "")) || null,
  };
}

async function readFileTail(filePath, maxBytes) {
  let handle;
  try {
    handle = await open(filePath, "r");
    const fileStat = await handle.stat();
    const length = Math.min(fileStat.size, maxBytes);
    if (length <= 0) {
      return "";
    }
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, fileStat.size - length);
    return buffer.toString("utf8");
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function collectCodexSessionJsonlFiles(dirPath, { depth = 0, maxDepth = 5, files = [], fileLimit = defaultComputeHistoryFileLimit } = {}) {
  if (depth > maxDepth || files.length > fileLimit * 8) {
    return files;
  }

  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (_error) {
    return files;
  }

  await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await collectCodexSessionJsonlFiles(fullPath, { depth: depth + 1, maxDepth, files, fileLimit });
      return;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      return;
    }
    try {
      const fileStat = await stat(fullPath);
      files.push({ path: fullPath, mtimeMs: fileStat.mtimeMs });
    } catch (_error) {
      // Ignore files that disappear while scanning.
    }
  }));

  return files;
}

export function weeklyRateLimitWindow(rateLimit) {
  const windows = [rateLimit?.primary, rateLimit?.secondary]
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      usedPercent: numberFromUnknown(entry.used_percent ?? entry.usedPercent),
      windowMinutes: normalizeOptionalPositiveInteger(entry.window_minutes ?? entry.windowMinutes),
      resetsAt: Number.parseInt(String(entry.resets_at ?? entry.resetsAt ?? "0"), 10) || null,
    }))
    .filter((entry) => entry.usedPercent != null && entry.windowMinutes != null);

  if (windows.length === 0) {
    return null;
  }

  return (
    windows.find((entry) => entry.windowMinutes >= 7 * 24 * 60) ||
    windows.sort((left, right) => right.windowMinutes - left.windowMinutes)[0]
  );
}

export function computeBudgetFromRateLimit(rateLimit, {
  checkedAt = "",
  source = "",
  reservePercent = defaultComputeReservePercent,
  nowMs = Date.now(),
  maxObservationAgeMs = null,
} = {}) {
  const weeklyWindow = weeklyRateLimitWindow(rateLimit);
  if (!weeklyWindow) {
    return null;
  }
  if (weeklyWindow.resetsAt && weeklyWindow.resetsAt * 1000 <= nowMs) {
    return null;
  }
  const checkedAtMs = Date.parse(checkedAt);
  if (
    Number.isFinite(checkedAtMs) &&
    weeklyWindow.windowMinutes &&
    nowMs - checkedAtMs > weeklyWindow.windowMinutes * 60 * 1000
  ) {
    return null;
  }
  if (
    Number.isFinite(checkedAtMs) &&
    Number.isFinite(maxObservationAgeMs) &&
    maxObservationAgeMs >= 0 &&
    nowMs - checkedAtMs > maxObservationAgeMs
  ) {
    return null;
  }

  const usedPercent = Math.min(100, Math.max(0, weeklyWindow.usedPercent));
  return normalizeComputeBudget({
    status: "observed",
    checkedAt,
    source,
    limitId: pickString(rateLimit?.limit_id, rateLimit?.limitId) || "codex",
    limitName: pickString(rateLimit?.limit_name, rateLimit?.limitName) || null,
    windowMinutes: weeklyWindow.windowMinutes,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    reservePercent,
    resetsAt: weeklyWindow.resetsAt,
    unlimited: boolFromUnknown(rateLimit?.credits?.unlimited, false),
  });
}

export function extractComputeBudgetsFromSessionTail(text, source, {
  reservePercent = defaultComputeReservePercent,
  nowMs = Date.now(),
  maxEvents = 40,
  maxObservationAgeMs = null,
} = {}) {
  const lines = String(text || "").split(/\r?\n/u).filter(Boolean).reverse();
  const budgets = [];
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (_error) {
      continue;
    }
    const payload = parsed?.payload || parsed;
    if (payload?.type !== "token_count" || !payload.rate_limits) {
      continue;
    }
    const budget = computeBudgetFromRateLimit(payload.rate_limits, {
      checkedAt: pickString(parsed.timestamp) || new Date(nowMs).toISOString(),
      source,
      reservePercent,
      nowMs,
      maxObservationAgeMs,
    });
    if (budget) {
      budgets.push(budget);
      if (budgets.length >= maxEvents) {
        break;
      }
    }
  }
  return budgets;
}

function checkedAtMs(budget) {
  const parsed = Date.parse(pickString(budget?.checkedAt));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function selectMostConstrainedComputeBudget(budgets) {
  const observed = (Array.isArray(budgets) ? budgets : [])
    .map(normalizeComputeBudget)
    .filter((budget) => budget?.status === "observed");
  if (observed.length === 0) {
    return null;
  }

  const latestByLimit = new Map();
  const currentBudgets = [];
  observed.forEach((budget, index) => {
    const observedAt = checkedAtMs(budget);
    const limitKey = observedAt > 0
      ? pickString(budget.limitId, budget.limitName) || "codex"
      : `unkeyed:${index}`;
    const existing = latestByLimit.get(limitKey);
    if (!existing) {
      latestByLimit.set(limitKey, budget);
      return;
    }

    const existingAt = checkedAtMs(existing);
    const budgetRemaining = budget.remainingPercent == null ? 100 : budget.remainingPercent;
    const existingRemaining = existing.remainingPercent == null ? 100 : existing.remainingPercent;
    if (
      observedAt > existingAt ||
      (observedAt === existingAt && budgetRemaining < existingRemaining)
    ) {
      latestByLimit.set(limitKey, budget);
    }
  });
  currentBudgets.push(...latestByLimit.values());

  return currentBudgets.sort((left, right) => {
    if (left.unlimited !== right.unlimited) {
      return left.unlimited ? 1 : -1;
    }
    const leftRemaining = left.remainingPercent == null ? 100 : left.remainingPercent;
    const rightRemaining = right.remainingPercent == null ? 100 : right.remainingPercent;
    if (leftRemaining !== rightRemaining) {
      return leftRemaining - rightRemaining;
    }
    return checkedAtMs(right) - checkedAtMs(left);
  })[0] || null;
}

export async function readLatestCodexComputeBudget(config = {}, {
  codexHome = process.env.CLAWDAD_CODEX_HOME || path.join(os.homedir(), ".codex"),
  fileLimit = defaultComputeHistoryFileLimit,
  tailBytes = defaultComputeTailBytes,
  maxObservationAgeMs = defaultComputeObservationMaxAgeMs,
  nowMs = Date.now(),
} = {}) {
  const reservePercent = normalizePercent(config.computeReservePercent, defaultComputeReservePercent);
  if (!boolFromUnknown(config.computeGuardEnabled, true)) {
    return normalizeComputeBudget({
      status: "disabled",
      checkedAt: new Date(nowMs).toISOString(),
      source: "codex-session-log",
      reservePercent,
    });
  }

  const sessionsRoot = path.join(codexHome, "sessions");
  const files = (await collectCodexSessionJsonlFiles(sessionsRoot, { fileLimit }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, fileLimit);
  const budgets = [];

  for (const file of files) {
    try {
      const tail = await readFileTail(file.path, tailBytes);
      budgets.push(
        ...extractComputeBudgetsFromSessionTail(tail, file.path, {
          reservePercent,
          nowMs,
          maxObservationAgeMs,
        }),
      );
    } catch (_error) {
      // Keep scanning; one corrupt or rotating session file should not disable delegation.
    }
  }

  const budget = selectMostConstrainedComputeBudget(budgets);
  if (budget) {
    return budget;
  }

  return normalizeComputeBudget({
    status: "unavailable",
    checkedAt: new Date(nowMs).toISOString(),
    source: "codex-session-log",
    reservePercent,
    error: "No fresh Codex token_count event with weekly rate limit data was found.",
  });
}

export function computeBudgetIsBelowReserve(budget) {
  const normalized = normalizeComputeBudget(budget);
  if (!normalized || normalized.status !== "observed" || normalized.unlimited) {
    return false;
  }
  if (normalized.remainingPercent == null || normalized.reservePercent == null) {
    return false;
  }
  return normalized.remainingPercent <= normalized.reservePercent;
}

export function describeComputeBudget(budget) {
  const normalized = normalizeComputeBudget(budget);
  if (!normalized || normalized.status !== "observed") {
    return "Codex weekly compute remaining is unavailable.";
  }
  if (normalized.unlimited) {
    return "Codex weekly compute appears unlimited.";
  }
  const remaining = Math.round(Number(normalized.remainingPercent || 0) * 10) / 10;
  const reserve = Math.round(Number(normalized.reservePercent || 0) * 10) / 10;
  return `Codex weekly compute has ${remaining}% remaining; reserve is ${reserve}%.`;
}

export function looksLikeComputeLimitError(value) {
  const text = String(value || "").toLowerCase();
  if (!text) {
    return false;
  }
  return [
    "usage limit",
    "rate limit",
    "rate_limit",
    "quota",
    "compute",
    "credits",
    "too many requests",
    "insufficient_quota",
    "exceeded your current quota",
    "limit reached",
    "weekly limit",
    "ran out",
  ].some((needle) => text.includes(needle));
}
