import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  resolveOpenAiApiKey,
  resolveSttRuntimeConfig,
  sttAudioFileIsSupported,
  transcribeOpenAiAudio,
} from "../lib/stt-cache.mjs";

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
  const deadline = Date.now() + 15_000;
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

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

async function startFakeOpenAi() {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);
    calls.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      contentType: req.headers["content-type"],
      bodyText: body.toString("utf8"),
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ text: "Transcribed from fake OpenAI." }));
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

test("STT runtime config defaults to OpenAI transcription", () => {
  const config = resolveSttRuntimeConfig({
    env: {},
    config: {},
  });
  assert.equal(config.enabled, true);
  assert.equal(config.provider, "openai");
  assert.equal(config.modelId, "gpt-4o-transcribe");
  assert.equal(config.maxBytes, 25 * 1024 * 1024);
});

test("resolves OpenAI key from environment before Keychain", async () => {
  const key = await resolveOpenAiApiKey({
    env: { OPENAI_API_KEY: "env-openai-key" },
    platform: "darwin",
    execFileImpl: async () => {
      throw new Error("keychain should not be queried");
    },
  });
  assert.equal(key, "env-openai-key");
});

test("resolves OpenAI key from ORP secrets when env and Keychain are absent", async () => {
  const calls = [];
  const key = await resolveOpenAiApiKey({
    env: {
      CLAWDAD_ORP: "orp",
      CLAWDAD_OPENAI_ORP_SECRET_REF: "openai-api-key",
    },
    platform: "linux",
    projectPath: "/tmp/clawdad-stt-project",
    execFileImpl: async (command, args) => {
      calls.push([command, args]);
      assert.equal(command, "orp");
      assert.deepEqual(
        args,
        [
          "--repo-root",
          "/tmp/clawdad-stt-project",
          "secrets",
          "resolve",
          "openai-api-key",
          "--local-only",
          "--reveal",
          "--json",
        ],
      );
      return { stdout: JSON.stringify({ ok: true, value: "orp-openai-key" }) };
    },
  });
  assert.equal(key, "orp-openai-key");
  assert.equal(calls.length, 1);
});

test("STT accepts supported browser audio formats", () => {
  assert.equal(sttAudioFileIsSupported({ fileName: "voice.webm", mimeType: "audio/webm" }), true);
  assert.equal(sttAudioFileIsSupported({ fileName: "voice.m4a", mimeType: "audio/mp4" }), true);
  assert.equal(sttAudioFileIsSupported({ fileName: "voice.txt", mimeType: "text/plain" }), false);
});

test("transcribeOpenAiAudio sends multipart transcription request", async () => {
  const fakeOpenAi = await startFakeOpenAi();
  try {
    const result = await transcribeOpenAiAudio({
      apiKey: "openai-key",
      config: {
        baseUrl: fakeOpenAi.baseUrl,
        modelId: "gpt-4o-mini-transcribe",
        prompt: "Preserve Clawdad terminology.",
      },
      audio: Buffer.from("fake-audio"),
      fileName: "voice.webm",
      mimeType: "audio/webm",
    });
    assert.equal(result.text, "Transcribed from fake OpenAI.");
    assert.equal(fakeOpenAi.calls.length, 1);
    assert.equal(fakeOpenAi.calls[0].method, "POST");
    assert.equal(fakeOpenAi.calls[0].url, "/v1/audio/transcriptions");
    assert.equal(fakeOpenAi.calls[0].authorization, "Bearer openai-key");
    assert.match(fakeOpenAi.calls[0].bodyText, /name="model"\r\n\r\ngpt-4o-mini-transcribe/u);
    assert.match(fakeOpenAi.calls[0].bodyText, /name="prompt"\r\n\r\nPreserve Clawdad terminology\./u);
  } finally {
    await fakeOpenAi.close();
  }
});

test("STT endpoint transcribes uploaded composer audio", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-stt-server-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "project");
  const configPath = path.join(root, "server.json");
  const fakeOpenAi = await startFakeOpenAi();
  await mkdir(home, { recursive: true });
  await mkdir(projectPath, { recursive: true });
  await writeJson(path.join(home, "state.json"), {
    version: 3,
    projects: {
      [projectPath]: {
        status: "idle",
        active_session_id: "session-1",
        sessions: {
          "session-1": {
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
      CLAWDAD_OPENAI_API_KEY: "server-openai-key",
      CLAWDAD_OPENAI_BASE_URL: fakeOpenAi.baseUrl,
      CLAWDAD_STT_MODEL: "gpt-4o-mini-transcribe",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const formData = new FormData();
    formData.append("project", projectPath);
    formData.append("audio", new Blob([Buffer.from("fake-audio")], { type: "audio/webm" }), "voice.webm");

    const response = await fetch(`${baseUrl}/v1/stt/transcribe`, {
      method: "POST",
      headers: { "tailscale-user-login": "tester@example.com" },
      body: formData,
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.text, "Transcribed from fake OpenAI.");
    assert.equal(payload.model, "gpt-4o-mini-transcribe");
    assert.equal(fakeOpenAi.calls.length, 1);
    assert.equal(fakeOpenAi.calls[0].authorization, "Bearer server-openai-key");
  } finally {
    await stopServer(child);
    await fakeOpenAi.close();
    await rm(root, { recursive: true, force: true });
  }
});
