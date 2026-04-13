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

function parseNonNegativeInteger(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
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
