#!/usr/bin/env node
// Managed by Clawdad Codex Integration.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hookDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(hookDir, "..", "..");

const candidates = [
  process.env.CLAWDAD_BIN,
  path.join(projectRoot, "bin", "clawdad"),
  null,
  "clawdad",
].filter(Boolean);

function runCandidate(index = 0) {
  const command = candidates[index];
  if (!command) {
    process.exit(0);
  }
  const child = spawn(command, ["codex", "hook"], {
    stdio: ["inherit", "inherit", "inherit"],
    env: {
      ...process.env,
      CLAWDAD_HOOK_PROJECT: process.cwd(),
    },
  });

  child.once("error", (error) => {
    if (error.code === "ENOENT" && index + 1 < candidates.length) {
      runCandidate(index + 1);
      return;
    }
    console.error(`[clawdad-hook] skipped: ${error.message}`);
    process.exit(0);
  });

  child.once("exit", (code) => {
    process.exit(code ?? 0);
  });
}

runCandidate();
