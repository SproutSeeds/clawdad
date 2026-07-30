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
const releaseNotesPath = path.join(
  repoRoot,
  "docs",
  "releases",
  "0.7.0-beta.3.md",
);
const packagePath = path.join(repoRoot, "package.json");

test("Mac release pipeline signs, notarizes, staples, and publishes Sparkle artifacts", async () => {
  const [releaseScript, releaseNotes, packageSource] = await Promise.all([
    readFile(releaseScriptPath, "utf8"),
    readFile(releaseNotesPath, "utf8"),
    readFile(packagePath, "utf8"),
  ]);

  assert.match(packageSource, /"version": "0\.7\.0-beta\.3"/u);
  assert.match(releaseNotes, /ClawDad 0\.7 Paid Beta/u);
  assert.match(releaseScript, /CLAWDAD_APP_BUILD:-18/u);
  assert.match(releaseScript, /Developer ID Application/u);
  assert.match(releaseScript, /notarytool submit "\$zip_path"/u);
  assert.match(releaseScript, /stapler staple "\$app_dir"/u);
  assert.match(releaseScript, /generate_appcast/u);
  assert.match(releaseScript, /--account "\$sparkle_account"/u);
  assert.match(releaseScript, /notarytool submit "\$dmg_path"/u);
  assert.match(releaseScript, /stapler staple "\$dmg_path"/u);
  assert.match(releaseScript, /spctl --assess/u);
  assert.match(releaseScript, /SHA256SUMS/u);
  assert.match(releaseScript, /CLAWDAD_RELEASE_TOKEN/u);
  assert.match(releaseScript, /\/admin\/mac\/appcast/u);
});
