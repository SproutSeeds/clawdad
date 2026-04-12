function pickString(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) {
      return text;
    }
  }
  return "";
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
  const configuredSession =
    codexSessions.find((session) => pickString(session?.sessionId) === configuredId) ||
    codexSessions.find((session) => pickString(session?.slug) === configuredSlug) ||
    null;
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
