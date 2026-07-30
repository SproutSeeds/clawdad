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
  transcribeDocReaderAudio,
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

async function startFakeDocReaderStt({ directStatus = 200 } = {}) {
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
      language: req.headers["x-doc-reader-language"],
      fileName: req.headers["x-doc-reader-filename"],
      source: req.headers["x-doc-reader-source"],
      sourceItemId: req.headers["x-doc-reader-source-item-id"],
      project: req.headers["x-doc-reader-project"],
      body,
    });
    if (req.url === "/v1/audio/transcriptions" && directStatus >= 400) {
      res.writeHead(directStatus, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "direct transcription endpoint missing" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      text: "Transcribed from local speech.",
      item: {
        id: "dictation-1",
        source: "clawdad",
      },
      transcription: {
        model: "large-v3",
        language: "en",
        duration: 1.25,
        generation_seconds: 0.12,
        segments: [],
      },
    }));
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

test("STT runtime config defaults to ClawDad local speech transcription", () => {
  const config = resolveSttRuntimeConfig({
    env: {},
    config: {},
  });
  assert.equal(config.enabled, true);
  assert.equal(config.provider, "doc-reader");
  assert.equal(config.modelId, "large-v3");
  assert.equal(config.baseUrl, "http://127.0.0.1:8772");
  assert.equal(config.fallbackUrl, "http://127.0.0.1:8766");
  assert.equal(config.endpointPath, "/v1/audio/transcriptions");
  assert.equal(config.fallbackEndpointPath, "/api/transcribe");
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

test("does not resolve shared ORP OpenAI secrets without explicit Clawdad ref", async () => {
  const calls = [];
  const key = await resolveOpenAiApiKey({
    env: {
      CLAWDAD_ORP: "orp",
    },
    platform: "linux",
    projectPath: "/tmp/clawdad-stt-project",
    execFileImpl: async (command, args) => {
      calls.push([command, args]);
      return { stdout: JSON.stringify({ ok: true, value: "shared-openai-key" }) };
    },
  });

  assert.equal(key, "");
  assert.deepEqual(calls, []);
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

test("transcribeDocReaderAudio sends raw direct local transcription request", async () => {
  const fakeDocReader = await startFakeDocReaderStt();
  try {
    const result = await transcribeDocReaderAudio({
      config: {
        baseUrl: fakeDocReader.baseUrl,
        modelId: "large-v3",
      },
      audio: Buffer.from("fake-audio"),
      fileName: "voice.webm",
      mimeType: "audio/webm",
      language: "en",
    });
    assert.equal(result.text, "Transcribed from local speech.");
    assert.equal(result.provider, "doc-reader");
    assert.equal(result.modelId, "large-v3");
    assert.equal(result.language, "en");
    assert.equal(result.serviceUrl, fakeDocReader.baseUrl);
    assert.equal(fakeDocReader.calls.length, 1);
    assert.equal(fakeDocReader.calls[0].method, "POST");
    assert.equal(fakeDocReader.calls[0].url, "/v1/audio/transcriptions");
    assert.equal(fakeDocReader.calls[0].authorization, undefined);
    assert.equal(fakeDocReader.calls[0].contentType, "audio/webm");
    assert.equal(fakeDocReader.calls[0].language, "en");
    assert.equal(fakeDocReader.calls[0].fileName, "voice.webm");
    assert.equal(fakeDocReader.calls[0].source, "clawdad");
    assert.equal(fakeDocReader.calls[0].body.toString("utf8"), "fake-audio");
  } finally {
    await fakeDocReader.close();
  }
});

test("transcribeDocReaderAudio falls back to legacy transcription route when direct endpoint is missing", async () => {
  const fakeDocReader = await startFakeDocReaderStt({ directStatus: 404 });
  try {
    const result = await transcribeDocReaderAudio({
      config: {
        baseUrl: fakeDocReader.baseUrl,
        modelId: "large-v3",
      },
      audio: Buffer.from("fake-audio"),
      fileName: "voice.webm",
      mimeType: "audio/webm",
    });
    assert.equal(result.text, "Transcribed from local speech.");
    assert.equal(fakeDocReader.calls.length, 2);
    assert.deepEqual(fakeDocReader.calls.map((call) => call.url), [
      "/v1/audio/transcriptions",
      "/api/transcribe",
    ]);
  } finally {
    await fakeDocReader.close();
  }
});

test("STT endpoint rejects OpenAI provider config before transcription", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-stt-openai-server-"));
  const home = path.join(root, "home");
  const configPath = path.join(root, "server.json");
  const fakeOpenAi = await startFakeOpenAi();
  await mkdir(home, { recursive: true });

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
      CLAWDAD_STT_PROVIDER: "openai",
      CLAWDAD_OPENAI_API_KEY: "server-key",
      CLAWDAD_OPENAI_BASE_URL: fakeOpenAi.baseUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const formData = new FormData();
    formData.append("audio", new Blob([Buffer.from("fake-audio")], { type: "audio/webm" }), "voice.webm");

    const response = await fetch(`${baseUrl}/v1/stt/transcribe`, {
      method: "POST",
      headers: { "tailscale-user-login": "tester@example.com" },
      body: formData,
    });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.errorCode, "doc_reader_required");
    assert.match(payload.error, /local speech/u);
    assert.equal(fakeOpenAi.calls.length, 0);
  } finally {
    await stopServer(child);
    await fakeOpenAi.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("STT endpoint transcribes uploaded composer audio with local speech", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-stt-server-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "project");
  const configPath = path.join(root, "server.json");
  const fakeDocReader = await startFakeDocReaderStt();
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
      CLAWDAD_STT_PROVIDER: "doc-reader",
      CLAWDAD_DOC_READER_STT_URL: fakeDocReader.baseUrl,
      CLAWDAD_STT_MODEL: "large-v3",
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
    assert.equal(payload.text, "Transcribed from local speech.");
    assert.equal(payload.model, "large-v3");
    assert.equal(payload.provider, "doc-reader");
    assert.equal(fakeDocReader.calls.length, 1);
    assert.equal(fakeDocReader.calls[0].authorization, undefined);
    assert.equal(fakeDocReader.calls[0].contentType, "audio/webm");
    assert.equal(fakeDocReader.calls[0].url, "/v1/audio/transcriptions");
    assert.equal(fakeDocReader.calls[0].source, "clawdad");
    assert.equal(fakeDocReader.calls[0].project, projectPath);
  } finally {
    await stopServer(child);
    await fakeDocReader.close();
    await rm(root, { recursive: true, force: true });
  }
});
