import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { LocalFileLibrary, libraryChunkBytes } from "../lib/local-file-library.mjs";
import { LocalImageInbox, imageFileLimit } from "../lib/local-image-inbox.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const describe = (bytes = png, fileName = "iPhone screenshot.png") => ({ id: crypto.randomUUID(), fileName, size: bytes.length, mimeType: "image/png", sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-image-inbox-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = new LocalFileLibrary(path.join(root, "library"));
  const inbox = new LocalImageInbox(library);
  const send = (action, upload, extra = {}) => inbox.request({ action, upload, owner: "phone-one", ...extra });
  return { root, library, inbox, send };
}

test("iPhone image upload resumes, verifies, and commits once into Received Images", async (t) => {
  const { library, inbox, send } = await setup(t);
  const bytes = Buffer.concat([png, crypto.randomBytes(libraryChunkBytes * 2)]);
  const upload = describe(bytes);
  assert.equal((await send("uploadBegin", upload)).offset, 0);
  assert.equal((await library.list({ category: "receivedImages" })).total, 0);
  const first = { offset: 0, bytes: bytes.subarray(0, libraryChunkBytes).toString("base64") };
  await send("uploadChunk", upload, first);
  assert.equal((await send("uploadChunk", upload, first)).offset, libraryChunkBytes);
  assert.equal((await new LocalImageInbox(library).request({ action: "uploadBegin", upload, owner: "phone-one" })).offset, libraryChunkBytes);
  await assert.rejects(send("uploadFinish", upload), /not finished/);
  for (let offset = libraryChunkBytes; offset < bytes.length; offset += libraryChunkBytes) {
    await send("uploadChunk", upload, { offset, bytes: bytes.subarray(offset, offset + libraryChunkBytes).toString("base64") });
  }
  const receipt = await send("uploadFinish", upload);
  assert.equal(receipt.complete, true);
  assert.deepEqual(await send("uploadFinish", upload), receipt);
  assert.deepEqual(await send("uploadBegin", upload), receipt);
  assert.equal((await library.list()).total, 0);
  const page = await library.list({ category: "receivedImages" });
  assert.equal(page.total, 1);
  assert.equal(page.items[0].versions[0].sha256, upload.sha256);
  assert.equal(JSON.stringify(page).includes("phone-one"), false);
  assert.equal(JSON.stringify(page).includes("storagePath"), false);
  const resolved = await inbox.resolve({ owner: "phone-one", uploadIds: [upload.id] });
  assert.equal(resolved.images[0].path.endsWith("iPhone screenshot.png"), true);
  assert.deepEqual(await readFile(resolved.images[0].path), bytes);
  const downloaded = await library.chunk({ id: receipt.itemId, versionId: receipt.versionId });
  assert.deepEqual(Buffer.from(downloaded.dataBase64, "base64"), bytes.subarray(0, libraryChunkBytes));
});

test("image uploads reject wrong owners, traversal, changed retries, oversize, and corrupt content", async (t) => {
  const { inbox, send } = await setup(t);
  const upload = describe();
  await assert.rejects(send("uploadBegin", { ...upload, fileName: "../../escape.png" }));
  await assert.rejects(send("uploadBegin", { ...upload, size: imageFileLimit + 1 }));
  await send("uploadBegin", upload);
  await assert.rejects(send("uploadBegin", upload, { owner: "phone-two" }), /different image or device/);
  await assert.rejects(send("uploadBegin", { ...upload, fileName: "changed.png" }));
  await assert.rejects(send("uploadChunk", upload, { offset: 1, bytes: "AA==" }));
  await send("uploadChunk", upload, { offset: 0, bytes: png.toString("base64") });
  await assert.rejects(send("uploadChunk", upload, { offset: 0, bytes: "AA==" }), /changed/);
  await send("uploadFinish", upload);
  await assert.rejects(inbox.resolve({ owner: "phone-two", uploadIds: [upload.id] }));
  const corrupt = describe(Buffer.from("This is not a PNG image despite its declared extension and mime."));
  await send("uploadBegin", corrupt);
  await send("uploadChunk", corrupt, { offset: 0, bytes: Buffer.from("This is not a PNG image despite its declared extension and mime.").toString("base64") });
  await assert.rejects(send("uploadFinish", corrupt), /readable image/);
  const changed = { ...describe(), sha256: "0".repeat(64) };
  await send("uploadBegin", changed);
  await send("uploadChunk", changed, { offset: 0, bytes: png.toString("base64") });
  await assert.rejects(send("uploadFinish", changed), /integrity/);
});

test("cancel removes partials and finished images remain stable, archived and protected against substitution", async (t) => {
  const { root, library, inbox, send } = await setup(t);
  const upload = describe();
  await send("uploadBegin", upload);
  await send("uploadCancel", upload);
  assert.equal((await send("uploadBegin", upload)).offset, 0);
  await send("uploadChunk", upload, { offset: 0, bytes: png.toString("base64") });
  const receipt = await send("uploadFinish", upload);
  await send("uploadCancel", upload);
  await library.update({ id: receipt.itemId, archived: true });
  assert.equal((await library.list({ category: "receivedImages", archived: true })).total, 1);
  const resolved = await inbox.resolve({ owner: "phone-one", uploadIds: [upload.id] });
  const outside = path.join(root, "outside.png");
  await writeFile(outside, png);
  await rm(resolved.images[0].path);
  await symlink(outside, resolved.images[0].path);
  await assert.rejects(inbox.resolve({ owner: "phone-one", uploadIds: [upload.id] }));
});

test("a process exit between file rename and catalog commit recovers the same received image", async (t) => {
  const { library, send } = await setup(t);
  const upload = describe();
  await send("uploadBegin", upload);
  // A reservation can also survive a crash before its partial file is created.
  const partial = path.join(library.root, ".incoming", `${upload.id}.partial`);
  await rm(partial);
  assert.equal((await send("uploadBegin", upload)).offset, 0);
  await send("uploadChunk", upload, { offset: 0, bytes: png.toString("base64") });
  const directory = path.join(library.root, "received", upload.id);
  await mkdir(directory, { recursive: true });
  await rename(partial, path.join(directory, upload.fileName));
  const resumed = await new LocalImageInbox(library).request({ action: "uploadBegin", owner: "phone-one", upload });
  assert.equal(resumed.offset, png.length);
  const complete = await send("uploadFinish", upload);
  assert.equal(complete.complete, true);
  assert.deepEqual(await send("uploadFinish", upload), complete);
  assert.equal((await library.list({ category: "receivedImages" })).total, 1);
});
