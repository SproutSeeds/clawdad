import { spawn } from "node:child_process";

function pickString(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

class CodexCatalogClient {
  constructor(binary, cwd, timeoutMs) {
    this.binary = binary;
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
    this.child = null;
    this.buffer = "";
    this.stderr = "";
    this.nextId = 1;
    this.pending = new Map();
    this.exitPromise = null;
  }

  async start() {
    this.child = spawn(this.binary, ["app-server", "--stdio"], {
      cwd: this.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      this.#drain();
    });
    this.child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-12_000);
    });
    this.exitPromise = new Promise((resolve) => {
      this.child.once("exit", (code, signal) => {
        const detail = this.stderr.trim();
        const error = new Error(
          detail || `codex app-server exited during model discovery (code=${code ?? "null"}, signal=${signal ?? "null"})`,
        );
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timeout);
          pending.reject(error);
        }
        this.pending.clear();
        resolve();
      });
    });

    await this.request("initialize", {
      clientInfo: {
        name: "clawdad-model-catalog",
        title: "ClawDad model catalog",
        version: "1.0.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.notify("initialized", {});
  }

  request(method, params = {}) {
    if (!this.child || this.child.exitCode !== null) {
      return Promise.reject(new Error("codex app-server is unavailable for model discovery"));
    }
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timed out waiting for codex app-server ${method}`));
      }, this.timeoutMs);
      timeout.unref?.();
      this.pending.set(id, { resolve, reject, timeout });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  notify(method, params = {}) {
    this.child?.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  async stop() {
    if (!this.child || this.child.exitCode !== null) {
      return;
    }
    this.child.kill("SIGTERM");
    await Promise.race([
      this.exitPromise,
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    if (this.child.exitCode === null) {
      this.child.kill("SIGKILL");
    }
  }

  #drain() {
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) {
        return;
      }
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) {
        continue;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(message, "id")) {
        continue;
      }
      const pending = this.pending.get(message.id);
      if (!pending) {
        continue;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(new Error(pickString(message.error?.message, JSON.stringify(message.error))));
      } else {
        pending.resolve(message.result);
      }
    }
  }
}

function normalizeModel(model = {}) {
  const supportedReasoningEfforts = Array.isArray(model.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts
      .map((entry) => pickString(entry?.reasoningEffort, entry))
      .filter(Boolean)
    : [];
  return {
    id: pickString(model.id, model.model),
    model: pickString(model.model, model.id),
    displayName: pickString(model.displayName, model.model, model.id),
    description: pickString(model.description),
    isDefault: Boolean(model.isDefault),
    defaultReasoningEffort: pickString(model.defaultReasoningEffort, supportedReasoningEfforts[0]),
    supportedReasoningEfforts,
  };
}

export async function readCodexModelCatalog({
  codexBinary = process.env.CLAWDAD_CODEX || "codex",
  projectPath = process.cwd(),
  timeoutMs = 15_000,
} = {}) {
  const client = new CodexCatalogClient(codexBinary, projectPath, timeoutMs);
  try {
    await client.start();
    const configResult = await client.request("config/read", {
      cwd: projectPath,
      includeLayers: false,
    });
    const models = [];
    let cursor = null;
    do {
      const page = await client.request("model/list", {
        cursor,
        includeHidden: false,
        limit: 100,
      });
      models.push(...(Array.isArray(page?.data) ? page.data.map(normalizeModel) : []));
      cursor = pickString(page?.nextCursor) || null;
    } while (cursor);

    const configuredModel = pickString(
      configResult?.config?.model,
      models.find((model) => model.isDefault)?.model,
      models[0]?.model,
    );
    const configuredEntry = models.find((model) => model.model === configuredModel);
    const configuredReasoningEffort = pickString(
      configResult?.config?.model_reasoning_effort,
      configuredEntry?.defaultReasoningEffort,
    );
    return {
      configuredModel,
      configuredReasoningEffort,
      models,
    };
  } finally {
    await client.stop();
  }
}
