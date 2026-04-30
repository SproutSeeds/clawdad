function pickString(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

export const defaultDelegateLaneId = "default";

export function normalizeDelegateLaneId(value = "") {
  const raw = pickString(value, defaultDelegateLaneId).toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-{2,}/gu, "-");
  return slug || defaultDelegateLaneId;
}

export function delegateLaneIsDefault(laneId = "") {
  return normalizeDelegateLaneId(laneId) === defaultDelegateLaneId;
}

function globPrefix(glob = "") {
  const value = pickString(glob).replace(/^\.?\//u, "");
  if (!value) {
    return "";
  }
  const wildcardIndex = value.search(/[*?[{]/u);
  const prefix = wildcardIndex >= 0 ? value.slice(0, wildcardIndex) : value;
  return prefix.replace(/\/+$/u, "");
}

function pathMatchesScope(filePath = "", scopeGlob = "") {
  const relativePath = pickString(filePath).replace(/^\.?\//u, "");
  const prefix = globPrefix(scopeGlob);
  if (!relativePath || !prefix) {
    return false;
  }
  return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
}

function scopesOverlap(leftScope = "", rightScope = "") {
  const left = globPrefix(leftScope);
  const right = globPrefix(rightScope);
  if (!left || !right) {
    return false;
  }
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function sharedRoutingPath(filePath = "") {
  const value = pickString(filePath).replace(/^\.?\//u, "");
  return (
    value === "README.md" ||
    value === "package.json" ||
    value === "package-lock.json" ||
    value.startsWith("docs/") ||
    value.startsWith(".clawdad/") ||
    value.startsWith("_coordination/")
  );
}

export function classifyDelegateLaneOverlap({
  lane = {},
  activeLanes = [],
  changedFiles = [],
} = {}) {
  const laneId = normalizeDelegateLaneId(lane.laneId);
  const scopeGlobs = Array.isArray(lane.scopeGlobs) ? lane.scopeGlobs.filter(Boolean) : [];
  const files = (Array.isArray(changedFiles) ? changedFiles : []).map((file) => pickString(file)).filter(Boolean);
  const unscopedActiveLanes = (Array.isArray(activeLanes) ? activeLanes : [])
    .filter((activeLane) => normalizeDelegateLaneId(activeLane?.laneId) !== laneId)
    .filter((activeLane) => !Array.isArray(activeLane?.scopeGlobs) || activeLane.scopeGlobs.filter(Boolean).length === 0)
    .map((activeLane) => normalizeDelegateLaneId(activeLane?.laneId));

  const outOfScopeFiles = files.filter((file) =>
    scopeGlobs.length > 0 && !scopeGlobs.some((scope) => pathMatchesScope(file, scope)),
  );
  const sharedFiles = files.filter(sharedRoutingPath);
  const overlappingLanes = (Array.isArray(activeLanes) ? activeLanes : [])
    .filter((activeLane) => normalizeDelegateLaneId(activeLane?.laneId) !== laneId)
    .filter((activeLane) => {
      const activeScopes = Array.isArray(activeLane?.scopeGlobs) ? activeLane.scopeGlobs : [];
      return scopeGlobs.some((scope) => activeScopes.some((activeScope) => scopesOverlap(scope, activeScope)));
    })
    .map((activeLane) => normalizeDelegateLaneId(activeLane.laneId));

  if (overlappingLanes.length > 0) {
    return {
      level: "unsafe",
      safe: false,
      reason: "scope_overlap",
      overlappingLanes,
      outOfScopeFiles,
      sharedFiles,
    };
  }

  if (scopeGlobs.length === 0 || unscopedActiveLanes.length > 0) {
    return {
      level: "caution",
      safe: true,
      reason: scopeGlobs.length === 0 ? "unscoped_lane" : "unscoped_active_lane",
      overlappingLanes: [],
      outOfScopeFiles,
      sharedFiles,
      unscopedActiveLanes,
    };
  }

  if (outOfScopeFiles.length > 0 || sharedFiles.length > 0) {
    return {
      level: "caution",
      safe: true,
      reason: sharedFiles.length > 0 ? "shared_surface" : "out_of_scope_files",
      overlappingLanes: [],
      outOfScopeFiles,
      sharedFiles,
      unscopedActiveLanes,
    };
  }

  return {
    level: "safe",
    safe: true,
    reason: "scope_classified",
    overlappingLanes: [],
    outOfScopeFiles: [],
    sharedFiles: [],
    unscopedActiveLanes,
  };
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

function boolish(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function eventTimestampMs(event = {}) {
  const parsed = Date.parse(pickString(event?.at, event?.createdAt, event?.timestamp));
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusTimestampMs(status = {}, ...keys) {
  for (const key of keys) {
    const parsed = Date.parse(pickString(status?.[key]));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

const delegateDispatchProgressEventTypes = new Set([
  "step_started",
  "strategy_breakout_started",
  "dispatch_process_started",
  "supervisor_rejoined_dispatch",
  "dispatch_started",
  "agent_live",
  "agent_response",
  "agent_response_recovered",
]);

export function delegateDispatchStallDecision({
  mailboxStatus = {},
  delegateStatus = {},
  events = [],
  nowMs = Date.now(),
  staleTimeoutMs = 45 * 60 * 1000,
  pauseStaleTimeoutMs = 5 * 60 * 1000,
} = {}) {
  const mailboxState = pickString(mailboxStatus?.state).toLowerCase();
  if (mailboxState !== "running" && mailboxState !== "dispatched") {
    return {
      stalled: false,
      reason: "mailbox_not_running",
    };
  }

  const requestId = pickString(mailboxStatus?.request_id, mailboxStatus?.requestId);
  const activeRequestId = pickString(delegateStatus?.activeRequestId, delegateStatus?.active_request_id);
  if (requestId && activeRequestId && requestId !== activeRequestId) {
    return {
      stalled: false,
      reason: "different_request",
      requestId,
      activeRequestId,
    };
  }

  const activeStep = Number.parseInt(String(delegateStatus?.activeStep ?? delegateStatus?.active_step ?? ""), 10);
  const step = Number.isFinite(activeStep) && activeStep > 0 ? activeStep : null;
  let latestProgressMs = 0;
  let latestProgressType = "";

  for (const event of Array.isArray(events) ? events : []) {
    const type = pickString(event?.type).toLowerCase();
    if (!delegateDispatchProgressEventTypes.has(type)) {
      continue;
    }

    const eventRequestId = pickString(event?.requestId, event?.request_id);
    if (requestId && eventRequestId && eventRequestId !== requestId) {
      continue;
    }

    const eventStepValue = Number.parseInt(String(event?.step ?? event?.stepCount ?? ""), 10);
    if (step && Number.isFinite(eventStepValue) && eventStepValue > 0 && eventStepValue !== step) {
      continue;
    }

    const timestamp = eventTimestampMs(event);
    if (timestamp > latestProgressMs) {
      latestProgressMs = timestamp;
      latestProgressType = type;
    }
  }

  let progressSource = latestProgressType ? "run_event" : "dispatch_start";
  if (!latestProgressMs) {
    latestProgressMs = statusTimestampMs(mailboxStatus, "dispatched_at", "dispatchedAt", "started_at", "startedAt");
  }
  if (!latestProgressMs) {
    return {
      stalled: false,
      reason: "no_progress_reference",
      requestId,
    };
  }

  const pauseRequested = boolish(delegateStatus?.pauseRequested ?? delegateStatus?.pause_requested, false);
  const timeoutMs = pauseRequested ? pauseStaleTimeoutMs : staleTimeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return {
      stalled: false,
      reason: "disabled",
      requestId,
      progressAt: new Date(latestProgressMs).toISOString(),
      progressSource,
      progressType: latestProgressType || null,
    };
  }

  const ageMs = Math.max(0, nowMs - latestProgressMs);
  if (ageMs < timeoutMs) {
    return {
      stalled: false,
      reason: "within_limit",
      requestId,
      ageMs,
      timeoutMs,
      progressAt: new Date(latestProgressMs).toISOString(),
      progressSource,
      progressType: latestProgressType || null,
      pauseRequested,
    };
  }

  return {
    stalled: true,
    reason: pauseRequested ? "pause_requested_stalled" : "no_live_progress",
    requestId,
    ageMs,
    timeoutMs,
    progressAt: new Date(latestProgressMs).toISOString(),
    progressSource,
    progressType: latestProgressType || null,
    pauseRequested,
  };
}

const watchtowerCredentialTriggers = new Set([
  "credential_boundary",
  "broker_payment_live_order_boundary",
  "paid_data_or_api",
]);

const watchtowerSafetyHardStopTriggers = new Set([
  "human_gate",
  "legal_regulatory_boundary",
  "medical_advice_boundary",
  "outreach_boundary",
  "patient_data_boundary",
]);

const watchtowerSensitiveTriggers = new Set([
  "sensitive_files",
  "secrets",
  "secret_files",
]);

const watchtowerValidationTriggers = new Set([
  "tests_failed",
  "validation_failed",
  "gate_failed",
]);

const watchtowerHygieneRepairTriggers = new Set([
  "hygiene_dirty_unclassified",
  "worktree_hygiene_unclassified",
  "worktree_hygiene_suspicious",
]);

const watchtowerHygieneHardStopTriggers = new Set([
  "orp_hygiene_failed",
  "worktree_hygiene_failed",
  "hygiene_failed",
]);

function normalizeWatchtowerSignal(signal = {}) {
  return {
    signal,
    trigger: pickString(signal?.trigger, signal?.riskFlag, signal?.reason).toLowerCase(),
    reviewStatus: pickString(signal?.reviewStatus, signal?.review_status, signal?.status).toLowerCase(),
  };
}

function reviewSignalSummary(signal = {}, fallback = "Watchtower review signal.") {
  const title = pickString(signal?.title, signal?.trigger);
  const summary = pickString(signal?.summary, signal?.text, signal?.reason);
  if (title && summary) {
    return `${title}: ${summary}`;
  }
  return title || summary || fallback;
}

function delegateStepAcceptedForCheckpoint(decision = {}) {
  const state = pickString(decision?.state).toLowerCase();
  const stopReason = pickString(decision?.stopReason, decision?.stop_reason).toLowerCase();
  if (state !== "continue") {
    return false;
  }
  if (stopReason && stopReason !== "none") {
    return false;
  }
  const checkpoint = decision?.checkpoint && typeof decision.checkpoint === "object"
    ? decision.checkpoint
    : {};
  const blockers = pickString(checkpoint.blockers, checkpoint.blocker).toLowerCase();
  return !blockers || blockers === "none";
}

export function delegateWatchtowerReviewDecision({
  signals = [],
  delegateDecision = {},
} = {}) {
  const normalized = (Array.isArray(signals) ? signals : [])
    .map(normalizeWatchtowerSignal)
    .filter((entry) => entry.trigger || entry.reviewStatus);

  const hardStop = normalized.find(
    (entry) =>
      entry.reviewStatus === "hard_stop" ||
      watchtowerCredentialTriggers.has(entry.trigger) ||
      watchtowerSafetyHardStopTriggers.has(entry.trigger) ||
      watchtowerHygieneHardStopTriggers.has(entry.trigger),
  );
  if (hardStop) {
    return {
      hardStop: true,
      pauseRecommended: false,
      repairRecommended: false,
      correctiveRecommended: false,
      checkpointRecommended: false,
      reason: hardStop.trigger || "hard_stop",
      card: hardStop.signal,
      summary: reviewSignalSummary(hardStop.signal, "Watchtower hard stop."),
      nextAction: "review Watchtower hard-stop card before continuing delegation",
    };
  }

  const sensitive = normalized.find((entry) => watchtowerSensitiveTriggers.has(entry.trigger));
  if (sensitive) {
    return {
      hardStop: true,
      pauseRecommended: false,
      repairRecommended: false,
      correctiveRecommended: false,
      checkpointRecommended: false,
      reason: sensitive.trigger,
      card: sensitive.signal,
      summary: reviewSignalSummary(sensitive.signal, "Sensitive files changed."),
      nextAction: "review and remove or explicitly approve sensitive file changes before continuing delegation",
    };
  }

  const validationFailure = normalized.find((entry) => watchtowerValidationTriggers.has(entry.trigger));
  if (validationFailure) {
    return {
      hardStop: false,
      pauseRecommended: false,
      repairRecommended: false,
      correctiveRecommended: true,
      checkpointRecommended: false,
      reason: validationFailure.trigger,
      card: validationFailure.signal,
      summary: reviewSignalSummary(validationFailure.signal, "Validation failed."),
      nextAction: "repair failing validation before continuing delegation",
    };
  }

  const hygieneRepair = normalized.find((entry) => watchtowerHygieneRepairTriggers.has(entry.trigger));
  if (hygieneRepair) {
    return {
      hardStop: false,
      pauseRecommended: false,
      repairRecommended: true,
      correctiveRecommended: true,
      checkpointRecommended: false,
      reason: hygieneRepair.trigger,
      card: hygieneRepair.signal,
      summary: reviewSignalSummary(hygieneRepair.signal, "Hygiene needs repair."),
      nextAction:
        pickString(hygieneRepair.signal?.requiredAction, hygieneRepair.signal?.nextAction) ||
        "run a hygiene repair/checkpoint step before broadening delegate work",
    };
  }

  const unknownPause = normalized.find(
    (entry) => entry.reviewStatus === "pause_recommended" && entry.trigger !== "large_diff",
  );
  if (unknownPause) {
    return {
      hardStop: false,
      pauseRecommended: false,
      repairRecommended: false,
      correctiveRecommended: true,
      checkpointRecommended: false,
      reason: unknownPause.trigger || "review_recommended",
      card: unknownPause.signal,
      summary: reviewSignalSummary(unknownPause.signal, "Watchtower review recommended."),
      nextAction: "review/checkpoint the current diff before continuing delegation",
    };
  }

  const largeDiff = normalized.find((entry) => entry.trigger === "large_diff");
  if (largeDiff) {
    if (!delegateStepAcceptedForCheckpoint(delegateDecision)) {
      return {
        hardStop: false,
        pauseRecommended: false,
        repairRecommended: false,
        correctiveRecommended: true,
        checkpointRecommended: false,
        reason: "large_diff_unvalidated",
        card: largeDiff.signal,
        summary: reviewSignalSummary(largeDiff.signal, "Large diff needs validation before continuing."),
        nextAction: "validate and checkpoint the large diff before continuing delegation",
      };
    }
    return {
      hardStop: false,
      pauseRecommended: false,
      repairRecommended: false,
      correctiveRecommended: false,
      checkpointRecommended: true,
      reason: "large_diff_checkpoint",
      card: largeDiff.signal,
      summary: reviewSignalSummary(largeDiff.signal, "Large diff recorded as a checkpoint."),
      nextAction: "",
    };
  }

  return {
    hardStop: false,
    pauseRecommended: false,
    repairRecommended: false,
    correctiveRecommended: false,
    checkpointRecommended: false,
    reason: "clear",
    card: null,
    summary: "No Watchtower pause/hard-stop review card.",
    nextAction: "",
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
