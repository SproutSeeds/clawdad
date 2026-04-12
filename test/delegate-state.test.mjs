import assert from "node:assert/strict";
import test from "node:test";

import { chooseDelegateSession, shouldClearPendingDelegatePause } from "../lib/delegate-state.mjs";

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

test("chooseDelegateSession falls back to Delegate when the configured session is active", () => {
  const choice = chooseDelegateSession({
    sessions,
    activeSessionId: "main",
    config: { delegateSessionId: "main", delegateSessionSlug: "Main-erdos" },
  });

  assert.equal(choice.session.sessionId, "delegate");
  assert.equal(choice.resetToDefault, true);
  assert.equal(choice.collidesWithActive, true);
});

test("chooseDelegateSession asks caller to create Delegate when only the active lane matches", () => {
  const choice = chooseDelegateSession({
    sessions: [{ provider: "codex", slug: "Main-erdos", sessionId: "main" }],
    activeSessionId: "main",
    config: { delegateSessionId: "main", delegateSessionSlug: "Main-erdos" },
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
