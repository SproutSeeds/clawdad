import {
  createHash,
  createPrivateKey,
  sign as signBytes,
} from "node:crypto";

const APP_STORE_CONNECT_BASE_URL = "https://api.appstoreconnect.apple.com";
const DEFAULT_TOKEN_LIFETIME_SECONDS = 10 * 60;

export const paidBetaCatalog = Object.freeze({
  appId: "6783090068",
  expectedBundleId: "earth.frg.clawdad.ios",
  group: Object.freeze({
    referenceName: "ClawDad Pro",
    locale: "en-US",
    name: "ClawDad Pro",
  }),
  territories: Object.freeze(["USA"]),
  products: Object.freeze([
    Object.freeze({
      referenceName: "ClawDad Pro Monthly",
      productId: "earth.frg.clawdad.pro.monthly",
      period: "ONE_MONTH",
      groupLevel: 1,
      locale: "en-US",
      displayName: "ClawDad Pro Monthly",
      description: "ClawDad access for your paired Mac.",
      customerPrice: "9.99",
    }),
    Object.freeze({
      referenceName: "ClawDad Pro Annual",
      productId: "earth.frg.clawdad.pro.annual",
      period: "ONE_YEAR",
      groupLevel: 1,
      locale: "en-US",
      displayName: "ClawDad Pro Annual",
      description: "A year of ClawDad for your paired Mac.",
      customerPrice: "99.00",
    }),
  ]),
  introductoryOffer: Object.freeze({
    duration: "TWO_WEEKS",
    offerMode: "FREE_TRIAL",
    numberOfPeriods: 1,
  }),
});

export const appReleaseCatalog = Object.freeze({
  appId: "6783090068",
  expectedBundleId: "earth.frg.clawdad.ios",
  locale: "en-US",
  appInfo: Object.freeze({
    name: "ClawDad Mobile",
    subtitle: "Codex threads from anywhere",
    privacyPolicyUrl: "https://clawdad-cloud.frg.earth/privacy",
    privacyChoicesUrl: "https://clawdad-cloud.frg.earth/privacy#retention-and-control",
  }),
  version: Object.freeze({
    platform: "IOS",
    versionString: "1.0",
    description: [
      "ClawDad keeps your Codex projects moving from iPhone while your paired Mac remains the execution authority.",
      "",
      "Choose a project and thread, send Direct messages into active work or Queue messages for the next turn, attach images, dictate prompts, listen to responses, and return to the same Codex session from your terminal.",
      "",
      "Opt-in Remote Assist gives you a full-screen view and control of your paired Mac for moments that need a human click, approval, or terminal interaction.",
      "",
      "ClawDad requires the ClawDad Mac app, Codex installed and signed in on that Mac, and separate OpenAI access.",
    ].join("\n"),
    keywords: "codex,developer,remote,terminal,projects,AI,automation,voice,desktop,threads",
    marketingUrl: "https://clawdad-cloud.frg.earth/",
    promotionalText: "Keep Codex projects moving from iPhone with secure pairing, persistent threads, voice, images, Direct and Queue messaging, and opt-in Remote Assist.",
    supportUrl: "https://clawdad-cloud.frg.earth/support",
  }),
  beta: Object.freeze({
    groupName: "ClawDad Internal",
    buildNumber: "19",
    feedbackEmail: "cody@frg.earth",
    description: "ClawDad pairs an iPhone with the customer's Mac so they can continue existing Codex projects and use opt-in Remote Assist.",
    whatsNew: [
      "Test the complete paid-beta path:",
      "• Install or update the ClawDad Mac app and pair this iPhone with a fresh QR code.",
      "• Confirm projects and Codex threads restore after relaunch.",
      "• Send Direct and Queue messages, including one long-running turn.",
      "• Try voice dictation, response audio, and an image attachment.",
      "• Purchase either plan, restore purchases, and verify Mac subscription status.",
      "• Enable Remote Assist and test landscape, keyboard, Enter, and clipboard in both directions.",
      "Report issues from https://clawdad-cloud.frg.earth/support.",
    ].join("\n"),
  }),
});

function encodeBase64Url(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return input.toString("base64url");
}

export function createAppStoreConnectToken({
  keyId,
  issuerId,
  privateKey,
  nowSeconds = Math.floor(Date.now() / 1000),
  lifetimeSeconds = DEFAULT_TOKEN_LIFETIME_SECONDS,
}) {
  if (!keyId || !issuerId || !privateKey) {
    throw new Error("App Store Connect key ID, issuer ID, and private key are required.");
  }
  if (lifetimeSeconds <= 0 || lifetimeSeconds > 20 * 60) {
    throw new Error("App Store Connect JWT lifetime must be between 1 and 1200 seconds.");
  }

  const header = encodeBase64Url(JSON.stringify({
    alg: "ES256",
    kid: keyId,
    typ: "JWT",
  }));
  const payload = encodeBase64Url(JSON.stringify({
    iss: issuerId,
    iat: nowSeconds,
    exp: nowSeconds + lifetimeSeconds,
    aud: "appstoreconnect-v1",
  }));
  const signingInput = `${header}.${payload}`;
  const signingKey = privateKey?.type === "private"
    ? privateKey
    : createPrivateKey(privateKey);
  const signature = signBytes(
    "sha256",
    Buffer.from(signingInput),
    {
      key: signingKey,
      dsaEncoding: "ieee-p1363",
    },
  );
  return `${signingInput}.${encodeBase64Url(signature)}`;
}

function appStoreErrorMessage(status, payload) {
  const details = Array.isArray(payload?.errors)
    ? payload.errors
      .map((error) => error?.detail || error?.title || error?.code)
      .filter(Boolean)
      .join("; ")
    : "";
  return `App Store Connect returned ${status}${details ? `: ${details}` : ""}`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class AppStoreConnectClient {
  constructor({
    keyId,
    issuerId,
    privateKey,
    baseUrl = APP_STORE_CONNECT_BASE_URL,
    fetchImpl = globalThis.fetch,
  }) {
    if (typeof fetchImpl !== "function") {
      throw new Error("A fetch implementation is required.");
    }
    this.keyId = keyId;
    this.issuerId = issuerId;
    this.privateKey = privateKey;
    this.baseUrl = baseUrl.replace(/\/+$/u, "");
    this.fetchImpl = fetchImpl;
  }

  async request(path, {
    method = "GET",
    body,
    allowNotFound = false,
    attempts = 4,
  } = {}) {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const token = createAppStoreConnectToken({
        keyId: this.keyId,
        issuerId: this.issuerId,
        privateKey: this.privateKey,
      });
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (allowNotFound && response.status === 404) {
        return null;
      }
      if (response.ok) {
        if (response.status === 204) {
          return null;
        }
        return response.json();
      }

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
        const retryAfterSeconds = Number(response.headers.get("retry-after"));
        const waitMilliseconds = Number.isFinite(retryAfterSeconds)
          ? Math.max(250, retryAfterSeconds * 1000)
          : Math.min(8_000, 500 * (2 ** (attempt - 1)));
        await sleep(waitMilliseconds);
        continue;
      }
      const error = new Error(appStoreErrorMessage(response.status, payload));
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    throw new Error("App Store Connect request exhausted its retries.");
  }

  async list(path) {
    const resources = [];
    let next = path;
    while (next) {
      const page = await this.request(next);
      resources.push(...(Array.isArray(page?.data) ? page.data : []));
      next = page?.links?.next || null;
    }
    return resources;
  }
}

function relationship(type, id) {
  return { data: { type, id } };
}

function changedAttributes(current, desired) {
  return Object.fromEntries(
    Object.entries(desired).filter(([key, value]) => current?.[key] !== value),
  );
}

function attributesMatch(current, desired) {
  return Object.keys(changedAttributes(current, desired)).length === 0;
}

export function buildSubscriptionCreateRequest(product, groupId) {
  return {
    data: {
      type: "subscriptions",
      attributes: {
        name: product.referenceName,
        productId: product.productId,
        subscriptionPeriod: product.period,
        familySharable: false,
        groupLevel: product.groupLevel,
        reviewNote: "ClawDad connects an iPhone to the customer's paired ClawDad Mac app.",
      },
      relationships: {
        group: relationship("subscriptionGroups", groupId),
      },
    },
  };
}

export function buildPriceCreateRequest(
  subscriptionId,
  pricePointId,
  startDate = null,
) {
  return {
    data: {
      type: "subscriptionPrices",
      attributes: {
        startDate,
      },
      relationships: {
        subscription: relationship("subscriptions", subscriptionId),
        subscriptionPricePoint: relationship(
          "subscriptionPricePoints",
          pricePointId,
        ),
      },
    },
  };
}

export function buildTrialCreateRequest(
  subscriptionId,
  territoryId,
  offer = paidBetaCatalog.introductoryOffer,
) {
  return {
    data: {
      type: "subscriptionIntroductoryOffers",
      attributes: {
        duration: offer.duration,
        offerMode: offer.offerMode,
        numberOfPeriods: offer.numberOfPeriods,
      },
      relationships: {
        subscription: relationship("subscriptions", subscriptionId),
        territory: relationship("territories", territoryId),
      },
    },
  };
}

function mediaStateDescription(state) {
  const details = [
    ...(state?.errors || []),
    ...(state?.warnings || []),
  ]
    .map((entry) => entry?.description || entry?.code)
    .filter(Boolean)
    .join("; ");
  return details || state?.state || "unknown state";
}

export async function uploadSubscriptionReviewScreenshot(
  client,
  subscriptionId,
  {
    fileName,
    contents,
    fetchImpl = globalThis.fetch,
    pollAttempts = 20,
    pollDelayMilliseconds = 1_000,
  },
) {
  if (!subscriptionId || !fileName || !Buffer.isBuffer(contents) || contents.length === 0) {
    throw new Error("A subscription, file name, and nonempty screenshot are required.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for screenshot upload.");
  }
  const checksum = createHash("md5").update(contents).digest("hex");
  const relatedPath = `/v1/subscriptions/${subscriptionId}/appStoreReviewScreenshot`;
  const existingResponse = await client.request(relatedPath, {
    allowNotFound: true,
  });
  const existing = existingResponse?.data || null;
  const existingState = existing?.attributes?.assetDeliveryState?.state || "";
  if (
    existing?.attributes?.sourceFileChecksum === checksum &&
    ["UPLOAD_COMPLETE", "COMPLETE"].includes(existingState)
  ) {
    return {
      action: "unchanged",
      id: existing.id,
      checksum,
      state: existingState,
    };
  }
  if (existing?.id) {
    await client.request(
      `/v1/subscriptionAppStoreReviewScreenshots/${existing.id}`,
      { method: "DELETE" },
    );
  }

  const reservation = await client.request(
    "/v1/subscriptionAppStoreReviewScreenshots",
    {
      method: "POST",
      body: {
        data: {
          type: "subscriptionAppStoreReviewScreenshots",
          attributes: {
            fileName,
            fileSize: contents.length,
          },
          relationships: {
            subscription: relationship("subscriptions", subscriptionId),
          },
        },
      },
    },
  );
  const resource = reservation?.data;
  if (!resource?.id) {
    throw new Error("App Store Connect did not create a screenshot upload reservation.");
  }
  const uploadOperations = resource?.attributes?.uploadOperations || [];
  if (uploadOperations.length === 0) {
    throw new Error("App Store Connect did not provide screenshot upload operations.");
  }
  for (const operation of uploadOperations) {
    const offset = Number(operation.offset || 0);
    const length = Number(operation.length || 0);
    const response = await fetchImpl(operation.url, {
      method: operation.method || "PUT",
      headers: Object.fromEntries(
        (operation.requestHeaders || []).map((header) => [
          header.name,
          header.value,
        ]),
      ),
      body: contents.subarray(offset, offset + length),
    });
    if (!response.ok) {
      throw new Error(
        `App Store Connect screenshot part upload returned ${response.status}.`,
      );
    }
  }

  let current = await client.request(
    `/v1/subscriptionAppStoreReviewScreenshots/${resource.id}`,
    {
      method: "PATCH",
      body: {
        data: {
          type: "subscriptionAppStoreReviewScreenshots",
          id: resource.id,
          attributes: {
            uploaded: true,
            sourceFileChecksum: checksum,
          },
        },
      },
    },
  );
  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    const state = current?.data?.attributes?.assetDeliveryState;
    if (state?.state === "COMPLETE") {
      return {
        action: existing ? "replaced" : "uploaded",
        id: resource.id,
        checksum,
        state: state.state,
      };
    }
    if (state?.state === "FAILED") {
      throw new Error(
        `App Store Connect rejected the subscription screenshot: ` +
        mediaStateDescription(state),
      );
    }
    if (attempt + 1 < pollAttempts) {
      await sleep(pollDelayMilliseconds);
      current = await client.request(
        `/v1/subscriptionAppStoreReviewScreenshots/${resource.id}`,
      );
    }
  }
  const finalState = current?.data?.attributes?.assetDeliveryState;
  throw new Error(
    `Subscription screenshot did not finish processing: ` +
    mediaStateDescription(finalState),
  );
}

export async function configurePaidBetaReviewScreenshots(
  client,
  {
    catalog = paidBetaCatalog,
    fileName,
    contents,
    fetchImpl = globalThis.fetch,
  },
) {
  const groups = await client.list(
    `/v1/apps/${catalog.appId}/subscriptionGroups?limit=200`,
  );
  const group = groups.find(
    (candidate) => candidate?.attributes?.referenceName ===
      catalog.group.referenceName,
  );
  if (!group) {
    throw new Error(`Subscription group ${catalog.group.referenceName} is missing.`);
  }
  const subscriptions = await client.list(
    `/v1/subscriptionGroups/${group.id}/subscriptions?limit=200`,
  );
  const results = [];
  for (const product of catalog.products) {
    const subscription = subscriptions.find(
      (candidate) => candidate?.attributes?.productId === product.productId,
    );
    if (!subscription) {
      throw new Error(`Subscription ${product.productId} is missing.`);
    }
    results.push({
      productId: product.productId,
      ...(await uploadSubscriptionReviewScreenshot(
        client,
        subscription.id,
        { fileName, contents, fetchImpl },
      )),
    });
  }
  return {
    results,
    status: await readPaidBetaStatus(client, catalog),
  };
}

function relationId(resource, name) {
  return resource?.relationships?.[name]?.data?.id || "";
}

function samePrice(left, right) {
  return Math.abs(Number(left) - Number(right)) < 0.001;
}

async function ensureGroup(client, catalog, actions) {
  const groups = await client.list(
    `/v1/apps/${catalog.appId}/subscriptionGroups?limit=200`,
  );
  let group = groups.find(
    (candidate) => candidate?.attributes?.referenceName === catalog.group.referenceName,
  );
  if (!group) {
    const response = await client.request("/v1/subscriptionGroups", {
      method: "POST",
      body: {
        data: {
          type: "subscriptionGroups",
          attributes: {
            referenceName: catalog.group.referenceName,
          },
          relationships: {
            app: relationship("apps", catalog.appId),
          },
        },
      },
    });
    group = response.data;
    actions.push(`Created subscription group ${catalog.group.referenceName}.`);
  }

  const localizations = await client.list(
    `/v1/subscriptionGroups/${group.id}/subscriptionGroupLocalizations?limit=200`,
  );
  const localization = localizations.find(
    (candidate) => candidate?.attributes?.locale === catalog.group.locale,
  );
  if (!localization) {
    await client.request("/v1/subscriptionGroupLocalizations", {
      method: "POST",
      body: {
        data: {
          type: "subscriptionGroupLocalizations",
          attributes: {
            locale: catalog.group.locale,
            name: catalog.group.name,
          },
          relationships: {
            subscriptionGroup: relationship("subscriptionGroups", group.id),
          },
        },
      },
    });
    actions.push(`Localized subscription group for ${catalog.group.locale}.`);
  } else if (localization?.attributes?.name !== catalog.group.name) {
    await client.request(`/v1/subscriptionGroupLocalizations/${localization.id}`, {
      method: "PATCH",
      body: {
        data: {
          type: "subscriptionGroupLocalizations",
          id: localization.id,
          attributes: {
            name: catalog.group.name,
          },
        },
      },
    });
    actions.push(`Updated subscription group localization for ${catalog.group.locale}.`);
  }
  return group;
}

async function ensureSubscription(client, group, product, actions) {
  const subscriptions = await client.list(
    `/v1/subscriptionGroups/${group.id}/subscriptions?limit=200`,
  );
  let subscription = subscriptions.find(
    (candidate) => candidate?.attributes?.productId === product.productId,
  );
  if (!subscription) {
    const response = await client.request("/v1/subscriptions", {
      method: "POST",
      body: buildSubscriptionCreateRequest(product, group.id),
    });
    subscription = response.data;
    actions.push(`Created ${product.productId}.`);
  } else if (
    subscription?.attributes?.subscriptionPeriod &&
    subscription.attributes.subscriptionPeriod !== product.period
  ) {
    throw new Error(
      `${product.productId} exists with ${subscription.attributes.subscriptionPeriod}; ` +
      `expected ${product.period}.`,
    );
  }

  const localizations = await client.list(
    `/v1/subscriptions/${subscription.id}/subscriptionLocalizations?limit=200`,
  );
  const localization = localizations.find(
    (candidate) => candidate?.attributes?.locale === product.locale,
  );
  if (!localization) {
    await client.request("/v1/subscriptionLocalizations", {
      method: "POST",
      body: {
        data: {
          type: "subscriptionLocalizations",
          attributes: {
            locale: product.locale,
            name: product.displayName,
            description: product.description,
          },
          relationships: {
            subscription: relationship("subscriptions", subscription.id),
          },
        },
      },
    });
    actions.push(`Localized ${product.productId} for ${product.locale}.`);
  } else {
    const current = localization.attributes || {};
    if (
      current.name !== product.displayName ||
      current.description !== product.description
    ) {
      await client.request(`/v1/subscriptionLocalizations/${localization.id}`, {
        method: "PATCH",
        body: {
          data: {
            type: "subscriptionLocalizations",
            id: localization.id,
            attributes: {
              name: product.displayName,
              description: product.description,
            },
          },
        },
      });
      actions.push(`Updated ${product.productId} localization.`);
    }
  }
  return subscription;
}

async function ensureAvailability(client, subscription, territoryIds, actions) {
  const availability = await client.request(
    `/v1/subscriptions/${subscription.id}/subscriptionAvailability`,
    { allowNotFound: true },
  );
  if (!availability) {
    await client.request("/v1/subscriptionAvailabilities", {
      method: "POST",
      body: {
        data: {
          type: "subscriptionAvailabilities",
          attributes: {
            availableInNewTerritories: false,
          },
          relationships: {
            subscription: relationship("subscriptions", subscription.id),
            availableTerritories: {
              data: territoryIds.map((id) => ({ type: "territories", id })),
            },
          },
        },
      },
    });
    actions.push(
      `Enabled ${subscription.attributes.productId} in ${territoryIds.join(", ")}.`,
    );
    return;
  }

  const available = await client.list(
    `/v1/subscriptionAvailabilities/${availability.data.id}` +
    "/relationships/availableTerritories?limit=200",
  );
  const availableIds = new Set(available.map((resource) => resource.id));
  const missing = territoryIds.filter((id) => !availableIds.has(id));
  if (missing.length > 0) {
    throw new Error(
      `${subscription.attributes.productId} is missing availability for ` +
      `${missing.join(", ")}. App Store Connect requires a manual availability update.`,
    );
  }
}

async function findPricePoint(client, subscription, territoryId, customerPrice) {
  const pricePoints = await client.list(
    `/v1/subscriptions/${subscription.id}/pricePoints` +
    `?filter[territory]=${encodeURIComponent(territoryId)}` +
    "&include=territory&limit=8000",
  );
  const match = pricePoints.find(
    (pricePoint) => samePrice(pricePoint?.attributes?.customerPrice, customerPrice),
  );
  if (!match) {
    throw new Error(
      `No ${territoryId} price point equals ${customerPrice} for ` +
      `${subscription.attributes.productId}.`,
    );
  }
  return match;
}

async function ensurePrice(
  client,
  subscription,
  territoryId,
  customerPrice,
  actions,
) {
  const pricePoint = await findPricePoint(
    client,
    subscription,
    territoryId,
    customerPrice,
  );
  const prices = await client.list(
    `/v1/subscriptions/${subscription.id}/prices` +
    `?filter[territory]=${encodeURIComponent(territoryId)}` +
    "&include=subscriptionPricePoint,territory&limit=200",
  );
  if (
    prices.some(
      (price) => relationId(price, "subscriptionPricePoint") === pricePoint.id,
    )
  ) {
    return;
  }
  if (prices.length > 0) {
    throw new Error(
      `${subscription.attributes.productId} already has a different ` +
      `${territoryId} price. Refusing an automatic price change.`,
    );
  }
  await client.request("/v1/subscriptionPrices", {
    method: "POST",
    body: buildPriceCreateRequest(subscription.id, pricePoint.id),
  });
  actions.push(
    `Set ${subscription.attributes.productId} to ${customerPrice} in ${territoryId}.`,
  );
}

async function ensureTrial(client, subscription, territoryId, catalog, actions) {
  const offers = await client.list(
    `/v1/subscriptions/${subscription.id}/introductoryOffers` +
    `?filter[territory]=${encodeURIComponent(territoryId)}&limit=200`,
  );
  const target = catalog.introductoryOffer;
  const matching = offers.find((offer) => (
    offer?.attributes?.duration === target.duration &&
    offer?.attributes?.offerMode === target.offerMode &&
    offer?.attributes?.numberOfPeriods === target.numberOfPeriods
  ));
  if (matching) {
    return;
  }
  if (offers.length > 0) {
    throw new Error(
      `${subscription.attributes.productId} already has a different ` +
      `${territoryId} introductory offer.`,
    );
  }
  await client.request("/v1/subscriptionIntroductoryOffers", {
    method: "POST",
    body: buildTrialCreateRequest(subscription.id, territoryId, target),
  });
  actions.push(
    `Added a 14-day trial to ${subscription.attributes.productId} in ${territoryId}.`,
  );
}

export async function readPaidBetaStatus(
  client,
  catalog = paidBetaCatalog,
) {
  const appResponse = await client.request(`/v1/apps/${catalog.appId}`);
  const app = appResponse.data;
  const groups = await client.list(
    `/v1/apps/${catalog.appId}/subscriptionGroups?limit=200`,
  );
  const group = groups.find(
    (candidate) => candidate?.attributes?.referenceName === catalog.group.referenceName,
  );
  const products = [];
  if (group) {
    const subscriptions = await client.list(
      `/v1/subscriptionGroups/${group.id}/subscriptions?limit=200`,
    );
    for (const desired of catalog.products) {
      const subscription = subscriptions.find(
        (candidate) => candidate?.attributes?.productId === desired.productId,
      );
      if (!subscription) {
        products.push({
          productId: desired.productId,
          configured: false,
        });
        continue;
      }
      const prices = await client.list(
        `/v1/subscriptions/${subscription.id}/prices?limit=200`,
      );
      const offers = await client.list(
        `/v1/subscriptions/${subscription.id}/introductoryOffers?limit=200`,
      );
      const screenshot = await client.request(
        `/v1/subscriptions/${subscription.id}/appStoreReviewScreenshot`,
        { allowNotFound: true },
      );
      products.push({
        id: subscription.id,
        productId: desired.productId,
        configured: true,
        state: subscription?.attributes?.state || "UNKNOWN",
        subscriptionPeriod: subscription?.attributes?.subscriptionPeriod || desired.period,
        priceCount: prices.length,
        introductoryOfferCount: offers.length,
        reviewScreenshotState:
          screenshot?.data?.attributes?.assetDeliveryState?.state || "MISSING",
      });
    }
  } else {
    for (const desired of catalog.products) {
      products.push({
        productId: desired.productId,
        configured: false,
      });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    app: {
      id: app.id,
      name: app?.attributes?.name || "",
      bundleId: app?.attributes?.bundleId || "",
    },
    group: group
      ? {
        id: group.id,
        referenceName: group?.attributes?.referenceName || "",
      }
      : null,
    territories: [...catalog.territories],
    products,
  };
}

export function paidBetaPlan(catalog = paidBetaCatalog) {
  return {
    appId: catalog.appId,
    expectedBundleId: catalog.expectedBundleId,
    subscriptionGroup: catalog.group.referenceName,
    territories: [...catalog.territories],
    products: catalog.products.map((product) => ({
      productId: product.productId,
      period: product.period,
      customerPrice: product.customerPrice,
      introductoryOffer: {
        duration: catalog.introductoryOffer.duration,
        offerMode: catalog.introductoryOffer.offerMode,
        numberOfPeriods: catalog.introductoryOffer.numberOfPeriods,
      },
    })),
  };
}

export async function configurePaidBeta(
  client,
  catalog = paidBetaCatalog,
) {
  const appResponse = await client.request(`/v1/apps/${catalog.appId}`);
  const app = appResponse.data;
  const actualBundleId = app?.attributes?.bundleId || "";
  if (actualBundleId !== catalog.expectedBundleId) {
    throw new Error(
      `App ${catalog.appId} uses bundle ID ${actualBundleId}; ` +
      `expected ${catalog.expectedBundleId}.`,
    );
  }

  const actions = [];
  const group = await ensureGroup(client, catalog, actions);
  for (const product of catalog.products) {
    const subscription = await ensureSubscription(client, group, product, actions);
    await ensureAvailability(client, subscription, catalog.territories, actions);
    for (const territoryId of catalog.territories) {
      await ensurePrice(
        client,
        subscription,
        territoryId,
        product.customerPrice,
        actions,
      );
      await ensureTrial(client, subscription, territoryId, catalog, actions);
    }
  }
  return {
    actions,
    status: await readPaidBetaStatus(client, catalog),
  };
}

function desiredAppInfoAttributes(catalog) {
  return {
    name: catalog.appInfo.name,
    subtitle: catalog.appInfo.subtitle,
    privacyPolicyUrl: catalog.appInfo.privacyPolicyUrl,
    privacyChoicesUrl: catalog.appInfo.privacyChoicesUrl,
  };
}

function desiredVersionAttributes(catalog) {
  return {
    description: catalog.version.description,
    keywords: catalog.version.keywords,
    marketingUrl: catalog.version.marketingUrl,
    promotionalText: catalog.version.promotionalText,
    supportUrl: catalog.version.supportUrl,
  };
}

function desiredBetaAppAttributes(catalog) {
  return {
    feedbackEmail: catalog.beta.feedbackEmail,
    marketingUrl: catalog.version.marketingUrl,
    privacyPolicyUrl: catalog.appInfo.privacyPolicyUrl,
    description: catalog.beta.description,
  };
}

export function appReleasePlan(catalog = appReleaseCatalog) {
  return {
    appId: catalog.appId,
    expectedBundleId: catalog.expectedBundleId,
    locale: catalog.locale,
    appName: catalog.appInfo.name,
    subtitle: catalog.appInfo.subtitle,
    versionString: catalog.version.versionString,
    betaGroup: catalog.beta.groupName,
    betaBuild: catalog.beta.buildNumber,
    privacyPolicyUrl: catalog.appInfo.privacyPolicyUrl,
    supportUrl: catalog.version.supportUrl,
  };
}

async function releaseResources(client, catalog) {
  const app = (await client.request(`/v1/apps/${catalog.appId}`)).data;
  const appInfos = await client.list(
    `/v1/apps/${catalog.appId}/appInfos?limit=20`,
  );
  const appInfo = appInfos[0] || null;
  const appInfoLocalizations = appInfo
    ? await client.list(
      `/v1/appInfos/${appInfo.id}/appInfoLocalizations?limit=50`,
    )
    : [];
  const appInfoLocalization = appInfoLocalizations.find(
    (candidate) => candidate?.attributes?.locale === catalog.locale,
  ) || null;

  const versions = await client.list(
    `/v1/apps/${catalog.appId}/appStoreVersions?limit=50`,
  );
  const version = versions.find(
    (candidate) => (
      candidate?.attributes?.platform === catalog.version.platform &&
      candidate?.attributes?.versionString === catalog.version.versionString
    ),
  ) || null;
  const versionLocalizations = version
    ? await client.list(
      `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`,
    )
    : [];
  const versionLocalization = versionLocalizations.find(
    (candidate) => candidate?.attributes?.locale === catalog.locale,
  ) || null;

  const builds = await client.list(
    `/v1/builds?filter%5Bapp%5D=${encodeURIComponent(catalog.appId)}` +
    `&filter%5Bversion%5D=${encodeURIComponent(catalog.beta.buildNumber)}` +
    "&limit=20",
  );
  const build = builds.find(
    (candidate) => candidate?.attributes?.version === catalog.beta.buildNumber,
  ) || null;
  const betaBuildLocalizations = build
    ? await client.list(
      `/v1/builds/${build.id}/betaBuildLocalizations?limit=50`,
    )
    : [];
  const betaBuildLocalization = betaBuildLocalizations.find(
    (candidate) => candidate?.attributes?.locale === catalog.locale,
  ) || null;

  const betaAppLocalizations = await client.list(
    `/v1/apps/${catalog.appId}/betaAppLocalizations?limit=50`,
  );
  const betaAppLocalization = betaAppLocalizations.find(
    (candidate) => candidate?.attributes?.locale === catalog.locale,
  ) || null;

  const groups = await client.list(
    `/v1/betaGroups?filter%5Bapp%5D=${encodeURIComponent(catalog.appId)}` +
    "&limit=50",
  );
  const betaGroup = groups.find(
    (candidate) => candidate?.attributes?.name === catalog.beta.groupName,
  ) || null;
  const groupBuilds = betaGroup
    ? await client.list(
      `/v1/betaGroups/${betaGroup.id}/relationships/builds?limit=200`,
    )
    : [];
  const screenshotSets = versionLocalization
    ? await client.list(
      `/v1/appStoreVersionLocalizations/${versionLocalization.id}` +
      "/appScreenshotSets?limit=50",
    )
    : [];
  const reviewDetail = version
    ? await client.request(
      `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`,
      { allowNotFound: true },
    )
    : null;

  return {
    app,
    appInfo,
    appInfoLocalization,
    version,
    versionLocalization,
    build,
    betaBuildLocalization,
    betaAppLocalization,
    betaGroup,
    groupBuilds,
    screenshotSets,
    reviewDetail: reviewDetail?.data || null,
  };
}

export async function readAppReleaseStatus(
  client,
  catalog = appReleaseCatalog,
) {
  const resources = await releaseResources(client, catalog);
  const appInfoDesired = desiredAppInfoAttributes(catalog);
  const versionDesired = desiredVersionAttributes(catalog);
  const betaAppDesired = desiredBetaAppAttributes(catalog);
  const buildAssigned = Boolean(
    resources.build &&
    resources.groupBuilds.some((candidate) => candidate.id === resources.build.id),
  );

  return {
    generatedAt: new Date().toISOString(),
    app: {
      id: resources.app?.id || "",
      name: resources.app?.attributes?.name || "",
      bundleId: resources.app?.attributes?.bundleId || "",
    },
    metadata: {
      appInfoId: resources.appInfo?.id || "",
      appStoreState: resources.appInfo?.attributes?.appStoreState || "UNKNOWN",
      localizationId: resources.appInfoLocalization?.id || "",
      configured: attributesMatch(
        resources.appInfoLocalization?.attributes,
        appInfoDesired,
      ),
      name: resources.appInfoLocalization?.attributes?.name || "",
      privacyPolicyUrl:
        resources.appInfoLocalization?.attributes?.privacyPolicyUrl || "",
    },
    version: {
      id: resources.version?.id || "",
      versionString: resources.version?.attributes?.versionString || "",
      state: resources.version?.attributes?.appStoreState || "MISSING",
      localizationId: resources.versionLocalization?.id || "",
      configured: attributesMatch(
        resources.versionLocalization?.attributes,
        versionDesired,
      ),
      screenshotSetCount: resources.screenshotSets.length,
      reviewContactConfigured: Boolean(resources.reviewDetail),
    },
    beta: {
      groupId: resources.betaGroup?.id || "",
      groupName: resources.betaGroup?.attributes?.name || "",
      buildId: resources.build?.id || "",
      buildNumber: resources.build?.attributes?.version || "",
      processingState: resources.build?.attributes?.processingState || "MISSING",
      usesNonExemptEncryption:
        resources.build?.attributes?.usesNonExemptEncryption ?? null,
      assignedToGroup: buildAssigned,
      appLocalizationConfigured: attributesMatch(
        resources.betaAppLocalization?.attributes,
        betaAppDesired,
      ),
      buildLocalizationConfigured:
        resources.betaBuildLocalization?.attributes?.whatsNew ===
        catalog.beta.whatsNew,
    },
    remainingHumanGates: [
      "App Store screenshots and representative visual review",
      "App privacy questionnaire confirmation",
      "App Review contact details and reviewer pairing instructions",
      "Physical-device paid purchase, restore, and cancellation verification",
    ],
  };
}

async function ensureAppInfoLocalization(
  client,
  resources,
  catalog,
  actions,
) {
  if (!resources.appInfo) {
    throw new Error("App Store Connect does not expose an editable app info record.");
  }
  const desired = desiredAppInfoAttributes(catalog);
  if (!resources.appInfoLocalization) {
    await client.request("/v1/appInfoLocalizations", {
      method: "POST",
      body: {
        data: {
          type: "appInfoLocalizations",
          attributes: {
            locale: catalog.locale,
            ...desired,
          },
          relationships: {
            appInfo: relationship("appInfos", resources.appInfo.id),
          },
        },
      },
    });
    actions.push(`Created ${catalog.locale} App Store app information.`);
    return;
  }
  const changes = changedAttributes(
    resources.appInfoLocalization.attributes,
    desired,
  );
  if (Object.keys(changes).length > 0) {
    await client.request(
      `/v1/appInfoLocalizations/${resources.appInfoLocalization.id}`,
      {
        method: "PATCH",
        body: {
          data: {
            type: "appInfoLocalizations",
            id: resources.appInfoLocalization.id,
            attributes: changes,
          },
        },
      },
    );
    actions.push(`Updated ${catalog.locale} app name and privacy metadata.`);
  }
}

async function ensureVersionLocalization(
  client,
  resources,
  catalog,
  actions,
) {
  if (!resources.version) {
    throw new Error(
      `App Store version ${catalog.version.versionString} is not configured.`,
    );
  }
  const desired = desiredVersionAttributes(catalog);
  if (!resources.versionLocalization) {
    await client.request("/v1/appStoreVersionLocalizations", {
      method: "POST",
      body: {
        data: {
          type: "appStoreVersionLocalizations",
          attributes: {
            locale: catalog.locale,
            ...desired,
          },
          relationships: {
            appStoreVersion: relationship(
              "appStoreVersions",
              resources.version.id,
            ),
          },
        },
      },
    });
    actions.push(`Created ${catalog.locale} App Store version metadata.`);
    return;
  }
  const changes = changedAttributes(
    resources.versionLocalization.attributes,
    desired,
  );
  if (Object.keys(changes).length > 0) {
    await client.request(
      `/v1/appStoreVersionLocalizations/${resources.versionLocalization.id}`,
      {
        method: "PATCH",
        body: {
          data: {
            type: "appStoreVersionLocalizations",
            id: resources.versionLocalization.id,
            attributes: changes,
          },
        },
      },
    );
    actions.push(`Updated ${catalog.locale} App Store version metadata.`);
  }
}

async function ensureBetaAppLocalization(
  client,
  resources,
  catalog,
  actions,
) {
  const desired = desiredBetaAppAttributes(catalog);
  if (!resources.betaAppLocalization) {
    await client.request("/v1/betaAppLocalizations", {
      method: "POST",
      body: {
        data: {
          type: "betaAppLocalizations",
          attributes: {
            locale: catalog.locale,
            ...desired,
          },
          relationships: {
            app: relationship("apps", catalog.appId),
          },
        },
      },
    });
    actions.push(`Created ${catalog.locale} TestFlight app details.`);
    return;
  }
  const changes = changedAttributes(
    resources.betaAppLocalization.attributes,
    desired,
  );
  if (Object.keys(changes).length > 0) {
    await client.request(
      `/v1/betaAppLocalizations/${resources.betaAppLocalization.id}`,
      {
        method: "PATCH",
        body: {
          data: {
            type: "betaAppLocalizations",
            id: resources.betaAppLocalization.id,
            attributes: changes,
          },
        },
      },
    );
    actions.push(`Updated ${catalog.locale} TestFlight app details.`);
  }
}

async function ensureBetaGroup(client, resources, catalog, actions) {
  if (resources.betaGroup) {
    if (resources.betaGroup?.attributes?.isInternalGroup !== true) {
      throw new Error(
        `${catalog.beta.groupName} exists but is not an internal TestFlight group.`,
      );
    }
    return resources.betaGroup;
  }
  const response = await client.request("/v1/betaGroups", {
    method: "POST",
    body: {
      data: {
        type: "betaGroups",
        attributes: {
          name: catalog.beta.groupName,
          isInternalGroup: true,
          hasAccessToAllBuilds: false,
          feedbackEnabled: true,
        },
        relationships: {
          app: relationship("apps", catalog.appId),
        },
      },
    },
  });
  actions.push(`Created internal TestFlight group ${catalog.beta.groupName}.`);
  return response.data;
}

async function ensureBetaBuild(client, resources, catalog, actions) {
  if (!resources.build) {
    throw new Error(
      `TestFlight build ${catalog.beta.buildNumber} has not reached App Store Connect.`,
    );
  }
  if (resources.build?.attributes?.processingState !== "VALID") {
    throw new Error(
      `TestFlight build ${catalog.beta.buildNumber} is ` +
      `${resources.build?.attributes?.processingState || "not ready"}.`,
    );
  }
  if (resources.build?.attributes?.usesNonExemptEncryption !== false) {
    await client.request(`/v1/builds/${resources.build.id}`, {
      method: "PATCH",
      body: {
        data: {
          type: "builds",
          id: resources.build.id,
          attributes: {
            usesNonExemptEncryption: false,
          },
        },
      },
    });
    actions.push(`Recorded export-compliance exemption for build ${catalog.beta.buildNumber}.`);
  }
  return resources.build;
}

async function ensureBetaBuildLocalization(
  client,
  resources,
  build,
  catalog,
  actions,
) {
  if (!resources.betaBuildLocalization) {
    await client.request("/v1/betaBuildLocalizations", {
      method: "POST",
      body: {
        data: {
          type: "betaBuildLocalizations",
          attributes: {
            locale: catalog.locale,
            whatsNew: catalog.beta.whatsNew,
          },
          relationships: {
            build: relationship("builds", build.id),
          },
        },
      },
    });
    actions.push(`Added TestFlight test instructions to build ${catalog.beta.buildNumber}.`);
    return;
  }
  if (
    resources.betaBuildLocalization?.attributes?.whatsNew !==
    catalog.beta.whatsNew
  ) {
    await client.request(
      `/v1/betaBuildLocalizations/${resources.betaBuildLocalization.id}`,
      {
        method: "PATCH",
        body: {
          data: {
            type: "betaBuildLocalizations",
            id: resources.betaBuildLocalization.id,
            attributes: {
              whatsNew: catalog.beta.whatsNew,
            },
          },
        },
      },
    );
    actions.push(`Updated TestFlight test instructions for build ${catalog.beta.buildNumber}.`);
  }
}

export async function configureAppRelease(
  client,
  catalog = appReleaseCatalog,
) {
  const resources = await releaseResources(client, catalog);
  const actualBundleId = resources.app?.attributes?.bundleId || "";
  if (actualBundleId !== catalog.expectedBundleId) {
    throw new Error(
      `App ${catalog.appId} uses bundle ID ${actualBundleId}; ` +
      `expected ${catalog.expectedBundleId}.`,
    );
  }

  const actions = [];
  await ensureAppInfoLocalization(client, resources, catalog, actions);
  await ensureVersionLocalization(client, resources, catalog, actions);
  await ensureBetaAppLocalization(client, resources, catalog, actions);
  const build = await ensureBetaBuild(client, resources, catalog, actions);
  const group = await ensureBetaGroup(client, resources, catalog, actions);
  if (!resources.groupBuilds.some((candidate) => candidate.id === build.id)) {
    await client.request(
      `/v1/betaGroups/${group.id}/relationships/builds`,
      {
        method: "POST",
        body: {
          data: [{ type: "builds", id: build.id }],
        },
      },
    );
    actions.push(
      `Assigned build ${catalog.beta.buildNumber} to ${catalog.beta.groupName}.`,
    );
  }
  await ensureBetaBuildLocalization(
    client,
    resources,
    build,
    catalog,
    actions,
  );
  return {
    actions,
    status: await readAppReleaseStatus(client, catalog),
  };
}
