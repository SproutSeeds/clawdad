function pickString(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function timestampMs(value) {
  const parsed = Date.parse(pickString(value?.answeredAt, value?.sentAt, value?.createdAt, value?.at));
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractLastJsonCodeBlock(text) {
  const matches = [...String(text || "").matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const block = pickString(matches[index][1]);
    if (!block) {
      continue;
    }
    try {
      return JSON.parse(block);
    } catch (_error) {
      continue;
    }
  }
  return null;
}

function actionFromEntry(entry) {
  const parsed = extractLastJsonCodeBlock(entry?.response || entry?.text || "");
  return pickString(
    entry?.nextAction,
    entry?.next_action,
    parsed?.next_action,
    parsed?.nextAction,
  );
}

function normalizeActionPattern(action) {
  return pickString(action)
    .toLowerCase()
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu, "<id>")
    .replace(/\bq\s*[=:#-]?\s*\d+\b/giu, "q#")
    .replace(/\b\d+\b/gu, "#")
    .replace(/\s+/gu, " ")
    .trim();
}

function isCodexSession(session) {
  return String(session?.provider || "").trim().toLowerCase() === "codex";
}

export function chooseDelegateSession({
  sessions = [],
  config = {},
  activeSessionId = "",
  defaultSlug = "Delegate",
} = {}) {
  const codexSessions = Array.isArray(sessions) ? sessions.filter(isCodexSession) : [];
  const activeId = pickString(activeSessionId);
  const configuredId = pickString(config?.delegateSessionId);
  const configuredSlug = pickString(config?.delegateSessionSlug, defaultSlug);

  const configuredSessionById = configuredId
    ? codexSessions.find((session) => pickString(session?.sessionId) === configuredId) || null
    : null;
  if (configuredSessionById) {
    return {
      session: configuredSessionById,
      resetToDefault: false,
      collidesWithActive: Boolean(activeId && configuredSessionById.sessionId === activeId),
    };
  }

  const configuredSession =
    codexSessions.find((session) => pickString(session?.slug) === configuredSlug) || null;
  const configuredCollidesWithActive =
    Boolean(configuredSession?.sessionId) && Boolean(activeId) && configuredSession.sessionId === activeId;

  if (configuredSession && !configuredCollidesWithActive) {
    return {
      session: configuredSession,
      resetToDefault: false,
      collidesWithActive: false,
    };
  }

  const fallbackSession =
    codexSessions.find(
      (session) =>
        pickString(session?.slug) === defaultSlug &&
        (!activeId || pickString(session?.sessionId) !== activeId),
    ) || null;

  return {
    session: fallbackSession,
    resetToDefault: configuredCollidesWithActive,
    collidesWithActive: configuredCollidesWithActive,
  };
}

export function shouldClearPendingDelegatePause({
  runningJob = null,
  currentStatus = null,
  currentConfig = null,
} = {}) {
  if (!runningJob) {
    return false;
  }
  return Boolean(
    runningJob.pauseRequested ||
      currentStatus?.pauseRequested ||
      currentConfig?.enabled === false,
  );
}

export function delegatePauseDecision({
  status = {},
  hasActiveRunJob = false,
  hasActivePlanJob = false,
  supervisorLive = false,
} = {}) {
  const state = pickString(status?.state).toLowerCase();
  const runningCanPauseAfterStep = state === "running" && (hasActiveRunJob || supervisorLive);
  const planningCanPauseAfterStep = state === "planning" && hasActivePlanJob;
  if (runningCanPauseAfterStep || planningCanPauseAfterStep) {
    return {
      state,
      pauseRequested: true,
      waitForSafePoint: true,
    };
  }

  return {
    state: "paused",
    pauseRequested: false,
    waitForSafePoint: false,
  };
}

function collectJsonishStrings(value, output = []) {
  if (value == null) {
    return output;
  }
  if (typeof value === "string") {
    output.push(value);
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        collectJsonishStrings(JSON.parse(trimmed), output);
      } catch (_error) {
        // Plain text that only looks JSON-ish should still be checked as text.
      }
    }
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectJsonishStrings(item, output);
    }
    return output;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) {
      collectJsonishStrings(item, output);
    }
  }
  return output;
}

export function recoverableCodexStreamDisconnect({
  error = "",
  responseText = "",
  mailboxStatus = null,
} = {}) {
  const parts = collectJsonishStrings({
    error,
    responseText,
    mailboxError: mailboxStatus?.error,
    mailboxMessage: mailboxStatus?.message,
  });
  const haystack = parts.join("\n").toLowerCase();
  if (!haystack) {
    return false;
  }
  const hasDisconnect =
    haystack.includes("responsestreamdisconnected") ||
    haystack.includes("websocket closed by server before response.completed") ||
    haystack.includes("tls handshake eof");
  if (!hasDisconnect) {
    return false;
  }
  return /"willretry"\s*:\s*true/u.test(haystack) || haystack.includes("reconnecting");
}

export function delegateRunListState({
  existingState = "",
  eventState = "",
  statusMatchesRun = false,
} = {}) {
  const existing = pickString(existingState);
  const event = pickString(eventState);
  if (statusMatchesRun && existing) {
    return existing;
  }
  return event || existing;
}

export function analyzeDelegatePhaseHandoff({
  sourceEntries = [],
  status = {},
  minRepeatCount = 3,
  historyLimit = 8,
} = {}) {
  const records = (Array.isArray(sourceEntries) ? sourceEntries : [])
    .map((entry) => ({
      action: actionFromEntry(entry),
      at: timestampMs(entry),
    }))
    .filter((entry) => entry.action)
    .sort((left, right) => left.at - right.at)
    .slice(-Math.max(1, historyLimit));

  const currentAction = pickString(status?.nextAction, status?.next_action);
  if (currentAction) {
    records.push({
      action: currentAction,
      at: Number.MAX_SAFE_INTEGER,
      current: true,
    });
  }

  if (records.length < minRepeatCount) {
    return {
      triggered: false,
      repeatCount: 0,
      pattern: "",
      currentAction,
      recentActions: records.map((record) => record.action),
    };
  }

  const latestPattern = normalizeActionPattern(records[records.length - 1]?.action);
  if (!latestPattern) {
    return {
      triggered: false,
      repeatCount: 0,
      pattern: "",
      currentAction,
      recentActions: records.map((record) => record.action),
    };
  }

  let repeatCount = 0;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (normalizeActionPattern(records[index].action) !== latestPattern) {
      break;
    }
    repeatCount += 1;
  }

  const recentActions = records
    .slice(Math.max(0, records.length - Math.max(repeatCount, 3)))
    .map((record) => record.action);

  return {
    triggered: repeatCount >= minRepeatCount,
    repeatCount,
    pattern: latestPattern,
    currentAction,
    recentActions,
  };
}

export function delegateStrategyBreakoutDecision({
  phaseHandoffAnalysis = null,
  status = {},
  lastBreakoutPattern = "",
} = {}) {
  const state = pickString(status?.state).toLowerCase();
  const pattern = pickString(phaseHandoffAnalysis?.pattern);
  if (state && state !== "running") {
    return {
      breakout: false,
      reason: "not_running",
      pattern,
    };
  }

  if (!phaseHandoffAnalysis?.triggered || !pattern) {
    return {
      breakout: false,
      reason: "fresh",
      pattern,
    };
  }

  if (pattern === pickString(lastBreakoutPattern)) {
    return {
      breakout: false,
      reason: "already_reviewed",
      pattern,
      repeatCount: phaseHandoffAnalysis.repeatCount || 0,
      recentActions: Array.isArray(phaseHandoffAnalysis.recentActions)
        ? phaseHandoffAnalysis.recentActions
        : [],
    };
  }

  return {
    breakout: true,
    reason: "phase_handoff",
    pattern,
    repeatCount: phaseHandoffAnalysis.repeatCount || 0,
    recentActions: Array.isArray(phaseHandoffAnalysis.recentActions)
      ? phaseHandoffAnalysis.recentActions
      : [],
  };
}

function parseNonNegativeInteger(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function delegateStatusStepText(status = {}) {
  const state = pickString(status?.state).toLowerCase();
  const stepCount = parseNonNegativeInteger(status?.stepCount) ?? 0;
  const activeStep = parseNonNegativeInteger(status?.activeStep ?? status?.active_step);
  const activeRequestId = pickString(status?.activeRequestId, status?.active_request_id);

  if (activeRequestId) {
    const step = activeStep ?? (state === "running" ? stepCount + 1 : stepCount);
    return step > 0 ? `active step ${step}` : "active step";
  }

  return `step ${stepCount}`;
}

function parseTimestampMs(value) {
  const parsed = Date.parse(pickString(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function delegatePlanRefreshDecision({
  latestPlan = null,
  status = {},
  sourceEntryCount = 0,
  phaseHandoffAnalysis = null,
  nowMs = Date.now(),
  maxAgeMs = 4 * 60 * 60 * 1000,
  legacyMaxAgeMs = 90 * 60 * 1000,
  stepInterval = 8,
  phaseStepInterval = 3,
  sourceEntryInterval = 6,
} = {}) {
  const hasPlan = Boolean(pickString(latestPlan?.plan));
  if (!hasPlan) {
    return {
      refresh: true,
      reason: "missing_plan",
      stepsSincePlan: null,
      sourceEntriesSincePlan: null,
      ageMs: null,
    };
  }

  const statusStep = parseNonNegativeInteger(status?.stepCount) ?? 0;
  const planStep = parseNonNegativeInteger(latestPlan?.stepCount);
  const stepsSincePlan = planStep == null ? null : Math.max(0, statusStep - planStep);
  const sourceCount = parseNonNegativeInteger(sourceEntryCount) ?? 0;
  const planSourceCount = parseNonNegativeInteger(latestPlan?.sourceEntryCount) ?? 0;
  const sourceEntriesSincePlan = Math.max(0, sourceCount - planSourceCount);
  const planCreatedMs = parseTimestampMs(latestPlan?.createdAt);
  const ageMs =
    planCreatedMs == null || !Number.isFinite(nowMs)
      ? null
      : Math.max(0, nowMs - planCreatedMs);
  const phaseTriggered = Boolean(phaseHandoffAnalysis?.triggered);

  if (
    phaseTriggered &&
    (
      planStep == null ||
      stepsSincePlan >= phaseStepInterval ||
      (ageMs != null && ageMs >= maxAgeMs)
    )
  ) {
    return {
      refresh: true,
      reason: "phase_handoff",
      stepsSincePlan,
      sourceEntriesSincePlan,
      ageMs,
    };
  }

  if (planStep != null && stepsSincePlan >= stepInterval) {
    return {
      refresh: true,
      reason: "step_interval",
      stepsSincePlan,
      sourceEntriesSincePlan,
      ageMs,
    };
  }

  if (sourceEntriesSincePlan >= sourceEntryInterval) {
    return {
      refresh: true,
      reason: "new_history",
      stepsSincePlan,
      sourceEntriesSincePlan,
      ageMs,
    };
  }

  if (
    ageMs != null &&
    ageMs >= (planStep == null ? legacyMaxAgeMs : maxAgeMs) &&
    (stepsSincePlan == null || stepsSincePlan >= 1 || sourceEntriesSincePlan >= 1)
  ) {
    return {
      refresh: true,
      reason: "stale_age",
      stepsSincePlan,
      sourceEntriesSincePlan,
      ageMs,
    };
  }

  return {
    refresh: false,
    reason: "fresh",
    stepsSincePlan,
    sourceEntriesSincePlan,
    ageMs,
  };
}

function isUsefulDelegateLearning(value) {
  const normalized = pickString(value).toLowerCase();
  return Boolean(normalized && !["none", "n/a", "na", "nothing", "unknown"].includes(normalized));
}

export function delegatePostStepPlanRefreshDecision({
  latestPlan = null,
  statusBefore = {},
  statusAfter = {},
  decision = {},
} = {}) {
  const hasPlan = Boolean(pickString(latestPlan?.plan));
  const completedStep = parseNonNegativeInteger(statusAfter?.stepCount) ?? 0;
  const planStep = parseNonNegativeInteger(latestPlan?.stepCount);
  const checkpoint = decision?.checkpoint && typeof decision.checkpoint === "object"
    ? decision.checkpoint
    : {};

  const base = {
    stepsSincePlan: planStep == null ? null : Math.max(0, completedStep - planStep),
  };

  if (!hasPlan) {
    return {
      refresh: true,
      reason: "missing_plan",
      ...base,
    };
  }

  if (planStep != null && completedStep <= planStep) {
    return {
      refresh: false,
      reason: "fresh",
      ...base,
    };
  }

  const state = pickString(decision?.state).toLowerCase();
  const stopReason = pickString(decision?.stopReason, decision?.stop_reason).toLowerCase();
  if (state === "blocked" && stopReason === "compute_limit") {
    return {
      refresh: false,
      reason: "compute_limit",
      ...base,
    };
  }
  if (state === "blocked") {
    return {
      refresh: true,
      reason: "run_blocked",
      ...base,
    };
  }
  if (state === "completed") {
    return {
      refresh: true,
      reason: "run_completed",
      ...base,
    };
  }

  const blockers = isUsefulDelegateLearning(checkpoint.blockers || checkpoint.blocker);
  if (blockers) {
    return {
      refresh: true,
      reason: "new_blocker",
      ...base,
    };
  }

  const progressSignal = pickString(checkpoint.progressSignal, checkpoint.progress_signal).toLowerCase();
  const breakthroughs = isUsefulDelegateLearning(checkpoint.breakthroughs || checkpoint.breakthrough);
  if (breakthroughs && ["high", "medium"].includes(progressSignal)) {
    return {
      refresh: true,
      reason: "material_learning",
      ...base,
    };
  }

  const previousPattern = normalizeActionPattern(statusBefore?.nextAction || statusBefore?.next_action);
  const nextPattern = normalizeActionPattern(decision?.nextAction || decision?.next_action);
  const nextProbe = isUsefulDelegateLearning(checkpoint.nextProbe || checkpoint.next_probe);
  const directionChanged = Boolean(previousPattern && nextPattern && previousPattern !== nextPattern);
  if (directionChanged && (["high", "medium"].includes(progressSignal) || nextProbe)) {
    return {
      refresh: true,
      reason: "direction_changed",
      ...base,
    };
  }

  return {
    refresh: false,
    reason: "fresh",
    ...base,
  };
}
