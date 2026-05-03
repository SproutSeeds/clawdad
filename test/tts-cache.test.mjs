import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  ensureCachedTtsAudio,
  resolveElevenLabsApiKey,
  splitTtsText,
} from "../lib/tts-cache.mjs";

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

async function waitForCondition(check, { timeoutMs = 5_000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await check();
    if (lastValue) {
      return lastValue;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("condition did not become true before timeout");
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

async function startFakeElevenLabs() {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) {
      body += chunk.toString();
    }
    calls.push({
      method: req.method,
      url: req.url,
      key: req.headers["xi-api-key"],
      body: JSON.parse(body || "{}"),
    });
    res.writeHead(200, { "content-type": "audio/mpeg" });
    res.end(Buffer.from(`fake-mp3-${calls.length}`));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

test("splits long TTS text into bounded chunks", () => {
  const text = Array.from({ length: 18 }, (_value, index) =>
    `Sentence ${index + 1} keeps enough words around to force a practical split without cutting midword.`,
  ).join("\n\n");
  const chunks = splitTtsText(text, { chunkChars: 400 });
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 400));
});

test("cached TTS generation reuses existing audio parts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-tts-cache-"));
  const projectPath = path.join(root, "project");
  await mkdir(projectPath, { recursive: true });
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(Buffer.from(`audio-${calls}`), {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
    });
  };

  try {
    const first = await ensureCachedTtsAudio({
      projectPath,
      text: "Hello from Clawdad.",
      config: { voiceId: "voice", modelId: "model", outputFormat: "mp3_44100_128" },
      apiKey: "test-key",
      fetchImpl,
    });
    const second = await ensureCachedTtsAudio({
      projectPath,
      text: "Hello from Clawdad.",
      config: { voiceId: "voice", modelId: "model", outputFormat: "mp3_44100_128" },
      apiKey: "test-key",
      fetchImpl,
    });
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(calls, 1);
    assert.equal(first.manifest.audioId, second.manifest.audioId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolves ElevenLabs key from environment before Keychain", async () => {
  const key = await resolveElevenLabsApiKey({
    env: { ELEVENLABS_API_KEY: "env-key" },
    platform: "darwin",
    execFileImpl: async () => {
      throw new Error("keychain should not be queried");
    },
  });
  assert.equal(key, "env-key");
});

test("resolves ElevenLabs key from ORP secrets when env and Keychain are absent", async () => {
  const calls = [];
  const key = await resolveElevenLabsApiKey({
    env: {
      CLAWDAD_ORP: "orp",
      CLAWDAD_ELEVENLABS_ORP_SECRET_REF: "elevenlabs-api-key",
    },
    platform: "linux",
    projectPath: "/tmp/clawdad-tts-project",
    execFileImpl: async (command, args) => {
      calls.push([command, args]);
      assert.equal(command, "orp");
      assert.deepEqual(
        args,
        [
          "--repo-root",
          "/tmp/clawdad-tts-project",
          "secrets",
          "resolve",
          "elevenlabs-api-key",
          "--local-only",
          "--reveal",
          "--json",
        ],
      );
      return { stdout: JSON.stringify({ ok: true, value: "orp-key" }) };
    },
  });
  assert.equal(key, "orp-key");
  assert.equal(calls.length, 1);
});

test("TTS message endpoint synthesizes, caches, and serves message audio", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-tts-server-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "project");
  const sessionId = "session-1";
  const requestId = "request-1";
  const configPath = path.join(root, "server.json");
  const fakeElevenLabs = await startFakeElevenLabs();
  await mkdir(home, { recursive: true });
  await mkdir(projectPath, { recursive: true });

  const historyRecordFile = path.join(
    projectPath,
    ".clawdad",
    "history",
    "sessions",
    sessionId,
    `${requestId}.json`,
  );
  await writeJson(historyRecordFile, {
    requestId,
    projectPath,
    sessionId,
    provider: "codex",
    message: "What changed?",
    sentAt: "2026-05-02T10:00:00.000Z",
    answeredAt: "2026-05-02T10:01:00.000Z",
    status: "answered",
    response: "The repo now has a cached audio response path.",
  });
  await writeJson(path.join(projectPath, ".clawdad", "history", "requests", `${requestId}.json`), {
    requestId,
    sessionId,
    sentAt: "2026-05-02T10:00:00.000Z",
    file: historyRecordFile,
  });
  await writeJson(path.join(home, "state.json"), {
    version: 3,
    projects: {
      [projectPath]: {
        status: "idle",
        active_session_id: sessionId,
        sessions: {
          [sessionId]: {
            slug: "Main",
            provider: "codex",
            status: "idle",
          },
        },
      },
    },
  });

  const port = await freePort();
  await writeJson(configPath, {
    host: "127.0.0.1",
    port,
    authMode: "tailscale",
    allowedUsers: ["tester@example.com"],
  });

  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      CLAWDAD_HOME: home,
      CLAWDAD_ELEVENLABS_API_KEY: "server-key",
      CLAWDAD_ELEVENLABS_BASE_URL: fakeElevenLabs.baseUrl,
      CLAWDAD_ELEVENLABS_VOICE_ID: "voice-id",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = {
      "content-type": "application/json",
      "tailscale-user-login": "tester@example.com",
    };
    await waitForHealth(baseUrl, child);

    const firstResponse = await fetch(`${baseUrl}/v1/tts/message`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        requestId,
        kind: "response",
      }),
    });
    assert.equal(firstResponse.status, 200);
    const firstPayload = await firstResponse.json();
    assert.equal(firstPayload.ok, true);
    assert.equal(firstPayload.cached, false);
    assert.equal(firstPayload.audio.parts.length, 1);
    assert.equal(fakeElevenLabs.calls.length, 1);
    assert.equal(fakeElevenLabs.calls[0].key, "server-key");
    assert.equal(fakeElevenLabs.calls[0].body.text, "The repo now has a cached audio response path.");

    const audioResponse = await fetch(new URL(firstPayload.audio.parts[0].url, baseUrl), {
      headers: { "tailscale-user-login": "tester@example.com" },
    });
    assert.equal(audioResponse.status, 200);
    assert.equal(await audioResponse.text(), "fake-mp3-1");

    const secondResponse = await fetch(`${baseUrl}/v1/tts/message`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        requestId,
        kind: "response",
      }),
    });
    assert.equal(secondResponse.status, 200);
    const secondPayload = await secondResponse.json();
    assert.equal(secondPayload.cached, true);
    assert.equal(fakeElevenLabs.calls.length, 1);
  } finally {
    await stopServer(child);
    await fakeElevenLabs.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("TTS message endpoint prepares response audio asynchronously", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-tts-async-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "project");
  const sessionId = "session-async";
  const requestId = "request-async";
  const configPath = path.join(root, "server.json");
  const fakeElevenLabs = await startFakeElevenLabs();
  await mkdir(home, { recursive: true });
  await mkdir(projectPath, { recursive: true });

  const historyRecordFile = path.join(
    projectPath,
    ".clawdad",
    "history",
    "sessions",
    sessionId,
    `${requestId}.json`,
  );
  await writeJson(historyRecordFile, {
    requestId,
    projectPath,
    sessionId,
    provider: "codex",
    message: "Give me the latest.",
    sentAt: "2026-05-02T11:00:00.000Z",
    answeredAt: "2026-05-02T11:02:00.000Z",
    status: "answered",
    response: "This response should become playable after background preparation.",
  });
  await writeJson(path.join(projectPath, ".clawdad", "history", "requests", `${requestId}.json`), {
    requestId,
    sessionId,
    sentAt: "2026-05-02T11:00:00.000Z",
    file: historyRecordFile,
  });
  await writeJson(path.join(home, "state.json"), {
    version: 3,
    projects: {
      [projectPath]: {
        status: "idle",
        active_session_id: sessionId,
        sessions: {
          [sessionId]: {
            slug: "Main",
            provider: "codex",
            status: "idle",
          },
        },
      },
    },
  });

  const port = await freePort();
  await writeJson(configPath, {
    host: "127.0.0.1",
    port,
    authMode: "tailscale",
    allowedUsers: ["tester@example.com"],
  });

  const child = spawn(process.execPath, [serverScript, "serve", "--config", configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      CLAWDAD_HOME: home,
      CLAWDAD_ELEVENLABS_API_KEY: "server-key",
      CLAWDAD_ELEVENLABS_BASE_URL: fakeElevenLabs.baseUrl,
      CLAWDAD_ELEVENLABS_VOICE_ID: "voice-id",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = {
      "content-type": "application/json",
      "tailscale-user-login": "tester@example.com",
    };
    await waitForHealth(baseUrl, child);

    const firstResponse = await fetch(`${baseUrl}/v1/tts/message`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        requestId,
        kind: "response",
        async: true,
      }),
    });
    assert.equal(firstResponse.status, 202);
    const firstPayload = await firstResponse.json();
    assert.equal(firstPayload.ok, true);
    assert.equal(firstPayload.audio.state, "generating");

    const readyPayload = await waitForCondition(async () => {
      const response = await fetch(`${baseUrl}/v1/tts/message`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          project: projectPath,
          sessionId,
          requestId,
          kind: "response",
          async: true,
        }),
      });
      const payload = await response.json();
      return response.status === 200 && payload.audio?.state === "ready" ? payload : null;
    });
    assert.equal(readyPayload.cached, true);
    assert.equal(readyPayload.audio.parts.length, 1);
    assert.equal(fakeElevenLabs.calls.length, 1);

    const thirdResponse = await fetch(`${baseUrl}/v1/tts/message`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        requestId,
        kind: "response",
        async: true,
      }),
    });
    assert.equal(thirdResponse.status, 200);
    assert.equal(fakeElevenLabs.calls.length, 1);
  } finally {
    await stopServer(child);
    await fakeElevenLabs.close();
    await rm(root, { recursive: true, force: true });
  }
});
