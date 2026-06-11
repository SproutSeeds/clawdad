#!/usr/bin/env node

import { spawn } from "node:child_process";

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
      case "--claude-binary":
      case "--turn-timeout-ms": {
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

function positiveIntegerOption(value, fallback) {
  const text = String(value || "").trim();
  if (/^[1-9][0-9]*$/u.test(text)) {
    return Number.parseInt(text, 10);
  }
  return fallback;
}

function claudePermissionArgs(permissionMode) {
  switch (permissionMode) {
    case "plan":
      return ["--permission-mode", "plan"];
    case "approve":
    case "full":
      return ["--permission-mode", "bypassPermissions"];
    default:
      return [];
  }
}

async function runCommand(command, args, { cwd, input = "", timeoutMs = 0, env = process.env } = {}) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let spawnError = null;
    let timedOut = false;
    let termTimer = null;
    let killTimer = null;

    if (timeoutMs > 0) {
      termTimer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => {
          child.kill("SIGKILL");
        }, 10_000);
      }, timeoutMs);
    }

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
      if (termTimer) {
        clearTimeout(termTimer);
      }
      if (killTimer) {
        clearTimeout(killTimer);
      }
      resolve({
        exitCode: spawnError ? 127 : code ?? 1,
        stdout,
        stderr,
        spawnError,
        timedOut,
      });
    });

    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

function parseClaudeEvents(output) {
  const text = String(output || "").trim();
  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry) => entry && typeof entry === "object");
    }
    if (parsed && typeof parsed === "object") {
      return [parsed];
    }
  } catch {
    // Fall through to line-based parsing for stream-style output.
  }

  const events = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      const entry = JSON.parse(trimmed);
      if (entry && typeof entry === "object") {
        events.push(entry);
      }
    } catch {
      // Ignore non-JSON status lines mixed into the stream.
    }
  }
  return events;
}

function lastResultEvent(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const entry = events[index];
    if (entry?.type === "result") {
      return entry;
    }
    if (entry?.type == null && (typeof entry?.result === "string" || typeof entry?.session_id === "string")) {
      return entry;
    }
  }
  return null;
}

function permissionDenialWarnings(resultEvent) {
  const denials = Array.isArray(resultEvent?.permission_denials) ? resultEvent.permission_denials : [];
  return denials
    .map((denial) => {
      const tool = String(denial?.tool_name || "tool").trim() || "tool";
      const input = denial?.tool_input ? JSON.stringify(denial.tool_input).slice(0, 200) : "";
      return `claude permission denial: ${tool}${input ? ` ${input}` : ""}`;
    })
    .slice(0, 8);
}

function friendlyClaudeError(raw, options = {}) {
  const text = String(raw || "").trim();
  const lower = text.toLowerCase();
  const binary = options.claudeBinary || "claude";

  if (/enoent|no such file or directory|spawn .* enoent/u.test(lower)) {
    return [
      `Claude Code CLI was not found at '${binary}'.`,
      "Install it with `npm install -g @anthropic-ai/claude-code`, or set CLAWDAD_CLAUDE=/absolute/path/to/claude.",
      text,
    ].filter(Boolean).join("\n\n");
  }

  if (/invalid api key|not logged in|please run \/login|log in|authentication[ _-]?error|credentials|oauth|unauthorized|401/u.test(lower)) {
    return [
      "Claude Code could not authenticate from this service context.",
      "Sign in once by running `claude` in a terminal, or mint a long-lived token with `claude setup-token` and set CLAUDE_CODE_OAUTH_TOKEN in the Clawdad service environment.",
      text,
    ].filter(Boolean).join("\n\n");
  }

  if (/usage limit|rate limit|limit reached|out of extra usage|overloaded/u.test(lower)) {
    return [
      "Claude Code hit a usage or rate limit for this account.",
      "Wait for the plan window to reset, or lower dispatch volume. Headless Clawdad dispatches share the same subscription pool as interactive Claude Code.",
      text,
    ].filter(Boolean).join("\n\n");
  }

  return text || "claude dispatch failed";
}

function sessionMissingError(raw) {
  return /no conversation found|session .*not found|could not find .*session/iu.test(String(raw || ""));
}

function sessionAlreadyExistsError(raw) {
  return /session .*(already exists|already in use|in use)/iu.test(String(raw || ""));
}

async function runTurn(options, { resume }) {
  const args = ["-p", "--output-format", "json"];
  args.push(...claudePermissionArgs(options.permissionMode));
  if (options.model) {
    args.push("--model", options.model);
  }
  if (resume) {
    args.push("--resume", options.sessionId);
  } else {
    args.push("--session-id", options.sessionId);
  }

  const result = await runCommand(options.claudeBinary, args, {
    cwd: options.projectPath,
    input: options.message,
    timeoutMs: options.turnTimeoutMs,
  });

  const events = parseClaudeEvents(result.stdout);
  return {
    ...result,
    events,
    resultEvent: lastResultEvent(events),
  };
}

function failurePayload(turn, options, warnings) {
  const chunks = [];
  if (turn.timedOut) {
    chunks.push(`Claude turn exceeded ${Math.round(options.turnTimeoutMs / 60000)} minutes and was stopped.`);
  }
  const resultEvent = turn.resultEvent;
  if (typeof resultEvent?.result === "string" && resultEvent.result.trim()) {
    chunks.push(resultEvent.result.trim());
  }
  if (turn.spawnError?.message) {
    chunks.push(turn.spawnError.message);
  }
  if (turn.stderr.trim()) {
    chunks.push(turn.stderr.trim());
  }
  if (chunks.length === 0 && turn.stdout.trim()) {
    chunks.push(turn.stdout.trim().slice(0, 2000));
  }

  return {
    ok: false,
    exit_code: turn.exitCode === 0 ? 1 : turn.exitCode,
    session_id: String(resultEvent?.session_id || options.sessionId || ""),
    result_text: "",
    error_text: friendlyClaudeError(chunks.filter(Boolean).join("\n\n"), options),
    warnings,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.projectPath || !options.message || !options.permissionMode || !options.sessionId) {
    throw new Error("missing required arguments");
  }

  options.claudeBinary = options.claudeBinary || process.env.CLAWDAD_CLAUDE || "claude";
  options.model = options.model || process.env.CLAWDAD_CLAUDE_MODEL || "";
  options.turnTimeoutMs = positiveIntegerOption(
    options.turnTimeoutMs || process.env.CLAWDAD_CLAUDE_TURN_TIMEOUT_MS,
    30 * 60 * 1000,
  );

  const warnings = [];
  if (options.permissionMode === "approve" || options.permissionMode === "full") {
    warnings.push(
      `claude permission-mode=${options.permissionMode} maps to bypassPermissions; PreToolUse hooks still apply`,
    );
  }

  let turn = await runTurn(options, { resume: Boolean(options.sessionSeeded) });

  if (turn.exitCode !== 0 && !turn.timedOut) {
    const combined = `${turn.stderr}\n${turn.stdout}`;
    if (options.sessionSeeded && sessionMissingError(combined)) {
      warnings.push(
        `previous Claude session ${options.sessionId} was not found on disk; starting fresh with the same session id`,
      );
      turn = await runTurn(options, { resume: false });
    } else if (!options.sessionSeeded && sessionAlreadyExistsError(combined)) {
      warnings.push(
        `Claude session ${options.sessionId} already exists; resuming it instead of creating a new one`,
      );
      turn = await runTurn(options, { resume: true });
    }
  }

  const resultEvent = turn.resultEvent;
  const succeeded =
    turn.exitCode === 0 &&
    !turn.timedOut &&
    resultEvent != null &&
    resultEvent.is_error !== true &&
    typeof resultEvent.result === "string";

  if (!succeeded) {
    const failure = failurePayload(turn, options, warnings);
    console.log(JSON.stringify(failure));
    process.exit(failure.exit_code || 1);
  }

  warnings.push(...permissionDenialWarnings(resultEvent));

  const payload = {
    ok: true,
    exit_code: 0,
    session_id: String(resultEvent.session_id || options.sessionId),
    session_seeded: true,
    result_text: resultEvent.result,
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
