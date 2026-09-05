import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { constants, createWriteStream } from "node:fs";
import { mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const libraryFileLimit = 100 * 1024 * 1024;
export const libraryByteLimit = 10 * 1024 * 1024 * 1024;
export const libraryChunkBytes = 32 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const mimeTypes = { pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json", html: "text/html", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", zip: "application/zip", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", mp4: "video/mp4" };
const cleanText = (value, limit = 256) => String(value || "").replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, limit);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const catalogCache = new Map();
const catalogByteLimit = 16 * 1024 * 1024;

export function localFileLibraryRoot() {
  if (process.env.CLAWDAD_FILES_ROOT) {
    if (!path.isAbsolute(process.env.CLAWDAD_FILES_ROOT)) throw new Error("CLAWDAD_FILES_ROOT must be an absolute local path.");
    return process.env.CLAWDAD_FILES_ROOT;
  }
  return process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support", "ClawDad", "Files")
    : path.join(os.homedir(), ".clawdad", "files");
}

/** Local immutable snapshots. No watcher, remote storage, or outbound request. */
export class LocalFileLibrary {
  constructor(root = localFileLibraryRoot()) { this.root = path.resolve(root); }

  async catalog({ mutable = false } = {}) {
    try {
      const file = path.join(this.root, "catalog.json");
      const info = await stat(file);
      if (info.size > catalogByteLimit) throw new Error("The Files catalog exceeds its size limit. Existing files were preserved.");
      const identity = `${info.ino}:${info.size}:${info.mtimeMs}`;
      const cached = catalogCache.get(this.root);
      if (cached?.identity === identity) return mutable ? structuredClone(cached.value) : cached.value;
      const value = JSON.parse(await readFile(file, "utf8"));
      if (value.schemaVersion !== 1 || !Array.isArray(value.items) || !Number.isSafeInteger(value.revision)) throw new Error("The Files catalog needs repair; existing files were preserved.");
      if (catalogCache.size >= 8) catalogCache.delete(catalogCache.keys().next().value);
      catalogCache.set(this.root, { identity, value });
      return mutable ? structuredClone(value) : value;
    } catch (error) {
      if (error.code === "ENOENT") return { schemaVersion: 1, revision: 1, items: [] };
      throw error;
    }
  }

  async locked(action) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const lock = path.join(this.root, ".catalog-lock");
    const deadline = Date.now() + 15_000;
    for (;;) {
      try { await mkdir(lock, { mode: 0o700 }); break; }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        // Recover only a lock owned by a process which has exited. A live
        // export may take time; elapsed time alone never steals its lock.
        let recovery;
        const recoveryPath = path.join(this.root, ".catalog-recovery");
        try {
          // Only one process may recover a dead writer. Read its PID after
          // acquiring this guard, so a second recoverer cannot delete a new lock.
          recovery = await open(recoveryPath, "wx", 0o600);
          const owner = Number(await readFile(path.join(lock, "pid"), "utf8"));
          if (Number.isSafeInteger(owner) && owner > 0) {
            try { process.kill(owner, 0); }
            catch (probe) { if (probe.code === "ESRCH") await rm(lock, { recursive: true, force: true }); }
          }
        } catch { /* A writer or another recovery may still be in progress. */ }
        finally { if (recovery) { await recovery.close(); await rm(recoveryPath, { force: true }); } }
        if (Date.now() >= deadline) throw new Error("Files is finishing another save. Try again shortly.");
        await pause(50);
      }
    }
    try {
      await writeFile(path.join(lock, "pid"), String(process.pid), { mode: 0o600 });
      return await action();
    } finally { await rm(lock, { recursive: true, force: true }); }
  }

  async save(catalog) {
    catalog.revision += 1;
    const serialized = JSON.stringify(catalog);
    if (Buffer.byteLength(serialized) > catalogByteLimit) throw new Error("The local Files catalog reached its size limit. Existing files were preserved.");
    const temporary = path.join(this.root, `catalog-${crypto.randomUUID()}.tmp`);
    try {
      await writeFile(temporary, serialized, { mode: 0o600 });
      await rename(temporary, path.join(this.root, "catalog.json"));
    } finally { await rm(temporary, { force: true }); }
  }

  async add({ sourcePath, title, project = "", thread = "", itemId = "" }) {
    if (!sourcePath || !path.isAbsolute(sourcePath)) throw new Error("Choose an absolute path to a finished file.");
    const source = await realpath(sourcePath);
    if (source === this.root || source.startsWith(this.root + path.sep)) throw new Error("That file is already inside the Files library.");
    return this.locked(async () => {
      const catalog = await this.catalog({ mutable: true });
      const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
      const versionId = crypto.randomUUID();
      const objects = path.join(this.root, "objects");
      await mkdir(objects, { recursive: true, mode: 0o700 });
      const temporary = path.join(objects, `${versionId}.partial`);
      let objectCommitted = false;
      try {
        const before = await handle.stat();
        if (!before.isFile()) throw new Error("Files accepts regular files only.");
        if (before.size > libraryFileLimit) throw new Error("This file exceeds the 100 MB download limit.");
        const bytesUsed = catalog.items.flatMap((item) => item.versions).reduce((sum, version) => sum + version.size, 0);
        const hash = crypto.createHash("sha256");
        let copied = 0;
        await pipeline(handle.createReadStream({ autoClose: false }), new Transform({ transform(chunk, _, callback) {
          copied += chunk.length;
          if (copied > libraryFileLimit) { callback(new Error("The file grew beyond the 100 MB limit.")); return; }
          hash.update(chunk); callback(null, chunk);
        } }), createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
        const after = await handle.stat();
        if (before.size !== after.size || copied !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("The file changed while saving. Finish the export and add it again.");
        const sha256 = hash.digest("hex");
        const fileName = cleanText(path.basename(source));
        const format = path.extname(fileName).slice(1).toLowerCase();
        const groupKey = `${cleanText(project, 2048)}\n${path.join(path.dirname(source), path.parse(source).name)}`;
        let item = itemId ? catalog.items.find((entry) => entry.id === itemId) : catalog.items.find((entry) => entry.groupKey === groupKey);
        if (itemId && !item) throw new Error("The chosen Files entry no longer exists.");
        if (item?.versions.some((version) => version.sha256 === sha256 && version.fileName === fileName)) return this.publicItem(item);
        if (bytesUsed + copied > libraryByteLimit) throw new Error("The local Files library reached its 10 GB limit. Existing files are preserved.");
        if (!item && catalog.items.length >= 5_000) throw new Error("The Files library reached its 5,000 document limit.");
        if (item && item.versions.length >= 200) throw new Error("This document reached its 200-version limit.");
        const now = new Date().toISOString();
        if (!item) {
          item = { id: crypto.randomUUID(), title: cleanText(title) || cleanText(path.parse(source).name), project: cleanText(project, 2048), thread: cleanText(thread, 256), pinned: false, archived: false, createdAt: now, updatedAt: now, groupKey, versions: [] };
          catalog.items.push(item);
        }
        if (title) item.title = cleanText(title);
        if (thread) item.thread = cleanText(thread);
        item.updatedAt = now;
        item.archived = false;
        item.versions.push({ id: versionId, fileName, format, mimeType: mimeTypes[format] || "application/octet-stream", size: copied, sha256, createdAt: now, sourcePath: source });
        await rename(temporary, path.join(objects, versionId));
        objectCommitted = true;
        try { await this.save(catalog); }
        catch (error) { await rm(path.join(objects, versionId), { force: true }); throw error; }
        return this.publicItem(item);
      } finally {
        await handle.close();
        if (!objectCommitted) await rm(temporary, { force: true });
      }
    });
  }

  publicItem(item) {
    const { groupKey, ...metadata } = item;
    return { ...metadata, versions: item.versions.map(({ sourcePath, ...version }) => version) };
  }

  async list({ query = "", project = "", archived = false, pinned = false, format = "", cursor = 0, limit = 40 } = {}) {
    const catalog = await this.catalog();
    const needle = cleanText(query).toLowerCase();
    const all = catalog.items.filter((item) => Boolean(item.archived) === Boolean(archived) && (!pinned || item.pinned) && (!project || item.project === (project === "__personal__" ? "" : project)) && (!format || item.versions.some((version) => version.format === format)) && (!needle || [item.title, item.project, ...item.versions.map((version) => version.fileName)].join("\n").toLowerCase().includes(needle)))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    const start = Math.max(0, Math.floor(Number(cursor) || 0));
    const count = Math.max(1, Math.min(50, Math.floor(Number(limit) || 40)));
    return { revision: catalog.revision, items: all.slice(start, start + count).map((item) => this.publicItem(item)), nextCursor: start + count < all.length ? start + count : null, total: all.length,
      projects: [...new Set(catalog.items.map((item) => item.project))].sort(),
      formats: [...new Set(catalog.items.flatMap((item) => item.versions.map((version) => version.format)))].sort(),
      bytesUsed: catalog.items.flatMap((item) => item.versions).reduce((sum, version) => sum + version.size, 0), byteLimit: libraryByteLimit, fileLimit: libraryFileLimit };
  }

  async update({ id, title, pinned, archived }) {
    return this.locked(async () => {
      const catalog = await this.catalog({ mutable: true });
      const item = catalog.items.find((entry) => entry.id === id);
      if (!item) throw new Error("This file is no longer in the library.");
      if (title !== undefined) { if (!cleanText(title)) throw new Error("A title is required."); item.title = cleanText(title); }
      if (typeof pinned === "boolean") item.pinned = pinned;
      if (typeof archived === "boolean") item.archived = archived;
      await this.save(catalog);
      return this.publicItem(item);
    });
  }

  async resolve(id, versionId) {
    if (!uuidPattern.test(String(id)) || !uuidPattern.test(String(versionId))) throw new Error("Invalid file identifier.");
    const item = (await this.catalog()).items.find((entry) => entry.id === id);
    const version = item?.versions.find((entry) => entry.id === versionId);
    if (!version) throw new Error("This file version is unavailable on the Mac.");
    const handle = await open(path.join(this.root, "objects", versionId), constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.size !== version.size) { await handle.close(); throw new Error("This saved file needs repair on the Mac."); }
    return { handle, version };
  }

  async chunk({ id, versionId, offset = 0, length = libraryChunkBytes }) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > libraryChunkBytes) throw new Error("Invalid file chunk range.");
    const { handle, version } = await this.resolve(id, versionId);
    try {
      if (offset > version.size) throw new Error("The download offset exceeds this file.");
      const buffer = Buffer.alloc(Math.min(length, version.size - offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      return { id, versionId, offset, total: version.size, sha256: version.sha256, nextOffset: offset + bytesRead, eof: offset + bytesRead === version.size, dataBase64: buffer.subarray(0, bytesRead).toString("base64") };
    } finally { await handle.close(); }
  }
}

export async function runFilesCommand(args) {
  const [action = "list", ...rest] = args;
  const library = new LocalFileLibrary();
  const option = (name) => { const index = rest.indexOf(name); return index >= 0 ? rest[index + 1] || "" : ""; };
  if (action === "add") {
    const item = await library.add({ sourcePath: path.resolve(rest[0] || ""), project: option("--project"), thread: option("--thread"), title: option("--title"), itemId: option("--item") });
    console.log(JSON.stringify({ ok: true, item }));
  } else if (action === "list") {
    console.log(JSON.stringify(await library.list({ query: option("--search"), archived: rest.includes("--archived") })));
  } else { throw new Error("Use: clawdad files add /absolute/file [--project path] [--thread id] [--title title] [--item id], or clawdad files list"); }
}
