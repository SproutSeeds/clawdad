#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

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

  return (
    trimmed.startsWith("<permissions instructions>") ||
    trimmed.startsWith("# AGENTS.md instructions for ") ||
    trimmed.startsWith("<environment_context>") ||
    trimmed.startsWith("<apps_instructions>") ||
    trimmed.startsWith("<skills_instructions>") ||
    trimmed.startsWith("<plugins_instructions>")
  );
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

      if (String(payload?.type || "").trim() !== "response_item") {
        continue;
      }
      if (String(payload?.payload?.type || "").trim() !== "message") {
        continue;
      }

      const role = String(payload?.payload?.role || "").trim().toLowerCase();
      if (role === "developer") {
        continue;
      }
      if (role !== "user") {
        continue;
      }

      const text = textFromMessageContent(payload?.payload?.content);
      if (!text || looksLikeInjectedCodexMessage(text)) {
        continue;
      }

      return {
        preview: normalizeSnippet(text, 120),
        titleHint: normalizeSnippet(text.split(/\r?\n/, 1)[0], 44),
      };
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  return {
    preview: "",
    titleHint: "",
  };
}

async function collectCandidates(options, normalizedCwd) {
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
    if (!sessionId || !cwd || path.resolve(cwd) !== normalizedCwd) {
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

  let selected = candidates;
  if (options.list && options.limit > 0) {
    selected = candidates.slice(0, options.limit);
  } else if (!options.list && !options.sessionId) {
    selected = candidates.slice(0, 1);
  }

  return Promise.all(selected.map(async (candidate) => {
    const preview = await readSessionPreview(candidate.file);
    return {
      ...candidate,
      preview: preview.preview,
      titleHint: preview.titleHint,
    };
  }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const normalizedCwd = path.resolve(options.cwd || "");
  if (!normalizedCwd) {
    printJson({ ok: false, error: "missing --cwd" });
    process.exitCode = 1;
    return;
  }

  const candidates = await collectCandidates(options, normalizedCwd);

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

await main();
