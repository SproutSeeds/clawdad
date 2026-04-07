#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { opendir, stat } from "node:fs/promises";
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
      default:
        break;
    }
  }

  return options;
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
  let dir;
  try {
    dir = await opendir(rootDir);
  } catch {
    return;
  }

  for await (const entry of dir) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      yield* walkJsonlFiles(fullPath);
      continue;
    }
    if (entry.isFile() && fullPath.endsWith(".jsonl")) {
      yield fullPath;
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const normalizedCwd = path.resolve(options.cwd || "");
  if (!normalizedCwd) {
    printJson({ ok: false, error: "missing --cwd" });
    process.exitCode = 1;
    return;
  }

  const sessionsRoot = path.join(path.resolve(options.codexHome), "sessions");
  let best = null;

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

    let stats;
    try {
      stats = await stat(filePath);
    } catch {
      continue;
    }

    const candidate = {
      sessionId,
      source,
      originator: String(payload.originator || "").trim() || null,
      cwd,
      timestamp: String(payload.timestamp || first.timestamp || "").trim() || null,
      file: filePath,
      mtimeMs: stats.mtimeMs,
    };

    if (!best) {
      best = candidate;
      continue;
    }

    const bestKey = best.timestamp || "";
    const candidateKey = candidate.timestamp || "";
    if (candidateKey > bestKey || (candidateKey === bestKey && candidate.mtimeMs > best.mtimeMs)) {
      best = candidate;
    }
  }

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
    file: best.file,
  });
}

await main();
