import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import {
  cloudEnvelopeRequiresTrustedDevice,
  cloudPublicKeyAcceptedFingerprints,
  cloudPublicKeyFingerprint,
  createCloudErrorEnvelope,
  generateP256KeyPair,
  normalizeCloudEnvelope,
  normalizeCloudPublicKeyPem,
  signCloudEnvelope,
  validateCloudEnvelope,
  verifyCloudEnvelopeSignature,
} from "./cloud-protocol.mjs";
import { verifySignedClawDadTransaction } from "./storekit-entitlement-verifier.mjs";

export const defaultCloudConfigPath = path.join(os.homedir(), ".clawdad", "cloud.json");
export const defaultCloudPairingPath = path.join(os.homedir(), ".clawdad", "cloud-pairing.json");
export const defaultCloudEntitlementPath = path.join(os.homedir(), ".clawdad", "entitlement.json");
export const defaultLocalServerUrl = "http://127.0.0.1:4477";
const pairingTokenTtlMs = 5 * 60 * 1000;
const cloudHostHeartbeatIntervalMs = 15_000;
const cloudHostPongTimeoutMs = 45_000;
const maxCloudImageAttachments = 4;
const maxCloudImageAttachmentBytes = 4 * 1024 * 1024;
const maxCloudImageAttachmentTotalBytes = 12 * 1024 * 1024;
const maxCloudVoiceRecordingBytes = 12 * 1024 * 1024;
const cloudSpeechAudioChunkBytes = 384 * 1024;
const maxCloudSpeechAudioBytes = 256 * 1024 * 1024;
const cloudSpeechPreparePollMs = 750;
const cloudSpeechPrepareTimeoutMs = 3 * 60 * 1000;
const supportedCloudImageMimeTypes = new Set([
  "image/gif",
  "image/heic",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const supportedCloudVoiceMimeTypes = new Set([
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
]);
function pickString(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function boolFromUnknown(value, fallback = false) {
  if (value == null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

export function normalizeCloudHostPlatform(value = process.platform) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["darwin", "mac", "macos", "osx"].includes(normalized)) {
    return "macos";
  }
  if (["win", "win32", "windows"].includes(normalized)) {
    return "windows";
  }
  if (normalized === "linux") {
    return "linux";
  }
  return normalized || "unknown";
}

export function defaultCloudHostCapabilities(platform = process.platform) {
  const shared = [
    "artifacts",
    "catalog",
    "history",
    "message.send",
    "models",
    "pairing",
    "projects.create",
    "sessions",
    "speech.synthesize",
    "speech.transcribe",
    "status",
  ];
  if (normalizeCloudHostPlatform(platform) === "macos") {
    shared.push(
      "remote-assist",
      "remote-assist.clipboard",
      "remote-assist.displays",
      "remote-assist.special-commands",
      "remote-assist.terminal-tabs",
    );
  }
  return shared.sort();
}

function normalizeCloudHostCapabilities(value, platform) {
  const values = Array.isArray(value)
    ? value
    : String(value || "").split(",");
  const normalized = [...new Set(values
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean))].sort();
  return normalized.length > 0
    ? normalized
    : defaultCloudHostCapabilities(platform);
}

function cloudHostLog(level, message, details = {}) {
  const suffix = Object.entries(details)
    .filter(([, value]) => value !== "" && value != null)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
  const line = `[clawdad-cloud-host] ${new Date().toISOString()} ${message}${suffix ? ` ${suffix}` : ""}`;
  if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function expandHomePath(filePath) {
  const value = String(filePath || "").trim();
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

async function readOptionalJson(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function readLocalTokenFile(filePath) {
  const expandedPath = expandHomePath(filePath);
  let token;
  try {
    token = (await readFile(expandedPath, "utf8")).trim();
  } catch (error) {
    throw new Error(`could not read local ClawDad token file ${expandedPath}: ${error.message}`);
  }
  if (!token) {
    throw new Error(`local ClawDad token file is empty: ${expandedPath}`);
  }
  return token;
}

async function readPemFromValueOrPath(value, pathValue) {
  const inline = String(value || "").trim();
  if (inline.includes("BEGIN ")) {
    return inline;
  }
  const candidatePath = pickString(pathValue, inline.includes("/") ? inline : "");
  if (!candidatePath) {
    return inline;
  }
  return (await readFile(expandHomePath(candidatePath), "utf8")).trim();
}

function parseArgs(argv = []) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--json" || arg === "--once" || arg === "--allow-unverified-cloud-devices") {
      options[arg.slice(2).replace(/-([a-z])/gu, (_, ch) => ch.toUpperCase())] = true;
      continue;
    }
    if (
      [
        "--config",
        "--cloud-url",
        "--account-id",
        "--workspace-id",
        "--host-id",
        "--host-name",
        "--host-platform",
        "--capabilities",
        "--local-url",
        "--local-token",
        "--local-token-file",
        "--host-private-key",
        "--host-private-key-path",
        "--host-public-key",
        "--host-public-key-path",
        "--relay-host-token",
        "--relay-bootstrap-token",
        "--pairing-path",
      ].includes(arg)
    ) {
      const value = argv[index + 1];
      if (value == null) {
        throw new Error(`missing value for ${arg}`);
      }
      options[arg.slice(2).replace(/-([a-z])/gu, (_, ch) => ch.toUpperCase())] = value;
      index += 1;
      continue;
    }
    options._.push(arg);
  }
  return options;
}

export async function resolveCloudHostConfig(rawOptions = {}) {
  const configPath = expandHomePath(
    pickString(rawOptions.config, process.env.CLAWDAD_CLOUD_CONFIG_FILE, defaultCloudConfigPath),
  );
  const config = await readOptionalJson(configPath);
  const hostPrivateKeyPem = await readPemFromValueOrPath(
    pickString(rawOptions.hostPrivateKey, process.env.CLAWDAD_CLOUD_HOST_PRIVATE_KEY, config.hostPrivateKey),
    pickString(rawOptions.hostPrivateKeyPath, process.env.CLAWDAD_CLOUD_HOST_PRIVATE_KEY_PATH, config.hostPrivateKeyPath),
  );
  const hostPublicKeyPem = await readPemFromValueOrPath(
    pickString(rawOptions.hostPublicKey, process.env.CLAWDAD_CLOUD_HOST_PUBLIC_KEY, config.hostPublicKey),
    pickString(rawOptions.hostPublicKeyPath, process.env.CLAWDAD_CLOUD_HOST_PUBLIC_KEY_PATH, config.hostPublicKeyPath),
  );
  const localTokenFile = expandHomePath(
    pickString(
      rawOptions.localTokenFile,
      process.env.CLAWDAD_CLOUD_LOCAL_TOKEN_FILE,
      config.localTokenFile,
    ),
  );
  const localTokenOverride = pickString(
    rawOptions.localToken,
    process.env.CLAWDAD_CLOUD_LOCAL_TOKEN,
  );
  const localTokenFromFile = !localTokenOverride && localTokenFile
    ? await readLocalTokenFile(localTokenFile)
    : "";
  const hostPlatform = normalizeCloudHostPlatform(
    pickString(
      rawOptions.hostPlatform,
      process.env.CLAWDAD_CLOUD_HOST_PLATFORM,
      config.hostPlatform,
      process.platform,
    ),
  );

  return {
    configPath,
    cloudUrl: pickString(rawOptions.cloudUrl, process.env.CLAWDAD_CLOUD_URL, config.cloudUrl),
    accountId: pickString(rawOptions.accountId, process.env.CLAWDAD_CLOUD_ACCOUNT_ID, config.accountId),
    workspaceId: pickString(rawOptions.workspaceId, process.env.CLAWDAD_CLOUD_WORKSPACE_ID, config.workspaceId),
    hostId: pickString(rawOptions.hostId, process.env.CLAWDAD_CLOUD_HOST_ID, config.hostId, os.hostname()),
    hostName: pickString(
      rawOptions.hostName,
      process.env.CLAWDAD_CLOUD_HOST_NAME,
      config.hostName,
      os.hostname(),
    ),
    hostPlatform,
    capabilities: normalizeCloudHostCapabilities(
      rawOptions.capabilities ?? process.env.CLAWDAD_CLOUD_HOST_CAPABILITIES ?? config.capabilities,
      hostPlatform,
    ),
    hostPrivateKeyPem,
    hostPublicKeyPem,
    pairingPath: expandHomePath(
      pickString(rawOptions.pairingPath, process.env.CLAWDAD_CLOUD_PAIRING_FILE, config.pairingPath, defaultCloudPairingPath),
    ),
    entitlementPath: expandHomePath(
      pickString(
        rawOptions.entitlementPath,
        process.env.CLAWDAD_CLOUD_ENTITLEMENT_FILE,
        config.entitlementPath,
        defaultCloudEntitlementPath,
      ),
    ),
    localUrl: pickString(rawOptions.localUrl, process.env.CLAWDAD_CLOUD_LOCAL_URL, config.localUrl, defaultLocalServerUrl),
    localTokenFile,
    localToken: pickString(
      localTokenOverride,
      localTokenFromFile,
      config.localToken,
    ),
    relayHostToken: pickString(
      rawOptions.relayHostToken,
      process.env.CLAWDAD_CLOUD_RELAY_HOST_TOKEN,
      config.relayHostToken,
    ),
    relayBootstrapToken: pickString(
      rawOptions.relayBootstrapToken,
      process.env.CLAWDAD_CLOUD_RELAY_BOOTSTRAP_TOKEN,
      config.relayBootstrapToken,
    ),
    trustedDevicePublicKeys:
      config.trustedDevicePublicKeys && typeof config.trustedDevicePublicKeys === "object"
        ? config.trustedDevicePublicKeys
        : {},
    allowUnverifiedCloudDevices: boolFromUnknown(
      rawOptions.allowUnverifiedCloudDevices ?? process.env.CLAWDAD_CLOUD_ALLOW_UNVERIFIED_DEVICES,
      boolFromUnknown(config.allowUnverifiedCloudDevices, false),
    ),
    allowFoundingBetaAccess: boolFromUnknown(
      rawOptions.allowFoundingBetaAccess ??
        process.env.CLAWDAD_CLOUD_ALLOW_FOUNDING_BETA_ACCESS,
      boolFromUnknown(config.allowFoundingBetaAccess, false),
    ),
    allowStoreKitXcodeEntitlements: boolFromUnknown(
      rawOptions.allowStoreKitXcodeEntitlements ??
        process.env.CLAWDAD_STOREKIT_ALLOW_XCODE,
      boolFromUnknown(config.allowStoreKitXcodeEntitlements, false),
    ),
  };
}

export async function cloudHostStatus(rawOptions = {}) {
  const config = await resolveCloudHostConfig(rawOptions);
  return {
    configured: Boolean(config.cloudUrl && config.accountId && config.workspaceId && config.hostId),
    configPath: config.configPath,
    cloudUrl: config.cloudUrl || "",
    accountId: config.accountId || "",
    workspaceId: config.workspaceId || "",
    hostId: config.hostId || "",
    hostName: config.hostName || "",
    hostPlatform: config.hostPlatform || "unknown",
    capabilities: config.capabilities || [],
    localUrl: config.localUrl || "",
    localTokenFile: config.localTokenFile || "",
    localAuthConfigured: Boolean(config.localToken),
    hasHostPrivateKey: Boolean(config.hostPrivateKeyPem),
    hasHostPublicKey: Boolean(config.hostPublicKeyPem),
    pairingPath: config.pairingPath || "",
    entitlementPath: config.entitlementPath || "",
    trustedDeviceCount: Object.keys(config.trustedDevicePublicKeys || {}).length,
    relayAccessConfigured: Boolean(config.relayHostToken),
    allowUnverifiedCloudDevices: config.allowUnverifiedCloudDevices,
  };
}

export async function cloudEntitlementStatus(rawOptions = {}) {
  const config = await resolveCloudHostConfig(rawOptions);
  const stored = await readOptionalJson(config.entitlementPath);
  const expiresAtMs = Date.parse(String(stored.expiresAt || ""));
  const active = Boolean(
    stored.active &&
    !stored.revokedAt &&
    (
      (stored.source === "founding-beta" && config.allowFoundingBetaAccess) ||
      (Number.isFinite(expiresAtMs) && expiresAtMs > Date.now())
    ),
  );
  return {
    configured: Object.keys(stored).length > 0,
    active,
    source: String(stored.source || ""),
    productId: String(stored.productId || ""),
    expiresAt: String(stored.expiresAt || ""),
    introductoryOffer: Boolean(stored.introductoryOffer),
    syncedAt: String(stored.syncedAt || ""),
    verification: String(stored.verification || ""),
  };
}

function normalizePairingStore(input = {}) {
  const tokens = Array.isArray(input.tokens) ? input.tokens : [];
  return {
    tokens: tokens
      .map((entry) => ({
        token: String(entry?.token || "").trim(),
        cloudUrl: String(entry?.cloudUrl || "").trim(),
        accountId: String(entry?.accountId || "").trim(),
        workspaceId: String(entry?.workspaceId || "").trim(),
        hostId: String(entry?.hostId || "").trim(),
        createdAt: String(entry?.createdAt || "").trim(),
        expiresAt: String(entry?.expiresAt || "").trim(),
      }))
      .filter((entry) => entry.token && Date.parse(entry.expiresAt) > Date.now()),
  };
}

async function writeJsonPrivate(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await chmod(filePath, 0o600).catch(() => {});
}

async function ensureCloudHostIdentity(config) {
  if (config.hostPrivateKeyPem && config.hostPublicKeyPem) {
    return config;
  }

  const keyPair = generateP256KeyPair();
  const configDirectory = path.dirname(config.configPath);
  const privateKeyPath = path.join(configDirectory, "cloud-host-private.pem");
  const publicKeyPath = path.join(configDirectory, "cloud-host-public.pem");
  await mkdir(configDirectory, { recursive: true });
  await writeFile(privateKeyPath, keyPair.privateKey, { encoding: "utf8", mode: 0o600 });
  await writeFile(publicKeyPath, keyPair.publicKey, { encoding: "utf8", mode: 0o600 });
  await chmod(privateKeyPath, 0o600).catch(() => {});
  await chmod(publicKeyPath, 0o600).catch(() => {});

  const diskConfig = await readOptionalJson(config.configPath);
  await writeJsonPrivate(config.configPath, {
    ...diskConfig,
    hostPrivateKeyPath: privateKeyPath,
    hostPublicKeyPath: publicKeyPath,
  });

  config.hostPrivateKeyPem = keyPair.privateKey;
  config.hostPublicKeyPem = keyPair.publicKey;
  return config;
}

function randomAccessId(prefix) {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

function cloudAccessUrl(config, pathname) {
  const url = new URL(config.cloudUrl);
  url.pathname = `/workspaces/${encodeURIComponent(config.workspaceId)}${pathname}`;
  url.search = "";
  url.searchParams.set("accountId", config.accountId);
  return url;
}

async function cloudAccessJson(config, pathname, options = {}) {
  const response = await fetch(cloudAccessUrl(config, pathname), {
    ...options,
    headers: {
      authorization: `Bearer ${config.relayHostToken}`,
      ...(config.relayBootstrapToken
        ? { "x-clawdad-bootstrap": config.relayBootstrapToken }
        : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text.trim() ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(
      payload?.error ||
      `ClawDad relay access request failed with ${response.status}`,
    );
  }
  return payload;
}

export async function ensureCloudRelayAccess(config) {
  await ensureCloudHostIdentity(config);
  const diskConfig = await readOptionalJson(config.configPath);
  let changed = false;
  if (!config.accountId) {
    config.accountId = randomAccessId("acct");
    changed = true;
  }
  if (!config.workspaceId) {
    config.workspaceId = randomAccessId("ws");
    changed = true;
  }
  if (!config.relayHostToken) {
    config.relayHostToken = crypto.randomBytes(32).toString("hex");
    changed = true;
  }
  if (changed) {
    await writeJsonPrivate(config.configPath, {
      ...diskConfig,
      accountId: config.accountId,
      workspaceId: config.workspaceId,
      relayHostToken: config.relayHostToken,
    });
  }

  const claimed = await cloudAccessJson(config, "/access/claim", {
    method: "POST",
    body: JSON.stringify({
      accountId: config.accountId,
      hostId: config.hostId,
      hostKeyId: config.hostPublicKeyPem
        ? cloudPublicKeyFingerprint(config.hostPublicKeyPem)
        : "",
    }),
  });
  return {
    ...claimed,
    accountId: config.accountId,
    workspaceId: config.workspaceId,
    hostId: config.hostId,
    hostName: config.hostName,
    hostPlatform: config.hostPlatform,
    capabilities: config.capabilities,
  };
}

async function registerCloudPairingTicket(config, payload) {
  return cloudAccessJson(config, "/access/pairing-tickets", {
    method: "POST",
    body: JSON.stringify({
      pairingToken: payload.token,
      expiresAt: payload.expiresAt,
    }),
  });
}

async function activateCloudDeviceAccess(config, {
  pairingToken,
  deviceId,
  deviceName,
  platform,
  keyId,
}) {
  return cloudAccessJson(
    config,
    `/access/devices/${encodeURIComponent(deviceId)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        pairingToken,
        deviceName,
        platform,
        keyId,
      }),
    },
  );
}

export async function listCloudDevices(rawOptions = {}) {
  const config = await ensureCloudHostIdentity(
    await resolveCloudHostConfig(rawOptions),
  );
  await ensureCloudRelayAccess(config);
  return cloudAccessJson(config, "/access/devices");
}

export async function revokeCloudDevice(deviceId, rawOptions = {}) {
  const normalizedDeviceId = String(deviceId || "").trim();
  if (!normalizedDeviceId) {
    throw new Error("device id is required");
  }
  const config = await ensureCloudHostIdentity(
    await resolveCloudHostConfig(rawOptions),
  );
  await ensureCloudRelayAccess(config);
  const result = await cloudAccessJson(
    config,
    `/access/devices/${encodeURIComponent(normalizedDeviceId)}`,
    { method: "DELETE" },
  );

  const diskConfig = await readOptionalJson(config.configPath);
  const trustedDevicePublicKeys = {
    ...(diskConfig.trustedDevicePublicKeys || {}),
  };
  const trustedDeviceNames = {
    ...(diskConfig.trustedDeviceNames || {}),
  };
  delete trustedDevicePublicKeys[normalizedDeviceId];
  delete trustedDeviceNames[normalizedDeviceId];
  await writeJsonPrivate(config.configPath, {
    ...diskConfig,
    trustedDevicePublicKeys,
    trustedDeviceNames,
  });
  return result;
}

async function readPairingStore(filePath) {
  return normalizePairingStore(await readOptionalJson(filePath));
}

async function writePairingStore(filePath, store) {
  await writeJsonPrivate(filePath, normalizePairingStore(store));
}

export async function createCloudPairingPayload(rawOptions = {}) {
  const config = await ensureCloudHostIdentity(await resolveCloudHostConfig(rawOptions));
  if (rawOptions.registerRelayAccess !== false) {
    await ensureCloudRelayAccess(config);
  }
  if (!config.cloudUrl || !config.accountId || !config.workspaceId || !config.hostId) {
    throw new Error("cloud pairing requires cloudUrl, accountId, workspaceId, and hostId");
  }

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + pairingTokenTtlMs);
  const token = crypto.randomBytes(32).toString("hex");
  const payload = {
    type: "clawdad.pair.v1",
    protocolVersion: "clawdad.cloud.v1",
    cloudUrl: config.cloudUrl,
    accountId: config.accountId,
    workspaceId: config.workspaceId,
    hostId: config.hostId,
    hostName: pickString(config.hostName, config.hostId),
    hostPlatform: normalizeCloudHostPlatform(config.hostPlatform),
    capabilities: normalizeCloudHostCapabilities(
      config.capabilities,
      config.hostPlatform,
    ),
    hostPublicKeyPem: config.hostPublicKeyPem,
    hostKeyId: cloudPublicKeyFingerprint(config.hostPublicKeyPem),
    token,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const store = await readPairingStore(config.pairingPath);
  store.tokens.push(payload);
  await writePairingStore(config.pairingPath, store);
  if (config.relayHostToken && rawOptions.registerRelayAccess !== false) {
    try {
      await registerCloudPairingTicket(config, payload);
    } catch (error) {
      store.tokens = store.tokens.filter((entry) => entry.token !== token);
      await writePairingStore(config.pairingPath, store);
      throw error;
    }
  }
  return payload;
}

function cloudRealtimeUrl(config) {
  const base = new URL(config.cloudUrl);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = `/workspaces/${encodeURIComponent(config.workspaceId)}/realtime`;
  base.searchParams.set("hostId", config.hostId);
  base.searchParams.set("accountId", config.accountId);
  return base;
}

function authorizationHeaders(token) {
  return token
    ? {
        authorization: `Bearer ${token}`,
      }
    : {};
}

async function localJson(config, pathname, options = {}) {
  const url = new URL(pathname, config.localUrl);
  const formDataBody = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...authorizationHeaders(config.localToken),
      ...(options.body && !formDataBody ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const payload = text.trim() ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload?.error || `local ClawDad request failed with ${response.status}`);
  }
  return payload;
}

function localTtsAudioUrl(config, value) {
  const localBase = new URL(config.localUrl);
  const audioUrl = new URL(String(value || ""), localBase);
  if (audioUrl.origin !== localBase.origin || audioUrl.pathname !== "/v1/tts/audio") {
    throw new Error("local text-to-speech returned an invalid audio URL");
  }
  return audioUrl;
}

async function localTtsAudio(config, value) {
  const response = await fetch(localTtsAudioUrl(config, value), {
    headers: {
      ...authorizationHeaders(config.localToken),
      accept: "audio/*",
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let message = detail;
    try {
      const payload = JSON.parse(detail);
      message = String(payload?.error || payload?.message || detail).trim();
    } catch {
      // Keep the local response text when it is not JSON.
    }
    throw new Error(message || `local ClawDad audio request failed with ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error("local text-to-speech returned an empty audio file");
  }
  return {
    buffer,
    contentType: String(response.headers.get("content-type") || "audio/wav").trim(),
  };
}

function signOutgoingEnvelope(envelope, config) {
  const normalized = normalizeCloudEnvelope(envelope, {
    accountId: config.accountId,
    workspaceId: config.workspaceId,
    sourceDeviceId: config.hostId,
  });
  if (!config.hostPrivateKeyPem) {
    return normalized;
  }
  const keyId = config.hostPublicKeyPem
    ? cloudPublicKeyFingerprint(config.hostPublicKeyPem)
    : "";
  return signCloudEnvelope(normalized, config.hostPrivateKeyPem, { keyId });
}

function trustedPublicKeyForEnvelope(envelope, config) {
  const trusted = config.trustedDevicePublicKeys || {};
  const byDevice = trusted[envelope.sourceDeviceId];
  if (byDevice) {
    return byDevice;
  }
  const keyId = envelope.signature?.keyId;
  if (!keyId) {
    return "";
  }
  return Object.values(trusted).find((publicKeyPem) => {
    try {
      return cloudPublicKeyAcceptedFingerprints(publicKeyPem).includes(keyId);
    } catch {
      return false;
    }
  }) || "";
}

function incomingEnvelopeIsTrusted(envelope, config) {
  if (config.allowUnverifiedCloudDevices) {
    return true;
  }
  const publicKey = trustedPublicKeyForEnvelope(envelope, config);
  return Boolean(publicKey && verifyCloudEnvelopeSignature(envelope, publicKey));
}

function replyEnvelope(type, sourceEnvelope, body, config) {
  return signOutgoingEnvelope({
    type,
    accountId: sourceEnvelope.accountId,
    workspaceId: sourceEnvelope.workspaceId,
    sourceDeviceId: config.hostId,
    targetHostId: sourceEnvelope.sourceDeviceId,
    body,
  }, config);
}

async function trustPairedCloudDevice(envelope, config) {
  const body = envelope.body || {};
  const token = String(body.token || "").trim();
  const publicKeyPem = String(body.publicKeyPem || body.publicKey || "").trim();
  const deviceName = String(body.deviceName || "").trim();
  if (!token) {
    throw new Error("pair.request is missing token");
  }
  if (!publicKeyPem.includes("BEGIN PUBLIC KEY")) {
    throw new Error("pair.request is missing publicKeyPem");
  }

  const normalizedPublicKeyPem = normalizeCloudPublicKeyPem(publicKeyPem);
  const keyId = cloudPublicKeyFingerprint(normalizedPublicKeyPem);
  const acceptedKeyIds = cloudPublicKeyAcceptedFingerprints(publicKeyPem);
  if (envelope.signature?.keyId && !acceptedKeyIds.includes(envelope.signature.keyId)) {
    throw new Error("pair.request signature key does not match public key");
  }
  if (!verifyCloudEnvelopeSignature(envelope, normalizedPublicKeyPem)) {
    throw new Error("pair.request signature could not be verified");
  }

  const store = await readPairingStore(config.pairingPath);
  const match = store.tokens.find((entry) => entry.token === token);
  if (!match) {
    throw new Error("pairing token is expired or unknown");
  }
  if (
    match.cloudUrl !== config.cloudUrl ||
    match.accountId !== config.accountId ||
    match.workspaceId !== config.workspaceId ||
    match.hostId !== config.hostId ||
    envelope.accountId !== config.accountId ||
    envelope.workspaceId !== config.workspaceId ||
    envelope.targetHostId !== config.hostId
  ) {
    throw new Error("pairing token does not match this ClawDad host");
  }

  const relayActivation = config.relayHostToken
    ? await activateCloudDeviceAccess(config, {
        pairingToken: token,
        deviceId: envelope.sourceDeviceId,
        deviceName,
        platform: String(body.platform || "").trim(),
        keyId,
      })
    : null;

  const nextStore = {
    tokens: store.tokens.filter((entry) => entry.token !== token),
  };
  await writePairingStore(config.pairingPath, nextStore);

  const diskConfig = await readOptionalJson(config.configPath);
  const trustedDevicePublicKeys =
    diskConfig.trustedDevicePublicKeys && typeof diskConfig.trustedDevicePublicKeys === "object"
      ? diskConfig.trustedDevicePublicKeys
      : {};
  trustedDevicePublicKeys[envelope.sourceDeviceId] = normalizedPublicKeyPem;
  const trustedDeviceNames =
    diskConfig.trustedDeviceNames && typeof diskConfig.trustedDeviceNames === "object"
      ? diskConfig.trustedDeviceNames
      : {};
  if (deviceName) {
    trustedDeviceNames[envelope.sourceDeviceId] = deviceName;
  }

  await writeJsonPrivate(config.configPath, {
    ...diskConfig,
    trustedDevicePublicKeys,
    trustedDeviceNames,
  });
  config.trustedDevicePublicKeys = {
    ...(config.trustedDevicePublicKeys || {}),
    [envelope.sourceDeviceId]: normalizedPublicKeyPem,
  };

  return {
    deviceId: envelope.sourceDeviceId,
    keyId,
    deviceName,
    hostPublicKeyPem: config.hostPublicKeyPem || "",
    hostKeyId: config.hostPublicKeyPem
      ? cloudPublicKeyFingerprint(config.hostPublicKeyPem)
      : "",
    hostName: pickString(config.hostName, config.hostId),
    hostPlatform: normalizeCloudHostPlatform(config.hostPlatform),
    capabilities: normalizeCloudHostCapabilities(
      config.capabilities,
      config.hostPlatform,
    ),
    trustedAt: new Date().toISOString(),
    relayAccessToken: String(relayActivation?.relayAccessToken || "").trim(),
  };
}

function decodeCloudImageAttachment(entry, index) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`image attachment ${index + 1} is invalid`);
  }
  const fileName = path.basename(String(entry.fileName || `image-${index + 1}.jpg`).trim());
  const mimeType = String(entry.mimeType || "image/jpeg").trim().toLowerCase();
  const encoded = String(entry.dataBase64 || entry.base64 || "").replace(/\s+/gu, "");
  if (!supportedCloudImageMimeTypes.has(mimeType)) {
    throw new Error(`image attachment ${index + 1} has unsupported type '${mimeType}'`);
  }
  if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) {
    throw new Error(`image attachment ${index + 1} has invalid base64 data`);
  }
  if (encoded.length > Math.ceil(maxCloudImageAttachmentBytes * 4 / 3) + 4) {
    throw new Error(`image attachment ${index + 1} exceeds the 4 MB limit`);
  }
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length === 0 || buffer.length > maxCloudImageAttachmentBytes) {
    throw new Error(`image attachment ${index + 1} exceeds the 4 MB limit`);
  }
  return {
    fileName: fileName || `image-${index + 1}.jpg`,
    mimeType,
    buffer,
  };
}

function cloudImageAttachmentsFromBody(body = {}) {
  const entries = Array.isArray(body.attachments) ? body.attachments : [];
  if (entries.length > maxCloudImageAttachments) {
    throw new Error(`message.send supports up to ${maxCloudImageAttachments} image attachments`);
  }
  const attachments = entries.map(decodeCloudImageAttachment);
  const totalBytes = attachments.reduce((total, attachment) => total + attachment.buffer.length, 0);
  if (totalBytes > maxCloudImageAttachmentTotalBytes) {
    throw new Error("message.send image attachments exceed the 12 MB total limit");
  }
  return attachments;
}

function decodeCloudVoiceRecording(body = {}) {
  const fileName = path.basename(String(body.fileName || "clawdad-voice.m4a").trim());
  const mimeType = String(body.mimeType || "audio/mp4").trim().toLowerCase();
  const encoded = String(body.dataBase64 || body.base64 || "").replace(/\s+/gu, "");
  if (!supportedCloudVoiceMimeTypes.has(mimeType)) {
    throw new Error(`voice recording has unsupported type '${mimeType}'`);
  }
  if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) {
    throw new Error("voice recording has invalid base64 data");
  }
  if (encoded.length > Math.ceil(maxCloudVoiceRecordingBytes * 4 / 3) + 4) {
    throw new Error("voice recording exceeds the 12 MB limit");
  }
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length === 0 || buffer.length > maxCloudVoiceRecordingBytes) {
    throw new Error("voice recording exceeds the 12 MB limit");
  }
  return {
    fileName: fileName || "clawdad-voice.m4a",
    mimeType,
    buffer,
  };
}

function localVoiceTranscriptionRequestOptions(project, recording) {
  const formData = new FormData();
  if (project) {
    formData.append("project", project);
  }
  formData.append(
    "audio",
    new Blob([recording.buffer], { type: recording.mimeType }),
    recording.fileName,
  );
  return {
    method: "POST",
    body: formData,
  };
}

function cloudSpeechRequestPayload(body = {}, { poll = false } = {}) {
  const requestId = String(body.requestId || "").trim();
  const project = String(body.project || body.projectPath || "").trim();
  const kind = String(body.kind || "").trim().toLowerCase() === "response"
    ? "response"
    : "message";
  if (!requestId) {
    throw new Error("speech.synthesize.request is missing body.requestId");
  }
  if (!project) {
    throw new Error("speech.synthesize.request is missing body.project");
  }
  return {
    project,
    sessionId: String(body.sessionId || "").trim(),
    requestId,
    historyRequestId: String(body.historyRequestId || "").trim(),
    kind,
    text: String(body.text || "").trim(),
    executionPreference:
      String(body.executionPreference || "").trim().toLowerCase() === "paired-mac-first"
        ? "paired-mac-first"
        : "",
    allowRemoteFallback: body.allowRemoteFallback !== false,
    prepare: true,
    poll,
  };
}

function waitForCloudSpeechPoll() {
  return new Promise((resolve) => setTimeout(resolve, cloudSpeechPreparePollMs));
}

async function prepareCloudSpeechAudio(config, body = {}) {
  const startedAt = Date.now();
  let poll = false;
  while (Date.now() - startedAt <= cloudSpeechPrepareTimeoutMs) {
    const payload = cloudSpeechRequestPayload(body, { poll });
    const prepared = await localJson(config, "/v1/tts/message", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const audio = prepared?.audio && typeof prepared.audio === "object"
      ? prepared.audio
      : {};
    const state = String(audio.state || "").trim().toLowerCase();
    if (state === "ready" && Array.isArray(audio.parts) && audio.parts.length > 0) {
      return {
        audio,
        cached: Boolean(prepared.cached),
      };
    }
    if (state === "failed") {
      throw new Error(String(audio.error || prepared.error || "Local speech generation failed").trim());
    }
    await waitForCloudSpeechPoll();
    poll = true;
  }
  throw new Error("Local speech is still preparing. Tap the speaker again in a moment.");
}

async function sendCloudSpeechAudio(envelope, config, sendCloud, prepared) {
  const requestId = String(envelope.body?.requestId || "").trim();
  const audio = prepared.audio || {};
  const parts = Array.isArray(audio.parts) ? audio.parts : [];
  let totalBytes = 0;

  for (const [partIndex, part] of parts.entries()) {
    const localAudio = await localTtsAudio(config, part?.url);
    totalBytes += localAudio.buffer.length;
    if (totalBytes > maxCloudSpeechAudioBytes) {
      throw new Error("The generated speech is too large to send to this iPhone.");
    }
    const chunkCount = Math.ceil(localAudio.buffer.length / cloudSpeechAudioChunkBytes);
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const offset = chunkIndex * cloudSpeechAudioChunkBytes;
      const chunk = localAudio.buffer.subarray(offset, offset + cloudSpeechAudioChunkBytes);
      await sendCloud(replyEnvelope("speech.synthesis.chunk", envelope, {
        requestId,
        audioId: String(audio.audioId || "").trim(),
        partIndex,
        partCount: parts.length,
        chunkIndex,
        chunkCount,
        fileName: path.basename(String(part?.fileName || `part-${partIndex + 1}.wav`).trim()),
        mimeType: localAudio.contentType,
        bytes: chunk.length,
        dataBase64: chunk.toString("base64"),
      }, config));
    }
  }

  await sendCloud(replyEnvelope("speech.synthesis.complete", envelope, {
    requestId,
    audioId: String(audio.audioId || "").trim(),
    partCount: parts.length,
    totalBytes,
    cached: Boolean(prepared.cached),
    completedAt: new Date().toISOString(),
  }, config));
}

function dispatchPayloadFromCloudEnvelope(envelope) {
  const body = envelope.body || {};
  const attachments = cloudImageAttachmentsFromBody(body);
  const payload = {
    project: String(body.project || body.projectPath || "").trim(),
    sessionId: String(body.sessionId || "").trim(),
    message: String(body.message || "").trim(),
    dispatchMode: String(body.dispatchMode || "direct").trim(),
    permissionMode: String(body.permissionMode || "").trim(),
    model: String(body.model || "").trim(),
    reasoningEffort: String(body.reasoningEffort || body.reasoning_effort || "").trim(),
    wait: false,
    attachments,
  };
  if (!payload.project) {
    throw new Error("message.send is missing body.project");
  }
  if (!payload.message && attachments.length === 0) {
    throw new Error("message.send is missing body.message and image attachments");
  }
  return payload;
}

function localDispatchRequestOptions(payload) {
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  const fields = { ...payload };
  delete fields.attachments;
  if (attachments.length === 0) {
    return {
      method: "POST",
      body: JSON.stringify(fields),
    };
  }

  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, String(value ?? ""));
  }
  for (const attachment of attachments) {
    formData.append(
      "attachments",
      new Blob([attachment.buffer], { type: attachment.mimeType }),
      attachment.fileName,
    );
  }
  return {
    method: "POST",
    body: formData,
  };
}

async function persistCloudEntitlement(envelope, config) {
  const body = envelope.body || {};
  const source = String(body.source || "").trim();
  const foundingBetaActive = (
    source === "founding-beta" &&
    config.allowFoundingBetaAccess
  );
  let verifiedStoreKit = null;
  if (source === "storekit-2") {
    const signedTransaction = String(body.signedTransaction || "").trim();
    if (signedTransaction) {
      const verifier = typeof config.verifyStoreKitTransaction === "function"
        ? config.verifyStoreKitTransaction
        : verifySignedClawDadTransaction;
      verifiedStoreKit = await verifier({
        signedTransaction,
        expectedEnvironment: String(body.environment || "").trim(),
        allowXcode: config.allowStoreKitXcodeEntitlements,
      });
    } else if (body.active === true) {
      throw new Error("active StoreKit entitlement is missing Apple signed proof");
    }
  }
  const syncedAt = new Date().toISOString();
  const entitlement = {
    active: Boolean(verifiedStoreKit?.active || foundingBetaActive),
    source,
    productId: String(verifiedStoreKit?.productId || "").trim(),
    expiresAt: String(verifiedStoreKit?.expiresAt || "").trim(),
    revokedAt: String(verifiedStoreKit?.revokedAt || "").trim(),
    introductoryOffer: Boolean(verifiedStoreKit?.introductoryOffer),
    syncedAt,
    verification: verifiedStoreKit?.verification ||
      (foundingBetaActive ? "founding-beta-config" : "no-current-entitlement"),
  };
  await writeJsonPrivate(config.entitlementPath, entitlement);
  return entitlement;
}

export async function handleCloudEnvelope(envelopeInput, config, sendCloud) {
  const validation = validateCloudEnvelope(envelopeInput);
  if (!validation.ok) {
    await sendCloud(signOutgoingEnvelope(createCloudErrorEnvelope(envelopeInput, validation.errors.join("; "), {
      sourceDeviceId: config.hostId,
      accountId: config.accountId,
      workspaceId: config.workspaceId,
      code: "invalid_envelope",
    }), config));
    return { ok: false, error: validation.errors.join("; ") };
  }

  const envelope = validation.envelope;
  if (envelope.targetHostId && envelope.targetHostId !== config.hostId) {
    return { ok: true, ignored: true };
  }

  if (cloudEnvelopeRequiresTrustedDevice(envelope) && !incomingEnvelopeIsTrusted(envelope, config)) {
    const response = createCloudErrorEnvelope(envelope, "device is not trusted for this command", {
      sourceDeviceId: config.hostId,
      code: "untrusted_device",
    });
    await sendCloud(signOutgoingEnvelope(response, config));
    return { ok: false, error: "untrusted device" };
  }

  try {
    if (envelope.type === "ping") {
      await sendCloud(replyEnvelope("pong", envelope, { receivedAt: new Date().toISOString() }, config));
      return { ok: true };
    }

    if (envelope.type === "pair.request") {
      const paired = await trustPairedCloudDevice(envelope, config);
      await sendCloud(replyEnvelope("pair.accepted", envelope, {
        ...paired,
        inReplyTo: envelope.id,
      }, config));
      return { ok: true };
    }

    if (envelope.type === "entitlement.sync") {
      const entitlement = await persistCloudEntitlement(envelope, config);
      await sendCloud(replyEnvelope("entitlement.accepted", envelope, {
        active: entitlement.active,
        productId: entitlement.productId,
        expiresAt: entitlement.expiresAt,
        syncedAt: entitlement.syncedAt,
        verification: entitlement.verification,
      }, config));
      return { ok: true };
    }

    if (envelope.type === "catalog.request") {
      const body = envelope.body || {};
      const project = String(body.project || body.projectPath || "").trim();
      const initialQuery = new URLSearchParams({ lean: "1" });
      const snapshot = await localJson(config, `/v1/projects?${initialQuery.toString()}`);
      await sendCloud(replyEnvelope("catalog.snapshot", envelope, {
        ...snapshot,
        catalogRefreshPending: Boolean(project),
      }, config));

      if (project) {
        const syncQuery = new URLSearchParams({
          lean: "1",
          syncProject: project,
        });
        try {
          const refreshed = await localJson(config, `/v1/projects?${syncQuery.toString()}`);
          await sendCloud(replyEnvelope("catalog.snapshot", envelope, {
            ...refreshed,
            catalogRefreshPending: false,
          }, config));
        } catch (error) {
          console.warn(`[clawdad-cloud-host] selected-project catalog refresh skipped: ${error.message}`);
          await sendCloud(replyEnvelope("catalog.snapshot", envelope, {
            ...snapshot,
            catalogRefreshPending: false,
          }, config));
        }
      }
      return { ok: true };
    }

    if (envelope.type === "project.create.request") {
      const body = envelope.body || {};
      const requestId = String(body.requestId || "").trim();
      const name = String(body.name || "").trim();
      if (!requestId) {
        throw new Error("project.create.request is missing body.requestId");
      }
      if (!name) {
        throw new Error("project.create.request is missing body.name");
      }
      const created = await localJson(config, "/v1/projects", {
        method: "POST",
        body: JSON.stringify({
          mode: "new",
          name,
          provider: "codex",
        }),
      });
      await sendCloud(replyEnvelope("project.created", envelope, {
        requestId,
        ok: created?.ok !== false,
        projectPath: String(created?.projectPath || "").trim(),
        sessionId: String(created?.sessionId || "").trim(),
        createdDirectory: Boolean(created?.createdDirectory),
        output: String(created?.output || "Project created").trim(),
      }, config));
      return { ok: true };
    }

    if (envelope.type === "models.request") {
      const body = envelope.body || {};
      const query = new URLSearchParams({
        project: String(body.project || body.projectPath || ""),
      });
      const snapshot = await localJson(config, `/v1/models?${query.toString()}`);
      await sendCloud(replyEnvelope("models.snapshot", envelope, snapshot, config));
      return { ok: true };
    }

    if (envelope.type === "session.create.request") {
      const body = envelope.body || {};
      const project = String(body.project || body.projectPath || "").trim();
      if (!project) {
        throw new Error("session.create.request is missing body.project");
      }
      const created = await localJson(config, "/v1/sessions", {
        method: "POST",
        body: JSON.stringify({
          project,
          provider: String(body.provider || "codex").trim() || "codex",
          title: String(body.title || "").trim(),
          model: String(body.model || "").trim(),
          reasoningEffort: String(body.reasoningEffort || body.reasoning_effort || "").trim(),
        }),
      });
      await sendCloud(replyEnvelope("session.created", envelope, created, config));
      return { ok: true };
    }

    if (envelope.type === "history.request") {
      const body = envelope.body || {};
      const query = new URLSearchParams({
        project: String(body.project || body.projectPath || ""),
        sessionId: String(body.sessionId || ""),
        cursor: String(body.cursor || "0"),
        limit: String(body.limit || "40"),
      });
      const page = await localJson(config, `/v1/history?${query.toString()}`);
      await sendCloud(replyEnvelope("history.page", envelope, page, config));
      return { ok: true };
    }

    if (envelope.type === "status.request") {
      const body = envelope.body || {};
      const query = new URLSearchParams({
        project: String(body.project || body.projectPath || ""),
      });
      const status = await localJson(config, `/v1/status?${query.toString()}`);
      await sendCloud(replyEnvelope("status.snapshot", envelope, status, config));
      return { ok: true };
    }

    if (envelope.type === "speech.transcribe.request") {
      const body = envelope.body || {};
      const requestId = String(body.requestId || "").trim();
      if (!requestId) {
        throw new Error("speech.transcribe.request is missing body.requestId");
      }
      const project = String(body.project || body.projectPath || "").trim();
      const recording = decodeCloudVoiceRecording(body);
      await sendCloud(replyEnvelope("speech.transcribe.accepted", envelope, {
        requestId,
        receivedAt: new Date().toISOString(),
      }, config));
      const transcript = await localJson(
        config,
        "/v1/stt/transcribe",
        localVoiceTranscriptionRequestOptions(project, recording),
      );
      await sendCloud(replyEnvelope("speech.transcription", envelope, {
        requestId,
        text: String(transcript.text || transcript.transcript || "").trim(),
        provider: String(transcript.provider || "").trim(),
        model: String(transcript.model || "").trim(),
        language: String(transcript.language || "").trim(),
        duration: Number(transcript.duration || 0),
      }, config));
      return { ok: true };
    }

    if (envelope.type === "speech.synthesize.request") {
      const body = envelope.body || {};
      const requestId = String(body.requestId || "").trim();
      cloudSpeechRequestPayload(body);
      await sendCloud(replyEnvelope("speech.synthesize.accepted", envelope, {
        requestId,
        receivedAt: new Date().toISOString(),
      }, config));
      const prepared = await prepareCloudSpeechAudio(config, body);
      await sendCloudSpeechAudio(envelope, config, sendCloud, prepared);
      return { ok: true };
    }

    if (envelope.type === "artifact.list.request") {
      const body = envelope.body || {};
      const query = new URLSearchParams({
        project: String(body.project || body.projectPath || ""),
      });
      const list = await localJson(config, `/v1/artifacts?${query.toString()}`);
      await sendCloud(replyEnvelope("artifact.list", envelope, list, config));
      return { ok: true };
    }

    if (envelope.type === "message.send") {
      const dispatchPayload = dispatchPayloadFromCloudEnvelope(envelope);
      const accepted = await localJson(config, "/v1/dispatch", localDispatchRequestOptions(dispatchPayload));
      await sendCloud(replyEnvelope("message.accepted", envelope, accepted, config));
      return { ok: true };
    }

    if (envelope.type === "approval.decision") {
      const body = envelope.body || {};
      const project = String(body.project || body.projectPath || "").trim();
      const approvalId = String(body.approvalId || body.approval_id || "").trim();
      const decision = String(body.decision || body.action || "").trim().toLowerCase();
      if (!project || !approvalId || !["approve", "decline"].includes(decision)) {
        throw new Error("approval.decision requires project, approvalId, and approve or decline");
      }
      const accepted = await localJson(config, "/v1/approvals/decision", {
        method: "POST",
        body: JSON.stringify({
          project,
          approvalId,
          decision,
          reason: String(body.reason || "").trim(),
          answers: body.answers && typeof body.answers === "object" ? body.answers : null,
          content: body.content && typeof body.content === "object" ? body.content : null,
        }),
      });
      const query = new URLSearchParams({ project });
      const status = await localJson(config, `/v1/status?${query.toString()}`);
      await sendCloud(replyEnvelope("status.snapshot", envelope, {
        ...status,
        approvalDecision: accepted,
      }, config));
      return { ok: true };
    }

    return { ok: true, ignored: true };
  } catch (error) {
    await sendCloud(signOutgoingEnvelope(createCloudErrorEnvelope(envelope, error.message, {
      sourceDeviceId: config.hostId,
    }), config));
    return { ok: false, error: error.message };
  }
}

function waitForSocketOpen(socket, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("timed out connecting to ClawDad Cloud"));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timeout);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
    }
    function onOpen() {
      cleanup();
      resolve();
    }
    function onError(event) {
      cleanup();
      reject(new Error(event?.message || "failed to connect to ClawDad Cloud"));
    }
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
  });
}

export async function connectCloudHostOnce(config) {
  await ensureCloudHostIdentity(config);
  if (typeof WebSocket !== "function") {
    throw new Error("cloud-host requires a Node runtime with global WebSocket support");
  }
  if (!config.cloudUrl || !config.accountId || !config.workspaceId || !config.hostId) {
    throw new Error("cloud-host requires cloudUrl, accountId, workspaceId, and hostId");
  }
  await ensureCloudRelayAccess(config);

  const socket = new WebSocket(
    cloudRealtimeUrl(config),
    [`clawdad.auth.${config.relayHostToken}`],
  );
  await waitForSocketOpen(socket);
  let lastPongAt = Date.now();
  let heartbeatTimer = null;

  const sendCloud = async (envelope) => {
    if (socket.readyState !== WebSocket.OPEN) {
      throw new Error(`cloud-host socket is not open (state=${socket.readyState})`);
    }
    socket.send(JSON.stringify(envelope));
  };
  await sendCloud(signOutgoingEnvelope({
    type: "host.ready",
    accountId: config.accountId,
    workspaceId: config.workspaceId,
    sourceDeviceId: config.hostId,
    body: {
      localUrl: config.localUrl,
      hostName: pickString(config.hostName, config.hostId),
      hostPlatform: normalizeCloudHostPlatform(config.hostPlatform),
      capabilities: normalizeCloudHostCapabilities(
        config.capabilities,
        config.hostPlatform,
      ),
      pairing: true,
      readyAt: new Date().toISOString(),
    },
  }, config));

  socket.addEventListener("message", (event) => {
    const text = typeof event.data === "string" ? event.data : "";
    if (!text) {
      return;
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      cloudHostLog("warn", "ignored invalid relay message");
      return;
    }
    if (payload?.type === "pong" && payload?.sourceDeviceId === "cloud-relay") {
      lastPongAt = Date.now();
    }
    void handleCloudEnvelope(payload, config, sendCloud).catch((error) => {
      cloudHostLog("warn", "failed to handle relay envelope", {
        type: payload?.type || "",
        error: error?.message || String(error),
      });
    });
  });

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };
    heartbeatTimer = setInterval(() => {
      const silenceMs = Date.now() - lastPongAt;
      if (silenceMs >= cloudHostPongTimeoutMs) {
        cloudHostLog("warn", "relay heartbeat timed out", { silenceMs });
        socket.close(4000, "relay heartbeat timeout");
        return;
      }
      const sentAt = new Date().toISOString();
      void sendCloud(signOutgoingEnvelope({
        type: "host.heartbeat",
        accountId: config.accountId,
        workspaceId: config.workspaceId,
        sourceDeviceId: config.hostId,
        body: {
          sentAt,
          localUrl: config.localUrl,
          hostName: pickString(config.hostName, config.hostId),
          hostPlatform: normalizeCloudHostPlatform(config.hostPlatform),
          capabilities: normalizeCloudHostCapabilities(
            config.capabilities,
            config.hostPlatform,
          ),
        },
      }, config)).then(() => sendCloud(signOutgoingEnvelope({
        type: "ping",
        accountId: config.accountId,
        workspaceId: config.workspaceId,
        sourceDeviceId: config.hostId,
        body: {
          sentAt,
          role: "host",
        },
      }, config))).catch((error) => {
        cloudHostLog("warn", "relay heartbeat send failed", {
          error: error?.message || String(error),
        });
        socket.close(4001, "relay heartbeat send failed");
      });
    }, cloudHostHeartbeatIntervalMs);
    heartbeatTimer.unref?.();
    socket.addEventListener("close", (event) => {
      cleanup();
      resolve({
        code: event?.code ?? null,
        reason: event?.reason || "",
        lastPongAt: new Date(lastPongAt).toISOString(),
      });
    });
    socket.addEventListener("error", (event) => {
      cleanup();
      reject(new Error(event?.message || "cloud-host socket error"));
    });
  });
}

export function cloudHostReconnectDelayMs(failureCount = 0) {
  const count = Math.max(0, Number.parseInt(String(failureCount || 0), 10) || 0);
  return Math.min(30_000, 1_500 * (2 ** Math.min(count, 5)));
}

export async function runCloudHostConnector(argv = []) {
  const rawOptions = parseArgs(argv);
  if (rawOptions.help) {
    console.log(`Usage: clawdad cloud-host [options]

Options:
  --config <path>                 Cloud host config path (default: ~/.clawdad/cloud.json)
  --cloud-url <url>               ClawDad Cloud base URL
  --account-id <id>               Account id
  --workspace-id <id>             Workspace id
  --host-id <id>                  Desktop host id
  --host-name <name>              Human-readable computer name
  --host-platform <platform>      macos, windows, or linux
  --capabilities <list>           Comma-separated host capabilities
  --local-url <url>               Local ClawDad server URL (default: http://127.0.0.1:4477)
  --local-token <token>           Local server bearer token
  --local-token-file <path>       Read the local server bearer token from a file
  --relay-host-token <token>      Workspace-scoped relay host credential
  --relay-bootstrap-token <token> One-time credential for a legacy workspace migration
  --once                          Connect once and exit when the socket closes
  --json                          Print resolved status JSON without connecting
`);
    return;
  }

  const config = await resolveCloudHostConfig(rawOptions);
  if (rawOptions.json) {
    console.log(JSON.stringify(await cloudHostStatus(rawOptions), null, 2));
    return;
  }

  let failureCount = 0;
  let connectedOnce = false;
  do {
    try {
      cloudHostLog("info", connectedOnce ? "reconnecting to relay" : "connecting to relay", {
        cloudUrl: config.cloudUrl,
        workspaceId: config.workspaceId,
        hostId: config.hostId,
      });
      const closed = await connectCloudHostOnce(config);
      connectedOnce = true;
      failureCount = 0;
      cloudHostLog("warn", "relay connection closed", closed);
      if (rawOptions.once) {
        return;
      }
    } catch (error) {
      if (rawOptions.once) {
        throw error;
      }
      failureCount += 1;
      cloudHostLog("warn", "relay connection failed", {
        failureCount,
        error: error?.message || String(error),
      });
    }
    const retryInMs = cloudHostReconnectDelayMs(failureCount);
    cloudHostLog("info", "waiting to reconnect", { retryInMs });
    await new Promise((resolve) => setTimeout(resolve, retryInMs));
  } while (true);
}
