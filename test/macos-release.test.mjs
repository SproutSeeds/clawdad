import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const releaseScriptPath = path.join(
  repoRoot,
  "native",
  "macos",
  "package-release.sh",
);
const buildScriptPath = path.join(
  repoRoot,
  "native",
  "macos",
  "build-app.sh",
);
const entitlementsPath = path.join(
  repoRoot,
  "native",
  "macos",
  "ClawDad.entitlements",
);
const nodeEntitlementsPath = path.join(
  repoRoot,
  "native",
  "macos",
  "ClawDadNode.entitlements",
);
const intelNodeEntitlementsPath = path.join(
  repoRoot,
  "native",
  "macos",
  "ClawDadNodeIntel.entitlements",
);
const releaseNotesPath = path.join(
  repoRoot,
  "docs",
  "releases",
  "0.7.0-beta.13.md",
);
const packagePath = path.join(repoRoot, "package.json");

test("Mac release pipeline signs, notarizes, staples, and publishes Sparkle artifacts", async () => {
  const [
    releaseScript,
    buildScript,
    entitlements,
    nodeEntitlements,
    intelNodeEntitlements,
    releaseNotes,
    packageSource,
  ] = await Promise.all([
    readFile(releaseScriptPath, "utf8"),
    readFile(buildScriptPath, "utf8"),
    readFile(entitlementsPath, "utf8"),
    readFile(nodeEntitlementsPath, "utf8"),
    readFile(intelNodeEntitlementsPath, "utf8"),
    readFile(releaseNotesPath, "utf8"),
    readFile(packagePath, "utf8"),
  ]);

  assert.match(packageSource, /"version": "0\.7\.0-beta\.13"/u);
  assert.match(releaseNotes, /ClawDad 0\.7 Native Beta/u);
  assert.match(releaseScript, /CLAWDAD_APP_BUILD:-35/u);
  assert.match(releaseScript, /CLAWDAD_RELEASE_ARTIFACT_SUFFIX/u);
  assert.match(releaseScript, /CLAWDAD_MAC_ARCH="\$mac_arch"/u);
  assert.match(releaseScript, /Developer ID Application/u);
  assert.match(releaseScript, /notarytool submit "\$zip_path"/u);
  assert.match(releaseScript, /CLAWDAD_NOTARY_KEY_PATH/u);
  assert.match(releaseScript, /CLAWDAD_NOTARY_KEY_ID/u);
  assert.match(releaseScript, /CLAWDAD_NOTARY_ISSUER_ID/u);
  assert.match(buildScript, /CLAWDAD_SWIFT_DISABLE_SANDBOX/u);
  assert.match(buildScript, /CLAWDAD_PREBUILT_ICON_PATH/u);
  assert.match(buildScript, /CLAWDAD_MAC_ARCH/u);
  assert.match(buildScript, /CLAWDAD_BUNDLED_NODE_VERSION:-24\.20\.0/u);
  assert.match(buildScript, /SHASUMS256/u);
  assert.match(buildScript, /runtime_dir\/bin\/node/u);
  assert.match(buildScript, /node_modules\/open-research-protocol\/package\.json/u);
  assert.match(buildScript, /ClawDadNode\.entitlements/u);
  assert.match(buildScript, /ClawDadNodeIntel\.entitlements/u);
  assert.match(buildScript, /https:\/\/clawdad\.earth\/downloads\/appcast-intel\.xml/u);
  assert.match(nodeEntitlements, /<key>com\.apple\.security\.cs\.allow-jit<\/key>/u);
  assert.match(intelNodeEntitlements, /<key>com\.apple\.security\.cs\.allow-jit<\/key>/u);
  assert.match(
    intelNodeEntitlements,
    /<key>com\.apple\.security\.cs\.allow-unsigned-executable-memory<\/key>/u,
  );
  assert.match(buildScript, /clawdad-managed-node-ok/u);
  assert.match(buildScript, /--arch "\$target_arch"/u);
  assert.match(buildScript, /lipo -thin "\$target_arch"/u);
  assert.match(buildScript, /<key>NSAppleEventsUsageDescription<\/key>/u);
  assert.match(buildScript, /entitlements_path="\$script_dir\/ClawDad\.entitlements"/u);
  assert.match(buildScript, /--entitlements "\$entitlements_path"/u);
  assert.match(entitlements, /<key>com\.apple\.security\.automation\.apple-events<\/key>/u);
  assert.match(entitlements, /<true\/>/u);
  assert.match(releaseScript, /stapler staple "\$app_dir"/u);
  assert.match(releaseScript, /generate_appcast/u);
  assert.match(releaseScript, /--account "\$sparkle_account"/u);
  assert.match(releaseScript, /notarytool submit "\$dmg_path"/u);
  assert.match(releaseScript, /-imagekey zlib-level=9/u);
  assert.match(releaseScript, /stapler staple "\$dmg_path"/u);
  assert.match(releaseScript, /spctl --assess/u);
  assert.match(releaseScript, /SHA256SUMS/u);
  assert.match(releaseScript, /CLAWDAD_RELEASE_TOKEN/u);
  assert.match(releaseScript, /\/admin\/mac\/appcast/u);
});
