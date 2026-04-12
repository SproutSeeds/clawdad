import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function filePatternMatches(pattern, filePath) {
  if (pattern.endsWith("/")) {
    return filePath.startsWith(pattern);
  }
  if (pattern.includes("*")) {
    const expression = `^${pattern.split("*").map(escapeRegExp).join(".*")}$`;
    return new RegExp(expression).test(filePath);
  }
  return pattern === filePath;
}

function packageFilesInclude(packageFiles, filePath) {
  return packageFiles.some((pattern) => filePatternMatches(pattern, filePath));
}

test("README inline assets are included in the npm package files whitelist", async () => {
  const [readme, packageJsonText] = await Promise.all([
    readFile(path.join(rootDir, "README.md"), "utf8"),
    readFile(path.join(rootDir, "package.json"), "utf8"),
  ]);
  const packageJson = JSON.parse(packageJsonText);
  const packageFiles = Array.isArray(packageJson.files) ? packageJson.files : [];
  const readmeAssetPaths = [
    ...readme.matchAll(/<img\s+[^>]*src="(assets\/[^"]+)"/gu),
  ].map((match) => match[1]);

  assert.ok(readmeAssetPaths.length > 0, "expected README to reference at least one inline asset");
  for (const assetPath of readmeAssetPaths) {
    assert.equal(
      packageFilesInclude(packageFiles, assetPath),
      true,
      `${assetPath} is referenced by README.md but is not included in package.json files`,
    );
  }
});
