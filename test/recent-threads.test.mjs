import assert from "node:assert/strict";
import test from "node:test";
import { recentThreadSummariesForProjects } from "../lib/recent-threads.mjs";

test("recent threads merge project sessions and sort newest activity first", () => {
  const projects = [
    {
      displayName: "Alpha",
      path: "/workspace/alpha",
      activeSessionId: "alpha-session",
      sessions: [
        {
          slug: "Older Alpha",
          provider: "codex",
          sessionId: "alpha-session",
          status: "idle",
          lastResponse: "2026-07-27T02:00:00.000Z",
        },
      ],
    },
    {
      displayName: "Beta",
      path: "/workspace/beta",
      activeSessionId: "beta-session",
      sessions: [
        {
          slug: "Newest Beta",
          provider: "codex",
          sessionId: "beta-session",
          status: "running",
          providerLastActivity: "2026-07-27T03:00:00.000Z",
        },
      ],
    },
  ];

  const recent = recentThreadSummariesForProjects(projects);

  assert.deepEqual(recent.map((thread) => thread.sessionId), [
    "beta-session",
    "alpha-session",
  ]);
  assert.equal(recent[0].projectName, "Beta");
  assert.equal(recent[0].projectPath, "/workspace/beta");
  assert.equal(recent[0].title, "Newest Beta");
  assert.equal(recent[0].lastActivityAt, "2026-07-27T03:00:00.000Z");
  assert.equal(recent[1].active, true);
});

test("recent threads deduplicate provisional aliases and obey the requested limit", () => {
  const projects = [
    {
      displayName: "Launch",
      path: "/workspace/launch",
      activeSessionId: "real-session",
      sessionAliases: {
        "provisional-session": "real-session",
      },
      sessions: [
        {
          slug: "Launch plan",
          sessionId: "provisional-session",
          lastDispatch: "2026-07-27T03:00:00.000Z",
        },
        {
          slug: "Launch plan 2",
          sessionId: "real-session",
          lastResponse: "2026-07-27T03:10:00.000Z",
        },
        {
          slug: "Secondary",
          sessionId: "secondary-session",
          lastResponse: "2026-07-27T02:00:00.000Z",
        },
      ],
    },
  ];

  const recent = recentThreadSummariesForProjects(projects, { limit: 1 });

  assert.equal(recent.length, 1);
  assert.equal(recent[0].sessionId, "real-session");
  assert.equal(recent[0].title, "Launch plan 2");
  assert.equal(recent[0].active, true);
});
