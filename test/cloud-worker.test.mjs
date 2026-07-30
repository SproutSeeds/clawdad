import assert from "node:assert/strict";
import test from "node:test";
import {
  ReleaseCatalog,
  WorkspaceRelay,
  cloudRelayTargetMatches,
  generateRemoteAssistIceServers,
  publicClawDadPage,
  validateSparkleAppcast,
} from "../cloud/worker.mjs";

const validAppcast = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>ClawDad Updates</title>
    <item>
      <title>ClawDad 0.7.0</title>
      <sparkle:version>16</sparkle:version>
      <enclosure
        url="https://github.com/SproutSeeds/clawdad/releases/download/v0.7.0-beta.1/ClawDad-0.7.0-beta.1-mac.zip"
        sparkle:shortVersionString="0.7.0"
        sparkle:edSignature="signed-release"
        length="1024"
        type="application/octet-stream"
      />
    </item>
  </channel>
</rss>`;

function memoryDurableObjectState() {
  const values = new Map();
  return {
    storage: {
      async get(key) {
        return values.get(key);
      },
      async put(key, value) {
        values.set(key, value);
      },
      async delete(key) {
        values.delete(key);
      },
      async list({ prefix = "" } = {}) {
        return new Map(
          [...values.entries()].filter(([key]) => key.startsWith(prefix)),
        );
      },
    },
  };
}

function relayAccessRequest(pathname, {
  method = "GET",
  token = "",
  body,
  headers = {},
} = {}) {
  return new Request(
    `https://clawdad.example${pathname}?accountId=acct_12345678901234567890`,
    {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
}

test("public ClawDad pages expose support and privacy without app data", async () => {
  const overview = publicClawDadPage("/");
  const support = publicClawDadPage("/support");
  const privacy = publicClawDadPage("/privacy");

  assert.equal(overview.status, 200);
  assert.equal(support.status, 200);
  assert.equal(privacy.status, 200);
  assert.match(overview.headers.get("content-security-policy"), /default-src 'none'/u);
  assert.match(await overview.text(), /paired Mac remains the execution authority/u);
  assert.match(await support.text(), /Forget Pairing/u);
  assert.match(await privacy.text(), /does not durably store message bodies/u);
  assert.equal(publicClawDadPage("/missing"), null);
});

test("workspace relay claims an opaque workspace and protects host controls", async () => {
  const relay = new WorkspaceRelay(memoryDurableObjectState(), {});
  const hostToken = "host-token-with-at-least-thirty-two-characters";
  const claim = await relay.fetch(relayAccessRequest(
    "/workspaces/ws_12345678901234567890/access/claim",
    {
      method: "POST",
      token: hostToken,
      body: {
        accountId: "acct_12345678901234567890",
        hostId: "mac-host",
        hostKeyId: "host-key",
      },
    },
  ));
  assert.equal(claim.status, 201);
  assert.equal((await claim.json()).claimed, true);

  const unauthorized = await relay.fetch(relayAccessRequest(
    "/workspaces/ws_12345678901234567890/access/devices",
  ));
  assert.equal(unauthorized.status, 401);

  const repeated = await relay.fetch(relayAccessRequest(
    "/workspaces/ws_12345678901234567890/access/claim",
    {
      method: "POST",
      token: hostToken,
      body: {
        accountId: "acct_12345678901234567890",
        hostId: "mac-host",
        hostKeyId: "host-key",
      },
    },
  ));
  assert.equal(repeated.status, 200);
});

test("legacy workspace claim requires a private migration credential", async () => {
  const relay = new WorkspaceRelay(
    memoryDurableObjectState(),
    { CLAWDAD_LEGACY_BOOTSTRAP_TOKEN: "migration-secret" },
  );
  const base = {
    method: "POST",
    token: "host-token-with-at-least-thirty-two-characters",
    body: {
      accountId: "local-account",
      hostId: "cody-mac",
    },
  };
  const denied = await relay.fetch(relayAccessRequest(
    "/workspaces/scratchpad/access/claim",
    base,
  ));
  assert.equal(denied.status, 403);

  const claimed = await relay.fetch(relayAccessRequest(
    "/workspaces/scratchpad/access/claim",
    {
      ...base,
      headers: {
        "x-clawdad-bootstrap": "migration-secret",
      },
    },
  ));
  assert.equal(claimed.status, 201);
});

test("pairing ticket mints one device token and revocation disables it", async () => {
  const relay = new WorkspaceRelay(memoryDurableObjectState(), {});
  const hostToken = "host-token-with-at-least-thirty-two-characters";
  const workspace = "/workspaces/ws_12345678901234567890";
  await relay.fetch(relayAccessRequest(`${workspace}/access/claim`, {
    method: "POST",
    token: hostToken,
    body: {
      accountId: "acct_12345678901234567890",
      hostId: "mac-host",
    },
  }));

  const pairingToken = "pairing-token-with-at-least-thirty-two-chars";
  const ticket = await relay.fetch(relayAccessRequest(
    `${workspace}/access/pairing-tickets`,
    {
      method: "POST",
      token: hostToken,
      body: {
        pairingToken,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      },
    },
  ));
  assert.equal(ticket.status, 201);

  const activated = await relay.fetch(relayAccessRequest(
    `${workspace}/access/devices/ios-phone`,
    {
      method: "PUT",
      token: hostToken,
      body: {
        pairingToken,
        deviceName: "CodyVerse",
        platform: "ios",
        keyId: "phone-key",
      },
    },
  ));
  assert.equal(activated.status, 200);
  const activation = await activated.json();
  assert.equal(activation.device.deviceId, "ios-phone");
  assert.ok(activation.relayAccessToken.length >= 32);

  const reused = await relay.fetch(relayAccessRequest(
    `${workspace}/access/devices/second-phone`,
    {
      method: "PUT",
      token: hostToken,
      body: {
        pairingToken,
      },
    },
  ));
  assert.equal(reused.status, 403);

  const listed = await relay.fetch(relayAccessRequest(
    `${workspace}/access/devices`,
    { token: hostToken },
  ));
  assert.deepEqual(
    (await listed.json()).devices.map((device) => device.deviceId),
    ["ios-phone"],
  );

  const revoked = await relay.fetch(relayAccessRequest(
    `${workspace}/access/devices/ios-phone`,
    {
      method: "DELETE",
      token: hostToken,
    },
  ));
  assert.equal(revoked.status, 200);

  const metadata = {
    accountId: "acct_12345678901234567890",
    workspaceId: "ws_12345678901234567890",
    hostId: "",
    deviceId: "ios-phone",
    role: "device",
  };
  const denied = await relay.authorizeRealtime(
    relayAccessRequest(`${workspace}/realtime`, {
      token: activation.relayAccessToken,
    }),
    metadata,
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);
});

test("cloud relay routes targeted envelopes only to the named host or device", () => {
  const host = { hostId: "cody-mac", deviceId: "" };
  const phone = { hostId: "", deviceId: "cody-phone" };
  const otherPhone = { hostId: "", deviceId: "other-phone" };

  assert.equal(cloudRelayTargetMatches(host, "cody-mac"), true);
  assert.equal(cloudRelayTargetMatches(phone, "cody-phone"), true);
  assert.equal(cloudRelayTargetMatches(otherPhone, "cody-phone"), false);
  assert.equal(cloudRelayTargetMatches(phone, "cody-mac"), false);
  assert.equal(cloudRelayTargetMatches(phone, ""), true);
});

test("cloud relay immediately tells an iPhone when its paired Mac is offline", () => {
  const relay = new WorkspaceRelay({}, {});
  const sourceMessages = [];
  const phoneSocket = {
    send(message) {
      sourceMessages.push(JSON.parse(message));
    },
  };
  const phoneMetadata = {
    accountId: "acct-1",
    workspaceId: "scratchpad",
    hostId: "",
    deviceId: "cody-phone",
    role: "device",
  };
  relay.sessions.set(phoneSocket, phoneMetadata);

  const forwardedCount = relay.forward(phoneSocket, JSON.stringify({
    id: "voice-envelope-1",
    protocolVersion: "clawdad.cloud.v1",
    type: "speech.transcribe.request",
    accountId: "acct-1",
    workspaceId: "scratchpad",
    sourceDeviceId: "cody-phone",
    targetHostId: "cody-mac",
    body: {
      requestId: "voice-request-1",
    },
  }), phoneMetadata);

  assert.equal(forwardedCount, 0);
  assert.equal(sourceMessages.length, 1);
  assert.equal(sourceMessages[0].type, "error");
  assert.equal(sourceMessages[0].targetHostId, "cody-phone");
  assert.equal(sourceMessages[0].body.inReplyTo, "voice-envelope-1");
  assert.equal(sourceMessages[0].body.code, "host_unavailable");
  assert.match(sourceMessages[0].body.error, /Mac is offline/u);
});

test("cloud relay forwards iPhone speech when the paired Mac is online", () => {
  const relay = new WorkspaceRelay({}, {});
  const sourceMessages = [];
  const hostMessages = [];
  const phoneSocket = {
    send(message) {
      sourceMessages.push(JSON.parse(message));
    },
  };
  const hostSocket = {
    send(message) {
      hostMessages.push(JSON.parse(message));
    },
  };
  const phoneMetadata = {
    accountId: "acct-1",
    workspaceId: "scratchpad",
    hostId: "",
    deviceId: "cody-phone",
    role: "device",
  };
  relay.sessions.set(phoneSocket, phoneMetadata);
  relay.sessions.set(hostSocket, {
    accountId: "acct-1",
    workspaceId: "scratchpad",
    hostId: "cody-mac",
    deviceId: "",
    role: "host",
  });

  const forwardedCount = relay.forward(phoneSocket, JSON.stringify({
    id: "voice-envelope-2",
    protocolVersion: "clawdad.cloud.v1",
    type: "speech.transcribe.request",
    accountId: "acct-1",
    workspaceId: "scratchpad",
    sourceDeviceId: "cody-phone",
    targetHostId: "cody-mac",
    body: {
      requestId: "voice-request-2",
    },
  }), phoneMetadata);

  assert.equal(forwardedCount, 1);
  assert.deepEqual(sourceMessages, []);
  assert.equal(hostMessages.length, 1);
  assert.equal(hostMessages[0].id, "voice-envelope-2");
  assert.equal(hostMessages[0].relay.sourceRole, "device");
});

test("cloud relay heartbeat pong reports whether the paired Mac is online", () => {
  const relay = new WorkspaceRelay({}, {});
  const phoneMessages = [];
  const phoneSocket = {
    send(message) {
      phoneMessages.push(JSON.parse(message));
    },
  };
  const hostSocket = { send() {} };
  const phoneMetadata = {
    accountId: "acct-1",
    workspaceId: "scratchpad",
    hostId: "",
    deviceId: "cody-phone",
    role: "device",
  };
  relay.sessions.set(phoneSocket, phoneMetadata);
  relay.sessions.set(hostSocket, {
    accountId: "acct-1",
    workspaceId: "scratchpad",
    hostId: "cody-mac",
    deviceId: "",
    role: "host",
  });

  relay.forward(phoneSocket, JSON.stringify({
    id: "phone-ping-1",
    protocolVersion: "clawdad.cloud.v1",
    type: "ping",
    accountId: "acct-1",
    workspaceId: "scratchpad",
    sourceDeviceId: "cody-phone",
    targetHostId: "cody-mac",
    body: {},
  }), phoneMetadata);

  const pong = phoneMessages.find((message) => message.type === "pong");
  assert.ok(pong);
  assert.equal(pong.sourceDeviceId, "cloud-relay");
  assert.equal(pong.body.inReplyTo, "phone-ping-1");
  assert.deepEqual(pong.body.availableHostIds, ["cody-mac"]);
});

test("Remote Assist ICE credentials require the private host bearer", async () => {
  const response = await generateRemoteAssistIceServers(
    new Request("https://clawdad.example/remote-assist/ice-servers", {
      method: "POST",
    }),
    {
      CLAWDAD_REMOTE_ASSIST_TOKEN: "host-secret",
      CLAWDAD_TURN_KEY_ID: "turn-key",
      CLAWDAD_TURN_KEY_API_TOKEN: "turn-secret",
    },
    async () => {
      throw new Error("TURN must not be called for an unauthorized request");
    },
  );

  assert.equal(response.status, 401);
});

test("Remote Assist returns short-lived Cloudflare ICE servers", async () => {
  let upstreamRequest = null;
  const response = await generateRemoteAssistIceServers(
    new Request("https://clawdad.example/remote-assist/ice-servers", {
      method: "POST",
      headers: {
        authorization: "Bearer host-secret",
      },
    }),
    {
      CLAWDAD_REMOTE_ASSIST_TOKEN: "host-secret",
      CLAWDAD_TURN_KEY_ID: "turn-key",
      CLAWDAD_TURN_KEY_API_TOKEN: "turn-secret",
    },
    async (url, options) => {
      upstreamRequest = { url, options };
      return new Response(JSON.stringify({
        iceServers: [
          { urls: ["stun:stun.cloudflare.com:3478"] },
          {
            urls: ["turns:turn.cloudflare.com:443?transport=tcp"],
            username: "temporary-user",
            credential: "temporary-credential",
          },
        ],
      }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  );

  assert.equal(response.status, 200);
  assert.match(upstreamRequest.url, /\/turn\/keys\/turn-key\/credentials\/generate-ice-servers$/u);
  assert.equal(
    upstreamRequest.options.headers.authorization,
    "Bearer turn-secret",
  );
  assert.deepEqual(JSON.parse(upstreamRequest.options.body), { ttl: 3600 });
  const payload = await response.json();
  assert.equal(payload.expiresIn, 3600);
  assert.equal(payload.iceServers.length, 2);
});

test("workspace host credential authorizes Remote Assist ICE without a shared app token", async (t) => {
  const relay = new WorkspaceRelay(memoryDurableObjectState(), {
    CLAWDAD_TURN_KEY_ID: "turn-key",
    CLAWDAD_TURN_KEY_API_TOKEN: "turn-secret",
  });
  const hostToken = "host-token-with-at-least-thirty-two-characters";
  const workspace = "/workspaces/ws_12345678901234567890";
  await relay.fetch(relayAccessRequest(`${workspace}/access/claim`, {
    method: "POST",
    token: hostToken,
    body: {
      accountId: "acct_12345678901234567890",
      hostId: "mac-host",
    },
  }));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response(JSON.stringify({
    iceServers: [{
      urls: ["turns:turn.cloudflare.com:443?transport=tcp"],
      username: "temporary-user",
      credential: "temporary-credential",
    }],
  }), {
    status: 201,
    headers: { "content-type": "application/json" },
  });

  const response = await relay.fetch(relayAccessRequest(
    `${workspace}/remote-assist/ice-servers`,
    {
      method: "POST",
      token: hostToken,
      body: {},
    },
  ));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).iceServers.length, 1);
});

test("Mac update catalog rejects malformed or unsigned Sparkle feeds", () => {
  assert.match(
    validateSparkleAppcast("<rss><channel><item></item></channel></rss>"),
    /sparkle:version/u,
  );
  assert.match(
    validateSparkleAppcast(validAppcast.replace('sparkle:edSignature="signed-release"', "")),
    /EdDSA signature/u,
  );
  assert.equal(validateSparkleAppcast(validAppcast), "");
});

test("Mac update catalog requires release authorization and publishes a public feed", async () => {
  const catalog = new ReleaseCatalog(
    memoryDurableObjectState(),
    { CLAWDAD_RELEASE_TOKEN: "release-secret" },
  );

  const missing = await catalog.fetch(
    new Request("https://clawdad.example/mac/appcast.xml"),
  );
  assert.equal(missing.status, 404);

  const unauthorized = await catalog.fetch(
    new Request("https://clawdad.example/admin/mac/appcast", {
      method: "PUT",
      body: validAppcast,
    }),
  );
  assert.equal(unauthorized.status, 401);

  const published = await catalog.fetch(
    new Request("https://clawdad.example/admin/mac/appcast", {
      method: "PUT",
      headers: {
        authorization: "Bearer release-secret",
        "content-type": "application/rss+xml",
      },
      body: validAppcast,
    }),
  );
  assert.equal(published.status, 200);
  assert.equal((await published.json()).ok, true);

  const publicFeed = await catalog.fetch(
    new Request("https://clawdad.example/mac/appcast.xml"),
  );
  assert.equal(publicFeed.status, 200);
  assert.equal(
    publicFeed.headers.get("content-type"),
    "application/rss+xml; charset=utf-8",
  );
  assert.match(publicFeed.headers.get("cache-control"), /stale-while-revalidate/u);
  assert.equal(await publicFeed.text(), validAppcast);
});
