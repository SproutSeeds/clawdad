import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import appleStoreServerLibrary from "@apple/app-store-server-library";

const {
  Environment,
  OfferType,
  SignedDataVerifier,
} = appleStoreServerLibrary;

export const clawDadIOSBundleId = "earth.frg.clawdad.ios";
export const clawDadAppAppleId = 6783090068;
export const clawDadSubscriptionProductIds = new Set([
  "earth.frg.clawdad.pro.monthly",
  "earth.frg.clawdad.pro.annual",
]);

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const defaultAppleRootCertificatePaths = [
  path.resolve(moduleDirectory, "../vendor/apple-pki/AppleIncRootCertificate.cer"),
  path.resolve(moduleDirectory, "../vendor/apple-pki/AppleRootCA-G2.cer"),
  path.resolve(moduleDirectory, "../vendor/apple-pki/AppleRootCA-G3.cer"),
];

let rootCertificatePromise = null;
const verifierCache = new Map();

function appStoreEnvironment(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "production") {
    return Environment.PRODUCTION;
  }
  if (normalized === "sandbox") {
    return Environment.SANDBOX;
  }
  if (normalized === "xcode") {
    return Environment.XCODE;
  }
  throw new Error(`Unsupported StoreKit environment: ${value || "missing"}.`);
}

function isoDateFromMilliseconds(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return "";
  }
  return new Date(milliseconds).toISOString();
}

async function loadAppleRootCertificates(paths = defaultAppleRootCertificatePaths) {
  if (paths === defaultAppleRootCertificatePaths && rootCertificatePromise) {
    return rootCertificatePromise;
  }
  const load = Promise.all(paths.map((certificatePath) => readFile(certificatePath)));
  if (paths === defaultAppleRootCertificatePaths) {
    rootCertificatePromise = load;
  }
  return load;
}

async function verifierFor({
  environment,
  enableOnlineChecks,
  rootCertificatePaths,
}) {
  const cacheKey = [
    environment,
    enableOnlineChecks ? "online" : "offline",
    ...(rootCertificatePaths || defaultAppleRootCertificatePaths),
  ].join("|");
  if (verifierCache.has(cacheKey)) {
    return verifierCache.get(cacheKey);
  }
  const roots = await loadAppleRootCertificates(
    rootCertificatePaths || defaultAppleRootCertificatePaths,
  );
  const verifier = new SignedDataVerifier(
    roots,
    enableOnlineChecks,
    environment,
    clawDadIOSBundleId,
    environment === Environment.PRODUCTION ? clawDadAppAppleId : undefined,
  );
  verifierCache.set(cacheKey, verifier);
  return verifier;
}

export async function verifySignedClawDadTransaction({
  signedTransaction,
  expectedEnvironment,
  enableOnlineChecks = true,
  allowXcode = false,
  rootCertificatePaths,
  now = Date.now(),
}) {
  const jws = String(signedTransaction || "").trim();
  if (!jws || jws.length > 100_000 || jws.split(".").length !== 3) {
    throw new Error("A valid StoreKit signed transaction is required.");
  }

  const environment = appStoreEnvironment(expectedEnvironment);
  if (environment === Environment.XCODE && !allowXcode) {
    throw new Error("Xcode StoreKit transactions are disabled for this host.");
  }
  const verifier = await verifierFor({
    environment,
    enableOnlineChecks: environment === Environment.XCODE
      ? false
      : enableOnlineChecks,
    rootCertificatePaths,
  });
  const transaction = await verifier.verifyAndDecodeTransaction(jws);
  const productId = String(transaction.productId || "");
  const transactionId = String(transaction.transactionId || "");
  const originalTransactionId = String(transaction.originalTransactionId || "");
  const expirationMilliseconds = Number(transaction.expiresDate);
  const revocationMilliseconds = Number(transaction.revocationDate);
  const revoked = Number.isFinite(revocationMilliseconds) &&
    revocationMilliseconds > 0;
  const expired = !Number.isFinite(expirationMilliseconds) ||
    expirationMilliseconds <= now;

  if (!clawDadSubscriptionProductIds.has(productId)) {
    throw new Error(`StoreKit transaction uses unsupported product ${productId || "unknown"}.`);
  }
  if (!transactionId || !originalTransactionId) {
    throw new Error("StoreKit transaction is missing its transaction identity.");
  }

  return {
    active: !revoked && !expired && transaction.isUpgraded !== true,
    source: "storekit-2",
    productId,
    transactionId,
    originalTransactionId,
    purchasedAt: isoDateFromMilliseconds(transaction.purchaseDate),
    expiresAt: isoDateFromMilliseconds(transaction.expiresDate),
    revokedAt: isoDateFromMilliseconds(transaction.revocationDate),
    introductoryOffer:
      Number(transaction.offerType) === Number(OfferType.INTRODUCTORY_OFFER),
    environment: String(transaction.environment || ""),
    appAccountToken: String(transaction.appAccountToken || ""),
    signedAt: isoDateFromMilliseconds(transaction.signedDate),
    verification: "apple-storekit-jws",
  };
}
