import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  const root = await mkdtemp(path.join(os.tmpdir(), "clawdad-registry-test-"));
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

async function createMockOrp(root) {
  const mockPath = path.join(root, "mock-orp");
  await writeFile(
    mockPath,
    `#!/bin/sh
set -eu

if [ "\${1:-}" = "workspace" ] && [ "\${2:-}" = "tabs" ]; then
  if [ -n "\${MOCK_ORP_TABS:-}" ]; then
    printf '%s\\n' "\$MOCK_ORP_TABS"
  else
    printf '%s\\n' '{"tabs":[]}'
  fi
  exit 0
fi

if [ "\${1:-}" = "workspace" ] && [ "\${2:-}" = "add-tab" ]; then
  printf '%s\\n' "error: Notes must be <= 10000 characters" >&2
  exit 1
fi

if [ "\${1:-}" = "workspace" ] && [ "\${2:-}" = "remove-tab" ]; then
  printf '%s\\n' "error: tab not found" >&2
  exit 1
fi

printf 'unexpected mock orp command: %s\\n' "$*" >&2
exit 2
`,
    "utf8",
  );
  await chmod(mockPath, 0o755);
  return mockPath;
}

async function runRegistryScript({ root, projectPath, homePath, script, env = {} }) {
  const mockOrp = await createMockOrp(root);
  const sourceCommon = shellQuote(path.join(repoRoot, "lib", "common.sh"));
  const sourceLog = shellQuote(path.join(repoRoot, "lib", "log.sh"));
  const sourceRegistry = shellQuote(path.join(repoRoot, "lib", "registry.sh"));
  const command = `
set -euo pipefail
source ${sourceCommon}
source ${sourceLog}
source ${sourceRegistry}
${script}
`;

  const orpTabs = {
    tabs: [
      {
        title: "main mind",
        path: projectPath,
        resumeTool: "codex",
        resumeSessionId: "main-session",
      },
    ],
  };

  return execFileP("zsh", ["-fc", command], {
    env: {
      ...process.env,
      CLAWDAD_ROOT: repoRoot,
      CLAWDAD_HOME: homePath,
      CLAWDAD_LOG: path.join(homePath, "clawdad.log"),
      CLAWDAD_ORP: mockOrp,
      CLAWDAD_ORP_WORKSPACE: "main",
      MOCK_ORP_TABS: JSON.stringify(orpTabs),
      PROJECT_PATH: projectPath,
      ...env,
    },
  });
}

async function readState(homePath) {
  return JSON.parse(await readFile(path.join(homePath, "state.json"), "utf8"));
}

test("shell registry state updates are serialized across processes", async () => {
  await withTempProject(async ({ root, projectPath, homePath }) => {
    const { stdout } = await runRegistryScript({
      root,
      projectPath,
      homePath,
      script: `
state_ensure_project "$PROJECT_PATH"
for i in $(seq 1 40); do
  (
    state_register_session "$PROJECT_PATH" "session-$i" "session $i" "codex" "true"
    state_update_session "$PROJECT_PATH" "session-$i" "status" "completed"
  ) &
done
wait
"$CLAWDAD_JQ" -c --arg path "$PROJECT_PATH" '{
  count: ((.projects[$path].sessions // {}) | length),
  completedCount: ((.projects[$path].sessions // {}) | to_entries | map(select(.value.status == "completed")) | length)
}' "$CLAWDAD_STATE"
`,
    });

    const result = JSON.parse(stdout);
    assert.equal(result.count, 40);
    assert.equal(result.completedCount, 40);
  });
});

test("shell registry stale-lock mtime supports Linux stat output", async () => {
  await withTempProject(async ({ root, projectPath, homePath }) => {
    const { stdout } = await runRegistryScript({
      root,
      projectPath,
      homePath,
      script: `
stat() {
  if [[ "$1" == "-f" ]]; then
    return 1
  fi
  if [[ "$1" == "-c" && "$2" == "%Y" ]]; then
    printf '123456\\n'
    return 0
  fi
  return 2
}
mtime=$(_state_path_mtime "$CLAWDAD_HOME")
"$CLAWDAD_JQ" -n --arg mtime "$mtime" '{ mtime: $mtime }'
`,
    });

    const result = JSON.parse(stdout);
    assert.equal(result.mtime, "123456");
  });
});

test("shell registry records durable aliases when a provisional session is rekeyed", async () => {
  await withTempProject(async ({ root, projectPath, homePath }) => {
    const { stdout } = await runRegistryScript({
      root,
      projectPath,
      homePath,
      script: `
state_ensure_project "$PROJECT_PATH"
state_register_session "$PROJECT_PATH" "provisional-session" "Fresh thread" "codex" "false"
state_set_active_session "$PROJECT_PATH" "provisional-session"
state_rekey_session "$PROJECT_PATH" "provisional-session" "real-session" "Fresh thread" "codex" "true"
"$CLAWDAD_JQ" -c --arg path "$PROJECT_PATH" '{
  activeSessionId: .projects[$path].active_session_id,
  aliases: .projects[$path].session_aliases,
  sessionIds: (.projects[$path].sessions | keys)
}' "$CLAWDAD_STATE"
`,
    });

    const result = JSON.parse(stdout);
    assert.equal(result.activeSessionId, "real-session");
    assert.equal(result.aliases["provisional-session"], "real-session");
    assert.deepEqual(result.sessionIds, ["real-session"]);
  });
});

test("dispatch idle-sleep assertion follows the active worker pid", async () => {
  await withTempProject(async ({ root, projectPath, homePath }) => {
    const mockCaffeinate = path.join(root, "mock-caffeinate");
    const capturePath = path.join(root, "caffeinate-args.txt");
    await writeFile(
      mockCaffeinate,
      `#!/bin/sh
printf '%s\n' "$*" > "$CLAWDAD_CAFFEINATE_CAPTURE"
while kill -0 "\${3:-0}" 2>/dev/null; do
  sleep 0.02
done
`,
      "utf8",
    );
    await chmod(mockCaffeinate, 0o755);

    const sourceMailbox = shellQuote(path.join(repoRoot, "lib", "mailbox.sh"));
    const sourceHistory = shellQuote(path.join(repoRoot, "lib", "history.sh"));
    const sourceDispatch = shellQuote(path.join(repoRoot, "lib", "dispatch.sh"));
    const { stdout } = await runRegistryScript({
      root,
      projectPath,
      homePath,
      env: {
        CLAWDAD_CAFFEINATE_BIN: mockCaffeinate,
        CLAWDAD_CAFFEINATE_CAPTURE: capturePath,
      },
      script: `
source ${sourceMailbox}
source ${sourceHistory}
source ${sourceDispatch}
sleep 5 &
worker_pid=$!
_dispatch_start_idle_sleep_assertion "$worker_pid"
power_pid="$_CLAWDAD_DISPATCH_POWER_PID"
for _ in {1..100}; do
  [[ -f "$CLAWDAD_CAFFEINATE_CAPTURE" ]] && break
  sleep 0.02
done
power_live=false
kill -0 "$power_pid" 2>/dev/null && power_live=true
kill -TERM "$worker_pid"
wait "$worker_pid" 2>/dev/null || true
_dispatch_stop_idle_sleep_assertion
args=$(cat "$CLAWDAD_CAFFEINATE_CAPTURE")
"$CLAWDAD_JQ" -n --arg args "$args" --argjson workerPid "$worker_pid" --arg powerLive "$power_live" '{
  args: $args,
  workerPid: $workerPid,
  powerLive: ($powerLive == "true")
}'
`,
    });

    const result = JSON.parse(stdout);
    assert.equal(result.powerLive, true);
    assert.equal(result.args, `-i -w ${result.workerPid}`);
  });
});

test("dispatch treats dispatched mailbox state as busy", async () => {
  await withTempProject(async ({ root, projectPath, homePath }) => {
    const mockCodex = path.join(root, "mock-codex");
    await writeFile(mockCodex, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(mockCodex, 0o755);

    const sourceMailbox = shellQuote(path.join(repoRoot, "lib", "mailbox.sh"));
    const sourceHistory = shellQuote(path.join(repoRoot, "lib", "history.sh"));
    const sourceDispatch = shellQuote(path.join(repoRoot, "lib", "dispatch.sh"));
    const { stdout } = await runRegistryScript({
      root,
      projectPath,
      homePath,
      env: {
        CLAWDAD_CODEX: mockCodex,
      },
      script: `
source ${sourceMailbox}
source ${sourceHistory}
source ${sourceDispatch}
_build_dispatch_command() {
  clawdad_error "busy guard did not stop dispatch"
  return 1
}
state_ensure_project "$PROJECT_PATH"
state_register_session "$PROJECT_PATH" "busy-session" "busy session" "codex" "false"
state_set_active_session "$PROJECT_PATH" "busy-session"
mailbox_init "$PROJECT_PATH"
mailbox_update_status "$PROJECT_PATH" "dispatched" "req-busy" "" "" "busy-session"
err_file="$CLAWDAD_HOME/dispatch.err"
if dispatch_to_spoke "$PROJECT_PATH" "second prompt" "" "" "" "true" 2>"$err_file"; then
  dispatch_status=0
else
  dispatch_status=$?
fi
err_text=$(cat "$err_file")
"$CLAWDAD_JQ" -n --arg err "$err_text" --argjson status "$dispatch_status" '{ status: $status, error: $err }'
`,
    });

    const result = JSON.parse(stdout);
    assert.notEqual(result.status, 0);
    assert.match(result.error, /dispatch in flight/u);
    assert.doesNotMatch(result.error, /busy guard did not stop dispatch/u);
  });
});

test("dispatch writes recovered Codex failure text instead of raw JSON", async () => {
  await withTempProject(async ({ root, projectPath, homePath }) => {
    const fakeChild = path.join(root, "fake-recovered-codex.mjs");
    await writeFile(
      fakeChild,
      `#!/usr/bin/env node
console.log(JSON.stringify({
  ok: false,
  recovered: true,
  recovery_reason: "tool_idle_timeout",
  session_id: "sess-recovered",
  result_text: "Recovered partial text for the user",
  error_text: "Recovered partial text for the user"
}));
process.exitCode = 124;
`,
      "utf8",
    );
    await chmod(fakeChild, 0o755);

    const sourceMailbox = shellQuote(path.join(repoRoot, "lib", "mailbox.sh"));
    const sourceHistory = shellQuote(path.join(repoRoot, "lib", "history.sh"));
    const sourceDispatch = shellQuote(path.join(repoRoot, "lib", "dispatch.sh"));
    const { stdout } = await runRegistryScript({
      root,
      projectPath,
      homePath,
      env: {
        FAKE_CHILD: fakeChild,
        NODE_BIN: process.execPath,
      },
      script: `
source ${sourceMailbox}
source ${sourceHistory}
source ${sourceDispatch}
state_ensure_project "$PROJECT_PATH"
state_register_session "$PROJECT_PATH" "sess-recovered" "Recovered Session" "codex" "false"
state_set_active_session "$PROJECT_PATH" "sess-recovered"
mailbox_init "$PROJECT_PATH"
history_init "$PROJECT_PATH"
sent_at="$(iso_timestamp)"
history_write_request "$PROJECT_PATH" "req-recovered" "sess-recovered" "Recovered Session" "codex" "prompt" "$sent_at"
mailbox_write_request "$PROJECT_PATH" "req-recovered" "prompt"
mailbox_update_status "$PROJECT_PATH" "running" "req-recovered" "$$" "" "sess-recovered"
_build_dispatch_command() {
  cmd=( "$NODE_BIN" "$FAKE_CHILD" )
}
_dispatch_background "$PROJECT_PATH" "req-recovered" "sess-recovered" "Recovered Session" "codex" "false" "0" "approve" "" "true" "prompt" "" || true
status_json=$(cat "$PROJECT_PATH/.clawdad/mailbox/status.json")
response_text=$(cat "$PROJECT_PATH/.clawdad/mailbox/response.md")
record_file=$("$CLAWDAD_JQ" -r '.file' "$PROJECT_PATH/.clawdad/history/requests/req-recovered.json")
record_json=$(cat "$record_file")
state_json=$(cat "$CLAWDAD_HOME/state.json")
"$CLAWDAD_JQ" -n --argjson status "$status_json" --arg response "$response_text" --argjson record "$record_json" --argjson state "$state_json" '{ status: $status, response: $response, record: $record, state: $state }'
`,
    });

    const result = JSON.parse(stdout);
    assert.equal(result.status.state, "failed");
    assert.equal(result.status.error, "Recovered partial text for the user");
    assert.match(result.response, /Exit code: 124/u);
    assert.match(result.response, /Recovered partial text for the user/u);
    assert.doesNotMatch(result.response, /"result_text"/u);
    assert.equal(result.record.status, "failed");
    assert.equal(result.record.exitCode, 124);
    assert.equal(result.record.response, "Recovered partial text for the user");
    assert.equal(result.state.projects[projectPath].status, "idle");
    assert.equal(result.state.projects[projectPath].sessions["sess-recovered"].status, "idle");
  });
});

test("dispatch artifact handoff is opt-in for explicit file requests", async () => {
  await withTempProject(async ({ root, projectPath, homePath }) => {
    const sourceDispatch = shellQuote(path.join(repoRoot, "lib", "dispatch.sh"));
    const { stdout } = await runRegistryScript({
      root,
      projectPath,
      homePath,
      script: `
source ${sourceDispatch}
plain=$(_artifact_augmented_message "$PROJECT_PATH" "Fix the Quick Chat dropdown.")
requested=$(_artifact_augmented_message "$PROJECT_PATH" "Create a downloadable PDF file with the summary.")
"$CLAWDAD_JQ" -n --arg plain "$plain" --arg requested "$requested" '{ plain: $plain, requested: $requested }'
`,
    });

    const result = JSON.parse(stdout);
    assert.equal(result.plain, "Fix the Quick Chat dropdown.");
    assert.match(result.requested, /Clawdad artifact handoff/u);
    assert.match(result.requested, /\.clawdad\/artifacts/u);
  });
});

test("dispatch attachment handoff lists uploaded files and forwards manifest to Codex command", async () => {
  await withTempProject(async ({ root, projectPath, homePath }) => {
    const sourceDispatch = shellQuote(path.join(repoRoot, "lib", "dispatch.sh"));
    const manifestPath = path.join(root, "manifest.json");
    const imagePath = path.join(projectPath, ".clawdad", "attachments", "upload", "screen.png");
    await mkdir(path.dirname(imagePath), { recursive: true });
    await writeFile(imagePath, "png", "utf8");
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          projectPath,
          attachments: [
            {
              fileName: "screen.png",
              path: imagePath,
              mimeType: "image/png",
              size: 3,
              kind: "image",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    const { stdout } = await runRegistryScript({
      root,
      projectPath,
      homePath,
      script: `
source ${sourceDispatch}
message=$(_attachment_augmented_message "Review this." ${shellQuote(manifestPath)})
_build_cmd_codex "Review this." "session-1" "false" "approve" "" "$PROJECT_PATH" ${shellQuote(manifestPath)}
"$CLAWDAD_JQ" -n --arg message "$message" --argjson cmd "$(printf '%s\n' "$cmd[@]" | "$CLAWDAD_JQ" -R . | "$CLAWDAD_JQ" -s .)" '{ message: $message, cmd: $cmd }'
`,
    });

    const result = JSON.parse(stdout);
    assert.match(result.message, /Clawdad attachment handoff/u);
    assert.match(result.message, /screen\.png \(image\/png, 3 bytes\):/u);
    assert.match(result.message, /Images are also attached to Codex directly/u);
    assert.ok(result.cmd.includes("--attachment-manifest"));
    assert.equal(result.cmd[result.cmd.indexOf("--attachment-manifest") + 1], manifestPath);
    assert.ok(result.cmd.includes("--tool-idle-timeout-ms"));
    assert.equal(result.cmd[result.cmd.indexOf("--tool-idle-timeout-ms") + 1], "0");
    assert.equal(result.cmd[result.cmd.indexOf("--turn-timeout-ms") + 1], "0");
    assert.equal(result.cmd[result.cmd.indexOf("--turn-idle-timeout-ms") + 1], "0");
    assert.equal(result.cmd[result.cmd.indexOf("--liveness-interval-ms") + 1], "30000");
    assert.equal(result.cmd[result.cmd.indexOf("--liveness-probe-timeout-ms") + 1], "10000");
  });
});

test("registry_add falls back to a local-only session when ORP hits the notes limit", async () => {
  await withTempProject(async ({ root, projectPath, homePath }) => {
    const { stdout } = await runRegistryScript({
      root,
      projectPath,
      homePath,
      script: `
registry_add "$PROJECT_PATH" "placeholder-1" "Scratchpad Delegate" "" "codex" "false"
session_json=$(registry_session_json "$PROJECT_PATH" "Scratchpad Delegate")
sessions_json=$(registry_list_sessions_json "$PROJECT_PATH")
"$CLAWDAD_JQ" -n --argjson session "$session_json" --argjson sessions "$sessions_json" '{ session: $session, sessions: $sessions }'
`,
    });

    const result = JSON.parse(stdout);
    assert.equal(result.session.resumeSessionId, "placeholder-1");
    assert.equal(result.session.title, "Scratchpad Delegate");
    assert.equal(result.session.localOnly, true);
    assert.equal(result.session.providerSessionSeeded, false);

    const delegateSession = result.sessions.find((session) => session.slug === "Scratchpad Delegate");
    assert.ok(delegateSession);
    assert.equal(delegateSession.localOnly, true);
    assert.equal(delegateSession.active, true);

    const state = await readState(homePath);
    const sessionState = state.projects[projectPath].sessions["placeholder-1"];
    assert.equal(sessionState.local_only, "true");
    assert.match(sessionState.orp_error, /10000/u);
  });
});

test("registry_set_resume_session rekeys local-only sessions after dispatch creates a real provider thread", async () => {
  await withTempProject(async ({ root, projectPath, homePath }) => {
    const { stdout } = await runRegistryScript({
      root,
      projectPath,
      homePath,
      script: `
registry_add "$PROJECT_PATH" "placeholder-1" "Scratchpad Delegate" "" "codex" "false"
registry_set_resume_session "$PROJECT_PATH" "Scratchpad Delegate" "codex" "placeholder-1" "real-codex-session"
session_json=$(registry_session_json "$PROJECT_PATH" "Scratchpad Delegate")
"$CLAWDAD_JQ" -n --argjson session "$session_json" '{ session: $session }'
`,
    });

    const result = JSON.parse(stdout);
    assert.equal(result.session.resumeSessionId, "real-codex-session");
    assert.equal(result.session.localOnly, true);
    assert.equal(result.session.providerSessionSeeded, true);

    const state = await readState(homePath);
    assert.equal(state.projects[projectPath].active_session_id, "real-codex-session");
    assert.equal(state.projects[projectPath].sessions["placeholder-1"], undefined);
    assert.equal(state.projects[projectPath].sessions["real-codex-session"].local_only, "true");
    assert.equal(
      state.projects[projectPath].sessions["real-codex-session"].provider_session_seeded,
      "true",
    );
  });
});

test("registry_set_resume_session preserves imported real Codex session metadata", async () => {
  await withTempProject(async ({ root, projectPath, homePath }) => {
    const { stdout } = await runRegistryScript({
      root,
      projectPath,
      homePath,
      script: `
registry_add "$PROJECT_PATH" "placeholder-1" "Scratchpad Delegate" "" "codex" "false"
state_update_session "$PROJECT_PATH" "placeholder-1" "status" "running"
state_update_session "$PROJECT_PATH" "placeholder-1" "dispatch_count" "2"
state_update_session "$PROJECT_PATH" "placeholder-1" "last_dispatch" "2026-05-04T22:13:18Z"
state_register_session "$PROJECT_PATH" "real-codex-session" "Imported Chubby transcript" "codex" "true"
state_update_session "$PROJECT_PATH" "real-codex-session" "provider_transcript_path" "/tmp/codex/real.jsonl"
state_update_session "$PROJECT_PATH" "real-codex-session" "provider_last_activity" "2026-05-04T22:20:49.771Z"
registry_set_resume_session "$PROJECT_PATH" "Scratchpad Delegate" "codex" "placeholder-1" "real-codex-session"
session_json=$(registry_session_json "$PROJECT_PATH" "Scratchpad Delegate")
"$CLAWDAD_JQ" -n --argjson session "$session_json" '{ session: $session }'
`,
    });

    const result = JSON.parse(stdout);
    assert.equal(result.session.resumeSessionId, "real-codex-session");
    assert.equal(result.session.localOnly, true);

    const state = await readState(homePath);
    const sessionState = state.projects[projectPath].sessions["real-codex-session"];
    assert.equal(state.projects[projectPath].sessions["placeholder-1"], undefined);
    assert.equal(sessionState.provider_transcript_path, "/tmp/codex/real.jsonl");
    assert.equal(sessionState.provider_last_activity, "2026-05-04T22:20:49.771Z");
    assert.equal(sessionState.dispatch_count, 2);
    assert.equal(sessionState.last_dispatch, "2026-05-04T22:13:18Z");
    assert.equal(sessionState.status, "running");
  });
});

test("registry sync preserves existing session dispatch status", async () => {
  await withTempProject(async ({ root, projectPath, homePath }) => {
    const { stdout } = await runRegistryScript({
      root,
      projectPath,
      homePath,
      script: `
state_ensure_project "$PROJECT_PATH"
state_register_session "$PROJECT_PATH" "main-session" "main mind" "codex" "true"
state_update_session "$PROJECT_PATH" "main-session" "status" "failed"
state_update_session "$PROJECT_PATH" "main-session" "dispatch_count" "7"
state_update_session "$PROJECT_PATH" "main-session" "last_dispatch" "2026-04-30T00:05:15Z"
state_update_session "$PROJECT_PATH" "main-session" "last_response" "2026-04-30T00:07:09Z"
registry_sync_sessions_for_project "$PROJECT_PATH"
sessions_json=$(registry_list_sessions_json "$PROJECT_PATH")
"$CLAWDAD_JQ" -n --argjson sessions "$sessions_json" '{ sessions: $sessions }'
`,
    });

    const result = JSON.parse(stdout);
    const session = result.sessions.find((entry) => entry.sessionId === "main-session");
    assert.ok(session);
    assert.equal(session.status, "failed");
    assert.equal(session.dispatchCount, 7);
    assert.equal(session.lastDispatch, "2026-04-30T00:05:15Z");
    assert.equal(session.lastResponse, "2026-04-30T00:07:09Z");

    const state = await readState(homePath);
    const sessionState = state.projects[projectPath].sessions["main-session"];
    assert.equal(sessionState.status, "failed");
    assert.equal(sessionState.dispatch_count, 7);
    assert.equal(sessionState.last_dispatch, "2026-04-30T00:05:15Z");
    assert.equal(sessionState.last_response, "2026-04-30T00:07:09Z");
  });
});

test("quarantined Codex sessions stay excluded from future session adoption", async () => {
  await withTempProject(async ({ root, projectPath, homePath }) => {
    const { stdout } = await runRegistryScript({
      root,
      projectPath,
      homePath,
      script: `
state_ensure_project "$PROJECT_PATH"
state_register_session "$PROJECT_PATH" "bad-session" "old failed thread" "codex" "true"
state_update_session "$PROJECT_PATH" "bad-session" "status" "failed"
state_quarantine_session "$PROJECT_PATH" "bad-session" "repeated_codex_transport_disconnect" "stream disconnected before completion"
selected_after_quarantine=false
if registry_session_json "$PROJECT_PATH" "bad-session" >/dev/null 2>&1; then
  selected_after_quarantine=true
fi
registry_remove "$PROJECT_PATH" "bad-session" "old failed thread"
registry_sync_sessions_for_project "$PROJECT_PATH"
excluded=$(registry_codex_tracked_session_ids_for_path "$PROJECT_PATH" | sort | tr '\\n' ' ')
is_quarantined=false
if state_session_is_quarantined "$PROJECT_PATH" "bad-session"; then
  is_quarantined=true
fi
"$CLAWDAD_JQ" -n --arg excluded "$excluded" --argjson isQuarantined "$is_quarantined" --argjson selectedAfterQuarantine "$selected_after_quarantine" '{ excluded: $excluded, isQuarantined: $isQuarantined, selectedAfterQuarantine: $selectedAfterQuarantine }'
`,
    });

    const result = JSON.parse(stdout);
    assert.equal(result.isQuarantined, true);
    assert.equal(result.selectedAfterQuarantine, false);
    assert.match(result.excluded, /\bbad-session\b/u);

    const state = await readState(homePath);
    assert.equal(state.projects[projectPath].sessions["bad-session"], undefined);
    assert.equal(
      state.projects[projectPath].quarantined_sessions["bad-session"].reason,
      "repeated_codex_transport_disconnect",
    );
  });
});
