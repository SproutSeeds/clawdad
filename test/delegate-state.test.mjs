import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeDelegatePhaseHandoff,
  chooseDelegateSession,
  delegatePauseDecision,
  delegatePlanRefreshDecision,
  delegateRunListState,
  recoverableCodexStreamDisconnect,
  shouldClearPendingDelegatePause,
} from "../lib/delegate-state.mjs";

const sessions = [
  { provider: "codex", slug: "Main-erdos", sessionId: "main" },
  { provider: "codex", slug: "Delegate", sessionId: "delegate" },
  { provider: "chimera", slug: "Delegate", sessionId: "chimera-delegate" },
];

test("chooseDelegateSession keeps a non-active configured delegate session", () => {
  const choice = chooseDelegateSession({
    sessions,
    activeSessionId: "main",
    config: { delegateSessionId: "delegate", delegateSessionSlug: "Delegate" },
  });

  assert.equal(choice.session.sessionId, "delegate");
  assert.equal(choice.resetToDefault, false);
  assert.equal(choice.collidesWithActive, false);
});

test("chooseDelegateSession keeps an exact configured session id even when active", () => {
  const choice = chooseDelegateSession({
    sessions,
    activeSessionId: "main",
    config: { delegateSessionId: "main", delegateSessionSlug: "Main-erdos" },
  });

  assert.equal(choice.session.sessionId, "main");
  assert.equal(choice.resetToDefault, false);
  assert.equal(choice.collidesWithActive, true);
});

test("chooseDelegateSession falls back to Delegate when only configured slug is active", () => {
  const choice = chooseDelegateSession({
    sessions,
    activeSessionId: "main",
    config: { delegateSessionSlug: "Main-erdos" },
  });

  assert.equal(choice.session.sessionId, "delegate");
  assert.equal(choice.resetToDefault, true);
  assert.equal(choice.collidesWithActive, true);
});

test("chooseDelegateSession asks caller to create Delegate when only the active lane matches", () => {
  const choice = chooseDelegateSession({
    sessions: [{ provider: "codex", slug: "Main-erdos", sessionId: "main" }],
    activeSessionId: "main",
    config: { delegateSessionSlug: "Main-erdos" },
  });

  assert.equal(choice.session, null);
  assert.equal(choice.resetToDefault, true);
  assert.equal(choice.collidesWithActive, true);
});

test("shouldClearPendingDelegatePause ignores inactive delegate runs", () => {
  assert.equal(
    shouldClearPendingDelegatePause({
      runningJob: null,
      currentStatus: { pauseRequested: true },
      currentConfig: { enabled: false },
    }),
    false,
  );
});

test("shouldClearPendingDelegatePause clears any live pending-pause signal", () => {
  assert.equal(
    shouldClearPendingDelegatePause({
      runningJob: { pauseRequested: true },
      currentStatus: { pauseRequested: false },
      currentConfig: { enabled: true },
    }),
    true,
  );
  assert.equal(
    shouldClearPendingDelegatePause({
      runningJob: { pauseRequested: false },
      currentStatus: { pauseRequested: true },
      currentConfig: { enabled: true },
    }),
    true,
  );
  assert.equal(
    shouldClearPendingDelegatePause({
      runningJob: { pauseRequested: false },
      currentStatus: { pauseRequested: false },
      currentConfig: { enabled: false },
    }),
    true,
  );
});

test("shouldClearPendingDelegatePause leaves ordinary active runs alone", () => {
  assert.equal(
    shouldClearPendingDelegatePause({
      runningJob: { pauseRequested: false },
      currentStatus: { pauseRequested: false },
      currentConfig: { enabled: true },
    }),
    false,
  );
});

test("delegatePauseDecision requests a safe-point pause for live running delegates", () => {
  assert.deepEqual(
    delegatePauseDecision({
      status: { state: "running" },
      hasActiveRunJob: false,
      supervisorLive: true,
    }),
    {
      state: "running",
      pauseRequested: true,
      waitForSafePoint: true,
    },
  );
});

test("delegatePauseDecision pauses stale running delegates immediately", () => {
  assert.deepEqual(
    delegatePauseDecision({
      status: { state: "running" },
      hasActiveRunJob: false,
      supervisorLive: false,
    }),
    {
      state: "paused",
      pauseRequested: false,
      waitForSafePoint: false,
    },
  );
});

test("delegatePauseDecision requests a safe-point pause for active planning jobs", () => {
  assert.deepEqual(
    delegatePauseDecision({
      status: { state: "planning" },
      hasActivePlanJob: true,
    }),
    {
      state: "planning",
      pauseRequested: true,
      waitForSafePoint: true,
    },
  );
});

test("recoverableCodexStreamDisconnect detects retryable websocket drops", () => {
  assert.equal(
    recoverableCodexStreamDisconnect({
      mailboxStatus: {
        error: JSON.stringify({
          error: {
            message: "Reconnecting... 2/5",
            codexErrorInfo: {
              responseStreamDisconnected: {
                httpStatusCode: null,
              },
            },
            additionalDetails:
              "stream disconnected before completion: websocket closed by server before response.completed",
          },
          willRetry: true,
        }),
      },
    }),
    true,
  );
});

test("recoverableCodexStreamDisconnect ignores ordinary delegate failures", () => {
  assert.equal(
    recoverableCodexStreamDisconnect({
      mailboxStatus: {
        error: "delegate response did not include the required JSON decision block",
      },
    }),
    false,
  );
});

test("delegateRunListState keeps current failed status over stale running log event", () => {
  assert.equal(
    delegateRunListState({
      existingState: "failed",
      eventState: "running",
      statusMatchesRun: true,
    }),
    "failed",
  );
});

test("delegateRunListState uses log event state for non-current historical runs", () => {
  assert.equal(
    delegateRunListState({
      existingState: "summary",
      eventState: "failed",
      statusMatchesRun: false,
    }),
    "failed",
  );
});

test("analyzeDelegatePhaseHandoff detects repeated numbered ladder actions", () => {
  const sourceEntries = [
    {
      answeredAt: "2026-04-12T17:41:23Z",
      response: '```json\n{"state":"continue","stop_reason":"none","next_action":"Certify q541 via the same two-sided CRT floor-bound packet and advance to the next residual tail prime.","summary":"ok"}\n```',
    },
    {
      answeredAt: "2026-04-12T17:47:23Z",
      response: '```json\n{"state":"continue","stop_reason":"none","next_action":"Certify q547 via the same two-sided CRT floor-bound packet and advance to the next residual tail prime.","summary":"ok"}\n```',
    },
    {
      answeredAt: "2026-04-12T17:53:11Z",
      response: '```json\n{"state":"continue","stop_reason":"none","next_action":"Certify q557 via the same two-sided CRT floor-bound packet and advance to the next residual tail prime.","summary":"ok"}\n```',
    },
  ];

  const analysis = analyzeDelegatePhaseHandoff({
    sourceEntries,
    status: {
      nextAction: "Certify q563 via the same two-sided CRT floor-bound packet and advance to the next residual tail prime.",
    },
  });

  assert.equal(analysis.triggered, true);
  assert.equal(analysis.repeatCount, 4);
  assert.match(analysis.pattern, /q#/);
});

test("analyzeDelegatePhaseHandoff ignores varied work packets", () => {
  const analysis = analyzeDelegatePhaseHandoff({
    sourceEntries: [
      {
        answeredAt: "2026-04-12T10:00:00Z",
        nextAction: "Write a run matrix summary.",
      },
      {
        answeredAt: "2026-04-12T10:05:00Z",
        nextAction: "Run the focused smoke tests.",
      },
      {
        answeredAt: "2026-04-12T10:10:00Z",
        nextAction: "Patch the README setup flow.",
      },
    ],
    status: {
      nextAction: "Open a release PR.",
    },
  });

  assert.equal(analysis.triggered, false);
  assert.equal(analysis.repeatCount, 1);
});

test("delegatePlanRefreshDecision refreshes when no plan exists", () => {
  const decision = delegatePlanRefreshDecision({
    latestPlan: null,
    status: { stepCount: 4 },
    sourceEntryCount: 10,
  });

  assert.equal(decision.refresh, true);
  assert.equal(decision.reason, "missing_plan");
});

test("delegatePlanRefreshDecision refreshes old legacy plans without step metadata", () => {
  const decision = delegatePlanRefreshDecision({
    latestPlan: {
      createdAt: "2026-04-12T10:00:00Z",
      sourceEntryCount: 8,
      plan: "old plan",
    },
    status: { stepCount: 12 },
    sourceEntryCount: 9,
    nowMs: Date.parse("2026-04-12T12:00:00Z"),
  });

  assert.equal(decision.refresh, true);
  assert.equal(decision.reason, "stale_age");
});

test("delegatePlanRefreshDecision refreshes phase handoffs but not every adjacent step", () => {
  const staleEnough = delegatePlanRefreshDecision({
    latestPlan: {
      createdAt: "2026-04-12T10:00:00Z",
      stepCount: 4,
      sourceEntryCount: 8,
      plan: "old plan",
    },
    status: { stepCount: 7 },
    sourceEntryCount: 10,
    phaseHandoffAnalysis: { triggered: true },
    nowMs: Date.parse("2026-04-12T10:30:00Z"),
  });

  assert.equal(staleEnough.refresh, true);
  assert.equal(staleEnough.reason, "phase_handoff");

  const tooSoon = delegatePlanRefreshDecision({
    latestPlan: {
      createdAt: "2026-04-12T10:29:00Z",
      stepCount: 7,
      sourceEntryCount: 10,
      plan: "fresh plan",
    },
    status: { stepCount: 8 },
    sourceEntryCount: 11,
    phaseHandoffAnalysis: { triggered: true },
    nowMs: Date.parse("2026-04-12T10:35:00Z"),
  });

  assert.equal(tooSoon.refresh, false);
  assert.equal(tooSoon.reason, "fresh");
});

test("delegatePlanRefreshDecision refreshes after enough completed steps", () => {
  const decision = delegatePlanRefreshDecision({
    latestPlan: {
      createdAt: "2026-04-12T10:00:00Z",
      stepCount: 2,
      sourceEntryCount: 12,
      plan: "recent enough but old in steps",
    },
    status: { stepCount: 10 },
    sourceEntryCount: 13,
    nowMs: Date.parse("2026-04-12T10:20:00Z"),
  });

  assert.equal(decision.refresh, true);
  assert.equal(decision.reason, "step_interval");
});
