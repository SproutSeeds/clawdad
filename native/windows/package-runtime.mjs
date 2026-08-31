#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const destination = path.resolve(process.argv[2] || path.join(scriptDir, "dist", "runtime"));

async function exists(filePath) {
  return stat(filePath).then(() => true, () => false);
}

async function copyEntry(relativePath) {
  const source = path.join(repoRoot, relativePath);
  if (!(await exists(source))) {
    throw new Error(`Windows runtime source is missing: ${source}`);
  }
  await cp(source, path.join(destination, relativePath), {
    recursive: true,
    force: true,
    preserveTimestamps: true,
  });
}

async function installRuntimeDependencies() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  await new Promise((resolve, reject) => {
    const child = spawn(
      npmCommand,
      ["ci", "--omit=dev", "--force", "--no-audit", "--no-fund"],
      {
        cwd: destination,
        env: process.env,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        `npm ci failed while preparing the private Windows runtime ` +
        `(code=${code ?? "null"}, signal=${signal ?? "none"}).`,
      ));
    });
  });
}

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

for (const entry of [
  "package.json",
  "package-lock.json",
  "bin",
  "lib",
  "web",
  "templates",
  path.join("vendor", "apple-pki"),
]) {
  await copyEntry(entry);
}

await installRuntimeDependencies();

await mkdir(path.join(destination, "assets"), { recursive: true });
const fixedAssets = [
  "clawdad-app-icon-192.png",
  "clawdad-app-icon-512.png",
  "clawdad-app-icon-1024.png",
  "clawdad-apple-touch-icon.png",
  "clawdad-claw-hyperreal-icon.png",
  "clawdad-claw.svg",
  "clawdad-mascot.jpg",
  "clawdad-mascot-app.png",
  "clawdad-mascot-cutout.png",
  "clawdad-wordmark.png",
  "clawdad-wordmark.svg",
];
const headerAssets = (await readdir(path.join(repoRoot, "assets")))
  .filter((name) => /^clawdad-header-.*\.jpg$/u.test(name));
for (const asset of [...fixedAssets, ...headerAssets]) {
  await cp(
    path.join(repoRoot, "assets", asset),
    path.join(destination, "assets", asset),
    { force: true, preserveTimestamps: true },
  );
}

const fingerprintFiles = [
  "package.json",
  path.join("lib", "server.mjs"),
  path.join("web", "index.html"),
  path.join("web", "app.css"),
  path.join("web", "app.js"),
];
const hash = createHash("sha256");
for (const relativePath of fingerprintFiles) {
  hash.update(await readFile(path.join(destination, relativePath)));
}
await writeFile(path.join(destination, ".bundle-version"), `${hash.digest("hex")}\n`, "utf8");

console.log(destination);
