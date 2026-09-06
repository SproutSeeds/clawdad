import crypto from "node:crypto";
import path from "node:path";
import { constants } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { LocalFileLibrary, libraryByteLimit } from "./local-file-library.mjs";

export const imageFileLimit = 20 * 1024 * 1024;
const pendingByteLimit = 160 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(message); };

export function validateImageUpload(upload) {
  if (!upload || !uuid.test(upload.id) || !Number.isSafeInteger(upload.size) || upload.size <= 0 || upload.size > imageFileLimit ||
      !/^[0-9a-f]{64}$/u.test(upload.sha256) || typeof upload.fileName !== "string" || !upload.fileName ||
      Buffer.byteLength(upload.fileName) > 180 || /[\/\\\u0000-\u001f\u007f]/u.test(upload.fileName) || upload.fileName.startsWith(".")) fail("Choose a PNG or JPEG image up to 20 MB.");
  const ext = path.extname(upload.fileName).toLowerCase();
  if (!(upload.mimeType === "image/png" && ext === ".png") && !(upload.mimeType === "image/jpeg" && [".jpg", ".jpeg"].includes(ext))) fail("Choose a PNG or JPEG image.");
  return { id: upload.id, fileName: upload.fileName, mimeType: upload.mimeType, size: upload.size, sha256: upload.sha256 };
}

function validateImageBytes(bytes, mimeType) {
  const png = bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!(mimeType === "image/png" ? png : jpeg)) fail("The received file is not a readable image. Choose it again.");
}

/** Paired-device uploads are local, resumable, atomic, and separate from finished documents. */
export class LocalImageInbox {
  constructor(library = new LocalFileLibrary()) { this.library = library; this.pending = path.join(library.root, ".incoming"); }
  ownerKey(owner) {
    if (typeof owner !== "string" || !owner || Buffer.byteLength(owner) > 256) fail("A paired device is required.");
    return digest(Buffer.from(owner));
  }
  receipt(upload, item) {
    return { uploadId: upload.id, offset: upload.size, complete: true, itemId: item.id, versionId: item.versions[0].id };
  }
  checkOwner(entry, owner, upload) {
    if (entry.owner !== owner || JSON.stringify(entry.upload) !== JSON.stringify(upload)) fail("This upload belongs to a different image or device. Choose the image again.");
  }
  async request({ action, owner, upload: raw, offset, bytes: base64 }) {
    const upload = validateImageUpload(raw);
    const ownerKey = this.ownerKey(owner);
    if (!["uploadBegin", "uploadChunk", "uploadFinish", "uploadCancel"].includes(action)) fail("Unknown image upload action.");
    return this.library.locked(async () => {
      const catalog = await this.library.catalog({ mutable: true });
      const complete = catalog.items.find((item) => item.uploadId === upload.id);
      if (complete) {
        const version = complete.versions[0];
        this.checkOwner({ owner: complete.uploadOwner, upload: { id: upload.id, fileName: version.fileName, mimeType: version.mimeType, size: version.size, sha256: version.sha256 } }, ownerKey, upload);
        return this.receipt(upload, complete);
      }
      await mkdir(this.pending, { recursive: true, mode: 0o700 });
      const manifest = path.join(this.pending, `${upload.id}.json`);
      const partial = path.join(this.pending, `${upload.id}.partial`);
      let entry;
      try { entry = JSON.parse(await readFile(manifest, "utf8")); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (entry) this.checkOwner(entry, ownerKey, upload);
      if (action === "uploadCancel") {
        if (entry) { await rm(partial, { force: true }); await rm(manifest, { force: true }); }
        return { uploadId: upload.id, offset: 0, complete: false };
      }
      if (!entry) {
        if (action !== "uploadBegin") fail("Reconnect and resume this image upload.");
        if (catalog.items.some((item) => item.id === upload.id)) fail("This image identifier is already in use. Choose the image again.");
        let reserved = 0, count = 0;
        for (const name of await readdir(this.pending)) {
          if (!/^[0-9a-f-]{36}\.json$/u.test(name)) continue;
          const file = path.join(this.pending, name);
          const previous = JSON.parse(await readFile(file, "utf8"));
          if (Date.now() - previous.createdAt > 24 * 60 * 60 * 1000) {
            // Only expired, uncommitted transfer scratch is removed.
            await rm(path.join(this.pending, name.replace(/\.json$/u, ".partial")), { force: true });
            await rm(file, { force: true });
          } else { reserved += previous.upload.size; count++; }
        }
        const used = catalog.items.flatMap((item) => item.versions).reduce((sum, version) => sum + version.size, 0);
        if (reserved + upload.size > pendingByteLimit || count >= 16 || used + reserved + upload.size > libraryByteLimit || catalog.items.length >= 5000) fail("The Mac image inbox is full. Finish or cancel pending transfers first.");
        entry = { owner: ownerKey, upload, createdAt: Date.now() };
        await writeFile(manifest, JSON.stringify(entry), { flag: "wx", mode: 0o600 });
        try { await writeFile(partial, Buffer.alloc(0), { flag: "wx", mode: 0o600 }); }
        catch (error) { await rm(manifest, { force: true }); throw error; }
      }
      // Recover a process exit between the final file rename and catalog commit,
      // or between creating the reservation and its empty partial file.
      try { await stat(partial); }
      catch (error) {
        if (error.code !== "ENOENT") throw error;
        const destination = path.join(this.library.root, "received", upload.id, upload.fileName);
        try {
          const saved = await open(destination, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            const info = await saved.stat();
            if (!info.isFile() || info.size !== upload.size || digest(await saved.readFile()) !== upload.sha256) fail("The saved image needs to be selected again.");
          } finally { await saved.close(); }
          await rename(destination, partial);
        } catch (recovery) {
          if (recovery.code !== "ENOENT") throw recovery;
          await writeFile(partial, Buffer.alloc(0), { flag: "wx", mode: 0o600 });
        }
      }
      const handle = await open(partial, constants.O_RDWR | constants.O_NOFOLLOW);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > upload.size) fail("The partial image needs to be selected again.");
        if (action === "uploadBegin") return { uploadId: upload.id, offset: info.size, complete: false };
        if (action === "uploadChunk") {
          if (typeof base64 !== "string" || base64.length > 176 * 1024 || !Number.isSafeInteger(offset) || offset < 0) fail("Invalid image chunk.");
          const bytes = Buffer.from(base64, "base64");
          if (!bytes.length || bytes.length > 128 * 1024 || bytes.toString("base64") !== base64 || offset + bytes.length > upload.size || offset > info.size) fail("Invalid image chunk range.");
          if (offset < info.size) {
            if (offset + bytes.length > info.size) fail("Resume the image from its confirmed offset.");
            const existing = Buffer.alloc(bytes.length);
            await handle.read(existing, 0, existing.length, offset);
            if (!existing.equals(bytes)) fail("The retried image chunk changed.");
          } else {
            let written = 0;
            while (written < bytes.length) {
              const result = await handle.write(bytes, written, bytes.length - written, offset + written);
              if (!result.bytesWritten) fail("The Mac could not save this image chunk.");
              written += result.bytesWritten;
            }
          }
          return { uploadId: upload.id, offset: Math.max(info.size, offset + bytes.length), complete: false };
        }
        if (info.size !== upload.size) fail("The image has not finished transferring.");
        const bytes = await handle.readFile();
        if (digest(bytes) !== upload.sha256) fail("The image failed its integrity check. Cancel and choose it again.");
        validateImageBytes(bytes, upload.mimeType);
        await handle.sync();
      } finally { await handle.close(); }
      const directory = path.join(this.library.root, "received", upload.id);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const destination = path.join(directory, upload.fileName);
      await rename(partial, destination);
      const now = new Date().toISOString();
      const item = { id: upload.id, uploadId: upload.id, uploadOwner: ownerKey, category: "receivedImages", title: path.parse(upload.fileName).name,
        project: "", thread: "", pinned: false, archived: false, createdAt: now, updatedAt: now,
        versions: [{ id: upload.id, fileName: upload.fileName, mimeType: upload.mimeType, format: path.extname(upload.fileName).slice(1).toLowerCase(), size: upload.size, sha256: upload.sha256, createdAt: now, storagePath: path.join("received", upload.id, upload.fileName) }] };
      catalog.items.push(item);
      try { await this.library.save(catalog); }
      catch (error) { await rename(destination, partial); throw error; }
      await rm(manifest, { force: true });
      return this.receipt(upload, item);
    });
  }

  async resolve({ owner, uploadIds }) {
    const ownerKey = this.ownerKey(owner);
    if (!Array.isArray(uploadIds) || !uploadIds.length || uploadIds.length > 8 || new Set(uploadIds).size !== uploadIds.length || !uploadIds.every((id) => uuid.test(id))) fail("Choose up to eight received images.");
    const catalog = await this.library.catalog();
    const images = [];
    for (const id of uploadIds) {
      const item = catalog.items.find((item) => item.uploadId === id && item.uploadOwner === ownerKey);
      if (!item) fail("This image has not finished transferring from this iPhone.");
      const { handle, version } = await this.library.resolve(item.id, item.versions[0].id);
      try {
        const bytes = await handle.readFile();
        if (digest(bytes) !== version.sha256) fail("This saved image changed on the Mac. Choose it again.");
      } finally { await handle.close(); }
      images.push({ path: this.library.receivedImagePath(item.versions[0]), sha256: item.versions[0].sha256, size: item.versions[0].size });
    }
    if (images.reduce((sum, image) => sum + image.size, 0) > 80 * 1024 * 1024) fail("Choose a smaller group of images.");
    return { images };
  }
}
