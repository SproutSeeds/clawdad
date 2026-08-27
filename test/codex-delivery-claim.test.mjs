import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  acquireCodexDeliveryClaim,
  codexDeliveryClaimKey,
} from "../lib/codex-delivery-claim.mjs";

const claimModuleUrl = new URL("../lib/codex-delivery-claim.mjs", import.meta.url).href;

async function makeProject(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-delivery-claim-"));
  const projectPath = path.join(root, "project");
  await mkdir(projectPath);
  t.after(() => rm(root, { recursive: true, force: true }));
  return projectPath;
}

function claimPaths(projectPath, threadId, requestId) {
  const key = codexDeliveryClaimKey(threadId, requestId);
  const claimRoot = path.join(
    path.resolve(projectPath),
    ".clawdad",
    "mailbox",
    "delivery-claims",
  );
  const claimDir = path.join(claimRoot, key);
  return { key, claimRoot, claimDir, ownerFile: path.join(claimDir, "owner.json") };
}

function waitForChildMessage(child, predicate, timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for child message; stderr=${child.stderrText || ""}`));
    }, timeoutMs);
    const onMessage = (message) => {
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`child exited before message (code=${code}, signal=${signal}); stderr=${child.stderrText || ""}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    child.on("message", onMessage);
    child.once("exit", onExit);
  });
}

test("derives the exact SHA-256 key and keeps hostile identifiers inside the claim root", async (t) => {
  const projectPath = await makeProject(t);
  const threadId = "../../threads/../../../outside";
  const requestId = "../requests/../../outside";
  const expected = createHash("sha256")
    .update(threadId)
    .update("\0")
    .update(requestId)
    .digest("hex");

  assert.equal(codexDeliveryClaimKey(threadId, requestId), expected);
  assert.throws(() => codexDeliveryClaimKey("thread\0suffix", "request"), /must not contain NUL/u);

  const claim = await acquireCodexDeliveryClaim(projectPath, { threadId, requestId });
  assert.equal(path.basename(claim.claimDir), expected);
  assert.equal(path.dirname(claim.claimDir), claim.claimRoot);
  assert.equal(claim.claimRoot, path.join(
    path.resolve(projectPath),
    ".clawdad",
    "mailbox",
    "delivery-claims",
  ));
  assert.equal((await stat(claim.claimDir)).isDirectory(), true);
  await claim.release();
});

test("writes the required owner record and releases its own matching token", async (t) => {
  const projectPath = await makeProject(t);
  const before = Date.now();
  const claim = await acquireCodexDeliveryClaim(projectPath, {
    threadId: "thread-1",
    requestId: "request-1",
  });
  const owner = JSON.parse(await readFile(claim.ownerFile, "utf8"));

  assert.deepEqual(Object.keys(owner).sort(), [
    "acquiredAt",
    "pid",
    "requestId",
    "threadId",
    "token",
  ]);
  assert.equal(owner.pid, process.pid);
  assert.equal(owner.token, claim.token);
  assert.equal(owner.threadId, "thread-1");
  assert.equal(owner.requestId, "request-1");
  assert.equal(Date.parse(owner.acquiredAt) >= before, true);
  assert.equal(claim.mode, "acquired");
  assert.equal(claim.recovered, false);
  assert.equal(await claim.release(), true);
  assert.equal(await claim.release(), false);
  await assert.rejects(stat(claim.claimDir), (error) => error?.code === "ENOENT");
});

test("a duplicate process waits while the live owner holds the claim", async (t) => {
  const projectPath = await makeProject(t);
  const childSource = `
import { acquireCodexDeliveryClaim } from ${JSON.stringify(claimModuleUrl)};
const [projectPath, threadId, requestId] = process.argv.slice(1);
const claim = await acquireCodexDeliveryClaim(projectPath, { threadId, requestId });
process.send({ type: "acquired", pid: process.pid });
process.on("message", async (message) => {
  if (message?.type !== "release") return;
  process.send({ type: "released", released: await claim.release() });
  process.exit(0);
});
setTimeout(() => process.exit(3), 10_000).unref();
`;
  const child = spawn(process.execPath, [
    "--input-type=module",
    "-e",
    childSource,
    projectPath,
    "thread-shared",
    "request-shared",
  ], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  child.stderrText = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    child.stderrText += chunk;
  });
  t.after(() => {
    if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
  });

  await waitForChildMessage(child, (message) => message?.type === "acquired");
  let duplicateSettled = false;
  const duplicate = acquireCodexDeliveryClaim(projectPath, {
    threadId: "thread-shared",
    requestId: "request-shared",
    timeoutMs: 0,
    pollMs: 10,
  }).then((claim) => {
    duplicateSettled = true;
    return claim;
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(duplicateSettled, false);

  child.send({ type: "release" });
  const released = await waitForChildMessage(child, (message) => message?.type === "released");
  assert.equal(released.released, true);
  const claim = await duplicate;
  assert.equal(claim.mode, "acquired");
  assert.equal(claim.recovered, false);
  assert.equal(await claim.release(), true);
});

test("recovers a token-verified dead owner and reports recovery mode", async (t) => {
  const projectPath = await makeProject(t);
  const threadId = "thread-dead";
  const requestId = "request-dead";
  const paths = claimPaths(projectPath, threadId, requestId);
  await mkdir(paths.claimDir, { recursive: true });
  await writeFile(paths.ownerFile, `${JSON.stringify({
    pid: 987_654_321,
    token: "dead-owner-token",
    threadId,
    requestId,
    acquiredAt: "2026-08-26T12:00:00.000Z",
  })}\n`, "utf8");

  const claim = await acquireCodexDeliveryClaim(projectPath, {
    threadId,
    requestId,
    processIsLive: (pid) => pid !== 987_654_321,
    timeoutMs: 500,
    pollMs: 5,
  });
  const owner = JSON.parse(await readFile(claim.ownerFile, "utf8"));

  assert.equal(claim.mode, "recovered");
  assert.equal(claim.recovered, true);
  assert.equal(owner.pid, process.pid);
  assert.notEqual(owner.token, "dead-owner-token");
  assert.equal(await claim.release(), true);
});

test("times out without deleting a live owner", async (t) => {
  const projectPath = await makeProject(t);
  const owner = await acquireCodexDeliveryClaim(projectPath, {
    threadId: "thread-live",
    requestId: "request-live",
  });
  const before = await readFile(owner.ownerFile, "utf8");

  await assert.rejects(
    acquireCodexDeliveryClaim(projectPath, {
      threadId: "thread-live",
      requestId: "request-live",
      timeoutMs: 50,
      pollMs: 5,
    }),
    (error) => (
      error?.code === "CLAWDAD_CODEX_DELIVERY_CLAIM_TIMEOUT"
      && error?.ownerState === "valid"
      && error?.ownerPid === process.pid
    ),
  );

  assert.equal(await readFile(owner.ownerFile, "utf8"), before);
  assert.equal((await stat(owner.claimDir)).isDirectory(), true);
  assert.equal(await owner.release(), true);
});

test("malformed owner metadata fails closed and remains untouched", async (t) => {
  const projectPath = await makeProject(t);
  const threadId = "thread-malformed";
  const requestId = "request-malformed";
  const paths = claimPaths(projectPath, threadId, requestId);
  const malformed = "{ this is not owner JSON\n";
  await mkdir(paths.claimDir, { recursive: true });
  await writeFile(paths.ownerFile, malformed, "utf8");

  await assert.rejects(
    acquireCodexDeliveryClaim(projectPath, {
      threadId,
      requestId,
      timeoutMs: 40,
      pollMs: 5,
    }),
    (error) => (
      error?.code === "CLAWDAD_CODEX_DELIVERY_CLAIM_TIMEOUT"
      && error?.ownerState === "malformed"
      && error?.ownerPid == null
    ),
  );

  assert.equal(await readFile(paths.ownerFile, "utf8"), malformed);
  assert.equal((await stat(paths.claimDir)).isDirectory(), true);
});

test("release refuses to remove a claim after the owner token changes", async (t) => {
  const projectPath = await makeProject(t);
  const claim = await acquireCodexDeliveryClaim(projectPath, {
    threadId: "thread-token",
    requestId: "request-token",
  });
  const replacement = {
    ...claim.owner,
    token: "replacement-owner-token",
  };
  await writeFile(claim.ownerFile, `${JSON.stringify(replacement)}\n`, "utf8");

  assert.equal(await claim.release(), false);
  assert.deepEqual(JSON.parse(await readFile(claim.ownerFile, "utf8")), replacement);
  assert.equal((await stat(claim.claimDir)).isDirectory(), true);
});
