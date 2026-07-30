import crypto from "node:crypto";
import process from "node:process";
import path from "node:path";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processIsLive(pid) {
  const normalized = Number.parseInt(String(pid || "0"), 10);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return false;
  }
  try {
    process.kill(normalized, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function readOwner(ownerFile) {
  return JSON.parse(await readFile(ownerFile, "utf8").catch(() => "{}"));
}

async function writeOwner(ownerFile, owner) {
  const tempFile = `${ownerFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(owner, null, 2)}\n`, "utf8");
  await rename(tempFile, ownerFile);
}

export async function acquireDispatchAdmissionLock(
  projectPath,
  {
    timeoutMs = 15_000,
    pollMs = 25,
  } = {},
) {
  const mailboxDir = path.join(projectPath, ".clawdad", "mailbox");
  const lockDir = path.join(mailboxDir, "dispatch-admission.lock");
  const ownerFile = path.join(lockDir, "owner.json");
  const token = crypto.randomUUID();
  const startedAt = Date.now();
  await mkdir(mailboxDir, { recursive: true });

  for (;;) {
    try {
      await mkdir(lockDir, { recursive: false });
      await writeOwner(ownerFile, {
        pid: process.pid,
        token,
        acquiredAt: new Date().toISOString(),
      });
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
    }

    const owner = await readOwner(ownerFile);
    if (!processIsLive(owner?.pid)) {
      await rm(lockDir, { recursive: true, force: true }).catch(() => {});
      continue;
    }
    if (Date.now() - startedAt >= timeoutMs) {
      const lockError = new Error(
        `timed out waiting for dispatch admission in ${projectPath}; owner pid=${owner.pid}`,
      );
      lockError.code = "CLAWDAD_DISPATCH_ADMISSION_TIMEOUT";
      throw lockError;
    }
    await sleep(pollMs);
  }

  let owned = true;
  return {
    lockDir,
    ownerFile,
    token,
    async transfer(pid) {
      if (!owned) {
        return;
      }
      const normalizedPid = Number.parseInt(String(pid || "0"), 10);
      if (!Number.isFinite(normalizedPid) || normalizedPid <= 0) {
        throw new Error("cannot transfer dispatch admission without a live child pid");
      }
      const current = await readOwner(ownerFile);
      if (current?.token !== token) {
        owned = false;
        return;
      }
      await writeOwner(ownerFile, {
        ...current,
        pid: normalizedPid,
        transferredAt: new Date().toISOString(),
      });
      owned = false;
    },
    async release() {
      if (!owned) {
        return;
      }
      owned = false;
      const current = await readOwner(ownerFile);
      if (current?.token === token) {
        await rm(lockDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}
