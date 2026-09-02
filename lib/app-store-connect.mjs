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
      "ClawDad requires the ClawDad Mac app and separate OpenAI access. The Mac setup assistant can install the official Codex CLI and guide ChatGPT sign-in when that computer will run Codex.",
    ].join("\n"),
    keywords: "codex,developer,remote,terminal,projects,AI,automation,voice,desktop,threads",
    marketingUrl: "https://clawdad-cloud.frg.earth/",
    promotionalText: "Keep Codex projects moving from iPhone with secure pairing, persistent threads, voice, images, Direct and Queue messaging, and opt-in Remote Assist.",
    supportUrl: "https://clawdad-cloud.frg.earth/support",
  }),
  beta: Object.freeze({
    internalGroupName: "ClawDad Internal",
    externalGroupName: "ClawDad Founding Customers",
    buildNumber: "33",
    feedbackEmail: "cody@frg.earth",
    description: "ClawDad pairs an iPhone with the customer's Mac so they can continue existing Codex projects and use opt-in Remote Assist.",
    whatsNew: [
      "Build 33 multi-computer setup:",
      "• Choose the Mac you want from the computer menu above the project selector.",
      "• Each Mac restores its own project, Codex thread, model, and reasoning setting.",
      "• New directories, messages, history, Read Aloud, and Remote Assist all follow the selected Mac.",
      "• Switching computers clears the old live history before loading the selected host.",
      "• The matching Mac beta 13 setup assistant includes managed Node and ORP, official Codex installation, ChatGPT sign-in, project-home selection, and pairing guidance.",
      "",
      "Test build 33:",
      "• Pair the iPhone with two Macs running beta 13 build 35.",
      "• Choose Mac A, select a project and thread, then switch to Mac B and choose a different project and thread.",
      "• Switch back to Mac A and confirm its selection returns before sending a Direct or Queue message.",
      "• Create a directory, dictate a prompt, attach an image, and play Read Aloud on the selected host.",
      "• Open Remote Assist and confirm it connects to the Mac shown in the computer selector.",
      "• Switch displays and Terminal tabs, then test landscape, keyboard, CMD+T, Enter, and clipboard in both directions.",
      "Report issues from https://clawdad-cloud.frg.earth/support.",
    ].join("\n"),
    review: Object.freeze({
      contactFirstName: "Cody",
      contactLastName: "Mitchell",
      contactEmail: "cody@frg.earth",
      demoAccountRequired: false,
      notes: [
        "ClawDad Mobile continues Codex projects running on a paired Mac.",
        "Install the ClawDad Mac app from the signed paid-beta release, open Settings, and use Pair iPhone to generate a fresh QR code.",
        "After pairing, choose a project and Codex thread, then send a Direct message. Queue waits for the active turn to finish. Remote Assist is optional and requires explicit Screen Recording and Accessibility grants on the Mac.",
        "OpenAI Codex must be installed and signed in separately on the paired Mac. ClawDad does not include OpenAI access.",
        "Support: https://clawdad-cloud.frg.earth/support",
      ].join("\n\n"),
    }),
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

export async function uploadAppStoreScreenshot(
  client,
  screenshotSetId,
  {
    fileName,
    contents,
    fetchImpl = globalThis.fetch,
    pollAttempts = 20,
    pollDelayMilliseconds = 1_000,
  },
) {
  if (
    !screenshotSetId ||
    !fileName ||
    !Buffer.isBuffer(contents) ||
    contents.length === 0
  ) {
    throw new Error(
      "A screenshot set, file name, and nonempty screenshot are required.",
    );
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for screenshot upload.");
  }
  const checksum = createHash("md5").update(contents).digest("hex");
  const reservation = await client.request("/v1/appScreenshots", {
    method: "POST",
    body: {
      data: {
        type: "appScreenshots",
        attributes: {
          fileName,
          fileSize: contents.length,
        },
        relationships: {
          appScreenshotSet: relationship(
            "appScreenshotSets",
            screenshotSetId,
          ),
        },
      },
    },
  });
  const resource = reservation?.data;
  if (!resource?.id) {
    throw new Error(
      "App Store Connect did not create an app screenshot upload reservation.",
    );
  }
  const uploadOperations = resource?.attributes?.uploadOperations || [];
  if (uploadOperations.length === 0) {
    throw new Error(
      "App Store Connect did not provide app screenshot upload operations.",
    );
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
        `App Store Connect app screenshot upload returned ${response.status}.`,
      );
    }
  }

  let current = await client.request(`/v1/appScreenshots/${resource.id}`, {
    method: "PATCH",
    body: {
      data: {
        type: "appScreenshots",
        id: resource.id,
        attributes: {
          uploaded: true,
          sourceFileChecksum: checksum,
        },
      },
    },
  });
  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    const state = current?.data?.attributes?.assetDeliveryState;
    if (state?.state === "COMPLETE") {
      return {
        id: resource.id,
        fileName,
        checksum,
        state: state.state,
      };
    }
    if (state?.state === "FAILED") {
      throw new Error(
        `App Store Connect rejected the app screenshot: ` +
        mediaStateDescription(state),
      );
    }
    if (attempt + 1 < pollAttempts) {
      await sleep(pollDelayMilliseconds);
      current = await client.request(`/v1/appScreenshots/${resource.id}`);
    }
  }
  const finalState = current?.data?.attributes?.assetDeliveryState;
  throw new Error(
    `App screenshot did not finish processing: ` +
    mediaStateDescription(finalState),
  );
}

function relationId(resource, name) {
  return resource?.relationships?.[name]?.data?.id || "";
}

function samePrice(left, right) {
  return Math.abs(Number(left) - Number(right)) < 0.001;
}

function summarizeReviewVersion(version) {
  if (!version) {
    return null;
  }
  return {
    id: version.id,
    version: version?.attributes?.version ?? null,
    state: version?.attributes?.state || "UNKNOWN",
  };
}

function latestReviewVersion(versions) {
  return [...versions].sort((left, right) => (
    Number(left?.attributes?.version || 0) -
    Number(right?.attributes?.version || 0)
  )).at(-1) || null;
}

export function paidBetaProductMissingMetadata({
  desired,
  subscription,
  localization,
  availableTerritoryIds = [],
  prices = [],
  offers = [],
  screenshotState = "",
}) {
  const missing = [];
  const attributes = subscription?.attributes || {};
  if (attributes.name !== desired.referenceName) {
    missing.push("reference name");
  }
  if (attributes.subscriptionPeriod !== desired.period) {
    missing.push("subscription duration");
  }
  if (attributes.groupLevel !== desired.groupLevel) {
    missing.push("subscription level");
  }
  if (
    String(attributes.reviewNote || "").trim() !==
    "ClawDad connects an iPhone to the customer's paired ClawDad Mac app."
  ) {
    missing.push("review note");
  }
  if (
    localization?.attributes?.locale !== desired.locale ||
    localization?.attributes?.name !== desired.displayName ||
    localization?.attributes?.description !== desired.description
  ) {
    missing.push(`${desired.locale} localization`);
  }
  for (const territory of paidBetaCatalog.territories) {
    if (!availableTerritoryIds.includes(territory)) {
      missing.push(`${territory} availability`);
    }
  }
  if (prices.length === 0) {
    missing.push("subscription price");
  }
  const trial = paidBetaCatalog.introductoryOffer;
  if (!offers.some((offer) => (
    offer?.attributes?.duration === trial.duration &&
    offer?.attributes?.offerMode === trial.offerMode &&
    offer?.attributes?.numberOfPeriods === trial.numberOfPeriods
  ))) {
    missing.push("14-day introductory trial");
  }
  if (screenshotState !== "COMPLETE") {
    missing.push("review screenshot");
  }
  return missing;
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
  const groupLocalizations = group
    ? await client.list(
      `/v1/subscriptionGroups/${group.id}/subscriptionGroupLocalizations?limit=200`,
    )
    : [];
  const groupLocalization = groupLocalizations.find(
    (candidate) => candidate?.attributes?.locale === catalog.group.locale,
  );
  const groupVersions = group
    ? await client.list(
      `/v1/subscriptionGroups/${group.id}/versions?limit=200`,
    )
    : [];
  const latestGroupVersion = latestReviewVersion(groupVersions);
  const groupVersionLocalizations = latestGroupVersion
    ? await client.list(
      `/v1/subscriptionGroupVersions/${latestGroupVersion.id}` +
      "/localizations?limit=200",
    )
    : [];
  const groupVersionLocalization = groupVersionLocalizations.find(
    (candidate) => candidate?.attributes?.locale === catalog.group.locale,
  );
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
      const localizations = await client.list(
        `/v1/subscriptions/${subscription.id}/subscriptionLocalizations?limit=200`,
      );
      const localization = localizations.find(
        (candidate) => candidate?.attributes?.locale === desired.locale,
      );
      const availability = await client.request(
        `/v1/subscriptions/${subscription.id}/subscriptionAvailability`,
        { allowNotFound: true },
      );
      const availableTerritories = availability?.data?.id
        ? await client.list(
          `/v1/subscriptionAvailabilities/${availability.data.id}` +
          "/relationships/availableTerritories?limit=200",
        )
        : [];
      const screenshot = await client.request(
        `/v1/subscriptions/${subscription.id}/appStoreReviewScreenshot`,
        { allowNotFound: true },
      );
      const versions = await client.list(
        `/v1/subscriptions/${subscription.id}/versions?limit=200`,
      );
      const latestVersion = latestReviewVersion(versions);
      const versionLocalizations = latestVersion
        ? await client.list(
          `/v1/subscriptionVersions/${latestVersion.id}` +
          "/localizations?limit=200",
        )
        : [];
      const versionLocalization = versionLocalizations.find(
        (candidate) => candidate?.attributes?.locale === desired.locale,
      );
      const reviewScreenshotState =
        screenshot?.data?.attributes?.assetDeliveryState?.state || "MISSING";
      const missingMetadata = paidBetaProductMissingMetadata({
        desired,
        subscription,
        localization,
        availableTerritoryIds: availableTerritories.map((resource) => resource.id),
        prices,
        offers,
        screenshotState: reviewScreenshotState,
      });
      products.push({
        id: subscription.id,
        productId: desired.productId,
        configured: missingMetadata.length === 0,
        state: latestVersion?.attributes?.state || "MISSING_DRAFT_VERSION",
        legacyParentState: subscription?.attributes?.state || "UNKNOWN",
        subscriptionPeriod: subscription?.attributes?.subscriptionPeriod || desired.period,
        localizationConfigured: Boolean(localization),
        availableTerritories: availableTerritories.map((resource) => resource.id),
        priceCount: prices.length,
        introductoryOfferCount: offers.length,
        reviewScreenshotState,
        missingMetadata,
        reviewWorkflow: {
          versionCount: versions.length,
          latestVersion: latestVersion
            ? {
              ...summarizeReviewVersion(latestVersion),
              localizationConfigured: Boolean(
                versionLocalization &&
                versionLocalization?.attributes?.name === desired.displayName &&
                versionLocalization?.attributes?.description === desired.description
              ),
            }
            : null,
        },
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
  const metadataConfigured = Boolean(
    groupLocalization?.attributes?.name === catalog.group.name &&
    products.every((product) => product.configured)
  );
  const draftVersionsPrepared = Boolean(
    latestGroupVersion &&
    groupVersionLocalization &&
    products.every((product) => (
      product.reviewWorkflow?.latestVersion?.localizationConfigured
    ))
  );
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
        localizationConfigured:
          groupLocalization?.attributes?.name === catalog.group.name,
        legacyLocalizationState:
          groupLocalization?.attributes?.state || "UNKNOWN",
        state:
          latestGroupVersion?.attributes?.state || "MISSING_DRAFT_VERSION",
        reviewWorkflow: {
          versionCount: groupVersions.length,
          latestVersion: latestGroupVersion
            ? {
              ...summarizeReviewVersion(latestGroupVersion),
              localizationConfigured: Boolean(
                groupVersionLocalization &&
                groupVersionLocalization?.attributes?.name === catalog.group.name
              ),
            }
            : null,
        },
      }
      : null,
    territories: [...catalog.territories],
    products,
    reviewWorkflow: {
      authoritativeStateSource: "draftVersions",
      metadataConfigured,
      draftVersionsPrepared,
      nextAction: !metadataConfigured
        ? "COMPLETE_SUBSCRIPTION_METADATA"
        : !draftVersionsPrepared
          ? "PREPARE_SUBSCRIPTION_REVIEW_VERSIONS"
          : "ATTACH_APP_AND_SUBSCRIPTION_VERSIONS_TO_REVIEW_SUBMISSION",
    },
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

function desiredBetaReviewAttributes(catalog) {
  return { ...catalog.beta.review };
}

function externalBetaNextAction({
  reviewState,
  missingContactFields,
  metadataReady,
  buildAssigned,
}) {
  if (reviewState === "APPROVED") {
    return "Invite founding customers to the approved external TestFlight group.";
  }
  if (reviewState === "REJECTED") {
    return "Resolve the Beta App Review finding and upload a new build if Apple requires one.";
  }
  if (reviewState === "WAITING_FOR_REVIEW" || reviewState === "IN_REVIEW") {
    return "Wait for Apple Beta App Review to finish.";
  }
  if (missingContactFields.length > 0) {
    const labels = {
      contactFirstName: "first name",
      contactLastName: "last name",
      contactPhone: "phone",
      contactEmail: "email",
    };
    return `Add Beta App Review contact details: ${
      missingContactFields.map((field) => labels[field] || field).join(", ")
    }.`;
  }
  if (!metadataReady) {
    return "Complete the external TestFlight metadata and build requirements.";
  }
  if (!buildAssigned) {
    return "After physical certification, assign the build and submit it for Beta App Review.";
  }
  return "Submit the build for Beta App Review.";
}

export function appReleasePlan(catalog = appReleaseCatalog) {
  return {
    appId: catalog.appId,
    expectedBundleId: catalog.expectedBundleId,
    locale: catalog.locale,
    appName: catalog.appInfo.name,
    subtitle: catalog.appInfo.subtitle,
    versionString: catalog.version.versionString,
    internalBetaGroup: catalog.beta.internalGroupName,
    externalBetaGroup: catalog.beta.externalGroupName,
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
  const internalBetaGroup = groups.find(
    (candidate) => (
      candidate?.attributes?.name === catalog.beta.internalGroupName
    ),
  ) || null;
  const externalBetaGroup = groups.find(
    (candidate) => (
      candidate?.attributes?.name === catalog.beta.externalGroupName
    ),
  ) || null;
  const internalGroupBuilds = internalBetaGroup
    ? await client.list(
      `/v1/betaGroups/${internalBetaGroup.id}/relationships/builds?limit=200`,
    )
    : [];
  const externalGroupBuilds = externalBetaGroup
    ? await client.list(
      `/v1/betaGroups/${externalBetaGroup.id}/relationships/builds?limit=200`,
    )
    : [];
  const betaReviewDetails = await client.list(
    `/v1/betaAppReviewDetails?filter%5Bapp%5D=${encodeURIComponent(catalog.appId)}` +
    "&limit=20",
  );
  const betaReviewDetail = betaReviewDetails[0] || null;
  const betaReviewSubmissions = build
    ? await client.list(
      `/v1/betaAppReviewSubmissions?filter%5Bbuild%5D=${encodeURIComponent(build.id)}` +
      "&limit=20",
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
    internalBetaGroup,
    externalBetaGroup,
    internalGroupBuilds,
    externalGroupBuilds,
    betaReviewDetail,
    betaReviewSubmissions,
    screenshotSets,
    reviewDetail: reviewDetail?.data || null,
  };
}

export async function configureAppStoreScreenshots(
  client,
  {
    catalog = appReleaseCatalog,
    displayType = "APP_IPHONE_67",
    screenshots,
    replaceExisting = false,
    fetchImpl = globalThis.fetch,
    pollAttempts = 20,
    pollDelayMilliseconds = 1_000,
  },
) {
  if (
    !Array.isArray(screenshots) ||
    screenshots.length === 0 ||
    screenshots.length > 10
  ) {
    throw new Error("Provide between one and ten App Store screenshots.");
  }
  const desired = screenshots.map((screenshot) => {
    if (
      !screenshot?.fileName ||
      !Buffer.isBuffer(screenshot?.contents) ||
      screenshot.contents.length === 0
    ) {
      throw new Error(
        "Every App Store screenshot needs a file name and nonempty contents.",
      );
    }
    return {
      ...screenshot,
      checksum: createHash("md5").update(screenshot.contents).digest("hex"),
    };
  });
  if (
    new Set(desired.map((screenshot) => screenshot.fileName)).size !==
    desired.length
  ) {
    throw new Error("App Store screenshot file names must be unique.");
  }

  const resources = await releaseResources(client, catalog);
  if (!resources.versionLocalization?.id) {
    throw new Error(
      `App Store version ${catalog.version.versionString} ` +
      `${catalog.locale} localization is missing.`,
    );
  }
  let screenshotSet = resources.screenshotSets.find(
    (candidate) => (
      candidate?.attributes?.screenshotDisplayType === displayType
    ),
  ) || null;
  const existing = screenshotSet
    ? await client.list(
      `/v1/appScreenshotSets/${screenshotSet.id}/appScreenshots?limit=50`,
    )
    : [];
  const existingComplete = existing.every((screenshot) => (
    ["UPLOAD_COMPLETE", "COMPLETE"].includes(
      screenshot?.attributes?.assetDeliveryState?.state,
    )
  ));
  const matches = (
    existing.length === desired.length &&
    existingComplete &&
    existing.every((screenshot, index) => (
      screenshot?.attributes?.sourceFileChecksum === desired[index].checksum
    ))
  );
  if (matches) {
    return {
      actions: [],
      displayType,
      screenshots: existing.map((screenshot) => ({
        id: screenshot.id,
        fileName: screenshot?.attributes?.fileName || "",
        checksum: screenshot?.attributes?.sourceFileChecksum || "",
        state: screenshot?.attributes?.assetDeliveryState?.state || "",
      })),
      status: await readAppReleaseStatus(client, catalog),
    };
  }
  if (existing.length > 0 && !replaceExisting) {
    throw new Error(
      `${displayType} already contains different screenshots. ` +
      "Review them and explicitly allow replacement.",
    );
  }
  const actions = [];
  if (screenshotSet && existing.length > 0) {
    await client.request(`/v1/appScreenshotSets/${screenshotSet.id}`, {
      method: "DELETE",
    });
    actions.push(`Removed the previous ${displayType} screenshot set.`);
    screenshotSet = null;
  }
  if (!screenshotSet) {
    const created = await client.request("/v1/appScreenshotSets", {
      method: "POST",
      body: {
        data: {
          type: "appScreenshotSets",
          attributes: {
            screenshotDisplayType: displayType,
          },
          relationships: {
            appStoreVersionLocalization: relationship(
              "appStoreVersionLocalizations",
              resources.versionLocalization.id,
            ),
          },
        },
      },
    });
    screenshotSet = created?.data || null;
    if (!screenshotSet?.id) {
      throw new Error(
        "App Store Connect did not create an app screenshot set.",
      );
    }
    actions.push(`Created the ${displayType} screenshot set.`);
  }

  const uploaded = [];
  for (const screenshot of desired) {
    uploaded.push(await uploadAppStoreScreenshot(
      client,
      screenshotSet.id,
      {
        fileName: screenshot.fileName,
        contents: screenshot.contents,
        fetchImpl,
        pollAttempts,
        pollDelayMilliseconds,
      },
    ));
  }
  await client.request(
    `/v1/appScreenshotSets/${screenshotSet.id}/relationships/appScreenshots`,
    {
      method: "PATCH",
      body: {
        data: uploaded.map((screenshot) => ({
          type: "appScreenshots",
          id: screenshot.id,
        })),
      },
    },
  );
  actions.push(
    `Uploaded ${uploaded.length} ordered ${displayType} screenshots.`,
  );
  return {
    actions,
    displayType,
    screenshots: uploaded,
    status: await readAppReleaseStatus(client, catalog),
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
  const betaReviewDesired = desiredBetaReviewAttributes(catalog);
  const internalBuildAssigned = Boolean(
    resources.build &&
    resources.internalGroupBuilds.some(
      (candidate) => candidate.id === resources.build.id,
    ),
  );
  const externalBuildAssigned = Boolean(
    resources.build &&
    resources.externalGroupBuilds.some(
      (candidate) => candidate.id === resources.build.id,
    ),
  );
  const missingBetaReviewContactFields = [
    "contactFirstName",
    "contactLastName",
    "contactPhone",
    "contactEmail",
  ].filter(
    (field) => !String(
      resources.betaReviewDetail?.attributes?.[field] || "",
    ).trim(),
  );
  const latestBetaReviewSubmission = [...resources.betaReviewSubmissions]
    .sort((left, right) => String(
      right?.attributes?.submittedDate || "",
    ).localeCompare(String(left?.attributes?.submittedDate || "")))[0] || null;
  const externalGroupConfigured = Boolean(
    resources.externalBetaGroup &&
    resources.externalBetaGroup?.attributes?.isInternalGroup === false &&
    resources.externalBetaGroup?.attributes?.publicLinkEnabled !== true &&
    resources.externalBetaGroup?.attributes?.hasAccessToAllBuilds !== true &&
    resources.externalBetaGroup?.attributes?.feedbackEnabled === true,
  );
  const betaReviewMetadataConfigured = attributesMatch(
    resources.betaReviewDetail?.attributes,
    betaReviewDesired,
  );
  const externalMetadataReady = Boolean(
    externalGroupConfigured &&
    resources.build?.attributes?.processingState === "VALID" &&
    attributesMatch(
      resources.betaAppLocalization?.attributes,
      betaAppDesired,
    ) &&
    resources.betaBuildLocalization?.attributes?.whatsNew ===
      catalog.beta.whatsNew &&
    betaReviewMetadataConfigured &&
    missingBetaReviewContactFields.length === 0,
  );
  const betaReviewState =
    latestBetaReviewSubmission?.attributes?.betaReviewState ||
    "NOT_SUBMITTED";

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
      groupId: resources.internalBetaGroup?.id || "",
      groupName: resources.internalBetaGroup?.attributes?.name || "",
      buildId: resources.build?.id || "",
      buildNumber: resources.build?.attributes?.version || "",
      processingState: resources.build?.attributes?.processingState || "MISSING",
      usesNonExemptEncryption:
        resources.build?.attributes?.usesNonExemptEncryption ?? null,
      assignedToGroup: internalBuildAssigned,
      appLocalizationConfigured: attributesMatch(
        resources.betaAppLocalization?.attributes,
        betaAppDesired,
      ),
      buildLocalizationConfigured:
        resources.betaBuildLocalization?.attributes?.whatsNew ===
        catalog.beta.whatsNew,
      externalTesting: {
        groupId: resources.externalBetaGroup?.id || "",
        groupName: resources.externalBetaGroup?.attributes?.name || "",
        groupConfigured: externalGroupConfigured,
        publicLinkEnabled:
          resources.externalBetaGroup?.attributes?.publicLinkEnabled === true,
        buildAssigned: externalBuildAssigned,
        reviewDetailId: resources.betaReviewDetail?.id || "",
        reviewMetadataConfigured: betaReviewMetadataConfigured,
        missingContactFields: missingBetaReviewContactFields,
        submissionId: latestBetaReviewSubmission?.id || "",
        reviewState: betaReviewState,
        submittedDate:
          latestBetaReviewSubmission?.attributes?.submittedDate || "",
        metadataReady: externalMetadataReady,
        readyForReviewSubmission: Boolean(
          externalMetadataReady &&
          externalBuildAssigned &&
          !latestBetaReviewSubmission,
        ),
        nextAction: externalBetaNextAction({
          reviewState: betaReviewState,
          missingContactFields: missingBetaReviewContactFields,
          metadataReady: externalMetadataReady,
          buildAssigned: externalBuildAssigned,
        }),
      },
    },
    remainingHumanGates: [
      ...(resources.screenshotSets.length === 0
        ? ["App Store screenshots and representative visual review"]
        : []),
      "App privacy questionnaire confirmation",
      "Beta App Review phone number and reviewer pairing instructions",
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

async function ensureInternalBetaGroup(client, resources, catalog, actions) {
  if (resources.internalBetaGroup) {
    if (resources.internalBetaGroup?.attributes?.isInternalGroup !== true) {
      throw new Error(
        `${catalog.beta.internalGroupName} exists but is not an internal TestFlight group.`,
      );
    }
    return resources.internalBetaGroup;
  }
  const response = await client.request("/v1/betaGroups", {
    method: "POST",
    body: {
      data: {
        type: "betaGroups",
        attributes: {
          name: catalog.beta.internalGroupName,
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
  actions.push(
    `Created internal TestFlight group ${catalog.beta.internalGroupName}.`,
  );
  return response.data;
}

async function ensureExternalBetaGroup(client, resources, catalog, actions) {
  const desired = {
    publicLinkEnabled: false,
    feedbackEnabled: true,
  };
  if (resources.externalBetaGroup) {
    if (resources.externalBetaGroup?.attributes?.isInternalGroup !== false) {
      throw new Error(
        `${catalog.beta.externalGroupName} exists but is not an external TestFlight group.`,
      );
    }
    if (resources.externalBetaGroup?.attributes?.hasAccessToAllBuilds === true) {
      throw new Error(
        `${catalog.beta.externalGroupName} grants access to all builds; disable that setting before continuing.`,
      );
    }
    const changes = changedAttributes(
      resources.externalBetaGroup.attributes,
      desired,
    );
    if (Object.keys(changes).length > 0) {
      await client.request(
        `/v1/betaGroups/${resources.externalBetaGroup.id}`,
        {
          method: "PATCH",
          body: {
            data: {
              type: "betaGroups",
              id: resources.externalBetaGroup.id,
              attributes: changes,
            },
          },
        },
      );
      actions.push(
        `Kept ${catalog.beta.externalGroupName} private with tester feedback enabled.`,
      );
    }
    return resources.externalBetaGroup;
  }
  const response = await client.request("/v1/betaGroups", {
    method: "POST",
    body: {
      data: {
        type: "betaGroups",
        attributes: {
          name: catalog.beta.externalGroupName,
          isInternalGroup: false,
          hasAccessToAllBuilds: false,
          publicLinkEnabled: false,
          feedbackEnabled: true,
        },
        relationships: {
          app: relationship("apps", catalog.appId),
        },
      },
    },
  });
  actions.push(
    `Created private external TestFlight group ${catalog.beta.externalGroupName}.`,
  );
  return response.data;
}

async function ensureBetaReviewDetail(client, resources, catalog, actions) {
  if (!resources.betaReviewDetail) {
    throw new Error(
      "App Store Connect does not expose Beta App Review details for this app.",
    );
  }
  const desired = desiredBetaReviewAttributes(catalog);
  const contactFields = [
    "contactFirstName",
    "contactLastName",
    "contactPhone",
    "contactEmail",
  ];
  const merged = {
    ...resources.betaReviewDetail.attributes,
    ...desired,
  };
  const missingContactFields = contactFields.filter(
    (field) => !String(merged[field] || "").trim(),
  );
  if (missingContactFields.length > 0) {
    return;
  }
  const changes = changedAttributes(
    resources.betaReviewDetail.attributes,
    desired,
  );
  if (Object.keys(changes).length === 0) {
    return;
  }
  await client.request(
    `/v1/betaAppReviewDetails/${resources.betaReviewDetail.id}`,
    {
      method: "PATCH",
      body: {
        data: {
          type: "betaAppReviewDetails",
          id: resources.betaReviewDetail.id,
          attributes: {
            ...changes,
            ...Object.fromEntries(
              contactFields.map((field) => [field, merged[field]]),
            ),
          },
        },
      },
    },
  );
  actions.push("Updated Beta App Review contact and reviewer instructions.");
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
  const internalGroup = await ensureInternalBetaGroup(
    client,
    resources,
    catalog,
    actions,
  );
  await ensureExternalBetaGroup(client, resources, catalog, actions);
  await ensureBetaReviewDetail(client, resources, catalog, actions);
  if (
    !resources.internalGroupBuilds.some(
      (candidate) => candidate.id === build.id,
    )
  ) {
    await client.request(
      `/v1/betaGroups/${internalGroup.id}/relationships/builds`,
      {
        method: "POST",
        body: {
          data: [{ type: "builds", id: build.id }],
        },
      },
    );
    actions.push(
      `Assigned build ${catalog.beta.buildNumber} to ${catalog.beta.internalGroupName}.`,
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

export async function submitExternalBetaReview(
  client,
  catalog = appReleaseCatalog,
  { physicalCertificationConfirmed = false } = {},
) {
  if (!physicalCertificationConfirmed) {
    throw new Error(
      "External TestFlight submission requires explicit physical-device certification confirmation.",
    );
  }
  const initialStatus = await readAppReleaseStatus(client, catalog);
  if (initialStatus.beta.externalTesting.submissionId) {
    return { actions: [], status: initialStatus };
  }
  if (!initialStatus.beta.externalTesting.metadataReady) {
    throw new Error(
      `External TestFlight metadata is not ready: ${
        initialStatus.beta.externalTesting.nextAction
      }`,
    );
  }

  const resources = await releaseResources(client, catalog);
  if (!resources.externalBetaGroup || !resources.build) {
    throw new Error("External TestFlight group or build is missing.");
  }

  const actions = [];
  if (!initialStatus.beta.externalTesting.buildAssigned) {
    await client.request(
      `/v1/betaGroups/${resources.externalBetaGroup.id}/relationships/builds`,
      {
        method: "POST",
        body: {
          data: [{ type: "builds", id: resources.build.id }],
        },
      },
    );
    actions.push(
      `Assigned build ${catalog.beta.buildNumber} to ${catalog.beta.externalGroupName}.`,
    );
  }

  const assignedStatus = await readAppReleaseStatus(client, catalog);
  if (!assignedStatus.beta.externalTesting.submissionId) {
    try {
      await client.request("/v1/betaAppReviewSubmissions", {
        method: "POST",
        body: {
          data: {
            type: "betaAppReviewSubmissions",
            relationships: {
              build: relationship("builds", resources.build.id),
            },
          },
        },
      });
      actions.push(
        `Submitted build ${catalog.beta.buildNumber} for Beta App Review.`,
      );
    } catch (error) {
      if (error?.status !== 409) {
        throw error;
      }
      const retryStatus = await readAppReleaseStatus(client, catalog);
      if (!retryStatus.beta.externalTesting.submissionId) {
        throw error;
      }
    }
  }

  return {
    actions,
    status: await readAppReleaseStatus(client, catalog),
  };
}
