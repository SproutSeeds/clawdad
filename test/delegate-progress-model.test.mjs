import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const repoRoot = path.resolve(import.meta.dirname, "..");
const webAppPath = path.join(repoRoot, "web", "app.js");

async function loadDelegateProgressHelpers() {
  const source = await readFile(webAppPath, "utf8");
  const start = source.indexOf("function shortDelegateRunText");
  const end = source.indexOf("function appendDelegateStepField");
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.ok(end > start);

  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `
${source.slice(start, end)}
globalThis.buildDelegateProgressModel = buildDelegateProgressModel;
globalThis.delegatePlanNextSteps = delegatePlanNextSteps;
globalThis.delegateProgressPriorityItems = delegateProgressPriorityItems;
globalThis.delegateRunCardData = delegateRunCardData;
`,
    context,
  );
  return context;
}

test("delegate progress model turns completed step events into Done items", async () => {
  const { buildDelegateProgressModel } = await loadDelegateProgressHelpers();
  const model = buildDelegateProgressModel(
    { status: { state: "completed" }, latestPlanSnapshot: null },
    {
      events: [
        {
          id: "step-1-start",
          at: "2026-05-04T14:00:00.000Z",
          type: "step_started",
          step: 1,
          text: "Implement progress modal.",
        },
        {
          id: "step-1-done",
          at: "2026-05-04T14:05:00.000Z",
          type: "step_completed",
          step: 1,
          summary: "Progress sections render from existing delegate data.",
          state: "completed",
          checkpoint: {
            progressSignal: "tests identified",
            breakthroughs: "model helper is pure",
            blockers: "none",
            nextProbe: "wire the UI",
            confidence: "high",
          },
        },
      ],
    },
  );

  assert.equal(model.done.length, 1);
  assert.equal(model.done[0].title, "Step 1");
  assert.match(model.done[0].outcome, /Progress sections render/u);
  assert.match(model.done[0].checkpoint, /model helper is pure/u);
});

test("delegate progress model exposes exactly one active Working Now item", async () => {
  const { buildDelegateProgressModel } = await loadDelegateProgressHelpers();
  const model = buildDelegateProgressModel(
    {
      status: {
        state: "running",
        activeStep: 2,
        activeRequestId: "request-2",
        nextAction: "Finish the progress-first modal.",
        updatedAt: "2026-05-04T14:06:00.000Z",
      },
      latestPlanSnapshot: null,
    },
    {
      events: [
        {
          id: "step-2-start",
          at: "2026-05-04T14:06:00.000Z",
          type: "step_started",
          step: 2,
          text: "Wire progress UI.",
        },
        {
          id: "step-2-live",
          at: "2026-05-04T14:07:00.000Z",
          type: "agent_live",
          step: 2,
          text: "Rendering Done, Working Now, and Next Up.",
        },
      ],
    },
  );

  assert.equal(model.workingNow.length, 1);
  assert.equal(model.workingNow[0].title, "Step 2");
  assert.match(model.workingNow[0].text, /Rendering Done/u);
});

test("delegate priority items include next action, checkpoint probe, and saved plan steps", async () => {
  const { delegateProgressPriorityItems } = await loadDelegateProgressHelpers();
  const items = delegateProgressPriorityItems(
    { status: { nextAction: "Run frontend helper tests." } },
    {
      checkpoint: {
        nextProbe: "Open the modal and inspect the first screen.",
      },
    },
    {
      plan: [
        "1. Keep progress facts above diagnostics.",
        "2. Move raw logs into collapsed details.",
      ].join("\n"),
    },
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(items.map((item) => item.source))),
    ["Selected next action", "Checkpoint next probe", "Saved plan", "Saved plan"],
  );
  assert.match(items[0].text, /Run frontend helper tests/u);
  assert.match(items[1].text, /inspect the first screen/u);
  assert.match(items[2].text, /progress facts/u);
});

test("delegate priority items explain when the delegate will choose the next action later", async () => {
  const { delegateProgressPriorityItems } = await loadDelegateProgressHelpers();
  const items = delegateProgressPriorityItems({ status: {} }, null, null);

  assert.equal(items[0].source, "Delegate");
  assert.equal(items[0].text, "The delegate will choose after this step.");
});

test("delegate run card data hides codex-events sidecar runs from primary history", async () => {
  const { delegateRunCardData } = await loadDelegateProgressHelpers();
  const cards = delegateRunCardData(
    {
      runList: [
        {
          runId: "run-main",
          state: "completed",
          completedAt: "2026-05-04T14:12:00.000Z",
          summary: "Main run finished.",
        },
        {
          runId: "run-main.codex-events",
          state: "completed",
          completedAt: "2026-05-04T14:13:00.000Z",
          summary: "Raw app-server stream.",
        },
      ],
      runSummarySnapshots: [
        {
          runId: "summary.codex-events",
          createdAt: "2026-05-04T14:14:00.000Z",
          summary: "Sidecar summary.",
        },
      ],
    },
    { runId: "run-main.codex-events", events: [], total: 0 },
  );

  assert.deepEqual(JSON.parse(JSON.stringify(cards.map((card) => card.runId))), ["run-main"]);
});
