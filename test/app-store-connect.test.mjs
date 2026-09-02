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
  configureAppStoreScreenshots,
  createAppStoreConnectToken,
  paidBetaCatalog,
  paidBetaPlan,
  paidBetaProductMissingMetadata,
  readPaidBetaStatus,
  submitExternalBetaReview,
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

test("paid beta metadata audit names every missing subscription field", () => {
  const desired = paidBetaCatalog.products[0];
  const complete = {
    desired,
    subscription: {
      attributes: {
        name: desired.referenceName,
        subscriptionPeriod: desired.period,
        groupLevel: desired.groupLevel,
        reviewNote: "ClawDad connects an iPhone to the customer's paired ClawDad Mac app.",
      },
    },
    localization: {
      attributes: {
        locale: desired.locale,
        name: desired.displayName,
        description: desired.description,
      },
    },
    availableTerritoryIds: ["USA"],
    prices: [{ id: "price" }],
    offers: [{
      attributes: {
        duration: "TWO_WEEKS",
        offerMode: "FREE_TRIAL",
        numberOfPeriods: 1,
      },
    }],
    screenshotState: "COMPLETE",
  };

  assert.deepEqual(paidBetaProductMissingMetadata(complete), []);
  assert.deepEqual(
    paidBetaProductMissingMetadata({
      ...complete,
      localization: null,
      availableTerritoryIds: [],
      prices: [],
      offers: [],
      screenshotState: "MISSING",
    }),
    [
      "en-US localization",
      "USA availability",
      "subscription price",
      "14-day introductory trial",
      "review screenshot",
    ],
  );
});

test("paid beta status exposes version-based App Review readiness", async () => {
  const requests = [];
  const client = {
    async request(path) {
      requests.push(path);
      if (path === `/v1/apps/${paidBetaCatalog.appId}`) {
        return {
          data: {
            id: paidBetaCatalog.appId,
            attributes: {
              name: "ClawDad Mobile",
              bundleId: paidBetaCatalog.expectedBundleId,
            },
          },
        };
      }
      if (path.endsWith("/subscriptionAvailability")) {
        return { data: { id: `availability-${path.split("/")[3]}` } };
      }
      if (path.endsWith("/appStoreReviewScreenshot")) {
        return {
          data: {
            attributes: {
              assetDeliveryState: { state: "COMPLETE" },
            },
          },
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    },
    async list(path) {
      requests.push(path);
      if (path.includes("/subscriptionGroups?")) {
        return [{
          id: "group-1",
          attributes: { referenceName: paidBetaCatalog.group.referenceName },
        }];
      }
      if (path.includes("/subscriptionGroupLocalizations?")) {
        return [{
          attributes: {
            locale: paidBetaCatalog.group.locale,
            name: paidBetaCatalog.group.name,
            state: "PREPARE_FOR_SUBMISSION",
          },
        }];
      }
      if (path.includes("/subscriptionGroups/group-1/versions?")) {
        return [{
          id: "group-version-1",
          attributes: { version: 1, state: "PREPARE_FOR_SUBMISSION" },
        }];
      }
      if (path.includes("/subscriptionGroupVersions/group-version-1/localizations?")) {
        return [{
          attributes: {
            locale: paidBetaCatalog.group.locale,
            name: paidBetaCatalog.group.name,
          },
        }];
      }
      if (path.includes("/subscriptionGroups/group-1/subscriptions?")) {
        return paidBetaCatalog.products.map((product, index) => ({
          id: `subscription-${index + 1}`,
          attributes: {
            name: product.referenceName,
            productId: product.productId,
            subscriptionPeriod: product.period,
            groupLevel: product.groupLevel,
            reviewNote:
              "ClawDad connects an iPhone to the customer's paired ClawDad Mac app.",
          },
        }));
      }
      if (path.includes("/subscriptionLocalizations?")) {
        const product = path.includes("subscription-1")
          ? paidBetaCatalog.products[0]
          : paidBetaCatalog.products[1];
        return [{
          attributes: {
            locale: product.locale,
            name: product.displayName,
            description: product.description,
          },
        }];
      }
      if (path.includes("/versions?")) {
        return [{
          id: `${path.includes("subscription-1") ? "monthly" : "annual"}-version-1`,
          attributes: { version: 1, state: "PREPARE_FOR_SUBMISSION" },
        }];
      }
      if (path.includes("/subscriptionVersions/monthly-version-1/localizations?")) {
        return [{
          attributes: {
            locale: paidBetaCatalog.products[0].locale,
            name: paidBetaCatalog.products[0].displayName,
            description: paidBetaCatalog.products[0].description,
          },
        }];
      }
      if (path.includes("/subscriptionVersions/annual-version-1/localizations?")) {
        return [{
          attributes: {
            locale: paidBetaCatalog.products[1].locale,
            name: paidBetaCatalog.products[1].displayName,
            description: paidBetaCatalog.products[1].description,
          },
        }];
      }
      if (path.includes("/prices?")) {
        return [{ id: "price-1" }];
      }
      if (path.includes("/introductoryOffers?")) {
        return [{
          attributes: {
            duration: "TWO_WEEKS",
            offerMode: "FREE_TRIAL",
            numberOfPeriods: 1,
          },
        }];
      }
      if (path.includes("/subscriptionAvailabilities/availability-")) {
        return [{ id: "USA" }];
      }
      throw new Error(`Unexpected list: ${path}`);
    },
  };

  const status = await readPaidBetaStatus(client);
  assert.equal(status.group.reviewWorkflow.versionCount, 1);
  assert.equal(
    status.group.reviewWorkflow.latestVersion.state,
    "PREPARE_FOR_SUBMISSION",
  );
  assert.deepEqual(
    status.products.map((product) => product.reviewWorkflow.versionCount),
    [1, 1],
  );
  assert.equal(status.reviewWorkflow.authoritativeStateSource, "draftVersions");
  assert.equal(status.reviewWorkflow.metadataConfigured, true);
  assert.equal(status.reviewWorkflow.draftVersionsPrepared, true);
  assert.ok(
    requests.includes("/v1/subscriptions/subscription-1/versions?limit=200"),
  );
});

test("app release plan pins the ClawDad app, paid-beta build, and public URLs", () => {
  assert.deepEqual(appReleasePlan(), {
    appId: "6783090068",
    expectedBundleId: "earth.frg.clawdad.ios",
    locale: "en-US",
    appName: "ClawDad Mobile",
    subtitle: "Codex threads from anywhere",
    versionString: "1.0",
    internalBetaGroup: "ClawDad Internal",
    externalBetaGroup: "ClawDad Founding Customers",
    betaBuild: "34",
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
          version: "34",
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
      externalBetaGroup: null,
      groupBuilds: [],
      externalGroupBuilds: [],
      betaReviewDetail: {
        type: "betaAppReviewDetails",
        id: appReleaseCatalog.appId,
        attributes: {
          contactFirstName: null,
          contactLastName: null,
          contactPhone: "+1 850 555 0100",
          contactEmail: null,
          demoAccountName: null,
          demoAccountPassword: null,
          demoAccountRequired: null,
          notes: null,
        },
      },
      betaReviewSubmissions: [],
      screenshotSets: [],
      screenshotsBySet: new Map(),
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
    if (path.startsWith("/v1/betaGroups?")) {
      return [
        this.resources.betaGroup,
        this.resources.externalBetaGroup,
      ].filter(Boolean);
    }
    if (
      path ===
      `/v1/betaGroups/${this.resources.betaGroup.id}/relationships/builds?limit=200`
    ) {
      return this.resources.groupBuilds;
    }
    if (
      this.resources.externalBetaGroup &&
      path ===
      `/v1/betaGroups/${this.resources.externalBetaGroup.id}/relationships/builds?limit=200`
    ) {
      return this.resources.externalGroupBuilds;
    }
    if (path.startsWith("/v1/betaAppReviewDetails?")) {
      return [this.resources.betaReviewDetail];
    }
    if (path.startsWith("/v1/betaAppReviewSubmissions?")) {
      return this.resources.betaReviewSubmissions;
    }
    if (path.includes("/appScreenshotSets?")) {
      return this.resources.screenshotSets;
    }
    const screenshotListMatch = path.match(
      /^\/v1\/appScreenshotSets\/([^/]+)\/appScreenshots\?limit=50$/u,
    );
    if (screenshotListMatch) {
      return this.resources.screenshotsBySet.get(screenshotListMatch[1]) || [];
    }
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
    if (method === "POST" && path === "/v1/appScreenshotSets") {
      const resource = {
        type: "appScreenshotSets",
        id: `screenshot-set-${this.resources.screenshotSets.length + 1}`,
        attributes: options.body.data.attributes,
      };
      this.resources.screenshotSets.push(resource);
      this.resources.screenshotsBySet.set(resource.id, []);
      return { data: resource };
    }
    if (method === "POST" && path === "/v1/appScreenshots") {
      const screenshotSetId =
        options.body.data.relationships.appScreenshotSet.data.id;
      const screenshots =
        this.resources.screenshotsBySet.get(screenshotSetId) || [];
      const resource = {
        type: "appScreenshots",
        id: `app-screenshot-${screenshots.length + 1}`,
        attributes: {
          ...options.body.data.attributes,
          uploadOperations: [{
            method: "PUT",
            url: `https://upload.example.test/${screenshots.length + 1}`,
            offset: 0,
            length: options.body.data.attributes.fileSize,
            requestHeaders: [{
              name: "Content-Type",
              value: "image/png",
            }],
          }],
          assetDeliveryState: { state: "AWAITING_UPLOAD" },
        },
      };
      screenshots.push(resource);
      this.resources.screenshotsBySet.set(screenshotSetId, screenshots);
      return { data: resource };
    }
    if (method === "PATCH" && path.startsWith("/v1/appScreenshots/")) {
      const screenshot = [...this.resources.screenshotsBySet.values()]
        .flat()
        .find((candidate) => path.endsWith(`/${candidate.id}`));
      assert.ok(screenshot, `Missing fake screenshot for ${path}`);
      Object.assign(screenshot.attributes, options.body.data.attributes, {
        assetDeliveryState: { state: "COMPLETE" },
      });
      return { data: screenshot };
    }
    if (
      method === "PATCH" &&
      path.endsWith("/relationships/appScreenshots")
    ) {
      const screenshotSetId = path.split("/")[3];
      const screenshots =
        this.resources.screenshotsBySet.get(screenshotSetId) || [];
      const byId = new Map(
        screenshots.map((screenshot) => [screenshot.id, screenshot]),
      );
      this.resources.screenshotsBySet.set(
        screenshotSetId,
        options.body.data.map((entry) => byId.get(entry.id)),
      );
      return null;
    }
    if (method === "DELETE" && path.startsWith("/v1/appScreenshotSets/")) {
      const screenshotSetId = path.split("/").at(-1);
      this.resources.screenshotSets = this.resources.screenshotSets.filter(
        (candidate) => candidate.id !== screenshotSetId,
      );
      this.resources.screenshotsBySet.delete(screenshotSetId);
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
        betaGroups: this.resources.externalBetaGroup,
        betaAppReviewDetails: this.resources.betaReviewDetail,
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
    if (method === "POST" && path === "/v1/betaGroups") {
      assert.equal(options.body.data.attributes.isInternalGroup, false);
      const resource = {
        type: "betaGroups",
        id: "external-group",
        attributes: options.body.data.attributes,
      };
      this.resources.externalBetaGroup = resource;
      return { data: resource };
    }
    if (
      method === "POST" &&
      path === `/v1/betaGroups/${this.resources.betaGroup.id}/relationships/builds`
    ) {
      this.resources.groupBuilds.push(this.resources.build);
      return null;
    }
    if (
      method === "POST" &&
      this.resources.externalBetaGroup &&
      path ===
        `/v1/betaGroups/${this.resources.externalBetaGroup.id}/relationships/builds`
    ) {
      this.resources.externalGroupBuilds.push(this.resources.build);
      return null;
    }
    if (
      method === "POST" &&
      path === "/v1/betaAppReviewSubmissions"
    ) {
      const resource = {
        type: "betaAppReviewSubmissions",
        id: "beta-review-submission",
        attributes: {
          betaReviewState: "WAITING_FOR_REVIEW",
          submittedDate: "2026-07-30T12:30:00Z",
        },
      };
      this.resources.betaReviewSubmissions.push(resource);
      return { data: resource };
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
  assert.equal(first.status.beta.externalTesting.groupConfigured, true);
  assert.equal(first.status.beta.externalTesting.publicLinkEnabled, false);
  assert.equal(first.status.beta.externalTesting.buildAssigned, false);
  assert.equal(first.status.beta.externalTesting.reviewMetadataConfigured, true);
  assert.deepEqual(
    first.status.beta.externalTesting.missingContactFields,
    [],
  );
  assert.equal(
    first.status.beta.externalTesting.reviewState,
    "NOT_SUBMITTED",
  );
  assert.equal(
    first.status.beta.externalTesting.readyForReviewSubmission,
    false,
  );
  assert.deepEqual(first.actions, [
    "Updated en-US app name and privacy metadata.",
    "Updated en-US App Store version metadata.",
    "Created en-US TestFlight app details.",
    "Recorded export-compliance exemption for build 34.",
    "Created private external TestFlight group ClawDad Founding Customers.",
    "Updated Beta App Review contact and reviewer instructions.",
    "Assigned build 34 to ClawDad Internal.",
    "Added TestFlight test instructions to build 34.",
  ]);
  assert.equal(
    client.calls.some(
      (call) => call.path === "/v1/betaAppReviewSubmissions",
    ),
    false,
  );
  assert.equal(
    client.calls.some(
      (call) => (
        call.path ===
        "/v1/betaGroups/external-group/relationships/builds"
      ),
    ),
    false,
  );

  const second = await configureAppRelease(client);
  assert.deepEqual(second.actions, []);
  assert.equal(second.status.beta.assignedToGroup, true);
  assert.equal(second.status.beta.externalTesting.buildAssigned, false);
});

test("App Store screenshots upload in order and rerun by checksum", async () => {
  const client = new FakeReleaseClient();
  const screenshots = [
    {
      fileName: "01-workspace.png",
      contents: Buffer.from("opaque workspace screenshot"),
    },
    {
      fileName: "02-conversation.png",
      contents: Buffer.from("opaque conversation screenshot"),
    },
  ];
  const uploaded = [];
  const fetchImpl = async (url, options) => {
    uploaded.push({
      url,
      body: Buffer.from(options.body),
    });
    return { ok: true, status: 200 };
  };

  const first = await configureAppStoreScreenshots(client, {
    screenshots,
    fetchImpl,
    pollAttempts: 1,
    pollDelayMilliseconds: 0,
  });
  assert.deepEqual(first.actions, [
    "Created the APP_IPHONE_67 screenshot set.",
    "Uploaded 2 ordered APP_IPHONE_67 screenshots.",
  ]);
  assert.equal(first.status.version.screenshotSetCount, 1);
  assert.equal(
    first.status.remainingHumanGates.some(
      (gate) => gate.startsWith("App Store screenshots"),
    ),
    false,
  );
  assert.deepEqual(
    first.screenshots.map((screenshot) => screenshot.fileName),
    ["01-workspace.png", "02-conversation.png"],
  );
  assert.deepEqual(
    uploaded.map((upload) => upload.body),
    screenshots.map((screenshot) => screenshot.contents),
  );

  const second = await configureAppStoreScreenshots(client, {
    screenshots,
    fetchImpl,
    pollAttempts: 1,
    pollDelayMilliseconds: 0,
  });
  assert.deepEqual(second.actions, []);
  assert.equal(uploaded.length, 2);

  await assert.rejects(
    configureAppStoreScreenshots(client, {
      screenshots: [{
        fileName: "replacement.png",
        contents: Buffer.from("different screenshot"),
      }],
      fetchImpl,
      pollAttempts: 1,
      pollDelayMilliseconds: 0,
    }),
    /explicitly allow replacement/u,
  );
});

test("external beta submission requires certification and is retry-safe", async () => {
  const client = new FakeReleaseClient();
  await configureAppRelease(client);

  await assert.rejects(
    submitExternalBetaReview(client),
    /physical-device certification confirmation/u,
  );

  const first = await submitExternalBetaReview(
    client,
    appReleaseCatalog,
    { physicalCertificationConfirmed: true },
  );
  assert.deepEqual(first.actions, [
    "Assigned build 34 to ClawDad Founding Customers.",
    "Submitted build 34 for Beta App Review.",
  ]);
  assert.equal(first.status.beta.externalTesting.buildAssigned, true);
  assert.equal(
    first.status.beta.externalTesting.reviewState,
    "WAITING_FOR_REVIEW",
  );
  assert.equal(
    first.status.beta.externalTesting.nextAction,
    "Wait for Apple Beta App Review to finish.",
  );

  const second = await submitExternalBetaReview(
    client,
    appReleaseCatalog,
    { physicalCertificationConfirmed: true },
  );
  assert.deepEqual(second.actions, []);
  assert.equal(
    client.calls.filter(
      (call) => call.path === "/v1/betaAppReviewSubmissions",
    ).length,
    1,
  );
});

test("app release leaves beta review details untouched until phone contact exists", async () => {
  const client = new FakeReleaseClient();
  client.resources.betaReviewDetail.attributes.contactPhone = null;

  const result = await configureAppRelease(client);

  assert.equal(result.status.beta.externalTesting.groupConfigured, true);
  assert.equal(
    result.status.beta.externalTesting.reviewMetadataConfigured,
    false,
  );
  assert.deepEqual(
    result.status.beta.externalTesting.missingContactFields,
    ["contactFirstName", "contactLastName", "contactPhone", "contactEmail"],
  );
  assert.equal(
    result.actions.includes(
      "Updated Beta App Review contact and reviewer instructions.",
    ),
    false,
  );
  assert.equal(
    client.calls.some(
      (call) => (
        call.method === "PATCH" &&
        call.path === `/v1/betaAppReviewDetails/${appReleaseCatalog.appId}`
      ),
    ),
    false,
  );
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
