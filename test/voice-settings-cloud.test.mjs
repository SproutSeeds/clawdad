import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceRelay } from "../cloud/worker.mjs";
import { handleCloudEnvelope } from "../lib/cloud-host-connector.mjs";
import {
  cloudEnvelopeRequiresTrustedDevice,
  cloudPublicKeyFingerprint,
  generateP256KeyPair,
  normalizeCloudEnvelope,
  signCloudEnvelope,
  stateChangingCloudEnvelopeTypes,
  validateCloudEnvelope,
  verifyCloudEnvelopeSignature,
} from "../lib/cloud-protocol.mjs";

function connection() {
  const device = generateP256KeyPair();
  const host = generateP256KeyPair();
  const config = {
    accountId: "voice-test-account", workspaceId: "voice-test-workspace",
    hostId: "voice-test-mac", localUrl: "http://localhost:4477", localToken: "test-local-token",
    hostPrivateKeyPem: host.privateKey, hostPublicKeyPem: host.publicKey,
    trustedDevicePublicKeys: { "voice-test-phone": device.publicKey },
    allowUnverifiedCloudDevices: false,
  };
  const envelope = (type, body = {}, key = device) => signCloudEnvelope(normalizeCloudEnvelope({
    type, accountId: config.accountId, workspaceId: config.workspaceId,
    sourceDeviceId: "voice-test-phone", targetHostId: config.hostId,
    body: { requestId: `request-${crypto.randomUUID()}`, ...body },
  }), key.privateKey, { keyId: cloudPublicKeyFingerprint(key.publicKey) });
  return { config, envelope };
}

test("voice settings protocol supports read, save and reply with paired-device protection", () => {
  const { envelope } = connection();
  for (const type of ["speech.voices.request", "speech.voices.update", "speech.voices"]) {
    const result = validateCloudEnvelope(envelope(type));
    assert.equal(result.ok, true, result.errors.join("; "));
    assert.equal(cloudEnvelopeRequiresTrustedDevice({ type }), type !== "speech.voices");
  }
  assert.ok(stateChangingCloudEnvelopeTypes.includes("speech.voices.update"));
  assert.equal(validateCloudEnvelope(envelope("speech.voices.erase")).ok, false);
});

test("Settings reads, saves and reloads through relay routing and the real Mac envelope handler", async t => {
  const { config, envelope } = connection();
  const relay = new WorkspaceRelay({}, {});
  const phoneMessages = [], hostMessages = [], otherPhoneMessages = [];
  const phone = { send: raw => phoneMessages.push(JSON.parse(raw)) };
  const host = { send: raw => hostMessages.push(JSON.parse(raw)) };
  const otherPhone = { send: raw => otherPhoneMessages.push(JSON.parse(raw)) };
  const base = { accountId: config.accountId, workspaceId: config.workspaceId };
  const phoneMetadata = { ...base, hostId: "", deviceId: "voice-test-phone", role: "device" };
  const hostMetadata = { ...base, hostId: config.hostId, deviceId: "", role: "host" };
  relay.sessions.set(phone, phoneMetadata);
  relay.sessions.set(host, hostMetadata);
  relay.sessions.set(otherPhone, { ...phoneMetadata, deviceId: "another-phone" });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let selection = { engine: "kokoro", modelId: "kokoro-82m-v1", voice: "af_heart", speed: 1 };
  const chosen = { engine: "pocket", modelId: "pocket-tts-3.1", voice: "anna", speed: 1 };
  const requests = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, "/v1/tts/voices");
    assert.equal(options.headers.authorization, "Bearer test-local-token");
    requests.push(options.method || "GET");
    if (options.method === "POST") selection = JSON.parse(options.body).selection;
    return Response.json({ schema: "clawdad.local-voices/1", models: [], selection,
      voicesByModel: { [selection.engine]: selection }, previewText: "Compare this voice." });
  };
  for (const [type, body] of [["speech.voices.request", {}], ["speech.voices.update", { selection: chosen }], ["speech.voices.request", {}]]) {
    const request = envelope(type, body);
    assert.equal(relay.forward(phone, JSON.stringify(request), phoneMetadata), 1);
    const delivered = hostMessages.shift();
    assert.equal(delivered.relay.sourceRole, "device");
    const result = await handleCloudEnvelope(delivered, config, async reply => {
      assert.equal(validateCloudEnvelope(reply).ok, true);
      assert.equal(verifyCloudEnvelopeSignature(reply, config.hostPublicKeyPem), true);
      assert.equal(relay.forward(host, JSON.stringify(reply), hostMetadata), 1);
    });
    assert.equal(result.ok, true, result.error);
    const response = phoneMessages.shift();
    assert.equal(response.type, "speech.voices");
    assert.equal(response.targetHostId, "voice-test-phone");
    assert.equal(response.body.requestId, request.body.requestId);
    assert.equal(response.body.inReplyTo, request.id);
    assert.deepEqual(response.body.selection, selection);
  }
  assert.deepEqual(requests, ["GET", "POST", "GET"]);
  assert.deepEqual(selection, chosen);
  assert.equal(otherPhoneMessages.length, 0);
});

test("unsigned, unpaired and tampered voice settings commands cannot reach the local API", async t => {
  const { config, envelope } = connection();
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Untrusted request reached the API"); };
  for (const type of ["speech.voices.request", "speech.voices.update"]) {
    const signed = envelope(type, { selection: { engine: "kitten", voice: "Jasper", speed: 1 } });
    const unsigned = { ...signed };
    delete unsigned.signature;
    const unpaired = envelope(type, {}, generateP256KeyPair());
    const tampered = { ...signed, body: { ...signed.body, selection: { engine: "pocket", voice: "alba", speed: 1 } } };
    for (const request of [unsigned, unpaired, tampered]) {
      const sent = [];
      const result = await handleCloudEnvelope(request, config, async reply => sent.push(reply));
      assert.equal(result.ok, false);
      assert.equal(sent[0].body.code, "untrusted_device");
      assert.equal(verifyCloudEnvelopeSignature(sent[0], config.hostPublicKeyPem), true);
    }
  }
  assert.equal(calls, 0);
});
