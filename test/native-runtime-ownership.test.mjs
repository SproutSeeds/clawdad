import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");

test("native Mac app owns the paired-phone runtime without exposing its local token", async () => {
  const [macSource, buildScript, serverSource, appEntitlements, webSource] = await Promise.all([
    readFile(
      path.join(repoRoot, "native", "macos", "Sources", "ClawDad", "main.swift"),
      "utf8",
    ),
    readFile(path.join(repoRoot, "native", "macos", "build-app.sh"), "utf8"),
    readFile(path.join(repoRoot, "lib", "server.mjs"), "utf8"),
    readFile(path.join(repoRoot, "native", "macos", "ClawDad.entitlements"), "utf8"),
    readFile(path.join(repoRoot, "web", "app.js"), "utf8"),
  ]);

  assert.match(macSource, /private let preferredPort = 4487/u);
  assert.match(macSource, /earth\.frg\.ClawDad\.NativeRuntime/u);
  assert.match(macSource, /earth\.frg\.ClawDad\.NativeCloudHost/u);
  assert.match(macSource, /earth\.frg\.ClawDad\.cloud-host/u);
  assert.match(macSource, /"--local-token-file", tokenFile\.path/u);
  assert.doesNotMatch(macSource, /"--local-token", token/u);
  assert.match(macSource, /process\.executableURL = nodeURL/u);
  assert.match(macSource, /CLAWDAD_DISABLE_QUEUED_DISPATCH_RESUME/u);
  assert.doesNotMatch(macSource, /"submit",\s*"-l"/u);

  assert.match(buildScript, /ditto "\$repo_root\/lib" "\$runtime_dir\/lib"/u);
  assert.match(buildScript, /ditto "\$repo_root\/node_modules" "\$runtime_dir\/node_modules"/u);
  assert.match(buildScript, /NSRemovableVolumesUsageDescription/u);
  assert.match(serverSource, /local-token-file/u);
  assert.match(serverSource, /CLAWDAD_DISABLE_QUEUED_DISPATCH_RESUME/u);
  assert.match(appEntitlements, /com\.apple\.security\.device\.audio-input/u);
  assert.match(
    webSource,
    /await refreshSystemReadiness\(\{ quiet: true \}\);\s*if \(!systemSetupIsOpen\(\)\)/u,
  );
});
