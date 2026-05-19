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
  resolveTtsRuntimeConfig,
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

function stableClientTextHash(value = "") {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function startFakeOpenAiSpeech({ status = 200, errorBody = "" } = {}) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) {
      body += chunk.toString();
    }
    calls.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      accept: req.headers.accept,
      body: JSON.parse(body || "{}"),
    });
    const callIndex = calls.length - 1;
    const responseStatus = Array.isArray(status)
      ? status[Math.min(callIndex, status.length - 1)]
      : typeof status === "function"
        ? status({ callIndex, calls })
        : status;
    const responseErrorBody = Array.isArray(errorBody)
      ? errorBody[Math.min(callIndex, errorBody.length - 1)]
      : errorBody;
    if (responseStatus >= 400) {
      res.writeHead(responseStatus, { "content-type": "application/json" });
      res.end(responseErrorBody || JSON.stringify({ error: { message: "speech failed" } }));
      return;
    }
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

async function startFakeDocReaderSpeech({
  speechStatus = 200,
  healthStatus = 200,
  healthPayload = {
    ok: true,
    engines: {
      kokoro: {
        enabled: true,
        loaded: true,
        device: "cuda",
        model: "kokoro",
      },
    },
  },
  errorBody = "",
  audioPrefix = "fake-wav",
} = {}) {
  const speechCalls = [];
  const healthCalls = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      healthCalls.push({ method: req.method, url: req.url });
      res.writeHead(healthStatus, { "content-type": "application/json" });
      res.end(JSON.stringify(healthPayload));
      return;
    }

    let body = "";
    for await (const chunk of req) {
      body += chunk.toString();
    }
    speechCalls.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      accept: req.headers.accept,
      body: JSON.parse(body || "{}"),
    });
    if (speechStatus >= 400) {
      res.writeHead(speechStatus, { "content-type": "application/json" });
      res.end(errorBody || JSON.stringify({ message: "local speech failed" }));
      return;
    }
    res.writeHead(200, { "content-type": "audio/wav" });
    res.end(Buffer.from(`${audioPrefix}-${speechCalls.length}`));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    speechCalls,
    healthCalls,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function startFakeDocReaderLibrary({
  mode = "ready",
  audio = Buffer.from("fake-library-wav"),
  healthPayload = {
    ok: true,
    app: "doc-reader",
    tts: {
      backend: "tailscale-4090",
      label: "Strict 4090 (Kokoro)",
      services: {
        umbra: {
          ok: true,
          url: "http://umbra.test",
          device: { requested: "cuda", platform: "win32", cuda_device: "NVIDIA GeForce RTX 4090" },
          engines: {
            kokoro: { enabled: true, loaded: true, device: "cuda", model: "kokoro" },
          },
        },
        mac: {
          ok: true,
          url: "http://mac.test",
          device: { requested: "cpu", platform: "darwin" },
          engines: {
            kokoro: { enabled: true, loaded: true, device: "cpu", model: "kokoro" },
          },
        },
      },
    },
  },
} = {}) {
  const itemCalls = [];
  const healthCalls = [];
  const audioCalls = [];
  const items = new Map();
  const itemForBody = (body = {}) => {
    const sourceItemId = String(body.source_item_id || body.sourceItemId || `source-${itemCalls.length}`);
    const existing = [...items.values()].find((entry) => entry.source_item_id === sourceItemId);
    const item = existing || {
      id: `item-${items.size + 1}`,
      source: body.source || "clawdad",
      source_item_id: sourceItemId,
      kind: body.kind || "clawdad-message",
      title: body.title || "Clawdad Message",
      snippet: String(body.text || "").slice(0, 120),
      audio: {},
    };
    item.source = body.source || item.source;
    item.source_item_id = sourceItemId;
    item.kind = body.kind || item.kind;
    item.title = body.title || item.title;
    item.snippet = String(body.text || item.snippet || "").slice(0, 120);
    item.audio = mode === "fail"
      ? { state: "failed", error: "local speech failed visibly" }
      : mode === "processing"
        ? { state: "processing" }
        : { state: "ready", bytes: audio.length, content_type: "audio/wav", url: `/api/library/items/${item.id}/audio` };
    items.set(item.id, item);
    return item;
  };

  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      healthCalls.push({ method: req.method, url: req.url });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(healthPayload));
      return;
    }
    if (req.method === "POST" && req.url === "/api/library/items") {
      let bodyText = "";
      for await (const chunk of req) {
        bodyText += chunk.toString();
      }
      const body = JSON.parse(bodyText || "{}");
      itemCalls.push({ method: req.method, url: req.url, body });
      const item = itemForBody(body);
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, item }));
      return;
    }
    const itemMatch = String(req.url || "").match(/^\/api\/library\/items\/([^/?]+)(?:\/audio)?/u);
    if (req.method === "GET" && itemMatch && String(req.url).endsWith("/audio")) {
      const item = items.get(decodeURIComponent(itemMatch[1]));
      audioCalls.push({ method: req.method, url: req.url });
      if (!item) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "not found" }));
        return;
      }
      res.writeHead(200, { "content-type": "audio/wav", "content-length": String(audio.length) });
      res.end(audio);
      return;
    }
    if (req.method === "GET" && itemMatch) {
      const item = items.get(decodeURIComponent(itemMatch[1]));
      res.writeHead(item ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(item ? { ok: true, item } : { ok: false, error: "not found" }));
      return;
    }
    if (req.method === "GET" && String(req.url || "").startsWith("/api/library/items?")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, items: [...items.values()] }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    itemCalls,
    healthCalls,
    audioCalls,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

async function writeTrackedHistoryFixture({
  home,
  projectPath,
  sessionId,
  requestId,
  message = "Say this.",
  response = "Ready.",
  sentAt = "2026-05-06T12:00:00.000Z",
  answeredAt = "2026-05-06T12:00:10.000Z",
} = {}) {
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
    message,
    sentAt,
    answeredAt,
    status: "answered",
    exitCode: 0,
    response,
  });
  await writeJson(path.join(projectPath, ".clawdad", "history", "requests", `${requestId}.json`), {
    requestId,
    sessionId,
    sentAt,
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
  return { historyRecordFile };
}

async function startTtsServerFixture({ root, home, configPath, fakeOpenAi, env = {} } = {}) {
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
      CLAWDAD_TTS_ENABLED: "true",
      CLAWDAD_TTS_PROVIDER: "openai",
      CLAWDAD_OPENAI_API_KEY: "server-key",
      CLAWDAD_OPENAI_TTS_BASE_URL: fakeOpenAi.baseUrl,
      CLAWDAD_OPENAI_TTS_VOICE: "cedar",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, child);
  return {
    child,
    baseUrl,
    headers: {
      "content-type": "application/json",
      "tailscale-user-login": "tester@example.com",
    },
    root,
  };
}

test("splits long TTS text into bounded chunks", () => {
  const text = Array.from({ length: 18 }, (_value, index) =>
    `Sentence ${index + 1} keeps enough words around to force a practical split without cutting midword.`,
  ).join("\n\n");
  const chunks = splitTtsText(text, { chunkChars: 400 });
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 400));
});

test("TTS runtime config defaults to Doc Reader local speech", () => {
  const config = resolveTtsRuntimeConfig({
    env: {},
    config: {},
  });
  assert.equal(config.enabled, true);
  assert.equal(config.provider, "doc-reader");
  assert.equal(config.libraryUrl, "http://127.0.0.1:8766");
  assert.equal(config.baseUrl, "http://100.72.151.28:8771");
  assert.equal(config.fallbackUrl, "http://127.0.0.1:8772");
  assert.equal(config.engine, "kokoro");
  assert.equal(config.modelId, "kokoro");
  assert.equal(config.voiceId, "af_heart");
  assert.equal(config.outputFormat, "wav");
});

test("cached TTS generation reuses existing Doc Reader audio parts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-tts-cache-"));
  const projectPath = path.join(root, "project");
  await mkdir(projectPath, { recursive: true });
  let calls = 0;
  const fetchImpl = async (url, request) => {
    calls += 1;
    assert.equal(String(url), "http://doc-reader.test/v1/audio/speech");
    assert.equal(request.headers.authorization, undefined);
    const body = JSON.parse(request.body);
    assert.equal(body.engine, "kokoro");
    assert.equal(body.voice, "af_heart");
    assert.equal(body.text, "Hello from Clawdad.");
    return new Response(Buffer.from(`audio-${calls}`), {
      status: 200,
      headers: { "content-type": "audio/wav" },
    });
  };

  try {
    const first = await ensureCachedTtsAudio({
      projectPath,
      text: "Hello from Clawdad.",
      config: {
        provider: "doc-reader",
        baseUrl: "http://doc-reader.test",
        fallbackUrl: "",
        engine: "kokoro",
        voiceId: "af_heart",
      },
      fetchImpl,
    });
    const second = await ensureCachedTtsAudio({
      projectPath,
      text: "Hello from Clawdad.",
      config: {
        provider: "doc-reader",
        baseUrl: "http://doc-reader.test",
        fallbackUrl: "",
        engine: "kokoro",
        voiceId: "af_heart",
      },
      fetchImpl,
    });
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(calls, 1);
    assert.equal(first.manifest.audioId, second.manifest.audioId);
    assert.equal(first.manifest.provider, "doc-reader");
    assert.equal(first.manifest.outputFormat, "wav");
    assert.equal(first.manifest.parts[0].fileName, "part-001.wav");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Doc Reader TTS falls back from Umbra to Mac Kokoro", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-tts-fallback-"));
  const projectPath = path.join(root, "project");
  const primary = await startFakeDocReaderSpeech({ speechStatus: 503 });
  const fallback = await startFakeDocReaderSpeech({ audioPrefix: "fallback-wav" });
  await mkdir(projectPath, { recursive: true });

  try {
    const result = await ensureCachedTtsAudio({
      projectPath,
      text: "Fallback should speak.",
      config: {
        provider: "doc-reader",
        baseUrl: primary.baseUrl,
        fallbackUrl: fallback.baseUrl,
        engine: "kokoro",
        voiceId: "af_heart",
      },
    });
    assert.equal(result.cached, false);
    assert.equal(primary.speechCalls.length, 1);
    assert.equal(fallback.speechCalls.length, 1);
    const partPath = path.join(
      projectPath,
      ".clawdad",
      "audio",
      "messages",
      result.manifest.audioId,
      result.manifest.parts[0].fileName,
    );
    assert.equal(await readFile(partPath, "utf8"), "fallback-wav-1");
  } finally {
    await primary.close();
    await fallback.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("TTS status reports Doc Reader fallback health", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-tts-status-"));
  const home = path.join(root, "home");
  const configPath = path.join(root, "server.json");
  const fakeDocReader = await startFakeDocReaderLibrary({
    healthPayload: {
      ok: true,
      app: "doc-reader",
      tts: {
        backend: "auto",
        services: {
          umbra: {
            ok: false,
            url: "http://umbra.test",
            error: "Umbra offline",
            engines: {
              kokoro: { enabled: true, loaded: false, error: "offline" },
            },
          },
          mac: {
            ok: true,
            url: "http://mac.test",
            device: { requested: "cpu", platform: "darwin" },
            engines: {
              kokoro: {
                enabled: true,
                loaded: true,
                device: "cpu",
                model: "kokoro",
              },
            },
          },
        },
      },
    },
  });
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
      CLAWDAD_TTS_ENABLED: "true",
      CLAWDAD_TTS_PROVIDER: "doc-reader",
      CLAWDAD_DOC_READER_URL: fakeDocReader.baseUrl,
      CLAWDAD_DOC_READER_TTS_ENGINE: "kokoro",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const response = await fetch(`${baseUrl}/v1/tts/status`, {
      headers: { "tailscale-user-login": "tester@example.com" },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ttsStatus.provider, "doc-reader");
    assert.equal(payload.ttsStatus.available, true);
    assert.equal(payload.ttsStatus.degraded, true);
    assert.equal(payload.ttsStatus.services.primary.available, false);
    assert.equal(payload.ttsStatus.services.fallback.available, true);
    assert.equal(payload.ttsStatus.services.fallback.device, "cpu");
  } finally {
    await stopServer(child);
    await fakeDocReader.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("TTS message endpoint synthesizes sent and received text with Doc Reader", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-tts-doc-reader-message-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "project");
  const configPath = path.join(root, "server.json");
  const fakeDocReader = await startFakeDocReaderLibrary({ audio: Buffer.from("library-audio") });
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
      CLAWDAD_TTS_ENABLED: "true",
      CLAWDAD_TTS_PROVIDER: "doc-reader",
      CLAWDAD_DOC_READER_URL: fakeDocReader.baseUrl,
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

    for (const [kind, text] of [
      ["message", "This user message should speak locally."],
      ["response", "This agent response should speak locally."],
    ]) {
      const response = await fetch(`${baseUrl}/v1/tts/message`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          project: projectPath,
          sessionId: "session-1",
          requestId: `request-${kind}`,
          kind,
          text,
        }),
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.audio.provider, "doc-reader");
      assert.equal(payload.audio.outputFormat, "wav");
      assert.equal(payload.audio.parts.length, 1);
      const audioResponse = await fetch(new URL(payload.audio.parts[0].url, baseUrl), {
        headers: { "tailscale-user-login": "tester@example.com" },
      });
      assert.equal(audioResponse.status, 200);
      assert.equal(audioResponse.headers.get("accept-ranges"), "bytes");
      assert.equal(audioResponse.headers.get("content-type"), "audio/wav");
      assert.equal(audioResponse.headers.get("content-length"), String(Buffer.byteLength("library-audio")));
      assert.equal(await audioResponse.text(), "library-audio");

      if (kind === "message") {
        const rangeResponse = await fetch(new URL(payload.audio.parts[0].url, baseUrl), {
          headers: {
            "tailscale-user-login": "tester@example.com",
            range: "bytes=0-6",
          },
        });
        assert.equal(rangeResponse.status, 206);
        assert.equal(rangeResponse.headers.get("accept-ranges"), "bytes");
        assert.equal(rangeResponse.headers.get("content-range"), "bytes 0-6/13");
        assert.equal(rangeResponse.headers.get("content-length"), "7");
        assert.equal(await rangeResponse.text(), "library");

        const suffixResponse = await fetch(new URL(payload.audio.parts[0].url, baseUrl), {
          headers: {
            "tailscale-user-login": "tester@example.com",
            range: "bytes=-5",
          },
        });
        assert.equal(suffixResponse.status, 206);
        assert.equal(suffixResponse.headers.get("content-range"), "bytes 8-12/13");
        assert.equal(await suffixResponse.text(), "audio");

        const invalidRangeResponse = await fetch(new URL(payload.audio.parts[0].url, baseUrl), {
          headers: {
            "tailscale-user-login": "tester@example.com",
            range: "bytes=999-1000",
          },
        });
        assert.equal(invalidRangeResponse.status, 416);
        assert.equal(invalidRangeResponse.headers.get("accept-ranges"), "bytes");
        assert.equal(invalidRangeResponse.headers.get("content-range"), "bytes */13");
        assert.equal(await invalidRangeResponse.text(), "");
      }
    }

    const missingAudioResponse = await fetch(`${baseUrl}/v1/tts/audio?docReaderItemId=missing-item`, {
      headers: { "tailscale-user-login": "tester@example.com" },
    });
    assert.equal(missingAudioResponse.status, 404);
    const missingPayload = await missingAudioResponse.json();
    assert.equal(missingPayload.ok, false);
    assert.match(missingPayload.error, /not found/u);

    assert.equal(fakeDocReader.itemCalls.length, 2);
    assert.equal(fakeDocReader.itemCalls[0].body.text, "This user message should speak locally.");
    assert.equal(fakeDocReader.itemCalls[0].body.kind, "clawdad-message");
    assert.equal(fakeDocReader.itemCalls[0].body.prepare_audio, true);
    assert.equal(fakeDocReader.itemCalls[1].body.text, "This agent response should speak locally.");
    assert.equal(fakeDocReader.itemCalls[1].body.kind, "clawdad-response");
    assert.equal(fakeDocReader.audioCalls.length, 6);
  } finally {
    await stopServer(child);
    await fakeDocReader.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("TTS message endpoint speaks visible payload text over mismatched mirrored history", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-tts-visible-text-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "project");
  const sessionId = "session-visible";
  const requestId = "request-visible";
  const configPath = path.join(root, "server.json");
  const fakeDocReader = await startFakeDocReaderLibrary({ audio: Buffer.from("visible-audio") });
  await writeTrackedHistoryFixture({
    home,
    projectPath,
    sessionId,
    requestId,
    message: "Original prompt.",
    response: "Old mirrored response that should not be spoken.",
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
      CLAWDAD_TTS_ENABLED: "true",
      CLAWDAD_TTS_PROVIDER: "doc-reader",
      CLAWDAD_DOC_READER_URL: fakeDocReader.baseUrl,
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
        requestId: `${requestId}:tts:visible-one`,
        historyRequestId: requestId,
        kind: "response",
        text: "Visible response text.",
      }),
    });
    assert.equal(firstResponse.status, 200);
    const firstPayload = await firstResponse.json();
    assert.equal(firstPayload.ok, true);
    assert.equal(firstPayload.audio.provider, "doc-reader");
    assert.equal(firstPayload.audio.textHash, fakeDocReader.itemCalls[0].body.source_meta.textHash);
    assert.equal(fakeDocReader.itemCalls.length, 1);
    assert.equal(fakeDocReader.itemCalls[0].body.text, "Visible response text.");
    assert.equal(fakeDocReader.itemCalls[0].body.source_meta.historyTextMatchesPayload, false);
    const firstSourceItemId = fakeDocReader.itemCalls[0].body.source_item_id;

    const secondResponse = await fetch(`${baseUrl}/v1/tts/message`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        requestId: `${requestId}:tts:visible-two`,
        historyRequestId: requestId,
        kind: "response",
        text: "A second visible response.",
      }),
    });
    assert.equal(secondResponse.status, 200);
    const secondPayload = await secondResponse.json();
    assert.equal(secondPayload.ok, true);
    assert.equal(fakeDocReader.itemCalls.length, 2);
    assert.equal(fakeDocReader.itemCalls[1].body.text, "A second visible response.");
    assert.notEqual(fakeDocReader.itemCalls[1].body.source_item_id, firstSourceItemId);
    assert.notEqual(secondPayload.audio.audioId, firstPayload.audio.audioId);
  } finally {
    await stopServer(child);
    await fakeDocReader.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("TTS message endpoint refuses stale history fallback when visible text fingerprint differs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-tts-stale-history-fingerprint-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "project");
  const sessionId = "session-visible";
  const requestId = "request-visible";
  const configPath = path.join(root, "server.json");
  const fakeDocReader = await startFakeDocReaderLibrary({ audio: Buffer.from("visible-audio") });
  await writeTrackedHistoryFixture({
    home,
    projectPath,
    sessionId,
    requestId,
    message: "Original prompt.",
    response: "Old mirrored response that should not be spoken.",
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
      CLAWDAD_TTS_ENABLED: "true",
      CLAWDAD_TTS_PROVIDER: "doc-reader",
      CLAWDAD_DOC_READER_URL: fakeDocReader.baseUrl,
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

    const visibleText = "Visible response text that did not survive inline transport.";
    const response = await fetch(`${baseUrl}/v1/tts/message`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        requestId: `${requestId}:tts:${visibleText.length}-${stableClientTextHash(visibleText)}`,
        historyRequestId: requestId,
        kind: "response",
        text: "",
        clientTextLength: visibleText.length,
        clientTextHash: stableClientTextHash(visibleText),
      }),
    });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.match(payload.error, /no longer matches the visible card/u);
    assert.equal(fakeDocReader.itemCalls.length, 0);

    const historyText = "Old mirrored response that should not be spoken.";
    const matchingResponse = await fetch(`${baseUrl}/v1/tts/message`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        requestId: `${requestId}:tts:${historyText.length}-${stableClientTextHash(historyText)}`,
        historyRequestId: requestId,
        kind: "response",
        text: "",
        clientTextLength: historyText.length,
        clientTextHash: stableClientTextHash(historyText),
      }),
    });
    assert.equal(matchingResponse.status, 200);
    assert.equal(fakeDocReader.itemCalls.length, 1);
    assert.equal(fakeDocReader.itemCalls[0].body.text, historyText);
    assert.equal(fakeDocReader.itemCalls[0].body.source_meta.clientTextHash, stableClientTextHash(historyText));
  } finally {
    await stopServer(child);
    await fakeDocReader.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("TTS message endpoint persists and reuses Doc Reader audio for both message sides", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-tts-doc-reader-history-audio-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "project");
  const sessionId = "session-1";
  const requestId = "request-history-audio";
  const configPath = path.join(root, "server.json");
  const fakeDocReader = await startFakeDocReaderLibrary({ audio: Buffer.from("history-audio") });
  const { historyRecordFile } = await writeTrackedHistoryFixture({
    home,
    projectPath,
    sessionId,
    requestId,
    message: "Persist my message audio.",
    response: "Persist the response audio.",
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
      CLAWDAD_TTS_ENABLED: "true",
      CLAWDAD_TTS_PROVIDER: "doc-reader",
      CLAWDAD_DOC_READER_URL: fakeDocReader.baseUrl,
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

    const messageResponse = await fetch(`${baseUrl}/v1/tts/message`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        requestId,
        kind: "message",
      }),
    });
    assert.equal(messageResponse.status, 200);
    const messagePayload = await messageResponse.json();
    assert.equal(messagePayload.ok, true);
    assert.equal(messagePayload.cached, true);
    assert.equal(messagePayload.audio.state, "ready");
    assert.equal(fakeDocReader.itemCalls.length, 1);

    let record = JSON.parse(await readFile(historyRecordFile, "utf8"));
    assert.equal(record.audio.message.state, "ready");
    assert.equal(record.audio.message.parts[0].url, messagePayload.audio.parts[0].url);
    assert.equal(record.audio.response, undefined);

    const cachedMessageResponse = await fetch(`${baseUrl}/v1/tts/message`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        requestId,
        kind: "message",
      }),
    });
    assert.equal(cachedMessageResponse.status, 200);
    const cachedMessagePayload = await cachedMessageResponse.json();
    assert.equal(cachedMessagePayload.cached, true);
    assert.equal(cachedMessagePayload.audio.audioId, messagePayload.audio.audioId);
    assert.equal(fakeDocReader.itemCalls.length, 1);

    const responseResponse = await fetch(`${baseUrl}/v1/tts/message`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        requestId,
        kind: "response",
      }),
    });
    assert.equal(responseResponse.status, 200);
    const responsePayload = await responseResponse.json();
    assert.equal(responsePayload.ok, true);
    assert.equal(responsePayload.cached, true);
    assert.equal(responsePayload.audio.state, "ready");
    assert.equal(fakeDocReader.itemCalls.length, 2);

    record = JSON.parse(await readFile(historyRecordFile, "utf8"));
    assert.equal(record.audio.message.state, "ready");
    assert.equal(record.audio.response.state, "ready");
    assert.equal(record.audio.response.parts[0].url, responsePayload.audio.parts[0].url);

    const cachedResponseResponse = await fetch(`${baseUrl}/v1/tts/message`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        requestId,
        kind: "response",
      }),
    });
    assert.equal(cachedResponseResponse.status, 200);
    const cachedResponsePayload = await cachedResponseResponse.json();
    assert.equal(cachedResponsePayload.cached, true);
    assert.equal(cachedResponsePayload.audio.audioId, responsePayload.audio.audioId);
    assert.equal(fakeDocReader.itemCalls.length, 2);
  } finally {
    await stopServer(child);
    await fakeDocReader.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("TTS async polling surfaces Doc Reader failures instead of spinning", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-tts-doc-reader-fail-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "project");
  const configPath = path.join(root, "server.json");
  const fakeDocReader = await startFakeDocReaderLibrary({ mode: "fail" });
  const { historyRecordFile } = await writeTrackedHistoryFixture({
    home,
    projectPath,
    sessionId: "session-1",
    requestId: "request-fail",
    message: "This local speech request should fail visibly.",
    response: "No response audio yet.",
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
      CLAWDAD_TTS_ENABLED: "true",
      CLAWDAD_TTS_PROVIDER: "doc-reader",
      CLAWDAD_DOC_READER_URL: fakeDocReader.baseUrl,
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
    const body = {
      project: projectPath,
      sessionId: "session-1",
      requestId: "request-fail",
      kind: "message",
      async: true,
    };
    const firstResponse = await fetch(`${baseUrl}/v1/tts/message`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    assert.equal(firstResponse.status, 202);

    const failedPayload = await waitForCondition(async () => {
      const response = await fetch(`${baseUrl}/v1/tts/message`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...body, poll: true }),
      });
      const payload = await response.json();
      return response.status >= 400 ? { response, payload } : null;
    });
    assert.equal(failedPayload.response.status, 503);
    assert.equal(failedPayload.payload.ok, false);
    assert.match(
      failedPayload.payload.error,
      /Local text-to-speech service is unavailable|Doc Reader audio generation failed|local speech failed visibly/u,
    );
    const record = JSON.parse(await readFile(historyRecordFile, "utf8"));
    assert.equal(record.audio.message.state, "failed");
    assert.equal(record.audio.message.error, "local speech failed visibly");
    assert.equal(record.audio.response, undefined);
    assert.equal(fakeDocReader.itemCalls.length >= 1, true);
  } finally {
    await stopServer(child);
    await fakeDocReader.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("TTS message endpoint synthesizes, caches, and serves message audio", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-tts-server-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "project");
  const sessionId = "session-1";
  const requestId = "request-1";
  const configPath = path.join(root, "server.json");
  const fakeOpenAi = await startFakeOpenAiSpeech();
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
      CLAWDAD_TTS_ENABLED: "true",
      CLAWDAD_TTS_PROVIDER: "openai",
      CLAWDAD_OPENAI_API_KEY: "server-key",
      CLAWDAD_OPENAI_TTS_BASE_URL: fakeOpenAi.baseUrl,
      CLAWDAD_OPENAI_TTS_VOICE: "cedar",
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
    assert.equal(fakeOpenAi.calls.length, 1);
    assert.equal(fakeOpenAi.calls[0].authorization, "Bearer server-key");
    assert.equal(fakeOpenAi.calls[0].url, "/v1/audio/speech");
    assert.equal(fakeOpenAi.calls[0].body.model, "gpt-4o-mini-tts");
    assert.equal(fakeOpenAi.calls[0].body.voice, "cedar");
    assert.equal(fakeOpenAi.calls[0].body.input, "The repo now has a cached audio response path.");
    assert.equal(fakeOpenAi.calls[0].body.response_format, "mp3");

    const audioResponse = await fetch(new URL(firstPayload.audio.parts[0].url, baseUrl), {
      headers: { "tailscale-user-login": "tester@example.com" },
    });
    assert.equal(audioResponse.status, 200);
    assert.equal(await audioResponse.text(), "fake-mp3-1");

    const rangeResponse = await fetch(new URL(firstPayload.audio.parts[0].url, baseUrl), {
      headers: {
        "tailscale-user-login": "tester@example.com",
        range: "bytes=0-3",
      },
    });
    assert.equal(rangeResponse.status, 206);
    assert.equal(rangeResponse.headers.get("accept-ranges"), "bytes");
    assert.equal(rangeResponse.headers.get("content-range"), "bytes 0-3/10");
    assert.equal(await rangeResponse.text(), "fake");

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
    assert.equal(fakeOpenAi.calls.length, 1);
  } finally {
    await stopServer(child);
    await fakeOpenAi.close();
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
  const fakeOpenAi = await startFakeOpenAiSpeech();
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
      CLAWDAD_TTS_ENABLED: "true",
      CLAWDAD_TTS_PROVIDER: "openai",
      CLAWDAD_OPENAI_API_KEY: "server-key",
      CLAWDAD_OPENAI_TTS_BASE_URL: fakeOpenAi.baseUrl,
      CLAWDAD_OPENAI_TTS_VOICE: "cedar",
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
    assert.equal(fakeOpenAi.calls.length, 1);

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
    assert.equal(fakeOpenAi.calls.length, 1);
  } finally {
    await stopServer(child);
    await fakeOpenAi.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("history endpoints return saved audio metadata without synthesizing old responses", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-tts-history-no-prep-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "project");
  const sessionId = "session-history";
  const requestId = "request-history";
  const configPath = path.join(root, "server.json");
  const fakeOpenAi = await startFakeOpenAiSpeech();
  await writeTrackedHistoryFixture({
    home,
    projectPath,
    sessionId,
    requestId,
    message: "History should hydrate.",
    response: "This old response should not trigger speech generation.",
  });

  let child;
  try {
    const server = await startTtsServerFixture({ root, home, configPath, fakeOpenAi });
    child = server.child;
    const response = await fetch(
      `${server.baseUrl}/v1/history?project=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}&limit=5`,
      { headers: { "tailscale-user-login": "tester@example.com" } },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].response, "This old response should not trigger speech generation.");
    assert.equal(payload.items[0].audio?.response, undefined);
    assert.equal(fakeOpenAi.calls.length, 0);
  } finally {
    if (child) {
      await stopServer(child);
    }
    await fakeOpenAi.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("TTS insufficient-funds failures mark status unavailable and stop immediate retries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-tts-quota-breaker-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "project");
  const sessionId = "session-quota";
  const requestId = "request-quota";
  const configPath = path.join(root, "server.json");
  const fakeOpenAi = await startFakeOpenAiSpeech({
    status: 429,
    errorBody: JSON.stringify({
      error: {
        message: "You exceeded your current quota, please check your plan and billing details.",
      },
    }),
  });
  await writeTrackedHistoryFixture({
    home,
    projectPath,
    sessionId,
    requestId,
    response: "Quota should fail once.",
  });

  let child;
  try {
    const server = await startTtsServerFixture({
      root,
      home,
      configPath,
      fakeOpenAi,
      env: { CLAWDAD_TTS_UNAVAILABLE_RETRY_MS: "60000" },
    });
    child = server.child;
    const firstResponse = await fetch(`${server.baseUrl}/v1/tts/message`, {
      method: "POST",
      headers: server.headers,
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        requestId,
        kind: "response",
      }),
    });
    assert.equal(firstResponse.status, 402);
    const firstPayload = await firstResponse.json();
    assert.equal(firstPayload.ok, false);
    assert.equal(firstPayload.errorCode, "insufficient_funds");
    assert.match(firstPayload.error, /insufficient OpenAI funds or credits/u);
    assert.equal(firstPayload.ttsStatus.available, false);
    assert.equal(fakeOpenAi.calls.length, 1);

    const secondResponse = await fetch(`${server.baseUrl}/v1/tts/message`, {
      method: "POST",
      headers: server.headers,
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        requestId,
        kind: "response",
      }),
    });
    assert.equal(secondResponse.status, 402);
    const secondPayload = await secondResponse.json();
    assert.equal(secondPayload.errorCode, "insufficient_funds");
    assert.equal(fakeOpenAi.calls.length, 1);

    const statusResponse = await fetch(`${server.baseUrl}/v1/tts/status`, {
      headers: { "tailscale-user-login": "tester@example.com" },
    });
    assert.equal(statusResponse.status, 200);
    const statusPayload = await statusResponse.json();
    assert.equal(statusPayload.ttsStatus.available, false);
    assert.equal(statusPayload.ttsStatus.errorCode, "insufficient_funds");
  } finally {
    if (child) {
      await stopServer(child);
    }
    await fakeOpenAi.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("TTS message endpoint retries after insufficient-funds window clears", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-tts-quota-retry-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "project");
  const sessionId = "session-quota-retry";
  const requestId = "request-quota-retry";
  const configPath = path.join(root, "server.json");
  const fakeOpenAi = await startFakeOpenAiSpeech({
    status: [429, 200],
    errorBody: JSON.stringify({
      error: {
        message: "You exceeded your current quota, please check your plan and billing details.",
      },
    }),
  });
  await writeTrackedHistoryFixture({
    home,
    projectPath,
    sessionId,
    requestId,
    response: "Quota can recover.",
  });

  let child;
  try {
    const server = await startTtsServerFixture({
      root,
      home,
      configPath,
      fakeOpenAi,
      env: { CLAWDAD_TTS_UNAVAILABLE_RETRY_MS: "25" },
    });
    child = server.child;
    const firstResponse = await fetch(`${server.baseUrl}/v1/tts/message`, {
      method: "POST",
      headers: server.headers,
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        requestId,
        kind: "response",
      }),
    });
    assert.equal(firstResponse.status, 402);
    assert.equal(fakeOpenAi.calls.length, 1);

    await new Promise((resolve) => setTimeout(resolve, 60));

    const secondResponse = await fetch(`${server.baseUrl}/v1/tts/message`, {
      method: "POST",
      headers: server.headers,
      body: JSON.stringify({
        project: projectPath,
        sessionId,
        requestId,
        kind: "response",
      }),
    });
    assert.equal(secondResponse.status, 200);
    const secondPayload = await secondResponse.json();
    assert.equal(secondPayload.ok, true);
    assert.equal(secondPayload.audio.state, "ready");
    assert.equal(fakeOpenAi.calls.length, 2);
  } finally {
    if (child) {
      await stopServer(child);
    }
    await fakeOpenAi.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("read endpoint returns completed response without preparing audio", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-tts-read-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "project");
  const sessionId = "session-read";
  const requestId = "request-read";
  const configPath = path.join(root, "server.json");
  const fakeOpenAi = await startFakeOpenAiSpeech();
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
    message: "Say a short thing.",
    sentAt: "2026-05-06T10:00:00.000Z",
    answeredAt: "2026-05-06T10:00:10.000Z",
    status: "answered",
    exitCode: 0,
    response: "Ready to play.",
  });
  await writeJson(path.join(projectPath, ".clawdad", "history", "requests", `${requestId}.json`), {
    requestId,
    sessionId,
    sentAt: "2026-05-06T10:00:00.000Z",
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
      CLAWDAD_TTS_ENABLED: "true",
      CLAWDAD_TTS_PROVIDER: "openai",
      CLAWDAD_OPENAI_API_KEY: "server-key",
      CLAWDAD_OPENAI_TTS_BASE_URL: fakeOpenAi.baseUrl,
      CLAWDAD_OPENAI_TTS_VOICE: "cedar",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = { "tailscale-user-login": "tester@example.com" };
    await waitForHealth(baseUrl, child);

    const response = await fetch(
      `${baseUrl}/v1/read?project=${encodeURIComponent(projectPath)}&requestId=${encodeURIComponent(requestId)}&raw=1`,
      { headers },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.output, "Ready to play.");
    assert.equal(payload.historyItem.audio?.response, undefined);
    assert.equal(fakeOpenAi.calls.length, 0);

    const savedRecord = JSON.parse(await readFile(historyRecordFile, "utf8"));
    assert.equal(savedRecord.audio, undefined);

    const cachedResponse = await fetch(
      `${baseUrl}/v1/read?project=${encodeURIComponent(projectPath)}&requestId=${encodeURIComponent(requestId)}&raw=1`,
      { headers },
    );
    assert.equal(cachedResponse.status, 200);
    assert.equal(fakeOpenAi.calls.length, 0);
  } finally {
    await stopServer(child);
    await fakeOpenAi.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("read endpoint returns saved failed response audio without retrying", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-tts-read-fail-"));
  const home = path.join(root, "home");
  const projectPath = path.join(root, "project");
  const sessionId = "session-read-fail";
  const requestId = "request-read-fail";
  const configPath = path.join(root, "server.json");
  const fakeOpenAi = await startFakeOpenAiSpeech({ status: 500 });
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
    message: "Say a short thing.",
    sentAt: "2026-05-06T10:01:00.000Z",
    answeredAt: "2026-05-06T10:01:10.000Z",
    status: "answered",
    exitCode: 0,
    response: "Still visible.",
    audio: {
      response: {
        audioId: "failed-response-audio",
        state: "failed",
        provider: "doc-reader",
        voiceId: "af_heart",
        modelId: "kokoro",
        outputFormat: "wav",
        error: "Doc Reader local speech failed.",
        errorCode: "doc_reader_failed",
        parts: [],
      },
    },
  });
  await writeJson(path.join(projectPath, ".clawdad", "history", "requests", `${requestId}.json`), {
    requestId,
    sessionId,
    sentAt: "2026-05-06T10:01:00.000Z",
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
      CLAWDAD_TTS_ENABLED: "true",
      CLAWDAD_TTS_PROVIDER: "openai",
      CLAWDAD_OPENAI_API_KEY: "server-key",
      CLAWDAD_OPENAI_TTS_BASE_URL: fakeOpenAi.baseUrl,
      CLAWDAD_OPENAI_TTS_VOICE: "cedar",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = { "tailscale-user-login": "tester@example.com" };
    await waitForHealth(baseUrl, child);

    const response = await fetch(
      `${baseUrl}/v1/read?project=${encodeURIComponent(projectPath)}&requestId=${encodeURIComponent(requestId)}&raw=1`,
      { headers },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.output, "Still visible.");
    assert.equal(payload.historyItem.audio.response.state, "failed");
    assert.match(payload.historyItem.audio.response.error, /Doc Reader local speech failed/u);
    assert.equal(fakeOpenAi.calls.length, 0);

    const savedRecord = JSON.parse(await readFile(historyRecordFile, "utf8"));
    assert.equal(savedRecord.audio.response.state, "failed");
  } finally {
    await stopServer(child);
    await fakeOpenAi.close();
    await rm(root, { recursive: true, force: true });
  }
});
