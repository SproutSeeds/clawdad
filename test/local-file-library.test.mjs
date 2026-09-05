import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { LocalFileLibrary, libraryChunkBytes } from "../lib/local-file-library.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-files-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "Report.txt");
  const library = new LocalFileLibrary(path.join(root, "library"));
  await writeFile(sourcePath, "A finished report. Café 🦞\n");
  return { root, sourcePath, library };
}

test("Files records intentional snapshots, deduplicates retries, groups versions and formats", async (t) => {
  const { root, sourcePath, library } = await fixture(t);
  assert.equal((await library.list()).total, 0);
  const first = await library.add({ sourcePath, project: "test" });
  assert.equal((await library.add({ sourcePath, project: "test" })).id, first.id);
  await writeFile(sourcePath, "Updated report");
  const second = await library.add({ sourcePath, project: "test" });
  assert.equal(second.id, first.id);
  assert.equal(second.versions.length, 2);
  const otherFormat = path.join(root, "Report.csv");
  await writeFile(otherFormat, "name,value\nA,1\n");
  const third = await library.add({ sourcePath: otherFormat, project: "test" });
  assert.equal(third.id, first.id);
  assert.equal(third.versions.length, 3);
  const original = await library.chunk({ id: first.id, versionId: first.versions[0].id });
  assert.equal(Buffer.from(original.dataBase64, "base64").toString(), "A finished report. Café 🦞\n");
  assert.equal(JSON.stringify(await library.list()).includes(sourcePath), false);
  assert.equal(await readFile(sourcePath, "utf8"), "Updated report");
});

test("Files chunks resume by immutable version and reject paths, bad offsets and symlink substitution", async (t) => {
  const { sourcePath, root, library } = await fixture(t);
  const bytes = crypto.randomBytes(libraryChunkBytes * 2 + 19);
  await writeFile(sourcePath, bytes);
  const item = await library.add({ sourcePath });
  const version = item.versions[0];
  let offset = 0;
  const chunks = [];
  while (offset < bytes.length) {
    const chunk = await library.chunk({ id: item.id, versionId: version.id, offset });
    assert.equal(chunk.offset, offset);
    chunks.push(Buffer.from(chunk.dataBase64, "base64")); offset = chunk.nextOffset;
  }
  assert.deepEqual(Buffer.concat(chunks), bytes);
  assert.equal(version.sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
  await assert.rejects(library.chunk({ id: item.id, versionId: "../../secret" }));
  await assert.rejects(library.chunk({ id: item.id, versionId: version.id, offset: -1 }));
  await assert.rejects(library.chunk({ id: item.id, versionId: version.id, offset: bytes.length + 1 }));
  const object = path.join(root, "library", "objects", version.id);
  await rm(object); await symlink(sourcePath, object);
  await assert.rejects(library.chunk({ id: item.id, versionId: version.id }));
});

test("Concurrent saves preserve all entries and pin/archive do not delete bytes", async (t) => {
  const { root, library } = await fixture(t);
  await Promise.all(Array.from({ length: 8 }, async (_, index) => {
    const sourcePath = path.join(root, `Deliverable-${index}.txt`);
    await writeFile(sourcePath, `File ${index}`);
    return new LocalFileLibrary(library.root).add({ sourcePath, project: index % 2 ? "one" : "two" });
  }));
  assert.equal((await library.list()).total, 8);
  const item = (await library.list({ query: "Deliverable-3" })).items[0];
  await library.update({ id: item.id, pinned: true });
  assert.equal((await library.list()).items[0].id, item.id);
  await library.update({ id: item.id, archived: true });
  assert.equal((await library.list()).total, 7);
  assert.equal((await library.list({ archived: true })).items[0].id, item.id);
  assert.equal((await library.chunk({ id: item.id, versionId: item.versions[0].id })).eof, true);
  const page = await library.list({ limit: 1 });
  assert.deepEqual(page.projects, ["one", "two"]);
  assert.deepEqual(page.formats, ["txt"]);
  assert.equal((await library.list({ project: "two" })).total, 4);
});

test("Concurrent recovery of an exited writer preserves each subsequent save", async (t) => {
  const { root, library } = await fixture(t);
  const exited = spawnSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8" });
  assert.equal(exited.status, 0);
  const lock = path.join(library.root, ".catalog-lock");
  await mkdir(lock, { recursive: true });
  await writeFile(path.join(lock, "pid"), exited.stdout.trim());
  await Promise.all(Array.from({ length: 12 }, async (_, index) => {
    const sourcePath = path.join(root, `Recovered-${index}.txt`);
    await writeFile(sourcePath, String(index));
    await new LocalFileLibrary(library.root).add({ sourcePath });
  }));
  assert.equal((await library.list()).total, 12);
});
