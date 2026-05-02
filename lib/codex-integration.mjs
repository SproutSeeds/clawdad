import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { appendFile, chmod, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

export const codexIntegrationPluginName = "clawdad-codex-integration";
export const codexIntegrationSkillNames = Object.freeze([
  "clawdad-delegate",
  "clawdad-supervisor",
  "clawdad-watchtower-review",
  "clawdad-session-doctor",
  "clawdad-release",
  "clawdad-incident-triage",
]);

const managedBegin = "<!-- BEGIN CLAWDAD CODEX INTEGRATION -->";
const managedEnd = "<!-- END CLAWDAD CODEX INTEGRATION -->";
const managedTextMarker = "Managed by Clawdad Codex Integration.";
const hookScriptName = "clawdad-hook.mjs";
const execFileP = promisify(execFile);

function pickString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return "";
}

function expandHomePath(value) {
  const trimmed = String(value || "").trim();
  if (trimmed === "~") {
    return os.homedir();
  }
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function pathInsideRoot(rootPath, targetPath) {
  const normalizedRoot = path.resolve(String(rootPath || ""));
  const normalizedTarget = path.resolve(String(targetPath || ""));
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}

export async function normalizeProjectPath(projectPath) {
  const expanded = expandHomePath(projectPath || process.cwd());
  const resolved = path.resolve(expanded || ".");
  const canonical = await realpath(resolved);
  const info = await stat(canonical);
  if (!info.isDirectory()) {
    throw new Error(`project path is not a directory: ${projectPath}`);
  }
  return canonical;
}

async function readOptionalText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function readOptionalJson(filePath) {
  const text = await readOptionalText(filePath);
  if (!text.trim()) {
    return null;
  }
  return JSON.parse(text);
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function writeAtomicTextFile(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, contents, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function writeJsonFile(filePath, payload) {
  await writeAtomicTextFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function check(status, label, detail, extra = {}) {
  return { status, label, detail, ...extra };
}

function parseCodexCliVersion(text = "") {
  const match = String(text || "").match(/(\d+)\.(\d+)\.(\d+)/u);
  if (!match) {
    return null;
  }
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    text: match[0],
  };
}

function codexVersionAtLeast(version, targetMajor, targetMinor, targetPatch = 0) {
  if (!version) {
    return false;
  }
  if (version.major !== targetMajor) {
    return version.major > targetMajor;
  }
  if (version.minor !== targetMinor) {
    return version.minor > targetMinor;
  }
  return version.patch >= targetPatch;
}

function normalizeGoalMode(value) {
  const mode = String(value || "auto").trim().toLowerCase();
  return ["auto", "off", "required"].includes(mode) ? mode : "auto";
}

async function codexGoalSupportCheck(codexBinary = process.env.CLAWDAD_CODEX || "codex") {
  const mode = normalizeGoalMode(process.env.CLAWDAD_CODEX_GOALS);
  let versionOutput = "";
  try {
    const result = await execFileP(codexBinary, ["--version"], {
      timeout: 5000,
      maxBuffer: 256 * 1024,
    });
    versionOutput = `${result.stdout || ""}${result.stderr || ""}`.trim();
  } catch (error) {
    return check(
      mode === "required" ? "fail" : "warn",
      "Codex goal API",
      `could not run ${codexBinary} --version; /goal sync will fall back in auto mode`,
      { goalMode: mode, codexBinary, error: error.message },
    );
  }
  const parsed = parseCodexCliVersion(versionOutput);
  const supportsGoals = codexVersionAtLeast(parsed, 0, 128, 0);
  if (mode === "off") {
    return check("warn", "Codex goal API", `goal sync disabled; installed ${versionOutput || "unknown"}`, {
      goalMode: mode,
      codexBinary,
      codexVersion: parsed?.text || null,
      supportsGoals,
    });
  }
  if (!supportsGoals) {
    return check(
      mode === "required" ? "fail" : "warn",
      "Codex goal API",
      `installed ${versionOutput || "unknown"}; Clawdad /goal sync needs codex-cli 0.128.0 or newer`,
      {
        goalMode: mode,
        codexBinary,
        codexVersion: parsed?.text || null,
        supportsGoals: false,
      },
    );
  }
  return check("pass", "Codex goal API", `installed ${versionOutput}; app-server /goal sync is available`, {
    goalMode: mode,
    codexBinary,
    codexVersion: parsed?.text || null,
    supportsGoals: true,
  });
}

function operation(action, filePath, detail = "") {
  return { action, path: filePath, detail };
}

function managedBlock(body) {
  return `${managedBegin}\n${body.trim()}\n${managedEnd}\n`;
}

function replaceOrAppendManagedBlock(existingText, blockText) {
  const start = existingText.indexOf(managedBegin);
  const end = existingText.indexOf(managedEnd);
  if (start >= 0 && end > start) {
    const before = existingText.slice(0, start).replace(/\s*$/u, "");
    const after = existingText.slice(end + managedEnd.length).replace(/^\s*/u, "");
    return [before, blockText.trimEnd(), after].filter(Boolean).join("\n\n") + "\n";
  }
  return `${existingText.replace(/\s*$/u, "")}${existingText.trim() ? "\n\n" : ""}${blockText}`;
}

async function writeManagedTextFile(filePath, contents, { dryRun = false, force = false, executable = false } = {}) {
  const existing = await readOptionalText(filePath);
  const exists = existing !== "";
  const managed =
    existing.includes(managedTextMarker) ||
    existing.includes(managedBegin) ||
    existing.includes('"x-clawdadManaged": true');
  if (exists && !managed && !force) {
    return operation("skipped", filePath, "existing unmanaged file");
  }
  if (existing === contents) {
    if (executable && !dryRun) {
      await chmod(filePath, 0o755).catch(() => {});
    }
    return operation("unchanged", filePath);
  }
  if (!dryRun) {
    await writeAtomicTextFile(filePath, contents);
    if (executable) {
      await chmod(filePath, 0o755);
    }
  }
  return operation(dryRun ? "would_write" : exists ? "updated" : "created", filePath);
}

async function upsertManagedBlockFile(filePath, blockText, { dryRun = false } = {}) {
  const existing = await readOptionalText(filePath);
  const next = replaceOrAppendManagedBlock(existing, blockText);
  if (existing === next) {
    return operation("unchanged", filePath);
  }
  if (!dryRun) {
    await writeAtomicTextFile(filePath, next);
  }
  return operation(dryRun ? "would_write" : existing ? "updated" : "created", filePath);
}

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

export function codexIntegrationPaths(projectPath) {
  const root = path.resolve(projectPath);
  const pluginRoot = path.join(root, "plugins", codexIntegrationPluginName);
  return {
    root,
    agentsFile: path.join(root, "AGENTS.md"),
    codexConfig: path.join(root, ".codex", "config.toml"),
    hooksJson: path.join(root, ".codex", "hooks.json"),
    hookScript: path.join(root, ".codex", "hooks", hookScriptName),
    repoSkillsRoot: path.join(root, ".agents", "skills"),
    marketplaceJson: path.join(root, ".agents", "plugins", "marketplace.json"),
    pluginRoot,
    pluginManifest: path.join(pluginRoot, ".codex-plugin", "plugin.json"),
    pluginHooksJson: path.join(pluginRoot, "hooks", "hooks.json"),
  };
}

function renderHookCommand(projectPath) {
  const hookPath = path.join(projectPath, ".codex", "hooks", hookScriptName);
  if (path.resolve(projectPath) === path.resolve(process.cwd())) {
    return `node .codex/hooks/${hookScriptName}`;
  }
  return `node ${shellSingleQuote(hookPath)}`;
}

export function renderProjectHooksJson(projectPath) {
  const command = renderHookCommand(projectPath);
  const hook = (statusMessage, timeout = 10) => [{ type: "command", command, timeout, statusMessage }];
  return {
    hooks: {
      SessionStart: [
        {
          matcher: "startup|resume|clear",
          hooks: hook("Loading Clawdad context"),
        },
      ],
      PreToolUse: [
        {
          matcher: "Bash|apply_patch|Edit|Write",
          hooks: hook("Checking Clawdad guardrails", 15),
        },
      ],
      PermissionRequest: [
        {
          matcher: "Bash|apply_patch|Edit|Write",
          hooks: hook("Adding Clawdad approval context", 15),
        },
      ],
      PostToolUse: [
        {
          matcher: "Bash|apply_patch|Edit|Write",
          hooks: hook("Recording Clawdad tool signal", 15),
        },
      ],
    },
  };
}

function renderPluginHooksJson() {
  const hook = (statusMessage, timeout = 10) => [
    { type: "command", command: "clawdad codex hook", timeout, statusMessage },
  ];
  return {
    hooks: {
      SessionStart: [{ matcher: "startup|resume|clear", hooks: hook("Loading Clawdad context") }],
      PreToolUse: [{ matcher: "Bash|apply_patch|Edit|Write", hooks: hook("Checking Clawdad guardrails", 15) }],
      PermissionRequest: [{ matcher: "Bash|apply_patch|Edit|Write", hooks: hook("Adding Clawdad approval context", 15) }],
      PostToolUse: [{ matcher: "Bash|apply_patch|Edit|Write", hooks: hook("Recording Clawdad tool signal", 15) }],
    },
  };
}

function hookGroupHasClawdadCommand(group) {
  return Array.isArray(group?.hooks)
    ? group.hooks.some((entry) => String(entry?.command || "").includes("clawdad") || String(entry?.command || "").includes(hookScriptName))
    : false;
}

function mergeHooksJson(existing, incoming) {
  const next = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  const existingHooks = next.hooks && typeof next.hooks === "object" && !Array.isArray(next.hooks) ? next.hooks : {};
  next.hooks = { ...existingHooks };
  for (const [eventName, groups] of Object.entries(incoming.hooks || {})) {
    const existingGroups = Array.isArray(next.hooks[eventName]) ? next.hooks[eventName] : [];
    next.hooks[eventName] = [
      ...existingGroups.filter((group) => !hookGroupHasClawdadCommand(group)),
      ...groups,
    ];
  }
  return next;
}

async function upsertHooksJson(filePath, incoming, { dryRun = false } = {}) {
  const existing = await readOptionalJson(filePath).catch((error) => {
    throw new Error(`failed to parse ${filePath}: ${error.message}`);
  });
  const next = mergeHooksJson(existing, incoming);
  const nextText = `${JSON.stringify(next, null, 2)}\n`;
  const existingText = await readOptionalText(filePath);
  if (existingText === nextText) {
    return operation("unchanged", filePath);
  }
  if (!dryRun) {
    await writeJsonFile(filePath, next);
  }
  return operation(dryRun ? "would_write" : existingText ? "updated" : "created", filePath);
}

function renderHookScript(clawdadBin = "clawdad", projectPath = process.cwd()) {
  const preferredCommand = pickString(clawdadBin, "clawdad");
  const preferredIsProjectLocal =
    path.isAbsolute(preferredCommand) && pathInsideRoot(projectPath, preferredCommand);
  const preferredCandidate = preferredCommand === "clawdad" || preferredIsProjectLocal
    ? "null"
    : JSON.stringify(preferredCommand);
  return `#!/usr/bin/env node
// ${managedTextMarker}
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hookDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(hookDir, "..", "..");

const candidates = [
  process.env.CLAWDAD_BIN,
  path.join(projectRoot, "bin", "clawdad"),
  ${preferredCandidate},
  "clawdad",
].filter(Boolean);

function runCandidate(index = 0) {
  const command = candidates[index];
  if (!command) {
    process.exit(0);
  }
  const child = spawn(command, ["codex", "hook"], {
    stdio: ["inherit", "inherit", "inherit"],
    env: {
      ...process.env,
      CLAWDAD_HOOK_PROJECT: process.cwd(),
    },
  });

  child.once("error", (error) => {
    if (error.code === "ENOENT" && index + 1 < candidates.length) {
      runCandidate(index + 1);
      return;
    }
    console.error(\`[clawdad-hook] skipped: \${error.message}\`);
    process.exit(0);
  });

  child.once("exit", (code) => {
    process.exit(code ?? 0);
  });
}

runCandidate();
`;
}

function renderCodexConfigToml() {
  return `# ${managedTextMarker}
# Project-scoped Codex config. Codex loads this only after the project is trusted.
[features]
codex_hooks = true
`;
}

function renderAgentsBlock() {
  return managedBlock(`
## Clawdad + Codex

- Treat Clawdad as the orchestration layer: one supervisor process steers one delegate session, while Watchtower supplies review signals.
- Use Clawdad skills for Clawdad-specific workflows instead of packing long workflow rules into every prompt.
- Use hooks as deterministic guardrails and telemetry. They should record context, enrich approvals, and block only hard-risk tool actions.
- Soft Watchtower findings should become corrective next-step prompts. Only hard stops should pause the work: patient data, medical advice, outreach, money, credentials, legal/regulatory/human gates, and compute exhaustion.
- When Clawdad state looks wrong, run \`clawdad codex doctor .\` and \`clawdad sessions-doctor --repair\` before inventing a new session model.
`);
}

function skillFrontmatter(name, description) {
  return `---
name: ${name}
description: ${description}
---

`;
}

function renderSkill(name) {
  const bodies = {
    "clawdad-delegate": {
      description: "Use when acting as a Clawdad delegate session for repo work, including bounded implementation, validation, and hard-stop reporting.",
      body: `You are the single delegate worker for the active Clawdad run.

Follow this workflow:

1. Read the active request, repo instructions, and current Clawdad status before editing.
2. Keep changes scoped to the active lane/objective and preserve unrelated user edits.
3. If validation fails, repair validation in the same session before asking to stop.
4. Treat Watchtower soft findings as corrective guidance, not as a reason to stop.
5. Stop only for hard stops: patient data, medical advice, outreach, money, credentials, legal/regulatory/human gate, or compute exhaustion.
6. Report the final state with changed files, validation run, and any remaining blocker.
`,
    },
    "clawdad-supervisor": {
      description: "Use when supervising a Clawdad delegate lane, converting soft review signals into next prompts and preserving hard safety stops.",
      body: `Act as the Clawdad supervisor, not as a second competing implementer.

Responsibilities:

1. Inspect delegate status, latest outcome, Watchtower cards, validation, ORP/catalog state, and compute guard state.
2. If the delegate drifts, write a concise corrective next action for the same delegate session.
3. If validation fails, ask the delegate to repair validation.
4. If catalog or ORP state drifts, ask the delegate to reconcile state.
5. If a large diff is otherwise valid, checkpoint and continue.
6. Stop only for hard safety gates or compute exhaustion.
`,
    },
    "clawdad-watchtower-review": {
      description: "Use when interpreting Clawdad Watchtower review cards, especially soft versus hard findings in enforce mode.",
      body: `Review Watchtower output as policy signal.

Classify findings this way:

1. Hard stop: patient data, medical advice, outreach, money, credentials, legal/regulatory/human gate, or compute exhaustion.
2. Corrective soft finding: validation failure, hygiene repair, unknown review card, unvalidated large diff, or state drift.
3. Informational finding: healthy progress, validated checkpoint, summary-only event.

For hard stops, preserve the pause and explain the gate.
For soft findings, produce the next corrective prompt for the delegate.
`,
    },
    "clawdad-session-doctor": {
      description: "Use when diagnosing Clawdad/Codex project session IDs, imported sessions, stale active pointers, quarantines, and delegate lane bindings.",
      body: `Diagnose Clawdad session state with the registry as the source of truth.

Steps:

1. Run or inspect \`clawdad sessions-doctor [project] --json\`.
2. Check active session IDs, provider metadata, imported Codex sessions, quarantined sessions, and delegate lane bindings.
3. Prefer non-destructive repair with \`clawdad sessions-doctor --repair\`.
4. Do not reuse quarantined or non-native Codex IDs.
5. After repair, verify the active session points at a real provider session for the project path.
`,
    },
    "clawdad-release": {
      description: "Use when cutting, publishing, installing, and verifying a Clawdad release across npm, git tags, GitHub releases, and the local service.",
      body: `Use the Clawdad release path deliberately.

Checklist:

1. Confirm the worktree diff and version bump.
2. Run syntax checks and the full test suite.
3. Update package metadata and docs when needed.
4. Commit, tag, push branch and tag.
5. Publish the npm package and create/update the GitHub release.
6. Install the published package globally.
7. Restart the Clawdad service and verify \`clawdad version\`, \`clawdad sessions-doctor --json\`, and service health.
`,
    },
    "clawdad-incident-triage": {
      description: "Use when Clawdad failures, repeated failed messages, Watchtower pauses, session import issues, or delegate stalls need root-cause triage.",
      body: `Triage Clawdad incidents from signals to root cause.

Steps:

1. Capture the exact failed command, project path, session ID, run ID, lane ID, and timestamp.
2. Inspect Clawdad state, delegate status, mailbox status, Watchtower feed, and recent run events.
3. Separate transport/session binding failures from delegate semantic failures.
4. Check whether a soft Watchtower finding was incorrectly treated as a pause.
5. Apply the smallest generalized fix and add regression coverage.
6. Verify the fix with doctor commands and a targeted live or test run.
`,
    },
  };

  const entry = bodies[name];
  if (!entry) {
    throw new Error(`unknown Clawdad skill: ${name}`);
  }
  return `${skillFrontmatter(name, entry.description)}<!-- ${managedTextMarker} -->\n\n${entry.body}`;
}

function renderPluginManifest(version = "0.0.0") {
  return {
    name: codexIntegrationPluginName,
    version,
    description: "Clawdad workflows, hooks, and guardrails for Codex projects.",
    "x-clawdadManaged": true,
    author: {
      name: "SproutSeeds",
      url: "https://github.com/SproutSeeds/clawdad",
    },
    repository: "https://github.com/SproutSeeds/clawdad",
    license: "MIT",
    keywords: ["codex", "clawdad", "delegation", "hooks", "skills"],
    skills: "./skills/",
    hooks: "./hooks/hooks.json",
    interface: {
      displayName: "Clawdad Codex Integration",
      shortDescription: "Clawdad delegation skills and Codex hook guardrails.",
      longDescription: "Adds Clawdad delegate, supervisor, Watchtower, session doctor, release, and incident triage workflows to Codex.",
      developerName: "SproutSeeds",
      category: "Productivity",
      capabilities: ["Read", "Write"],
      websiteURL: "https://github.com/SproutSeeds/clawdad",
      brandColor: "#C73433",
      defaultPrompt: [
        "Use Clawdad to triage this delegate failure.",
        "Use Clawdad to supervise this Watchtower finding.",
      ],
    },
  };
}

function mergeMarketplace(existing) {
  const next = existing && typeof existing === "object" && !Array.isArray(existing)
    ? { ...existing }
    : {};
  next.name = pickString(next.name, "clawdad-local-plugins");
  next.interface = {
    ...(next.interface && typeof next.interface === "object" && !Array.isArray(next.interface) ? next.interface : {}),
    displayName: pickString(next.interface?.displayName, "Clawdad Local Plugins"),
  };
  const plugins = Array.isArray(next.plugins) ? next.plugins : [];
  const entry = {
    name: codexIntegrationPluginName,
    source: {
      source: "local",
      path: `./plugins/${codexIntegrationPluginName}`,
    },
    policy: {
      installation: "AVAILABLE",
      authentication: "ON_INSTALL",
    },
    category: "Productivity",
  };
  next.plugins = [
    ...plugins.filter((plugin) => String(plugin?.name || "") !== codexIntegrationPluginName),
    entry,
  ];
  return next;
}

async function upsertMarketplace(filePath, { dryRun = false } = {}) {
  const existing = await readOptionalJson(filePath).catch((error) => {
    throw new Error(`failed to parse ${filePath}: ${error.message}`);
  });
  const next = mergeMarketplace(existing);
  const nextText = `${JSON.stringify(next, null, 2)}\n`;
  const existingText = await readOptionalText(filePath);
  if (existingText === nextText) {
    return operation("unchanged", filePath);
  }
  if (!dryRun) {
    await writeJsonFile(filePath, next);
  }
  return operation(dryRun ? "would_write" : existingText ? "updated" : "created", filePath);
}

async function writeSkillSet(root, { dryRun = false, force = false } = {}) {
  const operations = [];
  for (const skillName of codexIntegrationSkillNames) {
    const filePath = path.join(root, skillName, "SKILL.md");
    operations.push(
      await writeManagedTextFile(filePath, renderSkill(skillName), {
        dryRun,
        force,
      }),
    );
  }
  return operations;
}

export async function installCodexIntegration({
  projectPath,
  codexHome = path.join(os.homedir(), ".codex"),
  clawdadBin = "clawdad",
  version = "0.0.0",
  dryRun = false,
  force = false,
} = {}) {
  const normalizedProjectPath = await normalizeProjectPath(projectPath || process.cwd());
  const paths = codexIntegrationPaths(normalizedProjectPath);
  const operations = [];

  operations.push(await upsertManagedBlockFile(paths.agentsFile, renderAgentsBlock(), { dryRun }));

  const configExisting = await readOptionalText(paths.codexConfig);
  if (!configExisting || configExisting.includes(managedTextMarker)) {
    operations.push(
      await writeManagedTextFile(paths.codexConfig, renderCodexConfigToml(), {
        dryRun,
        force,
      }),
    );
  } else {
    operations.push(operation("skipped", paths.codexConfig, "existing unmanaged config.toml"));
  }

  operations.push(await upsertHooksJson(paths.hooksJson, renderProjectHooksJson(normalizedProjectPath), { dryRun }));
  operations.push(
    await writeManagedTextFile(paths.hookScript, renderHookScript(clawdadBin, normalizedProjectPath), {
      dryRun,
      force,
      executable: true,
    }),
  );
  operations.push(...await writeSkillSet(paths.repoSkillsRoot, { dryRun, force }));
  operations.push(await upsertMarketplace(paths.marketplaceJson, { dryRun }));
  operations.push(
    await writeManagedTextFile(paths.pluginManifest, `${JSON.stringify(renderPluginManifest(version), null, 2)}\n`, {
      dryRun,
      force,
    }),
  );
  operations.push(await upsertHooksJson(paths.pluginHooksJson, renderPluginHooksJson(), { dryRun }));
  operations.push(...await writeSkillSet(path.join(paths.pluginRoot, "skills"), { dryRun, force }));

  const report = await buildCodexIntegrationReport({
    projectPath: normalizedProjectPath,
    codexHome,
  });
  return {
    ok: report.ok,
    projectPath: normalizedProjectPath,
    dryRun,
    operations,
    report,
  };
}

function hooksJsonHasClawdad(payload) {
  return JSON.stringify(payload || {}).includes(hookScriptName) || JSON.stringify(payload || {}).includes("clawdad codex hook");
}

async function directorySkillFiles(root) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name, "SKILL.md"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function skillFileLooksValid(filePath, skillName) {
  const text = await readOptionalText(filePath);
  return text.includes(`name: ${skillName}`) && text.includes("description:");
}

async function codexProjectTrustCheck(codexHome, projectPath) {
  const configPath = path.join(codexHome, "config.toml");
  const text = await readOptionalText(configPath).catch(() => "");
  if (!text.trim()) {
    return check("warn", "Codex project trust", "Codex user config not found; project-local hooks load after the project is trusted");
  }
  const escapedProject = projectPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const projectPattern = new RegExp(`\\[projects\\.${JSON.stringify(projectPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\][\\s\\S]*?trust_level\\s*=\\s*["']trusted["']`, "u");
  const loosePattern = new RegExp(`${escapedProject}[\\s\\S]{0,240}trust_level\\s*=\\s*["']trusted["']`, "u");
  if (projectPattern.test(text) || loosePattern.test(text)) {
    return check("pass", "Codex project trust", "project appears trusted in Codex config");
  }
  return check("warn", "Codex project trust", "project-local .codex config loads only after this project is trusted in Codex");
}

export async function buildCodexIntegrationReport({
  projectPath,
  codexHome = path.join(os.homedir(), ".codex"),
} = {}) {
  const normalizedProjectPath = await normalizeProjectPath(projectPath || process.cwd());
  const paths = codexIntegrationPaths(normalizedProjectPath);
  const checks = [];

  checks.push(check("pass", "Project path", normalizedProjectPath));

  const agentsText = await readOptionalText(paths.agentsFile);
  checks.push(
    agentsText.includes(managedBegin)
      ? check("pass", "AGENTS.md", "Clawdad guidance is installed")
      : check("warn", "AGENTS.md", "Clawdad guidance block is missing"),
  );

  const configText = await readOptionalText(paths.codexConfig);
  if (!configText.trim()) {
    checks.push(check("warn", "Codex config", ".codex/config.toml is missing"));
  } else if (/codex_hooks\s*=\s*false/u.test(configText)) {
    checks.push(check("fail", "Codex hooks feature", ".codex/config.toml disables codex_hooks"));
  } else {
    checks.push(check("pass", "Codex config", ".codex/config.toml is present"));
  }

  const hooksJson = await readOptionalJson(paths.hooksJson).catch(() => null);
  checks.push(
    hooksJsonHasClawdad(hooksJson)
      ? check("pass", "Codex hooks", "Clawdad lifecycle hooks are configured")
      : check("fail", "Codex hooks", ".codex/hooks.json is missing Clawdad hooks"),
  );

  const hookScriptPresent = await fileExists(paths.hookScript);
  checks.push(
    hookScriptPresent
      ? check("pass", "Hook runner", paths.hookScript)
      : check("fail", "Hook runner", `${paths.hookScript} is missing`),
  );

  const repoSkillFiles = await directorySkillFiles(paths.repoSkillsRoot);
  for (const skillName of codexIntegrationSkillNames) {
    const skillFile = path.join(paths.repoSkillsRoot, skillName, "SKILL.md");
    checks.push(
      repoSkillFiles.includes(skillFile) && await skillFileLooksValid(skillFile, skillName)
        ? check("pass", `Skill ${skillName}`, "repo skill installed")
        : check("fail", `Skill ${skillName}`, `${skillFile} is missing or invalid`),
    );
  }

  const marketplace = await readOptionalJson(paths.marketplaceJson).catch(() => null);
  const marketplaceHasPlugin = Array.isArray(marketplace?.plugins)
    ? marketplace.plugins.some((plugin) => String(plugin?.name || "") === codexIntegrationPluginName)
    : false;
  checks.push(
    marketplaceHasPlugin
      ? check("pass", "Plugin marketplace", "local marketplace exposes Clawdad integration")
      : check("warn", "Plugin marketplace", "local marketplace entry is missing"),
  );

  const manifest = await readOptionalJson(paths.pluginManifest).catch(() => null);
  checks.push(
    manifest?.name === codexIntegrationPluginName
      ? check("pass", "Plugin manifest", "Clawdad integration plugin is packaged")
      : check("warn", "Plugin manifest", `${paths.pluginManifest} is missing or invalid`),
  );

  checks.push(await codexProjectTrustCheck(codexHome, normalizedProjectPath));
  checks.push(await codexGoalSupportCheck());

  const failCount = checks.filter((entry) => entry.status === "fail").length;
  const warnCount = checks.filter((entry) => entry.status === "warn").length;
  return {
    ok: failCount === 0,
    projectPath: normalizedProjectPath,
    codexHome,
    failCount,
    warnCount,
    checks,
  };
}

function hookInputToolCommand(input = {}) {
  const toolInput = input.tool_input || input.toolInput || {};
  if (typeof toolInput.command === "string") {
    return toolInput.command;
  }
  if (typeof toolInput.cmd === "string") {
    return toolInput.cmd;
  }
  if (typeof toolInput === "string") {
    return toolInput;
  }
  return "";
}

function compactCommand(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function commandMatchesAny(command, patterns) {
  return patterns.some((pattern) => pattern.test(command));
}

function classifyHookCommandRisk(input = {}) {
  const eventName = String(input.hook_event_name || input.hookEventName || "").trim();
  const toolName = String(input.tool_name || input.toolName || "").trim();
  const command = hookInputToolCommand(input);
  const normalized = compactCommand(command);
  const hardPatterns = [
    /\brm\s+-[^\n;&|]*[rf][^\n;&|]*\s+(?:\/|~|\$HOME)(?:\s|$)/iu,
    /\bgit\s+reset\s+--hard\b/iu,
    /\bgit\s+clean\s+-[^\n;&|]*[xdf][^\n;&|]*/iu,
    /\b(?:cat|sed|grep|awk|base64|openssl)\b[^\n;&|]*(?:~\/\.ssh|\/\.ssh\/|~\/\.codex\/auth\.json|\/\.codex\/auth\.json|\.env(?:\s|$))/iu,
    /\b(?:curl|wget|nc|netcat)\b[^\n]*(?:~\/\.ssh|\/\.ssh\/|~\/\.codex\/auth\.json|\/\.codex\/auth\.json|\.env(?:\s|$))/iu,
    /\*\*\*\s+(?:Add|Update)\s+File:\s*(?:\.env|.*\/\.env|.*id_rsa|.*auth\.json)/iu,
  ];
  if (commandMatchesAny(command, hardPatterns)) {
    return {
      level: "hard",
      reason: "Blocked by Clawdad hard guardrail: destructive state reset or credential exposure risk.",
      command: normalized,
      eventName,
      toolName,
    };
  }

  const softPatterns = [
    /\b(?:npm|pnpm|yarn)\s+publish\b/iu,
    /\bgit\s+push\b/iu,
    /\b(?:gh|glab)\s+release\s+create\b/iu,
    /\bgit\s+tag\b/iu,
    /\bsudo\b/iu,
    /\bchmod\s+-R\b/iu,
    /\bchown\s+-R\b/iu,
  ];
  if (commandMatchesAny(command, softPatterns)) {
    return {
      level: "soft",
      reason: "Clawdad noticed a release, publish, privilege, or broad-permission action; confirm this is intentional and validated.",
      command: normalized,
      eventName,
      toolName,
    };
  }

  return {
    level: "none",
    reason: "",
    command: normalized,
    eventName,
    toolName,
  };
}

function hookOutputForRisk(input, risk) {
  const eventName = risk.eventName;
  if (risk.level !== "hard" && risk.level !== "soft") {
    return null;
  }
  if (eventName === "PreToolUse" && risk.level === "hard") {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: risk.reason,
      },
    };
  }
  if (eventName === "PermissionRequest" && risk.level === "hard") {
    return {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "deny",
          message: risk.reason,
        },
      },
    };
  }
  if (eventName === "PreToolUse" || eventName === "PermissionRequest") {
    return {
      systemMessage: risk.reason,
    };
  }
  return null;
}

function hookAdditionalContext(input = {}) {
  const eventName = String(input.hook_event_name || input.hookEventName || "").trim();
  if (eventName !== "SessionStart") {
    return null;
  }
  return {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: [
        "Clawdad Codex integration is active for this project.",
        "Use Clawdad skills for delegate, supervisor, Watchtower, session doctor, release, and incident triage workflows.",
        "Hooks are advisory guardrails except for hard-risk tool actions.",
      ].join(" "),
    },
  };
}

function summarizeToolResponse(input = {}) {
  const response = input.tool_response || input.toolResponse || {};
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return {};
  }
  const exitCode = Number.parseInt(String(response.exitCode ?? response.exit_code ?? ""), 10);
  const stderr = pickString(response.stderr, response.error);
  return {
    exitCode: Number.isFinite(exitCode) ? exitCode : null,
    stderr: stderr ? stderr.slice(0, 500) : "",
  };
}

export function evaluateCodexHookInput(input = {}) {
  const eventName = String(input.hook_event_name || input.hookEventName || "").trim();
  const risk = classifyHookCommandRisk(input);
  const response = hookOutputForRisk(input, risk) || hookAdditionalContext(input);
  const toolResponse = summarizeToolResponse(input);
  const record = {
    at: new Date().toISOString(),
    eventName,
    sessionId: pickString(input.session_id, input.sessionId),
    turnId: pickString(input.turn_id, input.turnId),
    toolName: pickString(input.tool_name, input.toolName),
    cwd: pickString(input.cwd),
    riskLevel: risk.level,
    reason: risk.reason,
    command: risk.command ? risk.command.slice(0, 1000) : "",
    ...toolResponse,
  };
  return {
    response,
    record,
    risk,
  };
}

async function appendHookRecord(projectPath, record) {
  const normalizedProjectPath = await normalizeProjectPath(projectPath || record.cwd || process.cwd()).catch(() => "");
  if (!normalizedProjectPath) {
    return;
  }
  const logPath = path.join(normalizedProjectPath, ".clawdad", "codex-hooks", "events.jsonl");
  if (!pathInsideRoot(normalizedProjectPath, logPath)) {
    return;
  }
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8");
}

export async function handleCodexHookInput(input = {}, { projectPath = "" } = {}) {
  const evaluated = evaluateCodexHookInput(input);
  await appendHookRecord(projectPath || input.cwd || process.env.CLAWDAD_HOOK_PROJECT || process.cwd(), evaluated.record).catch(() => {});
  return evaluated.response;
}
