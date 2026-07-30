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
const turnControlKey = "turn:control";
const turnUsageCachePrefix = "turn:usage:";
const bytesPerGigabyte = 1_000_000_000;
const defaultTurnCredentialTtlSeconds = 15 * 60;
const defaultTurnAnalyticsCacheSeconds = 5 * 60;
const defaultTurnIceServers = Object.freeze([
  Object.freeze({
    urls: Object.freeze(["stun:stun.cloudflare.com:3478"]),
  }),
]);

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

function envBoolean(env, name, fallback = false) {
  const value = String(env?.[name] ?? "").trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value);
}

function envNumber(env, name, fallback, {
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
} = {}) {
  const parsed = Number(env?.[name]);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, parsed));
}

function turnBudgetConfiguration(env) {
  const warningBytes = envNumber(
    env,
    "CLAWDAD_TURN_GLOBAL_WARNING_BYTES",
    75 * bytesPerGigabyte,
  );
  const urgentBytes = Math.max(
    warningBytes,
    envNumber(
      env,
      "CLAWDAD_TURN_GLOBAL_URGENT_BYTES",
      90 * bytesPerGigabyte,
    ),
  );
  const pauseBytes = Math.max(
    urgentBytes,
    envNumber(
      env,
      "CLAWDAD_TURN_GLOBAL_PAUSE_BYTES",
      95 * bytesPerGigabyte,
    ),
  );
  return {
    enabled: envBoolean(env, "CLAWDAD_TURN_ENABLED", false),
    killSwitch: envBoolean(env, "CLAWDAD_TURN_KILL_SWITCH", false),
    credentialTtlSeconds: Math.round(envNumber(
      env,
      "CLAWDAD_TURN_CREDENTIAL_TTL_SECONDS",
      defaultTurnCredentialTtlSeconds,
      { minimum: 300, maximum: 86_400 },
    )),
    analyticsCacheSeconds: Math.round(envNumber(
      env,
      "CLAWDAD_TURN_ANALYTICS_CACHE_SECONDS",
      defaultTurnAnalyticsCacheSeconds,
      { minimum: 30, maximum: 3_600 },
    )),
    perCustomerLimitBytes: Math.round(envNumber(
      env,
      "CLAWDAD_TURN_CUSTOMER_LIMIT_BYTES",
      20 * bytesPerGigabyte,
      { minimum: bytesPerGigabyte },
    )),
    warningBytes: Math.round(warningBytes),
    urgentBytes: Math.round(urgentBytes),
    pauseBytes: Math.round(pauseBytes),
  };
}

function turnDirectResponse(reason, configuration = {}) {
  return json(200, {
    iceServers: defaultTurnIceServers,
    expiresIn: 0,
    refreshAfter: 0,
    relayAvailable: false,
    relayReason: String(reason || "relay_disabled"),
    budgetLevel: String(configuration.budgetLevel || "unavailable"),
  });
}

function requireTurnAdminBearer(request, env) {
  const expected = String(env.CLAWDAD_TURN_ADMIN_TOKEN || "").trim();
  return Boolean(expected) && bearerToken(request) === expected;
}

function validTurnIdentifier(value) {
  return /^clawdad_[a-f0-9]{32}$/u.test(String(value || "").trim());
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function turnCustomerIdentifier(env, subject = {}) {
  const secret = String(env.CLAWDAD_TURN_IDENTIFIER_SECRET || "").trim();
  const accountId = String(subject.accountId || "").trim();
  if (secret.length < 32 || !validAccessIdentifier(accountId)) {
    return "";
  }
  const digest = await hmacHex(secret, `clawdad-turn-customer:v1:${accountId}`);
  return `clawdad_${digest.slice(0, 32)}`;
}

function utcMonthRange(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return {
    month: `${year}-${month}`,
    dateFrom: `${year}-${month}-01`,
    dateTo: `${year}-${month}-${day}`,
  };
}

function turnBudgetLevel(egressBytes, configuration) {
  if (egressBytes >= configuration.pauseBytes) {
    return "paused";
  }
  if (egressBytes >= configuration.urgentBytes) {
    return "urgent";
  }
  if (egressBytes >= configuration.warningBytes) {
    return "warning";
  }
  return "normal";
}

async function turnBudgetDecision(env, customIdentifier) {
  if (!env.TURN_BUDGET) {
    return {
      allowed: false,
      reason: "budget_service_unavailable",
      level: "unavailable",
    };
  }
  const objectId = env.TURN_BUDGET.idFromName("global");
  const response = await env.TURN_BUDGET.get(objectId).fetch(
    new Request("https://turn-budget.internal/authorize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customIdentifier }),
    }),
  );
  if (!response.ok) {
    return {
      allowed: false,
      reason: "budget_service_unavailable",
      level: "unavailable",
    };
  }
  return response.json();
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

export class TurnBudget {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    const analyticsFetch = (
      typeof env.CLAWDAD_TURN_ANALYTICS_FETCH === "function"
        ? env.CLAWDAD_TURN_ANALYTICS_FETCH
        : fetch
    );
    this.fetchImpl = (...args) => analyticsFetch(...args);
  }

  async control() {
    return (
      await this.state.storage.get(turnControlKey) ||
      {
        globalPaused: false,
        customers: {},
        updatedAt: "",
      }
    );
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/authorize") {
      return this.authorize(request);
    }
    if (!requireTurnAdminBearer(request, this.env)) {
      return json(401, { ok: false, error: "unauthorized" });
    }
    if (url.pathname === "/status") {
      return this.status(request);
    }
    if (url.pathname === "/control") {
      return this.updateControl(request);
    }
    return json(404, { ok: false, error: "not found" });
  }

  async authorize(request) {
    if (request.method !== "POST") {
      return json(405, { ok: false, error: "method not allowed" });
    }
    let payload;
    try {
      payload = await accessJson(request);
    } catch {
      return json(400, { ok: false, error: "invalid budget request" });
    }
    const customIdentifier = String(payload.customIdentifier || "").trim();
    if (!validTurnIdentifier(customIdentifier)) {
      return json(400, {
        ok: false,
        error: "valid customer identifier is required",
      });
    }

    const configuration = turnBudgetConfiguration(this.env);
    const control = await this.control();
    const customerControl = control.customers?.[customIdentifier] || {};
    if (!configuration.enabled) {
      return json(200, {
        allowed: false,
        reason: "relay_disabled",
        level: "disabled",
      });
    }
    if (configuration.killSwitch) {
      return json(200, {
        allowed: false,
        reason: "global_kill_switch",
        level: "paused",
      });
    }
    if (control.globalPaused) {
      return json(200, {
        allowed: false,
        reason: "admin_global_pause",
        level: "paused",
      });
    }
    if (customerControl.paused) {
      return json(200, {
        allowed: false,
        reason: "admin_customer_pause",
        level: "paused",
      });
    }

    let usage;
    try {
      usage = await this.usageSnapshot(customIdentifier);
    } catch {
      return json(200, {
        allowed: false,
        reason: "usage_unavailable",
        level: "unavailable",
      });
    }

    const customerLimitBytes = Number.isFinite(customerControl.limitBytes)
      ? customerControl.limitBytes
      : configuration.perCustomerLimitBytes;
    const level = turnBudgetLevel(usage.globalEgressBytes, configuration);
    if (usage.globalEgressBytes >= configuration.pauseBytes) {
      return json(200, {
        allowed: false,
        reason: "global_monthly_limit",
        level,
        ...usage,
        customerLimitBytes,
        globalPauseBytes: configuration.pauseBytes,
      });
    }
    if (usage.customerEgressBytes >= customerLimitBytes) {
      return json(200, {
        allowed: false,
        reason: "customer_monthly_limit",
        level,
        ...usage,
        customerLimitBytes,
        globalPauseBytes: configuration.pauseBytes,
      });
    }

    return json(200, {
      allowed: true,
      reason: "within_budget",
      level,
      ...usage,
      customerLimitBytes,
      globalPauseBytes: configuration.pauseBytes,
    });
  }

  async status(request) {
    if (request.method !== "GET") {
      return json(405, { ok: false, error: "method not allowed" });
    }
    const url = new URL(request.url);
    const customIdentifier = String(
      url.searchParams.get("customIdentifier") || "",
    ).trim();
    if (customIdentifier && !validTurnIdentifier(customIdentifier)) {
      return json(400, {
        ok: false,
        error: "customer identifier is invalid",
      });
    }
    if (url.searchParams.get("refresh") === "true") {
      await this.clearUsageCache(customIdentifier);
    }

    const configuration = turnBudgetConfiguration(this.env);
    const control = await this.control();
    let usage = null;
    let usageError = "";
    if (configuration.enabled) {
      try {
        usage = await this.usageSnapshot(customIdentifier);
      } catch (error) {
        usageError = String(
          error instanceof Error
            ? error.message
            : "TURN analytics are unavailable",
        ).slice(0, 240);
      }
    }
    const globalEgressBytes = usage?.globalEgressBytes || 0;
    return json(200, {
      ok: true,
      enabled: configuration.enabled,
      killSwitch: configuration.killSwitch,
      globalPaused: Boolean(control.globalPaused),
      level: (
        configuration.enabled
          ? turnBudgetLevel(globalEgressBytes, configuration)
          : "disabled"
      ),
      usage,
      usageError,
      thresholds: {
        perCustomerLimitBytes: configuration.perCustomerLimitBytes,
        warningBytes: configuration.warningBytes,
        urgentBytes: configuration.urgentBytes,
        pauseBytes: configuration.pauseBytes,
      },
      credentialTtlSeconds: configuration.credentialTtlSeconds,
      analyticsCacheSeconds: configuration.analyticsCacheSeconds,
      customerControl: (
        customIdentifier
          ? control.customers?.[customIdentifier] || null
          : null
      ),
      updatedAt: control.updatedAt || "",
    });
  }

  async updateControl(request) {
    if (request.method !== "PUT" && request.method !== "POST") {
      return json(405, { ok: false, error: "method not allowed" });
    }
    let payload;
    try {
      payload = await accessJson(request);
    } catch {
      return json(400, { ok: false, error: "invalid control request" });
    }
    const current = await this.control();
    const next = {
      ...current,
      customers: { ...(current.customers || {}) },
      updatedAt: new Date().toISOString(),
    };
    if (typeof payload.globalPaused === "boolean") {
      next.globalPaused = payload.globalPaused;
    }

    const customIdentifier = String(payload.customIdentifier || "").trim();
    if (customIdentifier) {
      if (!validTurnIdentifier(customIdentifier)) {
        return json(400, {
          ok: false,
          error: "customer identifier is invalid",
        });
      }
      const customer = {
        ...(next.customers[customIdentifier] || {}),
      };
      if (typeof payload.customerPaused === "boolean") {
        customer.paused = payload.customerPaused;
      }
      if (payload.customerLimitBytes === null) {
        delete customer.limitBytes;
      } else if (payload.customerLimitBytes !== undefined) {
        const limitBytes = Number(payload.customerLimitBytes);
        if (
          !Number.isFinite(limitBytes) ||
          limitBytes < bytesPerGigabyte
        ) {
          return json(400, {
            ok: false,
            error: "customer limit must be at least 1 GB",
          });
        }
        customer.limitBytes = Math.round(limitBytes);
      }
      if (payload.note !== undefined) {
        customer.note = String(payload.note || "").trim().slice(0, 200);
      }
      customer.updatedAt = next.updatedAt;
      if (
        !customer.paused &&
        !Number.isFinite(customer.limitBytes) &&
        !customer.note
      ) {
        delete next.customers[customIdentifier];
      } else {
        next.customers[customIdentifier] = customer;
      }
    }

    await this.state.storage.put(turnControlKey, next);
    if (payload.clearUsageCache === true) {
      await this.clearUsageCache(customIdentifier);
    }
    return json(200, {
      ok: true,
      globalPaused: Boolean(next.globalPaused),
      customerControl: (
        customIdentifier
          ? next.customers[customIdentifier] || null
          : null
      ),
      updatedAt: next.updatedAt,
    });
  }

  async clearUsageCache(customIdentifier = "") {
    const entries = await this.state.storage.list({
      prefix: turnUsageCachePrefix,
    });
    for (const key of entries.keys()) {
      if (!customIdentifier || key.endsWith(`:${customIdentifier}`)) {
        await this.state.storage.delete(key);
      }
    }
  }

  async usageSnapshot(customIdentifier = "") {
    const global = await this.cachedUsage("");
    const customer = customIdentifier
      ? await this.cachedUsage(customIdentifier)
      : null;
    return {
      month: global.month,
      globalEgressBytes: global.egressBytes,
      customerEgressBytes: customer?.egressBytes || 0,
      measuredAt: (
        customer?.measuredAt &&
        customer.measuredAt < global.measuredAt
          ? customer.measuredAt
          : global.measuredAt
      ),
    };
  }

  async cachedUsage(customIdentifier) {
    const configuration = turnBudgetConfiguration(this.env);
    const range = utcMonthRange();
    const suffix = customIdentifier || "global";
    const key = `${turnUsageCachePrefix}${range.month}:${suffix}`;
    const cached = await this.state.storage.get(key);
    const cacheAgeMs = Date.now() - Date.parse(cached?.measuredAt || "");
    if (
      cached &&
      Number.isFinite(cacheAgeMs) &&
      cacheAgeMs >= 0 &&
      cacheAgeMs < configuration.analyticsCacheSeconds * 1000
    ) {
      return cached;
    }

    const egressBytes = await this.queryEgressBytes(
      range,
      customIdentifier,
    );
    const next = {
      month: range.month,
      egressBytes,
      measuredAt: new Date().toISOString(),
    };
    await this.state.storage.put(key, next);
    return next;
  }

  async queryEgressBytes(range, customIdentifier) {
    const accountId = String(
      this.env.CLAWDAD_CLOUDFLARE_ACCOUNT_ID || "",
    ).trim();
    const analyticsToken = String(
      this.env.CLAWDAD_TURN_ANALYTICS_API_TOKEN || "",
    ).trim();
    const keyId = String(this.env.CLAWDAD_TURN_KEY_ID || "").trim();
    if (!accountId || !analyticsToken || !keyId) {
      throw new Error("TURN analytics are not configured");
    }

    const filter = [
      `date_geq: ${JSON.stringify(range.dateFrom)}`,
      `date_leq: ${JSON.stringify(range.dateTo)}`,
      `keyId: ${JSON.stringify(keyId)}`,
      ...(customIdentifier
        ? [`customIdentifier: ${JSON.stringify(customIdentifier)}`]
        : []),
    ].join(", ");
    const query = `query ClawDadTurnUsage {
      viewer {
        accounts(filter: { accountTag: ${JSON.stringify(accountId)} }) {
          callsTurnUsageAdaptiveGroups(
            limit: 1
            filter: { ${filter} }
            orderBy: []
          ) {
            sum {
              egressBytes
            }
          }
        }
      }
    }`;
    const response = await this.fetchImpl(
      "https://api.cloudflare.com/client/v4/graphql",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${analyticsToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query }),
      },
    );
    if (!response.ok) {
      throw new Error(`TURN analytics request failed (${response.status})`);
    }
    const payload = await response.json();
    if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
      const message = String(
        payload.errors[0]?.message || "unknown error",
      ).slice(0, 160);
      throw new Error(`TURN analytics returned an error: ${message}`);
    }
    const accounts = payload?.data?.viewer?.accounts;
    if (!Array.isArray(accounts) || accounts.length === 0) {
      throw new Error("TURN analytics returned no account");
    }
    const groups = accounts[0]?.callsTurnUsageAdaptiveGroups;
    if (!Array.isArray(groups)) {
      throw new Error("TURN analytics returned no usage groups");
    }
    return Math.max(
      0,
      Math.round(groups.reduce(
        (total, group) => total + Number(group?.sum?.egressBytes || 0),
        0,
      )),
    );
  }
}

export async function generateRemoteAssistIceServers(
  request,
  env,
  fetchImpl = fetch,
  {
    authorized = false,
    subject = null,
    budgetEvaluator = turnBudgetDecision,
  } = {},
) {
  if (request.method !== "POST") {
    return json(405, { ok: false, error: "method not allowed" });
  }
  if (!authorized && !requireRemoteAssistBearer(request, env)) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  const configuration = turnBudgetConfiguration(env);
  if (!configuration.enabled) {
    return turnDirectResponse("relay_disabled");
  }

  const turnKeyId = String(env.CLAWDAD_TURN_KEY_ID || "").trim();
  const turnKeyApiToken = String(env.CLAWDAD_TURN_KEY_API_TOKEN || "").trim();
  if (!turnKeyId || !turnKeyApiToken) {
    return turnDirectResponse("relay_not_configured");
  }

  const customIdentifier = await turnCustomerIdentifier(env, subject || {});
  if (!customIdentifier) {
    return turnDirectResponse("customer_attribution_unavailable");
  }
  let budget;
  try {
    budget = await budgetEvaluator(env, customIdentifier);
  } catch {
    return turnDirectResponse("budget_service_unavailable");
  }
  if (!budget?.allowed) {
    return turnDirectResponse(
      budget?.reason || "budget_service_unavailable",
      { budgetLevel: budget?.level || "unavailable" },
    );
  }

  const response = await fetchImpl(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(turnKeyId)}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${turnKeyApiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ttl: configuration.credentialTtlSeconds,
        customIdentifier,
      }),
    },
  );
  if (!response.ok) {
    return turnDirectResponse("credential_generation_failed", {
      budgetLevel: budget.level,
    });
  }
  const payload = await response.json();
  const iceServers = Array.isArray(payload?.iceServers)
    ? payload.iceServers
    : [];
  const hasRelayServer = iceServers.some((server) => {
    const urls = Array.isArray(server?.urls)
      ? server.urls
      : [server?.urls];
    return urls.some((url) => (
      typeof url === "string"
      && (url.startsWith("turn:") || url.startsWith("turns:"))
    ));
  });
  if (!hasRelayServer) {
    return turnDirectResponse("credential_generation_failed", {
      budgetLevel: budget.level,
    });
  }
  return json(200, {
    iceServers,
    expiresIn: configuration.credentialTtlSeconds,
    refreshAfter: Math.max(
      60,
      configuration.credentialTtlSeconds - 3 * 60,
    ),
    relayAvailable: true,
    relayReason: "",
    budgetLevel: budget.level || "normal",
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
    for (const socket of this.state.getWebSockets?.() || []) {
      const metadata = this.deserializeSocketMetadata(socket);
      if (metadata) {
        this.sessions.set(socket, metadata);
      }
    }
  }

  deserializeSocketMetadata(socket) {
    try {
      const metadata = socket.deserializeAttachment?.();
      if (
        metadata &&
        typeof metadata === "object" &&
        !Array.isArray(metadata)
      ) {
        return metadata;
      }
    } catch {
      // A malformed attachment is treated as an unauthenticated connection.
    }
    return null;
  }

  persistSocketMetadata(socket, metadata) {
    this.sessions.set(socket, metadata);
    socket.serializeAttachment?.(metadata);
  }

  activeSessions() {
    const sockets = this.state.getWebSockets?.();
    if (!Array.isArray(sockets)) {
      return this.sessions;
    }

    const active = new Map();
    for (const socket of sockets) {
      const metadata = (
        this.sessions.get(socket) ||
        this.deserializeSocketMetadata(socket)
      );
      if (metadata) {
        active.set(socket, metadata);
      }
    }
    this.sessions = active;
    return active;
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

      for (const [socket, metadata] of this.activeSessions()) {
        if (
          metadata.role === "device" &&
          metadata.deviceId === deviceId &&
          metadata.credentialHash === pairingTokenHash
        ) {
          metadata.credentialKind = "device";
          metadata.credentialHash = relayAccessTokenHash;
          this.persistSocketMetadata(socket, metadata);
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
    for (const [socket, metadata] of this.activeSessions()) {
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
      const hostAccess = await this.hostAccess();
      if (!await this.requestHasHostAccess(request, hostAccess)) {
        return json(401, { ok: false, error: "host authorization required" });
      }
      let payload;
      try {
        payload = await accessJson(request.clone());
      } catch {
        return json(400, {
          ok: false,
          error: "invalid Remote Assist credential request",
        });
      }
      const targetDeviceId = String(payload.targetDeviceId || "").trim();
      const targetDevice = targetDeviceId
        ? await this.state.storage.get(
            `${accessDevicePrefix}${targetDeviceId}`,
          )
        : null;
      if (
        !targetDevice ||
        targetDevice.revokedAt ||
        !targetDevice.tokenHash
      ) {
        return json(403, {
          ok: false,
          error: "trusted target device is required",
        });
      }
      return generateRemoteAssistIceServers(
        request,
        this.env,
        (
          typeof this.env.CLAWDAD_TURN_CREDENTIAL_FETCH === "function"
            ? this.env.CLAWDAD_TURN_CREDENTIAL_FETCH
            : fetch
        ),
        {
          authorized: true,
          subject: {
            accountId: hostAccess.accountId,
            workspaceId: route.workspaceId,
            deviceId: targetDeviceId,
          },
        },
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
    this.state.acceptWebSocket(server);
    this.persistSocketMetadata(server, metadata);

    const availableHostIds = [...this.activeSessions().values()]
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

  webSocketMessage(socket, message) {
    const metadata = (
      this.sessions.get(socket) ||
      this.deserializeSocketMetadata(socket)
    );
    if (!metadata) {
      try {
        socket.close(4003, "relay session metadata missing");
      } catch {
        // The runtime will clean up a socket that is already closed.
      }
      return;
    }
    this.persistSocketMetadata(socket, metadata);
    this.forward(socket, message, metadata);
  }

  webSocketClose(socket, code, reason) {
    this.sessions.delete(socket);
    try {
      socket.close(code, reason);
    } catch {
      // The runtime may already have completed the close handshake.
    }
  }

  webSocketError(socket) {
    this.sessions.delete(socket);
    try {
      socket.close(1011, "relay websocket error");
    } catch {
      // The runtime may already have discarded the failed socket.
    }
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
    this.persistSocketMetadata(sourceSocket, sourceMetadata);
    if (payload.type === "ping") {
      const availableHostIds = [...this.activeSessions().values()]
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
    for (const [socket, metadata] of this.activeSessions()) {
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
    if (
      url.pathname === "/admin/turn/status" ||
      url.pathname === "/admin/turn/control"
    ) {
      if (!env.TURN_BUDGET) {
        return json(503, {
          ok: false,
          error: "TURN_BUDGET binding is not configured",
        });
      }
      if (!requireTurnAdminBearer(request, env)) {
        return json(401, { ok: false, error: "unauthorized" });
      }
      const objectId = env.TURN_BUDGET.idFromName("global");
      const targetPath = (
        url.pathname === "/admin/turn/status"
          ? "/status"
          : "/control"
      );
      const target = new URL(request.url);
      target.pathname = targetPath;
      const body = request.method === "GET"
        ? undefined
        : await request.clone().arrayBuffer();
      return env.TURN_BUDGET.get(objectId).fetch(
        new Request(target, {
          method: request.method,
          headers: request.headers,
          body,
        }),
      );
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
