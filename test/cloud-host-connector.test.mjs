import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import {
  cloudPublicKeyAcceptedFingerprints,
  cloudPublicKeyFingerprint,
  generateP256KeyPair,
  normalizeCloudEnvelope,
  normalizeCloudPublicKeyPem,
  signCloudEnvelope,
  verifyCloudEnvelopeSignature,
} from "../lib/cloud-protocol.mjs";
import {
  cloudHostReconnectDelayMs,
  createCloudPairingPayload,
  ensureCloudRelayAccess,
  handleCloudEnvelope,
} from "../lib/cloud-host-connector.mjs";

const p256SpkiHeader = Buffer.from([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86,
  0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
  0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03,
  0x42, 0x00,
]);

function pemFromDer(der) {
  return `-----BEGIN PUBLIC KEY-----\n${Buffer.from(der).toString("base64").replace(/(.{64})/gu, "$1\n").trim()}\n-----END PUBLIC KEY-----\n`;
}

function malformedCryptoKitRawP256Pem(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  const der = Buffer.from(key.export({ type: "spki", format: "der" }));
  return pemFromDer(Buffer.concat([
    p256SpkiHeader,
    der.subarray(p256SpkiHeader.length + 1),
  ]));
}

function hostConfig({ trustedDevicePublicKeys = {}, allowUnverifiedCloudDevices = false } = {}) {
  const hostKeys = generateP256KeyPair();
  return {
    accountId: "acct-1",
    workspaceId: "scratchpad",
    hostId: "mac-host",
    localUrl: "http://127.0.0.1:4477",
    localToken: "local-token",
    hostPrivateKeyPem: hostKeys.privateKey,
    hostPublicKeyPem: hostKeys.publicKey,
    cloudUrl: "https://clawdad-cloud.frg.earth",
    trustedDevicePublicKeys,
    allowUnverifiedCloudDevices,
  };
}

test("pair.request trusts a signed phone after QR token proof", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawdad-cloud-pair-"));
  const configPath = path.join(tempDir, "cloud.json");
  const pairingPath = path.join(tempDir, "cloud-pairing.json");
  const config = {
    ...hostConfig(),
    configPath,
    pairingPath,
  };
  await writeFile(configPath, JSON.stringify({
    cloudUrl: config.cloudUrl,
    accountId: config.accountId,
    workspaceId: config.workspaceId,
    hostId: config.hostId,
    trustedDevicePublicKeys: {},
  }), "utf8");
  await writeFile(pairingPath, JSON.stringify({
    tokens: [
      {
        token: "pair-token",
        cloudUrl: config.cloudUrl,
        accountId: config.accountId,
        workspaceId: config.workspaceId,
        hostId: config.hostId,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    ],
  }), "utf8");

  const deviceKeys = generateP256KeyPair();
  const keyId = cloudPublicKeyFingerprint(deviceKeys.publicKey);
  const envelope = signCloudEnvelope(normalizeCloudEnvelope({
    type: "pair.request",
    accountId: config.accountId,
    workspaceId: config.workspaceId,
    sourceDeviceId: "ios-phone",
    targetHostId: config.hostId,
    body: {
      token: "pair-token",
      publicKeyPem: deviceKeys.publicKey,
      keyId,
      deviceName: "CodyVerse",
    },
  }), deviceKeys.privateKey, { keyId });
  const sent = [];

  const result = await handleCloudEnvelope(envelope, config, async (payload) => {
    sent.push(payload);
  });

  assert.equal(result.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "pair.accepted");
  assert.equal(sent[0].body.deviceId, "ios-phone");
  assert.equal(sent[0].body.keyId, keyId);
  assert.equal(config.trustedDevicePublicKeys["ios-phone"], normalizeCloudPublicKeyPem(deviceKeys.publicKey));

  const diskConfig = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(diskConfig.trustedDevicePublicKeys["ios-phone"], normalizeCloudPublicKeyPem(deviceKeys.publicKey));
  assert.equal(diskConfig.trustedDeviceNames["ios-phone"], "CodyVerse");

  const pairingStore = JSON.parse(await readFile(pairingPath, "utf8"));
  assert.deepEqual(pairingStore.tokens, []);
});

test("pairing creates and returns the Mac signing identity", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawdad-cloud-host-identity-"));
  const configPath = path.join(tempDir, "cloud.json");
  const pairingPath = path.join(tempDir, "cloud-pairing.json");
  await writeFile(configPath, JSON.stringify({
    cloudUrl: "https://clawdad-cloud.frg.earth",
    accountId: "acct-1",
    workspaceId: "scratchpad",
    hostId: "mac-host",
    pairingPath,
  }), "utf8");

  const payload = await createCloudPairingPayload({
    config: configPath,
    registerRelayAccess: false,
  });

  assert.match(payload.hostPublicKeyPem, /BEGIN PUBLIC KEY/u);
  assert.equal(payload.hostKeyId, cloudPublicKeyFingerprint(payload.hostPublicKeyPem));
  const diskConfig = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(path.dirname(diskConfig.hostPrivateKeyPath), tempDir);
  assert.equal(path.dirname(diskConfig.hostPublicKeyPath), tempDir);
  assert.match(await readFile(diskConfig.hostPrivateKeyPath, "utf8"), /BEGIN PRIVATE KEY/u);
  assert.equal(
    normalizeCloudPublicKeyPem(await readFile(diskConfig.hostPublicKeyPath, "utf8")),
    normalizeCloudPublicKeyPem(payload.hostPublicKeyPem),
  );
});

test("relay access creates opaque workspace credentials and claims the host", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawdad-cloud-access-"));
  const configPath = path.join(tempDir, "cloud.json");
  await writeFile(configPath, JSON.stringify({
    cloudUrl: "https://clawdad-cloud.frg.earth",
    hostId: "mac-host",
  }), "utf8");
  const requests = [];
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({
      ok: true,
      claimed: true,
    }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };
  const config = {
    configPath,
    cloudUrl: "https://clawdad-cloud.frg.earth",
    accountId: "",
    workspaceId: "",
    hostId: "mac-host",
    relayHostToken: "",
    relayBootstrapToken: "",
    hostPrivateKeyPem: "",
    hostPublicKeyPem: "",
  };

  const claimed = await ensureCloudRelayAccess(config);

  assert.match(claimed.accountId, /^acct_[a-f0-9]{32}$/u);
  assert.match(claimed.workspaceId, /^ws_[a-f0-9]{32}$/u);
  assert.match(config.relayHostToken, /^[a-f0-9]{64}$/u);
  assert.equal(requests.length, 1);
  const requestUrl = new URL(requests[0].url);
  assert.equal(
    requestUrl.pathname,
    `/workspaces/${claimed.workspaceId}/access/claim`,
  );
  assert.equal(requestUrl.searchParams.get("accountId"), claimed.accountId);
  assert.equal(
    requests[0].options.headers.authorization,
    `Bearer ${config.relayHostToken}`,
  );
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.accountId, claimed.accountId);
  assert.equal(body.hostId, "mac-host");

  const diskConfig = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(diskConfig.accountId, claimed.accountId);
  assert.equal(diskConfig.workspaceId, claimed.workspaceId);
  assert.equal(diskConfig.relayHostToken, config.relayHostToken);
  assert.match(diskConfig.hostPrivateKeyPath, /cloud-host-private\.pem$/u);
  assert.match(diskConfig.hostPublicKeyPath, /cloud-host-public\.pem$/u);
});

test("the Node cloud host leaves Remote Assist signaling to the native Mac host", async () => {
  const deviceKeys = generateP256KeyPair();
  const config = hostConfig({
    trustedDevicePublicKeys: {
      "ios-phone": deviceKeys.publicKey,
    },
  });
  const keyId = cloudPublicKeyFingerprint(deviceKeys.publicKey);
  const envelope = signCloudEnvelope(normalizeCloudEnvelope({
    type: "remote.assist.request",
    accountId: config.accountId,
    workspaceId: config.workspaceId,
    sourceDeviceId: "ios-phone",
    targetHostId: config.hostId,
    body: {
      sessionId: "remote-1",
      transport: "webrtc",
    },
  }), deviceKeys.privateKey, { keyId });
  const sent = [];

  const result = await handleCloudEnvelope(envelope, config, async (payload) => {
    sent.push(payload);
  });

  assert.deepEqual(result, { ok: true, ignored: true });
  assert.deepEqual(sent, []);
});

test("trusted StoreKit entitlement sync persists a privacy-safe Mac snapshot", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawdad-entitlement-"));
  const entitlementPath = path.join(tempDir, "entitlement.json");
  const deviceKeys = generateP256KeyPair();
  const signedTransaction = "apple.signed.transaction";
  let verifierInput = null;
  const config = {
    ...hostConfig({
      trustedDevicePublicKeys: {
        "ios-phone": deviceKeys.publicKey,
      },
    }),
    entitlementPath,
    verifyStoreKitTransaction: async (input) => {
      verifierInput = input;
      return {
        active: true,
        source: "storekit-2",
        productId: "earth.frg.clawdad.pro.monthly",
        transactionId: "2000001234567890",
        originalTransactionId: "2000001234567890",
        purchasedAt: "2026-07-30T00:00:00.000Z",
        expiresAt,
        revokedAt: "",
        introductoryOffer: true,
        environment: "Sandbox",
        verification: "apple-storekit-jws",
      };
    },
  };
  const keyId = cloudPublicKeyFingerprint(deviceKeys.publicKey);
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60_000).toISOString();
  const envelope = signCloudEnvelope(normalizeCloudEnvelope({
    type: "entitlement.sync",
    accountId: config.accountId,
    workspaceId: config.workspaceId,
    sourceDeviceId: "ios-phone",
    targetHostId: config.hostId,
    body: {
      active: true,
      source: "storekit-2",
      productId: "earth.frg.clawdad.pro.monthly",
      transactionId: "2000001234567890",
      originalTransactionId: "2000001234567890",
      expiresAt,
      revokedAt: "",
      introductoryOffer: true,
      environment: "Sandbox",
      signedTransaction,
    },
  }), deviceKeys.privateKey, { keyId });
  const sent = [];

  const result = await handleCloudEnvelope(envelope, config, async (payload) => {
    sent.push(payload);
  });

  assert.equal(result.ok, true);
  assert.equal(verifierInput.signedTransaction, signedTransaction);
  assert.equal(verifierInput.expectedEnvironment, "Sandbox");
  assert.equal(sent[0].type, "entitlement.accepted");
  assert.equal(sent[0].body.active, true);
  const stored = JSON.parse(await readFile(entitlementPath, "utf8"));
  assert.equal(stored.active, true);
  assert.equal(stored.verification, "apple-storekit-jws");
  assert.equal(stored.productId, "earth.frg.clawdad.pro.monthly");
  for (const privateField of [
    "deviceId",
    "environment",
    "message",
    "observedAt",
    "originalTransactionId",
    "publicKeyPem",
    "purchasedAt",
    "signedTransaction",
    "transactionId",
  ]) {
    assert.equal(privateField in stored, false, `${privateField} must not persist`);
  }
});

test("active StoreKit entitlement without Apple signed proof is rejected", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawdad-entitlement-forged-"));
  const deviceKeys = generateP256KeyPair();
  const config = {
    ...hostConfig({
      trustedDevicePublicKeys: {
        "ios-phone": deviceKeys.publicKey,
      },
    }),
    entitlementPath: path.join(tempDir, "entitlement.json"),
  };
  const keyId = cloudPublicKeyFingerprint(deviceKeys.publicKey);
  const envelope = signCloudEnvelope(normalizeCloudEnvelope({
    type: "entitlement.sync",
    accountId: config.accountId,
    workspaceId: config.workspaceId,
    sourceDeviceId: "ios-phone",
    targetHostId: config.hostId,
    body: {
      active: true,
      source: "storekit-2",
      productId: "earth.frg.clawdad.pro.monthly",
      transactionId: "forged",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      environment: "Sandbox",
    },
  }), deviceKeys.privateKey, { keyId });
  const sent = [];

  const result = await handleCloudEnvelope(envelope, config, async (payload) => {
    sent.push(payload);
  });

  assert.equal(result.ok, false);
  assert.equal(sent[0].type, "error");
  assert.match(sent[0].body.error, /missing Apple signed proof/iu);
});

test("pair.request accepts and repairs build-3 CryptoKit raw P-256 public keys", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawdad-cloud-pair-legacy-"));
  const configPath = path.join(tempDir, "cloud.json");
  const pairingPath = path.join(tempDir, "cloud-pairing.json");
  const config = {
    ...hostConfig(),
    configPath,
    pairingPath,
  };
  await writeFile(configPath, JSON.stringify({
    cloudUrl: config.cloudUrl,
    accountId: config.accountId,
    workspaceId: config.workspaceId,
    hostId: config.hostId,
    trustedDevicePublicKeys: {},
  }), "utf8");
  await writeFile(pairingPath, JSON.stringify({
    tokens: [
      {
        token: "pair-token",
        cloudUrl: config.cloudUrl,
        accountId: config.accountId,
        workspaceId: config.workspaceId,
        hostId: config.hostId,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    ],
  }), "utf8");

  const deviceKeys = generateP256KeyPair();
  const malformedPublicKey = malformedCryptoKitRawP256Pem(deviceKeys.publicKey);
  const canonicalKeyId = cloudPublicKeyFingerprint(deviceKeys.publicKey);
  const legacyKeyId = cloudPublicKeyAcceptedFingerprints(malformedPublicKey)
    .find((fingerprint) => fingerprint !== canonicalKeyId);
  assert.ok(legacyKeyId);
  const envelope = signCloudEnvelope(normalizeCloudEnvelope({
    type: "pair.request",
    accountId: config.accountId,
    workspaceId: config.workspaceId,
    sourceDeviceId: "ios-phone",
    targetHostId: config.hostId,
    body: {
      token: "pair-token",
      publicKeyPem: malformedPublicKey,
      keyId: legacyKeyId,
      deviceName: "Build 3 iPhone",
    },
  }), deviceKeys.privateKey, { keyId: legacyKeyId });
  const sent = [];

  const result = await handleCloudEnvelope(envelope, config, async (payload) => {
    sent.push(payload);
  });

  assert.equal(result.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "pair.accepted");
  assert.equal(sent[0].body.keyId, canonicalKeyId);
  assert.equal(config.trustedDevicePublicKeys["ios-phone"], normalizeCloudPublicKeyPem(deviceKeys.publicKey));
  assert.doesNotThrow(() => crypto.createPublicKey(config.trustedDevicePublicKeys["ios-phone"]));

  const diskConfig = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(diskConfig.trustedDevicePublicKeys["ios-phone"], normalizeCloudPublicKeyPem(deviceKeys.publicKey));
  assert.equal(diskConfig.trustedDeviceNames["ios-phone"], "Build 3 iPhone");
});

test("trusted catalog.request synchronizes the selected project before returning threads", async (t) => {
  const deviceKeys = generateP256KeyPair();
  const config = hostConfig({
    trustedDevicePublicKeys: {
      "ios-phone": deviceKeys.publicKey,
    },
  });
  const requests = [];
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({
      ok: true,
      recentThreads: [{
        projectName: "Worldwrought",
        projectPath: "/Volumes/Code_2TB/code/Worldwrought",
        title: "Recent worldbuilding",
        sessionId: "019f5900-42ce-7e23-8680-855bdbfcddd3",
        lastActivityAt: "2026-07-27T03:00:00.000Z",
      }],
      projects: [{
        path: "/Volumes/Code_2TB/code/Worldwrought",
        activeSessionId: "019f5900-42ce-7e23-8680-855bdbfcddd3",
        sessions: [{ sessionId: "019f5900-42ce-7e23-8680-855bdbfcddd3" }],
      }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const envelope = signCloudEnvelope(normalizeCloudEnvelope({
    type: "catalog.request",
    accountId: "acct-1",
    workspaceId: "scratchpad",
    sourceDeviceId: "ios-phone",
    targetHostId: "mac-host",
    body: {
      project: "/Volumes/Code_2TB/code/Worldwrought",
    },
  }), deviceKeys.privateKey, {
    keyId: cloudPublicKeyFingerprint(deviceKeys.publicKey),
  });
  const sent = [];

  const result = await handleCloudEnvelope(envelope, config, async (payload) => {
    sent.push(payload);
  });

  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  const requestUrl = new URL(requests[0].url);
  assert.equal(requestUrl.pathname, "/v1/projects");
  assert.equal(requestUrl.searchParams.get("lean"), "1");
  assert.equal(requestUrl.searchParams.get("syncProject"), "/Volumes/Code_2TB/code/Worldwrought");
  assert.equal(requests[0].options.headers.authorization, "Bearer local-token");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "catalog.snapshot");
  assert.equal(sent[0].body.projects[0].sessions[0].sessionId, "019f5900-42ce-7e23-8680-855bdbfcddd3");
  assert.equal(sent[0].body.recentThreads[0].projectName, "Worldwrought");
});

test("trusted message.send envelope is dispatched through the local app server", async (t) => {
  const deviceKeys = generateP256KeyPair();
  const config = hostConfig({
    trustedDevicePublicKeys: {
      "ios-phone": deviceKeys.publicKey,
    },
  });
  const requests = [];
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      options,
    });
    return new Response(JSON.stringify({
      ok: true,
      requestId: "request-1",
      requestState: "running",
    }), {
      status: 202,
      headers: {
        "content-type": "application/json",
      },
    });
  };

  const envelope = signCloudEnvelope(normalizeCloudEnvelope({
    type: "message.send",
    accountId: "acct-1",
    workspaceId: "scratchpad",
    sourceDeviceId: "ios-phone",
    targetHostId: "mac-host",
    body: {
      project: "/Volumes/Code_2TB/code/clawdad",
      sessionId: "session-1",
      message: "hello from phone",
      dispatchMode: "direct",
      permissionMode: "approve",
      model: "gpt-5.6-sol",
      reasoningEffort: "ultra",
    },
  }), deviceKeys.privateKey, {
    keyId: cloudPublicKeyFingerprint(deviceKeys.publicKey),
  });
  const sent = [];

  const result = await handleCloudEnvelope(envelope, config, async (payload) => {
    sent.push(payload);
  });

  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "http://127.0.0.1:4477/v1/dispatch");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers.authorization, "Bearer local-token");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    project: "/Volumes/Code_2TB/code/clawdad",
    sessionId: "session-1",
    message: "hello from phone",
    dispatchMode: "direct",
    permissionMode: "approve",
    model: "gpt-5.6-sol",
    reasoningEffort: "ultra",
    wait: false,
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "message.accepted");
  assert.equal(verifyCloudEnvelopeSignature(sent[0], config.hostPublicKeyPem), true);
});

test("trusted message.send forwards signed iPhone images as local multipart attachments", async (t) => {
  const deviceKeys = generateP256KeyPair();
  const config = hostConfig({
    trustedDevicePublicKeys: {
      "ios-phone": deviceKeys.publicKey,
    },
  });
  const requests = [];
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({
      ok: true,
      requestId: "request-image",
      requestState: "running",
      attachments: [{ fileName: "phone-image.jpg", kind: "image" }],
    }), {
      status: 202,
      headers: { "content-type": "application/json" },
    });
  };
  const imageBytes = Buffer.from("signed-phone-image");
  const envelope = signCloudEnvelope(normalizeCloudEnvelope({
    type: "message.send",
    accountId: "acct-1",
    workspaceId: "scratchpad",
    sourceDeviceId: "ios-phone",
    targetHostId: "mac-host",
    body: {
      project: "/Volumes/Code_2TB/code/clawdad",
      sessionId: "session-1",
      message: "Review this image",
      dispatchMode: "direct",
      permissionMode: "approve",
      model: "gpt-5.6-sol",
      reasoningEffort: "ultra",
      attachments: [{
        fileName: "phone-image.jpg",
        mimeType: "image/jpeg",
        dataBase64: imageBytes.toString("base64"),
      }],
    },
  }), deviceKeys.privateKey, {
    keyId: cloudPublicKeyFingerprint(deviceKeys.publicKey),
  });
  const sent = [];

  const result = await handleCloudEnvelope(envelope, config, async (payload) => {
    sent.push(payload);
  });

  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "http://127.0.0.1:4477/v1/dispatch");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers.authorization, "Bearer local-token");
  assert.equal(requests[0].options.headers["content-type"], undefined);
  assert.ok(requests[0].options.body instanceof FormData);
  assert.equal(requests[0].options.body.get("project"), "/Volumes/Code_2TB/code/clawdad");
  assert.equal(requests[0].options.body.get("message"), "Review this image");
  const uploadedImage = requests[0].options.body.get("attachments");
  assert.equal(uploadedImage.name, "phone-image.jpg");
  assert.equal(uploadedImage.type, "image/jpeg");
  assert.deepEqual(Buffer.from(await uploadedImage.arrayBuffer()), imageBytes);
  assert.equal(sent[0].type, "message.accepted");
  assert.equal(sent[0].body.attachments[0].kind, "image");
});

test("trusted speech transcription forwards signed iPhone audio to local ClawDad STT", async (t) => {
  const deviceKeys = generateP256KeyPair();
  const config = hostConfig({
    trustedDevicePublicKeys: {
      "ios-phone": deviceKeys.publicKey,
    },
  });
  const requests = [];
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({
      ok: true,
      provider: "doc-reader",
      model: "base",
      text: "Append this below the existing draft.",
      language: "en",
      duration: 2.4,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const audioBytes = Buffer.from("signed-phone-audio");
  const envelope = signCloudEnvelope(normalizeCloudEnvelope({
    type: "speech.transcribe.request",
    accountId: "acct-1",
    workspaceId: "scratchpad",
    sourceDeviceId: "ios-phone",
    targetHostId: "mac-host",
    body: {
      requestId: "voice-1",
      project: "/Volumes/Code_2TB/code/clawdad",
      fileName: "clawdad-voice.m4a",
      mimeType: "audio/mp4",
      dataBase64: audioBytes.toString("base64"),
    },
  }), deviceKeys.privateKey, {
    keyId: cloudPublicKeyFingerprint(deviceKeys.publicKey),
  });
  const sent = [];

  const result = await handleCloudEnvelope(envelope, config, async (payload) => {
    sent.push(payload);
  });

  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "http://127.0.0.1:4477/v1/stt/transcribe");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers.authorization, "Bearer local-token");
  assert.equal(requests[0].options.headers["content-type"], undefined);
  assert.ok(requests[0].options.body instanceof FormData);
  assert.equal(requests[0].options.body.get("project"), "/Volumes/Code_2TB/code/clawdad");
  const uploadedAudio = requests[0].options.body.get("audio");
  assert.equal(uploadedAudio.name, "clawdad-voice.m4a");
  assert.equal(uploadedAudio.type, "audio/mp4");
  assert.deepEqual(Buffer.from(await uploadedAudio.arrayBuffer()), audioBytes);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].type, "speech.transcribe.accepted");
  assert.equal(sent[0].body.requestId, "voice-1");
  assert.equal(verifyCloudEnvelopeSignature(sent[0], config.hostPublicKeyPem), true);
  assert.equal(sent[1].type, "speech.transcription");
  assert.equal(sent[1].body.requestId, "voice-1");
  assert.equal(sent[1].body.text, "Append this below the existing draft.");
  assert.equal(sent[1].body.provider, "doc-reader");
  assert.equal(verifyCloudEnvelopeSignature(sent[1], config.hostPublicKeyPem), true);
});

test("trusted models.request returns the Mac Codex catalog", async (t) => {
  const deviceKeys = generateP256KeyPair();
  const config = hostConfig({ trustedDevicePublicKeys: { "ios-phone": deviceKeys.publicKey } });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => new Response(JSON.stringify({
    ok: true,
    configuredModel: "gpt-5.6-sol",
    configuredReasoningEffort: "ultra",
    models: [{ model: "gpt-5.6-sol", displayName: "GPT-5.6-Sol" }],
    requestedUrl: String(url),
  }), { status: 200, headers: { "content-type": "application/json" } });
  const envelope = signCloudEnvelope(normalizeCloudEnvelope({
    type: "models.request",
    accountId: "acct-1",
    workspaceId: "scratchpad",
    sourceDeviceId: "ios-phone",
    targetHostId: "mac-host",
    body: { project: "/Volumes/Code_2TB/code/clawdad" },
  }), deviceKeys.privateKey);
  const sent = [];

  const result = await handleCloudEnvelope(envelope, config, async (payload) => sent.push(payload));

  assert.equal(result.ok, true);
  assert.equal(sent[0].type, "models.snapshot");
  assert.equal(sent[0].body.configuredModel, "gpt-5.6-sol");
  assert.match(sent[0].body.requestedUrl, /\/v1\/models\?project=/u);
});

test("trusted session.create.request creates and selects a desktop session", async (t) => {
  const deviceKeys = generateP256KeyPair();
  const config = hostConfig({ trustedDevicePublicKeys: { "ios-phone": deviceKeys.publicKey } });
  const requests = [];
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({ ok: true, sessionId: "new-session", projectDetails: {} }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };
  const envelope = signCloudEnvelope(normalizeCloudEnvelope({
    type: "session.create.request",
    accountId: "acct-1",
    workspaceId: "scratchpad",
    sourceDeviceId: "ios-phone",
    targetHostId: "mac-host",
    body: {
      project: "/Volumes/Code_2TB/code/clawdad",
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningEffort: "ultra",
    },
  }), deviceKeys.privateKey);
  const sent = [];

  const result = await handleCloudEnvelope(envelope, config, async (payload) => sent.push(payload));

  assert.equal(result.ok, true);
  assert.equal(requests[0].url, "http://127.0.0.1:4477/v1/sessions");
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    project: "/Volumes/Code_2TB/code/clawdad",
    provider: "codex",
    title: "",
    model: "gpt-5.6-sol",
    reasoningEffort: "ultra",
  });
  assert.equal(sent[0].type, "session.created");
  assert.equal(sent[0].body.sessionId, "new-session");
});

test("cloud host reconnect delay backs off without exceeding thirty seconds", () => {
  assert.equal(cloudHostReconnectDelayMs(0), 1500);
  assert.equal(cloudHostReconnectDelayMs(1), 3000);
  assert.equal(cloudHostReconnectDelayMs(4), 24000);
  assert.equal(cloudHostReconnectDelayMs(10), 30000);
});

test("trusted status.request returns the selected project mailbox snapshot", async (t) => {
  const deviceKeys = generateP256KeyPair();
  const config = hostConfig({
    trustedDevicePublicKeys: {
      "ios-phone": deviceKeys.publicKey,
    },
  });
  const requests = [];
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify({
      ok: true,
      mailboxStatus: {
        state: "running",
        request_id: "request-live",
        heartbeat_at: "2026-07-10T04:00:00Z",
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const envelope = signCloudEnvelope(normalizeCloudEnvelope({
    type: "status.request",
    accountId: "acct-1",
    workspaceId: "scratchpad",
    sourceDeviceId: "ios-phone",
    targetHostId: "mac-host",
    body: {
      project: "/Volumes/Code_2TB/code/clawdad",
      sessionId: "session-1",
    },
  }), deviceKeys.privateKey, {
    keyId: cloudPublicKeyFingerprint(deviceKeys.publicKey),
  });
  const sent = [];

  const result = await handleCloudEnvelope(envelope, config, async (payload) => {
    sent.push(payload);
  });

  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  assert.match(requests[0], /\/v1\/status\?project=/u);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "status.snapshot");
  assert.equal(sent[0].body.mailboxStatus.state, "running");
});

test("trusted approval decision resolves locally and returns the refreshed status", async (t) => {
  const deviceKeys = generateP256KeyPair();
  const config = hostConfig({
    trustedDevicePublicKeys: {
      "ios-phone": deviceKeys.publicKey,
    },
  });
  const requests = [];
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/v1/approvals/decision")) {
      return new Response(JSON.stringify({
        ok: true,
        approvalId: "0123456789abcdef0123456789abcdef",
        decision: "approve",
        state: "decided",
      }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      ok: true,
      mailboxStatus: {
        state: "running",
        phase: null,
        pending_approval_count: 0,
      },
      pendingApprovals: [],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const envelope = signCloudEnvelope(normalizeCloudEnvelope({
    type: "approval.decision",
    accountId: "acct-1",
    workspaceId: "scratchpad",
    sourceDeviceId: "ios-phone",
    targetHostId: "mac-host",
    body: {
      project: "/Volumes/Code_2TB/code/clawdad",
      approvalId: "0123456789abcdef0123456789abcdef",
      decision: "approve",
    },
  }), deviceKeys.privateKey, {
    keyId: cloudPublicKeyFingerprint(deviceKeys.publicKey),
  });
  const sent = [];

  const result = await handleCloudEnvelope(envelope, config, async (payload) => {
    sent.push(payload);
  });

  assert.equal(result.ok, true);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "http://127.0.0.1:4477/v1/approvals/decision");
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    project: "/Volumes/Code_2TB/code/clawdad",
    approvalId: "0123456789abcdef0123456789abcdef",
    decision: "approve",
    reason: "",
    answers: null,
    content: null,
  });
  assert.match(requests[1].url, /\/v1\/status\?project=/u);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "status.snapshot");
  assert.equal(sent[0].body.pendingApprovals.length, 0);
  assert.equal(sent[0].body.approvalDecision.state, "decided");
  assert.equal(verifyCloudEnvelopeSignature(sent[0], config.hostPublicKeyPem), true);
});

test("untrusted state-changing phone envelope is rejected before local dispatch", async (t) => {
  const deviceKeys = generateP256KeyPair();
  const config = hostConfig();
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called");
  };
  const envelope = signCloudEnvelope(normalizeCloudEnvelope({
    type: "message.send",
    accountId: "acct-1",
    workspaceId: "scratchpad",
    sourceDeviceId: "ios-phone",
    targetHostId: "mac-host",
    body: {
      project: "/tmp/project",
      message: "hello",
    },
  }), deviceKeys.privateKey);
  const sent = [];

  const result = await handleCloudEnvelope(envelope, config, async (payload) => {
    sent.push(payload);
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "untrusted device");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "error");
  assert.equal(sent[0].body.code, "untrusted_device");
  assert.equal(verifyCloudEnvelopeSignature(sent[0], config.hostPublicKeyPem), true);
});

test("untrusted status reads are rejected before local project data is exposed", async (t) => {
  const deviceKeys = generateP256KeyPair();
  const config = hostConfig();
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called");
  };
  const envelope = signCloudEnvelope(normalizeCloudEnvelope({
    type: "status.request",
    accountId: "acct-1",
    workspaceId: "scratchpad",
    sourceDeviceId: "unknown-phone",
    targetHostId: "mac-host",
    body: {
      project: "/tmp/project",
    },
  }), deviceKeys.privateKey);
  const sent = [];

  const result = await handleCloudEnvelope(envelope, config, async (payload) => {
    sent.push(payload);
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "untrusted device");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "error");
  assert.equal(sent[0].body.code, "untrusted_device");
});
