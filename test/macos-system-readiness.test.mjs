import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const readinessSourcePath = path.join(
  repoRoot,
  "native",
  "macos",
  "Sources",
  "ClawDad",
  "MacSystemReadiness.swift",
);
const nativeBridgeSourcePath = path.join(
  repoRoot,
  "native",
  "macos",
  "Sources",
  "ClawDad",
  "main.swift",
);
const webAppPath = path.join(repoRoot, "web", "app.js");
const webIndexPath = path.join(repoRoot, "web", "index.html");

test("Mac setup separates Codex usability from current release status", async () => {
  const [readinessSource, nativeBridgeSource, webApp, webIndex] = await Promise.all([
    readFile(readinessSourcePath, "utf8"),
    readFile(nativeBridgeSourcePath, "utf8"),
    readFile(webAppPath, "utf8"),
    readFile(webIndexPath, "utf8"),
  ]);

  assert.match(
    readinessSource,
    /https:\/\/releases\.openai\.com\/codex\/channels\/latest/u,
  );
  assert.match(readinessSource, /"state": "available"/u);
  assert.match(readinessSource, /"state": "current"/u);
  assert.match(readinessSource, /"state": "unavailable"/u);
  assert.match(nativeBridgeSource, /forceCodexUpdateCheck/u);
  assert.match(webApp, /codexStateLabel = "Update available"/u);
  assert.match(webApp, /codexStateLabel = "Up to date"/u);
  assert.match(webApp, /codexStateLabel = "Installed & signed in"/u);
  assert.match(webApp, /`Update to \$\{codexUpdate\.latestVersion \|\| "latest"\}`/u);
  assert.match(
    webApp,
    /refreshSystemReadiness\(\{ forceCodexUpdateCheck: true \}\)/u,
  );
  assert.match(webIndex, /checks OpenAI's current release separately/u);
});
