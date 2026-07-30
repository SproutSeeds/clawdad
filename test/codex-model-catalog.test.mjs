import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { readCodexModelCatalog } from "../lib/codex-model-catalog.mjs";

test("Codex model catalog reads effective config and paginated app-server models", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-model-catalog-"));
  const fakeCodex = path.join(root, "fake-codex.mjs");
  await writeFile(fakeCodex, `#!/usr/bin/env node
process.stdin.setEncoding("utf8");
let buffer = "";
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf("\\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method === "initialize") {
      send({ id: message.id, result: { ok: true } });
    } else if (message.method === "config/read") {
      send({ id: message.id, result: { config: { model: "gpt-5.6-sol", model_reasoning_effort: "ultra" }, origins: {} } });
    } else if (message.method === "model/list") {
      const second = message.params?.cursor === "next";
      send({
        id: message.id,
        result: {
          data: second ? [{
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            description: "Default",
            isDefault: true,
            hidden: false,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Medium" }],
          }] : [{
            id: "gpt-5.6-sol",
            model: "gpt-5.6-sol",
            displayName: "GPT-5.6-Sol",
            description: "Sol",
            isDefault: false,
            hidden: false,
            defaultReasoningEffort: "low",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Low" },
              { reasoningEffort: "ultra", description: "Ultra" },
            ],
          }],
          nextCursor: second ? null : "next",
        },
      });
    }
  }
});
`, "utf8");
  await chmod(fakeCodex, 0o755);

  try {
    const catalog = await readCodexModelCatalog({
      codexBinary: fakeCodex,
      projectPath: root,
      timeoutMs: 2000,
    });
    assert.equal(catalog.configuredModel, "gpt-5.6-sol");
    assert.equal(catalog.configuredReasoningEffort, "ultra");
    assert.deepEqual(catalog.models.map((model) => model.model), ["gpt-5.6-sol", "gpt-5.5"]);
    assert.deepEqual(catalog.models[0].supportedReasoningEfforts, ["low", "ultra"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
