const protocolVersion = "clawdad.cloud.v1";

function json(status, payload) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function requireBearer(request, env) {
  const expected = String(env.CLAWDAD_CLOUD_DEV_TOKEN || "").trim();
  if (!expected) {
    return true;
  }
  const header = request.headers.get("authorization") || "";
  return header === `Bearer ${expected}`;
}

function requireRemoteAssistBearer(request, env) {
  const expected = String(env.CLAWDAD_REMOTE_ASSIST_TOKEN || "").trim();
  if (!expected) {
    return false;
  }
  const header = request.headers.get("authorization") || "";
  return header === `Bearer ${expected}`;
}

export async function generateRemoteAssistIceServers(
  request,
  env,
  fetchImpl = fetch,
) {
  if (request.method !== "POST") {
    return json(405, { ok: false, error: "method not allowed" });
  }
  if (!requireRemoteAssistBearer(request, env)) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  const turnKeyId = String(env.CLAWDAD_TURN_KEY_ID || "").trim();
  const turnKeyApiToken = String(env.CLAWDAD_TURN_KEY_API_TOKEN || "").trim();
  if (!turnKeyId || !turnKeyApiToken) {
    return json(503, {
      ok: false,
      error: "Remote Assist relay fallback is not configured",
    });
  }

  const response = await fetchImpl(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(turnKeyId)}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${turnKeyApiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ttl: 3600 }),
    },
  );
  if (!response.ok) {
    return json(502, {
      ok: false,
      error: "Could not create Remote Assist relay credentials",
    });
  }
  const payload = await response.json();
  const iceServers = Array.isArray(payload?.iceServers)
    ? payload.iceServers
    : [];
  if (iceServers.length === 0) {
    return json(502, {
      ok: false,
      error: "Remote Assist relay returned no ICE servers",
    });
  }
  return json(200, {
    iceServers,
    expiresIn: 3600,
  });
}

function routeMatch(pathname) {
  const match = pathname.match(/^\/workspaces\/([^/]+)\/realtime\/?$/u);
  return match ? { workspaceId: decodeURIComponent(match[1]) } : null;
}

function connectionMetadata(request, workspaceId) {
  const url = new URL(request.url);
  const hostId = String(url.searchParams.get("hostId") || "").trim();
  const deviceId = String(url.searchParams.get("deviceId") || "").trim();
  const accountId = String(url.searchParams.get("accountId") || "").trim();
  return {
    accountId,
    workspaceId,
    hostId,
    deviceId,
    role: hostId ? "host" : "device",
    connectedAt: new Date().toISOString(),
  };
}

export function cloudRelayTargetMatches(metadata = {}, targetId = "") {
  const target = String(targetId || "").trim();
  if (!target) {
    return true;
  }
  const recipientId = String(metadata.hostId || metadata.deviceId || "").trim();
  return recipientId === target;
}

export function cloudRelayUnavailableEnvelope(payload = {}, sourceMetadata = {}) {
  const createdAt = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    protocolVersion,
    type: "error",
    accountId: String(payload.accountId || sourceMetadata.accountId || "").trim(),
    workspaceId: String(payload.workspaceId || sourceMetadata.workspaceId || "").trim(),
    sourceDeviceId: "cloud-relay",
    targetHostId: String(sourceMetadata.deviceId || sourceMetadata.hostId || "").trim(),
    seq: 0,
    createdAt,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    body: {
      inReplyTo: String(payload.id || "").trim(),
      error: "Your ClawDad Mac is offline. Reopen ClawDad on the Mac, then try again.",
      code: "host_unavailable",
    },
  };
}

export class WorkspaceRelay {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
  }

  async fetch(request) {
    if (!requireBearer(request, this.env)) {
      return json(401, { ok: false, error: "unauthorized" });
    }

    if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
      return json(426, { ok: false, error: "websocket upgrade required" });
    }

    const url = new URL(request.url);
    const route = routeMatch(url.pathname);
    if (!route) {
      return json(404, { ok: false, error: "not found" });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const metadata = connectionMetadata(request, route.workspaceId);
    server.accept();
    this.sessions.set(server, metadata);

    server.addEventListener("message", (event) => {
      this.forward(server, event.data, metadata);
    });
    server.addEventListener("close", () => {
      this.sessions.delete(server);
    });
    server.addEventListener("error", () => {
      this.sessions.delete(server);
    });

    const availableHostIds = [...this.sessions.values()]
      .filter((session) => session.role === "host" && session.hostId)
      .map((session) => session.hostId);
    server.send(JSON.stringify({
      id: crypto.randomUUID(),
      protocolVersion,
      type: "pong",
      accountId: metadata.accountId,
      workspaceId: metadata.workspaceId,
      sourceDeviceId: "cloud-relay",
      targetHostId: metadata.hostId || metadata.deviceId,
      seq: 0,
      createdAt: metadata.connectedAt,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      body: {
        role: metadata.role,
        connectedAt: metadata.connectedAt,
        availableHostIds,
      },
    }));

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  forward(sourceSocket, rawData, sourceMetadata) {
    let payload;
    try {
      payload = typeof rawData === "string" ? JSON.parse(rawData) : {};
    } catch {
      sourceSocket.send(JSON.stringify({
        protocolVersion,
        type: "error",
        body: {
          error: "invalid JSON envelope",
          code: "invalid_json",
        },
      }));
      return;
    }

    const targetHostId = String(payload.targetHostId || "").trim();
    sourceMetadata.lastSeenAt = new Date().toISOString();
    if (payload.type === "ping") {
      const availableHostIds = [...this.sessions.values()]
        .filter((session) => (
          session.workspaceId === sourceMetadata.workspaceId &&
          session.role === "host" &&
          session.hostId
        ))
        .map((session) => session.hostId);
      sourceSocket.send(JSON.stringify({
        id: crypto.randomUUID(),
        protocolVersion,
        type: "pong",
        accountId: sourceMetadata.accountId,
        workspaceId: sourceMetadata.workspaceId,
        sourceDeviceId: "cloud-relay",
        targetHostId: sourceMetadata.hostId || sourceMetadata.deviceId,
        seq: 0,
        createdAt: sourceMetadata.lastSeenAt,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        body: {
          inReplyTo: String(payload.id || "").trim(),
          relayAt: sourceMetadata.lastSeenAt,
          availableHostIds,
        },
      }));
    }
    const forwarded = JSON.stringify({
      ...payload,
      relay: {
        workspaceId: sourceMetadata.workspaceId,
        sourceRole: sourceMetadata.role,
        forwardedAt: new Date().toISOString(),
      },
    });

    let forwardedCount = 0;
    for (const [socket, metadata] of this.sessions.entries()) {
      if (socket === sourceSocket || metadata.workspaceId !== sourceMetadata.workspaceId) {
        continue;
      }
      if (!cloudRelayTargetMatches(metadata, targetHostId)) {
        continue;
      }
      try {
        socket.send(forwarded);
        forwardedCount += 1;
      } catch {
        this.sessions.delete(socket);
      }
    }

    if (
      sourceMetadata.role === "device" &&
      targetHostId &&
      forwardedCount === 0
    ) {
      sourceSocket.send(JSON.stringify(cloudRelayUnavailableEnvelope(payload, sourceMetadata)));
    }

    return forwardedCount;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      return json(200, {
        ok: true,
        service: "clawdad-cloud",
        protocolVersion,
      });
    }
    if (url.pathname === "/remote-assist/ice-servers") {
      return generateRemoteAssistIceServers(request, env);
    }

    const route = routeMatch(url.pathname);
    if (!route) {
      return json(404, { ok: false, error: "not found" });
    }
    if (!env.WORKSPACE_RELAY) {
      return json(500, { ok: false, error: "WORKSPACE_RELAY binding is not configured" });
    }

    const accountId = String(url.searchParams.get("accountId") || "dev").trim();
    const objectId = env.WORKSPACE_RELAY.idFromName(`${accountId}:${route.workspaceId}`);
    return env.WORKSPACE_RELAY.get(objectId).fetch(request);
  },
};
