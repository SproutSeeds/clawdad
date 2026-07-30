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

const publicPageStyles = `
  :root {
    color-scheme: dark;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #180505;
    color: #fff4d8;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background: #180505;
    border-top: 6px solid #e23c2b;
  }
  main {
    width: min(760px, calc(100% - 40px));
    margin: 0 auto;
    padding: 56px 0 80px;
  }
  header { margin-bottom: 42px; }
  h1, h2 { margin: 0; line-height: 1.05; letter-spacing: 0; }
  h1 { font-size: clamp(2.5rem, 8vw, 5rem); }
  h2 { margin-top: 36px; font-size: 1.3rem; color: #ffcb39; }
  p, li { font-size: 1rem; line-height: 1.68; }
  p { margin: 14px 0 0; }
  ul, ol { padding-left: 22px; }
  a { color: #78e08f; text-underline-offset: 3px; }
  nav { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 24px; }
  .eyebrow {
    margin: 0 0 12px;
    color: #ffcb39;
    font-size: .78rem;
    font-weight: 800;
    text-transform: uppercase;
  }
  .lede { max-width: 620px; font-size: 1.2rem; color: #f2c5ae; }
  .note {
    margin-top: 28px;
    padding-left: 16px;
    border-left: 3px solid #4cc96b;
  }
  footer { margin-top: 56px; color: #c99883; font-size: .88rem; }
`;

function publicPage({ title, eyebrow, lede, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>${title}</title>
  <style>${publicPageStyles}</style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">${eyebrow}</p>
      <h1>ClawDad</h1>
      <p class="lede">${lede}</p>
      <nav aria-label="ClawDad information">
        <a href="/">Overview</a>
        <a href="/support">Support</a>
        <a href="/privacy">Privacy</a>
      </nav>
    </header>
    ${body}
    <footer>ClawDad by FRG · Updated July 30, 2026</footer>
  </main>
</body>
</html>`;
}

const publicPages = Object.freeze({
  "/": publicPage({
    title: "ClawDad",
    eyebrow: "iPhone + Mac",
    lede: "Keep your Codex projects moving from iPhone while your paired Mac remains the execution authority.",
    body: `
      <h2>Built for real threads</h2>
      <p>Choose a project and Codex thread, send Direct or Queue messages, attach images, dictate prompts, listen to responses, and return to the same work from your terminal.</p>
      <h2>Remote Assist when you need the screen</h2>
      <p>Opt-in Remote Assist gives you a full-screen view and control of your paired Mac for the moments that need a human click, approval, or terminal interaction.</p>
      <p class="note">ClawDad requires the ClawDad Mac app, Codex installed and signed in on that Mac, and separate OpenAI access.</p>
    `,
  }),
  "/support": publicPage({
    title: "ClawDad Support",
    eyebrow: "Support",
    lede: "Setup, pairing, connection recovery, subscriptions, and Remote Assist.",
    body: `
      <h2>Pair your iPhone</h2>
      <ol>
        <li>Open ClawDad on your Mac and wait for the service to become ready.</li>
        <li>Open Settings, choose Pair iPhone, and leave the one-time QR code visible.</li>
        <li>Open ClawDad on iPhone, scan the QR code, and allow the project catalog to load.</li>
      </ol>
      <h2>Connection help</h2>
      <ul>
        <li>Confirm the Mac is awake, online, and running ClawDad.</li>
        <li>Open iPhone Settings inside ClawDad to view connection and subscription status.</li>
        <li>For a fresh trust exchange, use Forget Pairing on iPhone, revoke the old device on Mac, and scan a new QR code.</li>
      </ul>
      <h2>Remote Assist</h2>
      <p>Enable Remote Assist on the Mac, then grant Screen &amp; System Audio Recording and Accessibility in macOS Privacy &amp; Security. Remote Assist remains off until you turn it on.</p>
      <h2>Purchases</h2>
      <p>Subscriptions are billed through Apple. Use Restore Purchases in ClawDad Settings after reinstalling or changing devices.</p>
      <h2>Get help or request deletion</h2>
      <p>Email <a href="mailto:cody@frg.earth?subject=ClawDad%20Support">cody@frg.earth</a> or open a <a href="https://github.com/SproutSeeds/clawdad/issues">ClawDad support issue</a>. Include the app version and privacy-safe diagnostics from Mac Settings. For deletion, include the paired device name and workspace identifier shown in Settings; never send a pairing token, private key, or password.</p>
    `,
  }),
  "/privacy": publicPage({
    title: "ClawDad Privacy",
    eyebrow: "Privacy Policy",
    lede: "ClawDad is local-first: your Mac holds your projects, Codex sessions, and execution authority.",
    body: `
      <h2>Information ClawDad processes</h2>
      <ul>
        <li>Account, workspace, host, and device identifiers used to connect your paired devices.</li>
        <li>Device trust, pairing, revocation, and recent connection metadata needed to secure the relay.</li>
        <li>Messages, attachments, voice input, and Remote Assist signaling while carrying your request between iPhone and Mac.</li>
        <li>Apple-signed subscription transaction proof used to confirm access. ClawDad stores the derived product and entitlement status, not the signed transaction or payment-card details.</li>
      </ul>
      <h2>Where your content lives</h2>
      <p>Project files, Codex thread history, terminal output, and ClawDad logs remain on your Mac. The ClawDad relay forwards message and Remote Assist signaling in real time and does not durably store message bodies, attachments, code, terminal output, voice recordings, or screen content.</p>
      <h2>Remote Assist</h2>
      <p>Remote Assist is opt-in. Screen and control media uses an encrypted WebRTC connection. Connection signaling passes through the ClawDad relay. When relay fallback is available and needed by a restrictive network, encrypted media may transit Cloudflare's relay service.</p>
      <h2>Service providers</h2>
      <p>Cloudflare provides the network relay and may process ordinary network metadata such as IP address and request timing. Apple processes App Store purchases. Codex runs on your Mac under your separate OpenAI account and terms.</p>
      <h2>Tracking and advertising</h2>
      <p>ClawDad does not sell personal information, show advertising, or use cross-app tracking. It does not include third-party advertising or behavioral analytics SDKs.</p>
      <h2>Retention and control</h2>
      <p>Trust and device records remain until revoked or deleted. Forget Pairing removes the credential from iPhone; revoking the device on Mac disables its relay access. Local project data follows the retention and deletion choices you make on your Mac. Contact support to request deletion of relay account or workspace records.</p>
      <h2>Security and diagnostics</h2>
      <p>Pairing uses a short-lived one-time ticket. Each paired device receives its own revocable credential. Sensitive credentials are stored in the iPhone Keychain or Mac application support. Diagnostics stay local unless you explicitly copy or share them.</p>
      <h2>Contact</h2>
      <p>Privacy questions and deletion requests can be sent to <a href="mailto:cody@frg.earth?subject=ClawDad%20Privacy">cody@frg.earth</a>.</p>
    `,
  }),
});

export function publicClawDadPage(pathname) {
  const source = publicPages[pathname];
  if (!source) {
    return null;
  }
  return new Response(source, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300, stale-while-revalidate=3600",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    },
  });
}

function requireRemoteAssistBearer(request, env) {
  const expected = String(env.CLAWDAD_REMOTE_ASSIST_TOKEN || "").trim();
  if (!expected) {
    return false;
  }
  const header = request.headers.get("authorization") || "";
  return header === `Bearer ${expected}`;
}

function requireReleaseBearer(request, env) {
  const expected = String(env.CLAWDAD_RELEASE_TOKEN || "").trim();
  if (!expected) {
    return false;
  }
  const header = request.headers.get("authorization") || "";
  return header === `Bearer ${expected}`;
}

const maxAppcastBytes = 1024 * 1024;
const maxAccessRequestBytes = 16 * 1024;
const maxPairingTicketLifetimeMs = 10 * 60 * 1000;
const minimumRelayTokenLength = 32;
const accessHostKey = "access:host";
const accessDevicePrefix = "access:device:";
const accessPairingPrefix = "access:pairing:";

function bearerToken(request) {
  const header = String(request.headers.get("authorization") || "").trim();
  if (header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  return "";
}

function websocketProtocolCredential(request) {
  const protocols = String(request.headers.get("sec-websocket-protocol") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const protocol = protocols.find((value) => value.startsWith("clawdad.auth."));
  return protocol
    ? {
        protocol,
        token: protocol.slice("clawdad.auth.".length),
      }
    : {
        protocol: "",
        token: "",
      };
}

function relayCredential(request) {
  const bearer = bearerToken(request);
  if (bearer) {
    return {
      protocol: "",
      token: bearer,
    };
  }
  return websocketProtocolCredential(request);
}

async function tokenHash(token) {
  const value = String(token || "").trim();
  if (value.length < minimumRelayTokenLength) {
    return "";
  }
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomRelayToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validAccessIdentifier(value) {
  return /^[A-Za-z0-9._:-]{1,160}$/u.test(String(value || "").trim());
}

function opaqueAccessIdentifier(value) {
  const normalized = String(value || "").trim();
  return validAccessIdentifier(normalized) && normalized.length >= 20;
}

function relayAccessEnforced(env) {
  return String(env.CLAWDAD_RELAY_ACCESS_ENFORCED ?? "true")
    .trim()
    .toLowerCase() !== "false";
}

async function accessJson(request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > maxAccessRequestBytes) {
    throw new Error("access request exceeds the 16 KB limit");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxAccessRequestBytes) {
    throw new Error("access request exceeds the 16 KB limit");
  }
  if (!text.trim()) {
    return {};
  }
  const payload = JSON.parse(text);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("access request must be a JSON object");
  }
  return payload;
}

export function validateSparkleAppcast(xml) {
  const value = String(xml || "").trim();
  if (!value) {
    return "appcast XML is required";
  }
  if (new TextEncoder().encode(value).byteLength > maxAppcastBytes) {
    return "appcast XML exceeds the 1 MB limit";
  }
  const requirements = [
    [/<rss\b[^>]*>/iu, "appcast must contain an RSS document"],
    [/<channel\b[^>]*>/iu, "appcast must contain a channel"],
    [/<item\b[^>]*>/iu, "appcast must contain at least one release item"],
    [
      /(?:\bsparkle:version\s*=\s*["'][^"']+["']|<sparkle:version>\s*[^<]+\s*<\/sparkle:version>)/iu,
      "release item must include sparkle:version",
    ],
    [/\bsparkle:edSignature\s*=\s*["'][^"']+["']/iu, "release enclosure must include a Sparkle EdDSA signature"],
    [/\benclosure\b[^>]*\burl\s*=\s*["']https:\/\/[^"']+["']/iu, "release enclosure must use an HTTPS download URL"],
  ];
  for (const [pattern, message] of requirements) {
    if (!pattern.test(value)) {
      return message;
    }
  }
  return "";
}

function appcastResponse(xml, updatedAt) {
  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=300, stale-while-revalidate=3600",
      "last-modified": new Date(updatedAt).toUTCString(),
      "x-content-type-options": "nosniff",
    },
  });
}

export class ReleaseCatalog {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    if (request.method === "GET") {
      const release = await this.state.storage.get("mac-appcast");
      if (!release?.xml || !release?.updatedAt) {
        return json(404, {
          ok: false,
          error: "No ClawDad Mac release has been published yet",
        });
      }
      return appcastResponse(release.xml, release.updatedAt);
    }

    if (request.method !== "PUT") {
      return json(405, { ok: false, error: "method not allowed" });
    }
    if (!requireReleaseBearer(request, this.env)) {
      return json(401, { ok: false, error: "unauthorized" });
    }

    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > maxAppcastBytes) {
      return json(413, { ok: false, error: "appcast XML exceeds the 1 MB limit" });
    }
    const xml = await request.text();
    const validationError = validateSparkleAppcast(xml);
    if (validationError) {
      return json(400, { ok: false, error: validationError });
    }

    const updatedAt = new Date().toISOString();
    await this.state.storage.put("mac-appcast", {
      xml: xml.trim(),
      updatedAt,
    });
    return json(200, {
      ok: true,
      updatedAt,
      bytes: new TextEncoder().encode(xml).byteLength,
    });
  }
}

export async function generateRemoteAssistIceServers(
  request,
  env,
  fetchImpl = fetch,
  { authorized = false } = {},
) {
  if (request.method !== "POST") {
    return json(405, { ok: false, error: "method not allowed" });
  }
  if (!authorized && !requireRemoteAssistBearer(request, env)) {
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

function workspaceRoute(pathname) {
  const match = pathname.match(/^\/workspaces\/([^/]+)(\/.*)?$/u);
  return match
    ? {
        workspaceId: decodeURIComponent(match[1]),
        action: match[2] || "",
      }
    : null;
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

function accessDeviceId(action) {
  const match = action.match(/^\/access\/devices\/([^/]+)\/?$/u);
  return match ? decodeURIComponent(match[1]) : "";
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

  async hostAccess() {
    return this.state.storage.get(accessHostKey);
  }

  async requestHasHostAccess(request, hostAccess = null) {
    const access = hostAccess || await this.hostAccess();
    if (!access?.tokenHash) {
      return false;
    }
    return await tokenHash(bearerToken(request)) === access.tokenHash;
  }

  async claimWorkspace(request, route) {
    if (request.method !== "POST") {
      return json(405, { ok: false, error: "method not allowed" });
    }

    try {
      const payload = await accessJson(request);
      const url = new URL(request.url);
      const accountId = String(
        payload.accountId || url.searchParams.get("accountId") || "",
      ).trim();
      const hostId = String(payload.hostId || "").trim();
      const hostKeyId = String(payload.hostKeyId || "").trim();
      const credential = bearerToken(request);
      const credentialHash = await tokenHash(credential);
      if (
        !validAccessIdentifier(accountId) ||
        !validAccessIdentifier(route.workspaceId) ||
        !validAccessIdentifier(hostId) ||
        !credentialHash
      ) {
        return json(400, {
          ok: false,
          error: "accountId, workspaceId, hostId, and a strong host token are required",
        });
      }

      const existing = await this.hostAccess();
      if (existing) {
        if (
          existing.accountId !== accountId ||
          existing.workspaceId !== route.workspaceId ||
          existing.hostId !== hostId ||
          existing.tokenHash !== credentialHash
        ) {
          return json(403, { ok: false, error: "workspace is already claimed" });
        }
        return json(200, {
          ok: true,
          claimed: true,
          createdAt: existing.createdAt,
        });
      }

      const legacyIdentifiers = (
        !opaqueAccessIdentifier(accountId) ||
        !opaqueAccessIdentifier(route.workspaceId)
      );
      if (legacyIdentifiers) {
        const expectedBootstrap = String(
          this.env.CLAWDAD_LEGACY_BOOTSTRAP_TOKEN || "",
        ).trim();
        const suppliedBootstrap = String(
          request.headers.get("x-clawdad-bootstrap") || "",
        ).trim();
        if (!expectedBootstrap || suppliedBootstrap !== expectedBootstrap) {
          return json(403, {
            ok: false,
            error: "legacy workspace claim requires an authorized migration",
          });
        }
      }

      const createdAt = new Date().toISOString();
      await this.state.storage.put(accessHostKey, {
        accountId,
        workspaceId: route.workspaceId,
        hostId,
        hostKeyId,
        tokenHash: credentialHash,
        createdAt,
        updatedAt: createdAt,
      });
      return json(201, {
        ok: true,
        claimed: true,
        createdAt,
      });
    } catch (error) {
      return json(400, {
        ok: false,
        error: error?.message || "invalid workspace claim",
      });
    }
  }

  async createPairingTicket(request, route) {
    if (request.method !== "POST") {
      return json(405, { ok: false, error: "method not allowed" });
    }
    const hostAccess = await this.hostAccess();
    if (!await this.requestHasHostAccess(request, hostAccess)) {
      return json(401, { ok: false, error: "host authorization required" });
    }

    try {
      const payload = await accessJson(request);
      const pairingToken = String(payload.pairingToken || "").trim();
      const pairingTokenHash = await tokenHash(pairingToken);
      const expiresAtMs = Date.parse(String(payload.expiresAt || ""));
      const now = Date.now();
      if (
        !pairingTokenHash ||
        !Number.isFinite(expiresAtMs) ||
        expiresAtMs <= now ||
        expiresAtMs > now + maxPairingTicketLifetimeMs
      ) {
        return json(400, {
          ok: false,
          error: "a strong pairing token with a lifetime of ten minutes or less is required",
        });
      }

      const createdAt = new Date(now).toISOString();
      await this.state.storage.put(
        `${accessPairingPrefix}${pairingTokenHash}`,
        {
          tokenHash: pairingTokenHash,
          accountId: hostAccess.accountId,
          workspaceId: route.workspaceId,
          hostId: hostAccess.hostId,
          createdAt,
          expiresAt: new Date(expiresAtMs).toISOString(),
        },
      );
      return json(201, {
        ok: true,
        createdAt,
        expiresAt: new Date(expiresAtMs).toISOString(),
      });
    } catch (error) {
      return json(400, {
        ok: false,
        error: error?.message || "invalid pairing ticket",
      });
    }
  }

  async activateDevice(request, route, deviceId) {
    if (request.method !== "PUT") {
      return json(405, { ok: false, error: "method not allowed" });
    }
    const hostAccess = await this.hostAccess();
    if (!await this.requestHasHostAccess(request, hostAccess)) {
      return json(401, { ok: false, error: "host authorization required" });
    }
    if (!validAccessIdentifier(deviceId)) {
      return json(400, { ok: false, error: "valid device id is required" });
    }

    try {
      const payload = await accessJson(request);
      const pairingTokenHash = await tokenHash(payload.pairingToken);
      const pairingKey = `${accessPairingPrefix}${pairingTokenHash}`;
      const ticket = pairingTokenHash
        ? await this.state.storage.get(pairingKey)
        : null;
      if (
        !ticket ||
        ticket.accountId !== hostAccess.accountId ||
        ticket.workspaceId !== route.workspaceId ||
        ticket.hostId !== hostAccess.hostId ||
        Date.parse(ticket.expiresAt) <= Date.now()
      ) {
        return json(403, {
          ok: false,
          error: "pairing ticket is expired or does not match this workspace",
        });
      }

      const relayAccessToken = randomRelayToken();
      const relayAccessTokenHash = await tokenHash(relayAccessToken);
      const trustedAt = new Date().toISOString();
      const record = {
        deviceId,
        deviceName: String(payload.deviceName || "").trim().slice(0, 160),
        platform: String(payload.platform || "").trim().slice(0, 40),
        keyId: String(payload.keyId || "").trim().slice(0, 160),
        tokenHash: relayAccessTokenHash,
        trustedAt,
        lastSeenAt: "",
        revokedAt: "",
      };
      await this.state.storage.put(`${accessDevicePrefix}${deviceId}`, record);
      await this.state.storage.delete(pairingKey);

      for (const metadata of this.sessions.values()) {
        if (
          metadata.role === "device" &&
          metadata.deviceId === deviceId &&
          metadata.credentialHash === pairingTokenHash
        ) {
          metadata.credentialKind = "device";
          metadata.credentialHash = relayAccessTokenHash;
        }
      }

      return json(200, {
        ok: true,
        device: {
          deviceId: record.deviceId,
          deviceName: record.deviceName,
          platform: record.platform,
          keyId: record.keyId,
          trustedAt: record.trustedAt,
        },
        relayAccessToken,
      });
    } catch (error) {
      return json(400, {
        ok: false,
        error: error?.message || "invalid device activation",
      });
    }
  }

  async listDevices(request) {
    if (request.method !== "GET") {
      return json(405, { ok: false, error: "method not allowed" });
    }
    if (!await this.requestHasHostAccess(request)) {
      return json(401, { ok: false, error: "host authorization required" });
    }
    const records = await this.state.storage.list({
      prefix: accessDevicePrefix,
    });
    const devices = [...records.values()]
      .map((record) => ({
        deviceId: record.deviceId,
        deviceName: record.deviceName || "",
        platform: record.platform || "",
        keyId: record.keyId || "",
        trustedAt: record.trustedAt || "",
        lastSeenAt: record.lastSeenAt || "",
        revokedAt: record.revokedAt || "",
      }))
      .sort((left, right) => (
        String(right.lastSeenAt || right.trustedAt)
          .localeCompare(String(left.lastSeenAt || left.trustedAt))
      ));
    return json(200, {
      ok: true,
      devices,
    });
  }

  async revokeDevice(request, deviceId) {
    if (request.method !== "DELETE") {
      return json(405, { ok: false, error: "method not allowed" });
    }
    if (!await this.requestHasHostAccess(request)) {
      return json(401, { ok: false, error: "host authorization required" });
    }
    const key = `${accessDevicePrefix}${deviceId}`;
    const existing = await this.state.storage.get(key);
    if (!existing) {
      return json(404, { ok: false, error: "device not found" });
    }
    const revokedAt = new Date().toISOString();
    await this.state.storage.put(key, {
      ...existing,
      tokenHash: "",
      revokedAt,
    });
    for (const [socket, metadata] of this.sessions.entries()) {
      if (metadata.role === "device" && metadata.deviceId === deviceId) {
        try {
          socket.close(4003, "device access revoked");
        } catch {
          // The session map is still cleaned below.
        }
        this.sessions.delete(socket);
      }
    }
    return json(200, {
      ok: true,
      deviceId,
      revokedAt,
    });
  }

  async authorizeRealtime(request, metadata) {
    const hostAccess = await this.hostAccess();
    if (!hostAccess) {
      if (!relayAccessEnforced(this.env)) {
        const credential = relayCredential(request);
        return {
          ok: true,
          credential,
          credentialHash: await tokenHash(credential.token),
          credentialKind: "legacy",
        };
      }
      return {
        ok: false,
        status: 428,
        error: "workspace access is not initialized",
      };
    }
    if (
      metadata.accountId !== hostAccess.accountId ||
      metadata.workspaceId !== hostAccess.workspaceId
    ) {
      return {
        ok: false,
        status: 403,
        error: "workspace identity does not match",
      };
    }

    const credential = relayCredential(request);
    const credentialHash = await tokenHash(credential.token);
    if (!credentialHash) {
      if (!relayAccessEnforced(this.env)) {
        return {
          ok: true,
          credential,
          credentialHash: "",
          credentialKind: "legacy",
        };
      }
      return {
        ok: false,
        status: 401,
        error: "relay authorization required",
      };
    }

    if (metadata.role === "host") {
      if (
        metadata.hostId !== hostAccess.hostId ||
        credentialHash !== hostAccess.tokenHash
      ) {
        if (!relayAccessEnforced(this.env) && metadata.hostId === hostAccess.hostId) {
          return {
            ok: true,
            credential,
            credentialHash,
            credentialKind: "legacy",
          };
        }
        return {
          ok: false,
          status: 403,
          error: "host authorization failed",
        };
      }
      return {
        ok: true,
        credential,
        credentialHash,
        credentialKind: "host",
      };
    }

    if (!validAccessIdentifier(metadata.deviceId)) {
      return {
        ok: false,
        status: 400,
        error: "valid deviceId is required",
      };
    }
    const device = await this.state.storage.get(
      `${accessDevicePrefix}${metadata.deviceId}`,
    );
    if (
      device?.tokenHash &&
      !device.revokedAt &&
      device.tokenHash === credentialHash
    ) {
      await this.state.storage.put(`${accessDevicePrefix}${metadata.deviceId}`, {
        ...device,
        lastSeenAt: new Date().toISOString(),
      });
      return {
        ok: true,
        credential,
        credentialHash,
        credentialKind: "device",
      };
    }

    const ticket = await this.state.storage.get(
      `${accessPairingPrefix}${credentialHash}`,
    );
    if (
      ticket &&
      ticket.accountId === hostAccess.accountId &&
      ticket.workspaceId === hostAccess.workspaceId &&
      ticket.hostId === hostAccess.hostId &&
      Date.parse(ticket.expiresAt) > Date.now()
    ) {
      return {
        ok: true,
        credential,
        credentialHash,
        credentialKind: "pairing",
      };
    }
    if (ticket) {
      await this.state.storage.delete(
        `${accessPairingPrefix}${credentialHash}`,
      );
    }
    if (!relayAccessEnforced(this.env)) {
      return {
        ok: true,
        credential,
        credentialHash,
        credentialKind: "legacy",
      };
    }
    return {
      ok: false,
      status: 403,
      error: "device authorization failed",
    };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const route = workspaceRoute(url.pathname);
    if (!route) {
      return json(404, { ok: false, error: "not found" });
    }
    if (route.action === "/access/claim") {
      return this.claimWorkspace(request, route);
    }
    if (route.action === "/access/pairing-tickets") {
      return this.createPairingTicket(request, route);
    }
    if (route.action === "/access/devices") {
      return this.listDevices(request);
    }
    if (route.action === "/remote-assist/ice-servers") {
      if (!await this.requestHasHostAccess(request)) {
        return json(401, { ok: false, error: "host authorization required" });
      }
      return generateRemoteAssistIceServers(
        request,
        this.env,
        fetch,
        { authorized: true },
      );
    }
    const deviceId = accessDeviceId(route.action);
    if (deviceId) {
      if (request.method === "PUT") {
        return this.activateDevice(request, route, deviceId);
      }
      return this.revokeDevice(request, deviceId);
    }
    if (route.action !== "/realtime" && route.action !== "/realtime/") {
      return json(404, { ok: false, error: "not found" });
    }
    if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
      return json(426, { ok: false, error: "websocket upgrade required" });
    }

    const metadata = connectionMetadata(request, route.workspaceId);
    const authorization = await this.authorizeRealtime(request, metadata);
    if (!authorization.ok) {
      return json(authorization.status, {
        ok: false,
        error: authorization.error,
      });
    }
    metadata.credentialHash = authorization.credentialHash;
    metadata.credentialKind = authorization.credentialKind;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
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

    const responseHeaders = {};
    if (authorization.credential.protocol) {
      responseHeaders["sec-websocket-protocol"] =
        authorization.credential.protocol;
    }
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: responseHeaders,
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

    const expectedSourceId = String(
      sourceMetadata.hostId || sourceMetadata.deviceId || "",
    ).trim();
    if (
      String(payload.accountId || "").trim() !== sourceMetadata.accountId ||
      String(payload.workspaceId || "").trim() !== sourceMetadata.workspaceId ||
      String(payload.sourceDeviceId || "").trim() !== expectedSourceId
    ) {
      sourceSocket.send(JSON.stringify({
        protocolVersion,
        type: "error",
        accountId: sourceMetadata.accountId,
        workspaceId: sourceMetadata.workspaceId,
        sourceDeviceId: "cloud-relay",
        targetHostId: expectedSourceId,
        body: {
          error: "envelope identity does not match the authenticated connection",
          code: "identity_mismatch",
        },
      }));
      return 0;
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
    const publicPageResponse = publicClawDadPage(url.pathname);
    if (publicPageResponse) {
      return publicPageResponse;
    }
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
    if (url.pathname === "/mac/appcast.xml" || url.pathname === "/admin/mac/appcast") {
      if (!env.RELEASE_CATALOG) {
        return json(503, {
          ok: false,
          error: "RELEASE_CATALOG binding is not configured",
        });
      }
      if (url.pathname === "/admin/mac/appcast" && !requireReleaseBearer(request, env)) {
        return json(401, { ok: false, error: "unauthorized" });
      }
      const objectId = env.RELEASE_CATALOG.idFromName("mac");
      return env.RELEASE_CATALOG.get(objectId).fetch(request);
    }

    const route = workspaceRoute(url.pathname);
    if (!route) {
      return json(404, { ok: false, error: "not found" });
    }
    if (!env.WORKSPACE_RELAY) {
      return json(500, { ok: false, error: "WORKSPACE_RELAY binding is not configured" });
    }

    const accountId = String(url.searchParams.get("accountId") || "").trim();
    if (!validAccessIdentifier(accountId) || !validAccessIdentifier(route.workspaceId)) {
      return json(400, {
        ok: false,
        error: "valid accountId and workspaceId are required",
      });
    }
    const objectId = env.WORKSPACE_RELAY.idFromName(`${accountId}:${route.workspaceId}`);
    return env.WORKSPACE_RELAY.get(objectId).fetch(request);
  },
};
