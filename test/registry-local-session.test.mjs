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

async function runRegistryScript({ root, projectPath, homePath, script }) {
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
    },
  });
}

async function readState(homePath) {
  return JSON.parse(await readFile(path.join(homePath, "state.json"), "utf8"));
}

test("registry_add falls back to a local-only session when ORP hits the notes limit", async () => {
  await withTempProject(async ({ root, projectPath, homePath }) => {
    const { stdout } = await runRegistryScript({
      root,
      projectPath,
      homePath,
      script: `
registry_add "$PROJECT_PATH" "placeholder-1" "Global Mind Delegate" "" "codex" "false"
session_json=$(registry_session_json "$PROJECT_PATH" "Global Mind Delegate")
sessions_json=$(registry_list_sessions_json "$PROJECT_PATH")
"$CLAWDAD_JQ" -n --argjson session "$session_json" --argjson sessions "$sessions_json" '{ session: $session, sessions: $sessions }'
`,
    });

    const result = JSON.parse(stdout);
    assert.equal(result.session.resumeSessionId, "placeholder-1");
    assert.equal(result.session.title, "Global Mind Delegate");
    assert.equal(result.session.localOnly, true);
    assert.equal(result.session.providerSessionSeeded, false);

    const delegateSession = result.sessions.find((session) => session.slug === "Global Mind Delegate");
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
registry_add "$PROJECT_PATH" "placeholder-1" "Global Mind Delegate" "" "codex" "false"
registry_set_resume_session "$PROJECT_PATH" "Global Mind Delegate" "codex" "placeholder-1" "real-codex-session"
session_json=$(registry_session_json "$PROJECT_PATH" "Global Mind Delegate")
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
registry_add "$PROJECT_PATH" "placeholder-1" "Global Mind Delegate" "" "codex" "false"
state_update_session "$PROJECT_PATH" "placeholder-1" "status" "running"
state_update_session "$PROJECT_PATH" "placeholder-1" "dispatch_count" "2"
state_update_session "$PROJECT_PATH" "placeholder-1" "last_dispatch" "2026-05-04T22:13:18Z"
state_register_session "$PROJECT_PATH" "real-codex-session" "Imported Chubby transcript" "codex" "true"
state_update_session "$PROJECT_PATH" "real-codex-session" "provider_transcript_path" "/tmp/codex/real.jsonl"
state_update_session "$PROJECT_PATH" "real-codex-session" "provider_last_activity" "2026-05-04T22:20:49.771Z"
registry_set_resume_session "$PROJECT_PATH" "Global Mind Delegate" "codex" "placeholder-1" "real-codex-session"
session_json=$(registry_session_json "$PROJECT_PATH" "Global Mind Delegate")
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
