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
      case "--ollama-base-url":
      case "--chimera-binary":
      case "--home-dir":
      case "--max-iterations":
      case "--provider-retries": {
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

function chimeraSigilSessionsDir(options) {
  return path.join(homeDirFor(options), ".chimera-sigil", "sessions");
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
  const candidates = [
    path.join(chimeraSigilSessionsDir(options), `${sessionId}.jsonl`),
    path.join(chimeraSessionsDir(options), `${sessionId}.jsonl`),
    path.join(legacySessionsDir(options), `${sessionId}.jsonl`),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
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

const localModelAliases = new Map([
  ["local", "qwen3:4b"],
  ["local-default", "qwen3:4b"],
  ["local-small", "qwen3:4b"],
  ["local-laptop", "qwen3:4b"],
  ["local-tiny", "llama3.2:1b"],
  ["local-edge", "gemma3n:e2b"],
  ["local-coder-small", "qwen2.5-coder:3b"],
  ["local-code", "qwen2.5-coder:7b"],
  ["local-coder", "qwen2.5-coder:7b"],
  ["local-balanced", "qwen3:8b"],
  ["local-12gb", "qwen3:14b"],
  ["local-16gb", "qwen3:14b"],
  ["local-heavy", "qwen3:14b"],
  ["local-coder-12gb", "qwen2.5-coder:14b"],
  ["local-coder-16gb", "qwen2.5-coder:14b"],
  ["local-coder-heavy", "qwen2.5-coder:14b"],
  ["local-reasoning", "deepseek-r1:8b"],
  ["local-24gb", "qwen3:30b"],
  ["local-4090", "qwen3:30b"],
  ["local-gpu", "qwen3:30b"],
  ["local-workstation", "qwen3:30b"],
  ["local-coder-24gb", "qwen2.5-coder:32b"],
  ["local-coder-4090", "qwen2.5-coder:32b"],
  ["local-coder-gpu", "qwen2.5-coder:32b"],
]);

const workstationModelAliases = new Set([
  "local-24gb",
  "local-4090",
  "local-gpu",
  "local-workstation",
  "local-coder-24gb",
  "local-coder-4090",
  "local-coder-gpu",
]);

const workstationResolvedModels = new Set([
  "qwen3:30b",
  "qwen2.5-coder:32b",
]);

function localModelHint(model) {
  const value = String(model || "local").trim() || "local";
  return localModelAliases.get(value) || value;
}

function modelUsesWorkstationOllama(model) {
  const requested = String(model || "local").trim().toLowerCase() || "local";
  const resolved = localModelHint(requested).toLowerCase();
  return workstationModelAliases.has(requested) || workstationResolvedModels.has(resolved);
}

function envValue(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function normalizeOllamaBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/u, "");
}

function resolveOllamaBaseUrl(options = {}) {
  if (options.ollamaBaseUrl) {
    return normalizeOllamaBaseUrl(options.ollamaBaseUrl);
  }

  if (modelUsesWorkstationOllama(options.model)) {
    return normalizeOllamaBaseUrl(envValue(
      "CLAWDAD_CHIMERA_4090_OLLAMA_BASE_URL",
      "CLAWDAD_OLLAMA_4090_BASE_URL",
      "CLAWDAD_CHIMERA_WORKSTATION_OLLAMA_BASE_URL",
      "CLAWDAD_OLLAMA_WORKSTATION_BASE_URL",
      "OLLAMA_BASE_URL",
    ));
  }

  return normalizeOllamaBaseUrl(envValue(
    "CLAWDAD_CHIMERA_LOCAL_OLLAMA_BASE_URL",
    "CLAWDAD_OLLAMA_LOCAL_BASE_URL",
  ));
}

function chimeraEnv(options = {}) {
  const env = { ...process.env };
  const ollamaBaseUrl = resolveOllamaBaseUrl(options);
  if (ollamaBaseUrl) {
    env.OLLAMA_BASE_URL = ollamaBaseUrl;
  }
  return env;
}

function positiveIntegerOption(value, fallback = "") {
  const text = String(value || "").trim();
  if (/^[1-9][0-9]*$/u.test(text)) {
    return text;
  }
  return fallback;
}

function friendlyChimeraError(raw, options = {}) {
  const text = String(raw || "").trim();
  const lower = text.toLowerCase();
  const binary = options.chimeraBinary || "chimera";
  const model = options.model || "local";
  const resolvedModel = localModelHint(model);
  const ollamaBaseUrl =
    options.ollamaBaseUrl || resolveOllamaBaseUrl(options) || process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
  const workstationLane = modelUsesWorkstationOllama(model);

  if (/enoent|no such file or directory|spawn .* enoent/u.test(lower)) {
    return [
      `Chimera CLI was not found at '${binary}'.`,
      "Install it with `npm install -g chimera-sigil`, or set CLAWDAD_CHIMERA=/absolute/path/to/chimera.",
      "Then run `clawdad chimera-doctor`.",
      text,
    ].filter(Boolean).join("\n\n");
  }

  if (
    /connection refused|failed to connect|couldn't connect|could not connect|connection reset/u.test(lower) &&
    /ollama|11434|chat\/completions/u.test(lower)
  ) {
    return [
      `Chimera cannot reach the ${workstationLane ? "4090" : "local"} Ollama endpoint for '${model}'.`,
      `Endpoint: ${ollamaBaseUrl}`,
      workstationLane
        ? "Make sure Umbra is awake and Ollama is running on the configured endpoint."
        : "Start Ollama, then run `clawdad chimera-doctor`.",
      `If the model is missing, pull it with \`ollama pull ${resolvedModel}\`.`,
      text,
    ].filter(Boolean).join("\n\n");
  }

  if (/model .*not found|pull model|not installed|does not exist/u.test(lower) && /ollama|model/u.test(lower)) {
    return [
      `The local model for '${model}' does not appear to be pulled.`,
      `Run \`ollama pull ${resolvedModel}\`, then try again.`,
      "You can check the lane with `clawdad chimera-doctor`.",
      text,
    ].filter(Boolean).join("\n\n");
  }

  if (/missing .*api_key|missing .*api key|missing .*_api_key/u.test(lower)) {
    return [
      "Chimera tried to use a cloud provider and is missing that provider's API key.",
      "For the local lane, use a local model such as `--model local` or set CLAWDAD_CHIMERA_MODEL=local.",
      text,
    ].filter(Boolean).join("\n\n");
  }

  return text || "chimera dispatch failed";
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
      env: chimeraEnv(options),
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
  const maxIterations = positiveIntegerOption(
    options.maxIterations || process.env.CLAWDAD_CHIMERA_MAX_ITERATIONS,
    "8",
  );
  if (maxIterations) {
    args.push("--max-iterations", maxIterations);
  }
  const providerRetries = positiveIntegerOption(
    options.providerRetries || process.env.CLAWDAD_CHIMERA_PROVIDER_RETRIES,
  );
  if (providerRetries) {
    args.push("--provider-retries", providerRetries);
  }
  if (sessionId) {
    args.push("--resume", sessionId);
  }
  if (options.permissionMode === "approve") {
    args.push("--approval-mode", "approve");
  } else if (options.permissionMode === "full") {
    args.push("--approval-mode", "full");
  }
  args.push("--prompt", options.message);

  const result = await runCommand(
    options.chimeraBinary,
    args,
    {
      cwd: options.projectPath,
      input: "",
      env: chimeraEnv(options),
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
  if (promptResult.spawnError?.message) {
    chunks.push(promptResult.spawnError.message);
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
    error_text: friendlyChimeraError(chunks.filter(Boolean).join("\n\n"), promptResult.options),
    warnings,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.projectPath || !options.message || !options.permissionMode || !options.sessionId) {
    throw new Error("missing required arguments");
  }

  options.chimeraBinary = options.chimeraBinary || process.env.CLAWDAD_CHIMERA || "chimera";
  options.model = options.model || process.env.CLAWDAD_CHIMERA_MODEL || "local";
  options.ollamaBaseUrl = resolveOllamaBaseUrl(options);

  const warnings = [];
  if (options.permissionMode === "full") {
    warnings.push("chimera permission-mode=full allows all Chimera tool executions");
  }

  let sessionId = options.sessionId;
  let sessionSeeded = Boolean(options.sessionSeeded);
  const existingSessionPath = sessionSeeded ? await locateSessionPath(options, sessionId) : null;

  if (!sessionSeeded || !(existingSessionPath && await fileExists(existingSessionPath))) {
    const seeded = await seedSession(options);
    if (seeded.exitCode !== 0 || !seeded.sessionId) {
      const rawError =
        seeded.spawnError?.message || `${seeded.stderr}\n${seeded.stdout}`.trim() || "failed to seed chimera session";
      const failure = {
        ok: false,
        exit_code: seeded.exitCode,
        session_id: sessionId,
        result_text: "",
        error_text: friendlyChimeraError(rawError, options),
        warnings,
      };
      console.log(JSON.stringify(failure));
      process.exit(seeded.exitCode || 1);
    }
    sessionId = seeded.sessionId;
    sessionSeeded = true;
  }

  const promptResult = await runPrompt(options, sessionId);
  promptResult.options = options;
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
    ollama_base_url: options.ollamaBaseUrl || "",
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
