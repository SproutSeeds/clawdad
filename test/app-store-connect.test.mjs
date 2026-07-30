import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  verify as verifyBytes,
} from "node:crypto";
import test from "node:test";
import {
  appReleaseCatalog,
  appReleasePlan,
  buildPriceCreateRequest,
  buildSubscriptionCreateRequest,
  buildTrialCreateRequest,
  configureAppRelease,
  createAppStoreConnectToken,
  paidBetaCatalog,
  paidBetaPlan,
  uploadSubscriptionReviewScreenshot,
} from "../lib/app-store-connect.mjs";

test("App Store Connect JWT uses ES256 claims and a verifiable P1363 signature", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const token = createAppStoreConnectToken({
    keyId: "TESTKEY123",
    issuerId: "issuer-for-test",
    privateKey,
    nowSeconds: 1_000,
    lifetimeSeconds: 600,
  });
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  const header = JSON.parse(Buffer.from(headerPart, "base64url"));
  const payload = JSON.parse(Buffer.from(payloadPart, "base64url"));

  assert.deepEqual(header, {
    alg: "ES256",
    kid: "TESTKEY123",
    typ: "JWT",
  });
  assert.deepEqual(payload, {
    iss: "issuer-for-test",
    iat: 1_000,
    exp: 1_600,
    aud: "appstoreconnect-v1",
  });
  assert.equal(
    verifyBytes(
      "sha256",
      Buffer.from(`${headerPart}.${payloadPart}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signaturePart, "base64url"),
    ),
    true,
  );
});

test("paid beta catalog is a US monthly and annual launch with two-week trials", () => {
  assert.deepEqual(paidBetaPlan(), {
    appId: "6783090068",
    expectedBundleId: "earth.frg.clawdad.ios",
    subscriptionGroup: "ClawDad Pro",
    territories: ["USA"],
    products: [
      {
        productId: "earth.frg.clawdad.pro.monthly",
        period: "ONE_MONTH",
        customerPrice: "9.99",
        introductoryOffer: {
          duration: "TWO_WEEKS",
          offerMode: "FREE_TRIAL",
          numberOfPeriods: 1,
        },
      },
      {
        productId: "earth.frg.clawdad.pro.annual",
        period: "ONE_YEAR",
        customerPrice: "99.00",
        introductoryOffer: {
          duration: "TWO_WEEKS",
          offerMode: "FREE_TRIAL",
          numberOfPeriods: 1,
        },
      },
    ],
  });
});

test("subscription, price, and trial payloads match Apple resource relationships", () => {
  const product = paidBetaCatalog.products[0];
  const subscription = buildSubscriptionCreateRequest(product, "group-id");
  assert.equal(subscription.data.type, "subscriptions");
  assert.equal(subscription.data.attributes.productId, product.productId);
  assert.deepEqual(subscription.data.relationships.group.data, {
    type: "subscriptionGroups",
    id: "group-id",
  });

  const price = buildPriceCreateRequest(
    "subscription-id",
    "price-point-id",
  );
  assert.equal(price.data.attributes.startDate, null);
  assert.equal(
    price.data.relationships.subscriptionPricePoint.data.id,
    "price-point-id",
  );

  const trial = buildTrialCreateRequest("subscription-id", "USA");
  assert.deepEqual(trial.data.attributes, {
    duration: "TWO_WEEKS",
    offerMode: "FREE_TRIAL",
    numberOfPeriods: 1,
  });
  assert.deepEqual(trial.data.relationships.territory.data, {
    type: "territories",
    id: "USA",
  });
});

test("app release plan pins the ClawDad app, paid-beta build, and public URLs", () => {
  assert.deepEqual(appReleasePlan(), {
    appId: "6783090068",
    expectedBundleId: "earth.frg.clawdad.ios",
    locale: "en-US",
    appName: "ClawDad Mobile",
    subtitle: "Codex threads from anywhere",
    versionString: "1.0",
    betaGroup: "ClawDad Internal",
    betaBuild: "19",
    privacyPolicyUrl: "https://clawdad-cloud.frg.earth/privacy",
    supportUrl: "https://clawdad-cloud.frg.earth/support",
  });
});

class FakeReleaseClient {
  constructor() {
    this.calls = [];
    this.resources = {
      app: {
        type: "apps",
        id: appReleaseCatalog.appId,
        attributes: {
          name: "ClawDad Companion",
          bundleId: appReleaseCatalog.expectedBundleId,
        },
      },
      appInfo: {
        type: "appInfos",
        id: "app-info",
        attributes: { appStoreState: "PREPARE_FOR_SUBMISSION" },
      },
      appInfoLocalization: {
        type: "appInfoLocalizations",
        id: "app-info-localization",
        attributes: {
          locale: "en-US",
          name: "ClawDad Companion",
          subtitle: "",
          privacyPolicyUrl: "",
          privacyChoicesUrl: "",
        },
      },
      version: {
        type: "appStoreVersions",
        id: "version",
        attributes: {
          platform: "IOS",
          versionString: "1.0",
          appStoreState: "PREPARE_FOR_SUBMISSION",
        },
      },
      versionLocalization: {
        type: "appStoreVersionLocalizations",
        id: "version-localization",
        attributes: {
          locale: "en-US",
          description: "",
          keywords: "",
          marketingUrl: "",
          promotionalText: "",
          supportUrl: "",
        },
      },
      build: {
        type: "builds",
        id: "build-19",
        attributes: {
          version: "19",
          processingState: "VALID",
          usesNonExemptEncryption: null,
        },
      },
      betaAppLocalizations: [],
      betaBuildLocalizations: [],
      betaGroup: {
        type: "betaGroups",
        id: "internal-group",
        attributes: {
          name: "ClawDad Internal",
          isInternalGroup: true,
        },
      },
      groupBuilds: [],
    };
  }

  async list(path) {
    this.calls.push({ method: "GET", path });
    if (path.includes("/appInfos?")) return [this.resources.appInfo];
    if (path.includes("/appInfoLocalizations?")) {
      return [this.resources.appInfoLocalization];
    }
    if (path.includes("/appStoreVersions?")) return [this.resources.version];
    if (path.includes("/appStoreVersionLocalizations?")) {
      return [this.resources.versionLocalization];
    }
    if (path.startsWith("/v1/builds?")) return [this.resources.build];
    if (path.includes("/betaBuildLocalizations?")) {
      return this.resources.betaBuildLocalizations;
    }
    if (path.includes("/betaAppLocalizations?")) {
      return this.resources.betaAppLocalizations;
    }
    if (path.startsWith("/v1/betaGroups?")) return [this.resources.betaGroup];
    if (path.includes("/relationships/builds?")) {
      return this.resources.groupBuilds;
    }
    if (path.includes("/appScreenshotSets?")) return [];
    throw new Error(`Unexpected list request: ${path}`);
  }

  async request(path, options = {}) {
    const method = options.method || "GET";
    this.calls.push({ method, path, body: options.body });
    if (method === "GET" && path === `/v1/apps/${appReleaseCatalog.appId}`) {
      return { data: this.resources.app };
    }
    if (method === "GET" && path.endsWith("/appStoreReviewDetail")) {
      return null;
    }
    if (method === "PATCH") {
      const { type, attributes } = options.body.data;
      const resource = {
        appInfoLocalizations: this.resources.appInfoLocalization,
        appStoreVersionLocalizations: this.resources.versionLocalization,
        builds: this.resources.build,
        betaAppLocalizations: this.resources.betaAppLocalizations[0],
        betaBuildLocalizations: this.resources.betaBuildLocalizations[0],
      }[type];
      assert.ok(resource, `Missing fake resource for ${type}`);
      Object.assign(resource.attributes, attributes);
      return { data: resource };
    }
    if (method === "POST" && path === "/v1/betaAppLocalizations") {
      const resource = {
        type: "betaAppLocalizations",
        id: "beta-app-localization",
        attributes: options.body.data.attributes,
      };
      this.resources.betaAppLocalizations.push(resource);
      return { data: resource };
    }
    if (method === "POST" && path === "/v1/betaBuildLocalizations") {
      const resource = {
        type: "betaBuildLocalizations",
        id: "beta-build-localization",
        attributes: options.body.data.attributes,
      };
      this.resources.betaBuildLocalizations.push(resource);
      return { data: resource };
    }
    if (
      method === "POST" &&
      path === `/v1/betaGroups/${this.resources.betaGroup.id}/relationships/builds`
    ) {
      this.resources.groupBuilds.push(this.resources.build);
      return null;
    }
    throw new Error(`Unexpected ${method} request: ${path}`);
  }
}

test("app release configuration is complete, scoped, and idempotent", async () => {
  const client = new FakeReleaseClient();
  const first = await configureAppRelease(client);

  assert.equal(first.status.metadata.configured, true);
  assert.equal(first.status.metadata.name, "ClawDad Mobile");
  assert.equal(first.status.version.configured, true);
  assert.equal(first.status.beta.usesNonExemptEncryption, false);
  assert.equal(first.status.beta.assignedToGroup, true);
  assert.equal(first.status.beta.appLocalizationConfigured, true);
  assert.equal(first.status.beta.buildLocalizationConfigured, true);
  assert.deepEqual(first.actions, [
    "Updated en-US app name and privacy metadata.",
    "Updated en-US App Store version metadata.",
    "Created en-US TestFlight app details.",
    "Recorded export-compliance exemption for build 19.",
    "Assigned build 19 to ClawDad Internal.",
    "Added TestFlight test instructions to build 19.",
  ]);

  const second = await configureAppRelease(client);
  assert.deepEqual(second.actions, []);
  assert.equal(second.status.beta.assignedToGroup, true);
});

test("subscription review screenshot upload reserves, uploads, commits, and reuses checksum", async () => {
  const contents = Buffer.from("representative ClawDad subscription screenshot");
  let screenshot = null;
  const calls = [];
  const client = {
    async request(path, options = {}) {
      const method = options.method || "GET";
      calls.push({ method, path, body: options.body });
      if (
        method === "GET" &&
        path === "/v1/subscriptions/subscription-id/appStoreReviewScreenshot"
      ) {
        return screenshot ? { data: screenshot } : null;
      }
      if (
        method === "POST" &&
        path === "/v1/subscriptionAppStoreReviewScreenshots"
      ) {
        screenshot = {
          type: "subscriptionAppStoreReviewScreenshots",
          id: "screenshot-id",
          attributes: {
            fileName: options.body.data.attributes.fileName,
            uploadOperations: [{
              method: "PUT",
              url: "https://upload.example.test/review",
              offset: 0,
              length: contents.length,
              requestHeaders: [{ name: "Content-Type", value: "image/png" }],
            }],
            assetDeliveryState: { state: "AWAITING_UPLOAD" },
          },
        };
        return { data: screenshot };
      }
      if (
        method === "PATCH" &&
        path === "/v1/subscriptionAppStoreReviewScreenshots/screenshot-id"
      ) {
        Object.assign(screenshot.attributes, options.body.data.attributes, {
          assetDeliveryState: { state: "COMPLETE" },
        });
        return { data: screenshot };
      }
      throw new Error(`Unexpected ${method} request: ${path}`);
    },
  };
  let uploadedBody = null;
  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://upload.example.test/review");
    assert.equal(options.method, "PUT");
    assert.equal(options.headers["Content-Type"], "image/png");
    uploadedBody = Buffer.from(options.body);
    return { ok: true, status: 200 };
  };

  const first = await uploadSubscriptionReviewScreenshot(
    client,
    "subscription-id",
    {
      fileName: "subscription-review.png",
      contents,
      fetchImpl,
      pollAttempts: 1,
      pollDelayMilliseconds: 0,
    },
  );
  assert.equal(first.action, "uploaded");
  assert.equal(first.state, "COMPLETE");
  assert.deepEqual(uploadedBody, contents);

  const callCount = calls.length;
  const second = await uploadSubscriptionReviewScreenshot(
    client,
    "subscription-id",
    {
      fileName: "subscription-review.png",
      contents,
      fetchImpl,
      pollAttempts: 1,
      pollDelayMilliseconds: 0,
    },
  );
  assert.equal(second.action, "unchanged");
  assert.equal(calls.length, callCount + 1);
});
