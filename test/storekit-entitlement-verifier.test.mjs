import assert from "node:assert/strict";
import test from "node:test";
import {
  verifySignedClawDadTransaction,
} from "../lib/storekit-entitlement-verifier.mjs";

function unsignedXcodeJws(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "xcode",
  ].join(".");
}

test("StoreKit verifier derives entitlement only from the decoded signed payload", async () => {
  const now = Date.parse("2026-07-30T08:00:00.000Z");
  const result = await verifySignedClawDadTransaction({
    signedTransaction: unsignedXcodeJws({
      originalTransactionId: "original-1",
      transactionId: "transaction-1",
      bundleId: "earth.frg.clawdad.ios",
      productId: "earth.frg.clawdad.pro.monthly",
      purchaseDate: now - 60_000,
      expiresDate: now + 86_400_000,
      signedDate: now,
      offerType: 1,
      environment: "Xcode",
    }),
    expectedEnvironment: "Xcode",
    allowXcode: true,
    now,
  });

  assert.equal(result.active, true);
  assert.equal(result.productId, "earth.frg.clawdad.pro.monthly");
  assert.equal(result.transactionId, "transaction-1");
  assert.equal(result.introductoryOffer, true);
  assert.equal(result.verification, "apple-storekit-jws");
});

test("StoreKit verifier rejects unsupported products and disabled Xcode proof", async () => {
  const signedTransaction = unsignedXcodeJws({
    originalTransactionId: "original-1",
    transactionId: "transaction-1",
    bundleId: "earth.frg.clawdad.ios",
    productId: "earth.frg.another.product",
    purchaseDate: Date.now(),
    expiresDate: Date.now() + 86_400_000,
    signedDate: Date.now(),
    environment: "Xcode",
  });

  await assert.rejects(
    verifySignedClawDadTransaction({
      signedTransaction,
      expectedEnvironment: "Xcode",
    }),
    /Xcode StoreKit transactions are disabled/iu,
  );
  await assert.rejects(
    verifySignedClawDadTransaction({
      signedTransaction,
      expectedEnvironment: "Xcode",
      allowXcode: true,
    }),
    /unsupported product/iu,
  );
});
