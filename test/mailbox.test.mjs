import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileP = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

async function withTempProject(work) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-mailbox-test-"));
  const projectPath = path.join(root, "project");
  const homePath = path.join(root, "home");
  await mkdir(projectPath, { recursive: true });
  await mkdir(homePath, { recursive: true });
  try {
    return await work({ root, projectPath, homePath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runMailboxScript({ projectPath, homePath, script, env = {} }) {
  const sourceCommon = shellQuote(path.join(repoRoot, "lib", "common.sh"));
  const sourceLog = shellQuote(path.join(repoRoot, "lib", "log.sh"));
  const sourceMailbox = shellQuote(path.join(repoRoot, "lib", "mailbox.sh"));
  const sourceHistory = shellQuote(path.join(repoRoot, "lib", "history.sh"));
  const command = `
set -euo pipefail
source ${sourceCommon}
source ${sourceLog}
source ${sourceMailbox}
source ${sourceHistory}
${script}
`;

  return execFileP("zsh", ["-lc", command], {
    env: {
      ...process.env,
      CLAWDAD_ROOT: repoRoot,
      CLAWDAD_HOME: homePath,
      CLAWDAD_LOG: path.join(homePath, "clawdad.log"),
      PROJECT_PATH: projectPath,
      ...env,
    },
  });
}

async function readMailboxStatus(projectPath) {
  const raw = await readFile(path.join(projectPath, ".clawdad", "mailbox", "status.json"), "utf8");
  return JSON.parse(raw);
}

test("mailbox_update_status JSON-encodes multiline quoted errors", async () => {
  await withTempProject(async ({ projectPath, homePath }) => {
    const errorText = [
      'codex turn did not complete within 1795s',
      'RuntimeError: "mat1" cannot be multiplied by path C:\\tmp\\model',
      "write_stdin failed:\tstdin is closed for this session",
    ].join("\n");

    await runMailboxScript({
      projectPath,
      homePath,
      env: { MAILBOX_ERROR: errorText },
      script: 'mailbox_update_status "$PROJECT_PATH" failed "req-quoted" "" "$MAILBOX_ERROR" "sess-quoted"',
    });

    const status = await readMailboxStatus(projectPath);
    assert.equal(status.state, "failed");
    assert.equal(status.request_id, "req-quoted");
    assert.equal(status.session_id, "sess-quoted");
    assert.equal(status.error, errorText);
    assert.equal(status.pid, null);
    assert.match(status.completed_at, /^20\d\d-\d\d-\d\dT/u);
  });
});

test("mailbox_update_status preserves dispatched_at from valid prior status", async () => {
  await withTempProject(async ({ projectPath, homePath }) => {
    await runMailboxScript({
      projectPath,
      homePath,
      script: 'mailbox_update_status "$PROJECT_PATH" running "req-preserve" "12345" "" "sess-preserve"',
    });

    const running = await readMailboxStatus(projectPath);
    assert.equal(running.state, "running");
    assert.equal(running.pid, 12345);
    assert.match(running.dispatched_at, /^20\d\d-\d\d-\d\dT/u);
    assert.match(running.heartbeat_at, /^20\d\d-\d\d-\d\dT/u);

    await runMailboxScript({
      projectPath,
      homePath,
      env: { MAILBOX_ERROR: "later failure" },
      script: 'mailbox_update_status "$PROJECT_PATH" failed "req-preserve" "" "$MAILBOX_ERROR" "sess-preserve"',
    });

    const failed = await readMailboxStatus(projectPath);
    assert.equal(failed.state, "failed");
    assert.equal(failed.dispatched_at, running.dispatched_at);
    assert.equal(failed.heartbeat_at, running.heartbeat_at);
    assert.equal(failed.error, "later failure");
  });
});

test("mailbox_update_heartbeat refreshes live dispatches without resetting dispatched_at", async () => {
  await withTempProject(async ({ projectPath, homePath }) => {
    await runMailboxScript({
      projectPath,
      homePath,
      script: [
        'mailbox_update_status "$PROJECT_PATH" running "req-heartbeat" "12345" "" "sess-heartbeat"',
        "sleep 1",
        'mailbox_update_heartbeat "$PROJECT_PATH" "req-heartbeat" "12346" "sess-heartbeat"',
      ].join("\n"),
    });

    const status = await readMailboxStatus(projectPath);
    assert.equal(status.state, "running");
    assert.equal(status.request_id, "req-heartbeat");
    assert.equal(status.session_id, "sess-heartbeat");
    assert.equal(status.pid, 12346);
    assert.match(status.dispatched_at, /^20\d\d-\d\d-\d\dT/u);
    assert.match(status.heartbeat_at, /^20\d\d-\d\d-\d\dT/u);
    assert.notEqual(status.heartbeat_at, status.dispatched_at);
  });
});

test("mailbox_update_heartbeat ignores stale request ids", async () => {
  await withTempProject(async ({ projectPath, homePath }) => {
    await runMailboxScript({
      projectPath,
      homePath,
      script: [
        'mailbox_update_status "$PROJECT_PATH" running "req-current" "12345" "" "sess-current"',
        'mailbox_update_heartbeat "$PROJECT_PATH" "req-old" "99999" "sess-old"',
      ].join("\n"),
    });

    const status = await readMailboxStatus(projectPath);
    assert.equal(status.request_id, "req-current");
    assert.equal(status.session_id, "sess-current");
    assert.equal(status.pid, 12345);
  });
});

test("mailbox_update_status tolerates malformed prior status", async () => {
  await withTempProject(async ({ projectPath, homePath }) => {
    const mailboxDir = path.join(projectPath, ".clawdad", "mailbox");
    await mkdir(mailboxDir, { recursive: true });
    await writeFile(
      path.join(mailboxDir, "status.json"),
      '{"state":"running","request_id":"req-bad","error":"unterminated\nraw"}\n',
      "utf8",
    );

    await runMailboxScript({
      projectPath,
      homePath,
      env: { MAILBOX_ERROR: 'safe replacement with "quotes" and\nnewlines' },
      script: 'mailbox_update_status "$PROJECT_PATH" failed "req-bad" "" "$MAILBOX_ERROR" "sess-bad"',
    });

    const status = await readMailboxStatus(projectPath);
    assert.equal(status.state, "failed");
    assert.equal(status.request_id, "req-bad");
    assert.equal(status.session_id, "sess-bad");
    assert.equal(status.error, 'safe replacement with "quotes" and\nnewlines');
    assert.equal(status.dispatched_at, null);
  });
});

test("completed mailbox request ignores late failed status and response writes", async () => {
  await withTempProject(async ({ projectPath, homePath }) => {
    await runMailboxScript({
      projectPath,
      homePath,
      env: { LATE_ERROR: "dispatch worker terminated" },
      script: [
        'mailbox_update_status "$PROJECT_PATH" running "req-recovered" "12345" "" "sess-recovered"',
        'mailbox_write_response "$PROJECT_PATH" "req-recovered" "sess-recovered" "0" "completed decision"',
        'mailbox_update_status "$PROJECT_PATH" completed "req-recovered" "" "" "sess-recovered"',
        'mailbox_write_response "$PROJECT_PATH" "req-recovered" "sess-recovered" "143" "$LATE_ERROR"',
        'mailbox_update_status "$PROJECT_PATH" failed "req-recovered" "" "$LATE_ERROR" "sess-recovered"',
      ].join("\n"),
    });

    const status = await readMailboxStatus(projectPath);
    assert.equal(status.state, "completed");
    assert.equal(status.request_id, "req-recovered");
    assert.equal(status.session_id, "sess-recovered");
    assert.equal(status.error, null);
    assert.equal(status.pid, null);

    const response = await readFile(path.join(projectPath, ".clawdad", "mailbox", "response.md"), "utf8");
    assert.match(response, /completed decision/u);
    assert.doesNotMatch(response, /dispatch worker terminated/u);
  });
});

test("history_update_result ignores late failed result after answered request", async () => {
  await withTempProject(async ({ projectPath, homePath }) => {
    await runMailboxScript({
      projectPath,
      homePath,
      env: { LATE_ERROR: "dispatch worker terminated" },
      script: [
        'sent_at="$(iso_timestamp)"',
        'history_write_request "$PROJECT_PATH" "req-history" "sess-history" "History Session" "codex" "prompt" "$sent_at"',
        'history_update_result "$PROJECT_PATH" "req-history" "sess-history" "History Session" "codex" "answered" "0" "$(iso_timestamp)" "completed answer"',
        'history_update_result "$PROJECT_PATH" "req-history" "sess-history" "History Session" "codex" "failed" "143" "$(iso_timestamp)" "$LATE_ERROR"',
      ].join("\n"),
    });

    const index = JSON.parse(
      await readFile(path.join(projectPath, ".clawdad", "history", "requests", "req-history.json"), "utf8"),
    );
    const record = JSON.parse(await readFile(index.file, "utf8"));
    assert.equal(record.status, "answered");
    assert.equal(record.exitCode, 0);
    assert.equal(record.response, "completed answer");
  });
});
