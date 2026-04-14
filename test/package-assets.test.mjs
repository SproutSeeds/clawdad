import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
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

function assetPathFromUrl(value) {
  const assetPath = String(value || "").split("?")[0].replace(/^\//, "");
  return assetPath.startsWith("assets/") ? assetPath : null;
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

test("web app icon assets exist and are included in the npm package files whitelist", async () => {
  const [manifestText, indexHtml, packageJsonText] = await Promise.all([
    readFile(path.join(rootDir, "web", "manifest.webmanifest"), "utf8"),
    readFile(path.join(rootDir, "web", "index.html"), "utf8"),
    readFile(path.join(rootDir, "package.json"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  const packageJson = JSON.parse(packageJsonText);
  const packageFiles = Array.isArray(packageJson.files) ? packageJson.files : [];
  const manifestIconPaths = Array.isArray(manifest.icons)
    ? manifest.icons.map((icon) => assetPathFromUrl(icon.src)).filter(Boolean)
    : [];
  const htmlIconPaths = [...indexHtml.matchAll(/<link\s+[^>]*href="([^"]+)"[^>]*>/gu)]
    .map((match) => assetPathFromUrl(match[1]))
    .filter(Boolean)
    .filter((assetPath) => assetPath.includes("app-icon") || assetPath.includes("apple-touch-icon"));
  const appIconPaths = [...new Set([...manifestIconPaths, ...htmlIconPaths])];

  assert.ok(appIconPaths.length >= 4, "expected manifest and iOS app icon assets");
  assert.ok(appIconPaths.includes("assets/clawdad-apple-touch-icon.png"));

  for (const assetPath of appIconPaths) {
    await stat(path.join(rootDir, assetPath));
    assert.equal(
      packageFilesInclude(packageFiles, assetPath),
      true,
      `${assetPath} is referenced by web app metadata but is not included in package.json files`,
    );
  }
});
