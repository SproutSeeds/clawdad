import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");

test("runtime fingerprint changes when a newly introduced library or web module changes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-runtime-fingerprint-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ["bin", "lib", "web", "templates", "assets", "node_modules/open-research-protocol"]) await mkdir(path.join(root, directory), { recursive: true });
  await writeFile(path.join(root, "package.json"), "{}");
  await writeFile(path.join(root, "node_modules/open-research-protocol/package.json"), "{}");
  const fingerprint = async () => (await promisify(execFile)(process.execPath, [path.join(repoRoot, "native/macos/runtime-fingerprint.mjs"), root])).stdout.trim();
  const initial = await fingerprint();
  await writeFile(path.join(root, "lib/new-feature.mjs"), "export const enabled = true;");
  const library = await fingerprint();
  assert.notEqual(library, initial);
  await writeFile(path.join(root, "web/new-feature.js"), "export const title = 'Files';");
  assert.notEqual(await fingerprint(), library);
});

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
  assert.match(buildScript, /runtime-fingerprint\.mjs/u);
  assert.match(buildScript, /runtime_version=\$\([\s\S]*runtime-fingerprint\.mjs[\s\S]*\.bundle-version/u);
  assert.match(sharedRuntime, /ensureCodexSharedRuntime/u);
  assert.match(deliveryClaim, /acquireCodexDeliveryClaim/u);
});
