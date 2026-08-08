import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";

export const openAiTtsProvider = "openai";
export const docReaderTtsProvider = "doc-reader";
export const defaultTtsProvider = docReaderTtsProvider;
export const defaultDocReaderLibraryBaseUrl = "http://127.0.0.1:8766";
export const defaultDocReaderTtsBaseUrl = "http://100.72.151.28:8771";
export const defaultDocReaderTtsFallbackUrl = "http://127.0.0.1:8772";
export const defaultDocReaderTtsEngine = "kokoro";
export const defaultDocReaderTtsVoice = "af_heart";
export const defaultDocReaderTtsOutputFormat = "wav";
export const defaultDocReaderTtsTimeoutMs = 45_000;
export const defaultOpenAiTtsBaseUrl = "https://api.openai.com";
export const defaultOpenAiTtsVoice = "cedar";
export const defaultOpenAiTtsModelId = "gpt-4o-mini-tts";
export const defaultOpenAiTtsOutputFormat = "mp3";
export const defaultOpenAiTtsInstructions =
  "Speak clearly in a warm, concise, natural software assistant voice.";
export const defaultTtsChunkChars = 2400;
export const defaultTtsMaxChars = 80_000;

const supportedTtsOutputFormats = new Set(["mp3", "opus", "aac", "flac", "wav"]);

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

function normalizeBaseUrl(value, fallback = defaultOpenAiTtsBaseUrl) {
  return pickString(value, fallback).replace(/\/+$/u, "");
}

function normalizeTtsOutputFormat(value, fallback = defaultOpenAiTtsOutputFormat) {
  const normalized = String(value || "").trim().toLowerCase();
  return supportedTtsOutputFormats.has(normalized) ? normalized : fallback;
}

function normalizeTtsProvider(value) {
  const normalized = pickString(value, defaultTtsProvider).toLowerCase();
  if (["docreader", "doc_reader", "local", "local-speech"].includes(normalized)) {
    return docReaderTtsProvider;
  }
  if (["open-ai", "open_ai"].includes(normalized)) {
    return openAiTtsProvider;
  }
  return normalized;
}

export function ttsFileExtensionForOutputFormat(value) {
  return normalizeTtsOutputFormat(value);
}

export function ttsMimeTypeForOutputFormat(value) {
  switch (normalizeTtsOutputFormat(value)) {
    case "aac":
      return "audio/aac";
    case "flac":
      return "audio/flac";
    case "opus":
      return "audio/ogg";
    case "wav":
      return "audio/wav";
    case "mp3":
    default:
      return "audio/mpeg";
  }
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
  if (!/^part-\d{3}\.(?:mp3|opus|aac|flac|wav)$/u.test(normalized)) {
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
  const openAiConfig = safeJsonObject(ttsConfig.openai || ttsConfig.openAi || ttsConfig.openAI);
  const docReaderConfig = safeJsonObject(
    ttsConfig.docReader || ttsConfig.docreader || ttsConfig.doc_reader || ttsConfig.local,
  );
  const provider = normalizeTtsProvider(pickString(
    env.CLAWDAD_TTS_PROVIDER,
    ttsConfig.provider,
    defaultTtsProvider,
  ));
  const enabledSetting = pickString(
    env.CLAWDAD_TTS_ENABLED,
    ttsConfig.enabled == null ? "" : String(ttsConfig.enabled),
  );
  const enabled = enabledSetting ? boolFromUnknown(enabledSetting, true) : true;
  const chunkChars = positiveInteger(
    pickString(env.CLAWDAD_TTS_CHUNK_CHARS, String(ttsConfig.chunkChars || "")),
    defaultTtsChunkChars,
    { min: 400, max: 8000 },
  );
  const maxChars = positiveInteger(
    pickString(env.CLAWDAD_TTS_MAX_CHARS, String(ttsConfig.maxChars || "")),
    defaultTtsMaxChars,
    { min: 1000, max: 500_000 },
  );

  if (provider === docReaderTtsProvider) {
    const engine = pickString(
      env.CLAWDAD_DOC_READER_TTS_ENGINE,
      env.CLAWDAD_DOCREADER_TTS_ENGINE,
      env.CLAWDAD_TTS_ENGINE,
      docReaderConfig.engine,
      ttsConfig.engine,
      defaultDocReaderTtsEngine,
    );
    const libraryUrl = normalizeBaseUrl(
      pickString(
        env.CLAWDAD_DOC_READER_URL,
        env.CLAWDAD_DOCREADER_URL,
        env.CLAWDAD_DOC_READER_LIBRARY_URL,
        env.CLAWDAD_DOCREADER_LIBRARY_URL,
        docReaderConfig.libraryUrl,
        docReaderConfig.webUrl,
        docReaderConfig.appUrl,
        ttsConfig.libraryUrl,
        defaultDocReaderLibraryBaseUrl,
      ),
      defaultDocReaderLibraryBaseUrl,
    );
    const baseUrl = normalizeBaseUrl(
      pickString(
        env.CLAWDAD_DOC_READER_TTS_URL,
        env.CLAWDAD_DOCREADER_TTS_URL,
        env.CLAWDAD_TTS_BASE_URL,
        docReaderConfig.baseUrl,
        docReaderConfig.url,
        ttsConfig.baseUrl,
        defaultDocReaderTtsBaseUrl,
      ),
      defaultDocReaderTtsBaseUrl,
    );
    const fallbackUrl = normalizeBaseUrl(
      pickString(
        env.CLAWDAD_DOC_READER_TTS_FALLBACK_URL,
        env.CLAWDAD_DOCREADER_TTS_FALLBACK_URL,
        docReaderConfig.fallbackUrl,
        docReaderConfig.fallbackBaseUrl,
        ttsConfig.fallbackUrl,
        defaultDocReaderTtsFallbackUrl,
      ),
      "",
    );
    return {
      enabled,
      provider,
      voiceId: pickString(
        env.CLAWDAD_DOC_READER_TTS_VOICE,
        env.CLAWDAD_DOCREADER_TTS_VOICE,
        env.CLAWDAD_TTS_VOICE,
        docReaderConfig.voice,
        docReaderConfig.voiceId,
        ttsConfig.voice,
        ttsConfig.voiceId,
        defaultDocReaderTtsVoice,
      ),
      modelId: pickString(
        env.CLAWDAD_DOC_READER_TTS_MODEL,
        env.CLAWDAD_DOCREADER_TTS_MODEL,
        docReaderConfig.model,
        docReaderConfig.modelId,
        engine,
      ),
      engine,
      libraryUrl,
      outputFormat: defaultDocReaderTtsOutputFormat,
      baseUrl,
      fallbackUrl,
      requestTimeoutMs: positiveInteger(
        pickString(
          env.CLAWDAD_DOC_READER_TTS_TIMEOUT_MS,
          env.CLAWDAD_DOCREADER_TTS_TIMEOUT_MS,
          env.CLAWDAD_TTS_REQUEST_TIMEOUT_MS,
          String(docReaderConfig.requestTimeoutMs || docReaderConfig.timeoutMs || ""),
          String(ttsConfig.requestTimeoutMs || ttsConfig.timeoutMs || ""),
        ),
        defaultDocReaderTtsTimeoutMs,
        { min: 1000, max: 10 * 60 * 1000 },
      ),
      chunkChars,
      maxChars,
      instructions: pickString(
        env.CLAWDAD_DOC_READER_TTS_INSTRUCTIONS,
        env.CLAWDAD_TTS_INSTRUCTIONS,
        docReaderConfig.instructions,
        ttsConfig.instructions,
      ),
    };
  }

  return {
    enabled,
    provider,
    voiceId: pickString(
      env.CLAWDAD_OPENAI_TTS_VOICE,
      env.CLAWDAD_TTS_VOICE,
      openAiConfig.voice,
      openAiConfig.voiceId,
      ttsConfig.voice,
      ttsConfig.voiceId,
      defaultOpenAiTtsVoice,
    ),
    modelId: pickString(
      env.CLAWDAD_OPENAI_TTS_MODEL,
      env.CLAWDAD_TTS_MODEL,
      openAiConfig.model,
      openAiConfig.modelId,
      ttsConfig.model,
      ttsConfig.modelId,
      defaultOpenAiTtsModelId,
    ),
    outputFormat: normalizeTtsOutputFormat(
      pickString(
        env.CLAWDAD_OPENAI_TTS_RESPONSE_FORMAT,
        env.CLAWDAD_TTS_RESPONSE_FORMAT,
        openAiConfig.responseFormat,
        openAiConfig.outputFormat,
        ttsConfig.responseFormat,
        ttsConfig.outputFormat,
        defaultOpenAiTtsOutputFormat,
      ),
    ),
    baseUrl: normalizeBaseUrl(
      pickString(
        env.CLAWDAD_OPENAI_TTS_BASE_URL,
        env.CLAWDAD_OPENAI_BASE_URL,
        env.OPENAI_BASE_URL,
        openAiConfig.baseUrl,
        ttsConfig.baseUrl,
        defaultOpenAiTtsBaseUrl,
      ),
      defaultOpenAiTtsBaseUrl,
    ),
    fallbackUrl: "",
    engine: "",
    chunkChars,
    maxChars,
    instructions: pickString(
      env.CLAWDAD_OPENAI_TTS_INSTRUCTIONS,
      env.CLAWDAD_TTS_INSTRUCTIONS,
      openAiConfig.instructions,
      ttsConfig.instructions,
      defaultOpenAiTtsInstructions,
    ),
  };
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

export async function synthesizeOpenAiSpeechChunk({
  apiKey,
  baseUrl = defaultOpenAiTtsBaseUrl,
  voiceId = defaultOpenAiTtsVoice,
  modelId = defaultOpenAiTtsModelId,
  outputFormat = defaultOpenAiTtsOutputFormat,
  instructions = "",
  text,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) {
    throw new Error("OpenAI API key is not configured");
  }
  if (!fetchImpl) {
    throw new Error("fetch is not available for OpenAI speech generation");
  }

  const body = {
    model: pickString(modelId, defaultOpenAiTtsModelId),
    voice: pickString(voiceId, defaultOpenAiTtsVoice),
    input: normalizeTtsText(text),
    response_format: normalizeTtsOutputFormat(outputFormat),
  };
  const resolvedInstructions = pickString(instructions);
  if (resolvedInstructions) {
    body.instructions = resolvedInstructions;
  }

  const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/v1/audio/speech`, {
    method: "POST",
    headers: {
      accept: ttsMimeTypeForOutputFormat(body.response_format),
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    let detail = details;
    try {
      const payload = JSON.parse(details);
      detail = pickString(payload?.error?.message, payload?.message, details);
    } catch (_error) {
      // Keep raw response text when it is not JSON.
    }
    const detailText = detail ? `: ${detail.slice(0, 500)}` : "";
    throw new Error(`OpenAI TTS request failed with status ${response.status}${detailText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function readErrorDetail(response) {
  const details = await response.text().catch(() => "");
  if (!details) {
    return "";
  }
  try {
    const payload = JSON.parse(details);
    return pickString(payload?.error?.message, payload?.message, details);
  } catch (_error) {
    return details;
  }
}

async function synthesizeDocReaderSpeechFromUrl({
  baseUrl,
  engine = defaultDocReaderTtsEngine,
  voiceId = defaultDocReaderTtsVoice,
  requestTimeoutMs = defaultDocReaderTtsTimeoutMs,
  text,
  fetchImpl,
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl, "");
  if (!normalizedBaseUrl) {
    throw new Error("Doc Reader TTS URL is not configured");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), positiveInteger(
    requestTimeoutMs,
    defaultDocReaderTtsTimeoutMs,
    { min: 1000, max: 10 * 60 * 1000 },
  ));
  let response;
  try {
    response = await fetchImpl(`${normalizedBaseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: {
        accept: "audio/wav",
        "content-type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        engine: pickString(engine, defaultDocReaderTtsEngine),
        voice: pickString(voiceId, defaultDocReaderTtsVoice),
        text: normalizeTtsText(text),
      }),
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Doc Reader TTS request timed out after ${requestTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    const detailText = detail ? `: ${detail.slice(0, 500)}` : "";
    throw new Error(`Doc Reader TTS request failed with status ${response.status}${detailText}`);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0) {
    throw new Error("Doc Reader TTS response did not include audio");
  }
  return audio;
}

export async function synthesizeDocReaderSpeechChunk({
  baseUrl = defaultDocReaderTtsBaseUrl,
  fallbackUrl = defaultDocReaderTtsFallbackUrl,
  engine = defaultDocReaderTtsEngine,
  voiceId = defaultDocReaderTtsVoice,
  requestTimeoutMs = defaultDocReaderTtsTimeoutMs,
  text,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!fetchImpl) {
    throw new Error("fetch is not available for Doc Reader speech generation");
  }

  const urls = [baseUrl, fallbackUrl]
    .map((value) => normalizeBaseUrl(value, ""))
    .filter((value, index, source) => value && source.indexOf(value) === index);
  if (urls.length === 0) {
    throw new Error("Doc Reader TTS URL is not configured");
  }

  const failures = [];
  for (const url of urls) {
    try {
      return await synthesizeDocReaderSpeechFromUrl({
        baseUrl: url,
        engine,
        voiceId,
        requestTimeoutMs,
        text,
        fetchImpl,
      });
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    }
  }

  if (failures.length === 1) {
    throw new Error(failures[0]);
  }
  throw new Error(`Doc Reader TTS request failed for all local services: ${failures.join("; ")}`);
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
  runtimeConfig.provider = normalizeTtsProvider(runtimeConfig.provider);
  if (![docReaderTtsProvider, openAiTtsProvider].includes(runtimeConfig.provider)) {
    throw new Error(`unsupported TTS provider '${runtimeConfig.provider}'`);
  }
  if (runtimeConfig.provider === docReaderTtsProvider) {
    runtimeConfig.outputFormat = defaultDocReaderTtsOutputFormat;
    runtimeConfig.engine = pickString(runtimeConfig.engine, runtimeConfig.modelId, defaultDocReaderTtsEngine);
    runtimeConfig.modelId = pickString(runtimeConfig.modelId, runtimeConfig.engine);
    runtimeConfig.voiceId = pickString(runtimeConfig.voiceId, defaultDocReaderTtsVoice);
    runtimeConfig.baseUrl = normalizeBaseUrl(runtimeConfig.baseUrl, defaultDocReaderTtsBaseUrl);
    runtimeConfig.fallbackUrl = normalizeBaseUrl(runtimeConfig.fallbackUrl, "");
    runtimeConfig.requestTimeoutMs = positiveInteger(
      runtimeConfig.requestTimeoutMs,
      defaultDocReaderTtsTimeoutMs,
      { min: 1000, max: 10 * 60 * 1000 },
    );
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
      const fileName = `part-${String(index + 1).padStart(3, "0")}.${ttsFileExtensionForOutputFormat(runtimeConfig.outputFormat)}`;
      const audio = runtimeConfig.provider === docReaderTtsProvider
        ? await synthesizeDocReaderSpeechChunk({
          baseUrl: runtimeConfig.baseUrl,
          fallbackUrl: runtimeConfig.fallbackUrl,
          engine: runtimeConfig.engine,
          voiceId: runtimeConfig.voiceId,
          requestTimeoutMs: runtimeConfig.requestTimeoutMs,
          text: chunk,
          fetchImpl,
        })
        : await synthesizeOpenAiSpeechChunk({
          apiKey,
          baseUrl: runtimeConfig.baseUrl,
          voiceId: runtimeConfig.voiceId,
          modelId: runtimeConfig.modelId,
          outputFormat: runtimeConfig.outputFormat,
          instructions: runtimeConfig.instructions,
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
