import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  buildCodexIntegrationReport,
  codexIntegrationPaths,
  codexIntegrationSkillNames,
  evaluateCodexHookInput,
  handleCodexHookInput,
  installCodexIntegration,
} from "../lib/codex-integration.mjs";

const execFileP = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = path.join(repoRoot, "lib", "server.mjs");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 5_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`server exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error("server did not become healthy");
}

async function stopServer(child) {
  if (child.exitCode != null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function withTempProject(work) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-codex-integration-"));
  const projectPath = path.join(root, "project");
  const codexHome = path.join(root, "codex-home");
  await mkdir(projectPath, { recursive: true });
  await mkdir(codexHome, { recursive: true });
  try {
    return await work({ root, projectPath, codexHome });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("codex integration install writes hooks, skills, plugin, marketplace, and AGENTS guidance", async () => {
  await withTempProject(async ({ projectPath, codexHome }) => {
    const result = await installCodexIntegration({
      projectPath,
      codexHome,
      version: "9.9.9",
    });
    assert.equal(result.ok, true);

    const paths = codexIntegrationPaths(projectPath);
    const hooks = JSON.parse(await readFile(paths.hooksJson, "utf8"));
    assert.match(JSON.stringify(hooks), /clawdad-hook\.mjs/u);
    assert.match(await readFile(paths.agentsFile, "utf8"), /BEGIN CLAWDAD CODEX INTEGRATION/u);
    assert.match(await readFile(paths.codexConfig, "utf8"), /codex_hooks = true/u);
    await stat(paths.hookScript);

    for (const skillName of codexIntegrationSkillNames) {
      const repoSkill = await readFile(path.join(paths.repoSkillsRoot, skillName, "SKILL.md"), "utf8");
      const pluginSkill = await readFile(path.join(paths.pluginRoot, "skills", skillName, "SKILL.md"), "utf8");
      assert.match(repoSkill, new RegExp(`name: ${skillName}`, "u"));
      assert.match(pluginSkill, new RegExp(`name: ${skillName}`, "u"));
    }

    const marketplace = JSON.parse(await readFile(paths.marketplaceJson, "utf8"));
    assert.ok(marketplace.plugins.some((plugin) => plugin.name === "clawdad-codex-integration"));
    const manifest = JSON.parse(await readFile(paths.pluginManifest, "utf8"));
    assert.equal(manifest.name, "clawdad-codex-integration");
    assert.equal(manifest.version, "9.9.9");

    const reinstall = await installCodexIntegration({
      projectPath,
      codexHome,
      version: "9.9.10",
    });
    const manifestOperation = reinstall.operations.find((entry) => entry.path.endsWith(`${path.sep}.codex-plugin${path.sep}plugin.json`));
    assert.notEqual(manifestOperation?.action, "skipped");
    assert.equal(JSON.parse(await readFile(paths.pluginManifest, "utf8")).version, "9.9.10");

    const report = await buildCodexIntegrationReport({ projectPath, codexHome });
    assert.equal(report.ok, true);
    assert.equal(report.failCount, 0);
  });
});

test("codex integration install preserves an unmanaged config.toml", async () => {
  await withTempProject(async ({ projectPath, codexHome }) => {
    const paths = codexIntegrationPaths(projectPath);
    await mkdir(path.dirname(paths.codexConfig), { recursive: true });
    await writeFile(paths.codexConfig, "model = \"gpt-5.5\"\n", "utf8");

    const result = await installCodexIntegration({ projectPath, codexHome });
    assert.equal(await readFile(paths.codexConfig, "utf8"), "model = \"gpt-5.5\"\n");
    const normalizedConfigPath = path.join(await realpath(projectPath), ".codex", "config.toml");
    assert.ok(result.operations.some((entry) => entry.path === normalizedConfigPath && entry.action === "skipped"));
    assert.equal((await buildCodexIntegrationReport({ projectPath, codexHome })).failCount, 0);
  });
});

test("codex hook evaluation denies hard-risk commands and only annotates soft release actions", () => {
  const hard = evaluateCodexHookInput({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: {
      command: "git reset --hard HEAD",
    },
  });
  assert.equal(hard.risk.level, "hard");
  assert.equal(hard.response.hookSpecificOutput.permissionDecision, "deny");

  const soft = evaluateCodexHookInput({
    hook_event_name: "PermissionRequest",
    tool_name: "Bash",
    tool_input: {
      command: "npm publish",
    },
  });
  assert.equal(soft.risk.level, "soft");
  assert.match(soft.response.systemMessage, /Clawdad noticed/u);
});

test("codex hook handler logs compact hook events inside project state", async () => {
  await withTempProject(async ({ projectPath }) => {
    const response = await handleCodexHookInput(
      {
        hook_event_name: "SessionStart",
        session_id: "session-1",
        cwd: projectPath,
      },
      { projectPath },
    );
    assert.match(response.hookSpecificOutput.additionalContext, /Clawdad Codex integration is active/u);
    const logText = await readFile(path.join(projectPath, ".clawdad", "codex-hooks", "events.jsonl"), "utf8");
    assert.match(logText, /"eventName":"SessionStart"/u);
    assert.doesNotMatch(logText, /tool_response/u);
  });
});

test("server codex CLI emits JSON doctor output for direct project paths", async () => {
  await withTempProject(async ({ projectPath, codexHome }) => {
    await installCodexIntegration({ projectPath, codexHome });
    const { stdout } = await execFileP(process.execPath, [
      serverScript,
      "codex",
      "doctor",
      projectPath,
      "--codex-home",
      codexHome,
      "--json",
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CLAWDAD_ROOT: repoRoot,
      },
    });
    const payload = JSON.parse(stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.projectPath, await realpath(projectPath));
  });
});

test("server Codex integration endpoints install and report the pack", async () => {
  await withTempProject(async ({ root, projectPath, codexHome }) => {
    const port = await freePort();
    const configPath = path.join(root, "server.json");
    await writeFile(
      configPath,
      JSON.stringify({ host: "127.0.0.1", port, authMode: "token" }, null, 2),
      "utf8",
    );
    const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CLAWDAD_ROOT: repoRoot,
        CLAWDAD_CODEX_HOME: codexHome,
        CLAWDAD_SERVER_TOKEN: "test-token",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForHealth(baseUrl, child);
      const installResponse = await fetch(`${baseUrl}/v1/codex-integration/install`, {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ project: projectPath }),
      });
      assert.equal(installResponse.status, 200);
      const installPayload = await installResponse.json();
      assert.equal(installPayload.ok, true);
      assert.equal(installPayload.report.failCount, 0);

      const doctorResponse = await fetch(
        `${baseUrl}/v1/codex-integration?project=${encodeURIComponent(projectPath)}`,
        {
          headers: {
            authorization: "Bearer test-token",
          },
        },
      );
      assert.equal(doctorResponse.status, 200);
      const doctorPayload = await doctorResponse.json();
      assert.equal(doctorPayload.ok, true);
      assert.equal(doctorPayload.failCount, 0);
    } finally {
      await stopServer(child);
    }
  });
});
