import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chimeraDoctor = path.join(rootDir, "lib", "chimera-doctor.mjs");

async function createFakeChimera(dir) {
  const binaryPath = path.join(dir, "fake-chimera-doctor.mjs");
  await writeFile(
    binaryPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("chimera 9.9.9");
  process.exit(0);
}
if (args.includes("--help")) {
  console.log("--local-doctor");
  console.log("--approval-mode <APPROVAL_MODE>");
  process.exit(0);
}
if (args.includes("--local-doctor")) {
  console.log(JSON.stringify({ recommendation: { primary: "local" } }));
  process.exit(0);
}
process.exit(0);
`,
    "utf8",
  );
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function withOllamaTags(models, callback) {
  const server = createServer((req, res) => {
    if (req.url === "/api/tags") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ models: models.map((name) => ({ name })) }));
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    return await callback(`http://127.0.0.1:${address.port}/v1`);
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}

test("chimera doctor reports a ready local lane when binary and Ollama model exist", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clawdad-chimera-doctor-"));
  const fakeChimera = await createFakeChimera(tempDir);

  await withOllamaTags(["qwen3:4b"], async (ollamaBaseUrl) => {
    const result = await execFileAsync(
      process.execPath,
      [
        chimeraDoctor,
        "--chimera-binary", fakeChimera,
        "--model", "local",
        "--json",
      ],
      {
        env: {
          ...process.env,
          OLLAMA_BASE_URL: ollamaBaseUrl,
        },
      },
    );

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.ready, true);
    assert.equal(payload.chimeraVersion, "chimera 9.9.9");
    assert.equal(payload.resolvedModel, "qwen3:4b");
    assert.equal(payload.ollama.ok, true);
    assert.deepEqual(payload.suggestions, []);
  });
});
