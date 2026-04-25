import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeDelegatePhaseHandoff,
  chooseDelegateSession,
  delegatePauseDecision,
  delegatePlanRefreshDecision,
  delegatePostStepPlanRefreshDecision,
  delegateRunListState,
  delegateStrategyBreakoutDecision,
  delegateStatusStepText,
  delegateWatchtowerReviewDecision,
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

test("delegateWatchtowerReviewDecision treats clean large diffs as checkpoint-only", () => {
  const decision = delegateWatchtowerReviewDecision({
    signals: [
      {
        reviewStatus: "pause_recommended",
        trigger: "large_diff",
        title: "Large diff checkpoint",
        summary: "32 files changed, 1200 insertions.",
      },
    ],
    delegateDecision: {
      state: "continue",
      stopReason: "none",
      checkpoint: {
        blockers: "none",
      },
    },
  });

  assert.equal(decision.hardStop, false);
  assert.equal(decision.pauseRecommended, false);
  assert.equal(decision.repairRecommended, false);
  assert.equal(decision.checkpointRecommended, true);
  assert.equal(decision.reason, "large_diff_checkpoint");
});

test("delegateWatchtowerReviewDecision routes unclassified hygiene to repair instead of human pause", () => {
  const decision = delegateWatchtowerReviewDecision({
    signals: [
      {
        reviewStatus: "pause_recommended",
        trigger: "worktree_hygiene_unclassified",
        title: "Worktree has unclassified dirty state",
        summary: "Generic worktree hygiene reports 2 unclassified path(s).",
      },
    ],
    delegateDecision: {
      state: "continue",
      stopReason: "none",
    },
  });

  assert.equal(decision.hardStop, false);
  assert.equal(decision.pauseRecommended, false);
  assert.equal(decision.repairRecommended, true);
  assert.equal(decision.checkpointRecommended, false);
  assert.equal(decision.reason, "worktree_hygiene_unclassified");
  assert.match(decision.nextAction, /hygiene repair\/checkpoint/u);
});

test("delegateWatchtowerReviewDecision blocks on sensitive file changes", () => {
  const decision = delegateWatchtowerReviewDecision({
    signals: [
      {
        reviewStatus: "pause_recommended",
        trigger: "sensitive_files",
        title: "Sensitive files changed",
        summary: ".env",
      },
      {
        reviewStatus: "needs_review",
        trigger: "large_diff",
      },
    ],
    delegateDecision: {
      state: "continue",
      stopReason: "none",
    },
  });

  assert.equal(decision.hardStop, true);
  assert.equal(decision.pauseRecommended, false);
  assert.equal(decision.reason, "sensitive_files");
  assert.match(decision.nextAction, /sensitive file/u);
});

test("delegateWatchtowerReviewDecision pauses on validation failure even with a large diff", () => {
  const decision = delegateWatchtowerReviewDecision({
    signals: [
      {
        reviewStatus: "needs_review",
        trigger: "large_diff",
      },
      {
        reviewStatus: "pause_recommended",
        trigger: "tests_failed",
        title: "Tests failed",
      },
    ],
    delegateDecision: {
      state: "continue",
      stopReason: "none",
    },
  });

  assert.equal(decision.hardStop, false);
  assert.equal(decision.pauseRecommended, true);
  assert.equal(decision.checkpointRecommended, false);
  assert.equal(decision.reason, "tests_failed");
  assert.match(decision.nextAction, /validation/u);
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

test("delegateStatusStepText labels active in-flight step instead of completed count", () => {
  assert.equal(
    delegateStatusStepText({
      state: "running",
      stepCount: 9,
      activeStep: 10,
      activeRequestId: "request-10",
    }),
    "active step 10",
  );
});

test("delegateStatusStepText falls back to next step for legacy active status", () => {
  assert.equal(
    delegateStatusStepText({
      state: "running",
      stepCount: 9,
      activeRequestId: "request-10",
    }),
    "active step 10",
  );
});

test("delegateStatusStepText keeps completed step count when idle between requests", () => {
  assert.equal(
    delegateStatusStepText({
      state: "running",
      stepCount: 9,
      activeRequestId: "",
    }),
    "step 9",
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

test("delegateStrategyBreakoutDecision triggers once for a repeated pattern", () => {
  const first = delegateStrategyBreakoutDecision({
    status: { state: "running" },
    phaseHandoffAnalysis: {
      triggered: true,
      pattern: "certify q#",
      repeatCount: 4,
      recentActions: ["Certify q541", "Certify q547", "Certify q557", "Certify q563"],
    },
  });

  assert.equal(first.breakout, true);
  assert.equal(first.reason, "phase_handoff");
  assert.equal(first.pattern, "certify q#");

  const second = delegateStrategyBreakoutDecision({
    status: { state: "running" },
    lastBreakoutPattern: "certify q#",
    phaseHandoffAnalysis: {
      triggered: true,
      pattern: "certify q#",
      repeatCount: 5,
      recentActions: ["Certify q547", "Certify q557", "Certify q563", "Certify q569"],
    },
  });

  assert.equal(second.breakout, false);
  assert.equal(second.reason, "already_reviewed");
});

test("delegateStrategyBreakoutDecision ignores fresh or non-running states", () => {
  assert.equal(
    delegateStrategyBreakoutDecision({
      status: { state: "running" },
      phaseHandoffAnalysis: { triggered: false, pattern: "" },
    }).breakout,
    false,
  );
  assert.equal(
    delegateStrategyBreakoutDecision({
      status: { state: "paused" },
      phaseHandoffAnalysis: { triggered: true, pattern: "repeat", repeatCount: 3 },
    }).reason,
    "not_running",
  );
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

test("delegatePostStepPlanRefreshDecision refreshes when a run blocks", () => {
  const decision = delegatePostStepPlanRefreshDecision({
    latestPlan: {
      createdAt: "2026-04-12T10:00:00Z",
      stepCount: 4,
      plan: "old plan",
    },
    statusBefore: { stepCount: 4, nextAction: "Continue local proof search." },
    statusAfter: { stepCount: 5, nextAction: "Ask for source audit release." },
    decision: {
      state: "blocked",
      stopReason: "paid",
      nextAction: "Ask for source audit release.",
      checkpoint: {
        progressSignal: "medium",
        blockers: "source audit needs explicit release",
      },
    },
  });

  assert.equal(decision.refresh, true);
  assert.equal(decision.reason, "run_blocked");
});

test("delegatePostStepPlanRefreshDecision refreshes material learning immediately", () => {
  const decision = delegatePostStepPlanRefreshDecision({
    latestPlan: {
      createdAt: "2026-04-12T10:00:00Z",
      stepCount: 8,
      plan: "old plan",
    },
    statusBefore: { stepCount: 8, nextAction: "Audit source registry." },
    statusAfter: { stepCount: 9, nextAction: "Write source-import blocker." },
    decision: {
      state: "continue",
      nextAction: "Write source-import blocker.",
      checkpoint: {
        progressSignal: "high",
        breakthroughs: "found the missing source theorem boundary",
        nextProbe: "write source-import blocker",
      },
    },
  });

  assert.equal(decision.refresh, true);
  assert.equal(decision.reason, "material_learning");
});

test("delegatePostStepPlanRefreshDecision ignores low-signal adjacent steps", () => {
  const decision = delegatePostStepPlanRefreshDecision({
    latestPlan: {
      createdAt: "2026-04-12T10:00:00Z",
      stepCount: 8,
      plan: "current enough plan",
    },
    statusBefore: { stepCount: 8, nextAction: "Run smoke tests." },
    statusAfter: { stepCount: 9, nextAction: "Run smoke tests." },
    decision: {
      state: "continue",
      nextAction: "Run smoke tests.",
      checkpoint: {
        progressSignal: "low",
        breakthroughs: "none",
        blockers: "none",
      },
    },
  });

  assert.equal(decision.refresh, false);
  assert.equal(decision.reason, "fresh");
});

test("delegatePostStepPlanRefreshDecision does not spend compute after compute limit", () => {
  const decision = delegatePostStepPlanRefreshDecision({
    latestPlan: {
      createdAt: "2026-04-12T10:00:00Z",
      stepCount: 8,
      plan: "current enough plan",
    },
    statusBefore: { stepCount: 8, nextAction: "Continue." },
    statusAfter: { stepCount: 9, nextAction: "Wait for compute." },
    decision: {
      state: "blocked",
      stopReason: "compute_limit",
      nextAction: "Wait for compute.",
      checkpoint: {
        progressSignal: "none",
        blockers: "compute limit",
      },
    },
  });

  assert.equal(decision.refresh, false);
  assert.equal(decision.reason, "compute_limit");
});
