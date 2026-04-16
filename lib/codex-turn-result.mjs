function pickText(value) {
  return typeof value === "string" ? value : "";
}

export function extractAgentMessageText(items = []) {
  const agentMessages = (Array.isArray(items) ? items : []).filter(
    (item) => item && item.type === "agentMessage" && typeof item.text === "string",
  );
  if (agentMessages.length === 0) {
    return "";
  }

  const finalMessage =
    agentMessages.findLast((item) => item.phase === "final_answer") ||
    agentMessages[agentMessages.length - 1];
  return pickText(finalMessage.text);
}

export function latestAgentDeltaText(agentDeltaTexts) {
  const values =
    agentDeltaTexts instanceof Map
      ? Array.from(agentDeltaTexts.values())
      : Array.isArray(agentDeltaTexts)
        ? agentDeltaTexts
        : [];
  const lastDelta = values.findLast((value) => value && String(value).trim());
  return lastDelta ? String(lastDelta) : "";
}

export function selectCodexTurnResultText({
  readItems = [],
  completedAgentMessages = [],
  agentDeltaTexts = new Map(),
} = {}) {
  const fromCompletedItems = extractAgentMessageText(completedAgentMessages);
  if (fromCompletedItems) {
    return fromCompletedItems;
  }

  const fromDelta = latestAgentDeltaText(agentDeltaTexts);
  if (fromDelta) {
    return fromDelta;
  }

  return extractAgentMessageText(readItems);
}
