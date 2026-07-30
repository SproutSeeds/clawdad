import crypto from "node:crypto";

export const cloudProtocolVersion = "clawdad.cloud.v1";

export const cloudEnvelopeTypes = Object.freeze([
  "host.ready",
  "host.heartbeat",
  "pair.request",
  "pair.accepted",
  "entitlement.sync",
  "entitlement.accepted",
  "catalog.request",
  "catalog.snapshot",
  "models.request",
  "models.snapshot",
  "session.create.request",
  "session.created",
  "message.send",
  "message.accepted",
  "speech.transcribe.request",
  "speech.transcribe.accepted",
  "speech.transcription",
  "run.delta",
  "history.request",
  "history.page",
  "status.request",
  "status.snapshot",
  "artifact.list.request",
  "artifact.list",
  "artifact.download.request",
  "entitlement.sync",
  "artifact.download.ticket",
  "approval.request",
  "approval.decision",
  "remote.assist.request",
  "remote.assist.available",
  "remote.assist.offer",
  "remote.assist.answer",
  "remote.assist.ice",
  "remote.assist.stop",
  "remote.assist.error",
  "error",
  "ping",
  "pong",
]);

export const stateChangingCloudEnvelopeTypes = Object.freeze([
  "session.create.request",
  "message.send",
  "approval.decision",
]);

export const trustedDeviceCloudEnvelopeTypes = Object.freeze([
  "catalog.request",
  "models.request",
  "history.request",
  "status.request",
  "speech.transcribe.request",
  "artifact.list.request",
  "artifact.download.request",
  "remote.assist.request",
  "remote.assist.answer",
  "remote.assist.ice",
  "remote.assist.stop",
  ...stateChangingCloudEnvelopeTypes,
]);

const cloudEnvelopeTypeSet = new Set(cloudEnvelopeTypes);
const trustedDeviceCloudEnvelopeTypeSet = new Set(trustedDeviceCloudEnvelopeTypes);
const p256SpkiHeader = Buffer.from([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86,
  0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
  0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03,
  0x42, 0x00,
]);

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

function fromBase64Url(value) {
  const normalized = String(value || "").replace(/-/gu, "+").replace(/_/gu, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function publicKeyDerFromPem(publicKeyPem) {
  const body = String(publicKeyPem || "")
    .replace(/-----BEGIN PUBLIC KEY-----/gu, "")
    .replace(/-----END PUBLIC KEY-----/gu, "")
    .replace(/\s+/gu, "");
  if (!body) {
    throw new Error("public key PEM is empty");
  }
  return Buffer.from(body, "base64");
}

function publicKeyPemFromDer(der) {
  const body = Buffer.from(der)
    .toString("base64")
    .replace(/(.{64})/gu, "$1\n")
    .trim();
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`;
}

function publicKeyFingerprintFromDer(der) {
  return base64Url(crypto.createHash("sha256").update(der).digest()).slice(0, 32);
}

function repairCryptoKitRawP256Spki(publicKeyPem) {
  const der = publicKeyDerFromPem(publicKeyPem);
  const hasMalformedCryptoKitRawPoint =
    der.length === p256SpkiHeader.length + 64 &&
    der.subarray(0, p256SpkiHeader.length).equals(p256SpkiHeader);
  if (!hasMalformedCryptoKitRawPoint) {
    return "";
  }

  const repaired = Buffer.concat([
    p256SpkiHeader,
    Buffer.from([0x04]),
    der.subarray(p256SpkiHeader.length),
  ]);
  const pem = publicKeyPemFromDer(repaired);
  crypto.createPublicKey(pem);
  return pem;
}

function cryptoKitRawP256SpkiDerFromCanonical(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  const der = Buffer.from(key.export({ type: "spki", format: "der" }));
  const hasCanonicalP256Point =
    der.length === p256SpkiHeader.length + 65 &&
    der.subarray(0, p256SpkiHeader.length).equals(p256SpkiHeader) &&
    der[p256SpkiHeader.length] === 0x04;
  if (!hasCanonicalP256Point) {
    return null;
  }
  return Buffer.concat([
    p256SpkiHeader,
    der.subarray(p256SpkiHeader.length + 1),
  ]);
}

export function stableJson(value) {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

export function canonicalCloudEnvelopePayload(envelope = {}) {
  const payload = { ...envelope };
  delete payload.signature;
  return stableJson(payload);
}

export function generateP256KeyPair() {
  return crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });
}

export function cloudPublicKeyFingerprint(publicKeyPem) {
  const key = crypto.createPublicKey(normalizeCloudPublicKeyPem(publicKeyPem));
  const der = key.export({ type: "spki", format: "der" });
  return publicKeyFingerprintFromDer(der);
}

export function normalizeCloudPublicKeyPem(publicKeyPem) {
  const trimmed = String(publicKeyPem || "").trim();
  try {
    crypto.createPublicKey(trimmed);
    return `${trimmed}\n`;
  } catch (error) {
    const repaired = repairCryptoKitRawP256Spki(trimmed);
    if (repaired) {
      return repaired;
    }
    throw error;
  }
}

export function cloudPublicKeyAcceptedFingerprints(publicKeyPem) {
  const fingerprints = new Set();

  const normalizedPem = normalizeCloudPublicKeyPem(publicKeyPem);
  fingerprints.add(cloudPublicKeyFingerprint(normalizedPem));

  try {
    fingerprints.add(publicKeyFingerprintFromDer(publicKeyDerFromPem(publicKeyPem)));
  } catch {
    // The canonical fingerprint above is sufficient for normal PEM input.
  }

  try {
    const legacyDer = cryptoKitRawP256SpkiDerFromCanonical(normalizedPem);
    if (legacyDer) {
      fingerprints.add(publicKeyFingerprintFromDer(legacyDer));
    }
  } catch {
    // Non-P256 keys do not need the temporary build-3 compatibility fingerprint.
  }

  return [...fingerprints].filter(Boolean);
}

export function normalizeCloudEnvelope(input = {}, defaults = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("cloud envelope must be an object");
  }

  const now = defaults.now instanceof Date ? defaults.now : new Date();
  const createdAt = String(input.createdAt || defaults.createdAt || now.toISOString());
  const expiresAt = String(
    input.expiresAt ||
      defaults.expiresAt ||
      new Date(now.getTime() + 60_000).toISOString(),
  );
  const type = String(input.type || defaults.type || "").trim();
  const id = String(input.id || defaults.id || crypto.randomUUID()).trim();
  const seq = Number.isInteger(input.seq) && input.seq >= 0
    ? input.seq
    : Number.isInteger(defaults.seq) && defaults.seq >= 0
      ? defaults.seq
      : 0;

  return {
    id,
    protocolVersion: String(input.protocolVersion || defaults.protocolVersion || cloudProtocolVersion),
    type,
    accountId: String(input.accountId || defaults.accountId || "").trim(),
    workspaceId: String(input.workspaceId || defaults.workspaceId || "").trim(),
    sourceDeviceId: String(input.sourceDeviceId || defaults.sourceDeviceId || "").trim(),
    targetHostId: String(input.targetHostId || defaults.targetHostId || "").trim(),
    seq,
    createdAt,
    expiresAt,
    body: input.body && typeof input.body === "object" && !Array.isArray(input.body)
      ? input.body
      : {},
    ...(input.signature ? { signature: input.signature } : {}),
  };
}

export function validateCloudEnvelope(input = {}, options = {}) {
  const errors = [];
  let envelope;
  try {
    envelope = normalizeCloudEnvelope(input, options.defaults || {});
  } catch (error) {
    return { ok: false, errors: [error.message], envelope: null };
  }

  if (envelope.protocolVersion !== cloudProtocolVersion) {
    errors.push(`unsupported protocolVersion '${envelope.protocolVersion}'`);
  }
  if (!cloudEnvelopeTypeSet.has(envelope.type)) {
    errors.push(`unsupported cloud envelope type '${envelope.type}'`);
  }
  for (const field of ["id", "accountId", "workspaceId", "sourceDeviceId"]) {
    if (!envelope[field]) {
      errors.push(`missing ${field}`);
    }
  }
  if (!envelope.createdAt || Number.isNaN(Date.parse(envelope.createdAt))) {
    errors.push("createdAt must be an ISO timestamp");
  }
  const expiresAtMs = Date.parse(envelope.expiresAt);
  if (!envelope.expiresAt || Number.isNaN(expiresAtMs)) {
    errors.push("expiresAt must be an ISO timestamp");
  } else {
    const nowMs = options.now instanceof Date
      ? options.now.getTime()
      : Number.isFinite(options.now)
        ? Number(options.now)
        : Date.now();
    if (expiresAtMs < nowMs) {
      errors.push("cloud envelope is expired");
    }
  }

  return { ok: errors.length === 0, errors, envelope };
}

export function signCloudEnvelope(envelope, privateKeyPem, options = {}) {
  const normalized = normalizeCloudEnvelope(envelope, options.defaults || {});
  const signer = crypto.createSign("SHA256");
  signer.update(canonicalCloudEnvelopePayload(normalized));
  signer.end();
  const signature = base64Url(signer.sign(privateKeyPem));
  return {
    ...normalized,
    signature: {
      alg: "ES256",
      keyId: String(options.keyId || "").trim(),
      value: signature,
    },
  };
}

export function verifyCloudEnvelopeSignature(envelope, publicKeyPem) {
  const signature = envelope?.signature;
  if (!signature || signature.alg !== "ES256" || !signature.value) {
    return false;
  }

  const verifier = crypto.createVerify("SHA256");
  verifier.update(canonicalCloudEnvelopePayload(envelope));
  verifier.end();
  try {
    return verifier.verify(publicKeyPem, fromBase64Url(signature.value));
  } catch {
    return false;
  }
}

export function cloudEnvelopeRequiresTrustedDevice(envelope = {}) {
  return trustedDeviceCloudEnvelopeTypeSet.has(String(envelope.type || "").trim());
}

export function createCloudErrorEnvelope(sourceEnvelope = {}, message, options = {}) {
  return normalizeCloudEnvelope({
    type: "error",
    accountId: sourceEnvelope.accountId || options.accountId || "",
    workspaceId: sourceEnvelope.workspaceId || options.workspaceId || "",
    sourceDeviceId: options.sourceDeviceId || sourceEnvelope.targetHostId || "host",
    targetHostId: sourceEnvelope.sourceDeviceId || "",
    body: {
      inReplyTo: sourceEnvelope.id || "",
      error: String(message || "cloud command failed"),
      code: String(options.code || "cloud_error"),
    },
  }, options.defaults || {});
}
