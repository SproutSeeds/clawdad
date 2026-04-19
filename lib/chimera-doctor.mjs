#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

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
  ["local-12gb", "qwen3:14b"],
  ["local-16gb", "qwen3:14b"],
  ["local-heavy", "qwen3:14b"],
  ["local-coder-12gb", "qwen2.5-coder:14b"],
  ["local-coder-16gb", "qwen2.5-coder:14b"],
  ["local-coder-heavy", "qwen2.5-coder:14b"],
  ["local-balanced", "qwen3:8b"],
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

function parseArgs(argv) {
  const options = {
    json: false,
    chimeraBinary: process.env.CLAWDAD_CHIMERA || "chimera",
    model: process.env.CLAWDAD_CHIMERA_MODEL || "local",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--json":
        options.json = true;
        break;
      case "--chimera-binary":
      case "--model":
      case "--ollama-base-url": {
        const value = argv[index + 1];
        if (!value) {
          throw new Error(`missing value for ${arg}`);
        }
        options[arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = value;
        index += 1;
        break;
      }
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  return options;
}

function resolveLocalModel(model) {
  const value = String(model || "").trim();
  return localModelAliases.get(value) || value;
}

function modelUsesWorkstationOllama(model) {
  const requested = String(model || "local").trim().toLowerCase() || "local";
  const resolved = resolveLocalModel(requested).toLowerCase();
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
    "OLLAMA_BASE_URL",
  ));
}

function ollamaApiBase(options) {
  const configured = resolveOllamaBaseUrl(options) || "http://localhost:11434/v1";
  return configured.replace(/\/+$/u, "").replace(/\/v1$/u, "");
}

async function commandExists(command) {
  if (command.includes("/") || command.includes(path.sep)) {
    try {
      await access(command);
      return true;
    } catch {
      return false;
    }
  }

  const paths = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of paths) {
    try {
      await access(path.join(dir, command));
      return true;
    } catch {
      // Keep searching PATH.
    }
  }
  return false;
}

async function runCommand(command, args, options = {}) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
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
        ok: !spawnError && code === 0,
        exitCode: spawnError ? 127 : code ?? 1,
        stdout,
        stderr,
        spawnError,
      });
    });
  });
}

function parseJsonObject(text) {
  for (const line of String(text || "").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      // Continue looking for a JSON diagnostic line.
    }
  }
  return null;
}

async function readOllamaModels(options) {
  const url = `${ollamaApiBase(options)}/api/tags`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) {
      return {
        ok: false,
        url,
        models: [],
        error: `Ollama returned HTTP ${response.status}`,
      };
    }
    const payload = await response.json();
    const models = Array.isArray(payload?.models)
      ? payload.models.map((model) => String(model?.name || "").trim()).filter(Boolean)
      : [];
    return { ok: true, url, models, error: "" };
  } catch (error) {
    return {
      ok: false,
      url,
      models: [],
      error: error?.message || String(error),
    };
  }
}

function pulledModelMatches(models, resolvedModel) {
  return models.some((model) => {
    const normalized = String(model || "").trim();
    return normalized === resolvedModel || normalized.replace(/:latest$/u, "") === resolvedModel;
  });
}

async function diagnose(options) {
  const requestedModel = String(options.model || "local").trim();
  const resolvedModel = resolveLocalModel(requestedModel);
  const ollamaBaseUrl = resolveOllamaBaseUrl(options) || "http://localhost:11434/v1";
  const checks = [];
  const suggestions = [];

  const binaryPresent = await commandExists(options.chimeraBinary);
  checks.push({
    label: "Chimera CLI",
    status: binaryPresent ? "pass" : "fail",
    detail: binaryPresent ? options.chimeraBinary : `${options.chimeraBinary} not found`,
  });

  let help = "";
  let version = "";
  let localDoctor = null;
  if (binaryPresent) {
    const versionResult = await runCommand(options.chimeraBinary, ["--version"]);
    version = (versionResult.stdout || versionResult.stderr).trim().split(/\r?\n/u)[0] || "";

    const helpResult = await runCommand(options.chimeraBinary, ["--help"]);
    help = `${helpResult.stdout}\n${helpResult.stderr}`;
    checks.push({
      label: "Chimera local profiles",
      status: help.includes("--local-doctor") ? "pass" : "warn",
      detail: help.includes("--local-doctor")
        ? "supports --local-doctor"
        : "binary is older; rebuild or reinstall chimera-sigil",
    });

    if (help.includes("--local-doctor")) {
      const doctorResult = await runCommand(options.chimeraBinary, ["--local-doctor", "--json"]);
      localDoctor = parseJsonObject(`${doctorResult.stdout}\n${doctorResult.stderr}`);
      checks.push({
        label: "Chimera local doctor",
        status: doctorResult.ok && localDoctor ? "pass" : "warn",
        detail: doctorResult.ok && localDoctor
          ? `recommended ${localDoctor?.recommendation?.primary || "local"}`
          : (doctorResult.stderr || doctorResult.stdout || "no JSON diagnostic").trim(),
      });
    }
  } else {
    suggestions.push("Install Chimera with `npm install -g chimera-sigil`, or set CLAWDAD_CHIMERA=/absolute/path/to/chimera.");
  }

  const ollama = await readOllamaModels(options);
  checks.push({
    label: "Ollama",
    status: ollama.ok ? "pass" : "fail",
    detail: ollama.ok ? `${ollama.models.length} model(s) available` : `not reachable at ${ollama.url}`,
  });
  if (!ollama.ok) {
    suggestions.push(`Start Ollama at ${ollamaBaseUrl} before using Chimera local models.`);
  }

  const modelPulled = ollama.ok && pulledModelMatches(ollama.models, resolvedModel);
  checks.push({
    label: "Requested local model",
    status: modelPulled ? "pass" : "warn",
    detail: modelPulled
      ? `${resolvedModel} is pulled`
      : `${requestedModel} resolves to ${resolvedModel}`,
  });
  if (!modelPulled) {
    suggestions.push(`Pull the model with \`ollama pull ${resolvedModel}\`.`);
  }

  const ready = checks.every((check) => check.status === "pass");
  return {
    ok: binaryPresent,
    ready,
    chimeraBinary: options.chimeraBinary,
    chimeraVersion: version,
    requestedModel,
    resolvedModel,
    ollamaBaseUrl,
    ollama,
    localDoctor,
    checks,
    suggestions: [...new Set(suggestions)],
  };
}

function printHuman(result) {
  console.log("Chimera local lane");
  for (const check of result.checks) {
    const marker = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
    console.log(`${marker} ${check.label}: ${check.detail}`);
  }
  if (result.chimeraVersion) {
    console.log(`Version: ${result.chimeraVersion}`);
  }
  console.log(`Model: ${result.requestedModel} -> ${result.resolvedModel}`);
  if (result.suggestions.length > 0) {
    console.log("");
    console.log("Next steps:");
    for (const suggestion of result.suggestions) {
      console.log(`- ${suggestion}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await diagnose(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
