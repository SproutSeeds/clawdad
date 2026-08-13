import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const projectSpecPath = path.join(
  repoRoot,
  "apps",
  "ios",
  "ClawDadMobile",
  "project.yml",
);
const appStoreProductsPath = path.join(repoRoot, "ops", "app-store-products.json");
const exportOptionsPath = path.join(
  repoRoot,
  "apps",
  "ios",
  "ClawDadMobile",
  "ExportOptions-AppStore.plist",
);
const uploadScriptPath = path.join(repoRoot, "bin", "clawdad-testflight");
const packagePath = path.join(repoRoot, "package.json");

test("iPhone release keeps production signing and paid access configuration", async () => {
  const [
    projectSpec,
    productsSource,
    exportOptions,
    uploadScript,
    packageSource,
  ] = await Promise.all([
    readFile(projectSpecPath, "utf8"),
    readFile(appStoreProductsPath, "utf8"),
    readFile(exportOptionsPath, "utf8"),
    readFile(uploadScriptPath, "utf8"),
    readFile(packagePath, "utf8"),
  ]);
  const products = JSON.parse(productsSource);
  const projectLines = projectSpec.split("\n");
  const releaseStart = projectLines.indexOf("        Release:");
  const releaseSettings = [];
  for (
    let index = releaseStart + 1;
    index < projectLines.length && projectLines[index].startsWith("          ");
    index += 1
  ) {
    releaseSettings.push(projectLines[index]);
  }

  assert.match(projectSpec, /DEVELOPMENT_TEAM: 4QV4WR9G32/u);
  assert.match(
    projectSpec,
    /PRODUCT_BUNDLE_IDENTIFIER: earth\.frg\.clawdad\.ios/u,
  );
  assert.match(projectSpec, /MARKETING_VERSION: "0\.7\.0"/u);
  assert.match(projectSpec, /CURRENT_PROJECT_VERSION: "29"/u);
  assert.match(
    projectSpec,
    /Release:\n\s+CLAWDAD_CLOUD_URL: "https:\/\/clawdad-cloud\.frg\.earth"/u,
  );
  assert.notEqual(releaseStart, -1);
  assert.equal(
    projectLines[releaseStart + 1],
    '          CLAWDAD_CLOUD_URL: "https://clawdad-cloud.frg.earth"',
  );
  assert.equal(
    releaseSettings.includes(
      '          CLAWDAD_FOUNDING_BETA_ACCESS: "YES"',
    ),
    false,
  );
  assert.equal(products.app.bundleId, "earth.frg.clawdad.ios");
  assert.equal(products.products.length, 2);
  assert.match(exportOptions, /<string>app-store-connect<\/string>/u);
  assert.match(exportOptions, /<string>upload<\/string>/u);
  assert.match(exportOptions, /<string>4QV4WR9G32<\/string>/u);
  assert.match(uploadScript, /-authenticationKeyPath/u);
  assert.match(uploadScript, /-authenticationKeyID/u);
  assert.match(uploadScript, /-authenticationKeyIssuerID/u);
  assert.match(packageSource, /"ios:upload:testflight"/u);
});
