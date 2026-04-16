import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  computeBudgetFromRateLimit,
  computeBudgetIsBelowReserve,
  extractComputeBudgetsFromSessionTail,
  looksLikeComputeLimitError,
  readLatestCodexComputeBudget,
  selectMostConstrainedComputeBudget,
  weeklyRateLimitWindow,
} from "../lib/codex-compute-guard.mjs";

const nowMs = Date.parse("2026-04-11T12:00:00.000Z");
const futureReset = Math.floor((nowMs + 5 * 24 * 60 * 60 * 1000) / 1000);
const expiredReset = Math.floor((nowMs - 60 * 1000) / 1000);

function tokenCountLine({ timestamp = "2026-04-11T11:59:00.000Z", used = 50, limitId = "codex", reset = futureReset } = {}) {
  return JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      rate_limits: {
        limit_id: limitId,
        primary: {
          used_percent: 99,
          window_minutes: 300,
          resets_at: reset,
        },
        secondary: {
          used_percent: used,
          window_minutes: 10080,
          resets_at: reset,
        },
        credits: {
          unlimited: false,
        },
      },
    },
  });
}

test("weeklyRateLimitWindow prefers the 10080-minute weekly window", () => {
  const window = weeklyRateLimitWindow({
    primary: { used_percent: 99, window_minutes: 300, resets_at: futureReset },
    secondary: { used_percent: 42, window_minutes: 10080, resets_at: futureReset },
  });

  assert.equal(window.usedPercent, 42);
  assert.equal(window.windowMinutes, 10080);
});

test("computeBudgetFromRateLimit ignores expired reset windows", () => {
  const budget = computeBudgetFromRateLimit(
    {
      secondary: {
        used_percent: 97,
        window_minutes: 10080,
        resets_at: expiredReset,
      },
    },
    {
      checkedAt: "2026-04-11T11:59:00.000Z",
      nowMs,
    },
  );

  assert.equal(budget, null);
});

test("computeBudgetFromRateLimit ignores stale observations when a freshness window is required", () => {
  const budget = computeBudgetFromRateLimit(
    {
      secondary: {
        used_percent: 100,
        window_minutes: 10080,
        resets_at: futureReset,
      },
    },
    {
      checkedAt: "2026-04-11T10:59:00.000Z",
      maxObservationAgeMs: 30 * 60 * 1000,
      nowMs,
    },
  );

  assert.equal(budget, null);
});

test("extractComputeBudgetsFromSessionTail parses current token_count rate limits", () => {
  const budgets = extractComputeBudgetsFromSessionTail(
    [
      "not json",
      tokenCountLine({ used: 91 }),
      tokenCountLine({ used: 23, limitId: "codex_spark" }),
    ].join("\n"),
    "synthetic.jsonl",
    { reservePercent: 10, nowMs },
  );

  assert.equal(budgets.length, 2);
  assert.equal(budgets[0].remainingPercent, 77);
  assert.equal(budgets[1].remainingPercent, 9);
});

test("selectMostConstrainedComputeBudget chooses lowest remaining current budget", () => {
  const selected = selectMostConstrainedComputeBudget([
    { status: "observed", remainingPercent: 77, usedPercent: 23, reservePercent: 10, limitId: "codex" },
    { status: "observed", remainingPercent: 9, usedPercent: 91, reservePercent: 10, limitId: "codex_spark" },
    { status: "observed", remainingPercent: 100, usedPercent: 0, reservePercent: 10, unlimited: true },
  ]);

  assert.equal(selected.remainingPercent, 9);
  assert.equal(computeBudgetIsBelowReserve(selected), true);
});

test("selectMostConstrainedComputeBudget ignores older telemetry for the same limit", () => {
  const selected = selectMostConstrainedComputeBudget([
    {
      status: "observed",
      checkedAt: "2026-04-16T07:40:56.965Z",
      remainingPercent: 0,
      usedPercent: 100,
      reservePercent: 0,
      limitId: "codex",
    },
    {
      status: "observed",
      checkedAt: "2026-04-16T13:45:38.332Z",
      remainingPercent: 100,
      usedPercent: 0,
      reservePercent: 0,
      limitId: "codex",
    },
  ]);

  assert.equal(selected.remainingPercent, 100);
  assert.equal(computeBudgetIsBelowReserve(selected), false);
});

test("computeBudgetIsBelowReserve pauses at the exact reserve boundary", () => {
  assert.equal(
    computeBudgetIsBelowReserve({ status: "observed", remainingPercent: 10, reservePercent: 10 }),
    true,
  );
  assert.equal(
    computeBudgetIsBelowReserve({ status: "observed", remainingPercent: 10.1, reservePercent: 10 }),
    false,
  );
  assert.equal(
    computeBudgetIsBelowReserve({ status: "observed", remainingPercent: 1, reservePercent: 10, unlimited: true }),
    false,
  );
});

test("readLatestCodexComputeBudget scans multiple recent files and returns the tightest current weekly budget", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-compute-guard-"));
  const sessionsDir = path.join(root, "sessions", "2026", "04", "11");
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(path.join(sessionsDir, "safe.jsonl"), `${tokenCountLine({ used: 23 })}\n`, "utf8");
  await writeFile(path.join(sessionsDir, "tight.jsonl"), `${tokenCountLine({ used: 92 })}\n`, "utf8");

  const budget = await readLatestCodexComputeBudget(
    { computeGuardEnabled: true, computeReservePercent: 10 },
    { codexHome: root, nowMs, fileLimit: 10 },
  );

  assert.equal(budget.status, "observed");
  assert.equal(budget.usedPercent, 92);
  assert.equal(budget.remainingPercent, 8);
  assert.equal(computeBudgetIsBelowReserve(budget), true);
});

test("readLatestCodexComputeBudget does not hard-block on stale-only telemetry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-compute-guard-stale-"));
  const sessionsDir = path.join(root, "sessions", "2026", "04", "11");
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    path.join(sessionsDir, "stale.jsonl"),
    `${tokenCountLine({ timestamp: "2026-04-11T10:59:00.000Z", used: 100 })}\n`,
    "utf8",
  );

  const budget = await readLatestCodexComputeBudget(
    { computeGuardEnabled: true, computeReservePercent: 0 },
    { codexHome: root, nowMs, fileLimit: 10, maxObservationAgeMs: 30 * 60 * 1000 },
  );

  assert.equal(budget.status, "unavailable");
  assert.equal(computeBudgetIsBelowReserve(budget), false);
  assert.match(budget.error, /No fresh Codex token_count/u);
});

test("readLatestCodexComputeBudget reports disabled guard without scanning", async () => {
  const budget = await readLatestCodexComputeBudget(
    { computeGuardEnabled: false, computeReservePercent: 12 },
    { codexHome: "/path/that/does/not/exist", nowMs },
  );

  assert.equal(budget.status, "disabled");
  assert.equal(budget.reservePercent, 12);
});

test("looksLikeComputeLimitError catches quota and rate-limit phrasing", () => {
  assert.equal(looksLikeComputeLimitError("You exceeded your current quota."), true);
  assert.equal(looksLikeComputeLimitError("rate_limit: too many requests"), true);
  assert.equal(looksLikeComputeLimitError("plain syntax error"), false);
});
