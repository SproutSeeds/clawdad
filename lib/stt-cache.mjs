import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export const openAiSttProvider = "openai";
export const docReaderSttProvider = "doc-reader";
export const defaultSttProvider = docReaderSttProvider;
export const defaultDocReaderSttBaseUrl = "http://127.0.0.1:8772";
export const defaultDocReaderSttFallbackUrl = "http://127.0.0.1:8766";
export const defaultDocReaderSttEndpointPath = "/v1/audio/transcriptions";
export const defaultDocReaderSttFallbackEndpointPath = "/api/transcribe";
export const defaultDocReaderTranscriptionModel = "large-v3";
export const defaultOpenAiBaseUrl = "https://api.openai.com";
export const defaultOpenAiTranscriptionModel = "gpt-4o-transcribe";
export const defaultSttMaxBytes = 25 * 1024 * 1024;

const supportedAudioExtensions = new Set([
  "m4a",
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "wav",
  "webm",
]);

const supportedAudioMimeTypes = new Set([
  "audio/m4a",
  "audio/mp3",
  "audio/mp4",
  "audio/mpeg",
  "audio/mpga",
  "audio/wav",
  "audio/wave",
  "audio/webm",
  "video/mp4",
  "video/webm",
]);

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

function normalizeBaseUrl(value, fallback = defaultOpenAiBaseUrl) {
  return pickString(value, fallback).replace(/\/+$/u, "");
}

function normalizePath(value, fallback = "/") {
  const path = pickString(value, fallback);
  return path.startsWith("/") ? path : `/${path}`;
}

function normalizeSttProvider(value) {
  const normalized = pickString(value, defaultSttProvider).toLowerCase();
  if (["docreader", "doc_reader", "local", "local-speech"].includes(normalized)) {
    return docReaderSttProvider;
  }
  if (["open-ai", "open_ai"].includes(normalized)) {
    return openAiSttProvider;
  }
  return normalized;
}

export function resolveSttRuntimeConfig({ env = process.env, config = {} } = {}) {
  const sttConfig = safeJsonObject(config.stt || config.speechToText);
  const openAiConfig = safeJsonObject(sttConfig.openai || sttConfig.openAi || sttConfig.openAI);
  const docReaderConfig = safeJsonObject(
    sttConfig.docReader || sttConfig.docreader || sttConfig.doc_reader || sttConfig.local,
  );
  const provider = normalizeSttProvider(pickString(
    env.CLAWDAD_STT_PROVIDER,
    sttConfig.provider,
    defaultSttProvider,
  ));
  const enabledSetting = pickString(
    env.CLAWDAD_STT_ENABLED,
    sttConfig.enabled == null ? "" : String(sttConfig.enabled),
  );
  const enabled = enabledSetting ? boolFromUnknown(enabledSetting, true) : true;
  const maxBytes = positiveInteger(
    pickString(env.CLAWDAD_STT_MAX_BYTES, String(sttConfig.maxBytes || "")),
    defaultSttMaxBytes,
    { min: 1024, max: defaultSttMaxBytes },
  );

  if (provider === docReaderSttProvider) {
    const configuredBaseUrl = pickString(
      env.CLAWDAD_DOC_READER_STT_URL,
      env.CLAWDAD_DOCREADER_STT_URL,
      env.CLAWDAD_DOC_READER_URL,
      env.CLAWDAD_DOCREADER_URL,
      env.CLAWDAD_DOC_READER_TTS_URL,
      env.CLAWDAD_DOCREADER_TTS_URL,
      env.CLAWDAD_STT_BASE_URL,
      docReaderConfig.baseUrl,
      docReaderConfig.url,
    );
    return {
      enabled,
      provider,
      modelId: pickString(
        env.CLAWDAD_DOC_READER_STT_MODEL,
        env.CLAWDAD_DOCREADER_STT_MODEL,
        env.CLAWDAD_STT_MODEL,
        docReaderConfig.modelId,
        docReaderConfig.model,
        sttConfig.modelId,
        sttConfig.model,
        defaultDocReaderTranscriptionModel,
      ),
      baseUrl: normalizeBaseUrl(
        pickString(configuredBaseUrl, defaultDocReaderSttBaseUrl),
        defaultDocReaderSttBaseUrl,
      ),
      fallbackUrl: normalizeBaseUrl(
        pickString(
          env.CLAWDAD_DOC_READER_STT_FALLBACK_URL,
          env.CLAWDAD_DOCREADER_STT_FALLBACK_URL,
          env.CLAWDAD_STT_FALLBACK_URL,
          docReaderConfig.fallbackUrl,
          docReaderConfig.fallbackBaseUrl,
          configuredBaseUrl ? "" : defaultDocReaderSttFallbackUrl,
        ),
        "",
      ),
      endpointPath: normalizePath(
        pickString(env.CLAWDAD_DOC_READER_STT_ENDPOINT, env.CLAWDAD_STT_ENDPOINT, docReaderConfig.endpointPath),
        defaultDocReaderSttEndpointPath,
      ),
      fallbackEndpointPath: normalizePath(
        pickString(
          env.CLAWDAD_DOC_READER_STT_FALLBACK_ENDPOINT,
          env.CLAWDAD_STT_FALLBACK_ENDPOINT,
          docReaderConfig.fallbackEndpointPath,
        ),
        defaultDocReaderSttFallbackEndpointPath,
      ),
      maxBytes,
      prompt: pickString(env.CLAWDAD_STT_PROMPT, docReaderConfig.prompt, sttConfig.prompt),
      language: pickString(
        env.CLAWDAD_DOC_READER_STT_LANGUAGE,
        env.CLAWDAD_DOCREADER_STT_LANGUAGE,
        env.CLAWDAD_STT_LANGUAGE,
        docReaderConfig.language,
        sttConfig.language,
      ),
    };
  }

  return {
    enabled,
    provider,
    modelId: pickString(
      env.CLAWDAD_STT_MODEL,
      env.CLAWDAD_OPENAI_TRANSCRIBE_MODEL,
      openAiConfig.modelId,
      openAiConfig.model,
      sttConfig.modelId,
      sttConfig.model,
      defaultOpenAiTranscriptionModel,
    ),
    baseUrl: normalizeBaseUrl(
      pickString(
        env.CLAWDAD_OPENAI_BASE_URL,
        env.OPENAI_BASE_URL,
        openAiConfig.baseUrl,
        sttConfig.baseUrl,
        defaultOpenAiBaseUrl,
      ),
      defaultOpenAiBaseUrl,
    ),
    maxBytes,
    prompt: pickString(
      env.CLAWDAD_STT_PROMPT,
      openAiConfig.prompt,
      sttConfig.prompt,
      "Transcribe this Clawdad voice note for a software project message. Preserve technical names, punctuation, and concise natural wording.",
    ),
    language: pickString(env.CLAWDAD_STT_LANGUAGE, openAiConfig.language, sttConfig.language),
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

async function resolveOpenAiApiKeyFromOrp({ env, execFileImpl, projectPath = "" }) {
  const enabledSetting = pickString(env.CLAWDAD_OPENAI_ORP_SECRETS_ENABLED);
  if (enabledSetting && !boolFromUnknown(enabledSetting, true)) {
    return "";
  }

  const provider = pickString(env.CLAWDAD_OPENAI_ORP_PROVIDER, "openai");
  const configuredRef = pickString(env.CLAWDAD_OPENAI_ORP_SECRET_REF);
  const refs = [configuredRef].filter(Boolean);
  if (refs.length === 0) {
    return "";
  }

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

export async function resolveOpenAiApiKey({
  env = process.env,
  platform = process.platform,
  execFileImpl = execFileP,
  projectPath = "",
} = {}) {
  const direct = pickString(env.CLAWDAD_OPENAI_API_KEY, env.OPENAI_API_KEY);
  if (direct) {
    return direct;
  }

  if (platform === "darwin") {
    const configuredService = pickString(env.CLAWDAD_OPENAI_KEYCHAIN_SERVICE);
    const configuredAccount = pickString(env.CLAWDAD_OPENAI_KEYCHAIN_ACCOUNT);
    const services = [
      configuredService,
      "clawdad-openai",
      "OPENAI_API_KEY",
      "OpenAI",
      "openai",
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

  const orpValue = await resolveOpenAiApiKeyFromOrp({
    env,
    execFileImpl,
    projectPath,
  });
  if (orpValue) {
    return orpValue;
  }

  return "";
}

function extensionFromFileName(fileName) {
  const match = String(fileName || "").toLowerCase().match(/\.([a-z0-9]+)$/u);
  return match?.[1] || "";
}

export function sttAudioFileIsSupported({ fileName = "", mimeType = "" } = {}) {
  const normalizedMime = String(mimeType || "").split(";")[0].trim().toLowerCase();
  const extension = extensionFromFileName(fileName);
  return supportedAudioMimeTypes.has(normalizedMime) || supportedAudioExtensions.has(extension);
}

export function sttErrorStatusCode(error) {
  const message = String(error?.message || "");
  if (/disabled|unsupported|exceeds|missing|required|invalid/iu.test(message)) {
    return 400;
  }
  if (/api key|not configured/iu.test(message)) {
    return 409;
  }
  if (/openai.*(?:failed|rejected)|transcription request failed|status \d{3}/iu.test(message)) {
    return 502;
  }
  if (/doc reader|local speech|fetch failed|econnrefused|econnreset|enotfound/iu.test(message)) {
    return 502;
  }
  return 500;
}

export async function transcribeOpenAiAudio({
  apiKey,
  config = {},
  audio,
  fileName = "clawdad-voice.webm",
  mimeType = "audio/webm",
  prompt = "",
  language = "",
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) {
    throw new Error("OpenAI API key is not configured");
  }
  if (!fetchImpl) {
    throw new Error("fetch is not available for OpenAI transcription");
  }
  const buffer = Buffer.isBuffer(audio) ? audio : Buffer.from(audio || "");
  if (buffer.length === 0) {
    throw new Error("missing audio");
  }

  const modelId = pickString(config.modelId, defaultOpenAiTranscriptionModel);
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
  form.append("file", blob, fileName || "clawdad-voice.webm");
  form.append("model", modelId);
  form.append("response_format", "json");
  const resolvedPrompt = pickString(prompt, config.prompt);
  if (resolvedPrompt) {
    form.append("prompt", resolvedPrompt);
  }
  const resolvedLanguage = pickString(language, config.language);
  if (resolvedLanguage) {
    form.append("language", resolvedLanguage);
  }

  const response = await fetchImpl(`${baseUrl}/v1/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text();

  if (!response.ok) {
    const detail = typeof body === "string"
      ? body
      : pickString(body?.error?.message, body?.message, JSON.stringify(body));
    throw new Error(`OpenAI transcription request failed with status ${response.status}: ${detail.slice(0, 500)}`);
  }

  const text = typeof body === "string" ? body : pickString(body?.text, body?.transcript);
  if (!text) {
    throw new Error("OpenAI transcription response did not include text");
  }

  return {
    text,
    modelId,
    provider: openAiSttProvider,
  };
}

export async function transcribeDocReaderAudio({
  config = {},
  audio,
  fileName = "clawdad-voice.webm",
  mimeType = "audio/webm",
  language = "",
  source = "clawdad",
  sourceItemId = "",
  sourceMeta = {},
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!fetchImpl) {
    throw new Error("fetch is not available for local speech transcription");
  }
  const buffer = Buffer.isBuffer(audio) ? audio : Buffer.from(audio || "");
  if (buffer.length === 0) {
    throw new Error("missing audio");
  }

  const modelId = pickString(config.modelId, defaultDocReaderTranscriptionModel);
  const baseUrl = normalizeBaseUrl(config.baseUrl, defaultDocReaderSttBaseUrl);
  const fallbackUrl = normalizeBaseUrl(config.fallbackUrl, "");
  const resolvedLanguage = pickString(language, config.language);
  const headers = {
    accept: "application/json",
    "content-type": pickString(mimeType, "application/octet-stream"),
    "x-doc-reader-filename": pickString(fileName, "clawdad-voice.webm"),
    "x-doc-reader-source": pickString(source, "clawdad"),
  };
  const resolvedSourceItemId = pickString(sourceItemId);
  if (resolvedSourceItemId) {
    headers["x-doc-reader-source-item-id"] = resolvedSourceItemId;
  }
  const meta = safeJsonObject(sourceMeta);
  if (meta.projectPath || meta.project) {
    headers["x-doc-reader-project"] = pickString(meta.projectPath, meta.project);
  }
  if (meta.sessionId) {
    headers["x-doc-reader-session-id"] = pickString(meta.sessionId);
  }
  if (meta.requestId) {
    headers["x-doc-reader-request-id"] = pickString(meta.requestId);
  }
  if (resolvedLanguage) {
    headers["x-doc-reader-language"] = resolvedLanguage;
  }

  const candidates = [];
  const addCandidate = (url, endpointPath) => {
    const normalizedUrl = normalizeBaseUrl(url, "");
    if (!normalizedUrl) return;
    const normalizedEndpoint = normalizePath(endpointPath, defaultDocReaderSttEndpointPath);
    if (candidates.some((candidate) => candidate.url === normalizedUrl && candidate.endpointPath === normalizedEndpoint)) {
      return;
    }
    candidates.push({ url: normalizedUrl, endpointPath: normalizedEndpoint });
  };
  addCandidate(baseUrl, pickString(config.endpointPath, defaultDocReaderSttEndpointPath));
  addCandidate(baseUrl, pickString(config.legacyEndpointPath, defaultDocReaderSttFallbackEndpointPath));
  addCandidate(fallbackUrl, pickString(config.fallbackEndpointPath, defaultDocReaderSttFallbackEndpointPath));
  addCandidate(fallbackUrl, pickString(config.endpointPath, defaultDocReaderSttEndpointPath));

  let lastMissingError = null;
  let body = null;
  let response = null;
  let serviceUrl = "";
  for (const candidate of candidates) {
    response = await fetchImpl(`${candidate.url}${candidate.endpointPath}`, {
      method: "POST",
      headers,
      body: buffer,
    });
    const contentType = response.headers.get("content-type") || "";
    body = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : await response.text();
    serviceUrl = candidate.url;
    if (response.ok) {
      break;
    }
    const detail = typeof body === "string"
      ? body
      : pickString(body?.error?.message, body?.message, JSON.stringify(body));
    const error = new Error(`Local speech transcription request failed with status ${response.status}: ${detail.slice(0, 500)}`);
    if (![404, 405].includes(response.status)) {
      throw error;
    }
    lastMissingError = error;
    response = null;
    body = null;
  }

  if (!response?.ok) {
    throw lastMissingError || new Error("Local speech transcription endpoint is unavailable");
  }

  const text = typeof body === "string"
    ? body
    : typeof body?.text === "string"
      ? body.text
      : pickString(body?.transcript);
  if (typeof text !== "string") {
    throw new Error("Local speech transcription response did not include text");
  }

  return {
    text,
    modelId: typeof body === "object" && body !== null ? pickString(body.model, body?.transcription?.model, modelId) : modelId,
    provider: docReaderSttProvider,
    language: typeof body === "object" && body !== null ? pickString(body.language, body?.transcription?.language) : "",
    languageProbability:
      typeof body === "object" && body !== null && typeof (body.language_probability ?? body?.transcription?.language_probability) === "number"
        ? (body.language_probability ?? body?.transcription?.language_probability)
        : null,
    duration:
      typeof body === "object" && body !== null && typeof (body.duration ?? body?.transcription?.duration) === "number"
        ? (body.duration ?? body?.transcription?.duration)
        : null,
    generationSeconds:
      typeof body === "object" && body !== null && typeof (body.generation_seconds ?? body?.transcription?.generation_seconds) === "number"
        ? (body.generation_seconds ?? body?.transcription?.generation_seconds)
        : null,
    serviceUrl,
    segments: typeof body === "object" && body !== null
      ? Array.isArray(body.segments)
        ? body.segments
        : Array.isArray(body?.transcription?.segments)
          ? body.transcription.segments
          : []
      : [],
  };
}
