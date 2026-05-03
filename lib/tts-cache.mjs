import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";

const execFileP = promisify(execFile);

export const defaultTtsProvider = "elevenlabs";
export const defaultElevenLabsBaseUrl = "https://api.elevenlabs.io";
export const defaultElevenLabsVoiceId = "JBFqnCBsd6RMkjVDRZzb";
export const defaultElevenLabsModelId = "eleven_multilingual_v2";
export const defaultElevenLabsOutputFormat = "mp3_44100_128";
export const defaultTtsChunkChars = 2400;
export const defaultTtsMaxChars = 80_000;

function pickString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return "";
}

function boolFromUnknown(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  }
  return fallback;
}

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }
  return Math.min(max, parsed);
}

function safeJsonObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function normalizeTtsText(value) {
  return String(value || "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{4,}/gu, "\n\n\n")
    .trim();
}

function splitOversizeText(value, chunkChars) {
  const chunks = [];
  let remaining = String(value || "").trim();
  while (remaining.length > chunkChars) {
    const windowText = remaining.slice(0, chunkChars + 1);
    const breakIndex = Math.max(
      windowText.lastIndexOf("\n"),
      windowText.lastIndexOf(". "),
      windowText.lastIndexOf("! "),
      windowText.lastIndexOf("? "),
      windowText.lastIndexOf("; "),
      windowText.lastIndexOf(", "),
      windowText.lastIndexOf(" "),
    );
    const cut = breakIndex >= Math.floor(chunkChars * 0.5) ? breakIndex + 1 : chunkChars;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

export function splitTtsText(value, { chunkChars = defaultTtsChunkChars } = {}) {
  const text = normalizeTtsText(value);
  if (!text) {
    return [];
  }

  const limit = positiveInteger(chunkChars, defaultTtsChunkChars, { min: 400, max: 8000 });
  const units = text
    .split(/(\n{2,})/u)
    .reduce((parts, part, index, source) => {
      if (index % 2 === 1) {
        return parts;
      }
      const separator = source[index + 1] || "";
      const normalized = `${part}${separator}`.trim();
      if (normalized) {
        parts.push(normalized);
      }
      return parts;
    }, []);

  const chunks = [];
  let current = "";

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) {
      chunks.push(trimmed);
    }
    current = "";
  };

  for (const unit of units) {
    if (unit.length > limit) {
      pushCurrent();
      chunks.push(...splitOversizeText(unit, limit));
      continue;
    }
    const next = current ? `${current}\n\n${unit}` : unit;
    if (next.length > limit) {
      pushCurrent();
      current = unit;
      continue;
    }
    current = next;
  }
  pushCurrent();
  return chunks;
}

export function createTtsAudioId({
  provider = defaultTtsProvider,
  voiceId = "",
  modelId = "",
  outputFormat = "",
  text = "",
} = {}) {
  const hash = crypto.createHash("sha256");
  hash.update(String(provider || defaultTtsProvider));
  hash.update("\0");
  hash.update(String(voiceId || ""));
  hash.update("\0");
  hash.update(String(modelId || ""));
  hash.update("\0");
  hash.update(String(outputFormat || ""));
  hash.update("\0");
  hash.update(normalizeTtsText(text));
  return hash.digest("hex").slice(0, 40);
}

export function safeTtsAudioId(value) {
  const normalized = String(value || "").trim();
  if (!/^[a-f0-9]{24,80}$/u.test(normalized)) {
    throw new Error("invalid audio id");
  }
  return normalized;
}

export function safeTtsPartName(value) {
  const normalized = String(value || "").trim();
  if (!/^part-\d{3}\.mp3$/u.test(normalized)) {
    throw new Error("invalid audio part");
  }
  return normalized;
}

export function ttsCacheRoot(projectPath) {
  return path.join(projectPath, ".clawdad", "audio", "messages");
}

export function ttsCachePaths(projectPath, audioId) {
  const safeAudioId = safeTtsAudioId(audioId);
  const audioDir = path.join(ttsCacheRoot(projectPath), safeAudioId);
  return {
    audioDir,
    manifestFile: path.join(audioDir, "manifest.json"),
  };
}

export function resolveTtsRuntimeConfig({ env = process.env, config = {} } = {}) {
  const ttsConfig = safeJsonObject(config.tts || config.textToSpeech);
  const elevenLabsConfig = safeJsonObject(ttsConfig.elevenlabs || ttsConfig.elevenLabs);
  const provider = pickString(
    env.CLAWDAD_TTS_PROVIDER,
    ttsConfig.provider,
    defaultTtsProvider,
  ).toLowerCase();
  const enabledSetting = pickString(
    env.CLAWDAD_TTS_ENABLED,
    ttsConfig.enabled == null ? "" : String(ttsConfig.enabled),
  );
  const enabled = enabledSetting ? boolFromUnknown(enabledSetting, true) : true;

  return {
    enabled,
    provider,
    voiceId: pickString(
      env.CLAWDAD_ELEVENLABS_VOICE_ID,
      env.ELEVENLABS_VOICE_ID,
      elevenLabsConfig.voiceId,
      ttsConfig.voiceId,
      defaultElevenLabsVoiceId,
    ),
    modelId: pickString(
      env.CLAWDAD_ELEVENLABS_MODEL_ID,
      env.ELEVENLABS_MODEL_ID,
      elevenLabsConfig.modelId,
      ttsConfig.modelId,
      defaultElevenLabsModelId,
    ),
    outputFormat: pickString(
      env.CLAWDAD_ELEVENLABS_OUTPUT_FORMAT,
      env.ELEVENLABS_OUTPUT_FORMAT,
      elevenLabsConfig.outputFormat,
      ttsConfig.outputFormat,
      defaultElevenLabsOutputFormat,
    ),
    baseUrl: pickString(
      env.CLAWDAD_ELEVENLABS_BASE_URL,
      env.ELEVENLABS_BASE_URL,
      elevenLabsConfig.baseUrl,
      defaultElevenLabsBaseUrl,
    ).replace(/\/+$/u, ""),
    chunkChars: positiveInteger(
      pickString(env.CLAWDAD_TTS_CHUNK_CHARS, String(ttsConfig.chunkChars || "")),
      defaultTtsChunkChars,
      { min: 400, max: 8000 },
    ),
    maxChars: positiveInteger(
      pickString(env.CLAWDAD_TTS_MAX_CHARS, String(ttsConfig.maxChars || "")),
      defaultTtsMaxChars,
      { min: 1000, max: 500_000 },
    ),
    voiceSettings: safeJsonObject(elevenLabsConfig.voiceSettings || ttsConfig.voiceSettings),
  };
}

async function readKeychainPassword(service, account, execFileImpl) {
  const args = ["find-generic-password", "-s", service];
  if (account) {
    args.push("-a", account);
  }
  args.push("-w");

  const result = await execFileImpl("security", args, {
    timeout: 1500,
    maxBuffer: 1024 * 1024,
  });
  return pickString(result?.stdout);
}

function plaintextFromOrpSecretPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }

  const nested = [
    payload.secret,
    payload.item,
    payload.result,
    payload.resolved,
  ].filter((value) => value && typeof value === "object" && !Array.isArray(value));

  return pickString(
    payload.value,
    payload.plaintext,
    payload.plaintextValue,
    payload.secretValue,
    payload.password,
    payload.apiKey,
    ...nested.flatMap((entry) => [
      entry.value,
      entry.plaintext,
      entry.plaintextValue,
      entry.secretValue,
      entry.password,
      entry.apiKey,
    ]),
  );
}

async function resolveOrpSecretValue({ env, execFileImpl, projectPath = "", args = [] }) {
  const orpBinary = pickString(env.CLAWDAD_ORP, env.ORP_BINARY, "orp");
  const fullArgs = [];
  if (projectPath) {
    fullArgs.push("--repo-root", projectPath);
  }
  fullArgs.push(...args);

  try {
    const result = await execFileImpl(orpBinary, fullArgs, {
      timeout: 3000,
      maxBuffer: 1024 * 1024,
    });
    const text = pickString(result?.stdout);
    if (!text) {
      return "";
    }
    try {
      const payload = JSON.parse(text);
      return plaintextFromOrpSecretPayload(payload);
    } catch (_error) {
      return text.startsWith("{") ? "" : text;
    }
  } catch (_error) {
    return "";
  }
}

async function resolveElevenLabsApiKeyFromOrp({ env, execFileImpl, projectPath = "" }) {
  const enabledSetting = pickString(env.CLAWDAD_ELEVENLABS_ORP_SECRETS_ENABLED);
  if (enabledSetting && !boolFromUnknown(enabledSetting, true)) {
    return "";
  }

  const provider = pickString(env.CLAWDAD_ELEVENLABS_ORP_PROVIDER, "elevenlabs");
  const configuredRef = pickString(env.CLAWDAD_ELEVENLABS_ORP_SECRET_REF);
  const refs = [
    configuredRef,
    "elevenlabs",
    "elevenlabs-api-key",
    "elevenlabs-primary",
    "ELEVENLABS_API_KEY",
  ].filter((value, index, source) => value && source.indexOf(value) === index);

  for (const ref of refs) {
    const localValue = await resolveOrpSecretValue({
      env,
      execFileImpl,
      projectPath,
      args: ["secrets", "resolve", ref, "--local-only", "--reveal", "--json"],
    });
    if (localValue) {
      return localValue;
    }
  }

  for (const ref of refs) {
    const value = await resolveOrpSecretValue({
      env,
      execFileImpl,
      projectPath,
      args: ["secrets", "resolve", ref, "--local-first", "--reveal", "--json"],
    });
    if (value) {
      return value;
    }
  }

  if (projectPath && provider) {
    return await resolveOrpSecretValue({
      env,
      execFileImpl,
      projectPath,
      args: [
        "secrets",
        "resolve",
        "--provider",
        provider,
        "--current-project",
        "--local-first",
        "--reveal",
        "--json",
      ],
    });
  }

  return "";
}

export async function resolveElevenLabsApiKey({
  env = process.env,
  platform = process.platform,
  execFileImpl = execFileP,
  projectPath = "",
} = {}) {
  const direct = pickString(env.CLAWDAD_ELEVENLABS_API_KEY, env.ELEVENLABS_API_KEY);
  if (direct) {
    return direct;
  }

  if (platform === "darwin") {
    const configuredService = pickString(env.CLAWDAD_ELEVENLABS_KEYCHAIN_SERVICE);
    const configuredAccount = pickString(env.CLAWDAD_ELEVENLABS_KEYCHAIN_ACCOUNT);
    const services = [
      configuredService,
      "clawdad-elevenlabs",
      "ELEVENLABS_API_KEY",
      "ElevenLabs",
      "elevenlabs",
    ].filter(Boolean);
    const accounts = [configuredAccount, "", "api-key", "apikey", os.userInfo().username]
      .filter((value, index, source) => source.indexOf(value) === index);

    for (const service of services) {
      for (const account of accounts) {
        try {
          const password = await readKeychainPassword(service, account, execFileImpl);
          if (password) {
            return password;
          }
        } catch (_error) {
          // Try the next conventional service/account pair.
        }
      }
    }
  }

  const orpValue = await resolveElevenLabsApiKeyFromOrp({
    env,
    execFileImpl,
    projectPath,
  });
  if (orpValue) {
    return orpValue;
  }

  return "";
}

async function writeAtomicBuffer(filePath, buffer) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    await writeFile(tempPath, buffer);
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function writeJson(filePath, payload) {
  await writeAtomicBuffer(filePath, Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8"));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function partExists(projectPath, audioId, partName) {
  const { audioDir } = ttsCachePaths(projectPath, audioId);
  try {
    const info = await stat(path.join(audioDir, safeTtsPartName(partName)));
    return info.isFile() && info.size > 0;
  } catch (_error) {
    return false;
  }
}

async function manifestIsReady(projectPath, manifest) {
  if (!manifest || manifest.state !== "ready" || !Array.isArray(manifest.parts) || manifest.parts.length === 0) {
    return false;
  }
  for (const part of manifest.parts) {
    if (!await partExists(projectPath, manifest.audioId, part.fileName)) {
      return false;
    }
  }
  return true;
}

export async function readTtsManifest(projectPath, audioId) {
  const { manifestFile } = ttsCachePaths(projectPath, audioId);
  try {
    return await readJson(manifestFile);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    return null;
  }
}

export async function synthesizeElevenLabsChunk({
  apiKey,
  baseUrl = defaultElevenLabsBaseUrl,
  voiceId = defaultElevenLabsVoiceId,
  modelId = defaultElevenLabsModelId,
  outputFormat = defaultElevenLabsOutputFormat,
  voiceSettings = {},
  text,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) {
    throw new Error("ElevenLabs API key is not configured");
  }
  if (!fetchImpl) {
    throw new Error("fetch is not available in this Node runtime");
  }

  const endpoint = new URL(`/v1/text-to-speech/${encodeURIComponent(voiceId)}`, `${baseUrl.replace(/\/+$/u, "")}/`);
  endpoint.searchParams.set("output_format", outputFormat);

  const body = {
    text: normalizeTtsText(text),
    model_id: modelId,
  };
  if (Object.keys(safeJsonObject(voiceSettings)).length > 0) {
    body.voice_settings = safeJsonObject(voiceSettings);
  }

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      accept: "audio/mpeg",
      "content-type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    const detailText = details ? `: ${details.slice(0, 500)}` : "";
    throw new Error(`ElevenLabs TTS failed with HTTP ${response.status}${detailText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function ensureCachedTtsAudio({
  projectPath,
  text,
  source = {},
  config = {},
  apiKey,
  fetchImpl,
  now = () => new Date(),
} = {}) {
  const runtimeConfig = {
    ...resolveTtsRuntimeConfig({ config: { tts: config } }),
    ...config,
  };
  if (runtimeConfig.enabled === false) {
    throw new Error("Text-to-speech is disabled on this Clawdad server");
  }
  if (runtimeConfig.provider !== defaultTtsProvider) {
    throw new Error(`unsupported TTS provider '${runtimeConfig.provider}'`);
  }

  const normalizedText = normalizeTtsText(text);
  if (!normalizedText) {
    throw new Error("missing text to speak");
  }
  if (normalizedText.length > runtimeConfig.maxChars) {
    throw new Error(`message is too long for TTS (${normalizedText.length} chars, limit ${runtimeConfig.maxChars})`);
  }

  const chunks = splitTtsText(normalizedText, { chunkChars: runtimeConfig.chunkChars });
  const audioId = createTtsAudioId({
    provider: runtimeConfig.provider,
    voiceId: runtimeConfig.voiceId,
    modelId: runtimeConfig.modelId,
    outputFormat: runtimeConfig.outputFormat,
    text: normalizedText,
  });
  const paths = ttsCachePaths(projectPath, audioId);
  const cachedManifest = await readTtsManifest(projectPath, audioId);
  if (await manifestIsReady(projectPath, cachedManifest)) {
    return {
      cached: true,
      manifest: cachedManifest,
    };
  }

  await mkdir(paths.audioDir, { recursive: true });
  const startedAt = now().toISOString();
  const baseManifest = {
    schema: "clawdad.tts-message/1",
    state: "generating",
    audioId,
    provider: runtimeConfig.provider,
    voiceId: runtimeConfig.voiceId,
    modelId: runtimeConfig.modelId,
    outputFormat: runtimeConfig.outputFormat,
    textHash: crypto.createHash("sha256").update(normalizedText).digest("hex"),
    charCount: normalizedText.length,
    chunkCount: chunks.length,
    source: safeJsonObject(source),
    createdAt: cachedManifest?.createdAt || startedAt,
    updatedAt: startedAt,
    parts: [],
  };
  await writeJson(paths.manifestFile, baseManifest);

  const parts = [];
  try {
    for (const [index, chunk] of chunks.entries()) {
      const fileName = `part-${String(index + 1).padStart(3, "0")}.mp3`;
      const audio = await synthesizeElevenLabsChunk({
        apiKey,
        baseUrl: runtimeConfig.baseUrl,
        voiceId: runtimeConfig.voiceId,
        modelId: runtimeConfig.modelId,
        outputFormat: runtimeConfig.outputFormat,
        voiceSettings: runtimeConfig.voiceSettings,
        text: chunk,
        fetchImpl,
      });
      const filePath = path.join(paths.audioDir, fileName);
      await writeAtomicBuffer(filePath, audio);
      parts.push({
        index: index + 1,
        fileName,
        bytes: audio.length,
        charCount: chunk.length,
      });
      await writeJson(paths.manifestFile, {
        ...baseManifest,
        updatedAt: now().toISOString(),
        parts,
      });
    }

    const manifest = {
      ...baseManifest,
      state: "ready",
      updatedAt: now().toISOString(),
      parts,
    };
    await writeJson(paths.manifestFile, manifest);
    return {
      cached: false,
      manifest,
    };
  } catch (error) {
    await writeJson(paths.manifestFile, {
      ...baseManifest,
      state: "failed",
      updatedAt: now().toISOString(),
      error: error.message,
      parts,
    }).catch(() => {});
    throw error;
  }
}

export function ttsAudioFilePath(projectPath, audioId, partName) {
  const { audioDir } = ttsCachePaths(projectPath, audioId);
  return path.join(audioDir, safeTtsPartName(partName));
}
