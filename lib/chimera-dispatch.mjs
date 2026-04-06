#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--project-path":
      case "--message":
      case "--session-id":
      case "--permission-mode":
      case "--model":
      case "--chimera-binary":
      case "--home-dir": {
        const value = argv[index + 1];
        if (value == null) {
          throw new Error(`missing value for ${arg}`);
        }
        options[arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = value;
        index += 1;
        break;
      }
      case "--session-seeded":
        options.sessionSeeded = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  return options;
}

function homeDirFor(options) {
  return options.homeDir || process.env.HOME || os.homedir();
}

function chimeraSessionsDir(options) {
  return path.join(homeDirFor(options), ".chimera-harness", "sessions");
}

function legacySessionsDir(options) {
  return path.join(homeDirFor(options), ".chimera", "sessions");
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function locateSessionPath(options, sessionId) {
  const primary = path.join(chimeraSessionsDir(options), `${sessionId}.jsonl`);
  if (await fileExists(primary)) {
    return primary;
  }

  const legacy = path.join(legacySessionsDir(options), `${sessionId}.jsonl`);
  if (await fileExists(legacy)) {
    return legacy;
  }

  return primary;
}

async function runCommand(command, args, { cwd, input = "", env = process.env } = {}) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let spawnError = null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", (code) => {
      resolve({
        exitCode: spawnError ? 127 : code ?? 1,
        stdout,
        stderr,
        spawnError,
      });
    });

    child.stdin.end(input);
  });
}

function parseJsonLines(output) {
  const events = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Ignore non-JSON status lines mixed into the stream.
    }
  }
  return events;
}

function extractSessionId(text) {
  const resumeMatch = text.match(/chimera --resume ([0-9a-f-]+)/i);
  if (resumeMatch) {
    return resumeMatch[1];
  }

  const pathMatch = text.match(/sessions\/([0-9a-f-]+)\.jsonl/i);
  if (pathMatch) {
    return pathMatch[1];
  }

  return "";
}

async function seedSession(options) {
  const args = ["--json"];
  if (options.model) {
    args.push("--model", options.model);
  }

  const result = await runCommand(
    options.chimeraBinary,
    args,
    {
      cwd: options.projectPath,
      input: "/save\n/quit\n",
    },
  );

  const combined = `${result.stdout}\n${result.stderr}`;
  const sessionId = extractSessionId(combined);

  return {
    ...result,
    sessionId,
  };
}

function lastEvent(events, type) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === type) {
      return events[index];
    }
  }
  return null;
}

async function runPrompt(options, sessionId) {
  const args = ["--json"];
  if (options.model) {
    args.push("--model", options.model);
  }
  if (sessionId) {
    args.push("--resume", sessionId);
  }
  if (options.permissionMode !== "plan") {
    args.push("--auto-approve");
  }
  args.push("--prompt", options.message);

  const result = await runCommand(
    options.chimeraBinary,
    args,
    {
      cwd: options.projectPath,
      input: "",
    },
  );

  const events = parseJsonLines(result.stdout);
  const turnComplete = lastEvent(events, "turn_complete");
  const usage = lastEvent(events, "usage");
  const textDeltas = events
    .filter((event) => event?.type === "text_delta" && typeof event.text === "string")
    .map((event) => event.text);

  return {
    ...result,
    events,
    resultText:
      typeof turnComplete?.text === "string" && turnComplete.text.length > 0
        ? turnComplete.text
        : textDeltas.join(""),
    usage: usage && Number.isFinite(usage.input_tokens) && Number.isFinite(usage.output_tokens)
      ? {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
        }
      : null,
  };
}

async function appendSimpleExchange(options, sessionId, message, resultText, usage) {
  const sessionPath = await locateSessionPath(options, sessionId);
  const raw = await readFile(sessionPath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    throw new Error(`empty Chimera session file: ${sessionPath}`);
  }

  const header = JSON.parse(lines[0]);
  const messages = lines.slice(1).map((line) => JSON.parse(line));

  messages.push({
    role: "user",
    content: message,
  });
  messages.push({
    role: "assistant",
    content: resultText,
  });

  header.total_input_tokens = Number(header.total_input_tokens || 0) + Number(usage?.inputTokens || 0);
  header.total_output_tokens = Number(header.total_output_tokens || 0) + Number(usage?.outputTokens || 0);
  header.message_count = messages.length;

  const nextRaw = [
    JSON.stringify(header),
    ...messages.map((entry) => JSON.stringify(entry)),
    "",
  ].join("\n");

  await writeFile(sessionPath, nextRaw, "utf8");
  return sessionPath;
}

function summarizeFailure(promptResult, sessionId, warnings) {
  const errorEvent = lastEvent(promptResult.events || [], "error");
  const chunks = [];
  if (errorEvent?.message) {
    chunks.push(errorEvent.message);
  }
  if (promptResult.stderr.trim()) {
    chunks.push(promptResult.stderr.trim());
  }
  if (promptResult.stdout.trim()) {
    chunks.push(promptResult.stdout.trim());
  }

  return {
    ok: false,
    exit_code: promptResult.exitCode,
    session_id: sessionId,
    result_text: "",
    error_text: chunks.filter(Boolean).join("\n\n") || "chimera dispatch failed",
    warnings,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.projectPath || !options.message || !options.permissionMode || !options.sessionId) {
    throw new Error("missing required arguments");
  }

  options.chimeraBinary = options.chimeraBinary || process.env.CLAWDAD_CHIMERA || "chimera";

  const warnings = [];
  if (options.permissionMode === "approve") {
    warnings.push("chimera maps permission-mode=approve to --auto-approve until it exposes a noninteractive middle approval mode");
  } else if (options.permissionMode === "full") {
    warnings.push("chimera uses --auto-approve for permission-mode=full");
  }

  let sessionId = options.sessionId;
  let sessionSeeded = Boolean(options.sessionSeeded);
  const existingSessionPath = sessionSeeded ? await locateSessionPath(options, sessionId) : null;

  if (!sessionSeeded || !(existingSessionPath && await fileExists(existingSessionPath))) {
    const seeded = await seedSession(options);
    if (seeded.exitCode !== 0 || !seeded.sessionId) {
      const failure = {
        ok: false,
        exit_code: seeded.exitCode,
        session_id: sessionId,
        result_text: "",
        error_text: seeded.spawnError?.message || `${seeded.stderr}\n${seeded.stdout}`.trim() || "failed to seed chimera session",
        warnings,
      };
      console.log(JSON.stringify(failure));
      process.exit(seeded.exitCode || 1);
    }
    sessionId = seeded.sessionId;
    sessionSeeded = true;
  }

  const promptResult = await runPrompt(options, sessionId);
  if (promptResult.exitCode !== 0) {
    const failure = summarizeFailure(promptResult, sessionId, warnings);
    console.log(JSON.stringify(failure));
    process.exit(promptResult.exitCode);
  }

  const resultText = promptResult.resultText || "";
  const sessionPath = await appendSimpleExchange(
    options,
    sessionId,
    options.message,
    resultText,
    promptResult.usage,
  );

  const payload = {
    ok: true,
    exit_code: 0,
    session_id: sessionId,
    session_seeded: sessionSeeded,
    session_path: sessionPath,
    result_text: resultText,
    warnings,
  };
  console.log(JSON.stringify(payload));
}

main().catch((error) => {
  console.log(
    JSON.stringify({
      ok: false,
      exit_code: 1,
      session_id: "",
      result_text: "",
      error_text: error?.message || String(error),
      warnings: [],
    }),
  );
  process.exit(1);
});
