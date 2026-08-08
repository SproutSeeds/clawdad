import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  cloudPublicKeyAcceptedFingerprints,
  cloudEnvelopeRequiresTrustedDevice,
  cloudPublicKeyFingerprint,
  generateP256KeyPair,
  normalizeCloudEnvelope,
  normalizeCloudPublicKeyPem,
  signCloudEnvelope,
  validateCloudEnvelope,
  verifyCloudEnvelopeSignature,
} from "../lib/cloud-protocol.mjs";

const p256SpkiHeader = Buffer.from([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86,
  0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
  0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03,
  0x42, 0x00,
]);

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function pemFromDer(der) {
  return `-----BEGIN PUBLIC KEY-----\n${Buffer.from(der).toString("base64").replace(/(.{64})/gu, "$1\n").trim()}\n-----END PUBLIC KEY-----\n`;
}

function malformedCryptoKitRawP256Pem(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  const der = Buffer.from(key.export({ type: "spki", format: "der" }));
  assert.equal(der.subarray(0, p256SpkiHeader.length).equals(p256SpkiHeader), true);
  assert.equal(der[p256SpkiHeader.length], 0x04);
  return pemFromDer(Buffer.concat([
    p256SpkiHeader,
    der.subarray(p256SpkiHeader.length + 1),
  ]));
}

function fingerprintDer(der) {
  return base64Url(crypto.createHash("sha256").update(der).digest()).slice(0, 32);
}

test("cloud envelopes can be signed and verified with P-256 keys", () => {
  const keys = generateP256KeyPair();
  const envelope = normalizeCloudEnvelope({
    type: "message.send",
    accountId: "acct-1",
    workspaceId: "scratchpad",
    sourceDeviceId: "ios-phone",
    targetHostId: "mac-host",
    body: {
      project: "/tmp/project",
      message: "hello",
    },
  });

  const signed = signCloudEnvelope(envelope, keys.privateKey, {
    keyId: cloudPublicKeyFingerprint(keys.publicKey),
  });

  assert.equal(signed.signature.alg, "ES256");
  assert.equal(verifyCloudEnvelopeSignature(signed, keys.publicKey), true);

  const tampered = {
    ...signed,
    body: {
      ...signed.body,
      message: "changed",
    },
  };
  assert.equal(verifyCloudEnvelopeSignature(tampered, keys.publicKey), false);
});

test("cloud public keys repair the build-3 CryptoKit raw P-256 SPKI shape", () => {
  const keys = generateP256KeyPair();
  const malformedPem = malformedCryptoKitRawP256Pem(keys.publicKey);
  assert.throws(() => crypto.createPublicKey(malformedPem));

  const normalizedPem = normalizeCloudPublicKeyPem(malformedPem);
  assert.doesNotThrow(() => crypto.createPublicKey(normalizedPem));
  assert.equal(cloudPublicKeyFingerprint(malformedPem), cloudPublicKeyFingerprint(keys.publicKey));

  const malformedDer = Buffer.from(
    malformedPem
      .replace(/-----BEGIN PUBLIC KEY-----/gu, "")
      .replace(/-----END PUBLIC KEY-----/gu, "")
      .replace(/\s+/gu, ""),
    "base64",
  );
  assert.ok(cloudPublicKeyAcceptedFingerprints(normalizedPem).includes(fingerprintDer(malformedDer)));
  assert.ok(cloudPublicKeyAcceptedFingerprints(malformedPem).includes(fingerprintDer(malformedDer)));
});

test("cloud envelope validation rejects expired envelopes", () => {
  const envelope = normalizeCloudEnvelope({
    type: "ping",
    accountId: "acct-1",
    workspaceId: "scratchpad",
    sourceDeviceId: "ios-phone",
    expiresAt: "2026-01-01T00:00:00.000Z",
  });
  const result = validateCloudEnvelope(envelope, {
    now: new Date("2026-06-22T00:00:00.000Z"),
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("cloud envelope is expired"));
});

test("cloud model reads and session creation require a paired device", () => {
  assert.equal(cloudEnvelopeRequiresTrustedDevice({ type: "models.request" }), true);
  assert.equal(cloudEnvelopeRequiresTrustedDevice({ type: "project.create.request" }), true);
  assert.equal(cloudEnvelopeRequiresTrustedDevice({ type: "session.create.request" }), true);
  assert.equal(cloudEnvelopeRequiresTrustedDevice({ type: "speech.transcribe.request" }), true);
  assert.equal(cloudEnvelopeRequiresTrustedDevice({ type: "ping" }), false);
});

test("cloud protocol accepts signed project directory creation envelopes", () => {
  const base = {
    accountId: "acct-1",
    workspaceId: "scratchpad",
  };
  const request = validateCloudEnvelope(normalizeCloudEnvelope({
    ...base,
    type: "project.create.request",
    sourceDeviceId: "ios-phone",
    targetHostId: "mac-host",
    body: {
      requestId: "project-1",
      name: "new-project",
    },
  }));
  const created = validateCloudEnvelope(normalizeCloudEnvelope({
    ...base,
    type: "project.created",
    sourceDeviceId: "mac-host",
    targetHostId: "ios-phone",
    body: {
      requestId: "project-1",
      projectPath: "/workspace/new-project",
      sessionId: "session-1",
    },
  }));

  assert.equal(request.ok, true);
  assert.equal(created.ok, true);
  assert.equal(cloudEnvelopeRequiresTrustedDevice(request.envelope), true);
  assert.equal(cloudEnvelopeRequiresTrustedDevice(created.envelope), false);
});

test("Remote Assist signaling preserves paired-device authority boundaries", () => {
  for (const type of [
    "remote.assist.request",
    "remote.assist.answer",
    "remote.assist.ice",
    "remote.assist.stop",
  ]) {
    assert.equal(cloudEnvelopeRequiresTrustedDevice({ type }), true, type);
  }
  for (const type of [
    "remote.assist.available",
    "remote.assist.offer",
    "remote.assist.error",
  ]) {
    assert.equal(cloudEnvelopeRequiresTrustedDevice({ type }), false, type);
  }

  const offer = validateCloudEnvelope(normalizeCloudEnvelope({
    type: "remote.assist.offer",
    accountId: "acct-1",
    workspaceId: "scratchpad",
    sourceDeviceId: "mac-host",
    targetHostId: "ios-phone",
    body: {
      sessionId: "remote-1",
      sdp: "v=0",
    },
  }));
  assert.equal(offer.ok, true);
});

test("cloud protocol accepts paired speech transcription request and response envelopes", () => {
  const request = validateCloudEnvelope(normalizeCloudEnvelope({
    type: "speech.transcribe.request",
    accountId: "acct-1",
    workspaceId: "scratchpad",
    sourceDeviceId: "ios-phone",
    targetHostId: "mac-host",
    body: {
      requestId: "voice-1",
      fileName: "clawdad-voice.m4a",
      mimeType: "audio/mp4",
      dataBase64: Buffer.from("voice").toString("base64"),
    },
  }));
  const accepted = validateCloudEnvelope(normalizeCloudEnvelope({
    type: "speech.transcribe.accepted",
    accountId: "acct-1",
    workspaceId: "scratchpad",
    sourceDeviceId: "mac-host",
    targetHostId: "ios-phone",
    body: {
      requestId: "voice-1",
    },
  }));
  const response = validateCloudEnvelope(normalizeCloudEnvelope({
    type: "speech.transcription",
    accountId: "acct-1",
    workspaceId: "scratchpad",
    sourceDeviceId: "mac-host",
    targetHostId: "ios-phone",
    body: {
      requestId: "voice-1",
      text: "Transcribed message.",
    },
  }));

  assert.equal(request.ok, true);
  assert.equal(accepted.ok, true);
  assert.equal(response.ok, true);
});

test("cloud protocol accepts paired on-demand speech synthesis envelopes", () => {
  const base = {
    accountId: "acct-1",
    workspaceId: "scratchpad",
  };
  const request = validateCloudEnvelope(normalizeCloudEnvelope({
    ...base,
    type: "speech.synthesize.request",
    sourceDeviceId: "ios-phone",
    targetHostId: "mac-host",
    body: {
      requestId: "audio-1",
      project: "/workspace/clawdad",
      sessionId: "session-1",
      historyRequestId: "turn-1",
      kind: "response",
      text: "Read this response aloud.",
    },
  }));
  const accepted = validateCloudEnvelope(normalizeCloudEnvelope({
    ...base,
    type: "speech.synthesize.accepted",
    sourceDeviceId: "mac-host",
    targetHostId: "ios-phone",
    body: { requestId: "audio-1" },
  }));
  const chunk = validateCloudEnvelope(normalizeCloudEnvelope({
    ...base,
    type: "speech.synthesis.chunk",
    sourceDeviceId: "mac-host",
    targetHostId: "ios-phone",
    body: {
      requestId: "audio-1",
      partIndex: 0,
      partCount: 1,
      chunkIndex: 0,
      chunkCount: 1,
      mimeType: "audio/wav",
      dataBase64: Buffer.from("audio").toString("base64"),
    },
  }));
  const complete = validateCloudEnvelope(normalizeCloudEnvelope({
    ...base,
    type: "speech.synthesis.complete",
    sourceDeviceId: "mac-host",
    targetHostId: "ios-phone",
    body: { requestId: "audio-1", partCount: 1 },
  }));

  assert.equal(request.ok, true);
  assert.equal(accepted.ok, true);
  assert.equal(chunk.ok, true);
  assert.equal(complete.ok, true);
  assert.equal(cloudEnvelopeRequiresTrustedDevice(request.envelope), true);
});
