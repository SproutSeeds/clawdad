import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");

test("native Mac build stages the shared Codex writer runtime and WebSocket dependency", async () => {
  const [buildScript, packageSource, sharedRuntime, deliveryClaim] = await Promise.all([
    readFile(path.join(repoRoot, "native", "macos", "build-app.sh"), "utf8"),
    readFile(path.join(repoRoot, "package.json"), "utf8"),
    readFile(path.join(repoRoot, "lib", "codex-shared-runtime.mjs"), "utf8"),
    readFile(path.join(repoRoot, "lib", "codex-delivery-claim.mjs"), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.equal(packageJson.dependencies.ws, "^8.21.3");
  assert.match(buildScript, /ditto "\$repo_root\/lib" "\$runtime_dir\/lib"/u);
  assert.match(buildScript, /ditto "\$repo_root\/node_modules" "\$runtime_dir\/node_modules"/u);
  assert.match(buildScript, /"\$runtime_dir\/lib\/server\.mjs"/u);
  assert.match(sharedRuntime, /ensureCodexSharedRuntime/u);
  assert.match(deliveryClaim, /acquireCodexDeliveryClaim/u);
});
