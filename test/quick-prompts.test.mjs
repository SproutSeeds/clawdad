import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

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

test("quick prompts expose editable defaults, custom prompts, and reset", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-quick-prompts-"));
  const home = path.join(root, "home");
  const configPath = path.join(root, "server.json");
  const mockBinPath = path.join(root, "clawdad-bin");
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(home, "state.json"),
    JSON.stringify({ version: 3, projects: {} }, null, 2),
    "utf8",
  );
  await writeFile(mockBinPath, "#!/bin/sh\nexit 1\n", "utf8");
  await chmod(mockBinPath, 0o755);

  const port = await freePort();
  await writeFile(
    configPath,
    JSON.stringify(
      {
        host: "127.0.0.1",
        port,
        authMode: "tailscale",
        allowedUsers: ["tester@example.com"],
      },
      null,
      2,
    ),
    "utf8",
  );

  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAWDAD_HOME: home,
      CLAWDAD_BIN_PATH: mockBinPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderr = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderr.push(chunk));

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = {
      "content-type": "application/json",
      "tailscale-user-login": "tester@example.com",
    };
    await waitForHealth(baseUrl, child);

    const defaultsResponse = await fetch(`${baseUrl}/v1/quick-prompts`, { headers });
    assert.equal(defaultsResponse.status, 200, stderr.join(""));
    const defaultsPayload = await defaultsResponse.json();
    assert.equal(defaultsPayload.ok, true);
    assert.equal(defaultsPayload.prompts.length, 4);
    assert.equal(defaultsPayload.prompts[0].id, "next-steps");
    assert.equal(defaultsPayload.prompts[0].builtIn, true);

    const edited = [
      {
        ...defaultsPayload.prompts[0],
        title: "Highest next step",
        text: "Tell me the highest leverage next implementation step.",
      },
      {
        id: "custom-standup",
        title: "Standup",
        text: "Give me a concise standup update with blockers and next action.",
        builtIn: false,
      },
    ];
    const saveResponse = await fetch(`${baseUrl}/v1/quick-prompts`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ prompts: edited }),
    });
    if (saveResponse.status !== 200) {
      assert.fail(await saveResponse.text());
    }
    const savePayload = await saveResponse.json();
    assert.equal(savePayload.prompts.length, 2);
    assert.equal(savePayload.prompts[0].title, "Highest next step");
    assert.equal(savePayload.prompts[1].builtIn, false);

    const statePayload = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
    assert.equal(statePayload.quick_prompts.length, 2);
    assert.equal(statePayload.quick_prompts[1].id, "custom-standup");

    const resetResponse = await fetch(`${baseUrl}/v1/quick-prompts`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ reset: true }),
    });
    if (resetResponse.status !== 200) {
      assert.fail(await resetResponse.text());
    }
    const resetPayload = await resetResponse.json();
    assert.equal(resetPayload.prompts.length, 4);
    assert.equal(resetPayload.prompts[0].title, "Next steps");

    const resetStatePayload = JSON.parse(await readFile(path.join(home, "state.json"), "utf8"));
    assert.equal(Object.prototype.hasOwnProperty.call(resetStatePayload, "quick_prompts"), false);
  } finally {
    await stopServer(child);
    await rm(root, { recursive: true, force: true });
  }
});
