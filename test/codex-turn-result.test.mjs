import assert from "node:assert/strict";
import test from "node:test";

import { extractAgentMessageText, latestAgentDeltaText, selectCodexTurnResultText } from "../lib/codex-turn-result.mjs";

test("extractAgentMessageText prefers final answer phase", () => {
  const text = extractAgentMessageText([
    { type: "agentMessage", phase: "analysis", text: "working" },
    { type: "agentMessage", phase: "final_answer", text: "done" },
    { type: "toolResult", text: "ignored" },
  ]);

  assert.equal(text, "done");
});

test("selectCodexTurnResultText prefers current turn completion over stale thread read", () => {
  const text = selectCodexTurnResultText({
    readItems: [
      { type: "agentMessage", phase: "final_answer", text: "stale prior response without json" },
    ],
    completedAgentMessages: [
      {
        type: "agentMessage",
        phase: "final_answer",
        text: 'fresh response\n```json\n{"state":"continue","stop_reason":"none","next_action":"next","summary":"done"}\n```',
      },
    ],
  });

  assert.match(text, /"state":"continue"/u);
  assert.doesNotMatch(text, /stale prior response/u);
});

test("selectCodexTurnResultText falls back to latest delta before thread read", () => {
  const deltas = new Map([
    ["item-a", ""],
    ["item-b", 'streamed\n```json\n{"state":"completed","stop_reason":"none","next_action":"none","summary":"done"}\n```'],
  ]);

  const text = selectCodexTurnResultText({
    readItems: [
      { type: "agentMessage", phase: "final_answer", text: "old read" },
    ],
    agentDeltaTexts: deltas,
  });

  assert.equal(text, latestAgentDeltaText(deltas));
});
