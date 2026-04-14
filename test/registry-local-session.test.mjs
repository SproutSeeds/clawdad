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
