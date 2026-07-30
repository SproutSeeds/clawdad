#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function parseArgs(argv) {
  const options = {
    cwd: "",
    codexHome: path.join(os.homedir(), ".codex"),
    excludes: new Set(),
    includeExec: false,
    list: false,
    limit: 12,
    roots: [],
    sessionId: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--cwd":
        options.cwd = String(argv[index + 1] || "").trim();
        index += 1;
        break;
      case "--codex-home":
        options.codexHome = String(argv[index + 1] || "").trim() || options.codexHome;
        index += 1;
        break;
      case "--exclude":
        options.excludes.add(String(argv[index + 1] || "").trim());
        index += 1;
        break;
      case "--include-exec":
        options.includeExec = true;
        break;
      case "--list":
        options.list = true;
        break;
      case "--limit": {
        const value = Number.parseInt(String(argv[index + 1] || "").trim(), 10);
        options.limit = Number.isFinite(value) && value >= 0 ? value : options.limit;
        index += 1;
        break;
      }
      case "--root":
        options.roots.push(String(argv[index + 1] || "").trim());
        index += 1;
        break;
      case "--session-id":
        options.sessionId = String(argv[index + 1] || "").trim();
        index += 1;
        break;
      default:
        break;
    }
  }

  return options;
}

function textFromMessageContent(content) {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }

  const textParts = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    if (typeof block.text === "string" && block.text.trim() !== "") {
      textParts.push(block.text.trim());
      continue;
    }
    if (typeof block.input === "string" && block.input.trim() !== "") {
      textParts.push(block.input.trim());
      continue;
    }
    if (typeof block.output === "string" && block.output.trim() !== "") {
      textParts.push(block.output.trim());
      continue;
    }
    if (Array.isArray(block.content)) {
      const nested = textFromMessageContent(block.content);
      if (nested) {
        textParts.push(nested);
      }
    }
  }

  return textParts.join("\n\n").trim();
}

function looksLikeInjectedCodexMessage(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return false;
  }

  const injectedPrefixes = [
    "<recommended_plugins>",
    "<permissions instructions>",
    "# AGENTS.md instructions for ",
    "<environment_context>",
    "<apps_instructions>",
    "<skills_instructions>",
    "<plugins_instructions>",
    "<collaboration_mode>",
  ];
  return injectedPrefixes.some((prefix) => trimmed.startsWith(prefix));
}

function normalizeSnippet(value, maxLength = 72) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

async function readFirstJsonLine(filePath) {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of reader) {
      const trimmed = String(line || "").trim();
      if (!trimmed) {
        continue;
      }
      return JSON.parse(trimmed);
    }
    return null;
  } finally {
    reader.close();
    stream.destroy();
  }
}

async function* walkJsonlFiles(rootDir) {
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return;
  }

  const sortedEntries = entries.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) {
      return left.isDirectory() ? 1 : -1;
    }
    return right.name.localeCompare(left.name);
  });

  for (const entry of sortedEntries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isFile() && fullPath.endsWith(".jsonl")) {
      yield fullPath;
      continue;
    }
    if (entry.isDirectory()) {
      yield* walkJsonlFiles(fullPath);
    }
  }
}

function isAllowedSource(source, includeExec) {
  if (source === "cli" || source === "vscode") {
    return true;
  }
  if (includeExec && source === "exec") {
    return true;
  }
  return false;
}

async function readSessionPreview(filePath) {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let fallback = "";

  try {
    for await (const line of reader) {
      const trimmed = String(line || "").trim();
      if (!trimmed) {
        continue;
      }

      let payload;
      try {
        payload = JSON.parse(trimmed);
      } catch {
        continue;
      }

      const recordType = String(payload?.type || "").trim();
      const payloadType = String(payload?.payload?.type || "").trim();

      if (recordType === "event_msg" && payloadType === "user_message") {
        const text = String(payload?.payload?.message || "").trim();
        if (!text || looksLikeInjectedCodexMessage(text)) {
          continue;
        }
        return {
          preview: normalizeSnippet(text, 120),
          titleHint: normalizeSnippet(text.split(/\r?\n/, 1)[0], 44),
        };
      }

      if (recordType !== "response_item") {
        continue;
      }
      if (payloadType !== "message") {
        continue;
      }

      const role = String(payload?.payload?.role || "").trim().toLowerCase();
      if (role === "assistant" && fallback) {
        break;
      }
      if (role !== "user") {
        continue;
      }

      const text = textFromMessageContent(payload?.payload?.content);
      if (!text || looksLikeInjectedCodexMessage(text)) {
        continue;
      }
      fallback = text;
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  return fallback
    ? {
        preview: normalizeSnippet(fallback, 120),
        titleHint: normalizeSnippet(fallback.split(/\r?\n/, 1)[0], 44),
      }
    : {
        preview: "",
        titleHint: "",
      };
}

function pathIsWithinRoot(candidatePath, rootPath) {
  const candidate = path.resolve(String(candidatePath || ""));
  const root = path.resolve(String(rootPath || ""));
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function sessionMatchesLocation(cwd, normalizedCwd, normalizedRoots) {
  const resolvedCwd = path.resolve(String(cwd || ""));
  if (normalizedCwd && resolvedCwd !== normalizedCwd) {
    return false;
  }
  return (
    normalizedRoots.length === 0 ||
    normalizedRoots.some((rootPath) => pathIsWithinRoot(resolvedCwd, rootPath))
  );
}

function selectCandidates(candidates, options) {
  if (options.list && options.limit > 0) {
    return candidates.slice(0, options.limit);
  }
  if (!options.list && !options.sessionId) {
    return candidates.slice(0, 1);
  }
  return candidates;
}

async function collectIndexedCandidates(options, normalizedCwd, normalizedRoots) {
  const databasePath = path.join(path.resolve(options.codexHome), "state_5.sqlite");
  try {
    await stat(databasePath);
  } catch {
    return null;
  }

  const query = `
    SELECT
      id,
      cwd,
      source,
      rollout_path,
      created_at,
      created_at_ms,
      updated_at,
      updated_at_ms,
      recency_at_ms,
      substr(name, 1, 240) AS name,
      substr(title, 1, 240) AS title,
      substr(preview, 1, 240) AS preview,
      substr(first_user_message, 1, 240) AS first_user_message
    FROM threads
    WHERE archived = 0
      AND source IN (${options.includeExec ? "'cli', 'vscode', 'exec'" : "'cli', 'vscode'"})
    ORDER BY
      COALESCE(NULLIF(recency_at_ms, 0), NULLIF(updated_at_ms, 0), updated_at * 1000) DESC,
      id DESC
    LIMIT 2000
  `;

  let rows;
  try {
    const { stdout } = await execFileP(
      process.env.CLAWDAD_SQLITE3_PATH || "/usr/bin/sqlite3",
      ["-readonly", "-json", databasePath, query],
      {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: 2_000,
      },
    );
    rows = JSON.parse(stdout || "[]");
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) {
    return null;
  }

  const candidates = rows
    .filter((row) => {
      const sessionId = String(row?.id || "").trim();
      const cwd = String(row?.cwd || "").trim();
      const source = String(row?.source || "").trim();
      return (
        sessionId &&
        cwd &&
        sessionMatchesLocation(cwd, normalizedCwd, normalizedRoots) &&
        isAllowedSource(source, options.includeExec) &&
        !options.excludes.has(sessionId) &&
        (!options.sessionId || sessionId === options.sessionId)
      );
    })
    .map((row) => {
      const recencyMs =
        Number(row?.recency_at_ms) ||
        Number(row?.updated_at_ms) ||
        Number(row?.updated_at) * 1000 ||
        0;
      const createdMs =
        Number(row?.created_at_ms) ||
        Number(row?.created_at) * 1000 ||
        0;
      const preview = normalizeSnippet(
        String(row?.preview || row?.first_user_message || ""),
        120,
      );
      const titleHint = normalizeSnippet(
        String(row?.name || row?.title || preview || ""),
        44,
      );
      return {
        sessionId: String(row.id).trim(),
        source: String(row.source || "").trim(),
        originator: null,
        cwd: String(row.cwd || "").trim(),
        timestamp: createdMs > 0 ? new Date(createdMs).toISOString() : null,
        lastUpdatedAt: recencyMs > 0 ? new Date(recencyMs).toISOString() : null,
        file: String(row.rollout_path || "").trim() || null,
        mtimeMs: recencyMs,
        preview,
        titleHint,
      };
    });

  const selected = selectCandidates(candidates, options);
  return Promise.all(selected.map(async (candidate) => {
    if (candidate.preview || candidate.titleHint || !candidate.file) {
      return candidate;
    }
    const preview = await readSessionPreview(candidate.file).catch(() => ({
      preview: "",
      titleHint: "",
    }));
    return {
      ...candidate,
      preview: preview.preview,
      titleHint: preview.titleHint,
    };
  }));
}

async function collectCandidates(options, normalizedCwd, normalizedRoots) {
  const sessionsRoot = path.join(path.resolve(options.codexHome), "sessions");
  const candidates = [];

  for await (const filePath of walkJsonlFiles(sessionsRoot)) {
    let first;
    try {
      first = await readFirstJsonLine(filePath);
    } catch {
      continue;
    }
    if (!first || first.type !== "session_meta") {
      continue;
    }

    const payload = first.payload || {};
    const sessionId = String(payload.id || "").trim();
    const source = String(payload.source || "").trim();
    const cwd = String(payload.cwd || "").trim();
    if (!sessionId || !cwd) {
      continue;
    }
    if (!sessionMatchesLocation(cwd, normalizedCwd, normalizedRoots)) {
      continue;
    }
    if (!isAllowedSource(source, options.includeExec)) {
      continue;
    }
    if (options.excludes.has(sessionId)) {
      continue;
    }
    if (options.sessionId && sessionId !== options.sessionId) {
      continue;
    }

    let stats;
    try {
      stats = await stat(filePath);
    } catch {
      continue;
    }

    candidates.push({
      sessionId,
      source,
      originator: String(payload.originator || "").trim() || null,
      cwd,
      timestamp: String(payload.timestamp || first.timestamp || "").trim() || null,
      lastUpdatedAt: new Date(stats.mtimeMs).toISOString(),
      file: filePath,
      mtimeMs: stats.mtimeMs,
    });

    if (options.sessionId) {
      break;
    }
  }

  candidates.sort((left, right) => {
    if (left.mtimeMs !== right.mtimeMs) {
      return right.mtimeMs - left.mtimeMs;
    }
    const leftKey = left.timestamp || "";
    const rightKey = right.timestamp || "";
    return rightKey.localeCompare(leftKey);
  });

  const selected = selectCandidates(candidates, options);

  return Promise.all(selected.map(async (candidate) => {
    const preview = await readSessionPreview(candidate.file);
    return {
      ...candidate,
      preview: preview.preview,
      titleHint: preview.titleHint,
    };
  }));
}

export async function discoverCodexSessions({
  cwd = "",
  codexHome = path.join(os.homedir(), ".codex"),
  excludes = [],
  includeExec = false,
  list = false,
  limit = 12,
  roots = [],
  sessionId = "",
} = {}) {
  const normalizedCwd = String(cwd || "").trim()
    ? path.resolve(String(cwd).trim())
    : "";
  const normalizedRoots = [
    ...new Set(
      (Array.isArray(roots) ? roots : [roots])
        .map((rootPath) => String(rootPath || "").trim())
        .filter(Boolean)
        .map((rootPath) => path.resolve(rootPath)),
    ),
  ];
  if (!normalizedCwd && normalizedRoots.length === 0) {
    throw new Error("missing --cwd or --root");
  }

  const options = {
    cwd: normalizedCwd,
    codexHome,
    excludes: excludes instanceof Set ? excludes : new Set(excludes),
    includeExec: Boolean(includeExec),
    list: Boolean(list),
    limit: Number.isFinite(Number(limit)) && Number(limit) >= 0 ? Number(limit) : 12,
    roots: normalizedRoots,
    sessionId: String(sessionId || "").trim(),
  };
  const indexedCandidates = await collectIndexedCandidates(
    options,
    normalizedCwd,
    normalizedRoots,
  );
  if (indexedCandidates) {
    return indexedCandidates;
  }
  return collectCandidates(options, normalizedCwd, normalizedRoots);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let candidates;
  try {
    candidates = await discoverCodexSessions(options);
  } catch (error) {
    printJson({ ok: false, error: error.message });
    process.exitCode = 1;
    return;
  }

  if (options.list) {
    printJson({
      ok: true,
      sessions: candidates.map(({ mtimeMs, ...session }) => session),
    });
    return;
  }

  const best = candidates[0] || null;
  if (!best) {
    printJson({ ok: false, sessionId: "", reason: "not_found" });
    return;
  }

  printJson({
    ok: true,
    sessionId: best.sessionId,
    source: best.source,
    originator: best.originator,
    cwd: best.cwd,
    timestamp: best.timestamp,
    lastUpdatedAt: best.lastUpdatedAt,
    file: best.file,
    preview: best.preview,
    titleHint: best.titleHint,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
