function pickString(...values) {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function sessionAliases(project = {}) {
  const aliases = project?.sessionAliases || project?.session_aliases;
  return aliases && typeof aliases === "object" && !Array.isArray(aliases) ? aliases : {};
}

function resolveSessionAlias(project = {}, selector = "") {
  let current = pickString(selector);
  const aliases = sessionAliases(project);
  const visited = new Set();
  for (let depth = 0; current && depth < 16; depth += 1) {
    if (visited.has(current)) {
      break;
    }
    visited.add(current);
    const next = pickString(aliases[current]);
    if (!next || next === current) {
      break;
    }
    current = next;
  }
  return current;
}

function activityTime(thread = {}) {
  const candidates = [
    thread.lastActivityAt,
    thread.providerLastActivity,
    thread.lastResponse,
    thread.lastDispatch,
    thread.providerSessionTimestamp,
    thread.lastSelectedAt,
  ]
    .map((value) => Date.parse(pickString(value)))
    .filter(Number.isFinite);
  return candidates.length > 0 ? Math.max(...candidates) : 0;
}

function mergeDuplicateThread(existing, candidate) {
  const existingTime = activityTime(existing);
  const candidateTime = activityTime(candidate);
  const newest = candidateTime >= existingTime ? candidate : existing;
  const oldest = newest === candidate ? existing : candidate;
  return {
    ...oldest,
    ...newest,
    title: pickString(newest.title, oldest.title),
    active: Boolean(existing.active || candidate.active),
    lastDispatch: pickString(newest.lastDispatch, oldest.lastDispatch),
    lastResponse: pickString(newest.lastResponse, oldest.lastResponse),
    lastActivityAt: pickString(newest.lastActivityAt, oldest.lastActivityAt),
  };
}

export function recentThreadSummariesForProjects(projects = [], { limit = 20 } = {}) {
  const requestedLimit = Number.parseInt(String(limit), 10);
  const boundedLimit = Number.isFinite(requestedLimit)
    ? Math.max(0, Math.min(requestedLimit, 100))
    : 20;
  const byThread = new Map();

  for (const project of Array.isArray(projects) ? projects : []) {
    const projectPath = pickString(project?.path);
    if (!projectPath) {
      continue;
    }
    const projectName = pickString(
      project?.displayName,
      project?.name,
      project?.slug,
      projectPath.split("/").filter(Boolean).at(-1),
      "Project",
    );
    const activeSessionId = resolveSessionAlias(
      project,
      pickString(project?.activeSessionId, project?.sessionId),
    );

    for (const session of Array.isArray(project?.sessions) ? project.sessions : []) {
      const sessionId = resolveSessionAlias(project, session?.sessionId);
      if (!sessionId) {
        continue;
      }
      const lastActivityMs = activityTime(session);
      const candidate = {
        projectName,
        projectPath,
        title: pickString(session?.title, session?.slug, projectName),
        provider: pickString(session?.provider, project?.provider, "codex"),
        sessionId,
        active: Boolean(session?.active || sessionId === activeSessionId),
        status: pickString(session?.status, "idle"),
        lastDispatch: pickString(session?.lastDispatch),
        lastResponse: pickString(session?.lastResponse),
        lastActivityAt: lastActivityMs > 0
          ? new Date(lastActivityMs).toISOString()
          : pickString(session?.lastActivityAt),
      };
      const key = `${projectPath}::${sessionId}`;
      const existing = byThread.get(key);
      byThread.set(key, existing ? mergeDuplicateThread(existing, candidate) : candidate);
    }
  }

  return [...byThread.values()]
    .sort((left, right) => {
      const activityDelta = activityTime(right) - activityTime(left);
      if (activityDelta !== 0) {
        return activityDelta;
      }
      if (left.active !== right.active) {
        return left.active ? -1 : 1;
      }
      const projectDelta = left.projectName.localeCompare(right.projectName);
      if (projectDelta !== 0) {
        return projectDelta;
      }
      const titleDelta = left.title.localeCompare(right.title);
      return titleDelta !== 0 ? titleDelta : left.sessionId.localeCompare(right.sessionId);
    })
    .slice(0, boundedLimit);
}
