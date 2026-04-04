#!/usr/bin/env node

import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";

const execFileP = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clawdadRoot = process.env.CLAWDAD_ROOT || path.resolve(__dirname, "..");
const clawdadHome = process.env.CLAWDAD_HOME || path.join(os.homedir(), ".clawdad");
const clawdadBin =
  process.env.CLAWDAD_BIN_PATH || path.resolve(clawdadRoot, "bin", "clawdad");
const packageJsonPath = path.resolve(clawdadRoot, "package.json");
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const version = packageJson.version || "dev";
const launchAgentLabelDefault = "com.sproutseeds.clawdad.server";

function printUsage() {
  console.log(`clawdad server helpers

Usage:
  clawdad serve [options]
  clawdad gen-token [options]
  clawdad print-launch-agent [options]
  clawdad install-launch-agent [options]

Commands:
  serve
    Start the HTTP listener for remote dispatches.

  gen-token
    Generate a bearer token. Add --write to save it to the token file.

  print-launch-agent
    Print a launchd plist for running 'clawdad serve' continuously on macOS.

  install-launch-agent
    Write the launchd plist to ~/Library/LaunchAgents (or --path).

Common options:
  --host <host>                 Listener host (default: ${process.env.CLAWDAD_SERVER_HOST || "127.0.0.1"})
  --port <port>                 Listener port (default: ${process.env.CLAWDAD_SERVER_PORT || "4477"})
  --token <token>               Bearer token to require for API requests
  --token-file <path>           Token file path (default: ${process.env.CLAWDAD_SERVER_TOKEN_FILE || path.join(clawdadHome, "server.token")})
  --default-project <slug>      Default project slug/path when a request omits 'project'

serve options:
  --body-limit-bytes <bytes>    Max request body size (default: ${process.env.CLAWDAD_SERVER_BODY_LIMIT_BYTES || "65536"})

gen-token options:
  --write                       Write the token to the token file and chmod 600 it

launch-agent options:
  --label <label>               launchd label (default: ${launchAgentLabelDefault})
  --path <path>                 Output plist path
  --stdout-log <path>           Stdout log path
  --stderr-log <path>           Stderr log path
`);
}

function parseArgs(argv) {
  const options = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--write":
        options[arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = true;
        break;
      case "--host":
      case "--port":
      case "--token":
      case "--token-file":
      case "--default-project":
      case "--body-limit-bytes":
      case "--label":
      case "--path":
      case "--stdout-log":
      case "--stderr-log": {
        const value = argv[index + 1];
        if (value == null) {
          throw new Error(`missing value for ${arg}`);
        }
        options[arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = value;
        index += 1;
        break;
      }
      default:
        options._.push(arg);
        break;
    }
  }

  return options;
}

function toPositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function boolFromUnknown(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  }
  return fallback;
}

function trimTrailingNewlines(text) {
  return String(text || "").replace(/\s+$/u, "");
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload, null, 2));
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(left || "", "utf8");
  const rightBuffer = Buffer.from(right || "", "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function bearerTokenFromRequest(req) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  const headerToken = req.headers["x-clawdad-token"];
  return Array.isArray(headerToken) ? headerToken[0] : headerToken || "";
}

async function readBody(req, limitBytes) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > limitBytes) {
      throw new Error(`request body exceeds ${limitBytes} bytes`);
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function resolveToken(options) {
  if (options.token) {
    return String(options.token).trim();
  }

  if (process.env.CLAWDAD_SERVER_TOKEN) {
    return process.env.CLAWDAD_SERVER_TOKEN.trim();
  }

  const tokenFile =
    options.tokenFile ||
    process.env.CLAWDAD_SERVER_TOKEN_FILE ||
    path.join(clawdadHome, "server.token");

  try {
    return (await readFile(tokenFile, "utf8")).trim();
  } catch (error) {
    throw new Error(
      `missing token: pass --token, set CLAWDAD_SERVER_TOKEN, or create ${tokenFile}`,
    );
  }
}

async function runClawdad(args) {
  try {
    const result = await execFileP(clawdadBin, args, {
      cwd: clawdadRoot,
      env: {
        ...process.env,
        CLAWDAD_ROOT: clawdadRoot,
        CLAWDAD_HOME: clawdadHome,
      },
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      ok: true,
      exitCode: 0,
      stdout: trimTrailingNewlines(result.stdout),
      stderr: trimTrailingNewlines(result.stderr),
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: Number(error.code) || 1,
      stdout: trimTrailingNewlines(error.stdout),
      stderr: trimTrailingNewlines(error.stderr || error.message),
    };
  }
}

function projectFromPayload(payload, defaultProject) {
  if (typeof payload.project === "string" && payload.project.trim() !== "") {
    return payload.project.trim();
  }
  return defaultProject || "";
}

async function parseDispatchPayload(req, bodyLimitBytes) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  const rawBody = await readBody(req, bodyLimitBytes);

  if (!rawBody.trim()) {
    return {};
  }

  if (contentType.includes("application/json")) {
    return JSON.parse(rawBody);
  }

  if (contentType.includes("text/plain")) {
    return { message: rawBody };
  }

  throw new Error("unsupported content-type; use application/json or text/plain");
}

async function handleDispatch(req, res, options) {
  let payload;
  try {
    payload = await parseDispatchPayload(req, options.bodyLimitBytes);
  } catch (error) {
    json(res, 400, { ok: false, error: error.message });
    return;
  }

  const project = projectFromPayload(payload, options.defaultProject);
  const message =
    typeof payload.message === "string" ? payload.message.trim() : "";

  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
    return;
  }

  if (!message) {
    json(res, 400, { ok: false, error: "missing message" });
    return;
  }

  const args = ["dispatch", project, message];
  const wait = boolFromUnknown(payload.wait, false);

  if (wait) {
    args.push("--wait");
  }

  if (payload.timeout != null) {
    args.push("--timeout", String(toPositiveInteger(payload.timeout, "timeout")));
  }

  if (typeof payload.model === "string" && payload.model.trim() !== "") {
    args.push("--model", payload.model.trim());
  }

  if (
    typeof payload.permissionMode === "string" &&
    payload.permissionMode.trim() !== ""
  ) {
    args.push("--permission-mode", payload.permissionMode.trim());
  }

  const result = await runClawdad(args);
  const errorText = `${result.stderr}\n${result.stdout}`;
  let statusCode = wait ? 200 : 202;

  if (!result.ok) {
    if (errorText.includes("already has a running dispatch")) {
      statusCode = 409;
    } else if (errorText.includes("not found in ORP workspace")) {
      statusCode = 404;
    } else {
      statusCode = 500;
    }
  }

  json(res, statusCode, {
    ok: result.ok,
    project,
    wait,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}

async function handleRead(req, res, options, url) {
  const project = (url.searchParams.get("project") || options.defaultProject || "").trim();
  if (!project) {
    json(res, 400, { ok: false, error: "missing project and no default project configured" });
    return;
  }

  const args = ["read", project];
  if (boolFromUnknown(url.searchParams.get("raw"), true)) {
    args.push("--raw");
  }

  const result = await runClawdad(args);
  json(res, result.ok ? 200 : 404, {
    ok: result.ok,
    project,
    exitCode: result.exitCode,
    output: result.stdout,
    stderr: result.stderr,
  });
}

async function handleStatus(req, res, options, url) {
  const project = (url.searchParams.get("project") || options.defaultProject || "").trim();
  const args = ["status"];
  if (project) {
    args.push(project);
  }

  const result = await runClawdad(args);
  json(res, result.ok ? 200 : 404, {
    ok: result.ok,
    project: project || null,
    exitCode: result.exitCode,
    output: result.stdout,
    stderr: result.stderr,
  });
}

async function handleList(_req, res, _options, url) {
  const mode = (url.searchParams.get("mode") || "slugs").trim();
  const args = ["list"];

  if (mode === "paths") {
    args.push("--paths");
  } else if (mode === "slugs") {
    args.push("--slugs");
  }

  const result = await runClawdad(args);
  json(res, result.ok ? 200 : 500, {
    ok: result.ok,
    mode,
    exitCode: result.exitCode,
    output: result.stdout,
    items: result.stdout ? result.stdout.split("\n").filter(Boolean) : [],
    stderr: result.stderr,
  });
}

async function runServe(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printUsage();
    return;
  }

  const host = options.host || process.env.CLAWDAD_SERVER_HOST || "127.0.0.1";
  const port = toPositiveInteger(
    options.port || process.env.CLAWDAD_SERVER_PORT || "4477",
    "port",
  );
  const bodyLimitBytes = toPositiveInteger(
    options.bodyLimitBytes ||
      process.env.CLAWDAD_SERVER_BODY_LIMIT_BYTES ||
      "65536",
    "body-limit-bytes",
  );
  const defaultProject =
    options.defaultProject || process.env.CLAWDAD_SERVER_DEFAULT_PROJECT || "";
  const token = await resolveToken(options);

  if (!token) {
    throw new Error("resolved token is empty");
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/healthz") {
      json(res, 200, {
        ok: true,
        service: "clawdad-server",
        version,
        defaultProject: defaultProject || null,
      });
      return;
    }

    if (!constantTimeEqual(bearerTokenFromRequest(req), token)) {
      json(res, 401, { ok: false, error: "unauthorized" });
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/dispatch") {
      await handleDispatch(req, res, { bodyLimitBytes, defaultProject });
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/read") {
      await handleRead(req, res, { defaultProject }, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/status") {
      await handleStatus(req, res, { defaultProject }, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/list") {
      await handleList(req, res, { defaultProject }, url);
      return;
    }

    json(res, 404, { ok: false, error: "not found" });
  });

  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  console.log(
    `clawdad listener ready on http://${host}:${port} (default project: ${defaultProject || "none"})`,
  );
}

function launchAgentPathForLabel(label) {
  return path.join(
    os.homedir(),
    "Library",
    "LaunchAgents",
    `${label}.plist`,
  );
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function plistArray(values) {
  return values
    .map((value) => `    <string>${xmlEscape(value)}</string>`)
    .join("\n");
}

function renderLaunchAgentPlist(options) {
  const host = options.host || process.env.CLAWDAD_SERVER_HOST || "127.0.0.1";
  const port = String(options.port || process.env.CLAWDAD_SERVER_PORT || "4477");
  const tokenFile =
    options.tokenFile ||
    process.env.CLAWDAD_SERVER_TOKEN_FILE ||
    path.join(clawdadHome, "server.token");
  const defaultProject =
    options.defaultProject || process.env.CLAWDAD_SERVER_DEFAULT_PROJECT || "";
  const label = options.label || launchAgentLabelDefault;
  const stdoutLog =
    options.stdoutLog || path.join(clawdadHome, "logs", "server.stdout.log");
  const stderrLog =
    options.stderrLog || path.join(clawdadHome, "logs", "server.stderr.log");

  const args = [
    clawdadBin,
    "serve",
    "--host",
    host,
    "--port",
    port,
    "--token-file",
    tokenFile,
  ];

  if (defaultProject) {
    args.push("--default-project", defaultProject);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
${plistArray(args)}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdoutLog)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderrLog)}</string>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(clawdadRoot)}</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
}

async function runGenToken(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printUsage();
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  if (!options.write) {
    console.log(token);
    return;
  }

  const tokenFile =
    options.tokenFile ||
    process.env.CLAWDAD_SERVER_TOKEN_FILE ||
    path.join(clawdadHome, "server.token");

  await mkdir(path.dirname(tokenFile), { recursive: true });
  await writeFile(tokenFile, `${token}\n`, "utf8");
  await chmod(tokenFile, 0o600);

  console.log(`wrote token to ${tokenFile}`);
}

async function runPrintLaunchAgent(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printUsage();
    return;
  }

  console.log(renderLaunchAgentPlist(options));
}

async function runInstallLaunchAgent(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printUsage();
    return;
  }

  const label = options.label || launchAgentLabelDefault;
  const launchAgentPath = options.path || launchAgentPathForLabel(label);
  const stdoutLog =
    options.stdoutLog || path.join(clawdadHome, "logs", "server.stdout.log");
  const stderrLog =
    options.stderrLog || path.join(clawdadHome, "logs", "server.stderr.log");

  await mkdir(path.dirname(launchAgentPath), { recursive: true });
  await mkdir(path.dirname(stdoutLog), { recursive: true });
  await mkdir(path.dirname(stderrLog), { recursive: true });
  await writeFile(launchAgentPath, renderLaunchAgentPlist(options), "utf8");

  console.log(`wrote launch agent to ${launchAgentPath}`);
  console.log(`next: launchctl bootstrap gui/$(id -u) ${launchAgentPath}`);
  console.log(`then: launchctl kickstart -k gui/$(id -u)/${label}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "serve":
      await runServe(rest);
      break;
    case "gen-token":
      await runGenToken(rest);
      break;
    case "print-launch-agent":
      await runPrintLaunchAgent(rest);
      break;
    case "install-launch-agent":
      await runInstallLaunchAgent(rest);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      throw new Error(`unknown server helper command: ${command}`);
  }
}

await main();
