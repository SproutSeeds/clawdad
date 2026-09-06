import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

test("authenticated local Files API registers, filters, previews and downloads exact immutable bytes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-file-api-"));
  const state = path.join(root, "state");
  await mkdir(state);
  await writeFile(path.join(state, "state.json"), JSON.stringify({ version: 3, projects: {} }));
  const mock = path.join(root, "mock");
  await writeFile(mock, "#!/bin/sh\nexit 1\n"); await chmod(mock, 0o755);
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const config = path.join(root, "server.json");
  await writeFile(config, JSON.stringify({ host: "127.0.0.1", port, authMode: "tailscale", allowedUsers: ["files-test@example.com"] }));
  const child = spawn(process.execPath, ["lib/server.mjs", "serve", "--config", config], {
    env: { ...process.env, CLAWDAD_HOME: state, CLAWDAD_FILES_ROOT: path.join(root, "library"), CLAWDAD_BIN_PATH: mock, CLAWDAD_TTS_ENABLED: "false", CLAWDAD_CODEX_APP_SERVER_MODE: "isolated" },
    stdio: "ignore",
  });
  t.after(async () => {
    if (child.exitCode === null) { child.kill("SIGTERM"); await new Promise(resolve => child.once("exit", resolve)); }
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10_000;
  while (true) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { }
    assert.equal(child.exitCode, null);
    assert.ok(Date.now() < deadline, "Files API did not start");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal((await fetch(`${base}/v1/files/library`)).status, 401);
  const headers = { "tailscale-user-login": "files-test@example.com", "Content-Type": "application/json" };
  const fileName = "Finished résumé.txt";
  const sourcePath = path.join(root, fileName);
  const bytes = Buffer.from("An intentional deliverable. Café 🦞\n");
  await writeFile(sourcePath, bytes);
  const registered = await fetch(`${base}/v1/files/add`, { method: "POST", headers, body: JSON.stringify({ sourcePath, project: "/projects/one" }) });
  assert.equal(registered.status, 200);
  const { item } = await registered.json();
  await writeFile(sourcePath, "An ordinary later source edit");
  const page = await (await fetch(`${base}/v1/files/library?project=%2Fprojects%2Fone&format=txt`, { headers })).json();
  assert.equal(page.total, 1);
  assert.equal(JSON.stringify(page).includes(sourcePath), false);
  const parameters = new URLSearchParams({ id: item.id, versionId: item.versions[0].id });
  const downloaded = await fetch(`${base}/v1/files/download?${parameters}`, { headers });
  assert.equal(downloaded.status, 200);
  assert.match(downloaded.headers.get("content-disposition"), /attachment/u);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
  assert.equal(item.versions[0].sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
  const preview = await fetch(`${base}/v1/files/preview?${parameters}`, { headers });
  assert.match(preview.headers.get("content-type"), /text\/plain/u);
  assert.equal(await preview.text(), bytes.toString());
  const chunk = await (await fetch(`${base}/v1/files/chunk?${parameters}&offset=7`, { headers })).json();
  assert.deepEqual(Buffer.from(chunk.dataBase64, "base64"), bytes.subarray(7));
  const bad = await fetch(`${base}/v1/files/download?id=../../secret&versionId=bad`, { headers });
  assert.equal(bad.status, 400);

  // The native companion supplies the paired owner; raw image bytes never enter
  // a cloud envelope. Verify the exact routes used by that companion.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const upload = { id: crypto.randomUUID(), fileName: "Phone screenshot.png", mimeType: "image/png", size: png.length, sha256: crypto.createHash("sha256").update(png).digest("hex") };
  const imagePost = (route, body, auth = headers) => fetch(`${base}/v1/files/${route}`, { method: "POST", headers: auth, body: JSON.stringify(body) });
  assert.equal((await imagePost("image-upload", { action: "uploadBegin", owner: "paired-phone", upload }, { "Content-Type": "application/json" })).status, 401);
  for (const action of ["uploadBegin", "uploadChunk", "uploadFinish"]) {
    const response = await imagePost("image-upload", { action, owner: "paired-phone", upload, ...(action === "uploadChunk" ? { offset: 0, bytes: png.toString("base64") } : {}) });
    assert.equal(response.status, 200, await response.text());
  }
  const received = await (await fetch(`${base}/v1/files/library?category=receivedImages`, { headers })).json();
  assert.equal(received.total, 1);
  assert.equal(JSON.stringify(received).includes("storagePath"), false);
  const saved = received.items[0];
  const exact = await fetch(`${base}/v1/files/download?${new URLSearchParams({ id: saved.id, versionId: saved.versions[0].id })}`, { headers });
  assert.deepEqual(Buffer.from(await exact.arrayBuffer()), png);
  const resolved = await imagePost("image-resolve", { owner: "paired-phone", uploadIds: [upload.id] });
  assert.equal(resolved.status, 200);
  assert.equal((await resolved.json()).images[0].sha256, upload.sha256);
  assert.equal((await imagePost("image-resolve", { owner: "different-phone", uploadIds: [upload.id] })).status, 400);
});
