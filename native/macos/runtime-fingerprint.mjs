import crypto from "node:crypto";
import path from "node:path";
import { createReadStream } from "node:fs";
import { readdir, lstat } from "node:fs/promises";
const root = path.resolve(process.argv[2]);
const hash = crypto.createHash("sha256");
async function add(relative) {
  const file = path.join(root, relative);
  const info = await lstat(file);
  if (info.isDirectory()) {
    for (const name of (await readdir(file)).sort()) await add(path.join(relative, name));
  } else if (info.isFile()) {
    hash.update(relative); hash.update("\0");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
  }
}
for (const entry of ["package.json", "bin", "lib", "web", "templates", "assets", "node_modules/open-research-protocol/package.json"]) await add(entry);
process.stdout.write(hash.digest("hex") + "\n");
