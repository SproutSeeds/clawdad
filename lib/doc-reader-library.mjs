import crypto from "node:crypto";

export const defaultDocReaderLibraryBaseUrl = "http://127.0.0.1:8766";
export const defaultDocReaderLibraryTimeoutMs = 30_000;

function pickString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return "";
}

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }
  return Math.min(max, parsed);
}

export function normalizeDocReaderLibraryBaseUrl(value, fallback = defaultDocReaderLibraryBaseUrl) {
  return pickString(value, fallback).replace(/\/+$/u, "");
}

export function createDocReaderSourceItemId({
  projectPath = "",
  sessionId = "",
  requestId = "",
  kind = "",
  textHash = "",
} = {}) {
  const hash = crypto.createHash("sha256");
  hash.update(String(projectPath || ""));
  hash.update("\0");
  hash.update(String(sessionId || ""));
  hash.update("\0");
  hash.update(String(requestId || ""));
  hash.update("\0");
  hash.update(String(kind || ""));
  const normalizedTextHash = pickString(textHash);
  if (normalizedTextHash) {
    hash.update("\0");
    hash.update(normalizedTextHash);
  }
  return `clawdad:${hash.digest("hex").slice(0, 40)}`;
}

async function fetchJson({
  baseUrl,
  path,
  method = "GET",
  body = null,
  timeoutMs = defaultDocReaderLibraryTimeoutMs,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!fetchImpl) {
    throw new Error("fetch is not available for Doc Reader library requests");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), positiveInteger(
    timeoutMs,
    defaultDocReaderLibraryTimeoutMs,
    { min: 1000, max: 10 * 60 * 1000 },
  ));
  let response;
  let text = "";
  try {
    response = await fetchImpl(`${normalizeDocReaderLibraryBaseUrl(baseUrl)}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      signal: controller.signal,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    text = await response.text();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Doc Reader library request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  let payload = {};
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch (_error) {
      payload = { raw: text };
    }
  }
  if (!response.ok || payload?.ok === false) {
    const detail = pickString(payload?.error, payload?.message, payload?.raw, `HTTP ${response.status}`);
    const error = new Error(`Doc Reader library request failed with status ${response.status}: ${detail.slice(0, 500)}`);
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function checkDocReaderLibrary({
  baseUrl = defaultDocReaderLibraryBaseUrl,
  timeoutMs = 900,
  fetchImpl = globalThis.fetch,
} = {}) {
  return await fetchJson({
    baseUrl,
    path: "/healthz",
    timeoutMs,
    fetchImpl,
  });
}

export async function upsertDocReaderLibraryItem({
  baseUrl = defaultDocReaderLibraryBaseUrl,
  timeoutMs = defaultDocReaderLibraryTimeoutMs,
  text,
  title = "",
  kind = "clawdad-message",
  source = "clawdad",
  sourceItemId = "",
  sourceMeta = {},
  tags = [],
  prepareAudio = true,
  fetchImpl = globalThis.fetch,
} = {}) {
  const payload = await fetchJson({
    baseUrl,
    path: "/api/library/items",
    method: "POST",
    timeoutMs,
    fetchImpl,
    body: {
      text,
      title,
      kind,
      source,
      source_item_id: sourceItemId,
      source_meta: sourceMeta,
      tags,
      prepare_audio: prepareAudio,
    },
  });
  return payload.item || null;
}

export async function getDocReaderLibraryItem({
  baseUrl = defaultDocReaderLibraryBaseUrl,
  timeoutMs = defaultDocReaderLibraryTimeoutMs,
  itemId = "",
  source = "",
  sourceItemId = "",
  fetchImpl = globalThis.fetch,
} = {}) {
  if (itemId) {
    const payload = await fetchJson({
      baseUrl,
      path: `/api/library/items/${encodeURIComponent(itemId)}`,
      timeoutMs,
      fetchImpl,
    });
    return payload.item || null;
  }
  const query = new URLSearchParams({
    source,
    source_item_id: sourceItemId,
  });
  const payload = await fetchJson({
    baseUrl,
    path: `/api/library/items?${query.toString()}`,
    timeoutMs,
    fetchImpl,
  });
  return Array.isArray(payload.items) ? payload.items[0] || null : null;
}

export async function prepareDocReaderLibraryItem({
  baseUrl = defaultDocReaderLibraryBaseUrl,
  timeoutMs = defaultDocReaderLibraryTimeoutMs,
  itemId,
  retry = false,
  fetchImpl = globalThis.fetch,
} = {}) {
  const payload = await fetchJson({
    baseUrl,
    path: `/api/library/items/${encodeURIComponent(itemId)}/prepare-audio`,
    method: "POST",
    timeoutMs,
    fetchImpl,
    body: { retry },
  });
  return payload.item || null;
}

export async function fetchDocReaderLibraryAudio({
  baseUrl = defaultDocReaderLibraryBaseUrl,
  timeoutMs = defaultDocReaderLibraryTimeoutMs,
  itemId,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!itemId) {
    throw new Error("missing Doc Reader library item id");
  }
  if (!fetchImpl) {
    throw new Error("fetch is not available for Doc Reader library audio");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), positiveInteger(
    timeoutMs,
    defaultDocReaderLibraryTimeoutMs,
    { min: 1000, max: 10 * 60 * 1000 },
  ));
  let response;
  try {
    response = await fetchImpl(
      `${normalizeDocReaderLibraryBaseUrl(baseUrl)}/api/library/items/${encodeURIComponent(itemId)}/audio`,
      {
        headers: { accept: "audio/*" },
        signal: controller.signal,
      },
    );
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Doc Reader library audio request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Doc Reader library audio request failed with status ${response.status}: ${detail.slice(0, 500)}`);
  }
  return {
    statusCode: response.status,
    contentType: response.headers.get("content-type") || "audio/wav",
    contentLength: response.headers.get("content-length") || "",
    buffer: Buffer.from(await response.arrayBuffer()),
  };
}
